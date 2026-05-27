package jwt

import (
	"errors"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const (
	UploadDelegateTokenType = "upload_delegate"
	UploadDelegateScopeBatch = "batch_upload"
)

// UploadDelegateClaims describes the short-lived delegated token used by batch uploads.
type UploadDelegateClaims struct {
	UserID    int64  `json:"user_id"`
	Eid       int64  `json:"eid"`
	APIKeyID  int64  `json:"api_key_id"`
	Scope     string `json:"scope"`
	TokenType string `json:"token_type"`
	jwt.RegisteredClaims
}

// GenerateUploadDelegateJWT creates a fresh delegated JWT for one upload task.
func GenerateUploadDelegateJWT(userID int64, eid int64, apiKeyID int64, scope string, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		ttl = time.Hour
	}
	now := time.Now().UTC()
	claims := UploadDelegateClaims{
		UserID:    userID,
		Eid:       eid,
		APIKeyID:  apiKeyID,
		Scope:     strings.TrimSpace(scope),
		TokenType: UploadDelegateTokenType,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        uuid.NewString(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(secretKey)
}

// ParseUploadDelegateJWT validates and parses a delegated batch upload token.
func ParseUploadDelegateJWT(tokenString string) (*UploadDelegateClaims, error) {
	tokenString = strings.TrimSpace(tokenString)
	if tokenString == "" {
		return nil, jwt.ErrTokenMalformed
	}

	claims := &UploadDelegateClaims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		if token == nil || token.Method == nil || token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, jwt.ErrTokenSignatureInvalid
		}
		return secretKey, nil
	})
	if err != nil {
		return nil, err
	}
	if token == nil || !token.Valid {
		return nil, jwt.ErrTokenInvalidClaims
	}
	if claims.TokenType != UploadDelegateTokenType {
		return nil, errors.New("token has invalid claims")
	}
	if strings.TrimSpace(claims.Scope) == "" {
		return nil, errors.New("token has invalid claims")
	}
	return claims, nil
}
