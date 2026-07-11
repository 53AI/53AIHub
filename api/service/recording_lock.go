package service

import (
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
)

const (
	recordingLockKeyPrefix = "recording"
	recordingLockTTL        = 5 * time.Minute
)

type RecordingLockType string

const (
	RecordingLockTypeFinalize RecordingLockType = "finalize"
	RecordingLockTypeCleanup  RecordingLockType = "cleanup"
	RecordingLockTypeRecover  RecordingLockType = "recover"
)

type RecordingLockService struct{}

func NewRecordingLockService() *RecordingLockService {
	return &RecordingLockService{}
}

func (s *RecordingLockService) getLockKey(jobID int64, lockType RecordingLockType) string {
	return fmt.Sprintf("%s:%d:%s", recordingLockKeyPrefix, jobID, lockType)
}

func (s *RecordingLockService) TryLock(jobID int64, lockType RecordingLockType) bool {
	if !common.IsRedisEnabled() {
		return true
	}
	key := s.getLockKey(jobID, lockType)
	return common.LOCKER.TryLock(key, recordingLockTTL)
}

func (s *RecordingLockService) TryLockWithTTL(jobID int64, lockType RecordingLockType, ttl time.Duration) bool {
	if !common.IsRedisEnabled() {
		return true
	}
	key := s.getLockKey(jobID, lockType)
	return common.LOCKER.TryLock(key, ttl)
}

func (s *RecordingLockService) Unlock(jobID int64, lockType RecordingLockType) {
	if !common.IsRedisEnabled() {
		return
	}
	key := s.getLockKey(jobID, lockType)
	common.LOCKER.Unlock(key)
}

func (s *RecordingLockService) TryLockFinalize(jobID int64) bool {
	return s.TryLock(jobID, RecordingLockTypeFinalize)
}

func (s *RecordingLockService) UnlockFinalize(jobID int64) {
	s.Unlock(jobID, RecordingLockTypeFinalize)
}

func (s *RecordingLockService) TryLockCleanup(jobID int64) bool {
	return s.TryLock(jobID, RecordingLockTypeCleanup)
}

func (s *RecordingLockService) UnlockCleanup(jobID int64) {
	s.Unlock(jobID, RecordingLockTypeCleanup)
}

func (s *RecordingLockService) TryLockRecover(jobID int64) bool {
	return s.TryLock(jobID, RecordingLockTypeRecover)
}

func (s *RecordingLockService) UnlockRecover(jobID int64) {
	s.Unlock(jobID, RecordingLockTypeRecover)
}
