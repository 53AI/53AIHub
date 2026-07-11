package sms

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"regexp"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
)

// 常量定义
const (
	// 发送限制：1分钟内只能发送一次
	SMS_CODE_SEND_EXPIRE = 60 * time.Second

	// 发送限制：一天只能发送10次
	SMS_CODE_SEND_TIMES = 10

	// Redis key前缀
	RedisKeyPrefix      = "Api:CheckVerificationCode:"
	RedisKeyDailyPrefix = "Api:SMS:DailyCount:"
	RateLimitKeyPrefix  = "Api:SMS:RateLimit:"

	// 默认配置
	DefaultCodeLength = 4
	DefaultExpiryTime = 15 // 分钟
)

var (
	// 全局SMS管理器实例
	globalManager *SMSManager
	managerLock   sync.RWMutex

	// 手机号验证正则
	mobileRegex = regexp.MustCompile(`^1[3-9]\d{9}$`)
)

// InitSMSManager 初始化SMS管理器
func InitSMSManager(config SMSConfig) error {
	managerLock.Lock()
	defer managerLock.Unlock()

	if !config.Enabled {
		logger.SysWarn("SMS service is disabled in config")
		return nil
	}

	// 根据配置选择提供商
	var provider SMSProvider
	switch config.Provider {
	case "253chuanglan":
		provider = NewChuanglanProvider(config.Account, config.Password, config.SignName, config.Template)
	case "253chuanglanV2":
		if config.TemplateID == "" {
			return fmt.Errorf("template_id is required for 253chuanglanV2 provider")
		}
		provider = NewChuanglanV2Provider(config.Account, config.Password, config.SignName, config.TemplateID)
	default:
		return fmt.Errorf("unsupported SMS provider: %s", config.Provider)
	}

	// 设置默认值
	if config.CodeLength == 0 {
		config.CodeLength = DefaultCodeLength
	}
	if config.ExpiryTime == 0 {
		config.ExpiryTime = DefaultExpiryTime
	}

	globalManager = &SMSManager{
		provider:     provider,
		config:       config,
		rateLimitMap: make(map[string]*RateLimit),
	}

	logger.SysLog(fmt.Sprintf("SMS Manager initialized with provider: %s", provider.GetName()))
	return nil
}

// GetManager 获取全局SMS管理器
func GetManager() *SMSManager {
	managerLock.RLock()
	defer managerLock.RUnlock()
	return globalManager
}

// IsValidMobile 验证手机号格式 (中国大陆)
func IsValidMobile(mobile string) bool {
	return mobileRegex.MatchString(mobile)
}

// GenerateVerificationCode 生成指定长度的随机验证码
func GenerateVerificationCode(length int) (string, error) {
	if length <= 0 {
		length = DefaultCodeLength
	}

	var code string
	for i := 0; i < length; i++ {
		num, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", err
		}
		code += num.String()
	}
	return code, nil
}

// SendVerificationCode 发送验证码
func (m *SMSManager) SendVerificationCode(mobile string) (string, error) {
	if m == nil || m.provider == nil {
		return "", fmt.Errorf("SMS manager not initialized")
	}

	// 1. 验证手机号格式
	if !IsValidMobile(mobile) {
		return "", fmt.Errorf("invalid mobile number format")
	}

	// 2. 检查发送速率限制（1分钟内不能重复发送）
	if err := m.checkRateLimit(mobile); err != nil {
		return "", err
	}

	// 3. 检查每日发送次数限制
	if err := m.checkDailyLimit(mobile); err != nil {
		return "", err
	}

	// 4. 生成验证码
	code, err := GenerateVerificationCode(m.config.CodeLength)
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to generate verification code: %v", err))
		return "", fmt.Errorf("failed to generate code: %w", err)
	}

	// 5. 调用提供商发送短信
	if err := m.provider.Send(mobile, code); err != nil {
		logger.SysError(fmt.Sprintf("Failed to send SMS: %v", err))
		return "", fmt.Errorf("failed to send SMS: %w", err)
	}

	// 6. 存储到Redis
	expiryDuration := time.Duration(m.config.ExpiryTime) * time.Minute
	redisKey := RedisKeyPrefix + mobile

	if err := common.RedisSet(redisKey, code, expiryDuration); err != nil {
		logger.SysError(fmt.Sprintf("Failed to store code in Redis: %v", err))
		// 注：这里不直接返回错误，因为短信已经发出，只是Redis存储失败
		// 但为了系统完整性，建议记录并处理这个情况
	}

	// 7. 更新发送记录
	m.updateSendRecord(mobile)

	logger.SysLog(fmt.Sprintf("Verification code sent successfully to: %s", mobile))
	return code, nil
}

// checkRateLimit 检查发送速率限制（1分钟内不能重复发送）
func (m *SMSManager) checkRateLimit(mobile string) error {
	// 使用专门的键来跟踪发送时间，而不是检查验证码是否存在
	rateLimitKey := RateLimitKeyPrefix + mobile

	// 从Redis获取上次发送时间
	lastSendStr, err := common.RedisGet(rateLimitKey)
	if err != nil && err != common.ErrRedisNil {
		// 其他错误，但不阻止发送尝试
		logger.SysWarn(fmt.Sprintf("Error checking rate limit: %v", err))
		return nil
	}

	// 如果找到了上次发送时间
	if lastSendStr != "" {
		return fmt.Errorf("SMS code already sent, please try again after %d seconds", SMS_CODE_SEND_EXPIRE)
	}

	return nil
}

// checkDailyLimit 检查每日发送次数限制
func (m *SMSManager) checkDailyLimit(mobile string) error {
	// 获取当日0点的时间戳
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	todayStartUnix := todayStart.Unix()

	// Redis中的key是当天的
	dailyKey := fmt.Sprintf("%s%s:%d", RedisKeyDailyPrefix, mobile, todayStartUnix)

	// 获取今日发送次数
	countStr, err := common.RedisGet(dailyKey)
	if err != nil && err != common.ErrRedisNil {
		logger.SysWarn(fmt.Sprintf("Error checking daily limit: %v", err))
		// 继续执行，不完全阻止
		return nil
	}

	var count int
	if countStr != "" {
		_, _ = fmt.Sscanf(countStr, "%d", &count)
	}

	if count >= SMS_CODE_SEND_TIMES {
		return fmt.Errorf("maximum SMS codes sent today (%d), please try again tomorrow", SMS_CODE_SEND_TIMES)
	}

	return nil
}

// updateSendRecord 更新发送记录
func (m *SMSManager) updateSendRecord(mobile string) {
	// 更新频率限制记录
	rateLimitKey := RateLimitKeyPrefix + mobile
	currentTime := time.Now().Unix()
	_ = common.RedisSet(rateLimitKey, fmt.Sprintf("%d", currentTime), SMS_CODE_SEND_EXPIRE)

	// 获取当日0点的时间戳
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	todayStartUnix := todayStart.Unix()

	dailyKey := fmt.Sprintf("%s%s:%d", RedisKeyDailyPrefix, mobile, todayStartUnix)

	// 获取当前计数
	countStr, _ := common.RedisGet(dailyKey)
	var count int
	if countStr != "" {
		_, _ = fmt.Sscanf(countStr, "%d", &count)
	}

	count++

	// 计算到明天0点的剩余时间
	todayEnd := todayStart.Add(24 * time.Hour)
	remainingTime := todayEnd.Sub(now)

	// 更新Redis
	_ = common.RedisSet(dailyKey, fmt.Sprintf("%d", count), remainingTime)
}

// VerifyCode 验证验证码
func (m *SMSManager) VerifyCode(mobile string, code string) error {
	if !IsValidMobile(mobile) {
		return fmt.Errorf("invalid mobile number format")
	}

	redisKey := RedisKeyPrefix + mobile

	storedCode, err := common.RedisGet(redisKey)
	if err != nil {
		if err == common.ErrRedisNil {
			return fmt.Errorf("verification code expired or not found")
		}
		return fmt.Errorf("failed to verify code: %w", err)
	}

	if storedCode != code {
		return fmt.Errorf("invalid verification code")
	}

	// 验证成功，删除Redis中的验证码
	_ = common.RedisDel(redisKey)

	return nil
}

// GetConfig 获取当前配置
func (m *SMSManager) GetConfig() SMSConfig {
	if m == nil {
		return SMSConfig{}
	}
	return m.config
}

// IsEnabled 检查SMS服务是否启用
func (m *SMSManager) IsEnabled() bool {
	return m != nil && m.provider != nil && m.config.Enabled
}
