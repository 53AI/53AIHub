package controller

import (
	"context"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
)

func recordWikiPageAccess(ctx context.Context, eid, userID, pageID, spaceID int64) {
	if err := service.SaveUserRecentUsed(eid, userID, model.RESOURCE_TYPE_WIKI_PAGE, pageID, spaceID); err != nil {
		logger.Warnf(ctx, "记录 Wiki 最近访问失败: eid=%d userID=%d pageID=%d err=%v", eid, userID, pageID, err)
	}
}
