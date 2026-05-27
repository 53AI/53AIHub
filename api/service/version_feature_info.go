package service

import (
	"encoding/json"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/gin-gonic/gin"
)

type featureDescriptor struct {
	Key          string
	Name         string
	DefaultValue int64
	BoolType     bool
}

var openSourceFeatures = []featureDescriptor{
	{"agent", "Agent", -1, false},
	{"prompt", "提示词", -1, false},
	{"ai_link", "AI链接", -1, false},
	{"internal_user", "内部用户", -1, false},
	{"registered_user", "注册用户", -1, false},
	{"independent_domain", "独立域名", -1, false},
	{"wecom", "企业微信", -1, false},
	{"knowledge_base", "知识库", -1, true},
	{"space_count", "空间数量", -1, false},
	{"library_count", "知识库数量", -1, false},
	{"document_count", "文档数量", -1, false},
	{"storage_capacity", "存储容量", -1, false},
}

type FeatureLimit struct {
	Max  int64  `json:"max"`
	Name string `json:"name"`
}

type DisabledFeaturesMap map[string]FeatureLimit

type FeatureLimitResponse struct {
	FeatureKey string      `json:"feature_key"`
	Value      interface{} `json:"value"`
}

func GetEnterpriseFeatureLimits(c *gin.Context) ([]FeatureLimitResponse, error) {
	return getOpenSourceFeatureLimits(), nil
}

func getOpenSourceFeatureLimits() []FeatureLimitResponse {
	result := make([]FeatureLimitResponse, 0, len(openSourceFeatures))
	for _, f := range openSourceFeatures {
		var value interface{} = f.DefaultValue
		if f.BoolType {
			value = f.DefaultValue > 0 || f.DefaultValue == -1
		}
		result = append(result, FeatureLimitResponse{
			FeatureKey: f.Key,
			Value:      value,
		})
	}
	return result
}

func parseDisabledFeatures(disabledFeaturesStr string) (DisabledFeaturesMap, error) {
	var disabledFeatures DisabledFeaturesMap
	if err := json.Unmarshal([]byte(disabledFeaturesStr), &disabledFeatures); err != nil {
		logger.Error(nil, fmt.Sprintf("Failed to parse disabled features: %v", err))
		return nil, err
	}
	return disabledFeatures, nil
}
