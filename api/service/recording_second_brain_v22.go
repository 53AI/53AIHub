package service

import (
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/model"
)

// V2.2 只改变正式洞察的职责边界：洞察负责经营判断，AI 可执行工作留给 ActionOpportunity。
// 不修改 V2.0/V2.1 的任何冻结 Prompt 或既有评测。
var secondBrainThinkingProgramTailV22 = strings.SplitN(secondBrainThinkingProgramTailPrompt, "\n## Step 7", 2)[0] + `
## Step 7 校准推进条件与重新判断条件

判断在什么事实、前提或边界下成立，何种变化需要重新判断。把条件融入对应判断，而非输出人工待办、工作清单或 AI 执行任务。工作候选由独立的行动建议模块另行识别和筛选。
`

const secondBrainOutputContractV22 = `# 输出契约（Markdown，V2.2 洞察与行动分工）

只输出有证据支持的经营判断与论证，不输出 AI 工作推荐、成果制作要求、人工待办或执行步骤清单。独立的行动建议模块负责决定是否值得创建可由 AI 执行的工作。允许没有行动的高质量洞察。

` + "```" + `
# <一句话说明这场交流真正值得关注什么>

## 我的判断
<明确判断、适用前提与需要重新判断的条件；没有把握时标注暂定或无法判断。>

## 我为什么这么判断
<2～5 条关键事实或行为证据：事实 → 说明什么 → 对判断的影响；不复述会议，不编造。>

## 还没有搞清楚的事
<只列最多 3 个会影响判断的不确定性，没有则省略。>
` + "```" + `

写作要求：结论先行；不得另设下一步待办、AI 能帮忙做的工作或交付物清单；不把假设写成决议；如需说明何时推进或停止，只写判断条件而非执行指令。`

// buildSecondBrainSystemPromptV22 是正式洞察唯一的第二大脑提示词组装入口。
// 复用现有场景与证据规则，但不依赖 V2.1 组装器及其旧输出契约。
func buildSecondBrainSystemPromptV22(perspective model.InsightPerspective, modes ...model.SceneMode) string {
	scene, mode, focus := resolveSecondBrainSceneModeFocus(perspective, modes...)
	decisionFrame := BuildSecondBrainDecisionFrame(scene, mode, focus)
	evidenceGuardrail := strings.Replace(secondBrainEvidenceGuardrailPrompt,
		"只能进入“还没有搞清楚的事”或“我建议下一步”", "只能进入“还没有搞清楚的事”", 1)
	completeness := strings.Replace(secondBrainCompletenessCheckPrompt,
		"6. **推进条件设计**：把判断落成现在的动作、停止条件、完成标准和重新决定的条件；没有依据时不要凑条件。",
		"6. **推进条件检查**：核对判断成立的前提、停止条件和重新判断条件；不用输出待办、成果要求或 AI 工作清单；没有依据则跳过。", 1)
	return strings.Join([]string{
		secondBrainPersonaPrompt,
		decisionFrame,
		secondBrainEvidenceBoundaryPrompt,
		evidenceGuardrail,
		secondBrainThinkingProgramHeadPrompt + "\n" + secondBrainInferenceJumpCheckPrompt + "\n" + secondBrainThinkingProgramTailV22,
		secondBrainOutputContractV22,
		completeness,
		secondBrainGuardrailChecklistPrompt,
		secondBrainInputMountPrompt,
	}, "\n\n")
}

// markdownHeading 仅识别围栏之外的 ATX 标题，并返回标题层级。
func markdownHeading(line string) (int, string) {
	line = strings.TrimRight(line, " \t")
	trimmed := strings.TrimLeft(line, " ")
	if len(line)-len(trimmed) > 3 {
		return 0, ""
	}
	count := 0
	for count < len(trimmed) && trimmed[count] == '#' {
		count++
	}
	if count == 0 || count > 6 || count >= len(trimmed) || (trimmed[count] != ' ' && trimmed[count] != '\t') {
		return 0, ""
	}
	return count, strings.TrimSpace(strings.TrimRight(strings.TrimSpace(trimmed[count:]), "# "))
}

func isSecondBrainLegacyActionHeading(heading string) bool {
	for _, name := range []string{"我可以替你做", "我建议下一步"} {
		if heading == name || heading == name+"：" || heading == name+":" {
			return true
		}
	}
	return false
}

// forEachInsightMarkdownLine 按 Markdown 围栏和标题进行扫描，避免误把引用代码中的标题当做真实章节。
func forEachInsightMarkdownLine(markdown string, visit func(line string, headingLevel int, headingText string)) {
	fenceChar, fenceSize := byte(0), 0
	for _, line := range strings.Split(markdown, "\n") {
		trimmed := strings.TrimLeft(line, " ")
		if len(line)-len(trimmed) <= 3 && len(trimmed) >= 3 && (trimmed[0] == '`' || trimmed[0] == '~') {
			size := 0
			for size < len(trimmed) && trimmed[size] == trimmed[0] {
				size++
			}
			if size >= 3 {
				if fenceChar == 0 {
					fenceChar, fenceSize = trimmed[0], size
					visit(line, 0, "")
					continue
				}
				if trimmed[0] == fenceChar && size >= fenceSize && strings.TrimSpace(trimmed[size:]) == "" {
					fenceChar, fenceSize = 0, 0
					visit(line, 0, "")
					continue
				}
			}
		}
		if fenceChar != 0 {
			visit(line, 0, "")
			continue
		}
		level, heading := markdownHeading(line)
		visit(line, level, heading)
	}
}

// stripSecondBrainV22ActionSections 只移除标准的旧 AI 工作章节；若移除后无有效判断，则中止保存。
func stripSecondBrainV22ActionSections(markdown string) (string, error) {
	kept := make([]string, 0, strings.Count(markdown, "\n")+1)
	skipLevel, removed, hasJudgment, hasJudgmentBody := 0, false, false, false
	inJudgment := false
	forEachInsightMarkdownLine(markdown, func(line string, level int, heading string) {
		if level > 0 && skipLevel > 0 && level <= skipLevel {
			skipLevel = 0
		}
		if skipLevel == 0 && (level == 2 || level == 3) && isSecondBrainLegacyActionHeading(heading) {
			skipLevel, removed = level, true
			return
		}
		if skipLevel > 0 {
			return
		}
		if level > 0 {
			if level <= 2 {
				inJudgment = level == 2 && heading == "我的判断"
			}
			if inJudgment {
				hasJudgment = true
			}
		} else if inJudgment && strings.TrimSpace(line) != "" {
			hasJudgmentBody = true
		}
		kept = append(kept, line)
	})
	if !removed {
		return markdown, nil
	}
	if !hasJudgment || !hasJudgmentBody {
		return "", fmt.Errorf("V2.2 洞察清理后缺少有效经营判断")
	}
	return strings.TrimSpace(strings.Join(kept, "\n")), nil
}

// insightPageLayoutSystemPrompt 根据传入的已落库正文忠实编排：仅老页面补跑使用旧 HTML 合同。
func insightPageLayoutSystemPrompt(markdown string) string {
	hasLegacySection := false
	forEachInsightMarkdownLine(markdown, func(_ string, level int, heading string) {
		if (level == 2 || level == 3) && isSecondBrainLegacyActionHeading(heading) {
			hasLegacySection = true
		}
	})
	if hasLegacySection {
		return prompt5SystemPrompt
	}
	return prompt5SystemPromptV22()
}

// prompt5SystemPromptV22 保留旧 HTML 样式与引用规则，但不再暗示生成动作卡片。
func prompt5SystemPromptV22() string {
	page := strings.NewReplacer(
		"首屏直接呈现决策式标题、洞察类型和一句话动作；关键边界或证据紧随其后。",
		"首屏直接呈现决策式标题、洞察类型和核心判断；关键证据与适用边界紧随其后。",
		"行动清单：多条时可有序号（但不要加那种看起来像可操作的勾选框），标题加粗；如果某项确实有硬性前提，可加「开始前要确认」小标，不要使用内部术语。",
		"判断条件：若原文提供推进前提或改判条件，可在判断卡中忠实呈现，但不得新增行动清单。",
	).Replace(prompt5SystemPrompt)
	return page + "\n\n## V2.2 页面内容边界\n不能新增原文没有的工作、行动卡、成果任务、人工待办或执行建议；不得新建 AI 行动建议模块。只忠实编排经营判断、证据、风险、不确定性和必要的推进条件。"
}
