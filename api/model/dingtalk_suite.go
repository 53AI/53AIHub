package model

import (
	"errors"
)

type DingtalkSuite struct {
	SuiteID          string `json:"suite_id" gorm:"primaryKey;type:varchar(32)"`
	Secret           string `json:"secret" gorm:"type:varchar(255);not null"`
	Ticket           string `json:"ticket" gorm:"type:varchar(255)"`
	TicketUpdateTime int64  `json:"ticket_update_time" gorm:"type:bigint"`
	AccessToken      string `json:"access_token" gorm:"type:varchar(255)"`
	ExpiresIn        int    `json:"expires_in" gorm:"type:int"`
	TokenUpdateTime  int64  `json:"token_update_time" gorm:"type:bigint"`
	Name             string `json:"name" gorm:"type:varchar(255);not null"`
	Token            string `json:"token" gorm:"type:varchar(255);not null"`
	EncodingAesKey   string `json:"encoding_aes_key" gorm:"type:varchar(255);not null"`
	CorpID           string `json:"corp_id" gorm:"type:varchar(255);index"`
	BaseModel
}

func GetDingtalkSuite(suiteID string) (*DingtalkSuite, error) {
	var suite DingtalkSuite
	err := DB.Where("suite_id = ?", suiteID).First(&suite).Error
	if err != nil {
		return nil, errors.New("suite not found")
	}
	return &suite, nil
}

func (suite *DingtalkSuite) Create() error {
	if suite.SuiteID == "" {
		return errors.New("suite_id cannot be empty")
	}
	var count int64
	DB.Model(&DingtalkSuite{}).Where("suite_id = ?", suite.SuiteID).Count(&count)
	if count > 0 {
		return errors.New("suite_id already exists")
	}

	result := DB.Create(suite)
	return result.Error
}

func (suite *DingtalkSuite) Update() error {
	if suite.SuiteID == "" {
		return errors.New("suite_id cannot be empty")
	}

	return DB.Model(suite).Updates(suite).Error
}

func (suite *DingtalkSuite) Delete() error {
	if suite.SuiteID == "" {
		return errors.New("suite_id cannot be empty")
	}

	return DB.Delete(suite).Error
}

func GetDingtalkSuitesByCorpID(corpID string) ([]*DingtalkSuite, error) {
	var suites []*DingtalkSuite
	err := DB.Where("corp_id = ?", corpID).Find(&suites).Error
	return suites, err
}
