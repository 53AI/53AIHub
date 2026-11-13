package service

import (
	"context"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/elasticsearch"
	"gorm.io/gorm"
)

// Syncs committed database snapshots; a scoped wiki_es_reindex repairs missed events.
func syncWikiESPage(ctx context.Context, db *gorm.DB, eid, pageID int64) {
	client := elasticsearch.GetInitializedClient()
	if client == nil || client.IsDisabled() || db == nil || pageID <= 0 {
		return
	}
	var page model.WikiPage
	if err := db.WithContext(ctx).Where("eid = ? AND id = ?", eid, pageID).First(&page).Error; err != nil {
		logger.Warnf(ctx, "【Wiki ES】读取已提交页面失败 eid=%d page_id=%d err=%v", eid, pageID, err)
		return
	}
	if err := client.SyncWikiPage(ctx, &page); err != nil {
		logger.Warnf(ctx, "【Wiki ES】增量同步失败 eid=%d page_id=%d err=%v", eid, pageID, err)
	}
}

func syncWikiESSlugs(ctx context.Context, db *gorm.DB, eid, libraryID int64, slugs []string) {
	client := elasticsearch.GetInitializedClient()
	if client == nil || client.IsDisabled() || db == nil || len(slugs) == 0 {
		return
	}
	var pages []model.WikiPage
	if err := db.WithContext(ctx).Where("eid = ? AND library_id = ? AND slug IN ?", eid, libraryID, slugs).Find(&pages).Error; err != nil {
		logger.Warnf(ctx, "【Wiki ES】批量读取页面失败 eid=%d library_id=%d err=%v", eid, libraryID, err)
		return
	}
	for i := range pages {
		if err := client.SyncWikiPage(ctx, &pages[i]); err != nil {
			logger.Warnf(ctx, "【Wiki ES】同步页面失败 eid=%d page_id=%d err=%v", eid, pages[i].ID, err)
		}
	}
}
