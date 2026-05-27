package utils

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
)

// DocumentExtensionMap 文档扩展名映射，将基础扩展名映射到包括的格式列表
var DocumentExtensionMap = map[string][]string{
	"doc":  {"doc", "docx"},
	"xls":  {"xls", "xlsx"},
	"ppt":  {"ppt", "pptx"},
	"pdf":  {"pdf"},
	"md":   {"md", "txt"},
	"html": {"html", "htm"},
}

// BaseExtensionChunkTypeMap 基础扩展名与分块类型的映射
// 定义基础扩展名（规则中的ext）支持的分块类型
var BaseExtensionChunkTypeMap = map[string][]string{
	"doc":  {"default"},
	"xls":  {"default", "qa", "data_table"},
	"ppt":  {"default"},
	"pdf":  {"default"},
	"md":   {"default"},
	"html": {"default"},
}

// DocumentSettingRule 文档设置规则
type DocumentSettingRule struct {
	Ext      string `json:"ext"`       // 文件扩展名
	Func     string `json:"func"`      // 处理函数: textin, default
	ConfigId string `json:"config_id"` // 配置ID
}

// GetDocumentSettingRules 获取清洗规则配置，参考 service/docconv/config_service.go getDocumentSettingRules
func GetDocumentSettingRules(eid int64, libraryID int64) ([]DocumentSettingRule, error) {
	setting, err := model.GetSettingByEidAndLibraryAndKey(eid, libraryID, string(model.SETTING_DOCUMENT_SETTING))
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

// MatchCleaningRule 根据扩展名匹配清洗规则
func MatchCleaningRule(ext string, rules []DocumentSettingRule) (string, int64) {
	// for _, rule := range rules {
	// 	if strings.ToLower(rule.Ext) == ext {
	// 		return rule.Func, rule.ConfigId
	// 	}
	// }

	// 尝试通过DocumentExtensionMap进行扩展匹配
	for _, rule := range rules {
		if extensions, exists := DocumentExtensionMap[rule.Ext]; exists {
			for _, extension := range extensions {
				if extension == ext {
					var configId int64
					if decodeId, err := hashids.TryParseID(rule.ConfigId); err == nil {
						configId = decodeId
					}
					return rule.Func, configId
				}
			}
		}
	}

	return "", 0 // 没有匹配到规则，返回空字符串
}

// ExtractExtension 提取文件扩展名（不带点）
func ExtractExtension(filename string) string {
	// 按点号分割文件名
	parts := strings.Split(filename, ".")

	// 如果没有点号或者只有开头有点号（隐藏文件），返回空字符串
	if len(parts) <= 1 {
		return ""
	}

	// 如果有两个以上的扩展名，取倒数第二个，否则取最后一个
	if len(parts) > 2 {
		return strings.ToLower(parts[len(parts)-2])
	}
	return strings.ToLower(parts[len(parts)-1])
}

// GetBaseExtension 通过DocumentExtensionMap反查获取基础扩展名
func GetBaseExtension(ext string) string {
	// 直接检查是否为基础扩展名
	if _, exists := BaseExtensionChunkTypeMap[ext]; exists {
		return ext
	}

	// 通过DocumentExtensionMap反查基础扩展名
	for baseExt, extensions := range DocumentExtensionMap {
		for _, extension := range extensions {
			if extension == ext {
				return baseExt
			}
		}
	}

	return "" // 没有找到匹配项，返回空字符串
}

// GetSupportedChunkTypes 获取指定文件扩展名支持的分块类型
func GetSupportedChunkTypes(ext string) []string {
	// 获取基础扩展名
	baseExt := GetBaseExtension(ext)
	if baseExt == "" {
		return []string{} // 没有找到基础扩展名，返回空
	}

	// 根据基础扩展名获取支持的分块类型
	if chunkTypes, exists := BaseExtensionChunkTypeMap[baseExt]; exists {
		return chunkTypes
	}

	return []string{} // 没有找到支持的分块类型，返回空
}

// IsChunkTypeSupported 检查指定文件扩展名是否支持特定的分块类型
func IsChunkTypeSupported(ext string, chunkType string) bool {
	supportedTypes := GetSupportedChunkTypes(ext)
	for _, supportedType := range supportedTypes {
		if supportedType == chunkType {
			return true
		}
	}
	return false
}
