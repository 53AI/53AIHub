package model

import (
	"context"
	"strconv"
	"strings"

	"gorm.io/gorm"
)

const (
	// SpeakerBaselinePendingPrefix 切片租约前缀：storage_key 以它开头表示"某实例正在切第 n 次"，
	// 多实例连同一个库时靠它互斥，格式 pending@<逻辑版本>@<实例名>#<次数>。
	SpeakerBaselinePendingPrefix = "pending@"
	// SpeakerBaselineRetryPrefix 切片失败待重试前缀，格式 retry@<逻辑版本>@<次数>@<原因>。
	SpeakerBaselineRetryPrefix = "retry@"
	// SpeakerBaselineFailedPrefix 切片放弃前缀（终态），格式 failed@<逻辑版本>@<原因>。
	SpeakerBaselineFailedPrefix = "failed@"
)

// SpeakerBaselineClipAttempt 解析切片标记里已尝试的次数；成品 key 与不含次数的历史标记返回 0。
func SpeakerBaselineClipAttempt(key string) int {
	if rest, ok := strings.CutPrefix(key, SpeakerBaselineRetryPrefix); ok {
		if parts := strings.Split(rest, "@"); len(parts) == 3 {
			if n, err := strconv.Atoi(parts[1]); err == nil && n > 0 {
				return n
			}
		}
		return 0
	}
	if rest, ok := strings.CutPrefix(key, SpeakerBaselinePendingPrefix); ok {
		if i := strings.LastIndex(rest, "#"); i >= 0 {
			if n, err := strconv.Atoi(rest[i+1:]); err == nil && n > 0 {
				return n
			}
		}
	}
	return 0
}

// SpeakerBaselineClipCode 解析失败标记里的原因代码；非失败标记返回空。
func SpeakerBaselineClipCode(key string) string {
	if rest, ok := strings.CutPrefix(key, SpeakerBaselineRetryPrefix); ok {
		if parts := strings.Split(rest, "@"); len(parts) == 3 {
			return parts[2]
		}
	}
	if rest, ok := strings.CutPrefix(key, SpeakerBaselineFailedPrefix); ok {
		if parts := strings.Split(rest, "@"); len(parts) == 2 {
			return parts[1]
		}
	}
	return ""
}

// IsSpeakerBaselineFinished 判断 storage_key 是否指向真实音频；待切片、租约、待重试、已放弃都算未完成。
func IsSpeakerBaselineFinished(key string) bool {
	return key != "" &&
		!strings.HasPrefix(key, SpeakerBaselinePendingPrefix) &&
		!strings.HasPrefix(key, SpeakerBaselineRetryPrefix) &&
		!strings.HasPrefix(key, SpeakerBaselineFailedPrefix)
}

// RecordingSpeakerBaseline 发言人基准片段：某人员在某录音中某个时间区间的声音样本。
// start_ms/end_ms 是权威标识（可据此从原音频重建切片），storage_key 指向的音频是派生物；
// storage_key 同时兼作切片任务状态（四态）：空 = 待切片；pending@ = 某实例正在切（租约）；
// retry@ = 失败待重试；failed@ = 已达尝试上限放弃；其余 = 已完成的音频 key；
// transcript_text 是关联当时该片段的台词快照，供人工识别，人员改名/转写重写都不回刷。
type RecordingSpeakerBaseline struct {
	ID           int64  `json:"id" gorm:"column:id;primaryKey;autoIncrement"`
	Eid          int64  `json:"eid" gorm:"column:eid;not null;index:idx_recording_speaker_baselines_eid_contact,priority:1"`
	UserID       int64  `json:"user_id" gorm:"column:user_id;not null;default:0"`
	FileID       int64  `json:"file_id" gorm:"column:file_id;not null;index:idx_recording_speaker_baselines_file"`
	UploadFileID int64  `json:"upload_file_id" gorm:"column:upload_file_id;not null;default:0"`
	ContactID    int64  `json:"contact_id" gorm:"column:contact_id;not null;index:idx_recording_speaker_baselines_eid_contact,priority:2"`
	SpeakerLabel string `json:"speaker_label" gorm:"column:speaker_label;size:64;not null;default:''"`

	StartMs    int64 `json:"start_ms" gorm:"column:start_ms;not null;default:0"`
	EndMs      int64 `json:"end_ms" gorm:"column:end_ms;not null;default:0"`
	DurationMs int64 `json:"duration_ms" gorm:"column:duration_ms;not null;default:0"`

	TranscriptText LongText `json:"transcript_text" gorm:"column:transcript_text"`

	StorageKey string `json:"storage_key" gorm:"column:storage_key;size:512;not null;default:''"`
	MimeType   string `json:"mime_type" gorm:"column:mime_type;size:128;not null;default:''"`
	SizeBytes  int64  `json:"size_bytes" gorm:"column:size_bytes;not null;default:0"`

	IsDeleted bool `json:"is_deleted" gorm:"column:is_deleted;not null;default:false"`

	BaseModel
}

func (RecordingSpeakerBaseline) TableName() string {
	return "recording_speaker_baselines"
}

// FindReusableSpeakerBaselineInTx 查找同人员同区间的可用基准（幂等：重复点确定不重复建记录）。
// 必须在绑定事务内、串行化之后重查，才能挡住并发重复提交；未命中返回 (nil, nil)。
func FindReusableSpeakerBaselineInTx(db *gorm.DB, eid, fileID, contactID, startMs, endMs int64) (*RecordingSpeakerBaseline, error) {
	var baseline RecordingSpeakerBaseline
	err := db.
		Where("eid = ? AND file_id = ? AND contact_id = ? AND start_ms = ? AND end_ms = ? AND is_deleted = ?",
			eid, fileID, contactID, startMs, endMs, false).
		First(&baseline).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &baseline, nil
}

// ListSpeakerBaselinesByContact 按人员列基准（跨录音，按创建时间倒序）。
func ListSpeakerBaselinesByContact(ctx context.Context, eid, contactID int64, limit, offset int) ([]RecordingSpeakerBaseline, int64, error) {
	// 还没切出音频的行（待切片、正被切片、待重试、已放弃）是后台任务态，不出现在基准列表
	query := DB.WithContext(ctx).Model(&RecordingSpeakerBaseline{}).
		Where("eid = ? AND contact_id = ? AND is_deleted = ? AND storage_key <> ? AND storage_key NOT LIKE ? AND storage_key NOT LIKE ? AND storage_key NOT LIKE ?",
			eid, contactID, false, "", SpeakerBaselinePendingPrefix+"%", SpeakerBaselineRetryPrefix+"%", SpeakerBaselineFailedPrefix+"%")

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var baselines []RecordingSpeakerBaseline
	query = query.Order("id DESC")
	if limit > 0 {
		query = query.Limit(limit).Offset(offset)
	}
	if err := query.Find(&baselines).Error; err != nil {
		return nil, 0, err
	}
	return baselines, total, nil
}

// GetSpeakerBaselineByID 按 ID 取未删除基准，企业维度隔离。
func GetSpeakerBaselineByID(ctx context.Context, eid, id int64) (*RecordingSpeakerBaseline, error) {
	var baseline RecordingSpeakerBaseline
	if err := DB.WithContext(ctx).
		Where("id = ? AND eid = ? AND is_deleted = ?", id, eid, false).
		First(&baseline).Error; err != nil {
		return nil, err
	}
	return &baseline, nil
}

// SoftDeleteSpeakerBaseline 软删基准，返回被删记录用于清理切片。
func SoftDeleteSpeakerBaseline(ctx context.Context, eid, id int64) (*RecordingSpeakerBaseline, error) {
	baseline, err := GetSpeakerBaselineByID(ctx, eid, id)
	if err != nil {
		return nil, err
	}
	if err := DB.WithContext(ctx).Model(&RecordingSpeakerBaseline{}).
		Where("id = ?", baseline.ID).
		Update("is_deleted", true).Error; err != nil {
		return nil, err
	}
	return baseline, nil
}
