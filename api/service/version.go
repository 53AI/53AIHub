package service

import (
	"context"

	"github.com/53AI/53AIHub/config"
	saas_model "github.com/53AI/53AIHub/saas/model"
)

// GetSaaSVersion 根据eid在 SAAS 数据库中读取 EnterpriseApply.Version。
// - 非 SAAS 环境直接返回空字符串。
// - 若查表失败或未找到记录，返回 0。
func GetSaaSVersion(ctx context.Context, eid int64) int {
	if !config.IS_SAAS {
		return 0
	}

	apply, err := saas_model.GetEnterpriseApplyByEid(eid)
	if err != nil || apply == nil {
		return 0
	}

	return apply.Version
}
