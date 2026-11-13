package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 仅纪要阶段写入版本标记；同一原始会议的洞察版本不参与记忆版本。
func recordingMemoryCompilationSourceHash(eid, fileID int64) (string, error) {
	minutes, _, err := loadRecordingEntityMemorySource(eid, fileID)
	if err != nil {
		return "", err
	}
	transcript, err := loadRecordingEntityMemoryTranscript(eid, fileID)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(minutes + "\x00" + transcript))
	return hex.EncodeToString(sum[:]), nil
}

// 编译成功后只更新 File 已有的进度 JSON。与纪要/洞察状态更新共用行锁，避免覆盖。
func markRecordingMemoryCompiled(ctx context.Context, eid, fileID, ownerID int64) error {
	hash, err := recordingMemoryCompilationSourceHash(eid, fileID)
	if err != nil {
		return err
	}
	return model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var file model.File
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("eid = ? AND id = ? AND user_id = ?", eid, fileID, ownerID).Select("id", "cleaning_rule_info").First(&file).Error; err != nil {
			return err
		}
		var info model.FileCleaningRuleInfo
		if file.CleaningRuleInfo != "" {
			if err := json.Unmarshal([]byte(file.CleaningRuleInfo), &info); err != nil {
				return fmt.Errorf("parse file memory compilation status: %w", err)
			}
		}
		info.RecordingMemorySourceHash = hash
		data, err := json.Marshal(info)
		if err != nil {
			return err
		}
		return tx.Model(&model.File{}).Where("eid = ? AND id = ?", eid, fileID).Update("cleaning_rule_info", string(data)).Error
	})
}

func recordingMemoryCompilationCurrent(ctx context.Context, eid, fileID, ownerID int64) (bool, error) {
	hash, err := recordingMemoryCompilationSourceHash(eid, fileID)
	if err != nil {
		return false, err
	}
	var file model.File
	if err := model.DB.WithContext(ctx).Where("eid = ? AND id = ? AND user_id = ?", eid, fileID, ownerID).Select("cleaning_rule_info").First(&file).Error; err != nil {
		return false, err
	}
	if file.CleaningRuleInfo == "" {
		return false, nil
	}
	var info model.FileCleaningRuleInfo
	if err := json.Unmarshal([]byte(file.CleaningRuleInfo), &info); err != nil {
		return false, fmt.Errorf("parse file memory compilation status: %w", err)
	}
	return info.RecordingMemorySourceHash != "" && info.RecordingMemorySourceHash == hash, nil
}
