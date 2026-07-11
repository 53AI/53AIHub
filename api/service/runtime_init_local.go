//go:build !saas

package service

import (
	"context"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

func initRuntimeMode(ctx context.Context) {
	_ = ctx
	logger.SysLogf("初始化系统数据...")
	if err := model.InitializeSystem(); err != nil {
		logger.FatalLog("Failed to initialize system: " + err.Error())
	}
}
