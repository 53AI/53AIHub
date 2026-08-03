package model

import (
	"errors"
	"time"
)

type NavigationContent struct {
	ContentID    int64  `json:"content_id" gorm:"primaryKey;autoIncrement;comment:自增id"`
	NavigationID int64  `json:"navigation_id" gorm:"index;comment:navigations.navigation_id"`
	HtmlContent  string `json:"html_content" gorm:"type:text;comment:html内容"`
	BaseModel
}

func (NavigationContent) TableName() string {
	return "navigation_contents"
}

func (nc *NavigationContent) Create() error {
	if nc.NavigationID == 0 {
		return errors.New("navigation_id不能为空")
	}

	// 检查关联导航是否存在
	var count int64
	DB.Model(&Navigation{}).Where("navigation_id = ?", nc.NavigationID).Count(&count)
	if count == 0 {
		return errors.New("关联导航不存在")
	}

	return DB.Create(nc).Error
}

func (nc *NavigationContent) Update() error {
	return DB.Model(nc).Updates(map[string]interface{}{
		"html_content": nc.HtmlContent,
		"updated_time": time.Now().UTC().UnixMilli(),
	}).Error
}

func (nc *NavigationContent) Delete() error {
	return DB.Delete(nc).Error
}

func GetContentByID(contentID int64, navigationID int64) (*NavigationContent, error) {
	var content NavigationContent
	err := DB.Where("content_id = ? AND navigation_id = ?", contentID, navigationID).First(&content).Error
	if err != nil {
		return nil, err
	}
	return &content, nil
}

func GetNavigationContentByID(navID int64) (*NavigationContent, error) {
	var content NavigationContent
	if err := DB.Where("nav_id = ?", navID).First(&content).Error; err != nil {
		return nil, err
	}
	return &content, nil
}

func DeleteNavigationContentByNavID(navID int64) error {
	return DB.Where("navigation_id = ?", navID).Delete(&NavigationContent{}).Error
}
