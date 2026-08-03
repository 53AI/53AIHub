package docconv

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

// ParserHealthResult 单引擎健康检查结果，由 file-service POST /v1/parser-engines/health 返回。
// 脱敏后的安全字段，可直接透传给客户端。
type ParserHealthResult struct {
	Engine    string `json:"engine"`
	Usable    bool   `json:"usable"`
	Status    string `json:"status"`
	Message   string `json:"message,omitempty"`
	LatencyMs int64  `json:"latency_ms"`
	CheckedAt string `json:"checked_at"`
}

// EnterpriseParserHealthItem 企业解析器健康检查单项结果
type EnterpriseParserHealthItem struct {
	PlatformKey string `json:"platform_key"`
	DisplayName string `json:"display_name"`
	*ParserHealthResult
}

// healthCheckRequest 发送给 file-service 的健康检查请求体
type healthCheckRequest struct {
	ParserType string          `json:"parser_type"`
	JobParams  json.RawMessage `json:"job_params,omitempty"`
}

// healthCheckResponse file-service 返回的健康检查响应体
type healthCheckResponse struct {
	Engine    string `json:"engine"`
	Usable    bool   `json:"usable"`
	Status    string `json:"status"`
	Message   string `json:"message,omitempty"`
	LatencyMs int64  `json:"latency_ms"`
	CheckedAt string `json:"checked_at"`
}

// clientHealthChecker 抽取 Client 的健康检查能力接口，便于测试 mock
type clientHealthChecker interface {
	CheckParserHealth(ctx context.Context, parserType string, jobParams json.RawMessage) (*ParserHealthResult, error)
}

// singleflightGroup 进程内并发去重接口，复用 RAG 缓存中的相同模式
type singleflightGroup interface {
	Do(key string, fn func() (interface{}, error)) (interface{}, error)
}

type syncSingleflight struct {
	mu sync.Mutex
	m  map[string]*singleflightCall
}

type singleflightCall struct {
	wg  sync.WaitGroup
	val interface{}
	err error
}

func newSyncSingleflight() *syncSingleflight {
	return &syncSingleflight{m: make(map[string]*singleflightCall)}
}

func (s *syncSingleflight) Do(key string, fn func() (interface{}, error)) (interface{}, error) {
	s.mu.Lock()
	if s.m == nil {
		s.m = make(map[string]*singleflightCall)
	}
	if c, ok := s.m[key]; ok {
		s.mu.Unlock()
		c.wg.Wait()
		return c.val, c.err
	}
	c := &singleflightCall{}
	c.wg.Add(1)
	s.m[key] = c
	s.mu.Unlock()

	c.val, c.err = fn()
	c.wg.Done()

	s.mu.Lock()
	delete(s.m, key)
	s.mu.Unlock()

	return c.val, c.err
}

// HealthService 企业解析器健康检查服务
type HealthService struct {
	client       clientHealthChecker
	docConfigSvc *DocumentConfigService
	sf           singleflightGroup
	cacheTTL     time.Duration
	cache        healthCache
}

// healthCache 缓存接口，允许在测试时注入 mock
type healthCache interface {
	get(key string) ([]*EnterpriseParserHealthItem, bool)
	set(key string, results []*EnterpriseParserHealthItem, ttl time.Duration)
}

// redisHealthCache 使用 Redis 的缓存实现
type redisHealthCache struct{}

func (c *redisHealthCache) get(key string) ([]*EnterpriseParserHealthItem, bool) {
	if !common.IsRedisEnabled() {
		return nil, false
	}
	data, err := common.RedisGet(key)
	if err != nil {
		if errors.Is(err, common.ErrRedisNil) || errors.Is(err, common.ErrRedisNotEnabled) {
			return nil, false
		}
		logger.Warnf(context.Background(), "【缓存】读取解析器健康缓存失败: key=%s, err=%v", key, err)
		return nil, false
	}
	if data == "" {
		return nil, false
	}
	var results []*EnterpriseParserHealthItem
	if err := json.Unmarshal([]byte(data), &results); err != nil {
		logger.Warnf(context.Background(), "【缓存】解析健康缓存失败: key=%s, err=%v", key, err)
		return nil, false
	}
	return results, true
}

func (c *redisHealthCache) set(key string, results []*EnterpriseParserHealthItem, ttl time.Duration) {
	if !common.IsRedisEnabled() || len(results) == 0 {
		return
	}
	data, err := json.Marshal(results)
	if err != nil {
		logger.Warnf(context.Background(), "【缓存】序列化健康缓存失败: key=%s, err=%v", key, err)
		return
	}
	if err := common.RedisSet(key, string(data), ttl); err != nil {
		if errors.Is(err, common.ErrRedisNotEnabled) {
			return
		}
		logger.Warnf(context.Background(), "【缓存】写入健康缓存失败: key=%s, err=%v", key, err)
	}
}

// NewHealthService 创建健康检查服务
func NewHealthService(client *Client) *HealthService {
	ttlSeconds := 300 // 默认 5 分钟
	return &HealthService{
		client:       client,
		docConfigSvc: &DocumentConfigService{},
		sf:           newSyncSingleflight(),
		cacheTTL:     time.Duration(ttlSeconds) * time.Second,
		cache:        &redisHealthCache{},
	}
}

// parserHealthMapping 平台配置 → 健康检查请求的映射结果
type parserHealthMapping struct {
	ParserType string
	JobParams  json.RawMessage
}

// isDocumentParserPlatform 判断平台键是否属于文档解析器范畴
var documentParserPlatforms = map[string]bool{
	model.PLATFORM_KEY_TEXTIN:                       true,
	model.PLATFORM_KEY_MARKITDOWN:                   true,
	model.PLATFORM_KEY_MINERU_NET:                   true,
	model.PLATFORM_KEY_MINERU_LOCAL:                 true,
	model.PLATFORM_KEY_PADDLEPADDLE_PP_OCR_V5:       true,
	model.PLATFORM_KEY_PADDLEPADDLE_PP_STRUCTURE_V3: true,
	model.PLATFORM_KEY_PADDLEPADDLE_PADDLEOCR_VL:    true,
	model.PLATFORM_KEY_TINGWU:                       true,
	model.PLATFORM_KEY_BUILTIN:                      true,
	model.PLATFORM_KEY_OPENDATALOADER:               true,
}

// mapEnabledPlatformToHealth 将企业已启用的平台设置映射为健康检查请求。
// 返回可能包含 nil 条目（如 tingwu 等不需要探测的平台），调用方应过滤。
func (s *HealthService) mapEnabledPlatformToHealth(ctx context.Context, settings []model.PlatformSetting) []*parserHealthMapping {
	results := make([]*parserHealthMapping, 0, len(settings))
	for i := range settings {
		ps := &settings[i]
		if !documentParserPlatforms[ps.PlatformKey] {
			continue
		}
		mapping := s.mapSinglePlatformSetting(ps)
		if mapping != nil {
			results = append(results, mapping)
		}
	}
	return results
}

// mapSinglePlatformSetting 将单个平台设置映射为健康检查请求。
// 对于 tingwu 等平台返回 nil（由调用方处理 unsupported）。
func (s *HealthService) mapSinglePlatformSetting(ps *model.PlatformSetting) *parserHealthMapping {
	switch ps.PlatformKey {
	case model.PLATFORM_KEY_TEXTIN:
		var platformCfg TextinPlatformConfig
		if err := json.Unmarshal([]byte(ps.Setting), &platformCfg); err != nil {
			return nil
		}
		cfg := s.docConfigSvc.ConvertToTextinConfig(&platformCfg)
		jobParams := marshalWrappedConfig("textin_config", cfg)
		return &parserHealthMapping{ParserType: "textin", JobParams: jobParams}

	case model.PLATFORM_KEY_MINERU_NET:
		var platformCfg MinerUPlatformConfig
		if err := json.Unmarshal([]byte(ps.Setting), &platformCfg); err != nil {
			return nil
		}
		cfg := s.docConfigSvc.ConvertToMinerUConfig(&platformCfg)
		jobParams := marshalWrappedConfig("mineru_net_config", cfg)
		return &parserHealthMapping{ParserType: "mineru.net", JobParams: jobParams}

	case model.PLATFORM_KEY_MINERU_LOCAL:
		var platformCfg MinerULocalPlatformConfig
		if err := json.Unmarshal([]byte(ps.Setting), &platformCfg); err != nil {
			return nil
		}
		cfg := s.docConfigSvc.ConvertToMinerULocalConfig(&platformCfg)
		jobParams := marshalWrappedConfig("mineru_local_config", cfg)
		return &parserHealthMapping{ParserType: "mineru.local", JobParams: jobParams}

	case model.PLATFORM_KEY_PADDLEPADDLE_PP_OCR_V5,
		model.PLATFORM_KEY_PADDLEPADDLE_PP_STRUCTURE_V3,
		model.PLATFORM_KEY_PADDLEPADDLE_PADDLEOCR_VL:
		apiType := paddleAPIType(ps.PlatformKey)
		var platformCfg PaddlePaddlePlatformConfig
		if err := json.Unmarshal([]byte(ps.Setting), &platformCfg); err != nil {
			return nil
		}
		if platformCfg.APIType == "" {
			platformCfg.APIType = apiType
		}
		cfg := s.docConfigSvc.ConvertToPaddlePaddleConfig(&platformCfg)
		jobParams := marshalWrappedConfig("paddlepaddle_config", cfg)
		return &parserHealthMapping{ParserType: "paddlepaddle", JobParams: jobParams}

	case model.PLATFORM_KEY_BUILTIN:
		return &parserHealthMapping{ParserType: "builtin"}

	case model.PLATFORM_KEY_OPENDATALOADER:
		return &parserHealthMapping{ParserType: "opendataloader"}

	case model.PLATFORM_KEY_MARKITDOWN:
		return &parserHealthMapping{ParserType: "markitdown"}

	case model.PLATFORM_KEY_TINGWU:
		return nil

	default:
		return nil
	}
}

// paddleAPIType 返回 PaddlePaddle 平台键对应的 api_type 值
func paddleAPIType(platformKey string) string {
	switch platformKey {
	case model.PLATFORM_KEY_PADDLEPADDLE_PP_OCR_V5:
		return model.PADDLEPADDLE_API_TYPE_PP_OCR_V5
	case model.PLATFORM_KEY_PADDLEPADDLE_PP_STRUCTURE_V3:
		return model.PADDLEPADDLE_API_TYPE_PP_STRUCTURE_V3
	case model.PLATFORM_KEY_PADDLEPADDLE_PADDLEOCR_VL:
		return model.PADDLEPADDLE_API_TYPE_PADDLEOCR_VL
	default:
		return ""
	}
}

// unsupportedResponse 为不受支持的平台（如 tingwu）构造脱敏结果
func unsupportedResponse(platformKey, displayName, parserType string) *EnterpriseParserHealthItem {
	return &EnterpriseParserHealthItem{
		PlatformKey: platformKey,
		DisplayName: displayName,
		ParserHealthResult: &ParserHealthResult{
			Engine:    parserType,
			Usable:    false,
			Status:    "unsupported",
			Message:   "this parser type is not supported by the health check endpoint",
			LatencyMs: 0,
			CheckedAt: time.Now().UTC().Format(time.RFC3339),
		},
	}
}

// marshalWrappedConfig 将配置结构体包装到指定 key 下，返回 json.RawMessage
func marshalWrappedConfig(key string, cfg interface{}) json.RawMessage {
	wrapper := map[string]interface{}{key: cfg}
	data, err := json.Marshal(wrapper)
	if err != nil {
		return nil
	}
	return json.RawMessage(data)
}

// computeCacheFingerprint 计算平台设置的 SHA-256 指纹。
// 输入包含企业 ID、平台键、状态和配置内容，输出为十六进制摘要。
// 指纹不含明文凭证，可安全用于 Redis key。
func computeCacheFingerprint(eid int64, settings []model.PlatformSetting) string {
	h := sha256.New()
	// 将企业 ID 作为确定性输入的一部分
	_, _ = fmt.Fprintf(h, "eid=%d\n", eid)
	for i := range settings {
		ps := &settings[i]
		_, _ = fmt.Fprintf(h, "key=%s,status=%s,setting=%s\n", ps.PlatformKey, ps.Status, ps.Setting)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// getCachedHealthResult 从 Redis 读取缓存结果
// 内置文档解析器列表：这些引擎无需在 KM 配置平台设置，始终应参与健康检查。
var builtinParsers = []struct {
	platformKey string
	displayName string
}{
	{model.PLATFORM_KEY_BUILTIN, "Builtin Engine"},
	{model.PLATFORM_KEY_OPENDATALOADER, "OpenDataLoader"},
	{model.PLATFORM_KEY_MARKITDOWN, "MarkItDown"},
}

// ensureBuiltinParsers 确保内置解析器（builtin/opendataloader/markitdown）出现在 settings 中。
// 这些引擎无需平台设置，始终应参与健康检查。
func ensureBuiltinParsers(settings []model.PlatformSetting) []model.PlatformSetting {
	has := make(map[string]bool, len(settings))
	for i := range settings {
		has[settings[i].PlatformKey] = true
	}
	for _, bp := range builtinParsers {
		if !has[bp.platformKey] {
			settings = append(settings, model.PlatformSetting{
				PlatformKey: bp.platformKey,
				Status:      model.PLATFORM_STATUS_ENABLED,
				DisplayName: bp.displayName,
			})
		}
	}
	return settings
}

// GetEnterpriseParserHealth 检查当前企业所有已启用文档解析器的健康状态。
// 先查缓存，缓存未命中时并发探测下游，结果写入缓存后返回。
// 使用进程内 singleflight 避免同一进程内同一企业/指纹同时触发重复探测。
// forceRefresh 为 true 时跳过缓存读取，强制重新探测。
func (s *HealthService) GetEnterpriseParserHealth(ctx context.Context, eid int64, forceRefresh ...bool) ([]*EnterpriseParserHealthItem, error) {
	skipCache := len(forceRefresh) > 0 && forceRefresh[0]

	// 1. 查询企业 enabled 的平台配置
	settings, err := model.GetEnabledPlatformSettingsByEid(eid)
	if err != nil {
		logger.Errorf(ctx, "❌ [HEALTH] failed to query enabled platform settings: eid=%d, err=%v", eid, err)
		return nil, fmt.Errorf("failed to query platform settings: %w", err)
	}

	// 确保内置解析器（builtin/opendataloader/markitdown）始终参与检查
	settings = ensureBuiltinParsers(settings)

	// 2. 计算缓存指纹
	fingerprint := computeCacheFingerprint(eid, settings)
	cacheKey := common.GetParserHealthCacheKey(eid, fingerprint)

	// 3. 非强制时尝试缓存命中
	if !skipCache {
		if cached, ok := s.cache.get(cacheKey); ok {
			logger.Infof(ctx, "✅ [HEALTH] cache hit: eid=%d, key=%s", eid, cacheKey)
			return cached, nil
		}
	}

	// 4. 缓存未命中或强制刷新，使用 singleflight 去重并发探测
	raw, err := s.sf.Do(cacheKey, func() (interface{}, error) {
		return s.doHealthCheck(ctx, eid, settings, cacheKey, skipCache)
	})
	if err != nil {
		return nil, err
	}

	results, ok := raw.([]*EnterpriseParserHealthItem)
	if !ok {
		return nil, fmt.Errorf("unexpected type from singleflight: %T", raw)
	}
	return results, nil
}

// doHealthCheck 执行实际的下游探测并写入缓存（被 singleflight 保护）
func (s *HealthService) doHealthCheck(ctx context.Context, eid int64, settings []model.PlatformSetting, cacheKey string, skipCache bool) ([]*EnterpriseParserHealthItem, error) {
	// 二次检查：非强制刷新时，singleflight 等待者可能已错过第一次缓存写入
	if !skipCache {
		if cached, ok := s.cache.get(cacheKey); ok {
			return cached, nil
		}
	}

	// 映射为健康检查请求
	mappings := s.mapEnabledPlatformToHealth(ctx, settings)

	// 构建 displayName 查询
	displayNames := make(map[string]string, len(settings))
	for i := range settings {
		displayNames[settings[i].PlatformKey] = settings[i].DisplayName
	}

	// 并发探测
	results := make([]*EnterpriseParserHealthItem, 0, len(mappings))
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, m := range mappings {
		m := m
		wg.Add(1)
		go func() {
			defer wg.Done()
			item := s.checkSingleParser(ctx, m, displayNames)
			mu.Lock()
			results = append(results, item)
			mu.Unlock()
		}()
	}
	wg.Wait()

	// 查找 tingwu 等未映射的平台，直接返回 unsupported
	unsupportedPlatforms := findUnsupportedPlatforms(settings, mappings)
	for _, up := range unsupportedPlatforms {
		results = append(results, unsupportedResponse(up.PlatformKey, up.DisplayName, up.PlatformKey))
	}

	// 写入缓存（失败结果也缓存，避免下游故障时持续探测）
	s.cache.set(cacheKey, results, s.cacheTTL)

	return results, nil
}

// checkSingleParser 对单个映射执行健康检查
func (s *HealthService) checkSingleParser(ctx context.Context, m *parserHealthMapping, displayNames map[string]string) *EnterpriseParserHealthItem {
	result, err := s.client.CheckParserHealth(ctx, m.ParserType, m.JobParams)
	if err != nil {
		now := time.Now().UTC().Format(time.RFC3339)
		return &EnterpriseParserHealthItem{
			PlatformKey: m.ParserType,
			ParserHealthResult: &ParserHealthResult{
				Engine:    m.ParserType,
				Usable:    false,
				Status:    "unavailable",
				Message:   fmt.Sprintf("health check failed: %v", err),
				LatencyMs: 0,
				CheckedAt: now,
			},
		}
	}
	return &EnterpriseParserHealthItem{
		PlatformKey:        m.ParserType,
		ParserHealthResult: result,
	}
}

// findUnsupportedPlatforms 找出未映射到探测请求的平台（如 tingwu）
type unsupportedPlatform struct {
	PlatformKey string
	DisplayName string
}

func findUnsupportedPlatforms(settings []model.PlatformSetting, mappings []*parserHealthMapping) []unsupportedPlatform {
	mapped := make(map[string]bool, len(mappings))
	for _, m := range mappings {
		mapped[m.ParserType] = true
	}

	var result []unsupportedPlatform
	for i := range settings {
		ps := &settings[i]
		if !documentParserPlatforms[ps.PlatformKey] {
			continue
		}
		parserType := ps.PlatformKey
		if ps.PlatformKey == model.PLATFORM_KEY_PADDLEPADDLE_PP_OCR_V5 ||
			ps.PlatformKey == model.PLATFORM_KEY_PADDLEPADDLE_PP_STRUCTURE_V3 ||
			ps.PlatformKey == model.PLATFORM_KEY_PADDLEPADDLE_PADDLEOCR_VL {
			parserType = "paddlepaddle"
		}
		if !mapped[parserType] {
			result = append(result, unsupportedPlatform{
				PlatformKey: ps.PlatformKey,
				DisplayName: ps.DisplayName,
			})
		}
	}
	return result
}

// CheckParserHealth 向 file-service 发起单引擎健康检查。
// 响应状态以响应体 status 字段为准，HTTP 状态码仅用于网络层错误映射。
func (c *Client) CheckParserHealth(ctx context.Context, parserType string, jobParams json.RawMessage) (*ParserHealthResult, error) {
	// 使用独立的健康检查超时
	if c.healthTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.healthTimeout)
		defer cancel()
	}

	if c.baseURL == "" || c.apiKey == "" {
		return nil, &ConvertError{
			Op:      "check_parser_health",
			Code:    "config_error",
			Message: "DOC_CONVERT_BASE_URL or DOC_CONVERT_API_KEY not configured",
		}
	}

	reqBody := healthCheckRequest{
		ParserType: parserType,
		JobParams:  jobParams,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, &ConvertError{
			Op:      "check_parser_health",
			Code:    "marshal_error",
			Message: err.Error(),
		}
	}

	url := strings.TrimSuffix(c.baseURL, "/") + "/v1/parser-engines/health"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(bodyBytes)))
	if err != nil {
		return nil, &ConvertError{
			Op:      "check_parser_health",
			Code:    "request_error",
			Message: err.Error(),
		}
	}

	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	start := time.Now()
	resp, err := c.httpClient.Do(httpReq)
	latencyMs := time.Since(start).Milliseconds()

	if err != nil {
		code := "unavailable"
		if ctx.Err() != nil {
			code = "timeout"
		}
		return &ParserHealthResult{
			Engine:    parserType,
			Usable:    false,
			Status:    code,
			Message:   fmt.Sprintf("health check request failed: %v", err),
			LatencyMs: latencyMs,
			CheckedAt: time.Now().UTC().Format(time.RFC3339),
		}, nil
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return &ParserHealthResult{
			Engine:    parserType,
			Usable:    false,
			Status:    "unavailable",
			Message:   fmt.Sprintf("failed to read response body: %v", err),
			LatencyMs: latencyMs,
			CheckedAt: time.Now().UTC().Format(time.RFC3339),
		}, nil
	}

	// HTTP 层错误映射：401→unauthorized，400→invalid_config，5xx→unavailable
	if resp.StatusCode == http.StatusUnauthorized {
		return &ParserHealthResult{
			Engine:    parserType,
			Usable:    false,
			Status:    "unauthorized",
			Message:   "health check unauthorized: invalid API key",
			LatencyMs: latencyMs,
			CheckedAt: time.Now().UTC().Format(time.RFC3339),
		}, nil
	}
	if resp.StatusCode == http.StatusBadRequest {
		return &ParserHealthResult{
			Engine:    parserType,
			Usable:    false,
			Status:    "invalid_config",
			Message:   "health check request was rejected as invalid",
			LatencyMs: latencyMs,
			CheckedAt: time.Now().UTC().Format(time.RFC3339),
		}, nil
	}
	if resp.StatusCode >= 500 {
		return &ParserHealthResult{
			Engine:    parserType,
			Usable:    false,
			Status:    "unavailable",
			Message:   fmt.Sprintf("downstream service error (HTTP %d)", resp.StatusCode),
			LatencyMs: latencyMs,
			CheckedAt: time.Now().UTC().Format(time.RFC3339),
		}, nil
	}

	// 正常情况：HTTP 200，权威状态在响应体 status 字段
	var healthResp healthCheckResponse
	if err := json.Unmarshal(respBody, &healthResp); err != nil {
		return &ParserHealthResult{
			Engine:    parserType,
			Usable:    false,
			Status:    "unavailable",
			Message:   fmt.Sprintf("failed to parse health response: %v", err),
			LatencyMs: latencyMs,
			CheckedAt: time.Now().UTC().Format(time.RFC3339),
		}, nil
	}

	// 补全 latency_ms（若 file-service 未返回）
	if healthResp.LatencyMs == 0 {
		healthResp.LatencyMs = latencyMs
	}

	logger.Infof(ctx, "✅ [HEALTH] parser health check: engine=%s, status=%s, usable=%v, latency=%dms",
		healthResp.Engine, healthResp.Status, healthResp.Usable, healthResp.LatencyMs)

	return &ParserHealthResult{
		Engine:    healthResp.Engine,
		Usable:    healthResp.Usable,
		Status:    healthResp.Status,
		Message:   healthResp.Message,
		LatencyMs: healthResp.LatencyMs,
		CheckedAt: healthResp.CheckedAt,
	}, nil
}