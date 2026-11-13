package controller

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/botgateway"
)

var botWebhookWorkerOnce sync.Once

// EnsureBotWebhookWorker 启动上行 Outbox 处理 worker（幂等，仅首次生效）。

func EnsureBotWebhookWorker() {
	botWebhookWorkerOnce.Do(func() {
		go botWebhookWorkerLoop()
		logger.SysLogf("【bot-gateway】上行 Outbox worker 已启动")
	})
}

// botWebhookWorkerLoop 定时拉取待处理项并执行，失败按指数退避重试。
// 每次先回收超时未完成的 processing 记录（多实例崩溃遗留），再领取处理。

func botWebhookWorkerLoop() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		if n, err := model.RecoverStuckBotWebhookOutbox(botOutboxProcessingTimeout); err == nil && n > 0 {
			logger.Infof(context.Background(), "【bot-gateway】Outbox 回收超时 processing 记录: %d 条", n)
		}
		items, err := model.ClaimBotWebhookOutbox(20)
		if err != nil {
			logger.Warnf(context.Background(), "【bot-gateway】Outbox 拉取失败: %v", err)
			continue
		}
		for _, it := range items {
			handleBotWebhookOutboxItemSafely(it)
		}
	}
}

// handleBotWebhookOutboxItemSafely 单条处理入口：panic 只记录不扩散，
// 避免一条坏消息（或 relay 管线内部 panic）直接终止整个 Hub 进程。
func handleBotWebhookOutboxItemSafely(it *model.BotWebhookOutbox) {
	defer func() {
		if r := recover(); r != nil {
			logger.Errorf(context.Background(), "【bot-gateway】Outbox 处理 panic（已兜住，留待重试）: id=%d err=%v", it.ID, r)
		}
	}()
	handleBotWebhookOutboxItem(it)
}

// handleBotWebhookOutboxItem 处理单条 Outbox 项：成功置 success，失败指数退避重试，超限置 failed。

func handleBotWebhookOutboxItem(it *model.BotWebhookOutbox) {
	if it == nil {
		return
	}
	var payload botgateway.Payload
	if err := json.Unmarshal([]byte(it.Payload), &payload); err != nil {
		logger.Warnf(context.Background(), "【bot-gateway】Outbox payload 解析失败: id=%d err=%v", it.ID, err)
		_ = model.MarkBotWebhookOutboxFailure(it.ID, it.Attempts)
		return
	}
	// token 优先关联（与同步接收路径一致）：payload 带 BotToken 时按指纹定位，缺失才回退 bot_id。
	var binding *model.BotBinding
	if payload.BotToken != "" {
		if b, e := model.GetBotBindingByBotTokenHash(sha256Hex(payload.BotToken)); e == nil && b != nil && b.ID > 0 {
			binding = b
		}
	}
	if binding == nil {
		if b, e := model.GetBotBindingByBotID(it.BotID, it.Provider); e == nil && b != nil && b.ID > 0 {
			binding = b
		}
	}
	if binding == nil || !binding.Enabled {
		// 绑定不存在/已停用：终止不再重试
		logger.Warnf(context.Background(), "【bot-gateway】Outbox 绑定不可用，终止: id=%d bot_id=%s provider=%s", it.ID, it.BotID, it.Provider)
		_ = model.MarkBotWebhookOutboxFailure(it.ID, it.Attempts)
		return
	}
	if err := processBotWebhook(binding, payload, []byte(it.Payload)); err != nil {
		// 重试耗尽即终态：给用户一句可读回执，避免"机器人不吭声"。
		terminal := it.Attempts+1 >= model.BotWebhookOutboxMaxAttempts
		_ = model.MarkBotWebhookOutboxFailure(it.ID, it.Attempts)
		if terminal && config.BotGatewayFailureReply != "" {
			logger.Warnf(context.Background(), "【bot-gateway】重试已耗尽，向用户回执失败提示: id=%d bot_id=%s", it.ID, it.BotID)
			sendBotReply(binding, payload, config.BotGatewayFailureReply)
		}
		return
	}
	_ = model.MarkBotWebhookOutboxSuccess(it.ID)
}
