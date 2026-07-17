package model

type AuditLog struct {
	ID         int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid        int64  `json:"eid" gorm:"not null;index:idx_audit_logs_eid"`
	AgentID    int64  `json:"agent_id" gorm:"not null;index:idx_audit_logs_agent_id"`
	TokenID    int64  `json:"token_id" gorm:"not null;index:idx_audit_logs_token_id"`
	Method     string `json:"method" gorm:"size:16;not null"`
	Path       string `json:"path" gorm:"size:256;not null"`
	IP         string `json:"ip" gorm:"size:64"`
	StatusCode int    `json:"status_code"`
	LatencyMs  int64  `json:"latency_ms"`
	RequestID  string `json:"request_id" gorm:"size:64;index:idx_audit_logs_request_id"`
	BaseModel
}

func CreateAuditLog(log *AuditLog) error {
	return DB.Create(log).Error
}

func BatchCreateAuditLogs(logs []*AuditLog) error {
	if len(logs) == 0 {
		return nil
	}
	return DB.CreateInBatches(logs, 100).Error
}
