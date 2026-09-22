package helper

import (
	"errors"
	"unicode"
)

// 密码强度常量定义
const (
	PasswordStrengthWeak   = "weak"
	PasswordStrengthMedium = "medium"
	PasswordStrengthStrong = "strong"
)

// CountPasswordCharacterTypes 计算密码中包含的不同字符类型种类数（大写字母、小写字母、数字、特殊符号）
func CountPasswordCharacterTypes(password string) int {
	var hasUpper, hasLower, hasDigit, hasSpecial bool

	for _, r := range password {
		switch {
		case unicode.IsUpper(r):
			hasUpper = true
		case unicode.IsLower(r):
			hasLower = true
		case unicode.IsDigit(r):
			hasDigit = true
		case unicode.IsPunct(r) || unicode.IsSymbol(r):
			hasSpecial = true
		}
	}

	typesCount := 0
	if hasUpper {
		typesCount++
	}
	if hasLower {
		typesCount++
	}
	if hasDigit {
		typesCount++
	}
	if hasSpecial {
		typesCount++
	}
	return typesCount
}

// GetPasswordStrength 计算给定密码能达到的最高强度等级（weak, medium, strong）
func GetPasswordStrength(password string) string {
	length := len(password)
	if length < 6 || length > 20 {
		return ""
	}

	// 包含空格或中文字符则不合法
	for _, r := range password {
		if unicode.IsSpace(r) || unicode.Is(unicode.Han, r) {
			return ""
		}
	}

	typesCount := CountPasswordCharacterTypes(password)
	if length >= 8 && typesCount >= 3 {
		return PasswordStrengthStrong
	}
	if length >= 8 && typesCount >= 2 {
		return PasswordStrengthMedium
	}
	return PasswordStrengthWeak
}

// VerifyPasswordStrength 验证密码是否符合指定的最低强度要求
// requiredStrength 支持 "strong", "medium", "weak"；若为空则默认按 "weak" 校验
func VerifyPasswordStrength(password string, requiredStrength string) error {
	length := len(password)
	if length == 0 {
		return errors.New("密码不能为空")
	}

	// 基础字符校验：不可包含空格与中文
	for _, r := range password {
		if unicode.IsSpace(r) {
			return errors.New("密码不能包含空格")
		}
		if unicode.Is(unicode.Han, r) {
			return errors.New("密码不能包含中文")
		}
	}

	switch requiredStrength {
	case PasswordStrengthStrong:
		if length < 8 || length > 20 {
			return errors.New("密码长度需在 8-20 个字符之间")
		}
		types := CountPasswordCharacterTypes(password)
		if types < 3 {
			return errors.New("密码需至少包含大写字母、小写字母、数字、特殊符号中的三种")
		}

	case PasswordStrengthMedium:
		if length < 8 || length > 20 {
			return errors.New("密码长度需在 8-20 个字符之间")
		}
		types := CountPasswordCharacterTypes(password)
		if types < 2 {
			return errors.New("密码需至少包含字母、数字、符号中的两种")
		}

	case PasswordStrengthWeak, "":
		if length < 6 || length > 20 {
			return errors.New("密码长度需在 6-20 个字符之间")
		}

	default:
		// 未知策略回退到弱密码标准
		if length < 6 || length > 20 {
			return errors.New("密码长度需在 6-20 个字符之间")
		}
	}

	return nil
}
