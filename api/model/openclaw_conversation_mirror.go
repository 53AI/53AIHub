package model

import "gorm.io/gorm"

type OpenClawConversationMirror struct {
	ID               int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid              int64  `json:"eid" gorm:"not null;uniqueIndex:uk_openclaw_mirrors_scope,priority:1;index:idx_openclaw_mirrors_list,priority:1"`
	AgentID          int64  `json:"agent_id" gorm:"not null;uniqueIndex:uk_openclaw_mirrors_scope,priority:2;index:idx_openclaw_mirrors_list,priority:2"`
	UserID           int64  `json:"user_id" gorm:"not null;uniqueIndex:uk_openclaw_mirrors_scope,priority:3;index:idx_openclaw_mirrors_list,priority:3"`
	ConversationID   string `json:"conversation_id" gorm:"not null;size:128;uniqueIndex:uk_openclaw_mirrors_scope,priority:4"`
	Title            string `json:"title" gorm:"not null;size:512;default:''"`
	Status           string `json:"status" gorm:"not null;size:64;default:''"`
	ConversationJSON string `json:"conversation_json" gorm:"type:text"`
	MessagesJSON     string `json:"messages_json" gorm:"type:text"`
	EventsJSON       string `json:"events_json" gorm:"type:text"`
	SnapshotJSON     string `json:"snapshot_json" gorm:"type:text"`
	LastSeq          int64  `json:"last_seq" gorm:"not null;default:0"`
	LastSeenTime     int64  `json:"last_seen_time" gorm:"not null;default:0;index:idx_openclaw_mirrors_list,priority:4"`

	BaseModel
}

func IsOpenClawConversationMirrorNotFound(err error) bool {
	return err == gorm.ErrRecordNotFound
}
