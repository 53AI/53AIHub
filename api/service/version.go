package service

import (
	"context"

	"github.com/53AI/53AIHub/config"
)

// GetSaaSVersion 根据eid在 SAAS 数据库中读取 EnterpriseApply.Version。
// - 非 SAAS 环境直接返回空字符串。
// - 若查表失败或未找到记录，回退到 config.Version / config.VersionTime（若有）。
func GetSaaSVersion(ctx context.Context, eid int64) int {
	if !config.IS_SAAS {
		return 0
	}
	// 开源版本不支持 SAAS 版本查询
	return 0
}
