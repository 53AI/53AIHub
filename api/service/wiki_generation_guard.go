package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

var ErrWikiGenerationCancelled = fmt.Errorf("%w: wiki generation cancelled", model.ErrJobCancelled)

type wikiFileGenerationGuard func(context.Context, *gorm.DB) error

func newWikiFileGenerationGuard(db *gorm.DB, eid, fileID int64) wikiFileGenerationGuard {
	return func(ctx context.Context, tx *gorm.DB) error {
		if tx == nil {
			tx = db
		}
		if tx == nil {
			return fmt.Errorf("wiki generation guard database is nil")
		}

		var file model.File
		if err := tx.WithContext(ctx).
			Where("eid = ? AND id = ? AND is_deleted = ?", eid, fileID, false).
			First(&file).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return fmt.Errorf("%w: file_id=%d", ErrWikiGenerationCancelled, fileID)
			}
			return fmt.Errorf("check wiki source file: %w", err)
		}

		if common.IsRedisEnabled() && common.RDB != nil {
			if err := common.CheckRagTaskStop(file.LibraryID, fileID); err != nil {
				return fmt.Errorf("%w: %v", ErrWikiGenerationCancelled, err)
			}
		}
		return nil
	}
}
