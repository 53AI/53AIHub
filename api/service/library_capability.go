package service

import (
	"context"
	"errors"

	"github.com/53AI/53AIHub/common"
)

// HasEditCorpusScope reports whether the user can manage corpus in any active
// file or folder within the library.
// 快照路径：按库 filetree + libperms 快照内存计算；任一快照缺失则回源 DB 重建并回填。
func HasEditCorpusScope(ctx context.Context, eid, libraryID, userID int64) (bool, error) {
	tree, perms, err := loadCapabilitySnapshots(ctx, eid, libraryID)
	if err != nil {
		return false, err
	}
	if tree == nil || perms == nil {
		return false, errors.New("capability snapshots unavailable")
	}
	return common.HasEditCorpusScopeFromSnapshots(ctx, eid, libraryID, userID, tree, perms)
}

