package model

import "gorm.io/gorm"

// GetEnterpriseCreatorUser 获取企业创建者用户，优先角色为创建者的用户，其次回退为首个管理员/首个用户
func GetEnterpriseCreatorUser(eid int64) (*User, error) {
	var user User
	if err := DB.Where("eid = ? AND role = ?", eid, RoleCreatorUser).First(&user).Error; err == nil {
		return &user, nil
	} else if err != nil && !isRecordNotFound(err) {
		return nil, err
	}

	if err := DB.Where("eid = ? AND role >= ?", eid, RoleAdminUser).Order("role desc, user_id asc").First(&user).Error; err == nil {
		return &user, nil
	} else if err != nil && !isRecordNotFound(err) {
		return nil, err
	}

	if err := DB.Where("eid = ?", eid).Order("user_id asc").First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func isRecordNotFound(err error) bool {
	return err == gorm.ErrRecordNotFound
}
