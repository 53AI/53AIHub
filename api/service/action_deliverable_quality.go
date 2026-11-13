package service

import (
	"strings"

	"github.com/53AI/53AIHub/service/actionsystem"
)

// actionDeliverableQualityGuidance 根据已确认的行动用途与文件格式，补充少量可执行的成果标准。
// 这不是成果模板：不能覆盖用户确认的 Plan，也不能把缺失经营数据凭空补齐。
func actionDeliverableQualityGuidance(op actionsystem.ActionOpportunity, plan actionsystem.ActionPlan, contract canonicalPrimaryArtifactContract) []string {
	purpose := strings.Join([]string{op.Objective, plan.Objective, contract.Title}, " ")
	requirements := []string{
		"优先解决本次经营问题，先给能支持实际使用的结论；以用户确认的行动目标、交付物和验收标准为准，不扩展无关主题。",
		"区分已核实事实、业务判断、假设与数据缺口；任何未取得的成本、客户数据、金额或结论不得编造，重要判断说明依据与适用条件。",
		"对重要取舍提供可执行的替代选项、限制和需要负责人确认的事项；老板的既有判断是决策参考而不是不可质疑的事实。",
	}
	switch contract.Format {
	case actionsystem.FormatXLSX:
		requirements = append(requirements, "Excel 应有可编辑输入参数、明确假设、公式和计算单位；适用时提供不同情景的结果对比及复核说明，不得以静态文字伪装测算模型。")
		if containsActionPurpose(purpose, "报价", "价格", "降价", "利润", "毛利", "回款", "现金", "成本", "付款", "账期", "订单") {
			requirements = append(requirements, "经营测算需在数据可用时比较毛利、付款条件、回款时间与现金占用；缺数据先列出缺口和可替换参数，不虚构财务结果。")
		}
	case actionsystem.FormatPPTX:
		requirements = append(requirements, "PPT 一页表达一个核心判断，结论先行；关键数字适合时使用图表并注明口径、来源或假设，避免把全文堆进幻灯片。")
	case actionsystem.FormatDOCX:
		requirements = append(requirements, "Word 按使用对象组织管理摘要、分析依据、备选方案和待确认问题；篇幅服务用途，避免空泛或无必要的长篇报告。")
	}
	if op.Type == actionsystem.OpportunitySOP || containsActionPurpose(purpose, "SOP", "制度", "流程", "岗位标准") {
		requirements = append(requirements, "管理流程成果写清岗位与责任边界、输入输出、标准步骤、例外处理、执行检查点；未批准的制度只能标为评审稿。")
	}
	if containsActionPurpose(purpose, "谈判", "降价", "报价", "签约") {
		requirements = append(requirements, "谈判和报价成果需说明备选方案、条件交换、利润或其他经营底线以及需要人工确认的事项；不得替公司直接签约、承诺价格。")
	}
	if containsActionPurpose(purpose, "销售漏斗", "转化率", "销售业绩") {
		requirements = append(requirements, "销售分析应定位有证据支持的转化瓶颈，区分实际业绩与改善假设，并提出可验证的下一步。")
	}
	if containsActionPurpose(purpose, "招聘", "候选人", "面试") {
		requirements = append(requirements, "人才成果以岗位能力要求、可核实证据和结构化比较为主；录用决定保留给授权人员。")
	}
	if containsActionPurpose(purpose, "文章", "口播", "演讲", "传播") {
		requirements = append(requirements, "表达类成果必须明确受众、核心观点、论据与适用场景，保持老板真实观点，未经授权不得虚构案例。")
	}
	return requirements
}

// 只将与当前交付有关的少量标准放入用户可审核/修改的验收项；
// 确认执行时不再额外附加用户没有看到的成果标准。
func appendActionDeliverableQualityCriteria(plan *actionsystem.ActionPlan, op actionsystem.ActionOpportunity) {
	primary, err := actionsystem.PrimaryDeliverable(plan.Deliverables)
	if err != nil {
		return
	}
	contract := canonicalPrimaryArtifactContract{Title: primary.Title, Format: primary.Format}
	guidance := actionDeliverableQualityGuidance(op, *plan, contract)
	for _, index := range []int{1, 3, 4} { // 事实边界、格式规范、最相关的一项业务规范
		if index >= len(guidance) {
			continue
		}
		plan.AcceptanceCriteria = append(plan.AcceptanceCriteria, actionsystem.AcceptanceCriterion{
			Order: len(plan.AcceptanceCriteria) + 1, Description: guidance[index],
		})
	}
}

func containsActionPurpose(purpose string, terms ...string) bool {
	for _, term := range terms {
		if strings.Contains(purpose, term) {
			return true
		}
	}
	return false
}
