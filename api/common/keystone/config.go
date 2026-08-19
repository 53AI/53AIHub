package keystone

import (
	"os"
	"strconv"
	"time"
)

// Config Keystone 上报模块配置，由环境变量加载
type Config struct {
	Endpoint        string
	IntegrationKey  string
	Secret          string
	ProductKey      string
	ServiceKey      string
	EnvironmentKey  string
	Timeout         time.Duration
	MaxRetries      int
	Enabled         bool
}

// LoadConfig 从环境变量加载 Keystone 配置
func LoadConfig() Config {
	return Config{
		Endpoint:        os.Getenv("KEYSTONE_ENDPOINT"),
		IntegrationKey:  envStr("KEYSTONE_INTEGRATION_KEY", "53ai-km"),
		Secret:          os.Getenv("KEYSTONE_SECRET"),
		ProductKey:      envStr("KEYSTONE_PRODUCT_KEY", "53ai-knowledge-management"),
		ServiceKey:      envStr("KEYSTONE_SERVICE_KEY", "km-backend"),
		EnvironmentKey:  envStr("KEYSTONE_ENVIRONMENT_KEY", "production"),
		Timeout:         time.Duration(envInt("KEYSTONE_TIMEOUT_SECONDS", 5)) * time.Second,
		MaxRetries:      envInt("KEYSTONE_MAX_RETRIES", 2),
		Enabled:         envBool("KEYSTONE_ENABLED", false),
	}
}

// ToClient 根据配置创建上报客户端，未启用或不完整时返回 nil
func (c *Config) ToClient() *Client {
	if !c.Enabled || c.Endpoint == "" || c.Secret == "" {
		return nil
	}
	return NewClient(c.Endpoint, c.IntegrationKey, c.Secret, c.ProductKey, c.ServiceKey, c.EnvironmentKey, c.Timeout, c.MaxRetries)
}

func envStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}