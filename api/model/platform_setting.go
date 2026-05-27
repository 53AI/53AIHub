package model

const (
	PLATFORM_KEY_TEXTIN                       = "textin"
	PLATFORM_KEY_WPS                          = "wps"
	PLATFORM_BOCHAAI                          = "bochaai"                     // 博查 AI
	PLATFORM_KEY_MINERU_NET                   = "mineru.net"                  // MinerU.net 国内线上版
	PLATFORM_KEY_MINERU_LOCAL                 = "mineru.local"                // MinerU 本地版
	PLATFORM_KEY_PADDLEPADDLE_PP_OCR_V5       = "paddlepaddle_pp-ocrv5"       // PaddleOCR 通用文字识别模型配置
	PLATFORM_KEY_PADDLEPADDLE_PP_STRUCTURE_V3 = "paddlepaddle_pp-structurev3" // 版面分析与结构化识别模型配置
	PLATFORM_KEY_PADDLEPADDLE_PADDLEOCR_VL    = "paddlepaddle_paddleocr-vl"   // 视觉语言模型配置
	PLATFORM_KEY_TINGWU                       = "tingwu"                      // 通义听悟平台
)

const (
	PLATFORM_STATUS_ENABLED  = "enabled"  // 正常
	PLATFORM_STATUS_DISABLED = "disabled" // 禁用
)

const (
	PADDLEPADDLE_API_TYPE_PP_OCR_V5       = "pp-ocrv5"       // PaddleOCR 通用文字识别模型
	PADDLEPADDLE_API_TYPE_PP_STRUCTURE_V3 = "pp-structurev3" // 版面分析与结构化识别模型
	PADDLEPADDLE_API_TYPE_PADDLEOCR_VL    = "paddleocr-vl"   // 视觉语言模型
)

type PlatformSetting struct {
	ID          int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid         int64  `json:"eid" gorm:"not null;index" example:"1"`
	Setting     string `json:"setting" gorm:"type:text;not null" example:"{\"key\":\"value\"}"`
	PlatformKey string `json:"platform_key" gorm:"not null;index" example:"platform_key"`
	ExternalID  string `json:"external_id" gorm:"default:null" example:"wps_external_id"`
	Status      string `json:"status" gorm:"size:20;default:'enabled';index" example:"enabled"` // 添加状态字段，默认为enabled(正常)
	BaseModel
}

func CreatePlatformSetting(platformSetting *PlatformSetting) error {
	return DB.Create(platformSetting).Error
}

func DeletePlatformSettingByID(id int64) error {
	return DB.Where("id = ?", id).Delete(&PlatformSetting{}).Error
}

func UpdatePlatformSetting(platformSetting *PlatformSetting) error {
	return DB.Model(platformSetting).
		Select("eid", "setting", "platform_key", "external_id", "status", "updated_time").
		Updates(platformSetting).Error
}

func GetPlatformSettingByID(id int64) (*PlatformSetting, error) {
	var platformSetting PlatformSetting
	result := DB.Where("id = ?", id).First(&platformSetting)
	if result.Error != nil {
		return nil, result.Error
	}
	return &platformSetting, nil
}

func GetPlatformSettingByIDAndEid(id int64, eid int64) (*PlatformSetting, error) {
	var platformSetting PlatformSetting
	result := DB.Where("id = ?", id).Where("eid =?", eid).First(&platformSetting)
	if result.Error != nil {
		if result.Error.Error() == "record not found" {
			return nil, nil
		}
		return nil, result.Error
	}
	return &platformSetting, nil
}

func GetPlatformSettingsByEid(eid int64) ([]PlatformSetting, error) {
	var platformSettings []PlatformSetting
	if err := DB.Where("eid =?", eid).Order("created_time DESC").Find(&platformSettings).Error; err != nil {
		return nil, err
	}
	return platformSettings, nil
}

func GetPlatformSettingByEidAndPlatformKey(eid int64, platformKey string) (*PlatformSetting, error) {
	var platformSetting PlatformSetting
	result := DB.Where("eid =?", eid).Where("platform_key =?", platformKey).First(&platformSetting)
	if result.Error != nil {
		if result.Error.Error() == "record not found" {
			return nil, nil
		}
		return nil, result.Error
	}
	return &platformSetting, nil
}

func GetPlatformSettingsByPlatformKey(platformKey string) ([]PlatformSetting, error) {
	var platformSettings []PlatformSetting
	if err := DB.Where("platform_key =?", platformKey).Order("created_time DESC").Find(&platformSettings).Error; err != nil {
		return nil, err
	}
	return platformSettings, nil
}

func GetPlatformSettingByExternalID(eid int64, externalID string, platformKey string) (*PlatformSetting, error) {
	var platformSetting PlatformSetting
	result := DB.Where("eid = ? and external_id =?", eid, externalID).Where("platform_key =?", platformKey).First(&platformSetting)
	if result.Error != nil {
		if result.Error.Error() == "record not found" {
			return nil, nil
		}
		return nil, result.Error
	}
	return &platformSetting, nil
}
