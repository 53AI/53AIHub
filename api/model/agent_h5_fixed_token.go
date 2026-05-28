package model

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

var (
	ErrAgentAccessKeyNotFound   = errors.New("agent access key not found")
	ErrAgentAccessKeyExpired    = errors.New("agent access key expired")
	ErrAgentAccessKeyDuplicated = errors.New("agent access key duplicated")
)

type AgentAccessKey struct {
	ID        int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid       int64  `json:"eid" gorm:"not null;index:idx_agent_access_keys_lookup,priority:1;index:idx_agent_access_keys_expires_at,priority:1;uniqueIndex:uk_agent_access_key_pair,priority:1"`
	AgentID   int64  `json:"agent_id" gorm:"not null;index:idx_agent_access_keys_lookup,priority:2;uniqueIndex:uk_agent_access_key_pair,priority:2"`
	Source    string `json:"source" gorm:"size:64;not null;index:idx_agent_access_keys_lookup,priority:3"`
	Token     string `json:"token" gorm:"size:64;not null;uniqueIndex"`
	ExpiresAt int64  `json:"expires_at" gorm:"not null;index:idx_agent_access_keys_expires_at,priority:2"`
	BaseModel
}

func CreateAgentAccessKey(eid, agentID int64, source string, ttl time.Duration) (*AgentAccessKey, error) {
	if eid <= 0 {
		return nil, fmt.Errorf("eid is required")
	}
	if agentID <= 0 {
		return nil, fmt.Errorf("agent_id is required")
	}

	source = strings.TrimSpace(source)
	if source == "" {
		source = "h5"
	}

	if err := DeleteAgentAccessKeyByPair(eid, agentID); err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	expiresAt := int64(0)
	if ttl > 0 {
		expiresAt = now.Add(ttl).UnixMilli()
	}

	for attempt := 0; attempt < 5; attempt++ {
		tokenValue, err := generateAgentAccessKeyValue()
		if err != nil {
			return nil, err
		}

		record := &AgentAccessKey{
			Eid:       eid,
			AgentID:   agentID,
			Source:    source,
			Token:     tokenValue,
			ExpiresAt: expiresAt,
		}
		if err := DB.Create(record).Error; err != nil {
			if isUniqueTokenConflict(err) {
				continue
			}
			return nil, err
		}
		return record, nil
	}

	return nil, ErrAgentAccessKeyDuplicated
}

func GetAgentAccessKeyByToken(token string) (*AgentAccessKey, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, ErrAgentAccessKeyNotFound
	}

	var record AgentAccessKey
	if err := DB.Where("token = ?", token).First(&record).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

func DeleteAgentAccessKeyByToken(token string) (bool, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return false, ErrAgentAccessKeyNotFound
	}

	result := DB.Where("token = ?", token).Delete(&AgentAccessKey{})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
}

func DeleteAgentAccessKeyByPair(eid, agentID int64) error {
	if eid <= 0 || agentID <= 0 {
		return nil
	}
	return DB.Where("eid = ? AND agent_id = ?", eid, agentID).Delete(&AgentAccessKey{}).Error
}

func ValidateAgentAccessKey(token string) (*AgentAccessKey, error) {
	record, err := GetAgentAccessKeyByToken(token)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAgentAccessKeyNotFound
		}
		return nil, err
	}

	now := time.Now().UTC().UnixMilli()
	if record.ExpiresAt > 0 && now >= record.ExpiresAt {
		_ = DB.Delete(&AgentAccessKey{}, record.ID).Error
		return nil, ErrAgentAccessKeyExpired
	}

	if _, err := GetAgentByID(record.Eid, record.AgentID); err != nil {
		return nil, fmt.Errorf("agent not found in agents table: eid=%d, agent_id=%d: %w", record.Eid, record.AgentID, err)
	}

	return record, nil
}

func generateAgentAccessKeyValue() (string, error) {
	var buf [32]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	return strings.TrimRight(base64.RawURLEncoding.EncodeToString(buf[:]), "="), nil
}

func GetAgentAccessKeyList(eid int64, agentID int64, offset, limit int) (int64, []*AgentAccessKey, error) {
	if eid <= 0 {
		return 0, nil, fmt.Errorf("eid is required")
	}

	db := DB.Model(&AgentAccessKey{}).Where("eid = ?", eid)

	if agentID > 0 {
		db = db.Where("agent_id = ?", agentID)
	}

	var total int64
	if err := db.Count(&total).Error; err != nil {
		return 0, nil, err
	}

	var records []*AgentAccessKey
	if err := db.Order("created_time DESC").Offset(offset).Limit(limit).Find(&records).Error; err != nil {
		return 0, nil, err
	}

	return total, records, nil
}
