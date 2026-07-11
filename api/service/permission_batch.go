package service

import "github.com/53AI/53AIHub/common"

// BatchGetUserPermissions 批量获取当前用户对指定资源列表的最大权限。
func BatchGetUserPermissions(eid int64, resourceType int, resourceIDs []int64, userID int64) (map[int64]int, error) {
	return common.BatchGetUserPermissions(eid, resourceType, resourceIDs, userID)
}
