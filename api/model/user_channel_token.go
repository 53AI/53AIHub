package model

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"gorm.io/gorm"
)

var (
	ErrUserChannelTokenNotFound = errors.New("user channel token not found")
	ErrUserChannelTokenExpired  = errors.New("user channel token expired")
)

type UserChannelToken struct {
	ID        int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid       int64  `json:"eid" gorm:"not null;index:idx_user_channel_tokens_lookup,priority:1;index:idx_user_channel_tokens_expires_at,priority:1"`
	UserID    int64  `json:"user_id" gorm:"not null;index:idx_user_channel_tokens_lookup,priority:2"`
	ChannelID int64  `json:"channel_id" gorm:"not null;index:idx_user_channel_tokens_lookup,priority:3"`
	Token     string `json:"token" gorm:"size:64;not null;uniqueIndex"`
	ExpiresAt int64  `json:"expires_at" gorm:"not null;index:idx_user_channel_tokens_expires_at,priority:2"`
	BaseModel
}

func CreateUserChannelToken(userID, eid, channelID int64, ttl time.Duration) (*UserChannelToken, error) {
	if userID <= 0 {
		return nil, fmt.Errorf("user_id is required")
	}
	if eid <= 0 {
		return nil, fmt.Errorf("eid is required")
	}
	if channelID <= 0 {
		return nil, fmt.Errorf("channel_id is required")
	}

	now := time.Now().UTC()
	expiresAt := int64(0)
	if ttl > 0 {
		expiresAt = now.Add(ttl).UnixMilli()
	}

	if err := DeleteExpiredUserChannelTokens(now.UnixMilli()); err != nil {
		return nil, err
	}

	for attempt := 0; attempt < 5; attempt++ {
		tokenValue, err := generateUserChannelTokenValue()
		if err != nil {
			return nil, err
		}

		record := &UserChannelToken{
			Eid:       eid,
			UserID:    userID,
			ChannelID: channelID,
			Token:     tokenValue,
			ExpiresAt: expiresAt,
		}
		if err := DB.Create(record).Error; err != nil {
			if isUniqueTokenConflict(err) {
				continue
			}
			return nil, err
		}
		return record, nil
	}

	return nil, errors.New("failed to generate unique user channel token")
}

func GetUserChannelTokenByToken(token string) (*UserChannelToken, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, ErrUserChannelTokenNotFound
	}

	var record UserChannelToken
	if err := DB.Where("token = ?", token).First(&record).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

func DeleteUserChannelTokenByToken(token string) (bool, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return false, ErrUserChannelTokenNotFound
	}

	result := DB.Where("token = ?", token).Delete(&UserChannelToken{})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
}

func ValidateUserChannelToken(token string) (*User, *UserChannel, *UserChannelToken, error) {
	record, err := GetUserChannelTokenByToken(token)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, nil, ErrUserChannelTokenNotFound
		}
		return nil, nil, nil, err
	}

	now := time.Now().UTC().UnixMilli()
	if record.ExpiresAt > 0 && now >= record.ExpiresAt {
		_ = DB.Delete(&UserChannelToken{}, record.ID).Error
		return nil, nil, nil, ErrUserChannelTokenExpired
	}

	var user User
	if err := DB.Where("user_id = ? AND eid = ?", record.UserID, record.Eid).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, nil, fmt.Errorf("user not found: user_id=%d, eid=%d", record.UserID, record.Eid)
		}
		return nil, nil, nil, fmt.Errorf("failed to query user: %w", err)
	}
	if user.Status == UserStatusDisabled {
		return nil, nil, nil, errors.New("user is disabled")
	}

	var channel UserChannel
	if err := DB.Where("id = ? AND eid = ?", record.ChannelID, record.Eid).First(&channel).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, nil, fmt.Errorf("user channel not found: channel_id=%d, eid=%d", record.ChannelID, record.Eid)
		}
		return nil, nil, nil, fmt.Errorf("failed to query user channel: %w", err)
	}

	_ = channel.UpdateLastUsedAt()

	return &user, &channel, record, nil
}

func DeleteExpiredUserChannelTokens(before int64) error {
	if before <= 0 {
		before = time.Now().UTC().UnixMilli()
	}
	return DB.Where("expires_at > 0 AND expires_at <= ?", before).Delete(&UserChannelToken{}).Error
}

func generateUserChannelTokenValue() (string, error) {
	var buf [32]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	return strings.TrimRight(base64.RawURLEncoding.EncodeToString(buf[:]), "="), nil
}

func isUniqueTokenConflict(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique") || strings.Contains(msg, "duplicate")
}

// GetOrCreateUserChannelTokenWithRenewal 获取或创建用户渠道 Token（一渠道一用户一 Token）
// 如果存在未过期 token：
//   - 剩余有效期 < 24h：续期
//   - 剩余有效期 >= 24h：返回同一 token
// 如果不存在或已过期：创建新 token
func GetOrCreateUserChannelTokenWithRenewal(eid, userID, channelID int64, ttl time.Duration) (*UserChannelToken, error) {
	now := time.Now().UTC().UnixMilli()
	expiresAt := int64(0)
	if ttl > 0 {
		expiresAt = now + ttl.Milliseconds()
	}

	// 1. 尝试查找现有 token
	var token UserChannelToken
	err := DB.Where("eid = ? AND user_id = ? AND channel_id = ?", eid, userID, channelID).
		First(&token).Error

	if err == nil {
		// 2. 存在，检查是否过期
		if token.ExpiresAt == 0 || now < token.ExpiresAt {
			// 未过期
			if token.ExpiresAt > 0 {
				remainingHours := (token.ExpiresAt - now) / (1000 * 60 * 60)
				if remainingHours < 24 {
					// 剩余有效期 < 24h，续期
					token.ExpiresAt = expiresAt
					if err := DB.Save(&token).Error; err != nil {
						return nil, fmt.Errorf("failed to renew token: %w", err)
					}
				}
			}
			return &token, nil
		}
		// 已过期，删除旧 token
		if err := DB.Delete(&token).Error; err != nil {
			logger.SysErrorf("failed to delete expired token: token_id=%d, err=%v", token.ID, err)
		}
	}

	// 3. 不存在或已过期，创建新 token
	return createUserChannelTokenWithRetry(eid, userID, channelID, expiresAt)
}

func createUserChannelTokenWithRetry(eid, userID, channelID int64, expiresAt int64) (*UserChannelToken, error) {
	for attempt := 0; attempt < 5; attempt++ {
		tokenValue, err := generateUserChannelTokenValue()
		if err != nil {
			return nil, err
		}

		token := &UserChannelToken{
			Eid:       eid,
			UserID:    userID,
			ChannelID: channelID,
			Token:     tokenValue,
			ExpiresAt: expiresAt,
		}

		if err := DB.Create(token).Error; err != nil {
			if isUniqueTokenConflict(err) {
				continue // 重试
			}
			return nil, err
		}
		return token, nil
	}

	return nil, errors.New("failed to create unique user channel token after 5 attempts")
}