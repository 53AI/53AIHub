//go:build saas

package service

import (
	"context"

	"github.com/53AI/53AIHub/saas"
)

// SaaS 版本：仅初始化 SaaS 模块
func initRuntimeMode(ctx context.Context) {
	_ = ctx
	saas.InitSaas()
}
