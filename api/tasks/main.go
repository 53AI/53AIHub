package tasks

import (
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
)

func Start() {
	StartOrderExpirationTask(1 * time.Minute)
	if config.COZE_TOKEN_AUTO_REFRESH_ENABLED {
		StartChannelUpdateKeyTask()
	} else {
		logger.SysLog("Coze token auto-refresh is disabled by COZE_TOKEN_AUTO_REFRESH_ENABLED=false")
	}
}
