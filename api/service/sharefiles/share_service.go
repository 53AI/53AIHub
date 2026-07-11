package sharefiles

import (
	"context"
	"errors"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/shareid"
	"github.com/53AI/53AIHub/model"

	"gorm.io/gorm"
)

var (
	ErrNotFound  = errors.New("sharefiles: not found")
	ErrExpired   = errors.New("sharefiles: expired")
	ErrForbidden = errors.New("sharefiles: forbidden")
)

// Service encapsulates DB and file access checks.
type Service struct {
	db *gorm.DB
	// you may inject additional dependencies (ACL/checkers) here if needed
}

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

// CreateShare creates a share record for a given file and returns the generated share_id.
// It retries on unique conflict up to 3 times.
func (s *Service) CreateShare(ctx context.Context, eid, fileID, shareBy int64, expireAtMs int64) (string, error) {
	const maxRetry = 3
	for i := 0; i < maxRetry; i++ {
		id, err := shareid.Generate()
		if err != nil {
			logger.Errorf(ctx, "CreateShare generate id error: %v", err)
			return "", err
		}
		rec := &model.ShareFile{
			EID:        eid,
			FileID:     fileID,
			ShareBy:    shareBy,
			ShareID:    id,
			ExpireTime: expireAtMs,
		}
		if err := s.db.WithContext(ctx).Create(rec).Error; err != nil {
			// naive unique conflict detection using string contains to avoid driver-specific import;
			// replace with proper error code check if project has utility.
			if isUniqueConflict(err) {
				logger.Warnf(ctx, "CreateShare unique conflict for share_id=%s, retry=%d", id, i+1)
				continue
			}
			logger.Errorf(ctx, "CreateShare db create error: %v", err)
			return "", err
		}
		logger.Infof(ctx, "CreateShare success eid=%d fileID=%d shareBy=%d shareID=%s", eid, fileID, shareBy, rec.ShareID)
		return rec.ShareID, nil
	}
	return "", errors.New("sharefiles: create share failed after retries")
}

// GetShareRecord returns share record by share_id ensuring not expired.
func (s *Service) GetShareRecord(ctx context.Context, shareID string) (*model.ShareFile, error) {
	var rec model.ShareFile
	if err := s.db.WithContext(ctx).Where("share_id = ?", shareID).First(&rec).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	// expiration check: 0 => no expiry; otherwise compare ms
	if rec.ExpireTime != 0 {
		nowMs := time.Now().UnixMilli()
		if nowMs >= rec.ExpireTime {
			return nil, ErrExpired
		}
	}
	return &rec, nil
}

func isUniqueConflict(err error) bool {
	msg := err.Error()
	// common substrings for unique violation across popular DBs
	if contains(msg, "duplicate key") || contains(msg, "UNIQUE constraint failed") || contains(msg, "Duplicate entry") || contains(msg, "unique constraint") {
		return true
	}
	return false
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (func() bool {
		// simple substring search
		return indexOf(s, sub) >= 0
	})()
}

func indexOf(s, sub string) int {
	// naive indexOf to avoid importing strings, keep deps minimal
outer:
	for i := 0; i+len(sub) <= len(s); i++ {
		for j := 0; j < len(sub); j++ {
			if s[i+j] != sub[j] {
				continue outer
			}
		}
		return i
	}
	return -1
}
