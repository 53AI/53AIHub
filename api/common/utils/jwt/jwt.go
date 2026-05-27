package jwt

import (
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/utils/env"
	"github.com/golang-jwt/jwt/v5"
)

var secretKey = []byte(env.String("JWT_SECRET", "secret"))

func UserGenerateJWT(userID int64, eid int64) (string, error) {
	claims := jwt.MapClaims{
		"user_id": userID,
		"eid":     eid,
		"exp":     time.Now().Add(168 * time.Hour).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(secretKey)
}

func UserParseJWT(tokenString string) (int64, int64, error) {
	tokenString = strings.TrimSpace(tokenString)
	if tokenString == "" {
		return 0, 0, jwt.ErrTokenMalformed
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if token == nil || token.Method == nil || token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, jwt.ErrTokenSignatureInvalid
		}
		return secretKey, nil
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
