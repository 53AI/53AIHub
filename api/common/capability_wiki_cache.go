package common

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

// Wiki 权限按库快照缓存（common 层，供 service 与 service/elasticsearch 共用，避免子包反向依赖）。
// TTL 30 分钟做兜底，主动失效为主（model 层写入钩子，由 service.InitCapabilityWikiCache 注册），
// miss 回源 DB 重建。Source 文件权限不落本快照（解析时从 FILE libperms 快照实时取）。
const WikiCapabilitySnapshotCacheTTL = 30 * time.Minute

// LoadCapabilityWiki 并行取 wiki（页面结构+Source映射）+ wikiperms（页面ACL）双 key；
// 任一 miss 则回源重建并回填。Redis 未启用时直接回源（本地测试/单测路径）。
func LoadCapabilityWiki(ctx context.Context, eid int64, libraryID int64) (*model.CapabilityWikiPages, *model.CapabilityWikiPerms, error) {
	if !RedisEnabled {
		return buildAndCacheCapabilityWiki(ctx, eid, libraryID)
	}
	wikiKey := GetCapabilityWikiCacheKey(eid, libraryID)
	permsKey := GetCapabilityWikiPermsCacheKey(eid, libraryID)

	var wiki *model.CapabilityWikiPages
	var perms *model.CapabilityWikiPerms
	var wikiRaw, permsRaw string
	var wikiErr, permsErr error
	var wg sync.WaitGroup
	start := time.Now()
	wg.Add(2)
	go func() {
		defer wg.Done()
		wikiRaw, wikiErr = RedisGetWithCtx(ctx, wikiKey)
	}()
	go func() {
		defer wg.Done()
		permsRaw, permsErr = RedisGetWithCtx(ctx, permsKey)
	}()
	wg.Wait()
	cost := time.Since(start)

	if wikiErr == nil && wikiRaw != "" {
		var w model.CapabilityWikiPages
		if err := json.Unmarshal([]byte(wikiRaw), &w); err == nil {
			wiki = &w
		}
	}
	if permsErr == nil && permsRaw != "" {
		var p model.CapabilityWikiPerms
		if err := json.Unmarshal([]byte(permsRaw), &p); err == nil {
			perms = &p
		}
	}
	logger.Infof(ctx, "【Wiki权限】知识库%d快照：页面结构%s，页面ACL%s（耗时%s）",
		libraryID, wikiSnapshotGetOutcome(wiki, wikiRaw, wikiErr), wikiSnapshotGetOutcome(perms, permsRaw, permsErr), cost)
	if wiki != nil && perms != nil {
		return wiki, perms, nil
	}
	return buildAndCacheCapabilityWiki(ctx, eid, libraryID)
}

func wikiSnapshotGetOutcome[T any](parsed *T, raw string, err error) string {
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

func buildAndCacheCapabilityWiki(ctx context.Context, eid int64, libraryID int64) (*model.CapabilityWikiPages, *model.CapabilityWikiPerms, error) {
	start := time.Now()
	wiki, err := model.BuildCapabilityWikiPages(eid, libraryID, ctx)
	if err != nil {
		return nil, nil, err
	}
	perms, err := model.BuildCapabilityWikiPerms(eid, libraryID, ctx)
	if err != nil {
		return nil, nil, err
	}
	if !RedisEnabled {
		logger.Infof(ctx, "【Wiki权限】知识库%d快照重建完成：页面%d个，页面ACL%d条，未写缓存（Redis未启用）（耗时%s）",
			libraryID, len(wiki.Pages), len(perms.PagePerms), time.Since(start))
		return wiki, perms, nil
	}
	storeErr := ""
	if raw, err := json.Marshal(wiki); err == nil {
		if err := RedisSetWithCtx(ctx, GetCapabilityWikiCacheKey(eid, libraryID), string(raw), WikiCapabilitySnapshotCacheTTL); err != nil {
			storeErr += "wiki:" + err.Error() + " "
		}
	} else {
		storeErr += "wiki:marshal-failed "
	}
	if raw, err := json.Marshal(perms); err == nil {
		if err := RedisSetWithCtx(ctx, GetCapabilityWikiPermsCacheKey(eid, libraryID), string(raw), WikiCapabilitySnapshotCacheTTL); err != nil {
			storeErr += "wikiperms:" + err.Error()
		}
	} else {
		storeErr += "wikiperms:marshal-failed"
	}
	if storeErr != "" {
		logger.Warnf(ctx, "【Wiki权限】知识库%d快照重建完成但写入缓存失败：%s，本次请求走DB结果（页面%d个，耗时%s）",
			libraryID, storeErr, len(wiki.Pages), time.Since(start))
	} else {
		logger.Infof(ctx, "【Wiki权限】知识库%d快照重建完成：页面%d个，页面ACL%d条，已写入缓存（耗时%s）",
			libraryID, len(wiki.Pages), len(perms.PagePerms), time.Since(start))
	}
	return wiki, perms, nil
}
