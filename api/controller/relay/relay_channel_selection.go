package relay

import (
	"context"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
)

func getAgentSpecificChannel(ctx context.Context, agent *model.Agent) (*model.Channel, error) {
	if agent == nil || agent.SpecificChannelID <= 0 {
		return nil, nil
	}

	channel, err := service.GetChannelByIDWithTokenRefresh(ctx, agent.SpecificChannelID)
	if err != nil {
		logger.Errorf(ctx, "【渠道解析】固定渠道加载失败: channelID=%d, err=%v", agent.SpecificChannelID, err)
		return nil, fmt.Errorf("fixed execution channel unavailable")
	}

	logger.Infof(ctx, "【渠道解析】使用 agent_model 固定渠道: channelID=%d, model=%s", channel.ChannelID, agent.Model)
	return channel, nil
}
