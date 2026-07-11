package service

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/go-redis/redis/v8"
)

// FileEditLockInfo Redis中存储的锁信息
type FileEditLockInfo struct {
	UserID    int64  `json:"user_id"`
	UserName  string `json:"user_name"`
	ExpiresAt int64  `json:"expires_at"`
}

// FileEditLockService 文件编辑锁服务
type FileEditLockService struct{}

// NewFileEditLockService 创建文件编辑锁服务实例
func NewFileEditLockService() *FileEditLockService {
	return &FileEditLockService{}
}

// getLockKey 获取锁的Redis key
func (s *FileEditLockService) getLockKey(fileID int64) string {
	return fmt.Sprintf("file:edit:%d", fileID)
}

// TryLock 尝试获取或续期文件编辑锁
// 如果锁不存在，创建新锁
// 如果锁存在且属于当前用户，续期锁
// 如果锁存在但属于其他用户，返回失败
func (s *FileEditLockService) TryLock(fileID int64, userID int64, userName string) (*FileEditLockInfo, error) {
	if !common.IsRedisEnabled() {
		return nil, common.ErrRedisNotEnabled
	}

	lockKey := s.getLockKey(fileID)
	lockDuration := 30 * time.Second
	expiresAt := time.Now().Add(lockDuration).Unix()

	// 尝试获取现有锁信息
	existingLockStr, err := common.RedisGet(lockKey)
	if err != nil && err != redis.Nil {
		logger.SysErrorf("Failed to get file edit lock for file %d: %v", fileID, err)
		return nil, fmt.Errorf("获取锁信息失败")
	}

	// 如果锁不存在，创建新锁
	if err == redis.Nil {
		lockInfo := &FileEditLockInfo{
			UserID:    userID,
			UserName:  userName,
			ExpiresAt: expiresAt,
		}

		lockInfoJSON, err := json.Marshal(lockInfo)
		if err != nil {
			logger.SysErrorf("Failed to marshal lock info for file %d: %v", fileID, err)
			return nil, fmt.Errorf("创建锁信息失败")
		}

		err = common.RedisSet(lockKey, string(lockInfoJSON), lockDuration)
		if err != nil {
			logger.SysErrorf("Failed to set file edit lock for file %d: %v", fileID, err)
			return nil, fmt.Errorf("设置锁失败")
		}

		logger.SysLog(fmt.Sprintf("File edit lock created for file %d by user %d (%s)", fileID, userID, userName))
		return lockInfo, nil
	}

	// 解析现有锁信息
	var existingLock FileEditLockInfo
	err = json.Unmarshal([]byte(existingLockStr), &existingLock)
	if err != nil {
		logger.SysErrorf("Failed to unmarshal existing lock info for file %d: %v", fileID, err)
		return nil, fmt.Errorf("解析锁信息失败")
	}

	// 检查锁是否已过期
	if time.Now().Unix() > existingLock.ExpiresAt {
		// 锁已过期，创建新锁
		lockInfo := &FileEditLockInfo{
			UserID:    userID,
			UserName:  userName,
			ExpiresAt: expiresAt,
		}

		lockInfoJSON, err := json.Marshal(lockInfo)
		if err != nil {
			logger.SysErrorf("Failed to marshal new lock info for file %d: %v", fileID, err)
			return nil, fmt.Errorf("创建锁信息失败")
		}

		err = common.RedisSet(lockKey, string(lockInfoJSON), lockDuration)
		if err != nil {
			logger.SysErrorf("Failed to set new file edit lock for file %d: %v", fileID, err)
			return nil, fmt.Errorf("设置锁失败")
		}

		logger.SysLog(fmt.Sprintf("Expired file edit lock renewed for file %d by user %d (%s)", fileID, userID, userName))
		return lockInfo, nil
	}

	// 如果锁属于当前用户，续期锁
	if existingLock.UserID == userID {
		lockInfo := &FileEditLockInfo{
			UserID:    userID,
			UserName:  userName,
			ExpiresAt: expiresAt,
		}

		lockInfoJSON, err := json.Marshal(lockInfo)
		if err != nil {
			logger.SysErrorf("Failed to marshal renewed lock info for file %d: %v", fileID, err)
			return nil, fmt.Errorf("续期锁信息失败")
		}

		err = common.RedisSet(lockKey, string(lockInfoJSON), lockDuration)
		if err != nil {
			logger.SysErrorf("Failed to renew file edit lock for file %d: %v", fileID, err)
			return nil, fmt.Errorf("续期锁失败")
		}

		logger.SysLog(fmt.Sprintf("File edit lock renewed for file %d by user %d (%s)", fileID, userID, userName))
		return lockInfo, nil
	}

	// 锁属于其他用户，返回现有锁信息
	return &existingLock, fmt.Errorf("文件正在被用户 %s 编辑", existingLock.UserName)
}

// ReleaseLock 释放文件编辑锁
func (s *FileEditLockService) ReleaseLock(fileID int64, userID int64) error {
	if !common.IsRedisEnabled() {
		return common.ErrRedisNotEnabled
	}

	lockKey := s.getLockKey(fileID)

	// 获取现有锁信息
	existingLockStr, err := common.RedisGet(lockKey)
	if err != nil {
		if err == redis.Nil {
			return fmt.Errorf("锁不存在")
		}
		logger.SysErrorf("Failed to get file edit lock for release, file %d: %v", fileID, err)
		return fmt.Errorf("获取锁信息失败")
	}

	// 解析锁信息
	var existingLock FileEditLockInfo
	err = json.Unmarshal([]byte(existingLockStr), &existingLock)
	if err != nil {
		logger.SysErrorf("Failed to unmarshal lock info for release, file %d: %v", fileID, err)
		return fmt.Errorf("解析锁信息失败")
	}

	// 检查锁是否属于当前用户
	if existingLock.UserID != userID {
		return fmt.Errorf("无权限释放此锁")
	}

	// 删除锁
	err = common.RedisDel(lockKey)
	if err != nil {
		logger.SysErrorf("Failed to delete file edit lock for file %d: %v", fileID, err)
		return fmt.Errorf("释放锁失败")
	}

	logger.SysLog(fmt.Sprintf("File edit lock released for file %d by user %d", fileID, userID))
	return nil
}

// GetLockInfo 获取文件编辑锁信息
func (s *FileEditLockService) GetLockInfo(fileID int64) (*FileEditLockInfo, error) {
	if !common.IsRedisEnabled() {
		return nil, common.ErrRedisNotEnabled
	}

	lockKey := s.getLockKey(fileID)

	// 获取锁信息
	lockStr, err := common.RedisGet(lockKey)
	if err != nil {
		if err == redis.Nil {
			return nil, nil // 锁不存在
		}
		logger.SysErrorf("Failed to get file edit lock info for file %d: %v", fileID, err)
		return nil, fmt.Errorf("获取锁信息失败")
	}

	// 解析锁信息
	var lockInfo FileEditLockInfo
	err = json.Unmarshal([]byte(lockStr), &lockInfo)
	if err != nil {
		logger.SysErrorf("Failed to unmarshal lock info for file %d: %v", fileID, err)
		return nil, fmt.Errorf("解析锁信息失败")
	}

	// 检查锁是否已过期
	if time.Now().Unix() > lockInfo.ExpiresAt {
		// 锁已过期，删除它
		common.RedisDel(lockKey)
		return nil, nil
	}

	return &lockInfo, nil
}
