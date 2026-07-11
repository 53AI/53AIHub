package model

import (
	"strings"

	"gorm.io/gorm"
)

const (
	PLATFORM_KEY_TEXTIN                       = "textin"
	PLATFORM_KEY_MARKITDOWN                   = "markitdown" // MarkItDown 文本解析器
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

type PlatformSettingDisplayMeta struct {
	DisplayName        string
	DisplayDescription string
}

type PlatformSettingDisplayMetaItem struct {
	PlatformKey        string
	DisplayName        string
	DisplayDescription string
}

var defaultPlatformSettingDisplayMetaMap = map[string]PlatformSettingDisplayMeta{
	PLATFORM_KEY_TEXTIN: {
		DisplayName:        "TextIn",
		DisplayDescription: "TextIn 文档解析平台的默认展示信息",
	},
	PLATFORM_KEY_MARKITDOWN: {
		DisplayName:        "MarkItDown",
		DisplayDescription: "更适合文本类文档的低成本解析器，对 PDF 等复杂版面文档效果一般，但整体接入成本较低",
	},
	PLATFORM_KEY_MINERU_NET: {
		DisplayName:        "MinerU.net 国内线上版",
		DisplayDescription: "成本低效果好的解析器，pdf，office 格式支持效果较好",
	},
	PLATFORM_KEY_MINERU_LOCAL: {
		DisplayName:        "MinerU 本地版",
		DisplayDescription: "MinerU 的本地部署文档解析服务默认展示信息",
	},
	PLATFORM_KEY_PADDLEPADDLE_PP_OCR_V5: {
		DisplayName:        "PaddleOCR 通用文字识别模型",
		DisplayDescription: "PaddleOCR 通用文字识别模型的默认展示信息",
	},
	PLATFORM_KEY_PADDLEPADDLE_PP_STRUCTURE_V3: {
		DisplayName:        "PaddleOCR 版面分析与结构化识别模型",
		DisplayDescription: "PaddleOCR 版面分析与结构化识别模型的默认展示信息",
	},
	PLATFORM_KEY_PADDLEPADDLE_PADDLEOCR_VL: {
		DisplayName:        "PaddleOCR VL 视觉语言模型",
		DisplayDescription: "PaddleOCR 视觉语言模型的默认展示信息",
	},
	PLATFORM_KEY_TINGWU: {
		DisplayName:        "通义听悟",
		DisplayDescription: "语音文件类型支持的选择器",
	},
}

var defaultPlatformSettingDisplayMetaOrder = []string{
	PLATFORM_KEY_TEXTIN,
	PLATFORM_KEY_MARKITDOWN,
	PLATFORM_KEY_MINERU_NET,
	PLATFORM_KEY_MINERU_LOCAL,
	PLATFORM_KEY_PADDLEPADDLE_PP_OCR_V5,
	PLATFORM_KEY_PADDLEPADDLE_PP_STRUCTURE_V3,
	PLATFORM_KEY_PADDLEPADDLE_PADDLEOCR_VL,
	PLATFORM_KEY_TINGWU,
}

type PlatformSetting struct {
	ID                 int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid                int64  `json:"eid" gorm:"not null;index" example:"1"`
	Setting            string `json:"setting" gorm:"type:text;not null" example:"{\"key\":\"value\"}"`
	PlatformKey        string `json:"platform_key" gorm:"not null;index" example:"platform_key"`
	ExternalID         string `json:"external_id" gorm:"default:null" example:"wps_external_id"`
	Status             string `json:"status" gorm:"size:20;default:'enabled';index" example:"enabled"` // 添加状态字段，默认为enabled(正常)
	DisplayName        string `json:"display_name,omitempty" gorm:"-"`
	DisplayDescription string `json:"display_description,omitempty" gorm:"-"`
	BaseModel
}

func (p *PlatformSetting) ApplyDefaultDisplayMetadata() {
	if p == nil {
		return
	}
	if meta, ok := GetDefaultPlatformSettingDisplayMeta(p.PlatformKey); ok {
		if strings.TrimSpace(p.DisplayName) == "" {
			p.DisplayName = meta.DisplayName
		}
		if strings.TrimSpace(p.DisplayDescription) == "" {
			p.DisplayDescription = meta.DisplayDescription
		}
	}
}

func (p *PlatformSetting) AfterFind(tx *gorm.DB) error {
	p.ApplyDefaultDisplayMetadata()
	return nil
}

func GetDefaultPlatformSettingDisplayMeta(platformKey string) (PlatformSettingDisplayMeta, bool) {
	meta, ok := defaultPlatformSettingDisplayMetaMap[platformKey]
	return meta, ok
}

func ListDefaultPlatformSettingDisplayMetas() []PlatformSettingDisplayMetaItem {
	items := make([]PlatformSettingDisplayMetaItem, 0, len(defaultPlatformSettingDisplayMetaOrder))
	for _, platformKey := range defaultPlatformSettingDisplayMetaOrder {
		meta, ok := defaultPlatformSettingDisplayMetaMap[platformKey]
		if !ok {
			continue
		}
		items = append(items, PlatformSettingDisplayMetaItem{
			PlatformKey:        platformKey,
			DisplayName:        meta.DisplayName,
			DisplayDescription: meta.DisplayDescription,
		})
	}
	return items
}

func CreatePlatformSetting(platformSetting *PlatformSetting) error {
	if platformSetting != nil {
		platformSetting.ApplyDefaultDisplayMetadata()
	}
	return DB.Create(platformSetting).Error
}

func DeletePlatformSettingByID(id int64) error {
	return DB.Where("id = ?", id).Delete(&PlatformSetting{}).Error
}

func UpdatePlatformSetting(platformSetting *PlatformSetting) error {
	if platformSetting != nil {
		platformSetting.ApplyDefaultDisplayMetadata()
	}
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

func GetEnabledPlatformSettingsByEid(eid int64) ([]PlatformSetting, error) {
	var platformSettings []PlatformSetting
	if err := DB.Where(map[string]interface{}{
		"eid":    eid,
		"status": PLATFORM_STATUS_ENABLED,
	}).Order("created_time DESC").Find(&platformSettings).Error; err != nil {
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
