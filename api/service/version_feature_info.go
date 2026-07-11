package service

import (
	"encoding/json"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	saas_model "github.com/53AI/53AIHub/saas/model"
	"github.com/53AI/53AIHub/saas/service"
	"github.com/gin-gonic/gin"
)

// FeatureLimitResponse 表示功能限制响应
type FeatureLimitResponse struct {
	FeatureKey string      `json:"feature_key"`
	Value      interface{} `json:"value"` // 对于布尔型功能（如knowledge_base）返回true/false，对于有限制的数量型功能返回具体限制数量
}

// GetEnterpriseFeatureLimits 获取企业所有功能限制
// 不需要身份验证，直接返回企业功能限制信息
func GetEnterpriseFeatureLimits(c *gin.Context) ([]FeatureLimitResponse, error) {
	if !config.IS_SAAS {
		return getOpenSourceFeatureLimits(), nil
	}

	// 获取企业版本和功能覆盖配置
	version, featureOverrides := service.GetSessionEnvVersion(c)

	// 获取产品配置
	product, err := service.GetProductByVersion(version, false)
	if err != nil {
		logger.Error(c.Request.Context(), fmt.Sprintf("Failed to get product info: %v", err))
		return nil, err
	}

	// 解析产品中的禁用功能
	var disabledFeatures saas_model.DisabledFeaturesMap
	if err = json.Unmarshal([]byte(product.DisabledFeatures), &disabledFeatures); err != nil {
		logger.Error(c.Request.Context(), fmt.Sprintf("Failed to parse disabled features: %v", err))
		return nil, err
	}

	// 构建响应数据
	var featureLimits []FeatureLimitResponse

	// 检查knowledge_base功能的状态
	knowledgeBaseEnabled := isFeatureEnabled(saas_model.FeatureKnowledgeBase, featureOverrides, disabledFeatures)

	// 遍历所有已知特性，确保新特性也能返回
	for _, featureKey := range AllKnownFeatures {
		// 如果knowledge_base被禁用，跳过space、library和document相关的功能
		if !knowledgeBaseEnabled && (featureKey == saas_model.FeatureSpaceCount ||
			featureKey == saas_model.FeatureLibraryCount ||
			featureKey == saas_model.FeatureDocumentCount) {
			continue
		}

		maxValue := getFeatureMaxValue(featureKey, featureOverrides, disabledFeatures)
		value := processFeatureValue(featureKey, maxValue)

		featureLimits = append(featureLimits, FeatureLimitResponse{
			FeatureKey: featureKey,
			Value:      value,
		})
	}

	return featureLimits, nil
}

func getOpenSourceFeatureLimits() []FeatureLimitResponse {
	defaultFeatures := map[string]saas_model.FeatureLimit{
		saas_model.FeatureAgent:             {Max: -1, Name: saas_model.FeatureAgentName},
		saas_model.FeaturePrompt:            {Max: -1, Name: saas_model.FeaturePromptName},
		saas_model.FeatureAiLink:            {Max: -1, Name: saas_model.FeatureAiLinkName},
		saas_model.FeatureInternalUser:      {Max: -1, Name: saas_model.FeatureInternalUserName},
		saas_model.FeatureRegisteredUser:    {Max: -1, Name: saas_model.FeatureRegisteredUserName},
		saas_model.FeatureIndependentDomain: {Max: -1, Name: saas_model.FeatureIndependentDomainName},
		saas_model.FeatureWecom:             {Max: -1, Name: saas_model.FeatureWecomName},
		saas_model.FeatureKnowledgeBase:     {Max: -1, Name: saas_model.FeatureKnowledgeBaseName},
		saas_model.FeatureSpaceCount:        {Max: -1, Name: saas_model.FeatureSpaceCountName},
		saas_model.FeatureLibraryCount:      {Max: -1, Name: saas_model.FeatureLibraryCountName},
		saas_model.FeatureDocumentCount:     {Max: -1, Name: saas_model.FeatureDocumentCountName},
		saas_model.FeatureStorageCapacity:   {Max: -1, Name: saas_model.FeatureStorageCapacityName},
	}

	featureLimits := make([]FeatureLimitResponse, 0, len(defaultFeatures))
	for featureKey, feature := range defaultFeatures {
		featureLimits = append(featureLimits, FeatureLimitResponse{
			FeatureKey: featureKey,
			Value:      processFeatureValue(featureKey, feature.Max),
		})
	}
	return featureLimits
}

// processFeatureValue 根据功能类型处理返回值
func processFeatureValue(featureKey string, maxLimit int64) interface{} {
	// 对于布尔型功能（如knowledge_base），只返回true/false
	if featureKey == saas_model.FeatureKnowledgeBase {
		return maxLimit > 0 || maxLimit == -1
	}
	// 对于其他功能，直接返回最大限制值（-1 表示无限制）
	return maxLimit
}

// AllKnownFeatures 所有已知特性列表，确保新特性也会被返回
var AllKnownFeatures = []string{
	saas_model.FeatureAgent,
	saas_model.FeaturePrompt,
	saas_model.FeatureAiLink,
	saas_model.FeatureInternalUser,
	saas_model.FeatureRegisteredUser,
	saas_model.FeatureIndependentDomain,
	saas_model.FeatureWecom,
	saas_model.FeatureKnowledgeBase,
	saas_model.FeatureSpaceCount,
	saas_model.FeatureLibraryCount,
	saas_model.FeatureDocumentCount,
	saas_model.FeatureStorageCapacity,
	saas_model.FeatureWorkbench,
	saas_model.FeatureRecording,
}

// isFeatureEnabled 检查某个功能是否启用
func isFeatureEnabled(featureKey string, featureOverrides map[string]saas_model.FeatureLimit, disabledFeatures saas_model.DisabledFeaturesMap) bool {
	// 首先检查覆盖配置
	if override, exists := featureOverrides[featureKey]; exists {
		return override.Max > 0 || override.Max == -1
	}

	// 然后检查默认配置
	if feature, exists := disabledFeatures[featureKey]; exists {
		return feature.Max > 0 || feature.Max == -1
	}

	// 都没有配置，默认启用（保持原有行为）
	return true
}

// getFeatureMaxValue 获取特性的最大值，优先级：覆盖配置 > 产品配置 > 默认无限制
func getFeatureMaxValue(featureKey string, featureOverrides map[string]saas_model.FeatureLimit, disabledFeatures saas_model.DisabledFeaturesMap) int64 {
	// 首先检查覆盖配置
	if override, exists := featureOverrides[featureKey]; exists {
		return override.Max
	}

	// 然后检查产品配置
	if feature, exists := disabledFeatures[featureKey]; exists {
		return feature.Max
	}

	// 都没有配置，返回 -1（无限制，保持原有行为）
	return -1
}
