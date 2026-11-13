package service

import (
	"errors"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// 不稳定的职位称呼只能在本场会议中归一，不能跨会议按相同文字合并。
func recordingMemoryAmbiguousTitle(name string) bool {
	chars := []rune(strings.TrimSpace(name))
	if len(chars) < 2 || len(chars) > 5 {
		return false
	}
	for _, suffix := range []string{"总", "经理", "老师", "主任", "总监", "博士", "教授", "工", "董"} {
		if strings.HasSuffix(name, suffix) {
			return true
		}
	}
	return false
}

func recordingMemoryMentionKey(fileID int64, item recordingEntityMemoryItem) string {
	name := item.canonicalName
	if item.mentionOnlyName || item.entityType == "person" && recordingMemoryAmbiguousTitle(name) {
		name = fmt.Sprintf("mention:%d:%s", fileID, name)
		if discriminator := strings.TrimSpace(item.attributes[recordingEntityIdentityDiscriminator]); discriminator != "" {
			name += ":" + discriminator
		}
	}
	return normalizeRecordingMemoryEntityName(name)
}

// 在同会议人工确认过的绑定只能复用现有活跃主体，不能因失效而重新造出来源卡。
var errRecordingMemoryBindingRetired = errors.New("recording memory identity binding target was deleted")

func findRecordingMemoryBoundEntity(tx *gorm.DB, eid, ownerID, fileID int64, typ, key string) (*model.RecordingMemoryEntity, bool, error) {
	if fileID <= 0 {
		return nil, false, nil
	}
	var binding model.RecordingMemoryEntityBinding
	err := tx.Where("eid = ? AND owner_id = ? AND file_id = ? AND entity_type = ? AND mention_key = ?", eid, ownerID, fileID, typ, key).First(&binding).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	var target model.RecordingMemoryEntity
	err = tx.Where("eid = ? AND owner_id = ? AND id = ? AND is_deleted = ? AND merged_into_id = ?", eid, ownerID, binding.EntityID, false, 0).First(&target).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, true, errRecordingMemoryBindingRetired
	}
	return &target, true, err
}

func saveRecordingMemoryEntityBinding(tx *gorm.DB, eid, ownerID, fileID int64, typ, key, mention string, entityID int64, source string) error {
	if fileID <= 0 {
		return nil
	}
	var binding model.RecordingMemoryEntityBinding
	err := tx.Where("eid = ? AND owner_id = ? AND file_id = ? AND entity_type = ? AND mention_key = ?", eid, ownerID, fileID, typ, key).First(&binding).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return tx.Create(&model.RecordingMemoryEntityBinding{Eid: eid, OwnerID: ownerID, FileID: fileID, EntityType: typ, MentionKey: key, Mention: mention, EntityID: entityID, Source: source}).Error
	}
	if err != nil {
		return err
	}
	// 用户确认的同会议身份不能被自动编译重写。
	if binding.Source == "confirmed" && source != "confirmed" {
		return nil
	}
	return tx.Model(&binding).Updates(map[string]interface{}{"entity_id": entityID, "source": source}).Error
}

// 合并时把历史来源事实对应的会议固定到目标，同时迁移已有绑定。
// 仅源事实拥有 file_id 的会议受影响，其他会议同名称仍可重新出现。
func redirectRecordingMemoryBindingsOnMerge(tx *gorm.DB, eid, ownerID int64, source model.RecordingMemoryEntity, facts []model.RecordingMemoryFact, targetID int64, sourceKind string) error {
	var bound []model.RecordingMemoryEntityBinding
	if err := tx.Where("eid = ? AND owner_id = ? AND entity_id = ?", eid, ownerID, source.ID).Find(&bound).Error; err != nil {
		return err
	}
	alreadyBound := make(map[int64]bool, len(bound))
	for _, b := range bound {
		alreadyBound[b.FileID] = true
	}
	// 存量泛称实体可能混有多场会议的不同人，不能凭一次合并为全部会议推定身份。
	legacyFiles := map[int64]bool{}
	for _, f := range facts {
		if f.FileID > 0 {
			legacyFiles[f.FileID] = true
		}
	}
	unsafeUnboundTitle := source.EntityType == "person" && recordingMemoryAmbiguousTitle(source.CanonicalName) && len(legacyFiles) > 1
	seen := map[int64]bool{}
	for _, fact := range facts {
		if fact.FileID <= 0 || seen[fact.FileID] || alreadyBound[fact.FileID] || unsafeUnboundTitle {
			continue
		}
		seen[fact.FileID] = true
		item := recordingEntityMemoryItem{entityType: source.EntityType, canonicalName: source.CanonicalName}
		if source.EntityType == "person" && recordingMemoryAmbiguousTitle(source.CanonicalName) {
			item.mentionOnlyName = true
		}
		if err := saveRecordingMemoryEntityBinding(tx, eid, ownerID, fact.FileID, source.EntityType, recordingMemoryMentionKey(fact.FileID, item), source.CanonicalName, targetID, sourceKind); err != nil {
			return err
		}
	}
	updates := map[string]interface{}{"entity_id": targetID}
	// 自动同名归并不推翻用户已经确认的身份来源优先级。
	if sourceKind == "confirmed" {
		updates["source"] = sourceKind
	}
	return tx.Model(&model.RecordingMemoryEntityBinding{}).
		Where("eid = ? AND owner_id = ? AND entity_id = ?", eid, ownerID, source.ID).
		Updates(updates).Error
}

// 人工确认过的会内归属不得被源纪要自动摘要/属性再次覆盖。
func isRecordingMemoryBindingConfirmed(tx *gorm.DB, eid, ownerID, fileID int64, typ, key string) (bool, error) {
	var row model.RecordingMemoryEntityBinding
	err := tx.Where("eid = ? AND owner_id = ? AND file_id = ? AND entity_type = ? AND mention_key = ?", eid, ownerID, fileID, typ, key).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	return row.Source == "confirmed", err
}
