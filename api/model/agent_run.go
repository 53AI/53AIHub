package model

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"gorm.io/gorm"
)

const (
	AgentRunStatusQueued         = "queued"
	AgentRunStatusRunning        = "running"
	AgentRunStatusRequiresAction = "requires_action"
	AgentRunStatusCancelling     = "cancelling"
	AgentRunStatusCompleted      = "completed"
	AgentRunStatusFailed         = "failed"
	AgentRunStatusCancelled      = "cancelled"
)

type AgentRun struct {
	ID                int64  `json:"id" gorm:"column:id;primaryKey;autoIncrement"`
	RunID             string `json:"run_id" gorm:"column:run_id;size:64;not null;index:idx_agent_runs_run_id,unique"`
	Eid               int64  `json:"eid" gorm:"column:eid;not null;index:idx_agent_runs_eid_status,priority:1;index:idx_agent_runs_eid_request_id,priority:1;index:idx_agent_runs_eid_conversation_id,priority:1"`
	ConversationID    int64  `json:"conversation_id" gorm:"column:conversation_id;not null;default:0;index:idx_agent_runs_eid_conversation_id,priority:2"`
	MessageID         int64  `json:"message_id" gorm:"column:message_id;not null;default:0;index"`
	RequestID         string `json:"request_id" gorm:"column:request_id;size:255;default:'';index:idx_agent_runs_eid_request_id,priority:2"`
	Status            string `json:"status" gorm:"column:status;size:20;not null;default:'queued';index:idx_agent_runs_eid_status,priority:2"`
	CurrentStep       string `json:"current_step" gorm:"column:current_step;size:64;default:''"`
	PartialText       string `json:"partial_text" gorm:"column:partial_text;type:text"`
	ReasoningText     string `json:"reasoning_text" gorm:"column:reasoning_text;type:text"`
	LastEventID       int64  `json:"last_event_id" gorm:"column:last_event_id;not null;default:0"`
	ErrorCode         string `json:"error_code" gorm:"column:error_code;size:64;default:''"`
	ErrorMessage      string `json:"error_message" gorm:"column:error_message;type:text"`
	CancelRequestedAt int64  `json:"cancel_requested_at" gorm:"column:cancel_requested_at;not null;default:0"`
	StartedAt         int64  `json:"started_at" gorm:"column:started_at;not null;default:0"`
	FinishedAt        int64  `json:"finished_at" gorm:"column:finished_at;not null;default:0"`
	BaseModel
}

func (AgentRun) TableName() string {
	return "agent_runs"
}

func CreateAgentRun(run *AgentRun) error {
	if run == nil {
		return fmt.Errorf("agent run is nil")
	}
	if run.RunID == "" {
		generatedRunID, err := GenerateAgentRunID()
		if err != nil {
			return err
		}
		run.RunID = generatedRunID
	}
	if run.Status == "" {
		run.Status = AgentRunStatusQueued
	}
	if run.StartedAt == 0 {
		run.StartedAt = time.Now().UTC().UnixMilli()
	}
	return DB.Create(run).Error
}

func GetAgentRunByRunID(eid int64, runID string) (*AgentRun, error) {
	var run AgentRun
	if err := DB.Where("eid = ? AND run_id = ?", eid, runID).First(&run).Error; err != nil {
		return nil, err
	}
	return &run, nil
}

func GetAgentRunByRequestID(eid int64, requestID string) (*AgentRun, error) {
	var run AgentRun
	if err := DB.Where("eid = ? AND request_id = ?", eid, requestID).Order("id DESC").First(&run).Error; err != nil {
		return nil, err
	}
	return &run, nil
}

func GetLatestAgentRunByConversationID(eid int64, conversationID int64) (*AgentRun, error) {
	var run AgentRun
	if err := DB.Where("eid = ? AND conversation_id = ?", eid, conversationID).Order("id DESC").First(&run).Error; err != nil {
		return nil, err
	}
	return &run, nil
}

func GetAgentRunsByConversationID(eid int64, conversationID int64, limit int, offset int) (int64, []*AgentRun, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	query := DB.Model(&AgentRun{}).Where("eid = ? AND conversation_id = ?", eid, conversationID)

	var count int64
	if err := query.Count(&count).Error; err != nil {
		return 0, nil, err
	}

	var runs []*AgentRun
	if err := query.Order("id DESC").Offset(offset).Limit(limit).Find(&runs).Error; err != nil {
		return 0, nil, err
	}
	return count, runs, nil
}

func GetLatestAgentRunsByConversationIDs(eid int64, conversationIDs []int64) (map[int64]*AgentRun, error) {
	latestRuns := make(map[int64]*AgentRun)
	uniqueConversationIDs := make([]int64, 0, len(conversationIDs))
	seen := make(map[int64]struct{}, len(conversationIDs))
	for _, conversationID := range conversationIDs {
		if conversationID <= 0 {
			continue
		}
		if _, ok := seen[conversationID]; ok {
			continue
		}
		seen[conversationID] = struct{}{}
		uniqueConversationIDs = append(uniqueConversationIDs, conversationID)
	}
	if len(uniqueConversationIDs) == 0 {
		return latestRuns, nil
	}

	subQuery := DB.Model(&AgentRun{}).
		Select("conversation_id, MAX(id) AS max_id").
		Where("eid = ? AND conversation_id IN ?", eid, uniqueConversationIDs).
		Group("conversation_id")

	var runs []*AgentRun
	if err := DB.Table("agent_runs AS ar").
		Select("ar.*").
		Joins("JOIN (?) AS latest ON ar.conversation_id = latest.conversation_id AND ar.id = latest.max_id", subQuery).
		Where("ar.eid = ? AND ar.conversation_id IN ?", eid, uniqueConversationIDs).
		Order("ar.conversation_id ASC").
		Find(&runs).Error; err != nil {
		return nil, err
	}

	for _, run := range runs {
		if run == nil {
			continue
		}
		latestRuns[run.ConversationID] = run
	}
	return latestRuns, nil
}

func UpdateAgentRunByRunID(eid int64, runID string, updates map[string]interface{}) error {
	return UpdateAgentRunByRunIDWithDB(DB, eid, runID, updates)
}

func UpdateAgentRunByRunIDWithDB(db *gorm.DB, eid int64, runID string, updates map[string]interface{}) error {
	if len(updates) == 0 {
		return nil
	}
	result := db.Model(&AgentRun{}).
		Where("eid = ? AND run_id = ?", eid, runID).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("agent run not found: eid=%d run_id=%s", eid, runID)
	}
	return nil
}

func GenerateAgentRunID() (string, error) {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", fmt.Errorf("generate agent run id failed: %w", err)
	}
	return "run_" + hex.EncodeToString(buf[:]), nil
}
