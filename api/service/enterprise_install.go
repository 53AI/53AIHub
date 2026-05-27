package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/common/utils/jwt"
	"github.com/53AI/53AIHub/model"
	enterprise_init "github.com/53AI/53AIHub/service/enterpriseinit"
	"gorm.io/gorm"
)

// InitializeEnterpriseInstallationRequest 初始化安装请求
type InitializeEnterpriseInstallationRequest struct {
	Enterprise InitializeEnterpriseInstallationEnterpriseParams
	User       InitializeEnterpriseInstallationUserParams
	Channel    *InitializeEnterpriseInstallationChannelParams
}

// InitializeEnterpriseInstallationEnterpriseParams 初始化企业参数
type InitializeEnterpriseInstallationEnterpriseParams struct {
	EnterpriseName string
}

// InitializeEnterpriseInstallationUserParams 初始化用户参数
type InitializeEnterpriseInstallationUserParams struct {
	AccountName string
	Password    string
}

// InitializeEnterpriseInstallationChannelParams 初始化渠道参数
type InitializeEnterpriseInstallationChannelParams struct {
	Type    int
	BaseURL string
	Key     string
}

// InitializeEnterpriseInstallationResult 初始化安装结果
type InitializeEnterpriseInstallationResult struct {
	AccessToken  string
	UserID       int64
	EnterpriseID int64
	ChannelID    int64
}

// InitializeEnterpriseInstallation （新版）完成企业初始化、用户注册和默认渠道配置
func InitializeEnterpriseInstallation(ctx context.Context, eid int64, req InitializeEnterpriseInstallationRequest) (*InitializeEnterpriseInstallationResult, error) {
	req.Enterprise.EnterpriseName = strings.TrimSpace(req.Enterprise.EnterpriseName)
	req.User.AccountName = strings.TrimSpace(req.User.AccountName)
	if req.Channel != nil {
		req.Channel.BaseURL = strings.TrimSpace(req.Channel.BaseURL)
		req.Channel.Key = strings.TrimSpace(req.Channel.Key)
	}

	if eid <= 0 {
		return nil, errors.New("enterprise id is invalid")
	}
	if req.Enterprise.EnterpriseName == "" {
		return nil, errors.New("enterprise name is required")
	}
	if req.User.AccountName == "" {
		return nil, errors.New("account name is required")
	}
	if !helper.IsValidEmail(req.User.AccountName) {
		return nil, errors.New("account name must be a valid email")
	}
	if req.User.Password == "" {
		return nil, errors.New("password is required")
	}
	tx := model.DB.WithContext(ctx).Begin()
	if tx.Error != nil {
		return nil, tx.Error
	}

	commit := false
	defer func() {
		if !commit {
			tx.Rollback()
		}
	}()

	enterprise, err := ensureInstallationEnterprise(tx, eid, req.Enterprise.EnterpriseName)
	if err != nil {
		return nil, err
	}

	user, err := ensureInstallationUser(tx, eid, req.User.AccountName, req.User.Password)
	if err != nil {
		return nil, err
	}

	var channelID int64
	if req.Channel != nil {
		channel, err := enterprise_init.EnsureInstallationChannel(tx, eid, req.Channel.Type, req.Channel.BaseURL, req.Channel.Key)
		if err != nil {
			return nil, err
		}
		channelID = channel.ChannelID
	}

	if err := enterprise_init.EnsureEnterprisePostInit(tx, enterprise, user); err != nil {
		return nil, err
	}

	if err := tx.Commit().Error; err != nil {
		return nil, err
	}
	commit = true

	return &InitializeEnterpriseInstallationResult{
		AccessToken:  user.AccessToken,
		UserID:       user.UserID,
		EnterpriseID: enterprise.Eid,
		ChannelID:    channelID,
	}, nil
}

func ensureInstallationEnterprise(tx *gorm.DB, eid int64, enterpriseName string) (*model.Enterprise, error) {
	var enterprise model.Enterprise
	if err := tx.First(&enterprise, eid).Error; err != nil {
		return nil, err
	}

	if err := tx.Model(&enterprise).Where("eid = ?", eid).Update("display_name", enterpriseName).Error; err != nil {
		return nil, err
	}
	enterprise.DisplayName = enterpriseName

	return &enterprise, nil
}

func ensureInstallationUser(tx *gorm.DB, eid int64, accountName, password string) (*model.User, error) {
	groupID, err := ensureInstallationUserGroup(tx, eid)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC().UnixMilli()
	var existingUser model.User
	if err := tx.Where("eid = ? AND username = ?", eid, accountName).First(&existingUser).Error; err == nil {
		salt := helper.RandomString(6)
		hashedPassword, err := helper.PasswordHash(password, salt)
		if err != nil {
			return nil, err
		}
		accessToken, err := jwt.UserGenerateJWT(existingUser.UserID, eid)
		if err != nil {
			return nil, err
		}

		updates := map[string]interface{}{
			"nickname":        accountName,
			"email":           accountName,
			"password":        hashedPassword,
			"salt":            salt,
			"group_id":        groupID,
			"role":            model.RoleCreatorUser,
			"type":            model.UserTypeInternal,
			"status":          model.UserStatusJoined,
			"expired_time":    int64(0),
			"last_login_time": now,
			"access_token":    accessToken,
		}
		if err := tx.Model(&existingUser).Updates(updates).Error; err != nil {
			return nil, err
		}
		if err := ensureInstallationInternalUserGroupPermission(tx, eid, existingUser.UserID); err != nil {
			return nil, err
		}
		existingUser.Nickname = accountName
		existingUser.Password = hashedPassword
		existingUser.Salt = salt
		existingUser.GroupId = groupID
		existingUser.Role = model.RoleCreatorUser
		existingUser.Type = model.UserTypeInternal
		existingUser.Status = model.UserStatusJoined
		existingUser.ExpiredTime = 0
		existingUser.LastLoginTime = now
		existingUser.AccessToken = accessToken
		return &existingUser, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	salt := helper.RandomString(6)
	hashedPassword, err := helper.PasswordHash(password, salt)
	if err != nil {
		return nil, err
	}

	user := &model.User{
		Username:      accountName,
		Nickname:      accountName,
		Email:         accountName,
		Password:      hashedPassword,
		Salt:          salt,
		Eid:           eid,
		Role:          model.RoleCreatorUser,
		GroupId:       groupID,
		Status:        model.UserStatusJoined,
		LastLoginTime: now,
		Type:          model.UserTypeInternal,
		ExpiredTime:   0,
	}

	if err := tx.Create(user).Error; err != nil {
		return nil, err
	}
	if err := ensureInstallationInternalUserGroupPermission(tx, eid, user.UserID); err != nil {
		return nil, err
	}

	accessToken, err := jwt.UserGenerateJWT(user.UserID, eid)
	if err != nil {
		return nil, err
	}
	if err := tx.Model(user).Update("access_token", accessToken).Error; err != nil {
		return nil, err
	}
	user.AccessToken = accessToken

	return user, nil
}

func ensureInstallationInternalUserGroupPermission(tx *gorm.DB, eid int64, userID int64) error {
	if tx == nil {
		return errors.New("db is nil")
	}
	if eid <= 0 {
		return errors.New("enterprise id is invalid")
	}
	if userID <= 0 {
		return errors.New("user id is invalid")
	}

	var groups []model.Group
	if err := tx.Where("eid = ? AND group_type = ?", eid, model.INTERNAL_USER_GROUP_TYPE).
		Order("sort desc, group_id asc").
		Find(&groups).Error; err != nil {
		return err
	}

	if len(groups) == 0 {
		group := model.Group{
			Eid:       eid,
			CreatedBy: userID,
			GroupName: "默认",
			GroupType: model.INTERNAL_USER_GROUP_TYPE,
			Sort:      0,
		}
		if err := tx.Create(&group).Error; err != nil {
			return err
		}
		groups = []model.Group{group}
	}

	for _, group := range groups {
		var count int64
		if err := tx.Model(&model.ResourcePermission{}).
			Where("group_id = ? AND resource_id = ? AND resource_type = ?", group.GroupId, userID, model.ResourceTypeUser).
			Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			continue
		}

		permission := model.ResourcePermission{
			GroupID:      group.GroupId,
			ResourceID:   userID,
			ResourceType: model.ResourceTypeUser,
			Permission:   model.PermissionRead,
		}
		if err := tx.Create(&permission).Error; err != nil {
			return err
		}
	}

	return nil
}

func ensureInstallationUserGroup(tx *gorm.DB, eid int64) (int64, error) {
	group, err := model.GetFirstGroupByEid(eid, model.USER_GROUP_TYPE)
	if err == nil {
		return group.GroupId, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, err
	}

	defaultGroup := &model.Group{
		Eid:       eid,
		CreatedBy: 0,
		GroupName: model.USER_FREE_GROUP_NAME,
		GroupType: model.USER_GROUP_TYPE,
		Sort:      0,
	}
	if err := tx.Create(defaultGroup).Error; err != nil {
		return 0, err
	}

	return defaultGroup.GroupId, nil
}
