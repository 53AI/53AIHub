package botgateway

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
)

var defaultHTTPClient = &http.Client{Timeout: 30 * time.Second}

// GatewayResponse bot-gateway 统一响应包裹 {"code":0,"message":"ok","data":{...}}
type GatewayResponse struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

// File 上行消息附件（与 bot-gateway provider.File 对齐：个微图片=回调内嵌 base64 缩略图，禁主动下载）。
type File struct {
	Name    string `json:"Name"`
	Content string `json:"Content"`
	URL     string `json:"URL"`
}

// Payload 上行推送消息体（与 bot-gateway internal/webhook.Payload 对齐，字段名大小写不敏感）。
type Payload struct {
	Event       string          `json:"Event"`
	Provider    string          `json:"Provider"`
	BotID       string          `json:"BotID"`
	BotToken    string          `json:"BotToken"` // 绑定身份（token 优先机制下用于关联绑定）
	MsgID       string          `json:"MsgID"`
	Session     string          `json:"Session"`
	MsgType     int             `json:"MsgType"`
	MessageType string          `json:"MessageType"` // 网关规范化类型：text/image/link/file/video（供能力判定）
	Content     string          `json:"Content"`
	AtList      json.RawMessage `json:"AtList"`
	Files       []File          `json:"Files"`
	Timestamp   int64           `json:"Timestamp"`
	Delivery    string          `json:"Delivery"`
}

// BotInfo 网关机器人列表项（透传）
// Online 为三态：nil=未探测到在线状态（如缺设备 ID / 平台不可达）；false=确认离线；true=在线。
type BotInfo struct {
	BotID  string `json:"botId"`
	Name   string `json:"name"`
	Status string `json:"status"`
	Online *bool  `json:"online"`
}

// botGatewayConfigVars 供测试注入的配置访问点
var botGatewayConfigVars = struct {
	baseURL    func() string
	adminToken func() string
	set        func(baseURL, adminToken string)
}{
	baseURL:    func() string { return config.BotGatewayDefaultBaseURL },
	adminToken: func() string { return config.BotGatewayAdminToken },
	set: func(baseURL, adminToken string) {
		config.BotGatewayDefaultBaseURL = baseURL
		config.BotGatewayAdminToken = adminToken
	},
}

func botGatewayDefaultBaseURL() string { return botGatewayConfigVars.baseURL() }
func botGatewayAdminToken() string     { return botGatewayConfigVars.adminToken() }
func setBotGatewayConfig(baseURL, adminToken string) {
	botGatewayConfigVars.set(baseURL, adminToken)
}

// BizError 消息服务业务错误：Code 是稳定的业务码（调用方按码分支，不猜文案），
// Message 已是可操作中文提示（可直接展示给用户）。刻意不加 "xxx 业务错误: code=..." 前缀——
// 那层包裹会让「该账号登录已达上限」这类指引淹没在诊断串里。
type BizError struct {
	Code    int
	Message string
}

func (e *BizError) Error() string { return e.Message }

// 业务码分段（与消息服务 apierr 约定一致）：1xxx 参数、2xxx 前置状态、3xxx 平台策略、
// 4xxx 冲突、5xxx 服务端故障、6xxx 不存在、7xxx 鉴权。
const (
	// CodeTooFrequent 操作过于频繁：唯一需要 Hub 单独映射成 429 的码（前端据此置灰倒计时）。
	CodeTooFrequent = 3002

	bizCodeConflictFrom = 4000
	bizCodeConflictTo   = 5000
	bizCodeServerFrom   = 5000
	bizCodeServerTo     = 6000
	bizCodeNotFoundFrom = 6000
	bizCodeNotFoundTo   = 7000
	bizCodeAuthFrom     = 7000
)

// Segment 返回业务码所属语义段，供 Hub 映射 HTTP 状态与响应码。
func (e *BizError) Segment() string {
	switch {
	case e.Code >= bizCodeAuthFrom:
		return "auth"
	case e.Code >= bizCodeNotFoundFrom:
		return "not_found"
	case e.Code >= bizCodeServerFrom:
		return "server"
	case e.Code >= bizCodeConflictFrom:
		return "conflict"
	default:
		return "user"
	}
}

func callGateway(ctx context.Context, method, url, bearer string, reqBody, out any) error {
	var body io.Reader
	if reqBody != nil {
		b, err := json.Marshal(reqBody)
		if err != nil {
			return fmt.Errorf("marshal request: %w", err)
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	// 透传 request_id：两侧日志用同一个编号，用户报障时只需提供一个。
	if rid := helper.GetRequestID(ctx); rid != "" {
		req.Header.Set("X-Request-ID", rid)
	}
	resp, err := defaultHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("调用消息服务失败: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	var wrapped GatewayResponse
	if err := json.Unmarshal(respBody, &wrapped); err != nil {
		return fmt.Errorf("消息服务响应解析失败: %w", err)
	}
	if wrapped.Code != 0 {
		return &BizError{Code: wrapped.Code, Message: wrapped.Message}
	}
	if out != nil && len(wrapped.Data) > 0 {
		if err := json.Unmarshal(wrapped.Data, out); err != nil {
			return fmt.Errorf("bot-gateway data 解析失败: %w", err)
		}
	}
	return nil
}

// SendFileContent 文件/视频类消息内容（与 bot-gateway sendReq.file 对齐）。
type SendFileContent struct {
	Name        string `json:"name"`
	URL         string `json:"url"`
	DurationSec int    `json:"durationSec"`
}

// SendLinkContent 链接卡片内容（与 bot-gateway sendReq.link 对齐）。
type SendLinkContent struct {
	Title string `json:"title"`
	Desc  string `json:"desc"`
	URL   string `json:"url"`
}

// SendMessage 发送消息（业务发送面，Bearer 绑定 bot_token），支持 text/image/file/video/link。
// msgType: text | image | file | video | link；file 用于 image/file/video，link 用于 link。
func SendMessage(ctx context.Context, binding *model.BotBinding, to, msgType, content string, file *SendFileContent, link *SendLinkContent) (string, error) {
	botToken, err := DecryptBotToken(binding.BotToken)
	if err != nil {
		return "", fmt.Errorf("解密 bot_token 失败: %w", err)
	}
	body := map[string]any{"botId": binding.BotID, "to": to, "messageType": msgType, "content": content}
	if file != nil {
		body["file"] = file
	}
	if link != nil {
		body["link"] = link
	}
	var out struct {
		PlatformMsgID string `json:"platformMsgId"`
	}
	if err := callGateway(ctx, http.MethodPost, config.BotGatewayDefaultBaseURL+"/api/v1/messages/send", botToken, body, &out); err != nil {
		return "", err
	}
	return out.PlatformMsgID, nil
}

// SendTextMessage 发送文本消息（业务发送面，Bearer 绑定 bot_token）
func SendTextMessage(ctx context.Context, binding *model.BotBinding, to, content string) (string, error) {
	botToken, err := DecryptBotToken(binding.BotToken)
	if err != nil {
		return "", fmt.Errorf("解密 bot_token 失败: %w", err)
	}
	var out struct {
		PlatformMsgID string `json:"platformMsgId"`
	}
	err = callGateway(ctx, http.MethodPost, config.BotGatewayDefaultBaseURL+"/api/v1/messages/send", botToken, map[string]any{
		"botId": binding.BotID, "to": to, "messageType": "text", "content": content,
	}, &out)
	if err != nil {
		return "", err
	}
	return out.PlatformMsgID, nil
}

// BindingResult 建绑时网关下发的信息（AgentHub 建绑接口原样透传返回给调用方）。
type BindingResult struct {
	AgentID             string `json:"agentId"`
	BotToken            string `json:"botToken"`
	Provider            string `json:"provider"`
	BotID               string `json:"botId"`               // 网关在建绑时按设备探测到的平台账号（无 deviceId/未登录时为空）
	PlatformCallbackURL string `json:"platformCallbackUrl"` // 需填到第三方平台后台的回调地址（PUBLIC_BASE_URL/callback/{provider}?bot_token=...）
}

// CreateBinding 在 bot-gateway 侧创建 token 优先绑定并返回网关下发信息（管理面 ADMIN_TOKEN）。
// token 必填；botId/deviceId/name 选填。只给 deviceId 时，网关在建绑内按设备探测平台账号并通过 BotID 返回。
// 上行推送目标由网关侧 HUB_CALLBACK_URL 配置，此处不传。
func CreateBinding(ctx context.Context, agentID, token, provider, botID, deviceID, name string) (*BindingResult, error) {
	var out BindingResult
	if botGatewayAdminToken() == "" {
		return nil, fmt.Errorf("BOT_GATEWAY_ADMIN_TOKEN 未配置")
	}
	err := callGateway(ctx, http.MethodPost, botGatewayDefaultBaseURL()+"/api/v1/binds", botGatewayAdminToken(), map[string]any{
		"agentId": agentID, "token": token, "provider": provider,
		"botId": botID, "deviceId": deviceID, "name": name,
	}, &out)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// DeleteBinding 删除 bot-gateway 侧绑定（管理面 ADMIN_TOKEN）
// DeleteBinding 解绑：按 agentId + botToken 删除接入（网关校验归属后释放 bot_token 与 saas token）。
func DeleteBinding(ctx context.Context, agentID, botToken string) error {
	if botGatewayAdminToken() == "" {
		return fmt.Errorf("BOT_GATEWAY_ADMIN_TOKEN 未配置")
	}
	return callGateway(ctx, http.MethodDelete, botGatewayDefaultBaseURL()+"/api/v1/binds", botGatewayAdminToken(), map[string]any{
		"agentId": agentID, "botToken": botToken,
	}, nil)
}

// ContactDetail 联系人资料（转发网关 /contacts/detail）
type ContactDetail struct {
	WxID      string `json:"wxid"`
	Nickname  string `json:"nickname"`
	Avatar    string `json:"avatar"`
	Sex       int    `json:"sex"`
	Signature string `json:"signature"`
	Province  string `json:"province"`
	City      string `json:"city"`
}

// BotDetail 机器人平台详情（转发网关 /bots/{botId}/info）
type BotDetail struct {
	BotID     string `json:"botId"`
	Provider  string `json:"provider"`
	Nickname  string `json:"nickname"`
	Avatar    string `json:"avatar"`
	Signature string `json:"signature"`
	Online    bool   `json:"online"`
	// Profile 平台账号资料原样透传（字段名随 provider 不同，前端按 provider 取用）：
	// 企微 avatarUrl/realName/corpId/gender/mobile…；个微 bigHeadImgUrl/province/city/signature/snsBgImg…
	Profile map[string]any `json:"profile,omitempty"`
}

// GetContactDetails 反查联系人资料（管理面 ADMIN_TOKEN）
func GetContactDetails(ctx context.Context, botID string, wxids []string) ([]ContactDetail, error) {
	if botGatewayAdminToken() == "" {
		return nil, fmt.Errorf("BOT_GATEWAY_ADMIN_TOKEN 未配置")
	}
	var out struct {
		List []ContactDetail `json:"list"`
	}
	if err := callGateway(ctx, http.MethodPost, botGatewayDefaultBaseURL()+"/api/v1/contacts/detail", botGatewayAdminToken(), map[string]any{
		"botId": botID, "wxids": wxids,
	}, &out); err != nil {
		return nil, err
	}
	return out.List, nil
}

// GetBotDetail 获取机器人平台实时详情（管理面 ADMIN_TOKEN）
func GetBotDetail(ctx context.Context, botID string) (*BotDetail, error) {
	if botGatewayAdminToken() == "" {
		return nil, fmt.Errorf("BOT_GATEWAY_ADMIN_TOKEN 未配置")
	}
	var out BotDetail
	u := botGatewayDefaultBaseURL() + "/api/v1/bots/" + url.PathEscape(botID) + "/info"
	if err := callGateway(ctx, http.MethodGet, u, botGatewayAdminToken(), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetBotOnline 获取机器人在线状态（管理面 ADMIN_TOKEN）
func GetBotOnline(ctx context.Context, botID string) (bool, error) {
	if botGatewayAdminToken() == "" {
		return false, fmt.Errorf("BOT_GATEWAY_ADMIN_TOKEN 未配置")
	}
	var out struct {
		Online bool `json:"online"`
	}
	u := botGatewayDefaultBaseURL() + "/api/v1/bots/" + url.PathEscape(botID) + "/online"
	if err := callGateway(ctx, http.MethodGet, u, botGatewayAdminToken(), nil, &out); err != nil {
		return false, err
	}
	return out.Online, nil
}

// LoginQRResult 取码结果（透传网关）
type LoginQRResult struct {
	QrImgBase64 string `json:"qrImgBase64"`
	DeviceID    string `json:"deviceId"`
	Reuse       bool   `json:"reuse"`
	UUID        string `json:"uuid,omitempty"`
	QrURL       string `json:"qrUrl,omitempty"`
	// RegionApplied 本次取码是否实际下发了地区：仅新建/降级重建设备时为 true；
	// 复用已存设备时平台沿用设备原地区，调用方传入的 region 不生效。
	RegionApplied bool `json:"regionApplied"`
}

// LoginQRInput 取码入参（转发网关）。
type LoginQRInput struct {
	BotToken string
	Provider string
	Region   string // 企微 areaCode / 个微 regionId
	Type     string // 设备类型（个微 mac/ipad）
	ProxyIP  string // 个微代理 IP（可选）
	TTUID    string // 个微代理本机 ID（可选）
	DeviceID string // 指定设备 ID 覆盖（可选）
	ForceNew bool   // 强制换新设备（可选）
}

// LoginQR 获取扫码登录二维码（管理面 ADMIN_TOKEN，转发网关）
func LoginQR(ctx context.Context, in LoginQRInput) (*LoginQRResult, error) {
	if botGatewayAdminToken() == "" {
		return nil, fmt.Errorf("BOT_GATEWAY_ADMIN_TOKEN 未配置")
	}
	var out LoginQRResult
	if err := callGateway(ctx, http.MethodPost, botGatewayDefaultBaseURL()+"/api/v1/login/qrcode", botGatewayAdminToken(), map[string]any{
		"botToken": in.BotToken, "provider": in.Provider, "region": in.Region, "type": in.Type,
		"proxyIp": in.ProxyIP, "ttuid": in.TTUID, "deviceId": in.DeviceID, "forceNew": in.ForceNew,
	}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// LoginPollResult 轮询扫码结果（透传网关）
type LoginPollResult struct {
	IsLogin  bool   `json:"isLogin"`
	Status   int    `json:"status"`
	BotID    string `json:"botId"`
	Nickname string `json:"nickname"`
	CorpName string `json:"corpName"`
	// NeedAppVerify / AppVerifyURL 仅个微可能返回：平台要求用 App 扫码完成图形验证时，
	// AppVerifyURL 为验证链接（数字验证码场景请用 poll 的 captch_code 提交，两者互斥）。
	NeedAppVerify bool   `json:"needAppVerify,omitempty"`
	AppVerifyURL  string `json:"appVerifyUrl,omitempty"`
}

// LoginPollInput 轮询入参（转发网关）。Type 仅个微用：mac 才允许自动滑验证。
type LoginPollInput struct {
	BotToken   string
	DeviceID   string
	UUID       string
	CaptchCode string
	Type       string
}

// LoginPoll 轮询扫码登录结果（管理面 ADMIN_TOKEN，转发网关）
func LoginPoll(ctx context.Context, in LoginPollInput) (*LoginPollResult, error) {
	if botGatewayAdminToken() == "" {
		return nil, fmt.Errorf("BOT_GATEWAY_ADMIN_TOKEN 未配置")
	}
	var out LoginPollResult
	if err := callGateway(ctx, http.MethodPost, botGatewayDefaultBaseURL()+"/api/v1/login/poll", botGatewayAdminToken(), map[string]any{
		"botToken": in.BotToken, "deviceId": in.DeviceID, "uuid": in.UUID, "captchCode": in.CaptchCode, "type": in.Type,
	}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// LoginVerify 提交辅助验证码（管理面 ADMIN_TOKEN，转发网关）
func LoginVerify(ctx context.Context, botToken, deviceID, code string) error {
	if botGatewayAdminToken() == "" {
		return fmt.Errorf("BOT_GATEWAY_ADMIN_TOKEN 未配置")
	}
	return callGateway(ctx, http.MethodPost, botGatewayDefaultBaseURL()+"/api/v1/login/verify", botGatewayAdminToken(), map[string]any{
		"botToken": botToken, "deviceId": deviceID, "code": code,
	}, nil)
}

// LoginLogout 退出指定 Bot（管理面 ADMIN_TOKEN，转发网关）
func LoginLogout(ctx context.Context, botToken, deviceID string) error {
	if botGatewayAdminToken() == "" {
		return fmt.Errorf("BOT_GATEWAY_ADMIN_TOKEN 未配置")
	}
	return callGateway(ctx, http.MethodPost, botGatewayDefaultBaseURL()+"/api/v1/login/logout", botGatewayAdminToken(), map[string]any{
		"botToken": botToken, "deviceId": deviceID,
	}, nil)
}

// ListBots 查询网关机器人列表与在线状态（管理面 ADMIN_TOKEN）
func ListBots(ctx context.Context) ([]BotInfo, error) {
	if botGatewayAdminToken() == "" {
		return nil, fmt.Errorf("BOT_GATEWAY_ADMIN_TOKEN 未配置")
	}
	var out struct {
		List []BotInfo `json:"list"`
	}
	err := callGateway(ctx, http.MethodGet, botGatewayDefaultBaseURL()+"/api/v1/bots?with_online=1", botGatewayAdminToken(), nil, &out)
	if err != nil {
		return nil, err
	}
	return out.List, nil
}
