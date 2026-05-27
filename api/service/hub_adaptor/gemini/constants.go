package gemini

import (
	"regexp"
	"strconv"
	"strings"
)

// 版本阈值常量
const (
	ThinkingVersionThreshold = 2.5 // >= 2.5 的模型支持 thinking
	BetaVersionThreshold     = 2.5 // >= 2.5 的模型需要 beta API
)

var (
	// 特殊 thinking 模型（低于阈值但支持 thinking）
	specialThinkingModels = map[string]bool{
		"gemini-2.0-flash-thinking-exp": true,
	}

	// 版本号提取正则
	versionRegex = regexp.MustCompile(`gemini-(\d+(?:\.\d+)?)`)
)

var ModelList = []string{
	"gemini-pro", "gemini-1.0-pro",
	"gemini-1.5-flash", "gemini-1.5-pro",
	"text-embedding-004", "aqa",
	"gemini-2.0-flash-exp",
	"gemini-2.0-flash-thinking-exp",
	"gemini-2.5-flash-lite",
	"gemini-2.5-flash",
	"gemini-2.5-pro",
	"gemini-3-flash-preview",
	"gemini-3.1-flash-lite-preview",
	"gemini-3.1-pro-preview",
	"gemini-3-pro-image-preview",
}

// parseModelVersion 解析模型版本号
func parseModelVersion(modelName string) float64 {
	matches := versionRegex.FindStringSubmatch(modelName)
	if len(matches) > 1 {
		version, _ := strconv.ParseFloat(matches[1], 64)
		return version
	}
	return 0
}

// RequiresBetaAPI 判断是否需要 Beta API
// 规则：版本 >= 2.5 或带 exp/preview 后缀
func RequiresBetaAPI(modelName string) bool {
	// 带 exp/preview 后缀的模型
	if strings.Contains(modelName, "-exp") || strings.Contains(modelName, "-preview") {
		return true
	}
	// 版本 >= 阈值
	version := parseModelVersion(modelName)
	return version >= BetaVersionThreshold
}

// SupportsThinking 判断是否支持 Thinking
// 规则：版本 >= 2.5 且不是 flash-lite，或特殊模型
func SupportsThinking(modelName string) bool {
	// 特殊模型
	if specialThinkingModels[modelName] {
		return true
	}
	// flash-lite 不支持 thinking
	if strings.Contains(modelName, "flash-lite") {
		return false
	}
	// 版本 >= 阈值
	version := parseModelVersion(modelName)
	return version >= ThinkingVersionThreshold
}

// SupportsImageGeneration 判断是否为图像生成模型
// 规则：模型 ID 包含 "-image"
func SupportsImageGeneration(modelName string) bool {
	return strings.Contains(modelName, "-image")
}

// SupportsVisionInput 判断是否支持视觉输入（多模态）
// 规则：几乎所有 Gemini 模型都支持视觉输入，除了 embedding 和 aqa
func SupportsVisionInput(modelName string) bool {
	// embedding 模型不支持视觉
	if strings.Contains(modelName, "embedding") {
		return false
	}
	// aqa 是纯文本问答模型
	if modelName == "aqa" {
		return false
	}
	// 其余 Gemini 模型都支持视觉输入
	return strings.HasPrefix(modelName, "gemini-")
}

// 以下为兼容旧代码的映射（基于版本化规则自动生成）
// 新代码应直接使用上述函数

var ModelsRequiringBetaAPI = generateBetaAPIModels()

func generateBetaAPIModels() map[string]bool {
	result := make(map[string]bool)
	for _, model := range ModelList {
		if RequiresBetaAPI(model) {
			result[model] = true
		}
	}
	return result
}

var ModelsSupportingThinking = generateThinkingModels()

func generateThinkingModels() map[string]bool {
	result := make(map[string]bool)
	for _, model := range ModelList {
		if SupportsThinking(model) {
			result[model] = true
		}
	}
	return result
}

var ModelsSupportingImageGeneration = generateImageGenerationModels()

func generateImageGenerationModels() map[string]bool {
	result := make(map[string]bool)
	for _, model := range ModelList {
		if SupportsImageGeneration(model) {
			result[model] = true
		}
	}
	return result
}

var ModelsSupportingVisionInput = generateVisionInputModels()

func generateVisionInputModels() map[string]bool {
	result := make(map[string]bool)
	for _, model := range ModelList {
		if SupportsVisionInput(model) {
			result[model] = true
		}
	}
	return result
}
