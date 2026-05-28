package model

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

var (
	ErrUserChannelNotFound    = errors.New("user channel not found")
	ErrUserChannelDuplicated  = errors.New("user channel already exists")
)

type UserChannel struct {
	ID            int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid           int64  `json:"eid" gorm:"not null;index:idx_user_channels_lookup,priority:1;index:idx_user_channels_eid_openid,priority:1"`
	UserID        int64  `json:"user_id" gorm:"not null;index:idx_user_channels_lookup,priority:2"`
	ChannelType   string `json:"channel_type" gorm:"size:32;not null;index:idx_user_channels_lookup,priority:3"`
	OpenID        string `json:"openid" gorm:"column:openid;size:128;not null;index:idx_user_channels_eid_openid,priority:2"`
	Nickname      string `json:"nickname" gorm:"size:128"`
	Avatar        string `json:"avatar" gorm:"size:512"`
	AccessToken   string `json:"access_token" gorm:"size:512"`
	RefreshToken  string `json:"refresh_token" gorm:"size:512"`
	ExpiresAt     int64  `json:"expires_at" gorm:"default:0"`
	ExtraData     string `json:"extra_data" gorm:"type:text"`
	Status        int    `json:"status" gorm:"type:int;default:1;not null"`
	LastUsedAt    int64  `json:"last_used_at" gorm:"default:0"`
	BaseModel
}

const (
	ChannelTypeWechat   = "wechat"
	ChannelTypeWebEmbed = "h5"
	ChannelTypeAPI      = "api"
	ChannelTypeSSO      = "sso"

	UserChannelStatusActive   = 1
	UserChannelStatusDisabled = 2
)

type UserChannelOption func(*UserChannel)

func WithChannelNickname(nickname string) UserChannelOption {
	return func(uc *UserChannel) {
		uc.Nickname = strings.TrimSpace(nickname)
	}
}

func WithChannelAvatar(avatar string) UserChannelOption {
	return func(uc *UserChannel) {
		uc.Avatar = strings.TrimSpace(avatar)
	}
}

func WithAccessToken(token string, expiresAt int64) UserChannelOption {
	return func(uc *UserChannel) {
		uc.AccessToken = strings.TrimSpace(token)
		uc.ExpiresAt = expiresAt
	}
}

func WithRefreshToken(token string) UserChannelOption {
	return func(uc *UserChannel) {
		uc.RefreshToken = strings.TrimSpace(token)
	}
}

func WithExtraData(data string) UserChannelOption {
	return func(uc *UserChannel) {
		uc.ExtraData = data
	}
}

func CreateUserChannel(eid, userID int64, channelType, openid string, opts ...UserChannelOption) (*UserChannel, error) {
	if eid <= 0 {
		return nil, fmt.Errorf("eid is required")
	}
	if userID <= 0 {
		return nil, fmt.Errorf("user_id is required")
	}
	channelType = strings.TrimSpace(channelType)
	if channelType == "" {
		channelType = ChannelTypeWebEmbed
	}
	openid = strings.TrimSpace(openid)
	if openid == "" {
		openid = generateOpenID()
	}

	existing, _ := GetUserChannelByOpenID(eid, openid)
	if existing != nil {
		return nil, ErrUserChannelDuplicated
	}

	record := &UserChannel{
		Eid:         eid,
		UserID:      userID,
		ChannelType: channelType,
		OpenID:      openid,
		Status:      UserChannelStatusActive,
		LastUsedAt:  time.Now().UTC().UnixMilli(),
	}

	for _, opt := range opts {
		opt(record)
	}

	if err := DB.Create(record).Error; err != nil {
		if isUniqueChannelConflict(err) {
			return nil, ErrUserChannelDuplicated
		}
		return nil, err
	}

	return record, nil
}

func GetUserChannelByOpenID(eid int64, openid string) (*UserChannel, error) {
	var record UserChannel
	err := DB.Where("eid = ? AND openid = ?", eid, openid).First(&record).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUserChannelNotFound
		}
		return nil, err
	}
	return &record, nil
}

func GetUserChannelByID(eid, channelID int64) (*UserChannel, error) {
	var record UserChannel
	err := DB.Where("id = ? AND eid = ?", channelID, eid).First(&record).Error
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func GetUserChannelsByUserID(eid, userID int64) ([]*UserChannel, error) {
	var channels []*UserChannel
	err := DB.Where("eid = ? AND user_id = ?", eid, userID).Find(&channels).Error
	return channels, err
}

func (uc *UserChannel) UpdateLastUsedAt() error {
	return DB.Model(uc).Update("last_used_at", time.Now().UTC().UnixMilli()).Error
}

func (uc *UserChannel) UpdateAccessToken(token string, expiresAt int64) error {
	return DB.Model(uc).Updates(map[string]interface{}{
		"access_token": token,
		"expires_at":   expiresAt,
		"last_used_at": time.Now().UTC().UnixMilli(),
	}).Error
}

func generateOpenID() string {
	var buf [16]byte
	rand.Read(buf[:])
	return base64.RawURLEncoding.EncodeToString(buf[:])
}

func isUniqueChannelConflict(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique") || strings.Contains(msg, "duplicate")
}
