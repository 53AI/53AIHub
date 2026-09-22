package actionsystem

import "strings"

func BuildActionIntent(opportunity ActionOpportunity, input DetectionInput) ActionIntent {
	contextLabel := strings.TrimSpace(input.ContextLabel)
	if contextLabel == "" {
		contextLabel = "会议洞察"
	}
	evidence := append([]EvidenceRef(nil), input.EvidenceRefs...)
	if len(evidence) == 0 {
		evidence = append([]EvidenceRef(nil), opportunity.EvidenceRefs...)
	}
	return ActionIntent{
		Objective:            strings.TrimSpace(opportunity.Objective),
		ActionType:           opportunity.Type,
		Scope:                "只使用 Host 提供的" + contextLabel + "和已授权上下文；只在本次 Action Workspace 内写入临时文件。",
		ExpectedDeliverables: primaryDeliverable(opportunity),
		SourceEvidence:       evidence,
	}
}

func BuildActionPlan(opportunity ActionOpportunity, input DetectionInput) ActionPlan {
	background := strings.TrimSpace(input.InsightSummary)
	contextLabel := strings.TrimSpace(input.ContextLabel)
	if contextLabel == "" {
		contextLabel = "会议洞察"
	}
	if material := strings.TrimSpace(input.MaterialContext); material != "" {
		background += "\n\n" + contextLabel + "补充材料：\n" + material
	}

	intent := BuildActionIntent(opportunity, input)
	plan := ActionPlan{
		OpportunityID:        opportunity.ID,
		Objective:            intent.Objective,
		Background:           background,
		Scope:                intent.Scope,
		Deliverables:         append([]Deliverable(nil), intent.ExpectedDeliverables...),
		ActionType:           intent.ActionType,
		EvidenceRefs:         append([]EvidenceRef(nil), intent.SourceEvidence...),
		RequiredCapabilities: append([]string(nil), opportunity.RequiredCapabilities...),
		RequiredInputs:       []RequiredInput{{Name: contextLabel, Source: opportunity.SourceType, Required: true}},
		Permissions: []Permission{
			{Capability: CapabilityEnterpriseContext, Resource: "host_context", Scope: "当前 Action", Approval: "pre-authorized"},
			{Capability: CapabilityDocumentGeneration, Resource: "action_workspace", Scope: "当前 Run", Approval: "pre-authorized"},
		},
		EstimatedEffort: "中",
		SourceRefs:      append([]SourceRef(nil), opportunity.SourceRefs...),
	}
	if strings.TrimSpace(input.MaterialContext) != "" {
		plan.RequiredInputs = append(plan.RequiredInputs, RequiredInput{Name: "补充上下文", Source: "material_context", Required: true})
	}

	switch opportunity.Type {
	case OpportunityDeepResearch:
		plan.ExecutionSteps = []ExecutionStep{
			{Order: 1, Title: "拆解研究问题", Description: "将会议洞察转为需要验证的研究问题和检索计划。"},
			{Order: 2, Title: "收集公开资料", Description: "使用已验证的公开资料研究能力，记录每个关键结论的来源。"},
			{Order: 3, Title: "交叉验证", Description: "对关键数字、判断和方案进行多来源核验，标注不确定性。"},
			{Order: 4, Title: "形成建议", Description: "输出核心结论、替代方案、管理层建议和待决策事项。"},
		}
		plan.RequiredInputs = append(plan.RequiredInputs, RequiredInput{Name: "公开资料研究能力", Source: "deep_research", Required: true})
		plan.Permissions = append(plan.Permissions, Permission{Capability: CapabilityDeepResearch, Resource: "public_web", Scope: "只读公开资料", Approval: "pre-authorized"})
		plan.AcceptanceCriteria = []AcceptanceCriterion{
			{Order: 1, Description: "所有交付物均已生成并可打开。"},
			{Order: 2, Description: "核心结论均有来源或明确标注无法验证。"},
			{Order: 3, Description: "关键事实至少完成交叉验证，并保留 Sources/Citations。"},
			{Order: 4, Description: "回答会议洞察中的 objective，并给出替代方案和管理层建议。"},
		}
		plan.Risks = []Risk{{Order: 1, Description: "公开资料存在时效性、营销偏差或来源冲突。", Mitigation: "记录来源日期、交叉验证结果和不确定性，不把未核验内容写成事实。"}}
		plan.EstimatedEffort = "高"
	case OpportunityAnalysis:
		plan.ExecutionSteps = []ExecutionStep{
			{Order: 1, Title: "整理输入数据", Description: "提取会议中的成本、用量、预算和约束，列出缺失输入。"},
			{Order: 2, Title: "建立测算模型", Description: "明确变量、假设、公式和不同情景。"},
			{Order: 3, Title: "复核结果", Description: "检查单位、边界条件和计算过程，区分事实与估算。"},
			{Order: 4, Title: "输出分析交付物", Description: "围绕行动目标形成核心结论、结果和管理层建议；不得引入机会未要求的主题。"},
		}
		plan.AcceptanceCriteria = []AcceptanceCriterion{
			{Order: 1, Description: "输入、假设、公式和结果均有清晰说明。"},
			{Order: 2, Description: "核心结论回答会议提出的分析目标，并与行动交付物保持一致。"},
			{Order: 3, Description: "不确定输入和估算结果被单独标注。"},
		}
		plan.Risks = []Risk{{Order: 1, Description: "会议输入不完整或价格随时间变化。", Mitigation: "显式列出缺口和价格日期，提供可替换参数。"}}
	case OpportunitySOP:
		plan.ExecutionSteps = []ExecutionStep{
			{Order: 1, Title: "提炼治理问题", Description: "从会议材料中区分现状、目标、责任边界和争议点。"},
			{Order: 2, Title: "设计流程和口径", Description: "形成角色、输入、步骤、输出、例外和升级机制。"},
			{Order: 3, Title: "补齐审查项", Description: "检查合规、数据口径、权限和落地依赖。"},
			{Order: 4, Title: "输出评审稿", Description: "形成制度/SOP 草案和待确认问题。"},
		}
		plan.AcceptanceCriteria = []AcceptanceCriterion{
			{Order: 1, Description: "流程角色、输入、输出和责任边界完整。"},
			{Order: 2, Description: "会议洞察中的关键治理问题均有对应处理。"},
			{Order: 3, Description: "未确认的制度性结论被标为待评审，而非自动发布。"},
		}
		plan.Risks = []Risk{{Order: 1, Description: "制度草案可能被误认为正式制度。", Mitigation: "产物明确标记为评审稿，禁止自动发布或替用户承诺。"}}
	default:
		plan.ExecutionSteps = []ExecutionStep{
			{Order: 1, Title: "整理会议结论", Description: "提取已确认事实、待确认问题和行动目标。"},
			{Order: 2, Title: "形成行动方案", Description: "给出步骤、交付物、验收标准和风险。"},
			{Order: 3, Title: "生成评审文档", Description: "输出可供用户确认和后续执行的行动摘要。"},
		}
		plan.AcceptanceCriteria = []AcceptanceCriterion{
			{Order: 1, Description: "交付物已生成并可打开。"},
			{Order: 2, Description: "行动目标、步骤、风险和待确认项完整。"},
		}
		plan.Risks = []Risk{{Order: 1, Description: "会议建议可能尚未获得人工确认。", Mitigation: "将建议和事实分开，并保留用户确认环节。"}}
	}
	return plan
}
