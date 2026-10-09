package controller

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/sonicnote"
	"github.com/53AI/53AIHub/service/ticnote"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// GetRecordingDevices godoc
// @Summary 获取当前用户的录音设备配置列表
// @Tags 录音
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=[]object}
// @Router /api/recordings/devices [get]
func GetRecordingDevices(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var configs []model.RecordingDeviceConfig
	if err := model.DB.Where("eid = ? AND user_id = ?", eid, userID).Find(&configs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	// api_key 脱敏返回（复用 maskAPIKey：保留前 4 位 + **** + 后 4 位；前端展示用，完整 Key 需重新输入）
	items := make([]map[string]interface{}, 0, len(configs))
	for _, cfg := range configs {
		encodedID, _ := hashids.Encode(cfg.ID)
		items = append(items, map[string]interface{}{
			"id":          encodedID,
			"device_type": cfg.DeviceType,
			"api_key":     maskAPIKey(cfg.ApiKey),
			"enabled":     cfg.Enabled,
			"is_active":   cfg.IsActive,
		})
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(items))
}

// PutRecordingDevice godoc
// @Summary 保存当前用户的录音设备配置
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body object true "请求体" {"device_type":"sonicnote","api_key":"sk-xxx","enabled":true}
// @Success 200 {object} model.CommonResponse
// @Router /api/recordings/devices [put]
func PutRecordingDevice(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var req struct {
		DeviceType string `json:"device_type" binding:"required"`
		ApiKey     string `json:"api_key"`
		Enabled    *bool  `json:"enabled"` // 指针：缺省时保留原值（与 api_key 空保留一致）
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(err.Error()))
		return
	}
	if req.DeviceType != sonicnote.DeviceTypeSonicNote && req.DeviceType != ticnote.DeviceTypeTicNote {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("仅支持 SonicNote/TicNote 设备"))
		return
	}

	// 查询现有配置：api_key 为空保留原值；enabled 缺省保留原值
	var existing *model.RecordingDeviceConfig
	if stored, err := model.GetRecordingDeviceConfig(eid, userID, req.DeviceType); err == nil && stored != nil {
		existing = stored
	}
	apiKey := strings.TrimSpace(req.ApiKey)
	if apiKey == "" && existing != nil {
		apiKey = existing.ApiKey
	}
	if apiKey == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("api_key 不能为空"))
		return
	}

	// 绑定唯一（同企业同设备类型）：同一 key 只能绑定一个人。
	// 换 key 场景：A 换 K2 后 K1 给 B，B 可绑定（不同 user_id 的 key 未绑定他人）；B 绑已被 A 绑定的 K1 → 拒绝。
	if owner, err := model.GetRecordingDeviceConfigByKey(eid, req.DeviceType, apiKey); err == nil && owner != nil && owner.UserID != userID {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("该设备 Key 已被绑定"))
		return
	}

	enabled := req.Enabled
	if enabled == nil {
		// 首次创建默认启用；更新时保留原值
		if existing != nil {
			v := existing.Enabled
			enabled = &v
		} else {
			v := true
			enabled = &v
		}
	}

	cfg := &model.RecordingDeviceConfig{
		Eid:        eid,
		UserID:     userID,
		DeviceType: req.DeviceType,
		ApiKey:     apiKey,
		Enabled:    *enabled,
	}
	if err := model.UpsertRecordingDeviceConfig(cfg); err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// CreateRecordingDevice godoc
// @Summary 添加录音设备配置（多 key 支持）
// @Description 创建一条新的设备配置（同企业同用户同类型可多条，对应多 api_key）；返回配置 id
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body object true "请求体" {"device_type":"sonicnote","api_key":"sk-xxx","enabled":true}
// @Success 200 {object} model.CommonResponse{data=object}
// @Router /api/recordings/devices [post]
func CreateRecordingDevice(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var req struct {
		DeviceType string `json:"device_type" binding:"required"`
		ApiKey     string `json:"api_key" binding:"required"`
		Enabled    *bool  `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(err.Error()))
		return
	}
	if req.DeviceType != sonicnote.DeviceTypeSonicNote && req.DeviceType != ticnote.DeviceTypeTicNote {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("仅支持 SonicNote/TicNote 设备"))
		return
	}
	apiKey := strings.TrimSpace(req.ApiKey)
	if apiKey == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("api_key 不能为空"))
		return
	}
	// 绑定唯一（同企业同设备类型）：同一 key 只能绑定一个人
	if owner, err := model.GetRecordingDeviceConfigByKey(eid, req.DeviceType, apiKey); err == nil && owner != nil && owner.UserID != userID {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("该设备 Key 已被绑定"))
		return
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	// 首条配置自动激活（单设备兼容）；后续新增不自动切换激活
	var existingCount int64
	if err := model.DB.Model(&model.RecordingDeviceConfig{}).
		Where("eid = ? AND user_id = ?", eid, userID).Count(&existingCount).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	cfg := &model.RecordingDeviceConfig{
		Eid: eid, UserID: userID, DeviceType: req.DeviceType, ApiKey: apiKey, Enabled: enabled,
		IsActive: existingCount == 0,
	}
	if err := model.DB.Create(cfg).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	// 并发竞态校正：count==0 判断非原子，两个并发首条创建可能都置 active——
	// 创建后若该用户已存在其他 active 配置，本配置降级为非激活（保证每用户最多一条 active）。
	if cfg.IsActive {
		var otherActive int64
		if err := model.DB.Model(&model.RecordingDeviceConfig{}).
			Where("eid = ? AND user_id = ? AND is_active = ? AND id != ?", eid, userID, true, cfg.ID).
			Count(&otherActive).Error; err == nil && otherActive > 0 {
			model.DB.Model(&model.RecordingDeviceConfig{}).Where("id = ?", cfg.ID).
				Update("is_active", false)
			cfg.IsActive = false
		}
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{"id": cfg.ID}))
}

// UpdateRecordingDeviceByID godoc
// @Summary 更新指定录音设备配置（按 id）
// @Description 仅更新传入字段（api_key 为空保留原值，enabled 缺省保留原值）
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param device_id path int true "设备配置 ID（HashID）"
// @Param request body object true "请求体" {"api_key":"sk-xxx","enabled":true}
// @Success 200 {object} model.CommonResponse
// @Router /api/recordings/devices/{device_id} [put]
func UpdateRecordingDeviceByID(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	deviceID, err := hashids.TryParseID(c.Param("device_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	existing, err := model.GetRecordingDeviceConfigByID(eid, userID, deviceID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.SystemError.ToResponse(fmt.Errorf("设备配置不存在")))
		return
	}
	var req struct {
		ApiKey  string `json:"api_key"`
		Enabled *bool  `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(err.Error()))
		return
	}
	if apiKey := strings.TrimSpace(req.ApiKey); apiKey != "" {
		// 绑定唯一（同企业同设备类型）：新 key 已被他人绑定则拒绝
		if owner, err := model.GetRecordingDeviceConfigByKey(eid, existing.DeviceType, apiKey); err == nil && owner != nil && owner.UserID != userID {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("该设备 Key 已被绑定"))
			return
		}
		existing.ApiKey = apiKey
	}
	if req.Enabled != nil {
		existing.Enabled = *req.Enabled
	}
	if err := model.SaveRecordingDeviceConfig(existing); err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// SetActiveRecordingDevice godoc
// @Summary 设置当前激活设备（按 id）
// @Description 将指定设备配置设为当前激活（is_active=true），同用户其他配置自动取消激活
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param device_id path int true "设备配置 ID（HashID）"
// @Success 200 {object} model.CommonResponse
// @Router /api/recordings/devices/{device_id}/active [put]
func SetActiveRecordingDevice(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	deviceID, err := hashids.TryParseID(c.Param("device_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if _, err := model.GetRecordingDeviceConfigByID(eid, userID, deviceID); err != nil {
		c.JSON(http.StatusNotFound, model.SystemError.ToResponse(fmt.Errorf("设备配置不存在")))
		return
	}
	if err := model.SetRecordingDeviceActive(eid, userID, deviceID); err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// DeleteRecordingDeviceByID godoc
// @Summary 删除指定录音设备配置（按 id）
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param device_id path int true "设备配置 ID（HashID）"
// @Success 200 {object} model.CommonResponse
// @Router /api/recordings/devices/{device_id} [delete]
func DeleteRecordingDeviceByID(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	deviceID, err := hashids.TryParseID(c.Param("device_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if _, err := model.GetRecordingDeviceConfigByID(eid, userID, deviceID); err != nil {
		c.JSON(http.StatusNotFound, model.SystemError.ToResponse(fmt.Errorf("设备配置不存在")))
		return
	}
	if err := model.DeleteRecordingDeviceConfig(deviceID); err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// GetRecordingDeviceStatus godoc
// @Summary 探测录音设备可用性（实时调用远端验证 Key）
// @Description 用当前配置的 api_key 实时调用 SonicNote：登录验证 Key 有效性 + 拉取首页确认录音数据；返回 available 与录音总数
// @Tags 录音
// @Security BearerAuth
// @Param device_type path string true "设备类型：sonicnote"
// @Success 200 {object} model.CommonResponse{data=object}
// @Router /api/recordings/devices/{device_type}/status [get]
func GetRecordingDeviceStatus(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	deviceType := c.Param("device_type")
	if deviceType != sonicnote.DeviceTypeSonicNote && deviceType != ticnote.DeviceTypeTicNote {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("仅支持 SonicNote/TicNote 设备"))
		return
	}

	cfg, err := model.GetRecordingDeviceConfig(eid, userID, deviceType)
	if err != nil || cfg == nil {
		c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
			"device_type": deviceType, "configured": false, "enabled": false,
			"available": false, "reason": "unconfigured", "message": "未配置设备，请先绑定并填写 Key",
		}))
		return
	}
	if !cfg.Enabled {
		c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
			"device_type": deviceType, "configured": true, "enabled": false,
			"available": false, "reason": "disabled", "message": "设备未启用",
		}))
		return
	}

	// 实时探测（外部调用，15s 超时）
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	var available bool
	var total int
	var reason string
	switch deviceType {
	case sonicnote.DeviceTypeSonicNote:
		st, perr := sonicnote.GetSyncService().CheckStatus(ctx, cfg.ApiKey)
		if perr != nil {
			// CheckStatus 当前不返回 error；此分支仅为未来防御，不向客户端泄漏原始错误
			c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
				"device_type": deviceType, "configured": true, "enabled": true,
				"available": false, "reason": "probe_failed", "message": "探测失败，请稍后重试",
			}))
			return
		}
		available, total, reason = st.Available, st.TotalRecordings, st.UnavailableReason
	case ticnote.DeviceTypeTicNote:
		st, perr := ticnote.GetSyncService().CheckStatus(ctx, cfg.ApiKey)
		if perr != nil {
			c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
				"device_type": deviceType, "configured": true, "enabled": true,
				"available": false, "reason": "probe_failed", "message": "探测失败，请稍后重试",
			}))
			return
		}
		available, total, reason = st.Available, st.TotalRecordings, st.UnavailableReason
	}

	resp := map[string]interface{}{
		"device_type":      deviceType,
		"configured":       true,
		"enabled":          true,
		"available":        available,
		"total_recordings": total,
	}
	if !available {
		resp["reason"] = reason
		if reason == sonicnote.ReasonKeyInvalid { // 两设备 reason 值一致（key_invalid）
			resp["message"] = "Key 无效，请检查并重新填写"
		} else {
			resp["message"] = "网络异常，请稍后重试"
		}
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(resp))
}

const (
	defaultPreviewPageSize = 20
	maxPreviewPageSize     = 50
)

// maxSelectiveRemoteIDs 单次"选中同步"最多提交的远端录音数。
const maxSelectiveRemoteIDs = 100

// remoteRecordingIDPattern 远端录音 ID 白名单（SonicNote audioId / TicNote recordId 同格式）。
var remoteRecordingIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// GetRecordingDeviceRecordings godoc
// @Summary 预览录音设备远端录音列表（只读）
// @Description 实时登录设备账号拉取远端录音列表并标注本地同步状态；device_id 精确指定某条配置（多 Key），缺省取该类型最新一条（与 /devices/{device_type}/status 一致）
// @Tags 录音
// @Security BearerAuth
// @Param device_type path string true "设备类型：sonicnote|ticnote"
// @Param device_id query string false "设备配置 HashID（多 Key 场景精确指定）"
// @Param page query int false "页码，默认 1"
// @Param size query int false "每页条数，默认 20，最大 50"
// @Success 200 {object} model.CommonResponse{data=object}
// @Router /api/recordings/devices/{device_type}/recordings [get]
func GetRecordingDeviceRecordings(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	deviceType := c.Param("device_type")
	if deviceType != sonicnote.DeviceTypeSonicNote && deviceType != ticnote.DeviceTypeTicNote {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("仅支持 SonicNote/TicNote 设备"))
		return
	}

	var cfg *model.RecordingDeviceConfig
	if raw := strings.TrimSpace(c.Query("device_id")); raw != "" {
		id, err := hashids.TryParseID(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("device_id 格式错误"))
			return
		}
		got, err := model.GetRecordingDeviceConfigByID(eid, userID, id)
		if err != nil {
			c.JSON(http.StatusNotFound, model.SystemError.ToResponse(fmt.Errorf("设备配置不存在")))
			return
		}
		cfg = got
	} else if got, err := model.GetRecordingDeviceConfig(eid, userID, deviceType); err == nil {
		// 缺省取该类型最新一条：与 /devices/{device_type}/status 的缺省口径保持一致
		cfg = got
	}
	if cfg != nil && cfg.DeviceType != deviceType {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("设备类型与配置不匹配"))
		return
	}
	if cfg == nil || strings.TrimSpace(cfg.ApiKey) == "" {
		c.JSON(http.StatusOK, model.Success.ToResponseWithRequestID(previewEmpty(deviceType), c.GetString(helper.RequestIdKey)))
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if page < 1 {
		page = 1
	}
	if page > maxPreviewPage {
		page = maxPreviewPage
	}
	if size < 1 {
		size = defaultPreviewPageSize
	} else if size > maxPreviewPageSize {
		size = maxPreviewPageSize
	}

	// 同步进行中不读写预览缓存：避免同步中途把旧的"未同步"状态回填（失效时机正确性）
	skipCache := false
	if running, rerr := model.HasRunningRecordingSyncJob(eid, userID, deviceType); rerr == nil && running {
		skipCache = true
	}
	// 短 TTL 缓存命中则直接返回，避免重复打远端
	cacheKey := previewCacheKey(deviceType, eid, userID, cfg.ID, cfg.ApiKey, page, size)
	if !skipCache {
		if cached, ok := previewCacheGet(cacheKey); ok {
			writePreviewOK(c, deviceType, cfg, cached)
			return
		}
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()
	// 进程内并发闸：排队而非直接拒绝（避免某用户高并发把其他人打成 429）；排队超过请求超时则 504。
	select {
	case previewGate <- struct{}{}:
		defer func() { <-previewGate }()
	case <-ctx.Done():
		c.JSON(http.StatusGatewayTimeout, model.SystemError.ToNewErrorResponse("预览繁忙，请稍后重试"))
		return
	}
	var p *model.DeviceRecordingPreviewPage
	switch deviceType {
	case sonicnote.DeviceTypeSonicNote:
		got, err := sonicnote.GetSyncService().PreviewRecordings(ctx, eid, userID, cfg.ApiKey, page, size)
		if err != nil {
			writePreviewError(c, sonicnote.HTTPStatusForError(err), sonicnote.FriendlySyncError(err))
			return
		}
		p = got
	case ticnote.DeviceTypeTicNote:
		got, err := ticnote.GetSyncService().PreviewRecordings(ctx, eid, userID, cfg.ApiKey, page, size)
		if err != nil {
			writePreviewError(c, ticnote.HTTPStatusForError(err), ticnote.FriendlySyncError(err))
			return
		}
		p = got
	}
	if p == nil { // 防御：provider 返回 (nil,nil) 时不得空指针 panic
		c.JSON(http.StatusBadGateway, model.SystemError.ToNewErrorResponse("预览结果为空，请稍后重试"))
		return
	}
	if !skipCache {
		previewCacheSet(cacheKey, p)
	}
	writePreviewOK(c, deviceType, cfg, p)
}

// writePreviewError 按远端错误分类返回 HTTP 状态：设备 Key 无效 422（参数错误码），其余 502/504（系统错误码）。
// 不用 401，避免前端全局登录拦截器误判为登录态失效。
func writePreviewError(c *gin.Context, status int, message string) {
	code := model.SystemError
	if status == http.StatusUnprocessableEntity {
		code = model.ParamError
	}
	c.JSON(status, code.ToNewErrorResponse(message))
}

// writePreviewOK 输出预览成功响应（回显实际使用的 device_id 与 request_id）。
func writePreviewOK(c *gin.Context, deviceType string, cfg *model.RecordingDeviceConfig, p *model.DeviceRecordingPreviewPage) {
	items := p.Items
	if items == nil {
		items = []model.DeviceRecordingPreviewItem{}
	}
	resp := map[string]interface{}{
		"device_type": deviceType, "configured": true, "enabled": cfg.Enabled,
		"page": p.Page, "size": p.Size, "total": p.Total, "has_more": p.HasMore, "items": items,
	}
	if enc, err := hashids.Encode(cfg.ID); err == nil {
		resp["device_id"] = enc
	}
	c.JSON(http.StatusOK, model.Success.ToResponseWithRequestID(resp, c.GetString(helper.RequestIdKey)))
}

// 预览并发闸与短 TTL 缓存：抑制单实例内对远端的重复/并发放大（跨实例不共享，仅作本地保护）。
const (
	previewGateCapacity = 8
	previewCacheTTL     = 45 * time.Second
	maxPreviewPage      = 10000
)

var (
	previewGate  = make(chan struct{}, previewGateCapacity)
	previewCache = struct {
		sync.Mutex
		m map[string]previewCacheEntry
	}{m: make(map[string]previewCacheEntry)}
)

type previewCacheEntry struct {
	page    *model.DeviceRecordingPreviewPage
	expires time.Time
}

func previewCacheGet(key string) (*model.DeviceRecordingPreviewPage, bool) {
	previewCache.Lock()
	defer previewCache.Unlock()
	e, ok := previewCache.m[key]
	if !ok || time.Now().After(e.expires) {
		return nil, false
	}
	return e.page, true
}

func previewCacheSet(key string, page *model.DeviceRecordingPreviewPage) {
	previewCache.Lock()
	defer previewCache.Unlock()
	now := time.Now()
	// 顺手清理过期项，避免 map 只增不减导致内存持续上涨。
	for k, e := range previewCache.m {
		if now.After(e.expires) {
			delete(previewCache.m, k)
		}
	}
	previewCache.m[key] = previewCacheEntry{page: page, expires: now.Add(previewCacheTTL)}
}

// previewCacheKey 缓存 key 含 eid/user/配置 id 与 apiKey 指纹：多用户不串、改 Key 后不命中旧账号缓存。
func previewCacheKey(deviceType string, eid, userID, cfgID int64, apiKey string, page, size int) string {
	sum := sha256.Sum256([]byte(apiKey))
	return fmt.Sprintf("%s/%d/%d/%d/%x/%d/%d", deviceType, eid, userID, cfgID, sum[:8], page, size)
}

// previewCacheInvalidate 清掉某用户某设备的预览缓存；cfgID=0 表示该 provider 下全部配置。
// 在"同步触发"和"同步终态被轮询到"两个时机都调用，保证同步结束后预览能拿到最新状态。
func previewCacheInvalidate(deviceType string, eid, userID, cfgID int64) {
	prefix := fmt.Sprintf("%s/%d/%d/", deviceType, eid, userID)
	if cfgID > 0 {
		prefix = fmt.Sprintf("%s/%d/%d/%d/", deviceType, eid, userID, cfgID)
	}
	previewCache.Lock()
	defer previewCache.Unlock()
	for k := range previewCache.m {
		if strings.HasPrefix(k, prefix) {
			delete(previewCache.m, k)
		}
	}
}

// previewEmpty 未配置/未填 Key 时的空预览：configured=false 表示"尚不可用"（含已建配置但 Key 为空）。
func previewEmpty(deviceType string) map[string]interface{} {
	return map[string]interface{}{
		"device_type": deviceType, "configured": false, "enabled": false,
		"page": 1, "size": defaultPreviewPageSize, "total": 0, "has_more": false,
		"items": []model.DeviceRecordingPreviewItem{},
	}
}

// recordingSyncStarter 统一同步入口：sonicnote/ticnote 的 SyncService 均实现 StartSync。
type recordingSyncStarter interface {
	StartSync(ctx context.Context, eid, userID int64, deviceType string, deviceID int64, force bool, limit int, remoteIDs []string, skipDeleted bool) (int64, error)
}

// syncRecording 按 device_id（优先）或 device_type 分派同步（统一入口，避免每设备一个接口导致前端重复对接）。
func syncRecording(c *gin.Context, deviceType string, deviceID int64, force bool, limit int, remoteIDs []string, skipDeleted bool) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	if strings.TrimSpace(deviceType) == "" && deviceID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("device_type 或 device_id 必填"))
		return
	}
	if limit < 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("limit 不能为负数"))
		return
	}

	// device_id 优先：解析配置并取 device_type（用于选择 SyncService）
	if deviceID > 0 {
		cfg, err := model.GetRecordingDeviceConfigByID(eid, userID, deviceID)
		if err != nil {
			c.JSON(http.StatusNotFound, model.SystemError.ToResponse(fmt.Errorf("设备配置不存在")))
			return
		}
		deviceType = cfg.DeviceType
	}
	if len(remoteIDs) > 0 && deviceID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("选中同步需指定 device_id"))
		return
	}

	// 使用单例 SyncService：所有请求共享同一把防重入锁（每次新建实例锁不共享，防重入失效）
	var svc recordingSyncStarter
	var inProgressErr error
	switch deviceType {
	case sonicnote.DeviceTypeSonicNote:
		svc = sonicnote.GetSyncService()
		inProgressErr = sonicnote.ErrSyncInProgress
	case ticnote.DeviceTypeTicNote:
		svc = ticnote.GetSyncService()
		inProgressErr = ticnote.ErrSyncInProgress
	default:
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("仅支持 SonicNote/TicNote 设备"))
		return
	}

	jobID, err := svc.StartSync(c.Request.Context(), eid, userID, deviceType, deviceID, force, limit, remoteIDs, skipDeleted)
	if err != nil {
		// 防重入保持 code=4（前端已按此轮询）；未配置设备是参数/状态问题 → 400
		if errors.Is(err, inProgressErr) {
			c.JSON(http.StatusOK, model.SystemError.ToResponse(err))
			return
		}
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(err.Error()))
		return
	}
	// 同步触发后清预览缓存；同步进行中的预览不落缓存，终态轮询时再清一次
	previewCacheInvalidate(deviceType, eid, userID, deviceID)
	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
		"job_id": jobID,
	}))
}

// SyncRecording godoc
// @Summary 触发录音设备同步（当前用户，异步，按 device_id/device_type 分派）
// @Description 提交同步任务立即返回 job_id，后台并发拉取音频落库（幂等补缺：已同步且文件有效跳过、已同步但文件被删重导、未同步导入）；前端轮询 GET /sync-status 查看进度。device_id 指定单设备（多 key 场景）；缺省按 device_type 同步全部启用配置（单 job 串行合并计数）
// @Tags 录音
// @Security BearerAuth
// @Param request body object true "请求体" {"device_type":"sonicnote","device_id":"","remote_ids":["a1"],"skip_deleted":false,"force":false,"limit":0} device_type=sonicnote|ticnote；device_id=设备配置 HashID（可选）；remote_ids=选中同步的远端录音 ID 列表（非空时只同步这些，需同时提供 device_id，最多 100 条）；skip_deleted=true 时不同步本地已删除文件（默认 false=现状）；limit>0 最多处理 N 条远端录音（调试用，0=不限）；force 已弃用（保留兼容）
// @Success 200 {object} model.CommonResponse{data=object}
// @Router /api/recordings/sync [post]
func SyncRecording(c *gin.Context) {
	var req struct {
		DeviceType  string          `json:"device_type"`
		DeviceID    string          `json:"device_id"`    // 设备配置 HashID（可选）
		RemoteIDs   json.RawMessage `json:"remote_ids"`   // 选中同步：仅同步这些远端录音（可选；显式传 null/[] 会被拒绝，不触发全量）
		SkipDeleted bool            `json:"skip_deleted"` // true=不同步本地已删除的文件（默认 false=现状，会同步回来）
		Force       bool            `json:"force"`
		Limit       int             `json:"limit"` // 最多处理的远端录音条数，0=不限（调试用）
	}
	// 请求体可选：空 body（EOF）视为默认值（device_type/device_id 空 → 400），其余绑定错误拒绝
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(err.Error()))
		return
	}
	var deviceID int64
	if req.DeviceID != "" {
		id, err := hashids.TryParseID(req.DeviceID)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("device_id 格式错误"))
			return
		}
		deviceID = id
	}
	// 选中同步：清洗 remote_ids（数量/格式/去重）；传了该键但清洗后为空 → 400，避免误触发全量
	var remoteIDs []string
	if req.RemoteIDs != nil {
		var rawIDs []string
		if err := json.Unmarshal(req.RemoteIDs, &rawIDs); err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("remote_ids 格式错误"))
			return
		}
		seen := make(map[string]struct{}, len(rawIDs))
		for _, raw := range rawIDs {
			id := strings.TrimSpace(raw)
			if id == "" {
				continue
			}
			if !remoteRecordingIDPattern.MatchString(id) {
				c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("remote_ids 含非法记录 ID"))
				return
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			remoteIDs = append(remoteIDs, id)
		}
		if len(remoteIDs) > maxSelectiveRemoteIDs {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(fmt.Sprintf("remote_ids 最多 %d 条", maxSelectiveRemoteIDs)))
			return
		}
		if len(remoteIDs) == 0 {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("remote_ids 不能为空"))
			return
		}
	}
	syncRecording(c, req.DeviceType, deviceID, req.Force, req.Limit, remoteIDs, req.SkipDeleted)
}

// SyncSonicNote godoc
// @Summary 触发 SonicNote 同步（当前用户，异步）
// @Description 提交同步任务立即返回 job_id，后台并发拉取音频落库（幂等补缺：已同步且文件有效跳过、已同步但文件被删重导、未同步导入）；前端轮询 GET /sync-status 查看进度
// @Tags 录音
// @Security BearerAuth
// @Param request body object false "请求体" {"force": false, "limit": 0} limit>0 最多处理 N 条远端录音（调试用，0=不限）；force 已弃用（保留兼容，行为与普通同步一致）
// @Success 200 {object} model.CommonResponse{data=object}
// @Router /api/recordings/sync-sonicnote [post]
// SyncSonicNote 兼容旧接口：转发到统一同步入口（同步 sonicnote 全部启用配置）。
func SyncSonicNote(c *gin.Context) {
	var req struct {
		Force bool `json:"force"`
		Limit int  `json:"limit"` // 最多处理的远端录音条数，0=不限（调试用）
	}
	// 请求体可选：空 body（EOF）视为默认值（force=false, limit=0），其余绑定错误拒绝
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(err.Error()))
		return
	}
	syncRecording(c, sonicnote.DeviceTypeSonicNote, 0, req.Force, req.Limit, nil, false)
}

// GetRecordingSyncStatus godoc
// @Summary 查询最近一次录音设备同步状态
// @Description 返回当前用户最近一次同步任务的状态与进度计数；可选 provider 参数按设备过滤（多设备场景避免跨设备误读）
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param provider query string false "设备类型过滤（sonicnote/ticnote），缺省返回最近一次（不限设备）"
// @Success 200 {object} model.CommonResponse{data=object}
// @Router /api/recordings/sync-status [get]
func GetRecordingSyncStatus(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var job *model.RecordingSyncJob
	var err error
	provider := strings.TrimSpace(c.Query("provider"))
	if provider != "" {
		// 多设备场景：按 provider 过滤，避免用户触发 SonicNote 后轮询到 TicNote 的最近任务
		job, err = model.GetLatestRecordingSyncJobByProvider(eid, userID, provider)
	} else {
		job, err = model.GetLatestRecordingSyncJob(eid, userID)
	}
	if err != nil {
		// 无历史记录返回 null；DB 故障必须暴露为错误，不能与"无记录"混淆
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, model.Success.ToResponse(nil))
			return
		}
		logger.SysErrorf("【录音】查询同步状态失败: eid=%d user_id=%d err=%v", eid, userID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	if job.Status == "completed" || job.Status == "failed" {
		// 同步终态：清该设备预览缓存，保证前端随后预览拿到最新同步状态
		previewCacheInvalidate(job.Provider, eid, userID, 0)
	}
	// 对外展示友好文案：job.error 在 DB 中保留原始错误（取证），响应时按 provider 翻译为可行动提示
	if job.Error != "" {
		switch job.Provider {
		case ticnote.TicNoteProvider:
			job.Error = ticnote.FriendlySyncError(errors.New(job.Error))
		default:
			job.Error = sonicnote.FriendlySyncError(errors.New(job.Error))
		}
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(job))
}
