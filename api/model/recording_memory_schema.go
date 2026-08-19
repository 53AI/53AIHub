package model

// RecordingMemoryAttributeSchema 描述实体一个属性的约束。
// Label 为中文展示名；Values 非空时表示枚举（值 -> 中文 label），空表示自由文本。
type RecordingMemoryAttributeSchema struct {
	Label  string            `json:"label"`
	Values map[string]string `json:"values,omitempty"`
}

// RecordingMemoryEntitySchema 描述一类实体的属性约束。
type RecordingMemoryEntitySchema struct {
	Label      string                                    `json:"label"` // 类型中文展示名（人物/事项/风险/原则）
	Attributes map[string]RecordingMemoryAttributeSchema `json:"attributes"`
}

// RecordingMemoryEntitySchemas 全局唯一权威 schema：领导要求的 4 类实体及每类属性/枚举。
// 硬编码不存表；prompt 生成、编译落库、列表/详情接口、前端展示均以此为限。
var RecordingMemoryEntitySchemas = map[string]RecordingMemoryEntitySchema{
	"person": {Label: "人物",
		Attributes: map[string]RecordingMemoryAttributeSchema{
			"company":      {Label: "公司"},
			"position":     {Label: "职位"},
			"demand":       {Label: "诉求"},
			"relationship": {Label: "关系", Values: map[string]string{"potential_customer": "潜在客户", "customer": "客户", "partner": "合作伙伴", "competitor": "竞品方", "irrelevant": "无关人员"}},
		},
	},
	"matter": {Label: "事项",
		Attributes: map[string]RecordingMemoryAttributeSchema{
			"status":      {Label: "状态", Values: map[string]string{"todo": "待办", "in_progress": "进行中", "completed": "已完成", "shelved": "已搁置"}},
			"priority":    {Label: "优先级", Values: map[string]string{"high": "高", "medium": "中", "low": "低"}},
			"deliverable": {Label: "交付物"},
			"dependency":  {Label: "依赖条件"},
		},
	},
	"risk": {Label: "风险",
		Attributes: map[string]RecordingMemoryAttributeSchema{
			"risk_type":   {Label: "类型", Values: map[string]string{"compliance": "合规风险", "delivery": "交付风险", "financial": "财务风险", "technical": "技术风险"}},
			"risk_level":  {Label: "风险等级", Values: map[string]string{"high": "高", "medium": "中", "low": "低"}},
			"probability": {Label: "发生概率"},
			"response":    {Label: "应对措施"},
		},
	},
	"principle": {Label: "原则",
		Attributes: map[string]RecordingMemoryAttributeSchema{
			"principle_type":   {Label: "类型", Values: map[string]string{"company_policy": "公司制度", "industry_norm": "行业规范", "compliance_req": "合规要求", "business_principle": "商业准则"}},
			"binding_force":    {Label: "约束力", Values: map[string]string{"mandatory": "强制", "recommended": "建议", "reference": "参考"}},
			"applicable_scope": {Label: "适用范围"},
			"exceptions":       {Label: "例外情况"},
		},
	},
}
