package model

import (
	"errors"
	"sort"
	"time"

	"github.com/53AI/53AIHub/common/logger"
)

// ErrShortcutNotFound 快捷记录不存在
var ErrShortcutNotFound = errors.New("shortcut not found")

// UserAgentShortcut 用户快捷 Agent 记录
// 表名：user_agent_shortcuts
type UserAgentShortcut struct {
	ID                 int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	EID                int64  `json:"eid" gorm:"column:eid;not null;index"`
	UserID             int64  `json:"user_id" gorm:"column:user_id;not null;uniqueIndex:idx_uas_user_agent"`
	AgentID            int64  `json:"agent_id" gorm:"column:agent_id;not null;uniqueIndex:idx_uas_user_agent"`
	IsPinned           bool   `json:"is_pinned" gorm:"column:is_pinned;default:false"`
	LastMessageTime    int64  `json:"last_message_time" gorm:"column:last_message_time;default:0"`
	LastMessageContent string `json:"last_message_content" gorm:"column:last_message_content;type:text"`
	BaseModel
}

// UserAgentShortcutResponse 快捷列表响应结构
type UserAgentShortcutResponse struct {
	ID                 int64  `json:"id"`
	AgentID            int64  `json:"agent_id"`
	IsPinned           bool   `json:"is_pinned"`
	LastMessageTime    int64  `json:"last_message_time"`
	LastMessageContent string `json:"last_message_content"`
	AgentName          string `json:"agent_name"`
	AgentLogo          string `json:"agent_logo"`
	AgentDescription   string `json:"agent_description"`
	AgentUsage         int    `json:"agent_usage"`
	IsSystem           bool   `json:"is_system"`
	ChannelType        int    `json:"channel_type"`
	CreatedTime        int64  `json:"created_time"`
	UpdatedTime        int64  `json:"updated_time"`
}

// CreateUserAgentShortcut 添加快捷（手动添加）
func CreateUserAgentShortcut(eid, userID, agentID int64) (*UserAgentShortcut, error) {
	shortcut := &UserAgentShortcut{
		EID:                eid,
		UserID:             userID,
		AgentID:            agentID,
		IsPinned:           false,
		LastMessageTime:    time.Now().UTC().UnixMilli(),
		LastMessageContent: "",
	}
	err := DB.Where("eid = ? AND user_id = ? AND agent_id = ?", eid, userID, agentID).
		FirstOrCreate(shortcut).Error
	if err != nil {
		return nil, err
	}
	return shortcut, nil
}

// AddOrUpdateUserAgentShortcut 聊天后更新快捷 Agent 的最近消息
// content 策略：客户端发消息时传入用户问题，agent 回复后传入 agent 回答（始终取最新消息）
// 无论手动添加还是默认 agent，只要有 shortcut 记录就会更新
func AddOrUpdateUserAgentShortcut(eid, userID, agentID int64, content string) error {
	return AddOrUpdateUserAgentShortcutAt(eid, userID, agentID, content, time.Now().UTC().UnixMilli())
}

func AddOrUpdateUserAgentShortcutAt(eid, userID, agentID int64, content string, lastMessageTime int64) error {
	if lastMessageTime <= 0 {
		lastMessageTime = time.Now().UTC().UnixMilli()
	}
	result := DB.Model(&UserAgentShortcut{}).
		Where("eid = ? AND user_id = ? AND agent_id = ?", eid, userID, agentID).
		Updates(map[string]interface{}{
			"last_message_time":    lastMessageTime,
			"last_message_content": content,
		})
	if result.Error != nil {
		return result.Error
	}
	return nil
}

func ClearUserAgentShortcutLastMessage(eid, userID, agentID int64) error {
	result := DB.Model(&UserAgentShortcut{}).
		Where("eid = ? AND user_id = ? AND agent_id = ?", eid, userID, agentID).
		Updates(map[string]interface{}{
			"last_message_time":    0,
			"last_message_content": "",
		})
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// DeleteUserAgentShortcut 移除快捷（仅移除 user_agent_shortcuts 记录，不影响 agents 表）
func DeleteUserAgentShortcut(eid, userID, agentID int64) error {
	result := DB.Where("eid = ? AND user_id = ? AND agent_id = ?", eid, userID, agentID).
		Delete(&UserAgentShortcut{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrShortcutNotFound
	}
	return nil
}

// DeleteUserAgentShortcutsByAgentID agent 被删除时级联清理其快捷记录
func DeleteUserAgentShortcutsByAgentID(eid, agentID int64) error {
	return DB.Where("eid = ? AND agent_id = ?", eid, agentID).
		Delete(&UserAgentShortcut{}).Error
}

// QueryUserAgentShortcutIDs 查询用户已添加的快捷 agentID 列表
// 包含手动添加与默认内置 agent 的 shortcut，返回原始 int64
func QueryUserAgentShortcutIDs(eid, userID int64) ([]int64, error) {
	var ids []int64
	err := DB.Model(&UserAgentShortcut{}).
		Where("eid = ? AND user_id = ?", eid, userID).
		Pluck("agent_id", &ids).Error
	if err != nil {
		return nil, err
	}
	return ids, nil
}

// queryUserShortcuts 查询用户已添加的快捷记录
func queryUserShortcuts(eid, userID int64) ([]*UserAgentShortcutResponse, error) {
	var results []*UserAgentShortcutResponse
	err := DB.Table("user_agent_shortcuts").
		Select(`user_agent_shortcuts.id, user_agent_shortcuts.agent_id,
			user_agent_shortcuts.is_pinned, user_agent_shortcuts.last_message_time,
			user_agent_shortcuts.last_message_content,
			agents.name AS agent_name, agents.logo AS agent_logo,
			agents.description AS agent_description, agents.agent_usage,
			agents.is_system,
			agents.channel_type,
			user_agent_shortcuts.created_time, user_agent_shortcuts.updated_time`).
		Joins("LEFT JOIN agents ON agents.agent_id = user_agent_shortcuts.agent_id").
		Where("user_agent_shortcuts.eid = ? AND user_agent_shortcuts.user_id = ?", eid, userID).
		// 过滤 agent 已被物理删除的记录
		Where("agents.agent_id IS NOT NULL").
		Find(&results).Error
	return results, err
}

// ensureDefaultAgentShortcuts 确保默认 agent 有 shortcut 记录（幂等，仅首次执行懒初始化）
// 仅初始化 AgentUsageSearch（AI 搜问）且 is_system=1 的 agent
func ensureDefaultAgentShortcuts(eid, userID int64) error {
	// 先快速检查：所有默认 agent 是否已有 shortcut
	var missingCount int64
	DB.Table("agents").
		Where("eid = ? AND owner_id = ? AND agent_usage = ? AND is_system = ?", eid, 0, AgentUsageSearch, true).
		Where("NOT EXISTS (SELECT 1 FROM user_agent_shortcuts WHERE agent_id = agents.agent_id AND user_id = ?)", userID).
		Count(&missingCount)
	if missingCount == 0 {
		return nil
	}

	var defaultAgents []struct {
		AgentID    int64
		AgentUsage int
	}
	err := DB.Table("agents").
		Select("agent_id, agent_usage").
		Where("eid = ? AND owner_id = ? AND agent_usage = ? AND is_system = ?", eid, 0, AgentUsageSearch, true).
		Where("NOT EXISTS (SELECT 1 FROM user_agent_shortcuts WHERE agent_id = agents.agent_id AND user_id = ?)", userID).
		Find(&defaultAgents).Error
	if err != nil || len(defaultAgents) == 0 {
		return err
	}

	for _, a := range defaultAgents {
		// 查一次用户在该 agent 的最新消息时间（仅初始化时，后续靠 AddOrUpdateUserAgentShortcut 维护）
		var lastTime int64
		DB.Model(&Message{}).
			Select("COALESCE(MAX(created_time), 0)").
			Where("agent_id = ? AND user_id = ?", a.AgentID, userID).
			Find(&lastTime)

		shortcut := &UserAgentShortcut{
			EID:                eid,
			UserID:             userID,
			AgentID:            a.AgentID,
			IsPinned:           false,
			LastMessageTime:    lastTime,
			LastMessageContent: "",
		}
		// 幂等创建：仅首次插入
		if err := DB.Where("eid = ? AND user_id = ? AND agent_id = ?", eid, userID, a.AgentID).
			FirstOrCreate(shortcut).Error; err != nil {
			logger.SysErrorf("init default agent shortcut failed: eid=%d user=%d agent=%d err=%v", eid, userID, a.AgentID, err)
		}
	}
	return nil
}

// GetUserAgentShortcuts 获取快捷列表（含默认内置 agent）
// 首次请求时自动初始化默认 agent 的 shortcut，后续走冗余字段，无需联表 messages
func GetUserAgentShortcuts(eid, userID int64) ([]*UserAgentShortcutResponse, error) {
	// 懒初始化：确保默认 agent 已有 shortcut 记录（幂等）
	if err := ensureDefaultAgentShortcuts(eid, userID); err != nil {
		return nil, err
	}

	shortcuts, err := queryUserShortcuts(eid, userID)
	if err != nil {
		return nil, err
	}

	sort.Slice(shortcuts, func(i, j int) bool {
		if shortcuts[i].IsPinned != shortcuts[j].IsPinned {
			return shortcuts[i].IsPinned // 置顶优先
		}
		return shortcuts[i].LastMessageTime > shortcuts[j].LastMessageTime // 最新消息优先
	})
	return shortcuts, nil
}

// UpdateUserAgentShortcutPin 置顶/取消置顶
func UpdateUserAgentShortcutPin(eid, userID, agentID int64, isPinned bool) error {
	result := DB.Model(&UserAgentShortcut{}).
		Where("eid = ? AND user_id = ? AND agent_id = ?", eid, userID, agentID).
		Update("is_pinned", isPinned)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrShortcutNotFound
	}
	return nil
}
