package model

import (
	"errors"

	"gorm.io/gorm"
)

// Like 点赞记录表
type Like struct {
	LikeID   int64  `json:"like_id" gorm:"primaryKey;autoIncrement;comment:自增ID"`
	UserID   int64  `json:"user_id" gorm:"column:user_id;not null;index;comment:用户ID"`
	Type     string `json:"type" gorm:"type:varchar(50);not null;index;comment:点赞对象类型(prompt/comment等)"`
	ObjectID int64  `json:"object_id" gorm:"column:object_id;not null;index;comment:对象ID"`
	Status   int8   `json:"status" gorm:"not null;default:1;comment:状态(1:有效 0:取消)"`
	BaseModel
}

// 状态常量
const (
	LikeStatusActive int8 = 1 // 有效点赞
	LikeStatusCancel int8 = 0 // 取消点赞
)

// 对象类型常量
const (
	LikeTypePrompt = "prompt" // 提示词点赞
)

// TableName 设置表名
func (Like) TableName() string {
	return "likes"
}

// Validate 数据验证
func (l *Like) Validate() error {
	if l.UserID <= 0 {
		return errors.New("用户ID无效")
	}
	if l.ObjectID <= 0 {
		return errors.New("对象ID无效")
	}
	if l.Type == "" {
		return errors.New("点赞类型不能为空")
	}
	return nil
}

// Create 创建点赞记录
func (l *Like) Create() error {
	if err := l.Validate(); err != nil {
		return err
	}

	// 检查是否已存在点赞记录
	exist, err := l.Exists()
	if err != nil {
		return err
	}
	if exist {
		return errors.New("已存在点赞记录")
	}

	l.Status = LikeStatusActive // 默认激活状态
	return DB.Create(l).Error
}

// UpdateStatus 更新点赞状态
func (l *Like) UpdateStatus(newStatus int8) error {
	if newStatus != LikeStatusActive && newStatus != LikeStatusCancel {
		return errors.New("无效的状态值")
	}

	l.Status = newStatus
	return DB.Model(l).Updates(map[string]interface{}{
		"status": l.Status,
	}).Error
}

// Delete 软删除（更新状态为取消）
func (l *Like) Delete() error {
	return l.UpdateStatus(LikeStatusCancel)
}

// HardDelete 硬删除记录
func (l *Like) HardDelete() error {
	return DB.Delete(l).Error
}

// Exists 检查点赞记录是否存在
func (l *Like) Exists() (bool, error) {
	var count int64
	err := DB.Model(&Like{}).
		Where("user_id = ? AND type = ? AND object_id = ?", l.UserID, l.Type, l.ObjectID).
		Count(&count).Error
	return count > 0, err
}

// GetLikeByID 根据ID获取点赞记录
func GetLikeByID(likeID int64) (*Like, error) {
	var like Like
	err := DB.Where("like_id = ?", likeID).First(&like).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("点赞记录不存在")
		}
		return nil, err
	}
	return &like, nil
}

// GetUserLikes 获取用户的所有点赞记录
func GetUserLikes(userID int64, likeType string) ([]Like, error) {
	var likes []Like
	query := DB.Where("user_id = ? AND status = ?", userID, LikeStatusActive)

	if likeType != "" {
		query = query.Where("type = ?", likeType)
	}

	err := query.Find(&likes).Error
	return likes, err
}

// CountLikesByObject 统计对象的点赞数量
func CountLikesByObject(objectType string, objectID int64) (int64, error) {
	var count int64
	err := DB.Model(&Like{}).
		Where("type = ? AND object_id = ? AND status = ?", objectType, objectID, LikeStatusActive).
		Count(&count).Error
	return count, err
}

// ToggleLike 点赞/取消点赞
func (l *Like) ToggleLike() error {
	exists, err := l.Exists()
	if err != nil {
		return err
	}

	if exists {
		// 存在则更新状态（取消点赞）
		currentLike, err := GetLikeByUserObject(l.UserID, l.Type, l.ObjectID)
		if err != nil {
			return err
		}
		newStatus := LikeStatusCancel
		if currentLike.Status == LikeStatusCancel {
			newStatus = LikeStatusActive
		}
		return currentLike.UpdateStatus(newStatus)
	}

	// 不存在则创建新记录
	return l.Create()
}

// GetLikeByUserObject 根据用户和对象获取点赞记录
func GetLikeByUserObject(userID int64, objectType string, objectID int64) (*Like, error) {
	var like Like
	err := DB.Where("user_id = ? AND type = ? AND object_id = ?", userID, objectType, objectID).
		First(&like).Error
	if err != nil {
		return nil, err
	}
	return &like, nil
}
