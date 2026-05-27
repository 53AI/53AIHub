package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ShareRecord struct {
	// 索引说明：
	// - uniq_eid_shareid: (eid, share_id) unique，用于跨企业防冲突、快速按share_id查找
	// - uniq_eid_convid_hash: (eid, conversation_id, normalized_hash) unique，用于同会话下相同消息集合的幂等去重
	ID             int64  `json:"id" gorm:"column:id;primaryKey;autoIncrement"`
	ShareID        string `json:"share_id" gorm:"column:share_id;type:varchar(64);not null;index:uniq_eid_shareid,unique"`
	Eid            int64  `json:"eid" gorm:"column:eid;not null;index:uniq_eid_shareid,unique;index:uniq_eid_convid_hash,unique"`
	ConversationID int64  `json:"conversation_id" gorm:"column:conversation_id;not null;index:uniq_eid_convid_hash,unique"`
	// message_ids 形如 "12,34,57"：对 message_ids 去重+升序后拼接，用于可读性与解析
	MessageIDs     string `json:"message_ids" gorm:"column:message_ids;type:varchar(2048);not null"`
	// normalized_hash: 对规范化后的 message_ids 进行哈希（sha256 hex），用于唯一去重
	NormalizedHash string `json:"normalized_hash" gorm:"column:normalized_hash;size:64;not null;index:uniq_eid_convid_hash,unique"`
	BaseModel
}

func (ShareRecord) TableName() string {
	return "share_records"
}

// NormalizeMessageIDs 去重+升序+拼接，返回 normalized 字符串 与 标准化后的ID切片
func NormalizeMessageIDs(ids []int64) (string, []int64) {
	if len(ids) == 0 {
		return "", []int64{}
	}
	seen := make(map[int64]struct{}, len(ids))
	dedup := make([]int64, 0, len(ids))
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		dedup = append(dedup, id)
	}
	sort.Slice(dedup, func(i, j int) bool { return dedup[i] < dedup[j] })
	parts := make([]string, 0, len(dedup))
	for _, id := range dedup {
		parts = append(parts, fmt.Sprintf("%d", id))
	}
	return strings.Join(parts, ","), dedup
}

// HashNormalizedKey 对规范化后的 key 计算 sha256 hex
func HashNormalizedKey(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:])
}

// ParseMessageIDsToIDs 将规范化后的 message_ids 解析为升序ID数组
func ParseMessageIDsToIDs(key string) ([]int64, error) {
	if strings.TrimSpace(key) == "" {
		return []int64{}, nil
	}
	parts := strings.Split(key, ",")
	out := make([]int64, 0, len(parts))
	for _, p := range parts {
		var id int64
		_, err := fmt.Sscan(p, &id)
		if err != nil {
			return nil, fmt.Errorf("invalid message_ids segment: %s", p)
		}
		out = append(out, id)
	}
	return out, nil
}

// ValidateMessagesBelongToConversation 确认所有消息均属于同一 eid+conversation_id
func ValidateMessagesBelongToConversation(eid, conversationID int64, ids []int64) error {
	if len(ids) == 0 {
		return errors.New("empty message_ids")
	}
	var count int64
	if err := DB.Model(&Message{}).
		Where("eid = ? AND conversation_id = ? AND id IN ?", eid, conversationID, ids).
		Count(&count).Error; err != nil {
		return err
	}
	if count != int64(len(ids)) {
		return errors.New("some message_ids not belong to the conversation or missing")
	}
	return nil
}

// CreateShareRecord 在 (eid, conversation_id, normalized_hash) 唯一范围内创建或复用
// 返回 share_id 与 reused 标识
func CreateShareRecord(eid, conversationID int64, messageIDsNormalized string) (string, bool, error) {
	if messageIDsNormalized == "" {
		return "", false, errors.New("message_ids(normalized) is empty")
	}
	hash := HashNormalizedKey(messageIDsNormalized)

	var existed ShareRecord
	err := DB.Where("eid = ? AND conversation_id = ? AND normalized_hash = ?",
		eid, conversationID, hash).First(&existed).Error
	if err == nil {
		return existed.ShareID, true, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", false, err
	}

	// 不存在则创建
	shareID := uuid.NewString()
	rec := &ShareRecord{
		Eid:            eid,
		ShareID:        shareID,
		ConversationID: conversationID,
		MessageIDs:     messageIDsNormalized,
		NormalizedHash: hash,
	}
	if err := DB.Create(rec).Error; err != nil {
		// 并发场景下唯一键冲突，回查返回已有
		var existed2 ShareRecord
		if qerr := DB.Where("eid = ? AND conversation_id = ? AND normalized_hash = ?",
			eid, conversationID, hash).First(&existed2).Error; qerr == nil {
			return existed2.ShareID, true, nil
		}
		return "", false, err
	}
	return shareID, false, nil
}

func GetShareRecordByShareID(shareID string) (*ShareRecord, error) {
	var rec ShareRecord
	// (eid, share_id) 联合唯一已有；这里按 share_id 查询，若需要隔离可在上层传入 eid 追加过滤
	if err := DB.Where("share_id = ?", shareID).First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

 // GetMessagesByIDsOrderedAsc 按ID批量加载并基于 CreatedTime 升序排序
 func ListMessageIDsByConversation(eid, conversationID int64) ([]int64, error) {
	if conversationID <= 0 {
		return []int64{}, nil
	}
	// 仅选择 id 字段，避免加载大字段
	type row struct{ ID int64 `gorm:"column:id"` }
	var rows []row
	if err := DB.Model(&Message{}).
		Select("id").
		Where("eid = ? AND conversation_id = ?", eid, conversationID).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	return ids, nil
}

func GetMessagesByIDsOrderedAsc(eid int64, ids []int64) ([]*Message, error) {
	if len(ids) == 0 {
		return []*Message{}, nil
	}
	var msgs []*Message
	if err := DB.Where("eid = ? AND id IN ?", eid, ids).Find(&msgs).Error; err != nil {
		return nil, err
	}
	sort.Slice(msgs, func(i, j int) bool {
		return msgs[i].CreatedTime < msgs[j].CreatedTime
	})
	return msgs, nil
}