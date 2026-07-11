//go:build saas

package service

import (
	"context"

	"github.com/53AI/53AIHub/common/logger"
	saasSvc "github.com/53AI/53AIHub/saas/service"
)

func postLinkPlatformAccounts(accounts map[string]struct{}) {
	for account := range accounts {
		pu, err := saasSvc.GetPlatformUserByAccount(account)
		if err != nil {
			logger.Warnf(context.Background(), "post-link: get platform user by account failed, account=%s, err=%v", account, err)
			continue
		}
		if pu == nil || pu.UserID == 0 {
			continue
		}
		if _, err := saasSvc.LinkPlatformAccountToEnterpriseUsersByAccount(account, pu.UserID); err != nil {
			logger.Errorf(context.Background(), "post-link: link platform account to enterprise users failed, account=%s, platform_user_id=%d, err=%v", account, pu.UserID, err)
			continue
		}
	}
}

