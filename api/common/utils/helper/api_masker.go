package helper

import "strings"

// MaskAPIKey 对API密钥进行脱敏处理，只显示前四位和后四位字符，中间部分用星号替代
func MaskAPIKey(apiKey string) string {
	if len(apiKey) <= 8 {
		// 如果密钥长度小于等于8，全部用星号代替
		return strings.Repeat("*", len(apiKey))
	}

	// 取前4位和后4位，中间用星号替代
	prefix := apiKey[:4]
	suffix := apiKey[len(apiKey)-4:]
	maskedPart := strings.Repeat("*", len(apiKey)-8)

	return prefix + maskedPart + suffix
}