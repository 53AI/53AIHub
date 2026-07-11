package model

import "time"

type EnterpriseApply struct {
	ID             uint      `json:"id"`
	ApplyID        int       `json:"apply_id"`
	ContactName    string    `json:"contact_name"`
	Domain         string    `json:"domain"`
	Eid            int64     `json:"eid"`
	Email          string    `json:"email"`
	EnterpriseName string    `json:"enterprise_name"`
	ExpiredTime    int64     `json:"expired_time"`
	Phone          string    `json:"phone"`
	Reason         string    `json:"reason"`
	Status         int       `json:"status"`
	UserID         int       `json:"user_id"`
	Version        int       `json:"version"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type SaasDomain struct {
	ID       int    `json:"id"`
	Config   string `json:"config"`
	Domain   string `json:"domain"`
	Eid      int64  `json:"eid"`
	IsCustom bool   `json:"is_custom"`
	Type     int    `json:"type"`
}

type FeatureLimit struct {
	Max  int64  `json:"max"`
	Name string `json:"name"`
}

type DisabledFeaturesMap map[string]FeatureLimit

type User struct {
	ID       uint   `json:"id"`
	Username string `json:"username"`
}

type Product struct {
	ID               uint   `json:"id"`
	Name             string `json:"name"`
	DisabledFeatures string `json:"disabled_features"`
}

type DomainConfig struct {
	Domain string `json:"domain"`
}

type DomainSettings struct {
	Domains []SaasDomain `json:"domains"`
}

const (
	FeatureAgent             = "feature_agent"
	FeaturePrompt            = "feature_prompt"
	FeatureAiLink            = "feature_ai_link"
	FeatureInternalUser      = "feature_internal_user"
	FeatureRegisteredUser    = "feature_registered_user"
	FeatureIndependentDomain = "feature_independent_domain"
	FeatureWecom             = "feature_wecom"
	FeatureKnowledgeBase     = "feature_knowledge_base"
	FeatureSpaceCount        = "feature_space_count"
	FeatureLibraryCount      = "feature_library_count"
	FeatureDocumentCount     = "feature_document_count"
	FeatureStorageCapacity   = "feature_storage_capacity"
	FeatureWorkbench         = "feature_workbench"
	FeatureRecording         = "feature_recording"

	FeatureAgentName             = "Agent"
	FeaturePromptName            = "Prompt"
	FeatureAiLinkName            = "AI Link"
	FeatureInternalUserName      = "Internal User"
	FeatureRegisteredUserName    = "Registered User"
	FeatureIndependentDomainName = "Independent Domain"
	FeatureWecomName             = "WeCom"
	FeatureKnowledgeBaseName     = "Knowledge Base"
	FeatureSpaceCountName        = "Space Count"
	FeatureLibraryCountName      = "Library Count"
	FeatureDocumentCountName     = "Document Count"
	FeatureStorageCapacityName   = "Storage Capacity"
	FeatureWorkbenchName         = "Workbench"
	FeatureRecordingName         = "Recording"
)

func GetEnterpriseApplyByEid(eid int64) (*EnterpriseApply, error) {
	return &EnterpriseApply{Eid: eid, Status: 1, Version: 0}, nil
}
