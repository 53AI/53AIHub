package model

const (
	CurrencyCNY = "CNY"
	CurrencyUSD = "USD"

	TimeUnitYear    = "year"
	TimeUnitMonth   = "month"
	TimeUnitWeek    = "week"
	TimeUnitDay     = "day"
	TimeUnitQuarter = "quarter"

	SubscriptionTypeFee    = 1
	SubscriptionTypePoints = 2
)

// SubscriptionSetting 订阅设置表
// @Description Subscription setting configuration
// @Description Contains the basic settings for a subscription, including group association and AI features
type SubscriptionSetting struct {
	// @Description Unique identifier for the subscription setting
	// @Example 1
	SettingId int64 `json:"setting_id" gorm:"primaryKey;autoIncrement;column:setting_id;comment:'Subscription setting ID'"`
	// @Description Associated group identifier
	// @Example 1
	GroupId int64 `json:"group_id" gorm:"not null;column:group_id;comment:'Associated group ID'"`
	// @Description URL of the subscription logo image
	// @Example https://example.com/logo.png
	LogoUrl string `json:"logo_url" gorm:"type:varchar(255);column:logo_url;comment:'Subscription logo image URL'"`
	// @Description Whether AI features are enabled for this subscription
	// @Example true
	AiEnabled bool `json:"ai_enabled" gorm:"default:false;column:ai_enabled;comment:'Whether AI features are enabled'"`
	// @Description Whether this subscription is the default subscription
	// @Example true
	IsDefault bool `json:"is_default" gorm:"default:false;column:is_default;comment:'Whether this is the default subscription'"`
	// @Description List of subscription relations containing pricing and duration details
	Relations []*SubscriptionRelation `json:"relations" gorm:"-"`
	BaseModel
}

// LoadRelations loads all subscription relations for the current subscription setting
// @Summary Load subscription relations
// @Description Retrieves all subscription relations associated with this subscription setting by setting_id
func (s *SubscriptionSetting) LoadRelations() error {
	return DB.Where("setting_id = ?", s.SettingId).Find(&s.Relations).Error
}

// SubscriptionRelation
// @Description Subscription relation details
// @Description Contains pricing and duration information for a subscription plan
type SubscriptionRelation struct {
	// @Description Unique identifier for the subscription relation
	// @Example 1
	RelationId int64 `json:"relation_id" gorm:"primaryKey;autoIncrement;column:relation_id;comment:'Subscription relation ID'"`
	// @Description Associated subscription setting identifier
	// @Example 1
	SettingId int64 `json:"setting_id" gorm:"not null;column:setting_id;comment:'Associated subscription setting ID'"`
	// @Description Amount in cents/pennies
	// @Example 9900
	Amount int64 `json:"amount" gorm:"not null;column:amount;comment:'Amount in cents/pennies'"`
	// @Description Currency type
	// @Enum CNY,USD
	// @Example CNY
	Currency string `json:"currency" gorm:"type:varchar(10);not null;column:currency;comment:'Currency: CNY/USD'"`
	// @Description Time unit for subscription duration
	// @Enum year,month,week,day,quarter
	// @Example month
	TimeUnit string `json:"time_unit" gorm:"type:varchar(10);not null;column:time_unit;comment:'Time unit: year/month/week/day/quarter'"`
	// @Description Subscription type
	// @Enum 1,2
	// @Example 1
	// @Description 1=Fee, 2=Points
	Type uint `json:"type" gorm:"not null;column:type;comment:'Type: 1=Fee/2=Points'"`
	BaseModel
}

// Add table name methods with comments
func (SubscriptionSetting) TableName() string {
	return "subscription_settings"
}

func (SubscriptionRelation) TableName() string {
	return "subscription_relations"
}

// Create subscription setting
func CreateSubscriptionSetting(setting *SubscriptionSetting) error {
	return DB.Create(setting).Error
}

// Update subscription setting
func UpdateSubscriptionSetting(setting *SubscriptionSetting) error {
	return DB.Model(setting).Updates(map[string]interface{}{
		"logo_url":   setting.LogoUrl,
		"ai_enabled": setting.AiEnabled,
	}).Error
}

// Delete subscription setting
func DeleteSubscriptionSetting(settingId int64) error {
	// Hard delete
	return DB.Where("setting_id = ?", settingId).Delete(&SubscriptionSetting{}).Error
}

// Get subscription setting by ID
func GetSubscriptionSettingById(settingId int64) (*SubscriptionSetting, error) {
	var setting SubscriptionSetting
	err := DB.Where("setting_id = ?", settingId).First(&setting).Error
	return &setting, err
}

// Get all subscription settings
func GetAllSubscriptionSettings(offset, limit int) ([]SubscriptionSetting, int64, error) {
	var settings []SubscriptionSetting
	var count int64

	query := DB.Model(&SubscriptionSetting{})

	err := query.Count(&count).Error
	if err != nil {
		return nil, 0, err
	}

	if limit > 0 {
		query = query.Offset(offset).Limit(limit)
	}

	err = query.Find(&settings).Error
	return settings, count, err
}

// Create subscription relation
func CreateSubscriptionRelation(relation *SubscriptionRelation) error {
	return DB.Create(relation).Error
}

// Update subscription relation
func UpdateSubscriptionRelation(relation *SubscriptionRelation) error {
	return DB.Model(relation).Updates(map[string]interface{}{
		"amount":    relation.Amount,
		"currency":  relation.Currency,
		"time_unit": relation.TimeUnit,
		"type":      relation.Type,
	}).Error
}

// Delete subscription relation
func DeleteSubscriptionRelation(relationId int64) error {
	// Hard delete
	return DB.Where("relation_id = ?", relationId).Delete(&SubscriptionRelation{}).Error
}

// Delete all relations by setting ID
func DeleteSubscriptionRelationsBySettingId(settingId int64) error {
	// Hard delete
	return DB.Where("setting_id = ?", settingId).Delete(&SubscriptionRelation{}).Error
}

// Get subscription relations by setting ID
func GetSubscriptionRelationsBySettingId(settingId int64) ([]SubscriptionRelation, error) {
	var relations []SubscriptionRelation
	err := DB.Where("setting_id = ?", settingId).Find(&relations).Error
	return relations, err
}

// SubscriptionSettingWithAgents represents subscription settings with related agents and groups
type SubscriptionSettingWithAgents struct {
	Group   *Group               `json:"group"`
	Setting *SubscriptionSetting `json:"setting"`
}

// GetSubscriptionSettingsWithAgents retrieves subscription settings with their associated agents
func GetSubscriptionSettingsWithAgents(eid int64, offset, limit int) ([]SubscriptionSettingWithAgents, int64, error) {
	groups, count, err := GetGroupsWithAgents(eid, USER_GROUP_TYPE, offset, limit)
	if err != nil {
		return nil, 0, err
	}

	result := make([]SubscriptionSettingWithAgents, 0)

	for _, group := range groups {
		var setting SubscriptionSetting
		err := DB.Where("group_id = ?", group.GroupId).First(&setting).Error
		if err != nil {
			continue
		}

		if err := setting.LoadRelations(); err != nil {
			continue
		}

		settingWithAgents := SubscriptionSettingWithAgents{
			Group:   &group,
			Setting: &setting,
		}

		result = append(result, settingWithAgents)
	}

	return result, count, nil
}

// get default subscription setting
func GetDefaultSubscription(eid int64) (*SubscriptionSetting, error) {
	var groupIds []int64
	if err := DB.Model(&Group{}).Select("group_id").Where("eid = ? and group_type = ?", eid, USER_GROUP_TYPE).Pluck("group_id", &groupIds).Error; err != nil {
		return nil, err
	}

	var defaultSubscription SubscriptionSetting

	// Query the database for the default subscription setting
	err := DB.Debug().Where("is_default = ? and group_id in ?", true, groupIds).First(&defaultSubscription).Error
	if err != nil {
		// Return nil and the error if the query fails
		return nil, err
	}

	// Return the default subscription setting
	return &defaultSubscription, nil
}
