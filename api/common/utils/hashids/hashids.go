package hashids

import (
	"errors"
	"fmt"
	"strconv"
	"sync"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/sqids/sqids-go"
)

var (
	instance   *HashidsManager
	initError  error
	once       sync.Once
)

// HashidsManager 管理Hashids编解码
type HashidsManager struct {
	sqids *sqids.Sqids
}

// Config Hashids配置
type Config struct {
	Alphabet  string   // 自定义字母表
	MinLength uint8    // 最小长度
	Blocklist []string // 黑名单词汇
}

// GetDefaultConfig 获取默认配置
func GetDefaultConfig() Config {
	return Config{
		Alphabet:  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
		MinLength: 6,
		Blocklist: []string{"admin", "user", "test", "demo"},
	}
}

// InitHashids 初始化Hashids实例
func InitHashids(config Config) error {
	once.Do(func() {
		s, err := sqids.New(sqids.Options{
			Alphabet:  config.Alphabet,
			MinLength: config.MinLength,
			Blocklist: config.Blocklist,
		})
		if err != nil {
			initError = err
			// 记录错误但不 panic，允许程序继续运行
			logger.SysErrorf("Failed to initialize Hashids: %v", err)
			return
		}
		instance = &HashidsManager{
			sqids: s,
		}
	})
	return initError
}

// GetInstance 获取Hashids实例
// 如果初始化失败，返回 nil，调用方需要检查返回值
func GetInstance() *HashidsManager {
	if instance == nil {
		// 使用默认配置初始化
		if err := InitHashids(GetDefaultConfig()); err != nil {
			logger.SysErrorf("Hashids not initialized: %v", err)
			return nil
		}
	}
	return instance
}

// GetInstanceWithError 获取Hashids实例，返回错误信息
func GetInstanceWithError() (*HashidsManager, error) {
	if instance == nil {
		if err := InitHashids(GetDefaultConfig()); err != nil {
			return nil, fmt.Errorf("hashids not initialized: %w", err)
		}
	}
	return instance, nil
}

// Encode 编码数字ID为字符串
func (h *HashidsManager) Encode(id int64) (string, error) {
	if id <= 0 {
		return "", errors.New("ID must be positive")
	}

	encoded, err := h.sqids.Encode([]uint64{uint64(id)})
	if err != nil {
		return "", err
	}

	if encoded == "" {
		return "", errors.New("failed to encode ID")
	}

	return encoded, nil
}

// Decode 解码字符串为数字ID
func (h *HashidsManager) Decode(encoded string) (int64, error) {
	if encoded == "" {
		return 0, errors.New("encoded string cannot be empty")
	}

	decoded := h.sqids.Decode(encoded)
	if len(decoded) == 0 {
		return 0, errors.New("failed to decode string")
	}

	return int64(decoded[0]), nil
}

// EncodeMultiple 编码多个数字ID
func (h *HashidsManager) EncodeMultiple(ids []int64) (string, error) {
	if len(ids) == 0 {
		return "", errors.New("IDs array cannot be empty")
	}

	uids := make([]uint64, len(ids))
	for i, id := range ids {
		if id <= 0 {
			return "", errors.New("all IDs must be positive")
		}
		uids[i] = uint64(id)
	}

	encoded, err := h.sqids.Encode(uids)
	if err != nil {
		return "", err
	}

	if encoded == "" {
		return "", errors.New("failed to encode IDs")
	}

	return encoded, nil
}

// DecodeMultiple 解码字符串为多个数字ID
func (h *HashidsManager) DecodeMultiple(encoded string) ([]int64, error) {
	if encoded == "" {
		return nil, errors.New("encoded string cannot be empty")
	}

	decoded := h.sqids.Decode(encoded)
	if len(decoded) == 0 {
		return nil, errors.New("failed to decode string")
	}

	ids := make([]int64, len(decoded))
	for i, uid := range decoded {
		ids[i] = int64(uid)
	}

	return ids, nil
}

// 便捷函数

// Encode 编码数字ID为字符串（全局函数）
func Encode(id int64) (string, error) {
	inst := GetInstance()
	if inst == nil {
		return "", errors.New("hashids not initialized")
	}
	return inst.Encode(id)
}

// Decode 解码字符串为数字ID（全局函数）
func Decode(encoded string) (int64, error) {
	inst := GetInstance()
	if inst == nil {
		return 0, errors.New("hashids not initialized")
	}
	return inst.Decode(encoded)
}

// EncodeMultiple 编码多个数字ID（全局函数）
func EncodeMultiple(ids []int64) (string, error) {
	inst := GetInstance()
	if inst == nil {
		return "", errors.New("hashids not initialized")
	}
	return inst.EncodeMultiple(ids)
}

// DecodeMultiple 解码字符串为多个数字ID（全局函数）
func DecodeMultiple(encoded string) ([]int64, error) {
	inst := GetInstance()
	if inst == nil {
		return nil, errors.New("hashids not initialized")
	}
	return inst.DecodeMultiple(encoded)
}

// IsValidHashid 检查字符串是否为有效的Hashid
func IsValidHashid(encoded string) bool {
	if encoded == "" {
		return false
	}

	// 尝试解码，如果成功则为有效
	_, err := Decode(encoded)
	return err == nil
}

// TryParseID 尝试解析ID，支持数字和Hashid格式
func TryParseID(idStr string) (int64, error) {
	if idStr == "" {
		return 0, errors.New("ID string cannot be empty")
	}

	// 首先尝试作为数字解析
	if id, err := strconv.ParseInt(idStr, 10, 64); err == nil && id > 0 {
		return id, nil
	}

	// 然后尝试作为Hashid解析
	return Decode(idStr)
}
