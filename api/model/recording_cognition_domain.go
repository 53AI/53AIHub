package model

// RecordingCognitionDomain 是安心录老板认知业务领域表。
// 领域归属个人（owner_id 维度）：系统公共预置（eid=0, owner_id=0）与个人专属自定义/重写/屏蔽（eid>0, owner_id=用户ID）。
// 支持写时复制（Copy-on-Write）：个人修改系统项时自动派生个人专有重写记录（parent_id>0, owner_id=当前用户），
// 删除系统项时生成屏蔽遮罩（is_deleted=true），不同用户互不影响。
type RecordingCognitionDomain struct {
	ID          int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid         int64  `json:"eid" gorm:"not null;index:idx_cognition_domain_scope,priority:1"`  // 0 为公共预置，>0 为企业专属
	OwnerID     int64  `json:"owner_id" gorm:"not null;default:0;index:idx_cognition_domain_scope,priority:2"` // 0 为系统公共预置，>0 为个人专属
	ParentID    int64  `json:"parent_id" gorm:"not null;default:0;index"`                       // 0 为自建；>0 关联被重写或屏蔽的系统项 ID
	Name        string `json:"name" gorm:"size:20;not null"`                                   // 领域名称（限长 20 字符）
	Description string `json:"description" gorm:"size:100;not null;default:''"`                // 领域描述（限长 100 字符）
	Logo        string `json:"logo" gorm:"size:255;not null;default:''"`                       // 领域图标 / Logo
	Code        string `json:"code" gorm:"size:64;not null;default:''"`                       // 预置标识符（如 strategy，用于历史数据兼容映射）
	Sort        int    `json:"sort" gorm:"not null;default:0"`                                  // 排序号
	IsDeleted   bool   `json:"is_deleted" gorm:"not null;default:false;index"`                  // 个人软删除 / 屏蔽遮罩
	BaseModel
}

func (RecordingCognitionDomain) TableName() string {
	return "recording_cognition_domains"
}
