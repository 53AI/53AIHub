package controller

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/common/utils"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"gorm.io/gorm"

	"github.com/gin-gonic/gin"
)

type LoginRequest struct {
	Username string `json:"username" example:"john_doe" binding:"required,min=1"`
	Password string `json:"password" example:"password123" binding:"required,min=1"`
}

type LoginResponse struct {
	AccessToken string `json:"access_token"`
	UserID      int64  `json:"user_id"`
}

type PasswordRegisterUserRequest struct {
	Username   string `json:"username" example:"john_doe"`
	Nickname   string `json:"nickname" example:"John Doe"`
	Password   string `json:"password" validate:"min=8,max=20" example:"password123"`
	VerifyCode string `json:"verify_code" example:"123456"` // Add verification code field
}

type EnterpriseAddUserRequest struct {
	Username    string `json:"username" example:"Json"`
	Nickname    string `json:"nickname" example:"Json Jobs"`
	Avatar      string `json:"avatar" example:"http://avatar.cc/a.jpg"`
	Password    string `json:"password" validate:"min=8,max=20" example:"password123"`
	Mobile      string `json:"mobile" example:"13800138000"`
	GroupId     int64  `json:"group_id" example:"1"`
	ExpiredTime int64  `json:"expired_time" example:"1672502400"`
}

// Modify EnterpriseUserGetRequest struct, add Role field
type EnterpriseUserGetRequest struct {
	Keyword   string `json:"keyword" form:"keyword" example:"Json"`
	GroupId   int64  `json:"group_id" form:"group_id" example:"0"`
	Role      string `json:"role" form:"role" example:"1,2"` // Role parameter, allows multiple role values separated by commas
	Offset    int    `json:"offset" form:"offset" example:"0"`
	Limit     int    `json:"limit" form:"limit" example:"10"`
	StartTime int64  `json:"start_time" form:"start_time" example:"0"`
	EndTime   int64  `json:"end_time" form:"end_time" example:"0"`
	RangeBy   string `json:"range_by" form:"range_by" example:"expired_time"` // Sorting field, default is expired_time, optional value: created_time
}

type EnterpriseUsersResponse struct {
	Count int64         `json:"count"`
	Users []*model.User `json:"users"`
}

// Register User Login
// @Summary User Login
// @Description User Login
// @Tags User
// @Accept json
// @Produce json
// @Param user body LoginRequest true "User Login Request Data"
// @Success 200 {object} model.CommonResponse{data=LoginResponse} "Success"
// @Router /api/login [post]
func Login(c *gin.Context) {
	var loginRequest LoginRequest
	err := json.NewDecoder(c.Request.Body).Decode(&loginRequest)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	username := loginRequest.Username
	password := loginRequest.Password
	eid := config.GetEID(c)

	isEmail := helper.IsValidEmail(username)
	isMobile := helper.IsValidPhone(username)

	var user model.User
	if isEmail {
		user, err = model.GetUserByEmail(eid, username)
	} else if isMobile {
		user, err = model.GetUserByMobile(eid, username)
	} else {
	}

	if err != nil {
		c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(err))
		return
	}

	err = user.VerifyPassword(password)
	if err != nil {
		c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(err))
		return
	}

	err = user.RefreshAccessToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	err = user.UpdateStatusToJoin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
	}

	// log := model.SystemLog{
	// 	Eid:      eid,
	// 	UserID:   user.UserID,
	// 	Nickname: user.Nickname,
	// 	Module:   model.SystemLogModuleSystem,
	// 	Action:   model.SystemLogActionLoginOut,
	// 	Content:  "登录",
	// 	IP:       utils.GetClientIP(c),
	// }
	// model.CreateSystemLog(&log)

	loginResponse := LoginResponse{
		AccessToken: user.AccessToken,
		UserID:      user.UserID,
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(loginResponse))
}

// SmsLoginRequest 手机号登录请求结构体
type SmsLoginRequest struct {
	Mobile     string `json:"mobile" binding:"required"`      // 手机号
	VerifyCode string `json:"verify_code" binding:"required"` // 验证码
}

type SmsLoginResponse struct {
	LoginResponse
	Username string `json:"username"`
	Nickname string `json:"nickname"`
}

// @Summary 手机号验证码登录
// @Description 使用手机号和验证码登录
// @Tags User
// @Accept json
// @Produce json
// @Param request body SmsLoginRequest true "登录信息"
// @Success 200 {object} model.CommonResponse{data=SmsLoginResponse} "Success"
// @Router /api/sms_login [post]
func SmsLogin(c *gin.Context) {
	var req SmsLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if !helper.IsValidPhone(req.Mobile) {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(model.InvalidMobileOrEmail))
		return
	}

	if req.VerifyCode == "" {
		c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToNewErrorResponse(model.InvalidVerificationCode))
		return
	}

	redisKey := fmt.Sprintf("Api:CheckVerificationCode:%s", req.Mobile)
	code, err := common.RedisGet(redisKey)
	if err != nil || code != req.VerifyCode {
		c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToNewErrorResponse(model.InvalidVerificationCode))
		return
	}

	eid := config.GetEID(c)
	existingUser, err := model.GetUserByMobile(eid, req.Mobile)
	if err != nil {
		c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(err))
		return
	}

	if err := existingUser.RefreshAccessToken(); err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&SmsLoginResponse{
		LoginResponse: LoginResponse{
			AccessToken: existingUser.AccessToken,
			UserID:      existingUser.UserID,
		},
		Username: existingUser.Username,
		Nickname: existingUser.Nickname,
	}))
}

// Register User Register
// @Summary User Register
// @Description User Register
// @Tags User
// @Accept json
// @Produce json
// @Param user body PasswordRegisterUserRequest true "User Registration Data"
// @Success 200 {object} model.CommonResponse{data=LoginResponse} "Success"
// @Router /api/register [post]
func PasswordRegister(c *gin.Context) {
	// Parse the request body into PasswordRegisterUserRequest struct
	var userRequest PasswordRegisterUserRequest
	err := json.NewDecoder(c.Request.Body).Decode(&userRequest)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	params := map[string]interface{}{
		"from": "user",
	}
	_, err = service.IsFeatureAvailable(c, "registered_user", params)
	if err != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(err))
		return
	}

	username := userRequest.Username

	isEmail := helper.IsValidEmail(username)
	isMobile := helper.IsValidPhone(username)

	eid := config.GetEID(c)

	if isMobile && config.IS_SAAS {
		if userRequest.VerifyCode == "" {
			c.JSON(http.StatusBadRequest, model.InvalidVerificationCodeError.ToNewErrorResponse(model.InvalidVerificationCode))
			return
		}

		redisKey := fmt.Sprintf("Api:CheckVerificationCode:%s", username)
		code, err := common.RedisGet(redisKey)
		if err != nil || code != userRequest.VerifyCode {
			c.JSON(http.StatusBadRequest, model.InvalidVerificationCodeError.ToNewErrorResponse(model.InvalidVerificationCode))
			return
		}
	} else if !isEmail && config.IS_SAAS {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(model.InvalidMobileOrEmail))
		return
	} else if isEmail {
		enabled, _ := service.IsEnterpriseConfigEnabled(eid, model.EnterpriseConfigTypeSMTP)
		if enabled || config.IS_SAAS {
			_, err = common.VerifyEmailCode(username, userRequest.VerifyCode)
			if err != nil {
				c.JSON(http.StatusUnauthorized, model.AuthFailed.ToResponse(err))
				return
			}
		}
	}

	// Get the first user group for this enterprise
	theGroup, err := model.GetFirstGroupByEid(eid, model.USER_GROUP_TYPE)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	user := model.User{
		Username: userRequest.Username,
		Nickname: userRequest.Nickname,
		Password: userRequest.Password,
		Eid:      eid,
		GroupId:  theGroup.GroupId, // Assign the group ID from the enterprise's first user group
	}

	if isMobile {
		user.Mobile = userRequest.Username
	}

	if isEmail {
		user.Email = userRequest.Username
	}

	if err := common.Validate.Struct(&user); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	var theUser model.User
	isFirstUser := false
	if err = model.DB.Where("eid = ?", eid).First(&theUser).Error; err != nil && err.Error() == "record not found" {
		// 一个站点没有用户，视为初始化，是创建者
		user.Role = model.RoleCreatorUser
		user.Type = model.UserTypeInternal
		isFirstUser = true
	}

	err = user.Create()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ParamError.ToErrorResponse(err))
		return
	}

	// 首个用户作为创建者时，触发统一的后置初始化流程（本地/saas 共用）
	if isFirstUser {
		if err = service.EnsureEnterprisePostInit(eid, &user); err != nil {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
			return
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(LoginResponse{
		AccessToken: user.AccessToken,
		UserID:      user.UserID,
	}))
}

// Enterprise Admin add User
// @Summary Add User
// @Description Add User
// @Tags User
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param user body EnterpriseAddUserRequest true "User Data"
// @Success 200 {object} model.CommonResponse{data=model.User} "Success"
// @Router /api/users [post]
func EnterpriseAddUser(c *gin.Context) {
	var userRequest EnterpriseAddUserRequest
	err := json.NewDecoder(c.Request.Body).Decode(&userRequest)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	user := model.User{
		Username:    userRequest.Username,
		Nickname:    userRequest.Nickname,
		Avatar:      userRequest.Avatar,
		Password:    userRequest.Password,
		Mobile:      userRequest.Mobile,
		GroupId:     userRequest.GroupId,
		ExpiredTime: userRequest.ExpiredTime,
		Eid:         config.GetEID(c),
		Role:        model.RoleGuestUser,
	}

	if err := common.Validate.Struct(&user); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	err = user.Create()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ParamError.ToErrorResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(user))
}

// Enterprise Admin get User List
// @Summary Get User List
// @Description Get User List
// @Tags User
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param keyword query string false "Search keyword, matches username, email or phone"
// @Param group_id query int false "Filter by user group ID"
// @Param role query string false "Filter by role IDs, multiple roles separated by commas"
// @Param offset query int false "Pagination offset, default 0"
// @Param limit query int false "Pagination limit, default 20, max 100"
// @Param start_time query int64 false "Time range start (timestamp)"
// @Param endtime query int64 false "Time range end (timestamp)"
// @Param range_by query string false "Range field, default is expired_time, optional value: created_time"
// @Success 200 {object} model.CommonResponse{data=EnterpriseUsersResponse} "Success"
// @Router /api/users [get]
// @Router /api/users/admin [get]
func EnterpriseUsers(c *gin.Context) {
	var userGetRequest EnterpriseUserGetRequest
	if err := c.ShouldBindQuery(&userGetRequest); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	roleStr := userGetRequest.Role

	var userType int64
	userType = model.UserTypeRegistered

	path := c.Request.URL.Path
	isAdminPath := path == "/api/users/admin"

	if isAdminPath {
		userType = 0
		roleStr = fmt.Sprintf("%d,%d", model.RoleCreatorUser, model.RoleAdminUser)
	}

	offset := userGetRequest.Offset
	if offset == 0 {
		offset = 0
	}

	limit := userGetRequest.Limit
	if limit == 0 {
		limit = 10
	}

	// Process sorting parameters
	rangeBy := userGetRequest.RangeBy
	if rangeBy == "" {
		rangeBy = "expired_time"
	}
	// Validate sorting field
	validOrderFields := map[string]bool{"expired_time": true, "created_time": true}
	if !validOrderFields[rangeBy] {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("order by field must be either 'expired_time' or 'created_time'"))
		return
	}

	// Get enterprise ID
	enterpriseID := config.GetEID(c)

	// Process time range filters
	var timeStart, timeEnd int64
	if userGetRequest.StartTime > 0 {
		timeStart = userGetRequest.StartTime
	}
	if userGetRequest.EndTime > 0 {
		timeEnd = userGetRequest.EndTime
	}

	// Get user list with filtering
	count, users, err := model.GetUserListWithRoles(
		enterpriseID,
		userGetRequest.Keyword,
		userGetRequest.GroupId,
		roleStr,
		userType,
		rangeBy,
		timeStart,
		timeEnd,
		offset,
		limit,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(EnterpriseUsersResponse{
		Count: count,
		Users: users,
	}))
}

// Enterprise Admin delete User
// @Summary Delete User
// @Description Delete User
// @Tags User
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "User ID"
// @Success 200 {object} model.CommonResponse "Success"
// @Router /api/users/{id} [delete]
func DeleteEnterpriseUser(c *gin.Context) {
	user_id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	user, err := model.GetUserByID(int64(user_id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
			return
		}
	}
	err = model.DeleteUser(eid, int64(user_id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}
	service.InvalidateInternalUserListCache(eid)

	var module uint8
	module = model.SystemLogModuleRegistered
	if user.Type == model.UserTypeInternal {
		module = model.SystemLogModuleInternalUser
	}

	model.LogEntityChange(
		fmt.Sprintf("账号【%s】", user.Nickname),
		model.SystemLogActionDelete,
		eid,
		config.GetUserId(c),
		config.GetUserNickname(c),
		module,
		nil,
		nil,
		utils.GetClientIP(c),
		nil,
	)

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// Enterprise Admin update User
// @Summary Update User
// @Description Update User
// @Tags User
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "User ID"
// @Param user body EnterpriseAddUserRequest true "User Data"
// @Success 200 {object} model.CommonResponse "Success"
// @Router /api/users/{id} [put]
func UpdateEnterpriseUser(c *gin.Context) {
	user_id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	var userRequest EnterpriseAddUserRequest
	err = json.NewDecoder(c.Request.Body).Decode(&userRequest)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	user, err := model.GetUserByID(int64(user_id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.NotFound.ToResponse(err))
		return
	}

	fieldMap := map[string]string{
		"Nickname":    "姓名",
		"Avatar":      "头像",
		"Password":    "密码",
		"GroupId":     "分组ID",
		"ExpiredTime": "过期时间",
	}

	oldUser := *user

	user.Nickname = userRequest.Nickname
	user.Avatar = userRequest.Avatar
	updatePassword := false
	user.GroupId = userRequest.GroupId
	user.ExpiredTime = userRequest.ExpiredTime

	model.LogEntityChange(
		fmt.Sprintf("账号【%s】", oldUser.Nickname),
		model.SystemLogActionUpdate,
		user.Eid,
		user.UserID,
		user.Nickname,
		model.SystemLogModuleRegistered,
		oldUser,
		user,
		utils.GetClientIP(c),
		fieldMap,
	)

	err = user.Update(updatePassword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ParamError.ToErrorResponse(err))
		return
	}

	service.InvalidateInternalUserListCache(user.Eid)

	c.JSON(http.StatusOK, model.Success.ToResponse(user))
}

// GetCurrentUserResponse defines the response structure for current user data
type GetCurrentUserResponse struct {
	*model.User
}

// Get Current User
// @Summary Get current user info
// @Description Get information of the currently logged-in user
// @Tags User
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=GetCurrentUserResponse} "Success"
// @Router /api/users/me [get]
func GetCurrentUser(c *gin.Context) {
	// Retrieve user ID from context (assuming set by auth middleware)
	userID, success := c.Get(session.SESSION_USER_ID)
	if !success {
		c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(nil))
		return
	}

	// Type assertion for user ID
	uid, ok := userID.(int64)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(nil))
		return
	}

	// Query database for user
	user, err := model.GetUserByID(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}
	user.LoadGroupIds()

	c.JSON(http.StatusOK, model.Success.ToResponse(GetCurrentUserResponse{
		User: user,
	}))
}

type UpdatePasswordRequest struct {
	NewPassword     string `json:"new_password" binding:"required,min=8,max=20" example:"newPassword123"`
	ConfirmPassword string `json:"confirm_password" binding:"required,min=8,max=20" example:"newPassword123"`
}

// @Summary Update user password
// @Description Update the password for the current logged-in user
// @Tags User
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body UpdatePasswordRequest true "Password update data"
// @Success 200 {object} model.CommonResponse "Success"
// @Router /api/users/password [put]
func UpdateUserPassword(c *gin.Context) {
	var req UpdatePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if req.NewPassword != req.ConfirmPassword {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(model.PasswordNotMatch))
		return
	}

	userID := config.GetUserId(c)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)

	err := model.UpdateUserPassword(eid, userID, req.NewPassword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

type UpdateCurrentUserRequest struct {
	Nickname string `json:"nickname" example:"new nickname"`
	Avatar   string `json:"avatar" example:"http://example.com/avatar.jpg"`
}

// @Summary Update current user information
// @Description Update information for the currently logged-in user
// @Tags User
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body UpdateCurrentUserRequest true "User information to update"
// @Success 200 {object} model.CommonResponse{data=model.User} "Success"
// @Router /api/users/me [put]
func UpdateCurrentUser(c *gin.Context) {
	var req UpdateCurrentUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	userID := config.GetUserId(c)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(nil))
		return
	}

	user, err := model.GetUserByID(int64(userID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if req.Nickname != "" {
		user.Nickname = req.Nickname
	}

	if req.Avatar != "" {
		user.Avatar = req.Avatar
	}

	if err := model.DB.Save(user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(user))
}

// CheckAccountRequest defines the structure for account existence check request
type CheckAccountRequest struct {
	Account string `json:"account" binding:"required" example:"user@example.com"`
}

// CheckAccountResponse defines the structure for account existence check response
type CheckAccountResponse struct {
	Exists bool `json:"exists"`
}

// CheckAccountExists checks if an account exists in the system
// @Summary Check if account exists
// @Description Check if the specified account already exists in the system
// @Tags User
// @Accept json
// @Produce json
// @Param request body CheckAccountRequest true "Account information"
// @Success 200 {object} model.CommonResponse{data=CheckAccountResponse}
// @Failure 400 {object} model.CommonResponse "Parameter error"
// @Failure 500 {object} model.CommonResponse "System error"
// @Router /api/check_account [post]
func CheckAccountExists(c *gin.Context) {
	var req CheckAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// Get current enterprise ID
	eid := config.GetEID(c)
	if eid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	// Check if account exists
	exists, err := model.IsUserExistsByAccount(eid, req.Account)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(CheckAccountResponse{
		Exists: exists,
	}))
}

// BatchSetAdminRequest defines the structure for batch admin setting request
type BatchSetAdminRequest struct {
	UserIDs []int64 `json:"user_ids" binding:"required" example:"1,2,3"`
}

// BatchSetAdminResponse defines the structure for batch admin setting response
type BatchSetAdminResponse struct {
	Success []int64 `json:"success"` // List of successfully processed user IDs
	Failed  []int64 `json:"failed"`  // List of failed user IDs
}

// SetUserAsAdmin sets users as administrators (batch operation)
// @Summary Set users as admin
// @Description Set multiple users as administrators for the current enterprise
// @Tags User
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body BatchSetAdminRequest true "Batch user ID list"
// @Success 200 {object} model.CommonResponse{data=BatchSetAdminResponse} "Success"
// @Failure 400 {object} model.CommonResponse "Parameter error"
// @Failure 401 {object} model.CommonResponse "Unauthorized"
// @Failure 403 {object} model.CommonResponse "Forbidden"
// @Failure 500 {object} model.CommonResponse "System error"
// @Router /api/users/batch/admin [put]
func SetUserAsAdmin(c *gin.Context) {
	eid := config.GetEID(c)
	if eid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(model.InvalidEnterpriseID))
		return
	}

	var batchRequest BatchSetAdminRequest
	if err := c.ShouldBindJSON(&batchRequest); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	userIDs := batchRequest.UserIDs

	tx := model.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(tx.Error))
		return
	}

	response := BatchSetAdminResponse{
		Success: []int64{},
		Failed:  []int64{},
	}

	nicknames := make([]string, 0, len(userIDs))
	for _, userID := range userIDs {
		user, err := model.GetUserByID(userID)
		if err != nil {
			response.Failed = append(response.Failed, userID)
			continue
		}

		if user.Eid != eid {
			response.Failed = append(response.Failed, userID)
			continue
		}

		if user.Role == model.RoleAdminUser {
			response.Success = append(response.Success, userID)
			continue
		}

		updateMap := map[string]interface{}{
			"role":           model.RoleAdminUser,
			"add_admin_time": time.Now().UTC().UnixMilli(),
		}

		err = tx.Model(user).Where("user_id = ?", userID).Updates(updateMap).Error
		if err != nil {
			response.Failed = append(response.Failed, userID)
			continue
		}

		response.Success = append(response.Success, userID)
		nicknames = append(nicknames, user.Nickname)
	}

	if err := tx.Commit().Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	log := model.SystemLog{
		Eid:      eid,
		UserID:   config.GetUserId(c),
		Nickname: config.GetUserNickname(c),
		Module:   model.SystemLogModuleAdmin,
		Action:   model.SystemLogActionCreate,
		Content:  fmt.Sprintf("新建管理员【%s】", strings.Join(nicknames, "】【")),
		IP:       utils.GetClientIP(c),
	}
	model.CreateSystemLog(&log)

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// UnsetUserAsAdmin removes administrator privileges from users (batch operation)
// @Summary Remove admin privileges
// @Description Remove administrator privileges from multiple users
// @Tags User
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body BatchSetAdminRequest true "Batch user ID list"
// @Success 200 {object} model.CommonResponse{data=BatchSetAdminResponse} "Success"
// @Failure 400 {object} model.CommonResponse "Parameter error"
// @Failure 401 {object} model.CommonResponse "Unauthorized"
// @Failure 403 {object} model.CommonResponse "Forbidden"
// @Failure 404 {object} model.CommonResponse "User not found"
// @Failure 500 {object} model.CommonResponse "System error"
// @Router /api/users/batch/admin [delete]
func UnsetUserAsAdmin(c *gin.Context) {
	// Get current enterprise ID
	eid := config.GetEID(c)
	if eid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(model.InvalidEnterpriseID))
		return
	}

	var batchRequest BatchSetAdminRequest
	if err := c.ShouldBindJSON(&batchRequest); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	userIDs := batchRequest.UserIDs

	// Begin transaction
	tx := model.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(tx.Error))
		return
	}

	// Define response structure
	response := BatchSetAdminResponse{
		Success: []int64{},
		Failed:  []int64{},
	}

	nicknames := make([]string, 0, len(userIDs))
	// Process each user ID
	for _, userID := range userIDs {
		// Get user information
		user, err := model.GetUserByID(userID)
		if err != nil {
			response.Failed = append(response.Failed, userID)
			continue
		}

		// Check if user belongs to current enterprise
		if user.Eid != eid {
			response.Failed = append(response.Failed, userID)
			continue
		}

		// Check if user is an admin
		if user.Role != model.RoleAdminUser {
			response.Success = append(response.Success, userID)
			continue
		}

		// Update user role to common user and clear admin time
		updateMap := map[string]interface{}{
			"role":           model.RoleCommonUser,
			"add_admin_time": 0, // Clear admin time
		}

		err = tx.Model(user).Where("user_id = ?", userID).Updates(updateMap).Error
		if err != nil {
			response.Failed = append(response.Failed, userID)
			continue
		}

		response.Success = append(response.Success, userID)
		nicknames = append(nicknames, user.Nickname)
	}

	// Commit transaction
	if err := tx.Commit().Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	log := model.SystemLog{
		Eid:      eid,
		UserID:   config.GetUserId(c),
		Nickname: config.GetUserNickname(c),
		Module:   model.SystemLogModuleAdmin,
		Action:   model.SystemLogActionUpdate,
		Content:  fmt.Sprintf("删除管理员【%s】", strings.Join(nicknames, "】【")),
		IP:       utils.GetClientIP(c),
	}
	model.CreateSystemLog(&log)

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// BatchAddInternalUserRequest defines the structure for batch adding internal users
type BatchAddInternalUserRequest struct {
	Users []BatchInternalUserInfo `json:"users" binding:"required"`
}

// InternalUserInfo defines the structure for internal user information
type InternalUserInfo struct {
	Username string  `json:"username" binding:"required" example:"john@example.com"`
	Nickname string  `json:"nickname" binding:"required" example:"John Doe"`
	Did      int64   `json:"did" binding:"required" example:"1"`
	Dids     []int64 `json:"dids" example:"1,2,3"`
	Password string  `json:"password" binding:"required" example:"password123"`
}

// BatchInternalUserInfo defines the structure for batch internal user information
type BatchInternalUserInfo struct {
	Username string  `json:"username"`
	Nickname string  `json:"nickname"`
	Dids     []int64 `json:"dids"`
	Password string  `json:"password"`
}

// BatchAddInternalUserResponse defines the structure for batch adding internal users response
type BatchAddInternalUserResponse struct {
	Success []service.BatchAddUserResult `json:"success"` // List of successfully added users
	Failed  []service.BatchAddUserResult `json:"failed"`  // List of failed users
}

// BatchAddInternalUsers adds multiple internal users
// @Summary Batch add internal users
// @Description Add multiple internal users to the system
// @Tags User
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body BatchAddInternalUserRequest true "Batch internal user data"
// @Success 200 {object} model.CommonResponse{data=BatchAddInternalUserResponse} "Success"
// @Failure 400 {object} model.CommonResponse "Parameter error"
// @Failure 401 {object} model.CommonResponse "Unauthorized"
// @Failure 500 {object} model.CommonResponse "System error"
// @Router /api/users/internal/batch [post]
func BatchAddInternalUsers(c *gin.Context) {
	var batchRequest BatchAddInternalUserRequest
	if err := c.ShouldBindJSON(&batchRequest); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	if eid <= 0 {
		c.JSON(http.StatusOK, model.ParamError.ToNewErrorResponse(model.InvalidEnterpriseID))
		return
	}

	nicknames := make([]string, len(batchRequest.Users))
	users := make([]service.InternalUserInfo, len(batchRequest.Users))
	for i, user := range batchRequest.Users {
		users[i] = service.InternalUserInfo{
			Username: user.Username,
			Nickname: user.Nickname,
			Dids:     user.Dids,
			Password: user.Password,
		}
		nicknames[i] = user.Nickname
	}

	userService := service.UserService{}
	result, err := userService.BatchAddInternalUsers(eid, users)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if len(result.Failed) > 0 && len(result.Success) == 0 {
		c.JSON(http.StatusOK, model.ParamError.ToResponse(BatchAddInternalUserResponse{
			Success: result.Success,
			Failed:  result.Failed,
		}))
		return
	}

	model.LogEntityChange(
		fmt.Sprintf("账号【%s】", strings.Join(nicknames, "; ")),
		model.SystemLogActionCreate,
		eid,
		config.GetUserId(c),
		config.GetUserNickname(c),
		model.SystemLogModuleInternalUser,
		nil,
		nil,
		utils.GetClientIP(c),
		nil,
	)

	c.JSON(http.StatusOK, model.Success.ToResponse(BatchAddInternalUserResponse{
		Success: result.Success,
		Failed:  result.Failed,
	}))
}

// RegisterUserToInternalRequest defines the structure for batch registering internal users request
type RegisterUserToInternalRequest struct {
	UserDepartments []struct {
		UserID int64   `json:"user_id" binding:"required"`
		DIDs   []int64 `json:"dids" binding:"required"`
	} `json:"user_departments" binding:"required"`
}

// RegisterUserToInternal registers users as internal users and associates them with departments
// @Summary Register users as internal users and associate with departments
// @Description Batch process user IDs and department IDs, update user information and add department associations within a transaction
// @Tags User
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body RegisterUserToInternalRequest true "User-department mapping data"
// @Success 200 {object} model.CommonResponse
// @Router /api/users/register/to/internal [put]
func RegisterUserToInternal(c *gin.Context) {
	var req RegisterUserToInternalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if len(req.UserDepartments) == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("User-department mapping cannot be empty"))
		return
	}

	eid := config.GetEID(c)
	if eid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(model.InvalidEnterpriseID))
		return
	}

	mappings := make([]service.UserDepartmentMapping, len(req.UserDepartments))
	for i, mapping := range req.UserDepartments {
		mappings[i] = service.UserDepartmentMapping{
			UserID: mapping.UserID,
			DIDs:   mapping.DIDs,
		}
	}

	userService := service.UserService{}
	result, err := userService.RegisterUserToInternal(eid, mappings)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"success_count": result.SuccessCount,
		"failed_users":  result.FailedUsers,
		"total":         result.Total,
	}))
}

// InternalUserRequest 定义获取内部用户列表的请求参数
type InternalUserRequest struct {
	Keyword string `json:"keyword" form:"keyword" example:"张三"`  // 关键词，用于搜索部门名称或用户昵称/手机号
	Status  int    `json:"status" form:"status" example:"-1"`    // 用户状态，-1表示全部，0未加入，1已加入，2被禁用
	Offset  int    `json:"offset" form:"offset" example:"0"`     // 分页偏移量
	Limit   int    `json:"limit" form:"limit" example:"10"`      // 每页数量
	DID     int64  `json:"did" form:"did" example:"0"`           // 部门ID，0表示不按部门筛选
	From    int    `json:"from" form:"from" example:"0"`         // 来源，0表示不按来源筛选
	NotBind int    `json:"not_bind" form:"not_bind" example:"0"` // 是否未绑定，0表示不筛选，1表示未绑定
}

// InternalUserResponse 定义内部用户列表的响应结构
type InternalUserResponse = service.InternalUserListResponse

// GetInternalUsers 获取内部用户列表
// @Summary 获取内部用户列表
// @Description 获取企业内部用户列表，支持分页、按状态查询、按成员/部门模糊匹配
// @Tags User
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param keyword query string false "关键词，用于搜索部门名称或用户昵称/手机号"
// @Param status query int false "用户状态，-1表示全部，0未加入，1已加入，2被禁用，默认为-1"
// @Param offset query int false "分页偏移量，默认为0"
// @Param limit query int false "每页数量，默认为10"
// @Param not_bind query int false "筛选没有绑定的用户，0表示不筛选，1表示未绑定"
// @Param did query int false "部门ID，0表示不按部门筛选"
// @Param from query int false "来源，0 1企业微信，2钉钉"
// @Success 200 {object} model.CommonResponse{data=InternalUserResponse} "成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 500 {object} model.CommonResponse "系统错误"
// @Router /api/users/internal [get]
func GetInternalUsers(c *gin.Context) {
	eid := config.GetEID(c)
	if eid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(model.InvalidEnterpriseID))
		return
	}

	// 解析请求参数
	var req InternalUserRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 设置默认值
	if req.Limit <= 0 {
		req.Limit = 10
	}
	if req.Offset < 0 {
		req.Offset = 0
	}
	if c.Query("status") == "" || req.Status < 0 {
		req.Status = -1 // 默认查询全部状态
	}

	// 调用服务层获取内部用户列表
	userService := service.UserService{}
	result, err := userService.GetInternalUsersWithPagination(
		eid,
		req.Keyword,
		req.Status,
		req.Offset,
		req.Limit,
		req.DID,
		req.From,
		req.NotBind,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 返回处理结果
	c.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// UpdateUserStatus updates the user status
// @Summary Update user status
// @Description Update the status of a specified user (enable/disable)
// @Tags User
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "User ID"
// @Param status body UpdateUserStatusRequest true "Status information"
// @Success 200 {object} model.CommonResponse{data=model.User} "Success"
// @Router /api/users/{id}/status [patch]
func UpdateUserStatus(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	var req UpdateUserStatusRequest
	if err = c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// Validate if the status value is valid
	if req.Status != model.UserStatusJoined && req.Status != model.UserStatusDisabled {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("Invalid status value"))
		return
	}

	eid := config.GetEID(c)

	// Get user
	user, err := model.GetUserByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// Verify if the user belongs to the current enterprise
	if user.Eid != eid {
		c.JSON(http.StatusForbidden, model.NotFound.ToResponse(nil))
		return
	}

	// Update user status
	user.Status = req.Status
	if err := user.Update(false); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	statusText := "激活"
	if user.Status == model.UserStatusDisabled {
		statusText = "禁用"
	}

	log := model.SystemLog{
		Eid:      eid,
		UserID:   config.GetUserId(c),
		Nickname: config.GetUserNickname(c),
		Module:   model.SystemLogModuleSystem,
		Action:   model.SystemLogActionToggle,
		Content:  fmt.Sprintf("%s账号【%s】", statusText, user.Nickname),
		IP:       utils.GetClientIP(c),
	}
	model.CreateSystemLog(&log)
	service.InvalidateInternalUserListCache(eid)

	c.JSON(http.StatusOK, model.Success.ToResponse(user))
}

// UpdateUserStatusRequest request for updating user status
type UpdateUserStatusRequest struct {
	Status int `json:"status" binding:"required" example:"1"` // User status: 1-Joined, 2-Disabled
}

// UpdateInternalUserRequest defines the structure for updating internal user
type UpdateInternalUserRequest struct {
	Nickname   string  `json:"nickname"`
	Status     int     `json:"status"`
	Mobile     string  `json:"mobile"`     // Mobile number, can be updated when user status is not joined
	Email      string  `json:"email"`      // Email address, can be updated when user status is not joined
	Department []int64 `json:"department"` // Department ID list
}

// UpdateInternalUser updates internal user information
// @Summary Update internal user information
// @Description Update nickname, status and department relationships of internal user
// @Tags User
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "User ID"
// @Param request body UpdateInternalUserRequest true "Update data"
// @Success 200 {object} model.CommonResponse
// @Router /api/users/internal/{id} [put]
func UpdateInternalUser(c *gin.Context) {
	// Parse user ID from request parameters
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// Get enterprise ID from context
	eid := config.GetEID(c)

	// Retrieve user by ID
	user, err := model.GetUserByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}
	oldUser := *user
	// Verify user belongs to current enterprise
	if user.Eid != eid {
		c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse(nil))
		return
	}

	// Parse request body
	var req UpdateInternalUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// Begin database transaction
	tx := model.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(tx.Error))
		return
	}

	// Update basic user information
	if req.Nickname != "" {
		user.Nickname = req.Nickname
	}

	// Only allow editing contact information when user hasn't joined yet
	if user.Status == model.UserStatusNotJoined {
		// Update mobile number if provided and not already in use
		if req.Mobile != "" {
			// Check if mobile number already exists
			var count int64
			if err := tx.Model(&model.User{}).Where("eid = ? AND mobile = ? AND user_id != ?", eid, req.Mobile, id).Count(&count).Error; err != nil {
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
				return
			}
			if count > 0 {
				tx.Rollback()
				c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("Mobile number already exists"))
				return
			}
			user.Mobile = req.Mobile
		}

		// Update email if provided and not already in use
		if req.Email != "" {
			// Check if email already exists
			var count int64
			if err := tx.Model(&model.User{}).Where("eid = ? AND email = ? AND user_id != ?", eid, req.Email, id).Count(&count).Error; err != nil {
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
				return
			}
			if count > 0 {
				tx.Rollback()
				c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("Email already exists"))
				return
			}
			user.Email = req.Email
		}
	}

	// Update user status if provided
	if req.Status != 0 {
		user.Status = req.Status
	}

	// Save user changes
	if err := tx.Save(user).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// Update department relationships if provided
	if len(req.Department) > 0 {
		// Fetch existing department relationships
		bindvalue, err := model.GetMemberBindingByDepartmentFromBackend(id, tx)
		if err != nil || bindvalue == nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}

		var existingRelations []*model.MemberDepartmentRelation
		if err := tx.Where("bid = ? AND eid = ?", bindvalue.ID, eid).Find(&existingRelations).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}

		// Create map of existing department IDs for quick lookup
		existingDeptMap := make(map[int64]bool)
		for _, relation := range existingRelations {
			existingDeptMap[relation.DID] = true
		}

		// Identify departments to remove
		var deptToDelete []int64
		for _, relation := range existingRelations {
			found := false
			for _, newDeptID := range req.Department {
				if newDeptID > 0 && relation.DID == newDeptID {
					found = true
					break
				}
			}
			if !found {
				deptToDelete = append(deptToDelete, relation.DID)
			}
		}

		// Delete removed department relationships
		if len(deptToDelete) > 0 {
			if err := tx.Where("eid = ? AND did IN ?", eid, deptToDelete).Delete(&model.MemberDepartmentRelation{}).Error; err != nil {
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
				return
			}
		}

		// Add new department relationships
		for _, deptID := range req.Department {
			// Skip if department already exists or ID is invalid (<=0)
			if existingDeptMap[deptID] || deptID <= 0 {
				continue
			}

			// Create new department relationship
			relation := model.MemberDepartmentRelation{
				EID: eid,
				BID: bindvalue.ID,
				DID: deptID,
			}
			if err := tx.Create(&relation).Error; err != nil {
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
				return
			}
		}
	}

	// Commit transaction
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// Prepare for logging
	fieldMap := map[string]string{
		"Nickname": "昵称",
		"Mobile":   "手机号",
		"Email":    "邮箱",
		"Status":   "状态",
	}
	model.LogEntityChange(
		fmt.Sprintf("账号【%s】", oldUser.Nickname),
		model.SystemLogActionUpdate,
		eid,
		config.GetUserId(c),
		config.GetUserNickname(c),
		model.SystemLogModuleInternalUser,
		oldUser,
		user,
		utils.GetClientIP(c),
		fieldMap,
	)
	service.InvalidateInternalUserListCache(eid)

	c.JSON(http.StatusOK, model.Success.ToResponse(user))
}

// ResetPasswordRequest 重置密码请求结构体
type ResetPasswordRequest struct {
	Mobile          string `json:"mobile"`                                           // 手机号（与邮箱二选一）
	Email           string `json:"email"`                                            // 邮箱（与手机号二选一）
	VerifyCode      string `json:"verify_code" binding:"required"`                   // 验证码
	NewPassword     string `json:"new_password" binding:"required,min=8,max=20"`     // 新密码（8-20位）
	ConfirmPassword string `json:"confirm_password" binding:"required,min=8,max=20"` // 确认新密码
}

// Logout 用户登出
// @Summary 用户登出
// @Description 使当前用户的访问令牌失效，完成登出操作
// @Tags User
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse "登出成功"
// @Router /api/logout [post]
func Logout(c *gin.Context) {
	// 从请求头获取令牌
	token := c.Request.Header.Get("Authorization")
	token = strings.Replace(token, "Bearer ", "", 1)

	if token == "" {
		c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(nil))
		return
	}

	// 获取用户ID
	userID, exists := c.Get(session.SESSION_USER_ID)
	if !exists {
		c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(nil))
		return
	}

	uid, ok := userID.(int64)
	if !ok {
		c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(nil))
		return
	}

	// 获取用户信息
	user, err := model.GetUserByID(uid)
	if err != nil || user == nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 使令牌失效
	err = user.InvalidateAccessToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 记录系统日志
	log := model.SystemLog{
		Eid:      user.Eid,
		UserID:   user.UserID,
		Nickname: user.Nickname,
		Module:   model.SystemLogModuleSystem,
		Action:   model.SystemLogActionLoginOut,
		Content:  "登出",
		IP:       utils.GetClientIP(c),
	}
	model.CreateSystemLog(&log)

	c.JSON(http.StatusOK, model.Success.ToResponse("登出成功"))
}

// ResetPassword 重置密码
// @Summary 重置密码
// @Description 用户通过手机或邮箱验证码重置密码
// @Tags User
// @Accept json
// @Produce json
// @Param request body ResetPasswordRequest true "重置密码请求"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 401 {object} model.CommonResponse "验证码错误"
// @Failure 404 {object} model.CommonResponse "用户不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/reset_password [post]
func ResetPassword(c *gin.Context) {
	var req ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if req.NewPassword != req.ConfirmPassword {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("新密码和确认密码不一致"))
		return
	}

	// 判定账号类型：手机号或邮箱（二选一）
	isMobile := req.Mobile != "" && helper.IsValidPhone(req.Mobile)
	isEmail := req.Email != "" && helper.IsValidEmail(req.Email)
	if !isMobile && !isEmail {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(model.InvalidMobileOrEmail))
		return
	}

	// 校验验证码
	var (
		code string
		err  error
	)
	if isMobile {
		redisKey := fmt.Sprintf("Api:CheckVerificationCode:%s", req.Mobile)
		code, err = common.RedisGet(redisKey)
	} else {
		var vc model.VerificationCode
		err = model.DB.Where("target = ? AND type = ? AND code = ?", req.Email, model.VerificationCodeTypeEmail, req.VerifyCode).First(&vc).Error
		if err == nil {
			code = vc.Code
		}
	}
	if err != nil || code != req.VerifyCode {
		c.JSON(http.StatusBadRequest, model.InvalidVerificationCodeError.ToResponse(model.InvalidVerificationCode))
		return
	}

	// 查询站点用户
	eid := config.GetEID(c)
	var user *model.User
	query := model.DB.Where("eid = ?", eid)
	if isMobile {
		query = query.Where("mobile = ?", req.Mobile)
	} else {
		query = query.Where("email = ?", req.Email)
	}
	err = query.First(&user).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse("用户不存在"))
		} else {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		}
		return
	}

	// 加密新密码，并更新用户
	salt := helper.RandomString(6)
	hashedPassword, err := helper.PasswordHash(req.NewPassword, salt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.InvalidVerificationCodeError.ToResponse(err))
		return
	}

	// 更新用户密码
	user.Password = hashedPassword
	user.Salt = salt
	err = model.DB.Save(&user).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse("密码重置成功"))
}

// UpdateUserMobileRequest 更新用户手机号请求结构体
type UpdateUserMobileRequest struct {
	OldCode   string `json:"old_code"`                      // 原手机号验证码
	NewMobile string `json:"new_mobile" binding:"required"` // 新手机号
	NewCode   string `json:"new_code" binding:"required"`   // 新手机号验证码
}

// UpdateUserMobile 绑定、更新用户手机号
// @Summary 绑定、更新用户手机号
// @Description 通过原手机号和新手机号验证码验证后更新绑定的手机号
// @Tags User
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "用户ID"
// @Param data body UpdateUserMobileRequest true "原手机号验证码、新手机号及新验证码"
// @Success 200 {object} model.CommonResponse{data=model.User} "更新成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "验证码无效"
// @Failure 409 {object} model.CommonResponse "手机号已被绑定"
// @Router /api/users/{id}/mobile [patch]
func UpdateUserMobile(c *gin.Context) {
	// 解析路径参数ID
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	var req UpdateUserMobileRequest
	if err = c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 获取当前用户
	user, err := model.GetUserByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	if user.Mobile != "" {
		oldMobileRedisKey := fmt.Sprintf("Api:CheckVerificationCode:%s", user.Mobile)
		oldCode, err := common.RedisGet(oldMobileRedisKey)
		if err != nil || oldCode != req.OldCode {
			c.JSON(http.StatusUnauthorized, model.AuthFailed.ToNewErrorResponse(model.InvalidVerificationCode))
			return
		}
	}

	// 验证新手机号格式
	if !helper.IsValidPhone(req.NewMobile) {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(model.InvalidMobileFormat))
		return
	}

	// 验证新手机号验证码（Redis）
	newMobileRedisKey := fmt.Sprintf("Api:CheckVerificationCode:%s", req.NewMobile)
	newCode, err := common.RedisGet(newMobileRedisKey)
	if err != nil || newCode != req.NewCode {
		c.JSON(http.StatusUnauthorized, model.AuthFailed.ToNewErrorResponse(model.InvalidVerificationCode))
		return
	}

	// 检查新手机号是否已被其他用户绑定
	existingUser, err := model.GetUserByMobile(user.Eid, req.NewMobile)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}
	if existingUser.UserID > 0 && existingUser.UserID != id {
		err := errors.New("This mobile has been bound by another user")
		c.JSON(http.StatusConflict, model.AuthFailed.ToErrorResponse(err))
		return
	}

	user.Mobile = req.NewMobile
	if err := user.Update(false); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	service.InvalidateInternalUserListCache(user.Eid)

	c.JSON(http.StatusOK, model.Success.ToResponse(user))
}

// @Summary 获取组织用户列表
// @Description 获取指定组织下的所有用户信息及其成员绑定关系
// @Tags User
// @Accept application/json
// @Produce application/json
// @Security BearerAuth
// @Param did query int64 false "部门ID" default(0)
// @Param status query int false "用户状态（0：未加入，1：已加入 -1 全部）" default(-1)
// @Param from query int false "绑定来源（0：默认，1：企业微信，2：钉钉）" default(0)
// @Param keyword query string false "搜索关键字"
// @Param offset query int false "offset" default(0)
// @Param limit query int false "limit" default(10)
// @Param user_status query int false "用户状态 -1 全部" default(-1)
// @Success 200 {object} model.CommonResponse(data=service.OrganizationUserListParams) "成功返回用户列表及绑定关系"
// @Router /api/users/organization [get]
func GetOrganizationUserList(c *gin.Context) {
	var req service.OrganizationUserListParams
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	eid := config.GetEID(c)
	req.EID = eid

	if req.From == model.DepartmentFromBackend {
		err := service.InitFromBackendMemberBinding(eid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	if req.From == model.DepartmentFromWecom {
		if req.Status == model.MemberBindingStatusInactive {
			req.UserStatus = model.UserStatusNotJoined
		} else if req.Status == model.MemberBindingStatusActive {
			req.UserStatus = model.UserStatusJoined
		}
	}

	userListResp, err := service.GetOrganizationalUserList(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(userListResp))
}

// SetUserToDefaultSubscription sets a user's subscription to the default subscription
// @Summary Set user to default subscription
// @Description Updates the user's subscription to the default subscription and sets the expiration time to permanent
// @Tags User
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "User ID"
// @Success 200 {object} model.CommonResponse "Success"
// @Failure 400 {object} model.CommonResponse "Parameter error"
// @Failure 403 {object} model.CommonResponse "Forbidden"
// @Failure 404 {object} model.CommonResponse "User not found"
// @Failure 500 {object} model.CommonResponse "System error"
// @Router /api/users/{id}/default_subscription [put]
func SetUserToDefaultSubscription(c *gin.Context) {
	// Parse user ID from the request path
	userID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("Invalid user ID")))
		return
	}

	// Get the current logged-in user's ID and role
	currentUserID := config.GetUserId(c)
	currentUserRole := config.GetUserRole(c)

	// Check if the current user is an admin
	if currentUserRole < model.RoleAdminUser {
		// If not an admin, ensure the user can only modify their own subscription
		if currentUserID != userID {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse(fmt.Errorf("You can only modify your own subscription")))
			return
		}
	}

	// Retrieve the user by ID
	user, err := model.GetUserByID(userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(fmt.Errorf("User not found")))
			return
		}
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// Check if the user's subscription has expired
	currentTime := time.Now().UnixMilli()
	if user.ExpiredTime > currentTime {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("Subscription has not expired yet")))
		return
	}

	// Retrieve the default subscription setting
	defaultSubscription, err := model.GetDefaultSubscription(user.Eid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(fmt.Errorf("Failed to retrieve default subscription: %v", err)))
		return
	}

	// Update the user's subscription to the default subscription
	user.GroupId = defaultSubscription.GroupId
	user.ExpiredTime = 0 // Set expiration time to permanent

	// Save the updated user information
	if err := user.Update(false); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(fmt.Errorf("Failed to update user subscription: %v", err)))
		return
	}

	// Log the subscription change
	model.LogEntityChange(
		fmt.Sprintf("User【%s】subscription updated to default", user.Nickname),
		model.SystemLogActionUpdate,
		user.Eid,
		user.UserID,
		user.Nickname,
		model.SystemLogModuleRegistered,
		nil,
		user,
		utils.GetClientIP(c),
		map[string]string{
			"GroupId":     "Subscription Group ID",
			"ExpiredTime": "Expiration Time",
		},
	)

	// Return success response
	c.JSON(http.StatusOK, model.Success.ToResponse(user))
}

// IsInit checks whether the system has been initialized (whether a user exists for eid=1)
// @Summary Check initialization status
// @Description Returns true if the system is initialized (exists a user with eid=1), otherwise false
// @Tags System
// @Accept json
// @Produce json
// @Success 200 {object} model.CommonResponse{data=bool} "Success"
// @Router /api/is_init [get]
func IsInit(c *gin.Context) {
	var user model.User
	if err := model.DB.Where("eid = ?", 1).First(&user).Error; err != nil {
		c.JSON(http.StatusOK, model.Success.ToResponse(false))
	} else {
		c.JSON(http.StatusOK, model.Success.ToResponse(true))
	}
}
