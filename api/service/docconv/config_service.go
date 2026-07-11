package docconv

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

// DocumentConfigService 文档配置服务
type DocumentConfigService struct {
	LibraryId int64
	ConfigId  int64
}

// NewDocumentConfigService 创建文档配置服务
func NewDocumentConfigService(libraryId int64) *DocumentConfigService {
	return &DocumentConfigService{
		LibraryId: libraryId,
	}
}

// DocumentSettingRule 文档设置规则
type DocumentSettingRule struct {
	Ext  string `json:"ext"`  // 文件扩展名
	Func string `json:"func"` // 处理函数: textin, default
}

// TextinPlatformConfig textin 平台配置
type TextinPlatformConfig struct {
	XtiAppID      string `json:"x-ti-app-id"`
	XtiSecretCode string `json:"x-ti-secret-code"`
}

// MinerUPlatformConfig mineru 平台配置
type MinerUPlatformConfig struct {
	APIKey  string `json:"api_key"`
	BaseURL string `json:"base_url"`
}

type MinerULocalPlatformConfig struct {
	BaseURL           string   `json:"base_url"`
	APIKey            string   `json:"api_key,omitempty"`
	OutputDir         string   `json:"output_dir,omitempty"`
	LangList          []string `json:"lang_list,omitempty"`
	Backend           string   `json:"backend,omitempty"`
	ParseMethod       string   `json:"parse_method,omitempty"`
	FormulaEnable     *bool    `json:"formula_enable,omitempty"`
	TableEnable       *bool    `json:"table_enable,omitempty"`
	ServerURL         string   `json:"server_url,omitempty"`
	ReturnMD          *bool    `json:"return_md,omitempty"`
	ReturnMiddleJSON  *bool    `json:"return_middle_json,omitempty"`
	ReturnModelOutput *bool    `json:"return_model_output,omitempty"`
	ReturnContentList *bool    `json:"return_content_list,omitempty"`
	ReturnImages      *bool    `json:"return_images,omitempty"`
	ResponseFormatZip *bool    `json:"response_format_zip,omitempty"`
	StartPageID       *int     `json:"start_page_id,omitempty"`
	EndPageID         *int     `json:"end_page_id,omitempty"`
}

type PaddlePaddlePlatformConfig struct {
	APIURL                    string `json:"api_url"`
	Token                     string `json:"token"`
	APIType                   string `json:"api_type,omitempty"`
	FileType                  *int   `json:"file_type,omitempty"`
	UseDocOrientationClassify *bool  `json:"use_doc_orientation_classify,omitempty"`
	UseDocUnwarping           *bool  `json:"use_doc_unwarping,omitempty"`
	UseTextlineOrientation    *bool  `json:"use_textline_orientation,omitempty"`
	UseChartRecognition       *bool  `json:"use_chart_recognition,omitempty"`
}

type TingWuPlatformConfig struct {
	AccessKeyId     string `json:"access_key_id"`
	AccessKeySecret string `json:"access_key_secret"`
	Endpoint        string `json:"endpoint"`
	AppKey          string `json:"app_key"`
}

// GetParserForFile 根据文件名和当前企业ID获取合适的解析器和配置
func (s *DocumentConfigService) GetParserForFile(ctx context.Context, eid int64, filename, theParseType string) (string, *TextinPlatformConfig, *MinerUPlatformConfig, *MinerULocalPlatformConfig, *PaddlePaddlePlatformConfig, *TingWuPlatformConfig, error) {
	logger.Infof(ctx, "🔍 [DOC_CONFIG] 查询解析器 - eid: %d, filename: %s, theParseType: %s", eid, filename, theParseType)

	// 提取扩展名
	ext := s.extractExtension(filename)
	logger.Infof(ctx, "📄 [DOC_CONFIG] 文件扩展名 - extension: %s", ext)

	var matchedFunc string
	if theParseType == "" {
		// 1. 查询 document_setting
		rules, err := s.getDocumentSettingRules(eid)
		if err != nil {
			// document_setting 错误，降级到默认
			logger.Errorf(ctx, "❌ [DOC_CONFIG] document_setting 查询失败，降级到 markitdown - eid: %d, error: %v", eid, err)
			return "markitdown", nil, nil, nil, nil, nil, nil
		}

		if len(rules) == 0 {
			logger.Infof(ctx, "📝 [DOC_CONFIG] document_setting 无配置，使用默认 markitdown - eid: %d", eid)
			return "markitdown", nil, nil, nil, nil, nil, nil
		}

		logger.Infof(ctx, "📋 [DOC_CONFIG] document_setting 规则 - eid: %d, rules: %+v", eid, rules)

		// 2. 根据文件扩展名匹配规则
		matchedFunc = s.matchRule(ext, rules)
		logger.Infof(ctx, "🎯 [DOC_CONFIG] 扩展名匹配结果 - extension: %s -> matched_func: %s", ext, matchedFunc)
	} else {
		matchedFunc = theParseType
	}

	// 3. 如果匹配到 textin，查询 textin 配置
	if matchedFunc == model.PLATFORM_KEY_TEXTIN {
		logger.Infof(ctx, "🚀 [DOC_CONFIG] 选择 textin 解析器，查询配置 - eid: %d", eid)
		config, err := s.getTextinConfig(eid)
		if err != nil {
			logger.Errorf(ctx, "❌ [DOC_CONFIG] textin 配置错误 - eid: %d, error: %v", eid, err)
			return "", nil, nil, nil, nil, nil, fmt.Errorf("textin config error: %w", err)
		}
		logger.Infof(ctx, "✅ [DOC_CONFIG] 成功获取 textin 配置 - eid: %d, app_id: %s", eid, config.XtiAppID)
		return model.PLATFORM_KEY_TEXTIN, config, nil, nil, nil, nil, nil
	}

	// 4. 如果匹配到 mineru，查询 mineru 配置
	if matchedFunc == model.PLATFORM_KEY_MINERU_NET {
		logger.Infof(ctx, "⛏️ [DOC_CONFIG] 选择 mineru 解析器，查询配置 - eid: %d", eid)
		config, err := s.getMinerUConfig(eid)
		if err != nil {
			logger.Errorf(ctx, "❌ [DOC_CONFIG] mineru 配置错误 - eid: %d, error: %v", eid, err)
			return "", nil, nil, nil, nil, nil, fmt.Errorf("mineru config error: %w", err)
		}
		logger.Infof(ctx, "✅ [DOC_CONFIG] 成功获取 mineru 配置 - eid: %d", eid)
		return model.PLATFORM_KEY_MINERU_NET, nil, config, nil, nil, nil, nil
	}

	// 4.1 如果匹配到 mineru.local，查询 mineru.local 配置
	if matchedFunc == model.PLATFORM_KEY_MINERU_LOCAL {
		logger.Infof(ctx, "⛏️ [DOC_CONFIG] 选择 mineru.local 解析器，查询配置 - eid: %d", eid)
		config, err := s.getMinerULocalConfig(eid)
		if err != nil {
			logger.Errorf(ctx, "❌ [DOC_CONFIG] mineru.local 配置错误 - eid: %d, error: %v", eid, err)
			return "", nil, nil, nil, nil, nil, fmt.Errorf("mineru.local config error: %w", err)
		}
		logger.Infof(ctx, "✅ [DOC_CONFIG] 成功获取 mineru.local 配置 - eid: %d", eid)
		return model.PLATFORM_KEY_MINERU_LOCAL, nil, nil, config, nil, nil, nil
	}

	// 5. 如果匹配到 PaddlePaddle，查询对应配置
	if matchedFunc == model.PLATFORM_KEY_PADDLEPADDLE_PP_OCR_V5 ||
		matchedFunc == model.PLATFORM_KEY_PADDLEPADDLE_PP_STRUCTURE_V3 ||
		matchedFunc == model.PLATFORM_KEY_PADDLEPADDLE_PADDLEOCR_VL {
		apiType := ""
		switch matchedFunc {
		case model.PLATFORM_KEY_PADDLEPADDLE_PP_OCR_V5:
			apiType = model.PADDLEPADDLE_API_TYPE_PP_OCR_V5
		case model.PLATFORM_KEY_PADDLEPADDLE_PP_STRUCTURE_V3:
			apiType = model.PADDLEPADDLE_API_TYPE_PP_STRUCTURE_V3
		case model.PLATFORM_KEY_PADDLEPADDLE_PADDLEOCR_VL:
			apiType = model.PADDLEPADDLE_API_TYPE_PADDLEOCR_VL
		}

		logger.Infof(ctx, "🧾 [DOC_CONFIG] 选择 PaddlePaddle OCR 解析器，查询配置 - eid: %d, platform_key: %s", eid, matchedFunc)
		config, err := s.getPaddlePaddleConfig(eid, matchedFunc, apiType)
		if err != nil {
			logger.Errorf(ctx, "❌ [DOC_CONFIG] PaddlePaddle 配置错误 - eid: %d, platform_key: %s, error: %v", eid, matchedFunc, err)
			return "", nil, nil, nil, nil, nil, fmt.Errorf("paddlepaddle config error: %w", err)
		}
		logger.Infof(ctx, "✅ [DOC_CONFIG] 成功获取 PaddlePaddle 配置 - eid: %d, api_type: %s", eid, config.APIType)
		return matchedFunc, nil, nil, nil, config, nil, nil
	}

	// 6. 如果匹配到通义听悟，查询配置
	if matchedFunc == model.PLATFORM_KEY_TINGWU {
		logger.Infof(ctx, "👂 [DOC_CONFIG] 选择 通义听悟 解析器，查询配置 - eid: %d", eid)
		config, err := s.getTingWuConfig(eid)
		if err != nil {
			logger.Errorf(ctx, "❌ [DOC_CONFIG] 通义听悟 配置错误 - eid: %d, error: %v", eid, err)
			return "", nil, nil, nil, nil, nil, fmt.Errorf("tingwu config error: %w", err)
		}
		logger.Infof(ctx, "✅ [DOC_CONFIG] 成功获取 通义听悟 配置 - eid: %d, endpoint: %s", eid, config.Endpoint)
		return model.PLATFORM_KEY_TINGWU, nil, nil, nil, nil, config, nil
	}

	// 7. 其他情况使用默认
	logger.Infof(ctx, "📄 [DOC_CONFIG] 使用默认 markitdown 解析器 - matched_func: %s", matchedFunc)
	return "markitdown", nil, nil, nil, nil, nil, nil
}

// getDocumentSettingRules 获取文档设置规则
func (s *DocumentConfigService) getDocumentSettingRules(eid int64) ([]DocumentSettingRule, error) {
	setting, err := model.GetSettingByEidAndLibraryAndKey(eid, s.LibraryId, string(model.SETTING_DOCUMENT_SETTING))
	if err != nil {
		return nil, fmt.Errorf("failed to get document_setting: %w", err)
	}

	if setting == nil || setting.Value == "" {
		// 没有配置，返回空规则
		return []DocumentSettingRule{}, nil
	}

	// 解析 JSON 配置
	var rules []DocumentSettingRule
	if err := json.Unmarshal([]byte(setting.Value), &rules); err != nil {
		return nil, fmt.Errorf("failed to parse document_setting: %w", err)
	}

	return rules, nil
}

// matchRule 根据扩展名匹配规则
func (s *DocumentConfigService) matchRule(ext string, rules []DocumentSettingRule) string {
	for _, rule := range rules {
		if strings.ToLower(rule.Ext) == ext {
			return rule.Func
		}
	}

	// 没有匹配到规则时，根据文件扩展名选择默认解析器
	lowerExt := strings.ToLower(ext)
	switch lowerExt {
	case "mp3", "wav", "m4a", "aac", "flac", "opus":
		fallthrough
	case "mp4", "avi", "mov", "wmv", "flv", "webm", "m4v":
		// 音频/视频文件使用通义听悟解析器
		return model.PLATFORM_KEY_TINGWU
	default:
		// 其他情况使用默认
		return "default" // 没有匹配到规则，使用 default
	}
}

// extractExtension 提取文件扩展名（不带点）
func (s *DocumentConfigService) extractExtension(filename string) string {
	ext := filepath.Ext(filename)
	if ext != "" {
		return strings.ToLower(ext[1:]) // 去掉点号并转小写
	}
	return ""
}

// getTextinConfig 获取 textin 配置
func (s *DocumentConfigService) getTextinConfig(eid int64) (*TextinPlatformConfig, error) {
	platformSetting, err := model.GetPlatformSettingByEidAndPlatformKey(eid, model.PLATFORM_KEY_TEXTIN)
	if err != nil {
		return nil, fmt.Errorf("failed to get textin platform setting: %w", err)
	}

	if platformSetting == nil || platformSetting.Setting == "" {
		return nil, fmt.Errorf("textin platform setting not found")
	}

	// 解析配置 JSON
	var config TextinPlatformConfig
	if err := json.Unmarshal([]byte(platformSetting.Setting), &config); err != nil {
		return nil, fmt.Errorf("failed to parse textin config: %w", err)
	}

	// 验证必需字段
	if config.XtiAppID == "" || config.XtiSecretCode == "" {
		return nil, fmt.Errorf("textin config missing required fields: x-ti-app-id or x-ti-secret-code")
	}

	return &config, nil
}

func (s *DocumentConfigService) getMinerUConfig(eid int64) (*MinerUPlatformConfig, error) {
	platformSetting, err := model.GetPlatformSettingByEidAndPlatformKey(eid, model.PLATFORM_KEY_MINERU_NET)
	if err != nil {
		return nil, fmt.Errorf("failed to get mineru platform setting: %w", err)
	}

	if platformSetting == nil || platformSetting.Setting == "" {
		return nil, fmt.Errorf("mineru platform setting not found")
	}

	// 解析配置 JSON
	var config MinerUPlatformConfig
	if err := json.Unmarshal([]byte(platformSetting.Setting), &config); err != nil {
		return nil, fmt.Errorf("failed to parse mineru config: %w", err)
	}

	// 验证必需字段
	if config.APIKey == "" {
		return nil, fmt.Errorf("create mineru.net converter: mineru.net token is required in job_params")
	}

	return &config, nil
}

func (s *DocumentConfigService) getMinerULocalConfig(eid int64) (*MinerULocalPlatformConfig, error) {
	platformSetting, err := model.GetPlatformSettingByEidAndPlatformKey(eid, model.PLATFORM_KEY_MINERU_LOCAL)
	if err != nil {
		return nil, fmt.Errorf("failed to get mineru.local platform setting: %w", err)
	}

	if platformSetting == nil || platformSetting.Setting == "" {
		return nil, fmt.Errorf("mineru.local platform setting not found")
	}

	var config MinerULocalPlatformConfig
	if err := json.Unmarshal([]byte(platformSetting.Setting), &config); err != nil {
		return nil, fmt.Errorf("failed to parse mineru.local config: %w", err)
	}

	if strings.TrimSpace(config.BaseURL) == "" {
		return nil, fmt.Errorf("mineru.local config missing required field: base_url")
	}

	return &config, nil
}

// getTingWuConfig 获取通义听悟配置
func (s *DocumentConfigService) getTingWuConfig(eid int64) (*TingWuPlatformConfig, error) {
	platformSetting, err := model.GetPlatformSettingByEidAndPlatformKey(eid, model.PLATFORM_KEY_TINGWU)
	if err != nil {
		return nil, fmt.Errorf("failed to get tingwu platform setting: %w", err)
	}

	if platformSetting == nil || platformSetting.Setting == "" {
		return nil, fmt.Errorf("tingwu platform setting not found")
	}

	// 解析配置 JSON
	var config TingWuPlatformConfig
	if err := json.Unmarshal([]byte(platformSetting.Setting), &config); err != nil {
		return nil, fmt.Errorf("failed to parse tingwu config: %w", err)
	}

	// 验证必需字段
	if config.AccessKeyId == "" || config.AccessKeySecret == "" || config.Endpoint == "" {
		return nil, fmt.Errorf("tingwu config missing required fields: access_key_id, access_key_secret or endpoint")
	}

	return &config, nil
}

func (s *DocumentConfigService) getPaddlePaddleConfig(eid int64, platformKey string, defaultAPIType string) (*PaddlePaddlePlatformConfig, error) {
	platformSetting, err := model.GetPlatformSettingByEidAndPlatformKey(eid, platformKey)
	if err != nil {
		return nil, fmt.Errorf("failed to get paddlepaddle platform setting: %w", err)
	}

	if platformSetting == nil || platformSetting.Setting == "" {
		return nil, fmt.Errorf("paddlepaddle platform setting not found: platform_key=%s", platformKey)
	}

	var config PaddlePaddlePlatformConfig
	if err := json.Unmarshal([]byte(platformSetting.Setting), &config); err != nil {
		return nil, fmt.Errorf("failed to parse paddlepaddle config: %w", err)
	}

	if strings.TrimSpace(config.APIURL) == "" || strings.TrimSpace(config.Token) == "" {
		return nil, fmt.Errorf("paddlepaddle config missing required fields: api_url or token")
	}
	if strings.TrimSpace(config.APIType) == "" {
		config.APIType = defaultAPIType
	}

	return &config, nil
}

// ConvertToTingWuConfig 转换平台配置为TingWuConfig
func (s *DocumentConfigService) ConvertToTingWuConfig(platformConfig *TingWuPlatformConfig) *TingWuConfig {
	return &TingWuConfig{
		AccessKeyId:     platformConfig.AccessKeyId,
		AccessKeySecret: platformConfig.AccessKeySecret,
		Endpoint:        platformConfig.Endpoint,
		AppKey:          platformConfig.AppKey,
	}
}

// ConvertToTextinConfig 转换平台配置为 TextinConfig (XParse v1.3)
func (s *DocumentConfigService) ConvertToTextinConfig(platformConfig *TextinPlatformConfig) *TextinConfig {
	includeTableStructure := true
	pages := true
	recognizeChemical := true
	includeHierarchy := true
	includeCharDetails := true
	titleTree := true
	removeWatermark := true
	includeInlineObjects := true
	includeImageData := true
	cropDewarp := true
	return &TextinConfig{
		AppID:      platformConfig.XtiAppID,
		SecretCode: platformConfig.XtiSecretCode,
		Parse: &TextinXParse{
			Capabilities: &TextinCapabilities{
				TableView:             "markdown",
				IncludeImageData:      &includeImageData,
				IncludeTableStructure: &includeTableStructure,
				Pages:                 &pages,
				CropDewarp:            &cropDewarp,
				RemoveWatermark:       &removeWatermark,
				TitleTree:             &titleTree,
				IncludeCharDetails:    &includeCharDetails,
				IncludeHierarchy:      &includeHierarchy,
				IncludeInlineObjects:  &includeInlineObjects,
			},
			Config: &TextinConfigBlock{
				EngineParams: &TextinEngineParams{
					ParseMode:         "auto",
					FormulaLevel:      0,
					RecognizeChemical: &recognizeChemical,
				},
			},
		},
	}
}

// ConvertToMinerUConfig 转换平台配置为 MinerUConfig
func (s *DocumentConfigService) ConvertToMinerUConfig(platformConfig *MinerUPlatformConfig) *MinerUConfig {
	// 设置布尔值的默认值
	isOCR := true
	enableFormula := true
	enableTable := true

	baseUrl := platformConfig.BaseURL
	if baseUrl == "" {
		baseUrl = "https://mineru.net/api/v4"
	}
	return &MinerUConfig{
		Token:         platformConfig.APIKey,
		BaseURL:       baseUrl,
		Language:      "ch",
		IsOCR:         &isOCR,
		EnableFormula: &enableFormula,
		EnableTable:   &enableTable,
		ModelVersion:  "vlm",
	}
}

func (s *DocumentConfigService) ConvertToMinerULocalConfig(platformConfig *MinerULocalPlatformConfig) *MinerULocalConfig {
	return &MinerULocalConfig{
		BaseURL:           platformConfig.BaseURL,
		APIKey:            platformConfig.APIKey,
		OutputDir:         platformConfig.OutputDir,
		LangList:          platformConfig.LangList,
		Backend:           platformConfig.Backend,
		ParseMethod:       platformConfig.ParseMethod,
		FormulaEnable:     platformConfig.FormulaEnable,
		TableEnable:       platformConfig.TableEnable,
		ServerURL:         platformConfig.ServerURL,
		ReturnMD:          platformConfig.ReturnMD,
		ReturnMiddleJSON:  platformConfig.ReturnMiddleJSON,
		ReturnModelOutput: platformConfig.ReturnModelOutput,
		ReturnContentList: platformConfig.ReturnContentList,
		ReturnImages:      platformConfig.ReturnImages,
		ResponseFormatZip: platformConfig.ResponseFormatZip,
		StartPageID:       platformConfig.StartPageID,
		EndPageID:         platformConfig.EndPageID,
	}
}

func (s *DocumentConfigService) ConvertToPaddlePaddleConfig(platformConfig *PaddlePaddlePlatformConfig) *PaddlePaddleConfig {
	return &PaddlePaddleConfig{
		APIURL:                    platformConfig.APIURL,
		Token:                     platformConfig.Token,
		APIType:                   platformConfig.APIType,
		FileType:                  platformConfig.FileType,
		UseDocOrientationClassify: platformConfig.UseDocOrientationClassify,
		UseDocUnwarping:           platformConfig.UseDocUnwarping,
		UseTextlineOrientation:    platformConfig.UseTextlineOrientation,
		UseChartRecognition:       platformConfig.UseChartRecognition,
	}
}
