package middleware

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/model"
	"github.com/modelcontextprotocol/go-sdk/auth"
)

// MCPAuth wraps an HTTP handler with Bearer km-* authentication.
func MCPAuth(next http.Handler) http.Handler {
	return auth.RequireBearerToken(func(ctx context.Context, token string, req *http.Request) (*auth.TokenInfo, error) {
		if !strings.HasPrefix(token, model.APIKeyPrefix) {
			return nil, auth.ErrInvalidToken
		}

		apiKey, err := model.ValidateAPIKey(token)
		if err != nil {
			return nil, auth.ErrInvalidToken
		}

		user, err := model.GetUserByID(apiKey.CreatorID)
		if err != nil {
			return nil, auth.ErrInvalidToken
		}
		if user.Status == model.UserStatusDisabled {
			return nil, auth.ErrInvalidToken
		}
		if user.Eid != apiKey.Eid {
			return nil, auth.ErrInvalidToken
		}

		expiration := time.Now().Add(24 * time.Hour)
		if apiKey.ExpiresAt != nil {
			expiration = *apiKey.ExpiresAt
		}
		if expiration.Before(time.Now()) {
			return nil, auth.ErrInvalidToken
		}

		return &auth.TokenInfo{
			UserID:     strconv.FormatInt(user.UserID, 10),
			Expiration: expiration,
			Extra: map[string]any{
				"api_key_id":      apiKey.ID,
				"api_key_eid":     apiKey.Eid,
				"api_key_creator": apiKey.CreatorID,
				"user_eid":        user.Eid,
				"user_role":       user.Role,
				"user_nickname":   user.Nickname,
			},
		}, nil
	}, nil)(next)
}
