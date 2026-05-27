package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// UserService handles user-related business logic
type UserService struct{}

// BatchAddInternalUserResult defines the result of batch adding users
type BatchAddInternalUserResult struct {
	Success []BatchAddUserResult
	Failed  []BatchAddUserResult
}

// BatchAddUserResult defines the structure for batch add user result
type BatchAddUserResult struct {
	Username     string `json:"username"`
	UserID       int64  `json:"user_id,omitempty"`
	Message      string `json:"message,omitempty"`
	ExistingType int    `json:"existing_type,omitempty"` // If the user already exists, mark the user type
	UsernameType int    `json:"username_type,omitempty"` // 1: mobile phone, 2: email
}

// InternalUserInfo defines internal user information
type InternalUserInfo struct {
	Username string
	Nickname string
	Dids     []int64
	Password string
}

// InternalUserView defines the exact response structure for internal user lists,
// matching model.User fields except access_token.
type InternalUserView struct {
	UserID         int64                 `json:"user_id"`
	Username       string                `json:"username"`
	Nickname       string                `json:"nickname"`
	Avatar         string                `json:"avatar"`
	Mobile         string                `json:"mobile"`
	Email          string                `json:"email"`
	Eid            int64                 `json:"eid"`
	Role           int64                 `json:"role"`
	GroupId        int64                 `json:"group_id"`
	Status         int                   `json:"status"`
	ExpiredTime    int64                 `json:"expired_time"`
	LastLoginTime  int64                 `json:"last_login_time"`
	RelatedId      int64                 `json:"related_id"`
	Type           int                   `json:"type"`
	AddAdminTime   int64                 `json:"add_admin_time"`
	OpenID         string                `json:"openid"`
	UnionID        string                `json:"unionid"`
	Departments    []model.Department    `json:"departments"`
	MemberBindings []model.MemberBinding `json:"memberbindings"`
	GroupIds       []int64               `json:"group_ids"`
	CreatedTime    int64                 `json:"created_time"`
	UpdatedTime    int64                 `json:"updated_time"`
}

// InternalUserListResponse is the cached and returned payload for internal user lists.
type InternalUserListResponse struct {
	Count int64               `json:"count"`
	Users []*InternalUserView `json:"users"`
}

const internalUserListCacheTTLSeconds int64 = 300

// BatchAddInternalUsers batch add internal users
func (s *UserService) BatchAddInternalUsers(eid int64, users []InternalUserInfo) (*BatchAddInternalUserResult, error) {
	// Begin transaction
	// 去重收集需要在提交后关联的平台账号（仅手机号）
	accountsToLink := make(map[string]struct{})

	tx := model.DB.Begin()
	if tx.Error != nil {
		return nil, tx.Error
	}

	result := &BatchAddInternalUserResult{
		Success: []BatchAddUserResult{},
		Failed:  []BatchAddUserResult{},
	}

	// Process each user
	for _, userInfo := range users {
		username := userInfo.Username

		// Validate username format
		isEmail := helper.IsValidEmail(username)
		isMobile := helper.IsValidPhone(username)

		if !isEmail && !isMobile {
			result.Failed = append(result.Failed, BatchAddUserResult{
				Username: username,
				Message:  "invalid username",
			})
			continue
		}

		// Create user object
		user := model.User{
			Username: username,
			Nickname: userInfo.Nickname,
			Password: userInfo.Password,
			Eid:      eid,
			GroupId:  0,
			Type:     model.UserTypeInternal,
			Role:     model.RoleCommonUser,
		}

		// Set email or mobile
		if isMobile {
			user.Mobile = username
		}
		if isEmail {
			user.Email = username
		}

		// Validate user struct
		if err := common.Validate.Struct(&user); err != nil {
			result.Failed = append(result.Failed, BatchAddUserResult{
				Username: username,
				Message:  err.Error(),
			})
			continue
		}

		// Check if user already exists
		if err := s.checkExistingUser(tx, &user, eid, result); err != nil {
			continue
		}

		// Handle password encryption
		user.Salt = helper.RandomString(6)
		var err error
		user.Password, err = helper.PasswordHash(user.Password, user.Salt)
		if err != nil {
			result.Failed = append(result.Failed, BatchAddUserResult{
				Username: username,
				Message:  err.Error(),
			})
			continue
		}

		// Create user
		if err := tx.Create(&user).Error; err != nil {
			result.Failed = append(result.Failed, BatchAddUserResult{
				Username: username,
				Message:  err.Error(),
			})
			continue
		}

		user.Status = model.UserStatusNotJoined
		if err := tx.Model(&model.User{}).
			Where("user_id = ?", user.UserID).
			Update("status", model.UserStatusNotJoined).Error; err != nil {
			result.Failed = append(result.Failed, BatchAddUserResult{
				Username: username,
				Message:  err.Error(),
			})
			continue
		}

		// Create member binding
		if err := s.createMemberBinding(tx, &user, eid); err != nil {
			result.Failed = append(result.Failed, BatchAddUserResult{
				Username: username,
				UserID:   user.UserID,
				Message:  "User created successfully but member binding failed: " + err.Error(),
			})
			continue
		}

		// Associate with departments
		if len(userInfo.Dids) > 0 {
			for _, did := range userInfo.Dids {
				if did > 0 {
					if err := s.associateWithDepartment(tx, user.UserID, eid, did); err != nil {
						result.Failed = append(result.Failed, BatchAddUserResult{
							Username: username,
							UserID:   user.UserID,
							Message:  "User created successfully but failed to associate with department: " + err.Error(),
						})
						continue
					}
				}
			}
		}

		// 仅在该条用户完整成功时，收集账号用于提交后关联（仅手机号）
		if isMobile {
			accountsToLink[username] = struct{}{}
		}

		result.Success = append(result.Success, BatchAddUserResult{
			Username: username,
			UserID:   user.UserID,
		})
	}

	// Handle transaction commit or rollback
	if len(result.Failed) > 0 && len(result.Success) == 0 {
		tx.Rollback()
		return result, nil
	}

	if err := tx.Commit().Error; err != nil {
		tx.Rollback()
		return nil, err
	}

	InvalidateInternalUserListCache(eid)
	postLinkPlatformAccounts(accountsToLink)

	return result, nil
}

// check if user already exists
func (s *UserService) checkExistingUser(tx *gorm.DB, user *model.User, eid int64, result *BatchAddInternalUserResult) error {
	var existingUser model.User
	if user.Mobile != "" {
		if tx.Where("eid = ? AND mobile = ?", eid, user.Mobile).First(&existingUser).Error == nil {
			result.Failed = append(result.Failed, BatchAddUserResult{
				UserID:       existingUser.UserID,
				Username:     existingUser.Username,
				Message:      user.Mobile,
				ExistingType: existingUser.Type,
				UsernameType: 1,
			})
			return fmt.Errorf("user with mobile %s already exists", user.Mobile)
		}
	}

	if user.Email != "" {
		if tx.Where("eid = ? AND email = ?", eid, user.Email).First(&existingUser).Error == nil {
			result.Failed = append(result.Failed, BatchAddUserResult{
				UserID:       existingUser.UserID,
				Username:     existingUser.Username,
				Message:      user.Email,
				ExistingType: existingUser.Type,
				UsernameType: 2,
			})
			return fmt.Errorf("user with email %s already exists", user.Email)
		}
	}
	return nil
}

// create member binding
func (s *UserService) createMemberBinding(tx *gorm.DB, user *model.User, eid int64) error {
	memberBinding := model.MemberBinding{
		MID:       user.UserID,
		EID:       eid,
		Name:      user.Nickname,
		BindValue: strconv.FormatInt(user.UserID, 10),
		Status:    model.MemberBindingStatusActive,
	}
	return tx.Create(&memberBinding).Error
}

// associate with department
func (s *UserService) associateWithDepartment(tx *gorm.DB, userID int64, eid int64, did int64) error {
	departmentRelation := model.MemberDepartmentRelation{
		BID: userID,
		EID: eid,
		DID: did,
	}
	return tx.Create(&departmentRelation).Error
}

// UserDepartmentMapping defines the mapping relationship between user and department
type UserDepartmentMapping struct {
	UserID int64
	DIDs   []int64
}

type RegisterUserToInternalResult struct {
	SuccessCount int      `json:"success_count"`
	FailedUsers  []string `json:"failed_users"`
	Total        int      `json:"total"`
}

func (s *UserService) RegisterUserToInternal(eid int64, mappings []UserDepartmentMapping) (*RegisterUserToInternalResult, error) {
	tx := model.DB.Begin()
	if tx.Error != nil {
		return nil, tx.Error
	}

	result := &RegisterUserToInternalResult{
		SuccessCount: 0,
		FailedUsers:  []string{},
		Total:        len(mappings),
	}

	for _, mapping := range mappings {
		user, err := model.GetUserByID(mapping.UserID)
		if err != nil {
			result.FailedUsers = append(result.FailedUsers, fmt.Sprintf("User ID %d not found", mapping.UserID))
			continue
		}

		if user.Eid != eid {
			result.FailedUsers = append(result.FailedUsers, fmt.Sprintf("User ID %d does not belong to this enterprise", mapping.UserID))
			continue
		}

		// 转换为内部用户：更新类型并清空主分组
		if err := tx.Model(&model.User{}).Where("user_id = ?", mapping.UserID).Updates(map[string]interface{}{
			"type":     model.UserTypeInternal,
			"group_id": 0,
		}).Error; err != nil {
			result.FailedUsers = append(result.FailedUsers, fmt.Sprintf("Failed to update user type for user ID %d", mapping.UserID))
			continue
		}

		// 清理用户在 ResourcePermission 表中的分组关联（GroupIds 计算来源）
		if err := tx.Where("resource_id = ? AND resource_type = ?", mapping.UserID, model.ResourceTypeUser).Delete(&model.ResourcePermission{}).Error; err != nil {
			result.FailedUsers = append(result.FailedUsers, fmt.Sprintf("Failed to clear group permissions for user ID %d", mapping.UserID))
			continue
		}

		for _, did := range mapping.DIDs {
			if did > 0 {
				relation := model.MemberDepartmentRelation{
					BID: mapping.UserID,
					DID: did,
					EID: eid,
				}

				var count int64
				tx.Model(&model.MemberDepartmentRelation{}).
					Where("bid = ? AND did = ? AND eid = ?", mapping.UserID, did, eid).
					Count(&count)

				if count == 0 {
					if err := tx.Create(&relation).Error; err != nil {
						result.FailedUsers = append(result.FailedUsers, fmt.Sprintf("Failed to create department relation for user ID %d and department ID %d", mapping.UserID, did))
						continue
					}
				}
			}
		}

		result.SuccessCount++
	}

	if result.SuccessCount == 0 {
		tx.Rollback()
	} else {
		if err := tx.Commit().Error; err != nil {
			return nil, err
		}
		InvalidateInternalUserListCache(eid)
	}

	return result, nil
}

// GetInternalUsersWithPagination get internal user list, supports pagination, status filtering and keyword search
func (s *UserService) GetInternalUsersWithPagination(
	eid int64, keyword string, status,
	offset, limit int, did int64, from int, notBind int) (*InternalUserListResponse, error) {
	normalizedKeyword := strings.TrimSpace(keyword)
	cacheKey := common.GetInternalUserListCacheKey(eid, normalizedKeyword, status, offset, limit, did, from, notBind)

	if cached, err := common.RedisGet(cacheKey); err == nil && cached != "" {
		var cachedResult InternalUserListResponse
		if err := json.Unmarshal([]byte(cached), &cachedResult); err == nil {
			return &cachedResult, nil
		}
	}

	countQuery := s.buildInternalUserListQuery(eid, normalizedKeyword, status, did, from, notBind)
	var count int64
	if err := countQuery.Count(&count).Error; err != nil {
		return nil, err
	}

	result := &InternalUserListResponse{
		Count: count,
		Users: []*InternalUserView{},
	}
	if count == 0 {
		_ = cacheInternalUserListResult(cacheKey, result)
		return result, nil
	}

	dataQuery := s.buildInternalUserListQuery(eid, normalizedKeyword, status, did, from, notBind)
	var users []*model.User
	if err := dataQuery.Offset(offset).Limit(limit).Find(&users).Error; err != nil {
		return nil, err
	}

	for _, user := range users {
		user.LoadUserInfo(from)
		result.Users = append(result.Users, convertInternalUserView(user))
	}

	_ = cacheInternalUserListResult(cacheKey, result)
	return result, nil
}

func (s *UserService) buildInternalUserListQuery(eid int64, keyword string, status int, did int64, from int, notBind int) *gorm.DB {
	query := model.DB.Model(&model.User{}).
		Select(
			"user_id",
			"username",
			"nickname",
			"avatar",
			"mobile",
			"email",
			"users.eid",
			"role",
			"group_id",
			"status",
			"expired_time",
			"last_login_time",
			"related_id",
			"type",
			"add_admin_time",
			"openid",
			"unionid",
			"created_time",
			"updated_time",
		).
		Where(clause.Eq{Column: clause.Column{Table: "users", Name: "eid"}, Value: eid}).
		Where(clause.Eq{Column: clause.Column{Table: "users", Name: "type"}, Value: model.UserTypeInternal})

	if status != -1 {
		query = query.Where(clause.Eq{Column: clause.Column{Table: "users", Name: "status"}, Value: status})
	}

	if keyword != "" {
		likeKeyword := "%" + keyword + "%"
		query = query.Where(
			model.DB.Where("users.nickname LIKE ?", likeKeyword).
				Or("users.mobile LIKE ?", likeKeyword).
				Or("users.email LIKE ?", likeKeyword),
		)
	}

	if did > 0 || notBind > 0 {
		query = query.Joins("LEFT JOIN member_bindings ON member_bindings.mid = users.user_id AND member_bindings.eid = users.eid")

		if notBind > 0 {
			query = query.Where("member_bindings.id IS NULL")
		}

		if did > 0 {
			query = query.Joins("JOIN member_department_relations ON member_department_relations.bid = member_bindings.id AND member_department_relations.eid = member_bindings.eid").
				Where(clause.Eq{
					Column: clause.Column{Table: "member_department_relations", Name: "did"},
					Value:  did,
				}).
				Where(clause.Eq{
					Column: clause.Column{Table: "member_department_relations", Name: "from"},
					Value:  from,
				})
		}
	}

	return query
}

func convertInternalUserView(user *model.User) *InternalUserView {
	if user == nil {
		return nil
	}

	return &InternalUserView{
		UserID:         user.UserID,
		Username:       user.Username,
		Nickname:       user.Nickname,
		Avatar:         user.Avatar,
		Mobile:         user.Mobile,
		Email:          user.Email,
		Eid:            user.Eid,
		Role:           user.Role,
		GroupId:        user.GroupId,
		Status:         user.Status,
		ExpiredTime:    user.ExpiredTime,
		LastLoginTime:  user.LastLoginTime,
		RelatedId:      user.RelatedId,
		Type:           user.Type,
		AddAdminTime:   user.AddAdminTime,
		OpenID:         user.OpenID,
		UnionID:        user.UnionID,
		Departments:    user.Departments,
		MemberBindings: user.MemberBindings,
		GroupIds:       user.GroupIds,
		CreatedTime:    user.CreatedTime,
		UpdatedTime:    user.UpdatedTime,
	}
}

func cacheInternalUserListResult(cacheKey string, result *InternalUserListResponse) error {
	if cacheKey == "" || result == nil {
		return nil
	}
	if !common.IsRedisEnabled() {
		return nil
	}

	payload, err := json.Marshal(result)
	if err != nil {
		return err
	}

	if err := common.RedisSet(cacheKey, string(payload), time.Duration(internalUserListCacheTTLSeconds)*time.Second); err != nil {
		if !errors.Is(err, common.ErrRedisNotEnabled) {
			logger.SysWarnf("【用户】缓存内部用户列表失败: key=%s, err=%v", cacheKey, err)
		}
		return err
	}

	return nil
}

// InvalidateInternalUserListCache clears all cached internal user list pages for an enterprise.
func InvalidateInternalUserListCache(eid int64) {
	if eid <= 0 {
		return
	}
	if !common.IsRedisEnabled() {
		return
	}

	if _, err := common.RedisDelByPattern(common.GetInternalUserListCachePattern(eid)); err != nil && !errors.Is(err, common.ErrRedisNotEnabled) {
		logger.SysWarnf("【用户】清理内部用户列表缓存失败: eid=%d, err=%v", eid, err)
	}
}
