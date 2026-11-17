package jwt

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/utils/env"
	"github.com/golang-jwt/jwt/v5"
)

// MinSecretLength JWT_SECRET 的最小长度（字节）。HS256 密钥过短可被离线爆破。
const MinSecretLength = 32

var (
	ErrSecretNotConfigured = errors.New("JWT_SECRET is not configured")
	ErrSecretTooWeak       = errors.New("JWT_SECRET must be at least 32 bytes")
)

// loadSecret 读取并校验签名密钥。禁止任何硬编码兜底：
// 缺失或过弱时签名/验签直接失败，而不是退化为公开已知密钥。
func loadSecret() ([]byte, error) {
	secret := strings.TrimSpace(env.String("JWT_SECRET", ""))
	if secret == "" {
		return nil, ErrSecretNotConfigured
	}
	if len(secret) < MinSecretLength {
		return nil, ErrSecretTooWeak
	}
	return []byte(secret), nil
}

// SecretKey 返回 JWT 签名密钥；未配置或强度不足时返回错误。
func SecretKey() ([]byte, error) {
	return loadSecret()
}

// ValidateSecretKey 供进程启动时校验密钥配置，配置不合法应拒绝启动。
func ValidateSecretKey() error {
	_, err := loadSecret()
	return err
}

func UserGenerateJWT(userID int64, eid int64) (string, error) {
	key, err := loadSecret()
	if err != nil {
		return "", err
	}

	claims := jwt.MapClaims{
		"user_id": userID,
		"eid":     eid,
		"exp":     time.Now().Add(168 * time.Hour).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(key)
}

func UserParseJWT(tokenString string) (int64, int64, error) {
	tokenString = strings.TrimSpace(tokenString)
	if tokenString == "" {
		return 0, 0, jwt.ErrTokenMalformed
	}

	key, err := loadSecret()
	if err != nil {
		return 0, 0, err
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if token == nil || token.Method == nil || token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, jwt.ErrTokenSignatureInvalid
		}
		return key, nil
	})

	if err != nil {
		return 0, 0, err
	}
	if token == nil || !token.Valid {
		return 0, 0, jwt.ErrTokenInvalidClaims
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if ok {
		// 判断是否存在 eid，如果不存在则是 saas 用户 token，这里登录无效
		if _, ok := claims["eid"]; !ok {
			// 返回无效 token 错误
			return 0, 0, jwt.ErrTokenInvalidClaims
		}

		userID, ok := claimToInt64(claims["user_id"])
		if !ok {
			return 0, 0, jwt.ErrTokenInvalidClaims
		}
		eid, ok := claimToInt64(claims["eid"])
		if !ok {
			return 0, 0, jwt.ErrTokenInvalidClaims
		}
		return userID, eid, nil
	}
	return 0, 0, err
}

func claimToInt64(v any) (int64, bool) {
	switch t := v.(type) {
	case float64:
		return int64(t), true
	case float32:
		return int64(t), true
	case int64:
		return t, true
	case int:
		return int64(t), true
	case int32:
		return int64(t), true
	case uint64:
		if t > uint64(^uint64(0)>>1) {
			return 0, false
		}
		return int64(t), true
	case uint:
		return int64(t), true
	case uint32:
		return int64(t), true
	case string:
		n, err := strconv.ParseInt(strings.TrimSpace(t), 10, 64)
		if err != nil {
			return 0, false
		}
		return n, true
	default:
		return 0, false
	}
}
