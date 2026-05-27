package model

import (
	"errors"
)

// Feedback represents user feedback on messages (satisfied/unsatisfied)
type Feedback struct {
	ID           int64    `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid          int64    `json:"eid" gorm:"index:idx_feedback_search,priority:1;not null"`
	AgentID      int64    `json:"agent_id" gorm:"index;not null"`
	MessageID    int64    `json:"message_id" gorm:"index;not null"`
	UserID       int64    `json:"user_id" gorm:"index:idx_feedback_search,priority:2;not null"`
	FeedbackType string   `json:"feedback_type" gorm:"size:20;index:idx_feedback_search,priority:3;not null"` // satisfied, unsatisfied
	Question     string   `json:"question" gorm:"type:text"`                                                           // 问题内容，用于搜索
	Reason       string   `json:"reason" gorm:"size:100"`
	Description  string   `json:"description" gorm:"type:text"`
	MessageInfo  *Message `json:"message_info,omitempty" gorm:"-"` // 消息信息
	UserInfo     *User    `json:"user_info,omitempty" gorm:"-"`    // 用户信息
	BaseModel
}

const (
	FeedbackTypeSatisfied   = "satisfied"
	FeedbackTypeUnsatisfied = "unsatisfied"
)

// TableName sets the table name for the Feedback model
func (Feedback) TableName() string {
	return "feedbacks"
}

// Validate checks if the feedback data is valid
func (f *Feedback) Validate() error {
	if f.Eid <= 0 {
		return errors.New("eid is required")
	}
	if f.MessageID <= 0 {
		return errors.New("message_id is required")
	}
	if f.UserID <= 0 {
		return errors.New("user_id is required")
	}
	// FeedbackType 可以是 satisfied, unsatisfied
	if f.FeedbackType == "" {
		return errors.New("feedback_type is required")
	}
	return nil
}

// CreateFeedback creates a new feedback record
func CreateFeedback(feedback *Feedback) error {
	if err := feedback.Validate(); err != nil {
		return err
	}
	return DB.Create(feedback).Error
}

// GetFeedbackByID retrieves a feedback by its ID
func GetFeedbackByID(id int64) (*Feedback, error) {
	var feedback Feedback
	err := DB.First(&feedback, id).Error
	if err != nil {
		return nil, err
	}
	return &feedback, nil
}

// LoadUserInfo 根据 user_id 获取 name
func (f *Feedback) LoadUserInfo() error {
	if f.UserID <= 0 {
		return errors.New("invalid user_id")
	}

	user, err := GetUserByID(f.UserID)
	if err != nil {
		return err
	}

	f.UserInfo = user
	return nil
}

// UpdateFeedback updates an existing feedback
func UpdateFeedback(feedback *Feedback) error {
	if err := feedback.Validate(); err != nil {
		return err
	}
	return DB.Save(feedback).Error
}

// DeleteFeedback deletes a feedback by its ID
func DeleteFeedback(id int64) error {
	return DB.Delete(&Feedback{}, id).Error
}

// LoadMessageInfo 根据 message_id 获取 model
func (f *Feedback) LoadMessageInfo() error {
	if f.MessageID <= 0 {
		return errors.New("invalid message_id")
	}

	message, err := GetMessageByID(f.Eid, f.MessageID)
	if err != nil {
		return err
	}

	f.MessageInfo = message
	return nil
}

// GetFeedbackByMessageAndUser retrieves a feedback by message ID and user ID
func GetFeedbackByMessageAndUser(eid, messageID, userID int64) (*Feedback, error) {
	var feedback Feedback
	err := DB.Where("eid = ? AND message_id = ? AND user_id = ?", eid, messageID, userID).First(&feedback).Error
	if err != nil {
		return nil, err
	}
	return &feedback, nil
}

// GetFeedbackStats returns statistics for a message
type FeedbackStats struct {
	MessageID        int64 `json:"message_id"`
	SatisfiedCount   int64 `json:"satisfied_count"`
	UnsatisfiedCount int64 `json:"unsatisfied_count"`
}

// EnterpriseFeedbackStats represents feedback statistics for an enterprise
type EnterpriseFeedbackStats struct {
	SatisfiedCount   int64 `json:"satisfied_count"`
	UnsatisfiedCount int64 `json:"unsatisfied_count"`
}

// GetFeedbackStatsByMessageID returns feedback statistics for a message
func GetFeedbackStatsByMessageID(eid, messageID int64) (*FeedbackStats, error) {
	stats := &FeedbackStats{MessageID: messageID}

	// Count satisfied
	DB.Model(&Feedback{}).Where("eid = ? AND message_id = ? AND feedback_type = ?", eid, messageID, FeedbackTypeSatisfied).Count(&stats.SatisfiedCount)

	// Count unsatisfied
	DB.Model(&Feedback{}).Where("eid = ? AND message_id = ? AND feedback_type = ?", eid, messageID, FeedbackTypeUnsatisfied).Count(&stats.UnsatisfiedCount)

	return stats, nil
}

// GetEnterpriseFeedbackStats returns feedback statistics for an entire enterprise
func GetEnterpriseFeedbackStats(eid, startTime, endTime int64, agentID *int64) (*EnterpriseFeedbackStats, error) {
	stats := &EnterpriseFeedbackStats{}

	// Count satisfied - 创建完全独立的查询对象
	satisfiedQuery := DB.Model(&Feedback{}).Where("eid = ?", eid)
	if startTime > 0 {
		satisfiedQuery = satisfiedQuery.Where("created_time >= ?", startTime)
	}
	if endTime > 0 {
		// 将结束时间调整为当天的 23:59:59
		endTime = ((endTime/86400)*86400 + 86399)
		satisfiedQuery = satisfiedQuery.Where("created_time <= ?", endTime)
	}
	if agentID != nil {
		satisfiedQuery = satisfiedQuery.Where("agent_id = ?", *agentID)
	}
	satisfiedQuery = satisfiedQuery.Where("feedback_type = ?", FeedbackTypeSatisfied)
	satisfiedQuery.Count(&stats.SatisfiedCount)

	// Count unsatisfied - 创建完全独立的查询对象
	unsatisfiedQuery := DB.Model(&Feedback{}).Where("eid = ?", eid)
	if startTime > 0 {
		unsatisfiedQuery = unsatisfiedQuery.Where("created_time >= ?", startTime)
	}
	if endTime > 0 {
		// 将结束时间调整为当天的 23:59:59
		endTime = ((endTime/86400)*86400 + 86399)
		unsatisfiedQuery = unsatisfiedQuery.Where("created_time <= ?", endTime)
	}
	if agentID != nil {
		unsatisfiedQuery = unsatisfiedQuery.Where("agent_id = ?", *agentID)
	}
	unsatisfiedQuery = unsatisfiedQuery.Where("feedback_type = ?", FeedbackTypeUnsatisfied)
	unsatisfiedQuery.Count(&stats.UnsatisfiedCount)

	return stats, nil
}

func GetFeedbackConfig(eid int64) (*Setting, error) {
	return GetFeedbackConfigByKey(eid, FeedbackConfigKey)
}

func GetFeedbackConfigByKey(eid int64, key string) (*Setting, error) {
	setting, err := GetSettingByEidAndKey(eid, key)
	if err != nil {
		return nil, err
	}
	if setting == nil {
		return nil, errors.New("feedback config not found")
	}
	return setting, nil
}

// GetFeedbackList retrieves feedback list with optional filters and pagination
func GetFeedbackList(eid, startTime, endTime int64, question, feedbackType, reason string, userID int64, offset, limit int, agentID *int64) (int64, []*Feedback, error) {
	var feedbacks []*Feedback
	var total int64

	db := DB.Model(&Feedback{}).Where("eid = ?", eid)

	// 时间范围过滤
	if startTime > 0 {
		db = db.Where("created_time >= ?", startTime)
	}
	if endTime > 0 {
		// 将结束时间调整为当天的 23:59:59
		endTime = ((endTime/86400)*86400 + 86399)
		db = db.Where("created_time <= ?", endTime)
	}

	// 提问内容过滤
	if question != "" {
		db = db.Where("question LIKE ?", "%"+question+"%")
	}

	// 反馈类型过滤
	if feedbackType != "" {
		db = db.Where("feedback_type = ?", feedbackType)
	}

	// 原因过滤
	if reason != "" {
		db = db.Where("reason LIKE ?", "%"+reason+"%")
	}

	// 用户ID过滤
	if userID > 0 {
		db = db.Where("user_id = ?", userID)
	}

	// Agent ID 过滤
	if agentID != nil {
		db = db.Where("agent_id = ?", *agentID)
	}

	// 获取总数
	if err := db.Count(&total).Error; err != nil {
		return 0, nil, err
	}

	// 分页查询
	if limit <= 0 {
		limit = 10 // 默认每页10条
	}

	if err := db.Order("id DESC").Offset(offset).Limit(limit).Find(&feedbacks).Error; err != nil {
		return 0, nil, err
	}

	return total, feedbacks, nil
}
