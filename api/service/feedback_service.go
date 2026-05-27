package service

import (
	"encoding/json"

	"github.com/53AI/53AIHub/model"
)

// FeedbackConfig represents the feedback configuration structure
type FeedbackConfig struct {
	Satisfied   []string `json:"satisfied"`
	Unsatisfied []string `json:"unsatisfied"`
}

const (
	FeedbackConfigTypeMessage      = "message"
	FeedbackConfigTypeKnowledgeMap = "knowledge_map"
	FeedbackConfigTypeWorkAI       = "work_ai"
)

// GetFeedbackConfigByType 根据类型获取反馈配置
func GetFeedbackConfigByType(eid int64, configType string) (*model.Setting, error) {
	key := model.FeedbackConfigKey
	if configType == FeedbackConfigTypeKnowledgeMap {
		key = model.SETTING_KM_FEEDBACK_CONFIG
	} else if configType == FeedbackConfigTypeWorkAI {
		key = model.SETTING_WORKAI_FEEDBACK_CONFIG
	}

	setting, err := model.GetFeedbackConfigByKey(eid, key)
	if err != nil {
		return GetDefaultFeedbackConfigByType(configType), nil
	}

	return setting, nil
}

// GetFeedbackConfig retrieves the feedback configuration from settings
func GetFeedbackConfig(eid int64) (*model.Setting, error) {
	return GetFeedbackConfigByType(eid, FeedbackConfigTypeMessage)
}

// SaveFeedbackConfigByType 根据类型保存反馈配置
func SaveFeedbackConfigByType(eid int64, configType string, config *model.Setting) error {
	key := model.FeedbackConfigKey
	if configType == FeedbackConfigTypeKnowledgeMap {
		key = model.SETTING_KM_FEEDBACK_CONFIG
	} else if configType == FeedbackConfigTypeWorkAI {
		key = model.SETTING_WORKAI_FEEDBACK_CONFIG
	}

	// Try to get existing setting
	setting, err := model.GetSettingByEidAndKey(eid, key)
	if err != nil || setting == nil {
		// If not found, create new setting
		setting = &model.Setting{
			Eid:       eid,
			LibraryID: 0,
			Key:       key,
			Value:     config.Value,
		}
		return model.CreateSetting(setting)
	}

	// If found, update existing setting
	setting.Value = config.Value
	return model.UpdateSetting(setting)
}

// SaveFeedbackConfig saves the feedback configuration to settings
func SaveFeedbackConfig(eid int64, config *model.Setting) error {
	return SaveFeedbackConfigByType(eid, FeedbackConfigTypeMessage, config)
}

// GetDefaultFeedbackConfigByType 返回指定类型的默认反馈配置
func GetDefaultFeedbackConfigByType(configType string) *model.Setting {
	var defaultConfig *FeedbackConfig
	key := model.FeedbackConfigKey

	if configType == FeedbackConfigTypeKnowledgeMap {
		key = model.SETTING_KM_FEEDBACK_CONFIG
		defaultConfig = &FeedbackConfig{
			Satisfied: []string{
				"图表清晰",
				"层级合理",
				"关联准确",
			},
			Unsatisfied: []string{
				"节点缺失",
				"逻辑混乱",
				"样式错乱",
			},
		}
	} else if configType == FeedbackConfigTypeWorkAI {
		key = model.SETTING_WORKAI_FEEDBACK_CONFIG
		defaultConfig = &FeedbackConfig{
			Satisfied: []string{
				"任务完成",
				"结果准确",
				"响应及时",
			},
			Unsatisfied: []string{
				"任务失败",
				"结果错误",
				"响应超时",
			},
		}
	} else {
		defaultConfig = &FeedbackConfig{
			Satisfied: []string{
				"内容准确",
				"全面完整",
				"格式规范",
			},
			Unsatisfied: []string{
				"未理解问题",
				"编造事实",
				"内容不专业",
			},
		}
	}

	// Serialize to JSON
	data, _ := json.Marshal(defaultConfig)

	return &model.Setting{
		Key:   key,
		Value: string(data),
	}
}

// GetDefaultFeedbackConfig returns the default feedback configuration
func GetDefaultFeedbackConfig() *model.Setting {
	return GetDefaultFeedbackConfigByType(FeedbackConfigTypeMessage)
}

// CreateFeedback creates a new feedback record
func CreateFeedback(eid, messageID, userID int64, feedbackType, question, reason, description string) (*model.Feedback, error) {
	// 获取消息信息以获取 agent_id
	message, err := model.GetMessageByID(eid, messageID)
	if err != nil {
		return nil, err
	}

	feedback := &model.Feedback{
		Eid:          eid,
		MessageID:    messageID,
		UserID:       userID,
		AgentID:      message.AgentID, // 从 message 获取 agent_id
		FeedbackType: feedbackType,    // satisfied, unsatisfied
		Question:     question,        // 问题内容，用于搜索
		Reason:       reason,
		Description:  description,
	}

	if err := model.CreateFeedback(feedback); err != nil {
		return nil, err
	}

	return feedback, nil
}

// UpdateFeedback updates an existing feedback record
func UpdateFeedback(id int64, eid int64, feedbackType, question, reason, description string) (*model.Feedback, error) {
	feedback, err := model.GetFeedbackByID(id)
	if err != nil {
		return nil, err
	}

	feedback.Eid = eid
	feedback.FeedbackType = feedbackType
	feedback.Question = question // 问题内容，用于搜索
	feedback.Reason = reason
	feedback.Description = description

	if err := model.UpdateFeedback(feedback); err != nil {
		return nil, err
	}

	return feedback, nil
}

// DeleteFeedback deletes a feedback record
func DeleteFeedback(id int64) error {
	return model.DeleteFeedback(id)
}

// GetFeedbackStats returns feedback statistics for a message
func GetFeedbackStats(eid, messageID int64) (*model.FeedbackStats, error) {
	return model.GetFeedbackStatsByMessageID(eid, messageID)
}

// GetEnterpriseFeedbackStats returns feedback statistics for an entire enterprise
func GetEnterpriseFeedbackStats(eid, startTime, endTime int64, agentID *int64) (*model.EnterpriseFeedbackStats, error) {
	return model.GetEnterpriseFeedbackStats(eid, startTime, endTime, agentID)
}
