package service

import (
	"encoding/json"
	"errors"
	"net/smtp"
	"strconv"

	"github.com/53AI/53AIHub/common/utils/env"
	"github.com/53AI/53AIHub/model"
)

// ConfigContent 配置内容结构
type ConfigContent struct {
	Enable bool `json:"enable"`
	// 其他配置项可以在这里添加
}

// SmtpConfig SMTP配置结构体
type SmtpConfig struct {
	Username string `json:"username"`
	Password string `json:"password"`
	From     string `json:"from"`
	Host     string `json:"host"`
	Port     string `json:"port"`
	IsSSL    bool   `json:"is_ssl"`
}

// UnmarshalJSON 实现自定义的JSON解析，以支持多种字段名
func (s *SmtpConfig) UnmarshalJSON(data []byte) error {
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	// 处理Username字段，支持smtp_username和email_account两种字段名
	if username, ok := raw["smtp_username"]; ok {
		s.Username = getStringValue(username)
	} else if username, ok := raw["email_account"]; ok {
		s.Username = getStringValue(username)
	}

	// 处理Password字段，支持smtp_password和email_password两种字段名
	if password, ok := raw["smtp_password"]; ok {
		s.Password = getStringValue(password)
	} else if password, ok := raw["email_password"]; ok {
		s.Password = getStringValue(password)
	}

	// 处理From字段，支持smtp_from和addresser_email两种字段名
	if from, ok := raw["smtp_from"]; ok {
		s.From = getStringValue(from)
	} else if from, ok := raw["addresser_email"]; ok {
		s.From = getStringValue(from)
	}

	// 处理Host字段，支持smtp_host和server两种字段名
	if host, ok := raw["smtp_host"]; ok {
		s.Host = getStringValue(host)
	} else if host, ok := raw["server"]; ok {
		s.Host = getStringValue(host)
	}

	// 处理Port字段，支持smtp_port和port两种字段名
	if port, ok := raw["smtp_port"]; ok {
		s.Port = getStringValue(port)
	} else if port, ok := raw["port"]; ok {
		s.Port = getStringValue(port)
	}

	// 处理IsSSL字段，支持smtp_is_ssl和openTLS两种字段名
	if isSSL, ok := raw["smtp_is_ssl"]; ok {
		s.IsSSL = getBoolValue(isSSL)
	} else if isSSL, ok := raw["openTLS"]; ok {
		s.IsSSL = getBoolValue(isSSL)
	}

	return nil
}

// getStringValue 从interface{}获取字符串值
func getStringValue(value interface{}) string {
	if value == nil {
		return ""
	}

	switch v := value.(type) {
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(v)
	default:
		return ""
	}
}

// getBoolValue 从interface{}获取布尔值
func getBoolValue(value interface{}) bool {
	if value == nil {
		return false
	}

	switch v := value.(type) {
	case bool:
		return v
	case string:
		b, _ := strconv.ParseBool(v)
		return b
	case float64:
		return v != 0
	default:
		return false
	}
}

// GetEnterpriseConfigs 获取所有企业配置
func GetEnterpriseConfigs(eid int64) ([]model.EnterpriseConfig, error) {
	var configs []model.EnterpriseConfig
	err := model.DB.Where("eid = ?", eid).Find(&configs).Error
	if err != nil {
		return nil, err
	}

	if len(configs) == 0 {
		// 如果没有配置，则根据现有类型，返回默认关的空配置
		for _, configType := range model.EnterpriseConfigTypes {
			configs = append(configs, model.EnterpriseConfig{
				EID:     eid,
				Type:    configType,
				Enabled: false,
				Content: `{}`,
			})
		}
	}

	return configs, nil
}

// GetEnterpriseConfigByType 获取单个企业配置详情
func GetEnterpriseConfigByType(eid int64, configType string) (*model.EnterpriseConfig, error) {
	var config model.EnterpriseConfig
	err := model.DB.Where("eid = ? AND type = ?", eid, configType).First(&config).Error
	if err != nil {
		return nil, err
	}

	return &config, nil
}

/*
SaveEnterpriseConfig 保存或更新单个企业配置。

行为：
- 若当前 EID 下不存在指定 type 的配置，则创建一条新记录（content 与 enabled 使用传入值）。
- 若已存在，则更新该记录的 Content 与 Enabled 字段并保存。

返回值：
- 成功返回保存后的 *model.EnterpriseConfig
- 失败返回 error
*/
func SaveEnterpriseConfig(eid int64, configType string, content string, enabled bool) (*model.EnterpriseConfig, error) {
	var config model.EnterpriseConfig
	err := model.DB.Where("eid = ? AND type = ?", eid, configType).First(&config).Error

	if err != nil {
		// 未找到配置：创建新记录
		config = model.EnterpriseConfig{
			EID:     eid,
			Type:    configType,
			Content: content,
			Enabled: enabled,
		}
		err = model.DB.Create(&config).Error
		if err != nil {
			return nil, err
		}
	} else {
		// 找到配置：更新 Content 与 Enabled 后保存
		config.Content = content
		config.Enabled = enabled
		err = model.DB.Save(&config).Error
		if err != nil {
			return nil, err
		}
	}

	return &config, nil
}

// IsEnterpriseConfigEnabled 检查企业配置是否启用
func IsEnterpriseConfigEnabled(eid int64, configType string) (bool, error) {
	config, err := GetEnterpriseConfigByType(eid, configType)
	if err != nil {
		return false, err
	}

	if config.Content == "" {
		return false, nil
	}

	return config.Enabled, nil
}

// ToggleEnterpriseConfig 开关某个企业配置
func ToggleEnterpriseConfig(eid int64, configType string) (bool, error) {
	// 获取当前配置
	config, err := GetEnterpriseConfigByType(eid, configType)
	if err != nil {
		return false, err
	}

	// 切换状态
	config.Enabled = !config.Enabled

	// 保存更新后的配置
	_, err = SaveEnterpriseConfig(eid, configType, config.Content, config.Enabled)
	if err != nil {
		return false, err
	}

	return config.Enabled, nil
}

// GetSmtpConfig 获取 SMTP 配置
// 优先从 model.EnterpriseConfig 中读取，如果不存在则从 env 中读取，如果不存在，则报错
func GetSmtpConfig(eid int64) (smtp.Auth, string, string, int, bool, error) {
	config, err := GetEnterpriseConfigByType(eid, model.EnterpriseConfigTypeSMTP)
	if err != nil {
		// 数据库和环境变量中都没有配置，使用环境变量默认值
		return GetSmtpConfigFromEnv()
	}

	// 解析 SMTP 配置内容
	var smtpConfig SmtpConfig
	if err := json.Unmarshal([]byte(config.Content), &smtpConfig); err != nil {
		return nil, "", "", 0, false, err
	}

	from := smtpConfig.From
	auth := smtp.PlainAuth(
		"",
		smtpConfig.Username,
		smtpConfig.Password,
		smtpConfig.Host,
	)

	// 使用配置中的值
	host := smtpConfig.Host
	var port int
	if smtpConfig.Port != "" {
		if p, err := strconv.Atoi(smtpConfig.Port); err == nil {
			port = p
		}
	}

	isSsl := smtpConfig.IsSSL

	return auth, from, host, port, isSsl, nil
}

func GetSmtpConfigFromEnv() (smtp.Auth, string, string, int, bool, error) {
	// 解析失败，使用环境变量默认值
	from := env.String("SMTP_FROM", "")
	auth := smtp.PlainAuth(
		"",
		env.String("SMTP_USERNAME", ""),
		env.String("SMTP_PASSWORD", ""),
		env.String("SMTP_HOST", ""),
	)
	host := env.String("SMTP_HOST", "smtp.example.com")
	port := env.Int("SMTP_PORT", 587)
	isSsl := env.Bool("SMTP_IS_SSL", false)

	if from == "" || auth == nil || host == "" || port == 0 {
		return nil, "", "", 0, false, errors.New("SMTP config is incomplete")
	}
	return auth, from, host, port, isSsl, nil
}
