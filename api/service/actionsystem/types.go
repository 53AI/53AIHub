// Package actionsystem contains the product-level contracts around an Action.
// It deliberately does not depend on the Runtime Adapter or persistence layer.
package actionsystem

type OpportunityType string

const (
	OpportunityDeepResearch OpportunityType = "deep_research"
	OpportunityAnalysis     OpportunityType = "analysis"
	OpportunitySOP          OpportunityType = "sop"
	OpportunityDocument     OpportunityType = "document_generation"
)

const (
	RiskLow      = "low"
	RiskMedium   = "medium"
	RiskHigh     = "high"
	RiskCritical = "critical"
)

type CapabilityStatus string

const (
	CapabilityAvailable   CapabilityStatus = "available"
	CapabilityUnavailable CapabilityStatus = "unavailable"
	CapabilityUnverified  CapabilityStatus = "unverified"
)

type Capability struct {
	Key    string           `json:"key"`
	Label  string           `json:"label"`
	Status CapabilityStatus `json:"status"`
	Reason string           `json:"reason,omitempty"`
}

type CapabilityRegistry interface {
	Get(key string) (Capability, bool)
	Available(keys []string) bool
}

type StaticCapabilityRegistry struct {
	items map[string]Capability
}

func NewStaticCapabilityRegistry(items ...Capability) StaticCapabilityRegistry {
	registry := StaticCapabilityRegistry{items: make(map[string]Capability, len(items))}
	for _, item := range items {
		registry.items[item.Key] = item
	}
	return registry
}

func (r StaticCapabilityRegistry) Get(key string) (Capability, bool) {
	item, ok := r.items[key]
	return item, ok
}

func (r StaticCapabilityRegistry) Available(keys []string) bool {
	for _, key := range keys {
		item, ok := r.Get(key)
		if !ok || item.Status != CapabilityAvailable {
			return false
		}
	}
	return true
}

type EvidenceRef struct {
	SourceType string `json:"source_type"`
	SourceID   string `json:"source_id"`
	SegmentID  string `json:"segment_id,omitempty"`
	Excerpt    string `json:"excerpt,omitempty"`
	Timestamp  int64  `json:"timestamp,omitempty"`
	Position   string `json:"position,omitempty"`
}

type SourceRef struct {
	Role          string `json:"role"`
	SourceType    string `json:"source_type"`
	CanonicalID   string `json:"canonical_id"`
	SourceVersion string `json:"source_version,omitempty"`
}

// DeliverableFormat 是主交付物的物理格式。它是文件名扩展名与 MIME 类型的唯一
// 权威，不接受从文件名后缀反推。
type DeliverableFormat string

const (
	FormatDOCX DeliverableFormat = "docx"
	FormatXLSX DeliverableFormat = "xlsx"
	FormatPPTX DeliverableFormat = "pptx"
)

// Deliverable 是 Plan 里的一条业务交付要求。V1.1 仍然只产出一个 Primary
// Business Artifact：由 is_primary 的那一条决定标题与格式，其余条目合并进它。
type Deliverable struct {
	Type      string            `json:"type"`
	Title     string            `json:"title"`
	Format    DeliverableFormat `json:"format,omitempty"`
	IsPrimary bool              `json:"is_primary,omitempty"`
}

type ActionOpportunity struct {
	ID                   string          `json:"id,omitempty"`
	SourceType           string          `json:"source_type"`
	SourceID             string          `json:"source_id"`
	SourceInsightID      string          `json:"source_insight_id"`
	SourceMeetingID      string          `json:"source_meeting_id"`
	InsightGeneration    int64           `json:"insight_generation"`
	Title                string          `json:"title"`
	Type                 OpportunityType `json:"type"`
	TypeLabel            string          `json:"type_label"`
	Reason               string          `json:"reason"`
	Objective            string          `json:"objective"`
	Deliverables         []Deliverable   `json:"deliverables"`
	DisplayDeliverable   string          `json:"display_deliverable"`
	RequiredCapabilities []string        `json:"required_capabilities"`
	HumanDependency      string          `json:"human_dependency"`
	AIExecutableScore    float64         `json:"ai_executable_score"`
	RiskLevel            string          `json:"risk_level"`
	Priority             int             `json:"priority"`
	EvidenceRefs         []EvidenceRef   `json:"evidence_refs"`
	SourceRefs           []SourceRef     `json:"source_refs"`
}

// ActionIntent is the user-facing contract an ActionPlan must preserve while
// the planner fills in executable details. It is derived from the accepted
// opportunity and source context; it is not a second persisted Action entity.
type ActionIntent struct {
	Objective            string          `json:"objective"`
	ActionType           OpportunityType `json:"action_type"`
	Scope                string          `json:"scope"`
	ExpectedDeliverables []Deliverable   `json:"expected_deliverables"`
	SourceEvidence       []EvidenceRef   `json:"source_evidence"`
}

type DetectionInput struct {
	SourceType        string
	SourceID          string
	ContextLabel      string
	SourceInsightID   string
	SourceMeetingID   string
	InsightGeneration int64
	InsightSummary    string
	MaterialContext   string
	EvidenceRefs      []EvidenceRef
	SourceRefs        []SourceRef
}

type RequiredInput struct {
	Name     string `json:"name"`
	Source   string `json:"source"`
	Required bool   `json:"required"`
}

type ExecutionStep struct {
	Order       int    `json:"order"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

type Permission struct {
	Capability string `json:"capability"`
	Resource   string `json:"resource"`
	Scope      string `json:"scope"`
	Approval   string `json:"approval"`
}

type AcceptanceCriterion struct {
	Order       int    `json:"order"`
	Description string `json:"description"`
}

type Risk struct {
	Order       int    `json:"order"`
	Description string `json:"description"`
	Mitigation  string `json:"mitigation"`
}

type ActionPlan struct {
	ID                   string                `json:"id,omitempty"`
	OpportunityID        string                `json:"opportunity_id"`
	Objective            string                `json:"objective"`
	Background           string                `json:"background"`
	Scope                string                `json:"scope"`
	Deliverables         []Deliverable         `json:"deliverables"`
	ExecutionSteps       []ExecutionStep       `json:"execution_steps"`
	RequiredInputs       []RequiredInput       `json:"required_inputs"`
	RequiredCapabilities []string              `json:"required_capabilities"`
	Permissions          []Permission          `json:"permissions"`
	AcceptanceCriteria   []AcceptanceCriterion `json:"acceptance_criteria"`
	Risks                []Risk                `json:"risks"`
	EstimatedEffort      string                `json:"estimated_effort"`
	SourceRefs           []SourceRef           `json:"source_refs"`
	ActionType           OpportunityType       `json:"action_type"`
	EvidenceRefs         []EvidenceRef         `json:"evidence_refs"`
}
