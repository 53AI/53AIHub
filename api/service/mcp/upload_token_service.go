package mcp

import (
	"context"
	"time"

	"github.com/53AI/53AIHub/common/utils/jwt"
	"github.com/53AI/53AIHub/config"
)

type UploadTokenService struct{}

type UploadTokenResponse struct {
	TokenType string    `json:"token_type"`
	Scope     string    `json:"scope"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}

func NewUploadTokenService() *UploadTokenService {
	return &UploadTokenService{}
}

func (s *UploadTokenService) IssueBatchUploadToken(ctx context.Context, userID, eid, apiKeyID int64) (*UploadTokenResponse, error) {
	_ = ctx
	ttl := config.GetBatchUploadTimeout()
	token, err := jwt.GenerateUploadDelegateJWT(userID, eid, apiKeyID, jwt.UploadDelegateScopeBatch, ttl)
	if err != nil {
		return nil, err
	}

	claims, err := jwt.ParseUploadDelegateJWT(token)
	if err != nil {
		return nil, err
	}

	return &UploadTokenResponse{
		TokenType: claims.TokenType,
		Scope:     claims.Scope,
		Token:     token,
		ExpiresAt: claims.ExpiresAt.Time,
	}, nil
}
