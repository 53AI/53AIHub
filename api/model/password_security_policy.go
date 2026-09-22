package model

import (
	"encoding/json"
	"fmt"
)

// PasswordSecurityPolicySetting 密码强度与账号安全策略配置
type PasswordSecurityPolicySetting struct {
	Strength                 string `json:"strength"`                    // 密码强度等级: strong(强-等保三级), medium(中), weak(弱)
	ExpireEnabled            bool   `json:"expire_enabled"`              // 是否启用定期更换提醒
	ExpirePeriod             string `json:"expire_period"`               // 更换周期选项: "30", "60", "90", "180", "custom"
	CustomExpireDays         int    `json:"custom_expire_days"`          // 自定义更换周期天数
	ForceChangeOnExpired     bool   `json:"force_change_on_expired"`     // 到期强制修改密码
	BruteForceEnabled        bool   `json:"brute_force_enabled"`         // 是否启用防暴力破解
	LockAfterFailures        int    `json:"lock_after_failures"`         // 连续输错次数锁定
	LockDurationMinutes      int    `json:"lock_duration_minutes"`       // 锁定时间（分钟）
	FirstLoginChangeRequired bool   `json:"first_login_change_required"` // 首次登录强制修改密码
}

// DefaultPasswordSecurityPolicySetting 默认策略（未设置时弱密码且所有额外限制关闭，保持老企业兼容）
func DefaultPasswordSecurityPolicySetting() *PasswordSecurityPolicySetting {
	return &PasswordSecurityPolicySetting{
		Strength:                 "weak",
		ExpireEnabled:            false,
		ExpirePeriod:             "90",
		CustomExpireDays:         90,
		ForceChangeOnExpired:     false,
		BruteForceEnabled:        false,
		LockAfterFailures:        3,
		LockDurationMinutes:      15,
		FirstLoginChangeRequired: false,
	}
}

// RecommendedPasswordSecurityPolicySetting 系统推荐默认策略（等保三级标准：强密码且安全防护全开）
func RecommendedPasswordSecurityPolicySetting() *PasswordSecurityPolicySetting {
	return &PasswordSecurityPolicySetting{
		Strength:                 "strong",
		ExpireEnabled:            true,
		ExpirePeriod:             "90",
		CustomExpireDays:         90,
		ForceChangeOnExpired:     true,
		BruteForceEnabled:        true,
		LockAfterFailures:        3,
		LockDurationMinutes:      15,
		FirstLoginChangeRequired: true,
	}
}

// GetPasswordSecurityPolicySetting 获取当前企业的密码安全策略配置，如果未设置或无效则回退至默认策略
func GetPasswordSecurityPolicySetting(eid int64) (*PasswordSecurityPolicySetting, error) {
	setting, err := GetSettingByEidAndKey(eid, SETTING_PASSWORD_SECURITY_POLICY)
	if err != nil {
		return nil, fmt.Errorf("failed to get password security policy setting: %w", err)
	}

	defaultPolicy := DefaultPasswordSecurityPolicySetting()
	if setting == nil || setting.Value == "" {
		return defaultPolicy, nil
	}

	var policy PasswordSecurityPolicySetting
	if err := json.Unmarshal([]byte(setting.Value), &policy); err != nil {
		return defaultPolicy, nil
	}

	return &policy, nil
}

// ValidateOrCreatePasswordSecurityPolicySetting 验证或初始化密码安全策略设置
func ValidateOrCreatePasswordSecurityPolicySetting(eid int64) (*PasswordSecurityPolicySetting, error) {
	setting, err := GetSettingByEidAndKey(eid, SETTING_PASSWORD_SECURITY_POLICY)
	if err != nil {
		return nil, fmt.Errorf("failed to get password security policy setting: %w", err)
	}

	if setting != nil && setting.Value != "" {
		var policy PasswordSecurityPolicySetting
		if err := json.Unmarshal([]byte(setting.Value), &policy); err == nil {
			return &policy, nil
		}
	}

	defaultPolicy := DefaultPasswordSecurityPolicySetting()
	value, err := json.Marshal(defaultPolicy)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal default password security policy setting: %w", err)
	}

	newSetting := &Setting{
		Eid:       eid,
		LibraryID: 0,
		Key:       SETTING_PASSWORD_SECURITY_POLICY,
		Value:     string(value),
	}

	if err := CreateSetting(newSetting); err != nil {
		return nil, fmt.Errorf("failed to create password security policy setting: %w", err)
	}

	return defaultPolicy, nil
}

// SavePasswordSecurityPolicySetting 保存企业的密码安全策略配置
func SavePasswordSecurityPolicySetting(eid int64, policy *PasswordSecurityPolicySetting) error {
	if policy == nil {
		policy = DefaultPasswordSecurityPolicySetting()
	}
	value, err := json.Marshal(policy)
	if err != nil {
		return fmt.Errorf("failed to marshal password security policy setting: %w", err)
	}
	return UpdateOrCreateSetting(eid, SETTING_PASSWORD_SECURITY_POLICY, string(value), 0)
}

// GetEffectiveExpireDays 获取有效过期天数
func (p *PasswordSecurityPolicySetting) GetEffectiveExpireDays() int {
	if !p.ExpireEnabled {
		return 0
	}
	switch p.ExpirePeriod {
	case "30":
		return 30
	case "60":
		return 60
	case "90":
		return 90
	case "180":
		return 180
	case "custom":
		if p.CustomExpireDays > 0 {
			return p.CustomExpireDays
		}
		return 90
	default:
		return 90
	}
}
