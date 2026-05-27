package rediskeys

import "fmt"

// GetUserBrowseHistoryLockKey 生成浏览历史写入锁 Key
// Key 格式: Lock:UserBrowseHistory:{eid}:{userID}:{libraryID}:{fileID}
func GetUserBrowseHistoryLockKey(eid int64, userID int64, libraryID int64, fileID int64) string {
	return fmt.Sprintf("Lock:UserBrowseHistory:%d:%d:%d:%d", eid, userID, libraryID, fileID)
}
