package keystone

import "time"

// TaskStatus 任务状态枚举，与 Keystone business_tasks 表一致
type TaskStatus string

const (
	TaskStatusPending   TaskStatus = "PENDING"
	TaskStatusRunning   TaskStatus = "RUNNING"
	TaskStatusSucceeded TaskStatus = "SUCCEEDED"
	TaskStatusFailed    TaskStatus = "FAILED"
	TaskStatusTimeout   TaskStatus = "TIMEOUT"
	TaskStatusCancelled TaskStatus = "CANCELLED"
)

// TaskEvent 业务任务事件，上报到 Keystone /api/v1/webhooks/business-tasks
type TaskEvent struct {
	Source         string            `json:"source"`
	ExternalTaskID string            `json:"externalTaskId"`
	ProductKey     string            `json:"productKey,omitempty"`
	ServiceKey     string            `json:"serviceKey,omitempty"`
	EnvironmentKey string            `json:"environmentKey,omitempty"`
	TaskType       string            `json:"taskType"`
	Status         TaskStatus        `json:"status"`
	StageKey       string            `json:"stageKey,omitempty"`
	StageStatus    TaskStatus        `json:"stageStatus,omitempty"`
	TraceID        string            `json:"traceId,omitempty"`
	FailureCode    string            `json:"failureCode,omitempty"`
	FailureMessage string            `json:"failureMessage,omitempty"`
	HeartbeatAt    time.Time         `json:"heartbeatAt,omitempty"`
	StartedAt      time.Time         `json:"startedAt,omitempty"`
	FinishedAt     time.Time         `json:"finishedAt,omitempty"`
	Metadata       map[string]string `json:"metadata,omitempty"`
}

// ChangeEvent 变更事件，上报到 Keystone /api/v1/webhooks/change-events
type ChangeEvent struct {
	Source          string            `json:"source"`
	ExternalEventID string            `json:"externalEventId"`
	Type            string            `json:"type"`
	ProductKey      string            `json:"productKey,omitempty"`
	ServiceKey      string            `json:"serviceKey,omitempty"`
	EnvironmentKey  string            `json:"environmentKey,omitempty"`
	VersionBefore   string            `json:"versionBefore,omitempty"`
	VersionAfter    string            `json:"versionAfter,omitempty"`
	Summary         string            `json:"summary"`
	ExternalURL     string            `json:"externalUrl,omitempty"`
	OccurredAt      time.Time         `json:"occurredAt"`
	Metadata        map[string]string `json:"metadata,omitempty"`
}

// BatchRequest 批量上报请求体
type BatchRequest struct {
	Events []TaskEvent `json:"events"`
}