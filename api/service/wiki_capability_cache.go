package service

import (
	"context"
	"sync"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

// Wiki 权限快照失效注册（加载/重建逻辑在 common.LoadCapabilityWiki，service/elasticsearch 共用）。
// 主动失效为主（model 层写入钩子），TTL 30 分钟由 common 兜底；miss 回源 DB 重建。

var wikiCapabilityCacheInitOnce sync.Once

// InitCapabilityWikiCache 注册 Wiki 页面结构 + ACL 快照失效钩子，main.go 调用。
func InitCapabilityWikiCache() {
	wikiCapabilityCacheInitOnce.Do(func() {
		model.SetCapabilityWikiInvalidator(invalidateCapabilityWikiCache)
		model.SetCapabilityWikiPermsInvalidator(invalidateCapabilityWikiPermsCache)
	})
}

// loadCapabilityWiki 转发 common.LoadCapabilityWiki（service 内部调用点保持语义不变）。
func loadCapabilityWiki(ctx context.Context, eid int64, libraryID int64) (*model.CapabilityWikiPages, *model.CapabilityWikiPerms, error) {
	return common.LoadCapabilityWiki(ctx, eid, libraryID)
}

func invalidateCapabilityWikiCache(eid int64, libraryID int64) {
	if !common.RedisEnabled {
		return
	}
	if err := common.RedisDel(common.GetCapabilityWikiCacheKey(eid, libraryID)); err != nil {
		logger.SysWarnf("【Wiki权限】知识库%d快照清理失败（范围：页面结构）：%v", libraryID, err)
		return
	}
	logger.Infof(context.Background(), "【Wiki权限】知识库%d快照已失效（范围：页面结构），下次请求重建", libraryID)
}

func invalidateCapabilityWikiPermsCache(eid int64, libraryID int64) {
	if !common.RedisEnabled {
		return
	}
	if err := common.RedisDel(common.GetCapabilityWikiPermsCacheKey(eid, libraryID)); err != nil {
		logger.SysWarnf("【Wiki权限】知识库%d快照清理失败（范围：页面ACL）：%v", libraryID, err)
		return
	}
	logger.Infof(context.Background(), "【Wiki权限】知识库%d快照已失效（范围：页面ACL），下次请求重建", libraryID)
}
