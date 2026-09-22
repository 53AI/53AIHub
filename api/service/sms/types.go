package sms

// SMSProvider 定义短信供应商接口
type SMSProvider interface {
	// Send 发送短信验证码
	Send(mobile string, code string) error
	// GetName 获取供应商名称
	GetName() string
}

// SMSConfig 短信配置信息
type SMSConfig struct {
	Enabled    bool   `json:"enabled"`     // 是否启用
	Provider   string `json:"provider"`    // 供应商类型 (253chuanglan, 253chuanglanV2等)
	Account    string `json:"account"`     // 账户/用户名
	Password   string `json:"password"`    // 密码/Token
	SignName   string `json:"sign_name"`   // 签名（如【博思协创】）
	Template   string `json:"template"`    // 短信模板，为空使用代码兜底
	TemplateID string `json:"template_id"` // 模板ID（v2版本需要）
	CodeLength int    `json:"code_length"` // 验证码长度（默认4位）
	ExpiryTime int    `json:"expiry_time"` // 有效期（分钟，默认15分钟）
}

// SMSManager 短信管理器
type SMSManager struct {
	provider SMSProvider
	config   SMSConfig
}

// MaxVerifyAttempts 验证码最大尝试次数，超过即作废
const MaxVerifyAttempts = 5
