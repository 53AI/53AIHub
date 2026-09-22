package service

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

// capabilities 接口按库快照缓存：TTL 30 分钟做兜底。
// 主动失效为主（model 层写入钩子，见 model/capability_snapshot.go 注释的调用点），
// TTL 只做兜底 + 漏挂钩子的熔断；miss 回源 DB 复用现有逻辑。
const capabilitySnapshotCacheTTL = 30 * time.Minute

var capabilitySnapshotCacheInitOnce sync.Once

// InitCapabilitySnapshotCache wires the model-level capability snapshot invalidation hooks.
// 与 InitLibraryCacheInvalidator / InitLibraryFileCountCacheInvalidator 同范式，main.go 中调用。
func InitCapabilitySnapshotCache() {
	capabilitySnapshotCacheInitOnce.Do(func() {
		model.SetCapabilityFiletreeInvalidator(invalidateCapabilityFiletreeCache)
		model.SetCapabilityLibraryPermsInvalidator(invalidateCapabilityLibraryPermsCache)
	})
}

// loadCapabilitySnapshots 并行取 filetree + libperms 双 key；任一 miss 则回源重建并回填。
// Redis 未启用时直接回源（本地测试/单测路径）。
func loadCapabilitySnapshots(ctx context.Context, eid int64, libraryID int64) (*model.CapabilityFiletree, *model.CapabilityLibraryPerms, error) {
	if !common.RedisEnabled {
		return buildAndCacheCapabilitySnapshots(ctx, eid, libraryID)
	}
	filetreeKey := common.GetCapabilityFiletreeCacheKey(eid, libraryID)
	libpermsKey := common.GetCapabilityLibraryPermsCacheKey(eid, libraryID)

	var tree *model.CapabilityFiletree
	var perms *model.CapabilityLibraryPerms
	var treeRaw, permsRaw string
	var treeErr, permsErr error
	var wg sync.WaitGroup
	start := time.Now()
	wg.Add(2)
	go func() {
		defer wg.Done()
		treeRaw, treeErr = common.RedisGetWithCtx(ctx, filetreeKey)
	}()
	go func() {
		defer wg.Done()
		permsRaw, permsErr = common.RedisGetWithCtx(ctx, libpermsKey)
	}()
	wg.Wait()
	cost := time.Since(start)

	if treeErr == nil && treeRaw != "" {
		var t model.CapabilityFiletree
		if err := json.Unmarshal([]byte(treeRaw), &t); err == nil {
			tree = &t
		}
	}
	if permsErr == nil && permsRaw != "" {
		var p model.CapabilityLibraryPerms
		if err := json.Unmarshal([]byte(permsRaw), &p); err == nil {
			perms = &p
		}
	}
	// Info 级 + 请求 ctx：trace 必可见（request_id 归因），不受 DEBUG_REDIS 门控。
	logger.Infof(ctx, "【语料权限】知识库%d快照：文件骨架%s，库权限%s（耗时%s）",
		libraryID, snapshotGetOutcome(tree, treeRaw, treeErr), snapshotGetOutcome(perms, permsRaw, permsErr), cost)
	if tree != nil && perms != nil {
		return tree, perms, nil
	}
	return buildAndCacheCapabilitySnapshots(ctx, eid, libraryID)
}

// snapshotGetOutcome 统一 GET 结果口径：命中缓存 / 未命中（空/读失败/解析失败）。
func snapshotGetOutcome[T any](parsed *T, raw string, err error) string {
	if parsed != nil {
		return "命中缓存"
	}
	if err != nil {
		return "未命中（缓存读失败：" + err.Error() + "）"
	}
	if raw == "" {
		return "未命中（空）"
	}
	return "未命中（解析失败）"
}

func buildAndCacheCapabilitySnapshots(ctx context.Context, eid int64, libraryID int64) (*model.CapabilityFiletree, *model.CapabilityLibraryPerms, error) {
	start := time.Now()
	tree, err := model.BuildCapabilityFiletree(eid, libraryID, ctx)
	if err != nil {
		return nil, nil, err
	}
	perms, err := model.BuildCapabilityLibraryPerms(eid, libraryID, ctx)
	if err != nil {
		return nil, nil, err
	}
	if !common.RedisEnabled {
		logger.Infof(ctx, "【语料权限】知识库%d快照重建完成：文件%d个，文件权限%d条，库权限%d条，未写缓存（Redis未启用）（耗时%s）",
			libraryID, len(tree.Files), len(perms.FilePerms), len(perms.LibraryPerms), time.Since(start))
		return tree, perms, nil
	}
	storeErr := ""
	if raw, err := json.Marshal(tree); err == nil {
		if err := common.RedisSetWithCtx(ctx, common.GetCapabilityFiletreeCacheKey(eid, libraryID), string(raw), capabilitySnapshotCacheTTL); err != nil {
			storeErr += "filetree:" + err.Error() + " "
		}
	} else {
		storeErr += "filetree:marshal-failed "
	}
	if raw, err := json.Marshal(perms); err == nil {
		if err := common.RedisSetWithCtx(ctx, common.GetCapabilityLibraryPermsCacheKey(eid, libraryID), string(raw), capabilitySnapshotCacheTTL); err != nil {
			storeErr += "libperms:" + err.Error()
		}
	} else {
		storeErr += "libperms:marshal-failed"
	}
	if storeErr != "" {
		logger.Warnf(ctx, "【语料权限】知识库%d快照重建完成但写入缓存失败：%s，本次请求走DB结果（文件%d个，耗时%s）",
			libraryID, storeErr, len(tree.Files), time.Since(start))
	} else {
		logger.Infof(ctx, "【语料权限】知识库%d快照重建完成：文件%d个，文件权限%d条，库权限%d条，已写入缓存（耗时%s）",
			libraryID, len(tree.Files), len(perms.FilePerms), len(perms.LibraryPerms), time.Since(start))
	}
	return tree, perms, nil
}

func invalidateCapabilityFiletreeCache(eid int64, libraryID int64) {
	if !common.RedisEnabled {
		return
	}
	if err := common.RedisDel(common.GetCapabilityFiletreeCacheKey(eid, libraryID)); err != nil {
		logger.SysWarnf("【语料权限】知识库%d快照清理失败（范围：文件骨架）：%v", libraryID, err)
		return
	}
	// 无请求 ctx（写路径调用），只有 eid/library 供关联；下一次读必 miss 重建。
	logger.Infof(context.Background(), "【语料权限】知识库%d快照已失效（范围：文件骨架），下次请求重建", libraryID)
}

func invalidateCapabilityLibraryPermsCache(eid int64, libraryID int64) {
	if !common.RedisEnabled {
		return
	}
	if err := common.RedisDel(common.GetCapabilityLibraryPermsCacheKey(eid, libraryID)); err != nil {
		logger.SysWarnf("【语料权限】知识库%d快照清理失败（范围：库权限）：%v", libraryID, err)
		return
	}
	logger.Infof(context.Background(), "【语料权限】知识库%d快照已失效（范围：库权限），下次请求重建", libraryID)
}
