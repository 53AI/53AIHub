package model

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/common/utils/jwt"
	"github.com/gin-gonic/gin"
)

type User struct {
	UserID         int64           `json:"user_id" gorm:"primaryKey;autoIncrement"`
	Username       string          `json:"username" gorm:"not null;index" binding:"required" example:"john_doe"`
	Nickname       string          `json:"nickname" gorm:"not null" example:"John Doe"`
	Avatar         string          `json:"avatar" gorm:"not null" example:"http://avatar.cc/a.jpg"`
	Mobile         string          `json:"mobile" gorm:"size:20" example:"13800138000"`
	Email          string          `json:"email" gorm:"size:100" example:"john@example.com"`
	Eid            int64           `json:"eid" gorm:"not null;index" example:"123"`
	Role           int64           `json:"role" gorm:"type:int;default:1;not null" example:"1"`
	GroupId        int64           `json:"group_id" gorm:"type:int;default:0;not null" example:"0"`
	Status         int             `json:"status" gorm:"type:int;default:1;not null;comment:'User status: 0-Not joined, 1-Joined, 2-Disabled'" example:"1"`
	Password       string          `json:"-" gorm:"not null;default:''"`
	Salt           string          `json:"-" gorm:"size:10;not null"`
	ExpiredTime    int64           `json:"expired_time" gorm:"not null" example:"1672502400"`
	LastLoginTime  int64           `json:"last_login_time" gorm:"not null" example:"1672502400"`
	AccessToken    string          `json:"access_token" gorm:"type:varchar(512);column:access_token"`
	RelatedId      int64           `json:"related_id" gorm:"type:int;default:0;not null;index:idx_users_related_id" example:"0"`
	Type           int             `json:"type" gorm:"type:int;default:1;not null;comment:'User type: 1-Registered user, 2-Internal user'" example:"1"`
	AddAdminTime   int64           `json:"add_admin_time" gorm:"type:bigint;default:0;not null;comment:'Time when user was added as admin'" example:"1672502400"`
	OpenID         string          `json:"openid" gorm:"type:varchar(512);column:openid"`
	UnionID        string          `json:"unionid" gorm:"type:varchar(512);column:unionid"`
	Departments    []Department    `json:"departments" gorm:"-"`
	MemberBindings []MemberBinding `json:"memberbindings" gorm:"-"`
	GroupIds       []int64         `json:"group_ids" gorm:"-"`
	BaseModel
}

const (
	RoleGuestUser   = 0
	RoleCommonUser  = 1
	RoleAdminUser   = 10
	RoleCreatorUser = 10000
	RoleRootUser    = 100000

	UserStatusNotJoined = 0 // Not joined
	UserStatusJoined    = 1 // Joined
	UserStatusDisabled  = 2 // Disabled

	UserTypeRegistered = 1 // Registered user
	UserTypeInternal   = 2 // Internal user
	UserTypeVisitor    = 3 // Visitor user (Shadow Account)
)

func (user *User) Create() error {
	var err error
	if user.Eid == 0 {
		return errors.New("eid is empty")
	}
	// check if username exists
	var count int64
	// DB.Model(&User{}).Where("eid = ? AND username = ?", user.Eid, user.Username).Count(&count)
	// if count > 0 {
	// 	return errors.New("username already exists")
	// }

	if user.Mobile != "" {
		// check if mobile exists
		DB.Model(&User{}).Where("eid =? AND mobile =?", user.Eid, user.Mobile).Count(&count)
		if count > 0 {
			return errors.New("mobile already exists")
		}
	}

	if user.Email != "" {
		// check if email exists
		DB.Model(&User{}).Where("eid =? AND email =?", user.Eid, user.Email).Count(&count)
		if count > 0 {
			return errors.New("email already exists")
		}
	}

	if user.Salt == "" {
		user.Salt = helper.RandomString(6)
	}
	if user.Password != "" {
		user.Password, err = helper.PasswordHash(user.Password, user.Salt)
		if err != nil {
			return err
		}
	} else {
		return errors.New("password is empty")
	}

	result := DB.Create(user)
	if result.Error != nil {
		return result.Error
	}

	user.AccessToken, err = jwt.UserGenerateJWT(user.UserID, user.Eid)
	if err != nil {
		return err
	}

	err = DB.Model(user).Updates(user).Error

	return err
}

func (user *User) Update(updatePassword bool) error {
	updateMap := map[string]interface{}{
		"nickname":     user.Nickname,
		"avatar":       user.Avatar,
		"mobile":       user.Mobile,
		"email":        user.Email,
		"group_id":     user.GroupId,
		"expired_time": user.ExpiredTime,
		"status":       user.Status,
		"role":         user.Role,
		"openid":       user.OpenID,
		"unionid":      user.UnionID,
	}

	if updatePassword && user.Password != "" {
		var err error
		user.Password, err = helper.PasswordHash(user.Password, user.Salt)
		if err != nil {
			return err
		}

		updateMap["password"] = user.Password
	}

	return DB.Model(user).Updates(updateMap).Error
}

func (user *User) Delete() error {
	err := DB.Delete(user).Error
	return err
}

func GetUserByID(userID int64) (*User, error) {
	var user User
	err := DB.First(&user, userID).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func GetUserByIDAndEid(eid, userID int64) (*User, error) {
	var user User
	err := DB.Where("user_id = ? AND eid = ?", userID, eid).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (user *User) LoginValidate(eid int64, username string, password string) error {
	if username == "" || password == "" {
		return errors.New("username or password is empty")
	}

	foundUser, err := GetUserByUserName(eid, username)
	if err != nil {
		return errors.New("user not found")
	}
	*user = *foundUser

	password, err = helper.PasswordHash(password, user.Salt)
	if err != nil {
		return err
	}
	if user.Password != password {
		return errors.New("username or password is incorrect")
	}

	return nil
}

func GetUserByUserName(eid int64, username string) (*User, error) {
	var user User
	err := DB.Where("eid = ? AND username = ?", eid, username).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (user *User) RefreshAccessToken() error {
	var err error
	user.AccessToken, err = jwt.UserGenerateJWT(user.UserID, user.Eid)
	if err != nil {
		return err
	}

	// 内部成员登录默认改为加入
	if user.Type == UserTypeInternal && user.Status == UserStatusNotJoined {
		user.Status = UserStatusJoined
	}

	user.LastLoginTime = time.Now().UTC().UnixMilli()
	err = DB.Model(user).Updates(user).Error
	return err
}

func (user *User) UpdateStatusToJoin() error {
	var err error
	if user.Status == UserStatusNotJoined {
		user.Status = UserStatusJoined
		err = DB.Model(user).Updates(user).Error
	}
	return err
}

func ValidateAccessToken(token string) (user *User) {
	if token == "" {
		return nil
	}
	user = &User{}
	if DB.Where("access_token = ?", token).First(user).RowsAffected == 1 {
		return user
	}
	return nil
}

func GetUserList(eid int64, keyword string, group_id int64, offset int, limit int) (count int64, users []*User, err error) {
	db := DB.Model(&User{}).Omit("password", "access_token").Where("eid = ?", eid)
	if keyword != "" {
		db = db.Where("username LIKE ? OR nickname LIKE ? OR mobile LIKE ? OR email LIKE ?",
			keyword+"%", keyword+"%", keyword+"%", keyword+"%")
	}

	if group_id != 0 {
		db = db.Where("group_id =?", group_id)
	}

	db.Count(&count)

	err = db.Offset(offset).Limit(limit).Find(&users).Error

	return count, users, err
}

func DeleteUser(eid int64, user_id int64) error {
	var user User
	if err := DB.Where("eid = ? AND user_id = ?", eid, user_id).First(&user).Error; err != nil {
		return err
	}

	tx := DB.Begin()
	if tx.Error != nil {
		return tx.Error
	}

	if user.Type == UserTypeInternal {
		var binds []*MemberBinding
		if err := tx.Where("eid = ? AND mid = ?", eid, user_id).Find(&binds).Error; err != nil {
			tx.Rollback()
			return err
		}
		if len(binds) > 0 {
			for _, bind := range binds {
				if bind.From == DepartmentFromBackend {
					err := tx.Where(map[string]interface{}{"eid": eid, "bid": bind.ID, "from": DepartmentFromBackend}).Delete(&MemberDepartmentRelation{}).Error
					if err != nil {
						tx.Rollback()
						return err
					}
					if err := tx.Where("eid = ? AND id = ?", eid, bind.ID).Delete(&MemberBinding{}).Error; err != nil {
						tx.Rollback()
						return err
					}
				} else if bind.From == DepartmentFromWecom {
					err := tx.Model(&MemberBinding{}).Where(map[string]interface{}{"eid": eid, "id": bind.ID}).Updates(
						map[string]interface{}{
							"mid":    0,
							"status": MemberBindingStatusInactive,
						}).Error
					if err != nil {
						tx.Rollback()
						return err
					}
				}
			}
		}
	}

	if err := tx.Where("resource_type = ? AND resource_id = ?", ResourceTypeUser, user_id).
		Delete(&ResourcePermission{}).Error; err != nil {
		tx.Rollback()
		return err
	}

	if err := DeletePermissionsBySubject(tx, eid, SUBJECT_TYPE_USER, user_id); err != nil {
		tx.Rollback()
		return err
	}

	if err := tx.Where("eid = ? AND user_id = ?", eid, user_id).Delete(&User{}).Error; err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit().Error
}

func UpdateUserPassword(eid int64, userID int64, newPassword string) error {
	var user User
	if err := DB.Where("user_id = ? AND eid = ?", userID, eid).First(&user).Error; err != nil {
		return err
	}

	if user.Password != "" {
		user.Password, _ = helper.PasswordHash(newPassword, user.Salt)
	}

	return DB.Model(&user).Update("password", user.Password).Error
}

// UpdateAllUsersPasswordByRelatedID updates password for all enterprise users whose related_id equals the platform UserID.
// It re-hashes the newPassword with each enterprise user's own salt.
func UpdateAllUsersPasswordByRelatedID(relatedId int64, newSalt string, hashedPassword string) error {
	if relatedId <= 0 {
		return errors.New("invalid relatedId")
	}
	// 批量更新所有 related_id 命中的记录的 salt 与 password
	return DB.Model(&User{}).
		Where("related_id = ?", relatedId).
		Updates(map[string]interface{}{
			"salt":     newSalt,
			"password": hashedPassword,
		}).Error
}

func GetUserByEmail(eid int64, email string) (User, error) {
	var user User
	err := DB.Where("eid = ? AND email = ?", eid, email).First(&user).Error
	return user, err
}

func GetUserByMobile(eid int64, mobile string) (User, error) {
	var user User
	err := DB.Where("eid = ? AND mobile = ?", eid, mobile).First(&user).Error
	return user, err
}

func (user *User) VerifyPassword(password string) error {
	hashedPassword, err := helper.PasswordHash(password, user.Salt)
	if err != nil {
		return err
	}
	if hashedPassword != user.Password {
		return errors.New("username or password is incorrect")
	}
	return nil
}

// GetUserByRelatedId retrieves a user by related ID
func GetUserByRelatedId(eid int64, relatedId int64) (*User, error) {
	var user User
	err := DB.Where("eid = ? AND related_id = ?", eid, relatedId).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func GetFirstUserByRelatedId(relatedId int64) (*User, error) {
	var user User
	err := DB.Where("related_id = ?", relatedId).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// GetUserListWithRoles retrieves user list with role filtering
func GetUserListWithRoles(eid int64, keyword string, groupId int64, roleStr string, userType int64, rangeBy string, timeStart, timeEnd int64, offset, limit int) (int64, []*User, error) {
	var users []*User
	query := DB.Model(&User{}).Where("eid = ?", eid)

	if userType != 0 {
		query = query.Where("type =?", userType)
	}

	// Process keyword search
	if keyword != "" {
		query = query.Where("nickname LIKE ? OR mobile LIKE ? OR email LIKE ?", "%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%")
	}

	// Process user group filtering
	if groupId > 0 {
		query = query.Where("group_id = ?", groupId)
	}

	// Process role filtering
	if roleStr != "" {
		// Convert comma-separated role string to integer slice
		roleStrs := strings.Split(roleStr, ",")
		var roles []int
		for _, r := range roleStrs {
			if roleInt, err := strconv.Atoi(strings.TrimSpace(r)); err == nil {
				roles = append(roles, roleInt)
			}
		}

		if len(roles) > 0 {
			query = query.Where("role IN ?", roles)
		}
	}

	if timeStart > 0 {
		query = query.Where(fmt.Sprintf("%s >= ?", rangeBy), timeStart)
	}

	if timeEnd > 0 {
		query = query.Where(fmt.Sprintf("%s <= ?", rangeBy), timeEnd)
	}

	// Get total count
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return 0, nil, err
	}

	// Get paginated data
	if err := query.Offset(offset).Limit(limit).Find(&users).Error; err != nil {
		return 0, nil, err
	}

	return count, users, nil
}

// IsUserExistsByAccount checks if a user exists by account (email or mobile)
func IsUserExistsByAccount(eid int64, account string) (bool, error) {
	var count int64

	// Check if the account is an email or mobile
	isEmail := helper.IsValidEmail(account)
	isMobile := helper.IsValidPhone(account)

	query := DB.Model(&User{}).Where("eid = ?", eid)

	if isEmail {
		// Check by email
		query = query.Where("email = ?", account)
	} else if isMobile {
		// Check by mobile
		query = query.Where("mobile = ?", account)
	} else {
		// Check by username
		query = query.Where("username = ?", account)
	}

	err := query.Count(&count).Error
	if err != nil {
		return false, err
	}

	return count > 0, nil
}

// LoadDepartments 加载用户关联的部门信息
// LoadDepartments 加载用户关联的部门信息
func (u *User) LoadDepartments(from int) error {
	var departments []Department

	// 1. 获取当前数据库兼容的列名引用字符串
	// MySQL 返回: `from`
	// PGSQL 返回: "from"
	qFrom := DB.Statement.Quote("from")

	// 2. 使用 fmt.Sprintf 动态构建 JOIN 语句，替换掉硬编码的符号
	// 注意：这里的 %s 会被替换为 qFrom
	joinBindings := fmt.Sprintf(
		"JOIN member_bindings ON member_department_relations.bid = member_bindings.id AND member_bindings.eid = departments.eid AND member_bindings.%s = member_department_relations.%s",
		qFrom, qFrom,
	)

	err := DB.Table("departments").
		Joins("JOIN member_department_relations ON departments.did = member_department_relations.did AND member_department_relations.eid = departments.eid").
		Joins(joinBindings). // 使用动态构建的 join 语句
		Where("member_bindings.mid = ? AND departments.eid = ?", u.UserID, u.Eid).
		// 3. 联表字段 from 不能走 map，否则 GORM 会把带点号的键误组装成 departments.member_department_relations.from
		Where(fmt.Sprintf("member_department_relations.%s = ?", qFrom), from).
		Find(&departments).Error

	if err == nil && len(departments) > 0 {
		u.Departments = departments
	}
	return err
}

func (u *User) LoadMemberBindings(from int) error {
	var memberBindings []MemberBinding
	if u.UserID == 0 {
		return nil
	}
	err := DB.Where(map[string]interface{}{"mid": u.UserID, "eid": u.Eid, "from": from}).
		Find(&memberBindings).Error
	if err == nil && len(memberBindings) > 0 {
		u.MemberBindings = memberBindings
	}
	return err
}

func (u *User) LoadUserInfo(from int) {
	_ = u.LoadDepartments(from)
	_ = u.LoadMemberBindings(from)
	_ = u.LoadGroupIds()
}

func (u *User) GetUserGroupIds() ([]int64, error) {
	switch u.Type {
	case UserTypeRegistered:
		return []int64{u.GroupId}, nil
	case UserTypeInternal:
		var groupIDs, userGroupIds []int64
		err := DB.Model(&ResourcePermission{}).Where("resource_type = ? AND resource_id = ?", ResourceTypeUser, u.UserID).Pluck("group_id", &userGroupIds).Error
		if err != nil {
			return nil, err
		}
		var bids []int64
		err = DB.Model(&MemberBinding{}).Where("eid = ? AND bindvalue = ?", u.Eid, fmt.Sprintf("%d", u.UserID)).Pluck("id", &bids).Error
		if err != nil {
			return nil, err
		}

		var dids []int64
		err = DB.Model(&MemberDepartmentRelation{}).Where("eid = ? AND bid in ?", u.Eid, bids).Pluck("did", &dids).Error
		if err != nil {
			return nil, err
		}

		departmentGroupIds, err := GetGroupIDsByDepartmentIDs(dids)
		if err != nil {
			return nil, err
		}

		groupIDs = append(userGroupIds, departmentGroupIds...)
		return groupIDs, nil
	}
	return []int64{}, nil
}

func (u *User) LoadGroupIds() error {
	groupIDs, err := u.GetUserGroupIds()
	if err != nil {
		return err
	}
	u.GroupIds = groupIDs
	if u.Type == UserTypeInternal && u.GroupId > 0 {
		u.GroupIds = append(u.GroupIds, u.GroupId)
	}
	return nil
}

func GetLoginUser(c *gin.Context) (*User, error) {
	authHeader := c.GetHeader("Authorization")
	authHeader = strings.Replace(authHeader, "Bearer ", "", 1)

	if authHeader != "" {
		user := ValidateAccessToken(authHeader)
		if user != nil {
			return user, nil
		}

		channelUser, _, _, err := ValidateUserChannelToken(authHeader)
		if err == nil && channelUser != nil {
			return channelUser, nil
		}
	}
	return nil, errors.New("user not found")
}

// GetUserByOpenId 根据OpenID获取用户
func GetUserByOpenId(openId string, eid int64) (*User, error) {
	var user User
	if err := DB.Where("openid = ? and eid = ?", openId, eid).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func GetUserByUnionId(unionId string, eid int64) (*User, error) {
	var user User
	if err := DB.Where("unionid = ? and eid = ?", unionId, eid).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func GetFirstUserByUnionId(unionId string) (*User, error) {
	var user User
	if err := DB.Where("unionid = ?", unionId).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

// IsOpenIdExists 检查OpenID是否已存在
func IsOpenIdExists(openId string) (bool, error) {
	var count int64
	if err := DB.Model(&User{}).Where("openid = ?", openId).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func GetUserCountByEIDAndType(eid int64, theType int) (int64, error) {
	var count int64
	if err := DB.Model(&User{}).Where("eid =? and type = ?", eid, theType).Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

func CreateVisitorUser(eid int64, nickname string) (*User, error) {
	if eid <= 0 {
		return nil, errors.New("eid is required")
	}

	randomSuffix := helper.RandomString(8)
	username := fmt.Sprintf("visitor_%s", randomSuffix)

	if nickname == "" {
		nickname = fmt.Sprintf("访客_%s", randomSuffix[:4])
	}

	user := &User{
		Eid:       eid,
		Username:  username,
		Nickname:  nickname,
		Role:      RoleGuestUser,
		Status:    UserStatusJoined,
		Type:      UserTypeVisitor,
		Password:  "",
		Salt:      helper.RandomString(6),
	}

	if err := DB.Create(user).Error; err != nil {
		return nil, err
	}

	var jwtErr error
	user.AccessToken, jwtErr = jwt.UserGenerateJWT(user.UserID, user.Eid)
	if jwtErr != nil {
		return nil, jwtErr
	}

	updateErr := DB.Model(user).Update("access_token", user.AccessToken).Error
	return user, updateErr
}

func (u *User) IsVisitor() bool {
	return u.Type == UserTypeVisitor
}

func InvalidateAccessToken(token string) error {
	if token == "" {
		return errors.New("token is empty")
	}
	return DB.Model(&User{}).Where("access_token = ?", token).Update("access_token", "").Error
}

// InvalidateAccessToken 使用户的访问令牌失效
func (user *User) InvalidateAccessToken() error {
	// 清空用户的访问令牌
	user.AccessToken = ""
	// 更新数据库中的用户记录
	return DB.Model(user).Update("access_token", "").Error
}

func IsAdmin(role int64) bool {
	return role >= RoleAdminUser
}

// GetUsersByIDs 根据用户ID数组批量获取用户信息
func GetUsersByIDs(userIDs []int64) ([]*User, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}

	var users []*User
	err := DB.Where("user_id IN ?", userIDs).Find(&users).Error
	if err != nil {
		return nil, err
	}

	return users, nil
}

func GetUserMapByIDs(userIDs []int64) (map[int64]*User, error) {
	userMap := make(map[int64]*User)
	users, err := GetUsersByIDs(userIDs)
	if err != nil {
		return nil, err
	}
	for _, user := range users {
		if user == nil {
			continue
		}
		userMap[user.UserID] = user
	}
	return userMap, nil
}

// GetUsersByIDsAndEid 根据用户ID数组和EID批量获取用户信息
func GetUsersByIDsAndEid(eid int64, userIDs []int64) ([]*User, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}

	var users []*User
	err := DB.Where("eid = ? AND user_id IN ?", eid, userIDs).Find(&users).Error
	if err != nil {
		return nil, err
	}

	return users, nil
}
