package controller

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/botgateway"
	"github.com/gin-gonic/gin"
)

const (
	botWebhookDedupKeyPrefix   = "bot_gateway:webhook:"
	botWebhookDedupTTL         = 24 * time.Hour
	botVisitorSource           = "bot"
	botProcessTimeout          = 10 * time.Minute
	botWebhookMaxTimestampSkew = 5 * time.Minute
	botOutboxProcessingTimeout = 15 * time.Minute // processing 超时回收（多实例崩溃遗留）
)

// botWebhookDedup 幂等去重（可注入便于测试）：返回是否首次见到该 delivery。
var botWebhookDedup = func(delivery string) (bool, error) {
	return common.RedisSetNX(botWebhookDedupKeyPrefix+delivery, "1", botWebhookDedupTTL)
}

// botWebhookEnqueue 入 Outbox（可注入便于测试）：DeliveryID 唯一兜底去重，可靠投递。
// 同 delivery 已存在（重复推送/并发竞态）→ 幂等视为已入队。

var botWebhookEnqueue = func(binding *model.BotBinding, payload botgateway.Payload, rawBody []byte) (*model.BotWebhookOutbox, error) {
	it := &model.BotWebhookOutbox{
		DeliveryID: payload.Delivery, BotID: payload.BotID, Provider: payload.Provider,
		Payload: string(rawBody), Status: model.BotWebhookOutboxStatusPending,
	}
	err := model.CreateBotWebhookOutbox(it)
	if err != nil {
		var existing model.BotWebhookOutbox
		if model.DB.Where("delivery_id = ?", payload.Delivery).First(&existing).Error == nil {
			return &existing, nil // 已入队，幂等
		}
		return nil, err
	}
	return it, nil
}

// botWebhookRepeatCheck 短时间相同内容去重（可注入便于测试）：返回是否首次（不重复）。
// 参考 xbot 消息幂等思路：Redis SET NX EX，键含 bot+会话+内容 hash。

var botWebhookRepeatCheck = func(binding *model.BotBinding, payload botgateway.Payload) (bool, error) {
	if config.BotGatewayRepeatWindowSeconds <= 0 {
		return true, nil // 关闭
	}
	if !botRepeatDedupable(payload) {
		return true, nil
	}
	hash := sha256.Sum256([]byte(strings.TrimSpace(payload.Content)))
	key := fmt.Sprintf("bot_gateway:repeat:%s:%s:%x", payload.BotID, payload.Session, hash[:8])
	return common.RedisSetNX(key, "1", time.Duration(config.BotGatewayRepeatWindowSeconds)*time.Second)
}

func BotGatewayWebhook(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.Status(http.StatusOK)
		return
	}
	delivery := c.GetHeader("X-Webhook-Delivery")
	signature := c.GetHeader("X-Webhook-Signature")
	if delivery == "" {
		c.Status(http.StatusOK)
		return
	}

	var payload botgateway.Payload
	if err := json.Unmarshal(body, &payload); err != nil || payload.Event != "message" || payload.BotID == "" {
		logger.Warnf(c.Request.Context(), "【bot-gateway】忽略非 message 事件: delivery=%s event=%s err=%v", delivery, payload.Event, err)
		c.Status(http.StatusOK)
		return
	}

	// 消息级幂等防重：同一 bot_id + msg_id 在 10 分钟内不重复入队（防网关网络重试或平台重推导致重复回复）
	if payload.MsgID != "" {
		msgDedupKey := fmt.Sprintf("bot_gateway:msg:%s:%s", payload.BotID, payload.MsgID)
		if first, err := common.RedisSetNX(msgDedupKey, "1", 10*time.Minute); err == nil && !first {
			logger.Infof(c.Request.Context(), "【bot-gateway】同 msg_id 重复消息忽略: delivery=%s bot_id=%s msg_id=%s", delivery, payload.BotID, payload.MsgID)
			c.Status(http.StatusOK)
			return
		}
	}

	// token 优先关联：按 bot_token 指纹找绑定（bot_id 可能后填）；缺失则回退 bot_id 关联
	var binding *model.BotBinding
	if payload.BotToken != "" {
		if b, err := model.GetBotBindingByBotTokenHash(sha256Hex(payload.BotToken)); err == nil && b != nil && b.ID > 0 {
			binding = b
		}
	}
	if binding == nil {
		if b, err := model.GetBotBindingByBotID(payload.BotID, payload.Provider); err == nil && b != nil && b.ID > 0 {
			binding = b
		}
	}
	if binding == nil || !binding.Enabled {
		logger.Warnf(c.Request.Context(), "【bot-gateway】未找到启用绑定，忽略: bot_id=%s provider=%s token=%q", payload.BotID, payload.Provider, payload.BotToken)
		c.Status(http.StatusOK)
		return
	}

	botToken, err := botgateway.DecryptBotToken(binding.BotToken)
	if err != nil {
		// 与「签名不匹配」分开报：这是部署侧密钥问题（本实例 53AIHub_ENCRYPTION_KEY 与该接入落库时不一致），
		// 不是推送方拿错了 token；混成一条会把排查方向带偏（前者要查部署，后者要查网关配置）。
		logger.Warnf(c.Request.Context(), "【bot-gateway】webhook 验签不通过：接入凭据解密失败（部署密钥与该接入落库时不一致）: delivery=%s bot_id=%s id=%d err=%v",
			delivery, payload.BotID, binding.ID, err)
		respondErr(c, http.StatusUnauthorized, model.UnauthorizedError, "推送校验未通过")
		return
	}
	if !botgateway.VerifySignature(botToken, body, signature) {
		// 指纹只取前 8 位十六进制，不可反推，仅用于和推送方 token 比对。
		logger.Warnf(c.Request.Context(), "【bot-gateway】webhook 验签不通过：签名不匹配（推送方 token 与本接入凭据不符）: delivery=%s bot_id=%s id=%d 本接入凭据指纹=%s",
			delivery, payload.BotID, binding.ID, sha256Hex(botToken)[:8])
		respondErr(c, http.StatusUnauthorized, model.UnauthorizedError, "推送校验未通过")
		return
	}

	// bot_id 回填：token 优先建绑时为空，首次收到推送同步（网关侧回调已回填）
	if binding.BotID == "" && payload.BotID != "" {
		if err := model.UpdateBotBindingBotID(binding.Eid, binding.ID, payload.BotID); err != nil {
			logger.Warnf(c.Request.Context(), "【bot-gateway】回填 bot_id 失败(忽略): id=%d err=%v", binding.ID, err)
		} else {
			binding.BotID = payload.BotID
		}
	}

	// 防重放：X-Webhook-Timestamp 超时窗口（±5min）拒绝；缺失则跳过（兼容旧网关）
	if tsStr := c.GetHeader("X-Webhook-Timestamp"); tsStr != "" {
		ts, err := strconv.ParseInt(tsStr, 10, 64)
		if err != nil || time.Since(time.Unix(ts, 0)).Abs() > botWebhookMaxTimestampSkew {
			logger.Warnf(c.Request.Context(), "【bot-gateway】时间戳超窗拒绝: delivery=%s ts=%q", delivery, tsStr)
			respondErr(c, http.StatusUnauthorized, model.UnauthorizedError, "推送校验未通过")
			return
		}
	}

	// 能力判定：hub 无法处理的消息类型（视频/空/未知）走快速兜底回复，不进 agent 空转
	if config.BotGatewayFallbackReply != "" && !botMessageSupported(payload) {
		logger.Infof(c.Request.Context(), "【bot-gateway】不可处理类型，快速兜底回复: delivery=%s bot_id=%s type=%s", delivery, payload.BotID, botMessageType(payload))
		go fallbackBotReply(binding, payload)
		c.Status(http.StatusOK)
		return
	}

	// 短时间相同内容不重复回复（同 bot+会话+内容，窗口内命中直接忽略，参考 xbot 消息幂等）
	if first, err := botWebhookRepeatCheck(binding, payload); err == nil && !first {
		logger.Infof(c.Request.Context(), "【bot-gateway】短时间重复消息忽略: delivery=%s bot_id=%s session=%s", delivery, payload.BotID, payload.Session)
		c.Status(http.StatusOK)
		return
	}

	// 内部命令（获取 ID 等）：直接回复，不进 agent
	if reply, ok := botInternalCommand(payload); ok {
		logger.Infof(c.Request.Context(), "【bot-gateway】内部命令处理: delivery=%s bot_id=%s cmd=id", delivery, payload.BotID)
		go internalCommandReply(binding, payload, reply)
		c.Status(http.StatusOK)
		return
	}

	// 入 Outbox 持久化（DeliveryID 唯一兜底去重 + 可靠投递）：先入队成功才 200，入队失败返回 500 让网关重试
	item, err := botWebhookEnqueue(binding, payload, body)
	if err != nil {
		logger.Warnf(c.Request.Context(), "【bot-gateway】Outbox 入队失败: delivery=%s bot_id=%s err=%v", delivery, payload.BotID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// Redis 快速去重缓存（可失败，不影响；主去重由 outbox DeliveryID 唯一约束兜底）
	if _, err := botWebhookDedup(delivery); err != nil {
		logger.Warnf(c.Request.Context(), "【bot-gateway】幂等缓存写入失败(忽略): delivery=%s err=%v", delivery, err)
	}

	c.Status(http.StatusOK)
	EnsureBotWebhookWorker()
	// 立即启动快速即时处理（消除 5s ticker 延迟），成功后秒级更新 outbox 为 success
	if item != nil && item.ID > 0 {
		botOutboxProcess(item.ID)
	}
}

// botOutboxProcess 即时处理的启动器（可注入便于测试）：默认后台异步执行。
var botOutboxProcess = func(id int64) { go runBotOutboxSafely(id) }

// runBotOutboxSafely 后台即时处理入口：panic 只记录不扩散。
// 后台 goroutine 里的 panic 会直接终止整个 Hub 进程，而单条消息处理失败本应由
// Outbox 重试兜底——因此这里必须兜住，绝不能让一条坏消息打死整个服务。
func runBotOutboxSafely(id int64) {
	defer func() {
		if r := recover(); r != nil {
			logger.Errorf(context.Background(), "【bot-gateway】Outbox 即时处理 panic（已兜住，留待重试）: id=%d err=%v", id, r)
		}
	}()
	handleBotWebhookOutboxByID(id)
}

// handleBotWebhookOutboxByID 领取并处理单条 Outbox：先按 id CAS 抢占（pending→processing），
// 抢到才处理。这是与后台 worker 之间的同一把锁——若跳过抢占直接处理，同一条消息会被
// 即时处理与 5s ticker 各跑一次 agent，造成重复落库与重复回复；重复 delivery 的推送
// 也会因此二次触发 agent。
func handleBotWebhookOutboxByID(id int64) {
	it, claimed, err := model.ClaimBotWebhookOutboxByID(id)
	if err != nil {
		logger.Warnf(context.Background(), "【bot-gateway】Outbox 抢占失败: id=%d err=%v", id, err)
		return
	}
	if !claimed {
		return // 已被后台 worker 或其他即时处理领取（或已终态），不重复处理
	}
	handleBotWebhookOutboxItem(it)
}

// processBotWebhook 处理单条上行消息：visitor 用户/会话 → relay 管线生成回复 → 回发。返回 error 供 Outbox 重试判定。
// 注意：agent 无回复内容属正常情况，返回 nil（不重试）；agent 生成阶段的真实失败才返回 error。
// 已知取舍：回复已生成但平台下发失败时当前也返回 nil（不重试），避免重跑大模型——
// 代价是用户可能收不到该条回复，且答案缓存不会因此被复用。见缺陷 D1，待产品定口径。
