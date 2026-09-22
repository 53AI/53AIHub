package sms

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"net"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
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
	DefaultCodeLength = 6
	DefaultExpiryTime = 15 // 分钟

	// 测试手机号固定验证码（SMS_TEST_MOBILES 命中时使用，不真实发送）
	testMobileCode = "123456"
)

// isTestMobile 判断手机号是否命中 SMS_TEST_MOBILES（逗号分隔配置）
func isTestMobile(mobile string) bool {
	if config.SMS_TEST_MOBILES == "" {
		return false
	}
	for _, m := range strings.Split(config.SMS_TEST_MOBILES, ",") {
		if strings.TrimSpace(m) == mobile {
			return true
		}
	}
	return false
}

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
		provider: provider,
		config:   config,
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

// SetGlobalManagerForTest 测试专用：注入全局管理器（仅测试使用）
func SetGlobalManagerForTest(m *SMSManager) {
	managerLock.Lock()
	defer managerLock.Unlock()
	globalManager = m
}

// NewSMSManagerForTest 测试专用：构造带指定 provider 的管理器（仅测试使用）
func NewSMSManagerForTest(provider SMSProvider, config SMSConfig) *SMSManager {
	return &SMSManager{provider: provider, config: config}
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

// SendVerificationCode 发送验证码（防刷：60s冷却 + 每日10次/号 + IP封禁/总次数/去重手机号数 + 企业每日总量）
func (m *SMSManager) SendVerificationCode(mobile string, ip string, eid int64) (string, error) {
	if m == nil || m.provider == nil {
		return "", fmt.Errorf("SMS manager not initialized")
	}

	// 1. 验证手机号格式
	if !IsValidMobile(mobile) {
		return "", fmt.Errorf("invalid mobile number format")
	}

	// 1.5 测试手机号：跳过限流与真实发送，验证码固定 123456（仅测试环境配置 SMS_TEST_MOBILES）
	if isTestMobile(mobile) {
		if err := common.RedisSet(RedisKeyPrefix+mobile, testMobileCode, time.Duration(m.config.ExpiryTime)*time.Minute); err != nil {
			logger.SysError(fmt.Sprintf("Failed to store test code in Redis: %v", err))
			return "", ErrRedisUnavailable
		}
		logger.SysLog(fmt.Sprintf("【短信测试号】手机号%s命中SMS_TEST_MOBILES：未真实发送短信，验证码固定为123456", mobile))
		return testMobileCode, nil
	}

	// 2. 冷却占坑（SET NX 原子操作，Redis故障 fail-closed）
	rateLimitKey := RateLimitKeyPrefix + mobile
	ok, err := common.RedisSetNX(rateLimitKey, "1", SMS_CODE_SEND_EXPIRE)
	if err != nil {
		logger.SysError(fmt.Sprintf("Redis unavailable while rate limiting: %v", err))
		return "", ErrRedisUnavailable
	}
	if !ok {
		return "", ErrSendTooFrequent
	}

	// 3. 每日发送次数限制（手机号维度，fail-closed）
	if err := m.checkDailyLimit(mobile); err != nil {
		return "", err
	}

	// 4. IP维度限流（白名单IP跳过；含封禁检查 + 总发送次数 + 去重手机号数）
	if !m.ipWhitelisted(ip) {
		if err := m.checkIPBan(ip); err != nil {
			return "", err
		}
		if err := m.checkIPLimit(ip, mobile); err != nil {
			return "", err
		}
	}

	// 4.5 企业维度每日发送总量（控成本/防企业内被薅）
	if err := m.checkEidDailyLimit(eid); err != nil {
		return "", err
	}

	// 5. 生成验证码
	code, err := GenerateVerificationCode(m.config.CodeLength)
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to generate verification code: %v", err))
		return "", fmt.Errorf("failed to generate code: %w", err)
	}

	// 6. 先存储到Redis（失败即返回，杜绝"短信已发出但码不可用"）
	expiryDuration := time.Duration(m.config.ExpiryTime) * time.Minute
	if err := common.RedisSet(RedisKeyPrefix+mobile, code, expiryDuration); err != nil {
		logger.SysError(fmt.Sprintf("Failed to store code in Redis: %v", err))
		return "", ErrRedisUnavailable
	}

	// 7. 调用提供商发送短信（失败回滚冷却占坑，允许立即重试）
	if err := m.provider.Send(mobile, code); err != nil {
		_ = common.RedisDel(rateLimitKey)
		_ = common.RedisDel(RedisKeyPrefix + mobile)
		logger.SysError(fmt.Sprintf("Failed to send SMS: %v", err))
		return "", fmt.Errorf("failed to send SMS: %w", err)
	}

	logger.SysLog(fmt.Sprintf("Verification code sent successfully to: %s", mobile))
	return code, nil
}

// checkDailyLimit 每日发送次数限制（INCR 原子计数，fail-closed）
func (m *SMSManager) checkDailyLimit(mobile string) error {
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	dailyKey := fmt.Sprintf("%s%s:%d", RedisKeyDailyPrefix, mobile, todayStart.Unix())

	count, err := common.RedisIncr(dailyKey)
	if err != nil {
		logger.SysError(fmt.Sprintf("Redis unavailable while checking daily limit: %v", err))
		return ErrRedisUnavailable
	}
	if count == 1 {
		// 首次计数：设置TTL到次日0点，避免key永久残留
		todayEnd := todayStart.Add(24 * time.Hour)
		_, _ = common.RedisExpire(dailyKey, todayEnd.Sub(now))
	}
	if count > SMS_CODE_SEND_TIMES {
		return ErrMobileDailyLimit
	}
	return nil
}

// ipBucketKey 归一化IP：IPv4取 /24，IPv6取 /64
func ipBucketKey(ip string) string {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return ip
	}
	if v4 := parsed.To4(); v4 != nil {
		return v4.Mask(net.CIDRMask(24, 32)).String()
	}
	return parsed.Mask(net.CIDRMask(64, 128)).String()
}

// ipWhitelisted 判断IP是否命中白名单（命中跳过IP维度限流）
// 支持两种写法：CIDR 网段（如 203.0.113.0/24）或纯 IP（如 203.0.113.9，无掩码默认按单个 IP 匹配）
func (m *SMSManager) ipWhitelisted(ip string) bool {
	if config.SMS_IP_WHITELIST == "" {
		return false
	}
	clientIP := net.ParseIP(ip)
	for _, entry := range strings.Split(config.SMS_IP_WHITELIST, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		var cidr *net.IPNet
		if _, ipNet, err := net.ParseCIDR(entry); err == nil {
			cidr = ipNet
		} else if single := net.ParseIP(entry); single != nil {
			// 纯 IP 兼容：无掩码默认按单个 IP 匹配（IPv4 /32，IPv6 /128）
			bits := 32
			if single.To4() == nil {
				bits = 128
			}
			cidr = &net.IPNet{IP: single, Mask: net.CIDRMask(bits, bits)}
		} else {
			continue // 无法解析的条目跳过
		}
		if clientIP != nil && cidr.Contains(clientIP) {
			return true
		}
	}
	return false
}

// checkIPLimit IP维度限流：按去重手机号数计数（10分钟/1小时/1天三层窗口）
func (m *SMSManager) checkIPLimit(ip, mobile string) error {
	now := time.Now()
	bucket := ipBucketKey(ip)

	// 总发送次数（10分钟窗口，含重复手机号）：堵"脚本对少量手机号狂发"
	totalKey := fmt.Sprintf("Api:SMS:IP:Total:%s:%s%d", bucket, now.Format("2006010215"), now.Minute()/10)
	total, err := common.RedisIncr(totalKey)
	if err != nil {
		logger.SysError(fmt.Sprintf("Redis unavailable while checking IP total limit: %v", err))
		return ErrRedisUnavailable
	}
	if total == 1 {
		_, _ = common.RedisExpire(totalKey, 10*time.Minute)
	}
	if total > int64(config.SMS_IP_TOTAL_LIMIT) {
		logger.SysErrorf("【短信告警】IP 段 %s 10分钟总发送 %d，超过上限 %d，本次发送已拦截", bucket, total, config.SMS_IP_TOTAL_LIMIT)
		m.setIPBan(bucket)
		return ErrIPTotalLimit
	}

	// 10分钟窗口 key（分钟/10 归桶）
	burstKey := fmt.Sprintf("Api:SMS:IP:Distinct:%s:%s%d", bucket, now.Format("2006010215"), now.Minute()/10)
	// 1小时窗口 key
	hourlyKey := fmt.Sprintf("Api:SMS:IP:Distinct:%s:%s", bucket, now.Format("2006010215"))
	// 1天窗口 key
	dailyKey := fmt.Sprintf("Api:SMS:IP:Distinct:%s:%s", bucket, now.Format("20060102"))

	checks := []struct {
		key   string
		limit int
		err   error
		ttl   time.Duration
		name  string
	}{
		{burstKey, config.SMS_IP_BURST_LIMIT, ErrIPBurstLimit, 10 * time.Minute, "10分钟"},
		{hourlyKey, config.SMS_IP_HOURLY_LIMIT, ErrIPHourlyLimit, time.Hour, "1小时"},
		{dailyKey, config.SMS_IP_DAILY_LIMIT, ErrIPDailyLimit, 24 * time.Hour, "1天"},
	}

	for _, c := range checks {
		if _, err := common.RedisSAdd(c.key, mobile); err != nil {
			logger.SysError(fmt.Sprintf("Redis unavailable while checking IP limit: %v", err))
			return ErrRedisUnavailable
		}
		// 首次创建时设置TTL（SADD返回1表示新成员；用SCARD==1近似首次，避免每次重置TTL）
		count, err := common.RedisSCard(c.key)
		if err != nil {
			logger.SysError(fmt.Sprintf("Redis unavailable while checking IP limit: %v", err))
			return ErrRedisUnavailable
		}
		if count == 1 {
			_, _ = common.RedisExpire(c.key, c.ttl)
		}
		// 突增告警：达到上限告警，超限拦截并告警
		if count >= int64(c.limit) {
			logger.SysWarnf("【短信告警】IP 段 %s 在 %s 窗口内去重手机号数 %d，已达上限 %d，疑似短信轰炸，请关注", bucket, c.name, count, c.limit)
		}
		if count > int64(c.limit) {
			logger.SysErrorf("【短信告警】IP 段 %s 在 %s 窗口内去重手机号数 %d，超过上限 %d，本次发送已拦截", bucket, c.name, count, c.limit)
			m.setIPBan(bucket)
			return c.err
		}
	}
	return nil
}

// checkIPBan 检查 IP 段是否处于封禁状态（熔断 fail-fast）
func (m *SMSManager) checkIPBan(ip string) error {
	banKey := "Api:SMS:IP:Ban:" + ipBucketKey(ip)
	exists, err := common.RedisExists(banKey)
	if err != nil {
		logger.SysError(fmt.Sprintf("Redis unavailable while checking IP ban: %v", err))
		return ErrRedisUnavailable
	}
	if exists > 0 {
		logger.SysErrorf("【短信告警】IP 段 %s 处于封禁中，本次发送已拦截", ipBucketKey(ip))
		return ErrIPBanned
	}
	return nil
}

// setIPBan 对 IP 段写入临时封禁（超限触发，熔断）
func (m *SMSManager) setIPBan(bucket string) {
	banKey := "Api:SMS:IP:Ban:" + bucket
	_, _ = common.RedisSetNX(banKey, "1", time.Duration(config.SMS_IP_BAN_MINUTES)*time.Minute)
}

// checkEidDailyLimit 企业(eid)维度每日发送总量限制（控成本）
func (m *SMSManager) checkEidDailyLimit(eid int64) error {
	if eid <= 0 {
		return nil // 无 eid 上下文不限制
	}
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	key := fmt.Sprintf("Api:SMS:EidDaily:%d:%d", eid, todayStart.Unix())
	count, err := common.RedisIncr(key)
	if err != nil {
		logger.SysError(fmt.Sprintf("Redis unavailable while checking eid daily limit: %v", err))
		return ErrRedisUnavailable
	}
	if count == 1 {
		todayEnd := todayStart.Add(24 * time.Hour)
		_, _ = common.RedisExpire(key, todayEnd.Sub(now))
	}
	if count > int64(config.SMS_EID_DAILY_LIMIT) {
		logger.SysErrorf("【短信告警】企业 %d 当日短信发送 %d，超过上限 %d，本次发送已拦截", eid, count, config.SMS_EID_DAILY_LIMIT)
		return ErrEidDailyLimit
	}
	return nil
}

// checkVerifyIPLimit 校验接口 IP 维度频率限制（防验证码爆破）
func (m *SMSManager) checkVerifyIPLimit(ip string) error {
	now := time.Now()
	bucket := ipBucketKey(ip)
	key := fmt.Sprintf("Api:SMS:Verify:IP:%s:%s%d", bucket, now.Format("2006010215"), now.Minute()/10)
	count, err := common.RedisIncr(key)
	if err != nil {
		logger.SysError(fmt.Sprintf("Redis unavailable while checking verify IP limit: %v", err))
		return ErrRedisUnavailable
	}
	if count == 1 {
		_, _ = common.RedisExpire(key, 10*time.Minute)
	}
	if count > int64(config.SMS_VERIFY_IP_BURST_LIMIT) {
		logger.SysErrorf("【短信告警】IP 段 %s 10分钟校验 %d 次，超过上限 %d，本次校验已拦截", bucket, count, config.SMS_VERIFY_IP_BURST_LIMIT)
		return ErrVerifyIPLimit
	}
	return nil
}

// VerifyCode 验证验证码（失败超限自动作废，防爆破）
func (m *SMSManager) VerifyCode(mobile string, code string, ip string) error {
	if !IsValidMobile(mobile) {
		return fmt.Errorf("invalid mobile number format")
	}

	// IP 维度校验频率限制（防验证码爆破）
	if err := m.checkVerifyIPLimit(ip); err != nil {
		return err
	}

	// 失败冷却：上次失败后需等待（防连续试码）
	cooldownKey := "Api:SMS:VerifyCooldown:" + mobile
	exists, err := common.RedisExists(cooldownKey)
	if err != nil {
		logger.SysError(fmt.Sprintf("Redis unavailable while checking verify cooldown: %v", err))
		return ErrRedisUnavailable
	}
	if exists > 0 {
		return ErrVerifyCooldown
	}

	redisKey := RedisKeyPrefix + mobile
	attemptsKey := "Api:SMS:VerifyAttempts:" + mobile

	storedCode, err := common.RedisGet(redisKey)
	if err != nil {
		if err == common.ErrRedisNil {
			return fmt.Errorf("verification code expired or not found")
		}
		logger.SysError(fmt.Sprintf("Redis unavailable while verifying code: %v", err))
		return ErrRedisUnavailable
	}

	if storedCode == code {
		// 验证成功：清理尝试计数、冷却与验证码
		_ = common.RedisDel(attemptsKey)
		_ = common.RedisDel(cooldownKey)
		_ = common.RedisDel(redisKey)
		return nil
	}

	// 验证失败：累加尝试次数，超过限制作废验证码
	attempts, incrErr := common.RedisIncr(attemptsKey)
	if incrErr != nil {
		logger.SysError(fmt.Sprintf("Redis unavailable while counting verify attempts: %v", incrErr))
		return ErrRedisUnavailable
	}
	if attempts == 1 {
		// 尝试计数TTL与验证码有效期一致，随码自然过期
		_, _ = common.RedisExpire(attemptsKey, time.Duration(m.config.ExpiryTime)*time.Minute)
	}
	if attempts >= MaxVerifyAttempts {
		_ = common.RedisDel(redisKey)
		_ = common.RedisDel(attemptsKey)
		_ = common.RedisDel(cooldownKey)
		return ErrVerifyTooManyTries
	}
	// 设置失败冷却，减缓连续试码（<=0 表示关闭冷却）
	if cooldownSec := config.SMS_VERIFY_FAIL_COOLDOWN_SECONDS; cooldownSec > 0 {
		_, _ = common.RedisSetNX(cooldownKey, "1", time.Duration(cooldownSec)*time.Second)
	}
	return fmt.Errorf("invalid verification code")
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
