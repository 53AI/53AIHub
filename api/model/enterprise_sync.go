package model

import (
	"errors"

	"github.com/53AI/53AIHub/common/utils/helper"
)

// FindEnterpriseUserByAccount 在所有企业中查找账号（先平台表未找到时调用）
// 支持手机号、邮箱、用户名；返回第一条匹配
func FindEnterpriseUserByAccount(account string) (*User, error) {
	if helper.IsValidPhone(account) {
		var u User
		if err := DB.Where("mobile = ?", account).First(&u).Error; err != nil {
			return nil, err
		}
		return &u, nil
	}

	if helper.IsValidEmail(account) {
		var u User
		if err := DB.Where("email = ?", account).First(&u).Error; err != nil {
			return nil, err
		}
		return &u, nil
	}

	// username
	var u User
	if err := DB.Where("username = ?", account).First(&u).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

// SetRelatedID 将企业用户的 related_id 更新为 platformUserID
func SetRelatedID(enterpriseUserID int64, platformUserID int64) error {
	if enterpriseUserID == 0 || platformUserID == 0 {
		return errors.New("invalid ids")
	}
	return DB.Model(&User{}).Where("user_id = ?", enterpriseUserID).Update("related_id", platformUserID).Error
}

// SetRelatedIDByEidAccount 按 eid + account（mobile/email/username）批量将相关 enterprise 记录的 related_id 写回 platformUserID
// 仅更新 related_id == 0 的记录，返回受影响的行数
func SetRelatedIDByEidAccount(eid int64, account string, platformUserID int64) (int64, error) {
	if eid == 0 || account == "" || platformUserID == 0 {
		return 0, errors.New("invalid params")
	}

	db := DB.Model(&User{}).Where("eid = ? AND related_id = 0", eid)
	if helper.IsValidPhone(account) {
		db = db.Where("mobile = ?", account)
	} else if helper.IsValidEmail(account) {
		db = db.Where("email = ?", account)
	} else {
		db = db.Where("username = ?", account)
	}

	res := db.Update("related_id", platformUserID)
	if res.Error != nil {
		return 0, res.Error
	}
	return res.RowsAffected, nil
}
