package model

import (
	"errors"

	"gorm.io/gorm"
)

// Record 记忆记录通用接口，支持泛型 Upsert 和 Get 操作。
// AgentUserMemory 和 AgentToolLesson 均实现此接口。
type Record interface {
	Create() error
	Update() error
	TableName() string
	GetEid() int64
	GetAgentID() int64
	GetUserID() int64
	GetID() int64
	GetVersion() int
	SetID(int64)
	SetVersion(int)
}

// UpsertRecord 通用 Upsert：不存在则 Create，存在则复制 ID/Version 后 Update。
// 通过 Record 接口的 TableName() 确定表名，仅查询 id 和 version 两个字段。
func UpsertRecord(record Record) error {
	var existing struct {
		ID      int64
		Version int
	}
	err := DB.Table(record.TableName()).
		Where("eid = ? AND agent_id = ? AND user_id = ?", record.GetEid(), record.GetAgentID(), record.GetUserID()).
		Select("id, version").
		First(&existing).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return record.Create()
		}
		return err
	}
	record.SetID(existing.ID)
	record.SetVersion(existing.Version)
	return record.Update()
}

// GetByEidAgentUser 通用查询：按 (eid, agent_id, user_id) 查询单条记录。
// T 必须是具体 struct 类型（如 AgentUserMemory、AgentToolLesson），GORM 通过 T 确定表名。
// 记录不存在时返回 (nil, nil)。
func GetByEidAgentUser[T any](eid, agentID, userID int64) (*T, error) {
	var m T
	err := DB.Where("eid = ? AND agent_id = ? AND user_id = ?", eid, agentID, userID).First(&m).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}
