package model

import (
	"context"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/dbgormlogger"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/env"
)

// SlowLogResolveStatus 解决状态
type SlowLogResolveStatus int

const (
	SlowLogUnresolved SlowLogResolveStatus = 0 // 未解决
	SlowLogResolved   SlowLogResolveStatus = 1 // 已解决
	SlowLogIgnored    SlowLogResolveStatus = 2 // 无需解决
)

// SlowLogRecord 慢日志记录
type SlowLogRecord struct {
	ID            int64                `json:"id" gorm:"primaryKey;autoIncrement;comment:流水ID"`
	Type          string               `json:"type" gorm:"size:10;not null;index:idx_slow_type_feature;comment:类型: api/sql"`
	Feature       string               `json:"feature" gorm:"size:500;not null;index:idx_slow_type_feature;comment:特征标识(API: method+path, SQL: SQL指纹+行号)"`
	SampleData    string               `json:"sample_data" gorm:"type:text;comment:采样数据(SQL完整SQL或API完整URL)"`
	SlowestMs     int64                `json:"slowest_ms" gorm:"not null;default:0;comment:最慢耗时(毫秒)"`
	FileLine      string               `json:"file_line" gorm:"size:200;comment:SQL触发的文件行号"`
	ResolvedAt    *int64               `json:"resolved_at" gorm:"comment:解决时间(毫秒时间戳, null表示未解决)"`
	ResolveStatus SlowLogResolveStatus `json:"resolve_status" gorm:"not null;default:0;comment:解决状态: 0未解决 1已解决 2无需解决"`
	TriggerCount  int64                `json:"trigger_count" gorm:"not null;default:0;comment:触发次数"`
	CreatedAt     int64                `json:"created_at" gorm:"autoCreateTime;milli;comment:创建时间"`
	UpdatedAt     int64                `json:"updated_at" gorm:"autoUpdateTime;milli;comment:更新时间"`
}

func (SlowLogRecord) TableName() string {
	return "slow_log_records"
}

var (
	slowLogChan    chan dbgormlogger.SlowLogEntry
	slowLogOnce    sync.Once
	slowLogEnabled bool
)

// InitSlowLogRecorder 初始化慢日志异步记录器
func InitSlowLogRecorder() {
	slowLogOnce.Do(func() {
		slowLogEnabled = env.Bool("SLOW_LOG_ENABLED", false)
		if !slowLogEnabled {
			logger.SysLog("慢日志记录未启用 (SLOW_LOG_ENABLED=false)")
			return
		}
		bufferSize := env.Int("SLOW_LOG_BUFFER_SIZE", 256)
		workerCount := env.Int("SLOW_LOG_WORKER_COUNT", 2)
		slowLogChan = make(chan dbgormlogger.SlowLogEntry, bufferSize)

		// 注册持久化回调到 dbgormlogger
		dbgormlogger.RegisterSlowLogHandler(func(entry dbgormlogger.SlowLogEntry) {
			select {
			case slowLogChan <- entry:
			default:
				logger.SysWarn("慢日志缓冲队列已满，丢弃条目: " + entry.Feature)
			}
		})

		for i := 0; i < workerCount; i++ {
			go slowLogWorker(i)
		}
		logger.SysLogf("慢日志记录已启用, buffer=%d workers=%d", bufferSize, workerCount)
	})
}

// PushSlowLogEntry 供外部推送慢日志条目到异步队列（非阻塞）
func PushSlowLogEntry(entry dbgormlogger.SlowLogEntry) {
	if !slowLogEnabled || slowLogChan == nil {
		return
	}
	select {
	case slowLogChan <- entry:
	default:
		logger.SysWarn("慢日志缓冲队列已满，丢弃条目: " + entry.Feature)
	}
}

func slowLogWorker(id int) {
	for entry := range slowLogChan {
		upsertSlowLogRecord(entry)
	}
}

func upsertSlowLogRecord(entry dbgormlogger.SlowLogEntry) {
	ctx := context.Background()
	now := time.Now().UnixMilli()

	var record SlowLogRecord
	err := DB.Where("type = ? AND feature = ?", entry.Type, entry.Feature).First(&record).Error

	if err != nil {
		// 不存在，创建新记录
		newRecord := SlowLogRecord{
		 Type:          entry.Type,
		 Feature:       entry.Feature,
		 SampleData:    entry.SampleData,
		 SlowestMs:     entry.CostMs,
		 FileLine:      entry.FileLine,
		 ResolveStatus: SlowLogUnresolved,
		 TriggerCount:  1,
		 CreatedAt:     now,
		 UpdatedAt:     now,
		}
		if err := DB.Create(&newRecord).Error; err != nil {
			logger.Errorf(ctx, "【慢日志】创建记录失败 feature=%s err=%v", entry.Feature, err)
		}
		return
	}

	// 已存在，更新触发次数和最新数据
	updates := map[string]interface{}{
		"trigger_count": record.TriggerCount + 1,
		"updated_at":    now,
	}

	// 保留最慢的值
	if entry.CostMs > record.SlowestMs {
		updates["slowest_ms"] = entry.CostMs
		updates["sample_data"] = entry.SampleData
	}

	// 如果已解决状态下又触发了，还原为未解决（重新采样）
	if record.ResolveStatus == SlowLogResolved {
		updates["resolve_status"] = SlowLogUnresolved
		updates["resolved_at"] = nil
	}

	if err := DB.Model(&SlowLogRecord{}).Where("id = ?", record.ID).Updates(updates).Error; err != nil {
		logger.Errorf(ctx, "【慢日志】更新记录失败 id=%d err=%v", record.ID, err)
	}
}

var allowedSlowLogSortFields = map[string]bool{
	"id": true, "updated_at": true, "created_at": true, "slowest_ms": true, "trigger_count": true,
}

// ListSlowLogRecords 查询慢日志记录列表
// resolveStatus: -1 全部, 0 未解决, 1 已解决, 2 无需解决
func ListSlowLogRecords(logType, keyword string, resolveStatus int, offset, limit int, sortField, sortOrder string) ([]*SlowLogRecord, int64, error) {
	var records []*SlowLogRecord
	var total int64

	query := DB.Model(&SlowLogRecord{})
	if logType != "" && logType != "all" {
		query = query.Where("type = ?", logType)
	}
	if resolveStatus >= 0 {
		query = query.Where("resolve_status = ?", resolveStatus)
	}
	if keyword != "" {
		query = query.Where("feature LIKE ? OR sample_data LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	orderClause := "updated_at DESC"
	if allowedSlowLogSortFields[sortField] {
		if sortOrder == "asc" {
			orderClause = sortField + " ASC"
		} else {
			orderClause = sortField + " DESC"
		}
	}

	if err := query.Order(orderClause).Offset(offset).Limit(limit).Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

// ResolveSlowLogRecord 标记慢日志为已解决
func ResolveSlowLogRecord(id int64) error {
	now := time.Now().UnixMilli()
	return DB.Model(&SlowLogRecord{}).Where("id = ?", id).
		Updates(map[string]interface{}{
			"resolve_status": SlowLogResolved,
			"resolved_at":    now,
		}).Error
}

// IgnoreSlowLogRecord 标记慢日志为无需解决（再次触发不会自动还原）
func IgnoreSlowLogRecord(id int64) error {
	return DB.Model(&SlowLogRecord{}).Where("id = ?", id).
		Updates(map[string]interface{}{
			"resolve_status": SlowLogIgnored,
			"resolved_at":    nil,
		}).Error
}
