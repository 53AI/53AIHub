package model

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/go-redis/redis/v8"
	"gorm.io/gorm"
)

// JobWrapper 用于在队列中传递的任务包装器
type JobWrapper struct {
	JobID      int64     `json:"job_id"`
	Eid        int64     `json:"eid"`
	Type       string    `json:"type"`
	EnqueuedAt time.Time `json:"enqueued_at"`
	Retries    int       `json:"retries"`
}

// RagJobFactory RAG任务工厂
type RagJobFactory struct {
	db  *gorm.DB
	rdb redis.Cmdable
}

// NewRagJobFactory 创建RAG任务工厂
func NewRagJobFactory(db *gorm.DB, rdb redis.Cmdable) *RagJobFactory {
	return &RagJobFactory{
		db:  db,
		rdb: rdb,
	}
}

// CreateJob 创建一个指定类型的RAG任务
func (f *RagJobFactory) CreateJob(ctx context.Context, eid int64, jobType string, startParameters string) (*RagJob, error) {
	// 解析startParameters获取fileID
	var params map[string]interface{}
	fileID := int64(0)
	metadata := ""
	if startParameters != "" {
		if err := json.Unmarshal([]byte(startParameters), &params); err == nil {
			if fileIDFloat, ok := params["file_id"].(float64); ok {
				fileID = int64(fileIDFloat)
			}
			// 检查是否有metadata字段
			if metadataStr, ok := params["metadata"].(string); ok {
				metadata = metadataStr
			}
		}
	}

	// 创建任务对象
	job := &RagJob{
		Eid:              eid,
		Type:             jobType,
		Status:           RagJobStatusPending,
		CurrentStepOrder: 0,
		FailureReason:    "",
		StartParameters:  startParameters,
		RelatedId:        fileID, // 设置关联ID为fileID
	}

	// 如果从参数中获取到了metadata，直接使用
	if metadata != "" {
		job.Metadata = metadata
	} else {
		// 否则尝试填充Metadata字段
		if err := f.populateJobMetadata(ctx, job); err != nil {
			// 填充Metadata失败不影响任务创建，只记录日志
			fmt.Printf("Failed to populate metadata for job %d: %v\n", job.JobID, err)
		}
	}

	// 保存任务到数据库
	if err := f.db.Create(job).Error; err != nil {
		return nil, fmt.Errorf("failed to save job to database: %v", err)
	}

	// 如果Redis可用，将任务加入队列
	if f.rdb != nil {
		// 创建任务包装器
		wrapper := JobWrapper{
			JobID:      job.JobID,
			Eid:        job.Eid,
			Type:       job.Type,
			EnqueuedAt: time.Now(),
			Retries:    0,
		}

		// 将wrapper序列化为JSON
		wrapperJSON, err := json.Marshal(wrapper)
		if err != nil {
			// 序列化失败不影响任务创建，只记录日志
			fmt.Printf("Failed to marshal job wrapper %d: %v\n", job.JobID, err)
			return job, nil
		}

		// 推入队列
		queueName := fmt.Sprintf("rag:job:queue:%s", job.Type)
		if err := f.rdb.LPush(ctx, queueName, wrapperJSON).Err(); err != nil {
			// 队列操作失败不影响任务创建，只记录日志
			fmt.Printf("Failed to enqueue job %d to queue %s: %v\n", job.JobID, queueName, err)
		}
	}

	return job, nil
}

// populateJobMetadata 填充任务的Metadata字段
func (f *RagJobFactory) populateJobMetadata(ctx context.Context, job *RagJob) error {
	// 解析startParameters
	var params map[string]interface{}
	if err := json.Unmarshal([]byte(job.StartParameters), &params); err != nil {
		return fmt.Errorf("failed to parse startParameters: %v", err)
	}

	// 获取file_id和upload_id
	fileIDFloat, ok := params["file_id"].(float64)
	if !ok {
		return nil // 如果没有file_id，跳过填充
	}
	fileID := int64(fileIDFloat)

	// 获取文件信息
	var file File
	if err := f.db.Where("id = ?", fileID).First(&file).Error; err != nil {
		return fmt.Errorf("failed to get file: %v", err)
	}

	// 获取上传文件信息
	var uploadFile *UploadFile
	if file.UploadFileID != 0 {
		if err := f.db.Where("id = ?", file.UploadFileID).First(&uploadFile).Error; err != nil {
			// return fmt.Errorf("failed to get upload file: %v", err)
		}
	}

	if uploadFile == nil {
		uploadFile = &UploadFile{
			Size: 0,
			ID:   0,
		}
	}

	fileIDStr, err := hashids.Encode(file.ID)
	if err != nil {
		return fmt.Errorf("failed to encode file ID: %v", err)
	}

	// 构建FileInfo
	fileInfo := RagJobFileInfo{
		ID:   fileIDStr,
		Name: ExtractSimpleFileName(file.Path),
		Type: fmt.Sprintf("%d", file.Type), // 将int类型的file.Type转换为string
		Size: uploadFile.Size,
	}

	// 构建Metadata
	metadata := RagJobMetadata{
		FileInfo: &fileInfo, // 使用指针类型
	}

	// 尝试获取清洗规则详情
	if cleaningRuleRaw, exists := params["cleaning_rule"]; exists {
		// 如果startParameters中包含完整的清洗规则信息
		if cleaningRuleMap, ok := cleaningRuleRaw.(map[string]interface{}); ok {
			// 转换为RagCleaningRule结构
			cleaningRule := &RagCleaningRule{}

			if idVal, ok := cleaningRuleMap["id"]; ok {
				if idStr, ok := idVal.(string); ok {
					cleaningRule.ID = idStr
				} else if idNum, ok := idVal.(float64); ok {
					cleaningRule.ID = fmt.Sprintf("%.0f", idNum)
				}
			}

			if nameVal, ok := cleaningRuleMap["name"]; ok {
				if nameStr, ok := nameVal.(string); ok {
					cleaningRule.Name = nameStr
				}
			}

			if iconVal, ok := cleaningRuleMap["icon"]; ok {
				if iconStr, ok := iconVal.(string); ok {
					cleaningRule.Icon = iconStr
				}
			}

			metadata.CleaningRule = cleaningRule
		} else if nameStr, ok := cleaningRuleRaw.(string); ok {
			// 如果只有名称字符串
			cleaningRule := &RagCleaningRule{
				Name: nameStr,
			}
			// 生成ID（如果需要的话）
			if id, err := hashids.Encode(int64(len(nameStr))); err == nil {
				cleaningRule.ID = id
			} else {
				cleaningRule.ID = fmt.Sprintf("rule_%d", len(nameStr))
			}
			metadata.CleaningRule = cleaningRule
		}
	} else {
		// 尝试通过文件ID查找匹配的策略名称
		if strategy, _, err := FindHighestPriorityRagRoutingStrategyAndPipelineByFile(f.db, &file); err == nil && strategy != nil {
			cleaningRule := &RagCleaningRule{
				ID:   fmt.Sprintf("%d", strategy.ID),
				Name: strategy.Name,
				Icon: "", // 可以在这里设置默认图标或者从其他地方获取
			}
			metadata.CleaningRule = cleaningRule
		}
	}

	// 序列化Metadata
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("failed to marshal metadata: %v", err)
	}

	// 设置Metadata字段
	job.Metadata = string(metadataJSON)
	return nil
}

// CreateJobWithoutQueue 创建一个指定类型的RAG任务（不加入队列）
func (f *RagJobFactory) CreateJobWithoutQueue(ctx context.Context, eid int64, jobType string, startParameters string) (*RagJob, error) {
	// 解析startParameters获取fileID
	var params map[string]interface{}
	fileID := int64(0)
	metadata := ""
	if startParameters != "" {
		if err := json.Unmarshal([]byte(startParameters), &params); err == nil {
			if fileIDFloat, ok := params["file_id"].(float64); ok {
				fileID = int64(fileIDFloat)
			}
			// 检查是否有metadata字段
			if metadataStr, ok := params["metadata"].(string); ok {
				metadata = metadataStr
			}
		}
	}

	// 创建任务对象
	job := &RagJob{
		Eid:              eid,
		Type:             jobType,
		Status:           RagJobStatusPending,
		CurrentStepOrder: 0,
		FailureReason:    "",
		StartParameters:  startParameters,
		RelatedId:        fileID, // 设置关联ID为fileID
	}

	// 如果从参数中获取到了metadata，直接使用
	if metadata != "" {
		job.Metadata = metadata
	} else {
		// 否则尝试填充Metadata字段
		if err := f.populateJobMetadata(ctx, job); err != nil {
			// 填充Metadata失败不影响任务创建，只记录日志
			fmt.Printf("Failed to populate metadata for job %d: %v\n", job.JobID, err)
		}
	}

	// 保存任务到数据库
	if err := f.db.Create(job).Error; err != nil {
		return nil, fmt.Errorf("failed to save job to database: %v", err)
	}

	return job, nil
}
