package model

// RecordingMemoryAttributeSchema 描述实体一个属性的约束。
// Label 为中文展示名；Values 非空时表示枚举（值 -> 中文 label），空表示自由文本。
type RecordingMemoryAttributeSchema struct {
	Label  string            `json:"label"`
	Values map[string]string `json:"values,omitempty"`
}

// RecordingMemoryEntitySchema 描述一类实体的属性约束。
type RecordingMemoryEntitySchema struct {
	Label      string                                    `json:"label"` // 类型中文展示名（人物/事项/风险/承诺/决策）
	Attributes map[string]RecordingMemoryAttributeSchema `json:"attributes"`
}

// RecordingMemoryEntitySchemas 全局唯一权威 schema：5 类实体及每类属性/枚举。
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
	"commitment": {Label: "承诺",
		Attributes: map[string]RecordingMemoryAttributeSchema{
			"fulfillment_status": {Label: "履约状态", Values: map[string]string{"not_started": "未开始", "in_progress": "履行中", "fulfilled": "已履行", "overdue": "已逾期"}},
			"priority":           {Label: "优先级", Values: map[string]string{"high": "高", "medium": "中", "low": "低"}},
			"due_date":           {Label: "承诺期限"},
		},
	},
	"decision": {Label: "决策",
		Attributes: map[string]RecordingMemoryAttributeSchema{
			"decision_status": {Label: "决策状态", Values: map[string]string{"confirmed": "已确认", "proposed": "提议中", "rejected": "已否决", "deferred": "已搁置", "uncertain": "待定"}},
			"decision_maker":  {Label: "决策人"},
			"reason":          {Label: "决策依据"},
			"impact_scope":    {Label: "影响范围"},
		},
	},
}

// ===== Schema 数组返回形态（GET /api/recordings/memories/schema）=====
// 顶层 data 为数组、attributes 为数组、枚举 values 为数组，且按约定顺序排列，
// 便于前端按固定顺序渲染。内部权威仍为上面的 RecordingMemoryEntitySchemas map。

// RecordingMemoryEnumValueSchema 描述一个枚举值（值 -> 中文 label），schema 数组返回时使用。
type RecordingMemoryEnumValueSchema struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// RecordingMemoryAttributeSchemaView 描述实体一个属性的约束（数组形态）。
// Values 非空时表示枚举，空表示自由文本。
type RecordingMemoryAttributeSchemaView struct {
	Key    string                           `json:"key"`
	Label  string                           `json:"label"`
	Values []RecordingMemoryEnumValueSchema `json:"values,omitempty"`
}

// RecordingMemoryEntitySchemaView 描述一类实体的属性约束（数组形态）。
type RecordingMemoryEntitySchemaView struct {
	Type       string                               `json:"type"`
	Label      string                               `json:"label"`
	Attributes []RecordingMemoryAttributeSchemaView `json:"attributes"`
}

// recordingEntityTypeOrder 实体类型在 schema 数组返回中的顺序（与前端约定一致）。
var recordingEntityTypeOrder = []string{"person", "matter", "risk", "commitment", "decision"}

// recordingEntityAttrOrder 每类实体属性在 schema 数组返回中的顺序（与前端约定一致）。
var recordingEntityAttrOrder = map[string][]string{
	"person":     {"company", "position", "relationship", "demand"},
	"matter":     {"status", "priority", "dependency", "deliverable"},
	"risk":       {"risk_type", "risk_level", "probability", "response"},
	"commitment": {"fulfillment_status", "priority", "due_date"},
	"decision":   {"decision_status", "decision_maker", "reason", "impact_scope"},
}

// recordingEnumValueOrder 枚举值在 schema 数组返回中的顺序（保持声明顺序、输出确定性）。
var recordingEnumValueOrder = map[string][]string{
	"person.relationship":           {"potential_customer", "customer", "partner", "competitor", "irrelevant"},
	"matter.status":                 {"todo", "in_progress", "completed", "shelved"},
	"matter.priority":               {"high", "medium", "low"},
	"risk.risk_type":                {"compliance", "delivery", "financial", "technical"},
	"risk.risk_level":               {"high", "medium", "low"},
	"commitment.fulfillment_status": {"not_started", "in_progress", "fulfilled", "overdue"},
	"commitment.priority":           {"high", "medium", "low"},
	"decision.decision_status":      {"confirmed", "proposed", "rejected", "deferred", "uncertain"},
}

// RecordingMemoryEntitySchemaArray 返回按约定顺序排列的实体记忆 schema 数组。
// 顶层 data、attributes、枚举 values 均为数组且带 key/type/value 字段，供前端直接渲染。
func RecordingMemoryEntitySchemaArray() []RecordingMemoryEntitySchemaView {
	out := make([]RecordingMemoryEntitySchemaView, 0, len(recordingEntityTypeOrder))
	for _, typ := range recordingEntityTypeOrder {
		schema, ok := RecordingMemoryEntitySchemas[typ]
		if !ok {
			continue
		}
		view := RecordingMemoryEntitySchemaView{Type: typ, Label: schema.Label}
		attrOrder := recordingEntityAttrOrder[typ]
		if len(attrOrder) == 0 {
			for key := range schema.Attributes { // 兜底：未配置顺序时按 map 声明顺序
				attrOrder = append(attrOrder, key)
			}
		}
		for _, key := range attrOrder {
			attr, ok := schema.Attributes[key]
			if !ok {
				continue
			}
			attrView := RecordingMemoryAttributeSchemaView{Key: key, Label: attr.Label}
			if len(attr.Values) > 0 {
				valueOrder := recordingEnumValueOrder[typ+"."+key]
				if len(valueOrder) == 0 {
					for v := range attr.Values {
						valueOrder = append(valueOrder, v)
					}
				}
				for _, v := range valueOrder {
					label, ok := attr.Values[v]
					if !ok {
						continue
					}
					attrView.Values = append(attrView.Values, RecordingMemoryEnumValueSchema{Value: v, Label: label})
				}
			}
			view.Attributes = append(view.Attributes, attrView)
		}
		out = append(out, view)
	}
	return out
}
