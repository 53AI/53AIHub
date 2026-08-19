package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/keystone"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

// historyMeeting 历史会议数据，用于 Prompt 4 的 historical_context。
// 只包含历史纪要或结构化会议记忆，不包含历史洞察，避免上轮输出自我强化。
type historyMeeting struct {
	FileID       int64
	Title        string
	Minutes      string
	Memories     []meetingMemoryContext
	RecallSource uint8
}

const (
	historyRecallEntityOverlap uint8 = 1 << iota
	historyRecallClaim
	historyRecallEntityFact
)

// prompt4SystemPrompt 决策洞察分析 System Prompt（Prompt 4，默认场景＝公司内部会议视角）。
// 以 docs/方案探讨/洞察生成_Prompt.md（反向推导的"决策洞察生成 Prompt"）为主体：
// 角色设定、六大透镜、输出模板、写作约束与标签词库均按文档原文。
// 仅做两处必要适配：历史记忆引用改为本系统的 <related_history> JSON 引用方式
// （related_memories / related_meetings，由 buildHistoricalContext 注入用户输入），
// 以及输入挂载改为系统自动注入的 <personal_info>/<company_info>/<meeting_minutes>/<related_history>/<transcription>。
const prompt4SystemPrompt = `# 一、角色设定

你是"老板的 AI 外脑"——一位常驻公司的资深商业战略顾问与决策幕僚。你深度理解公司的战略底牌（商业模式、资源禀赋、历史决策与踩过的坑），并以"替老板做认知跃迁"为使命。

你只做三件事：
1. **把外部世界当镜子**——任何会议、案例、路演、分享，你都立刻映射回本公司业务，判断"这对我意味着什么"；
2. **重估价值**——不被表面的效率数字迷惑，追问"什么才是真正值得老板掏钱/投入的价值"；
3. **把判断变成红线**——不满足于"知道了"，而是产出明确的行动指令与止损门禁。

你说话的风格：直接、犀利、决策导向，像一位最信任的幕僚在向老板汇报，而不是记录员在复述。

适配说明：本系统会同时注入 <personal_info>（当前用户）与 <company_info>（当前企业）。若当前用户不是老板（如 CTO、项目总监等），分析视角、行动边界与称呼须按其职责、决策权限和表达偏好调整：不要默认每个用户都是老板，也不要把只有老板才能直接执行的指令派给没有最终决策权的用户，超出其权限的事项标记为建议升级。

# 二、分析框架：六大透镜（每次调用全部过一遍，按实际内容取舍）

对每一份会议纪要，依次用以下六个透镜审视，将结果沉淀为洞察的分节内容：

### 透镜一：镜像映射（案例 → 己身）
- 会议中的外部案例/观点，与本公司的什么业务场景同构？
- 这个案例是**值得借鉴的正例**，还是**必须规避的反例**？映射到本公司，结论是什么？
- 若会议是本公司内部会议，则直接看"这次讨论暴露了什么问题/验证了什么判断"。

### 透镜二：价值重估（重定义真正价值）
- 会议中展示/讨论的"价值"是什么？（提效、降本、增收、合规、安全、品牌……）
- 这些价值是**表面价值**还是**深层价值**？真正打动决策者的价值点是什么？
- 是否存在"表面价值掩盖真正卖点"的错位？本公司应抓住哪个？

### 透镜三：成本重算（算账视角）
- 用财务视角重算会议涉及的账：显性成本（采购/部署/人力）之外，还有哪些**隐性成本**（折旧、维护、人才依赖、学习成本、机会成本、沉没成本）？
- 会议宣称的"提效/省钱/免费"，从全周期看是否成立？
- 边际效益如何？投入产出比是否经得起追问？

### 透镜四：风险识别（合规/财务/交付/组织）
- 会议中埋藏哪些雷：合规风险（政策/评估/资质）、财务风险（对赌/抽血/资金占用）、交付风险（周期失控/定制泥潭）、组织风险（执行层把战略意图异化）？
- 如果照会议建议执行，最坏情况下公司会付出什么代价？

### 透镜五：历史印证（决策连续性）
- 调用 <related_history> 中的既往决策记忆（近期确立的战略方向、已否决的事项、已踩过的坑），判断：
  本次会议是**印证**了既定战略（那就强化执行），还是**偏离**了既定战略（那就叫停纠偏），还是**补全**了战略拼图（那就收编为新打法）？
- 只有确实相关时才引用；引用时说明它与当前会议的关系和影响，可自然使用"你还记得……""我们曾经……""与上次相比……"等说法。
- 历史只能建立连续性，不能覆盖本次会议的最新事实；未确认（needs_confirmation / proposed / uncertain）的记忆只能表达为"待核实"，不得写成已发生事实。

### 透镜六：门禁设计（把判断变成红线）
- 对每一条行动指令，配套可执行的门禁：
  - **一票否决**：哪些需求/合作/技术方案直接拒绝，不给讨论空间；
  - **止损线**：触发什么条件必须停止投入/终止合作；
  - **改判条件**：在什么前提下可以破例（通常要求对方全额预付、承担风险等）；
  - **验收标准**：什么结果才算达标，达不到不发版/不签单。

# 三、输出模板（严格遵循，Markdown）

# <H1 决策式标题>

**时间**：<会议时间；如无则省略>
**标签**：<领域分类 / 主题>

---

> <引用摘要：2-4 句话。第一句点出会议/案例的核心事实；第二句揭示其对本公司的本质含义；
> 第三句给出明确的决策倾向（升维/坚守/叫停/执行）。语气：站在老板立场，结论先行。>

## 核心论点：<一句话加粗的判断：因为 X，所以必须 Y / 停止 Z>

---

## 一、<分节标题：用现象/案例说明"为什么">
<1-3 段论证。可含 mermaid 流程图（因果链/结构图/陷阱推演），揭示表面繁荣背后的实质。mermaid 因果链节点可按内容性质加 ::: 等级后缀（:::neutral / :::positive / :::info / :::warning / :::danger / :::critical / :::pending，前端按此着色；其它类名会被忽略，不得使用 classDef 或 style）。>

## 二、<分节标题：价值/成本/风险的重估或历史印证>
<1-3 段论证。可含对比表格（模式对比/维度对比）或时间线表格（时间 | 事件 | 决策），
 证明判断的连续性。>

## 三、<分节标题：外部视角/补充视角（可选）>
### 1. <子视角一>
### 2. <子视角二>

## 四、<行动指令与门禁>
### 1. <动作一：动宾结构，如"切断……""重构……""确立……">
<1-2 句说明 + 门禁写法：> **止损/改判条件**：……
### 2. <动作二>
### 3. <动作三>

---

> <金句：一句凝练的警句，对仗或比喻，收束全文主旨。>

---

*来源：老板的AI外脑*
*免责声明：我也可能会犯错，内容请谨慎参考*

# 四、写作约束（质量红线）

1. **结论先行**：标题和引用摘要必须直接给出决策，禁止"就会议内容做个总结"式的开头。
2. **只写本质**：不逐条复述纪要条目，只保留能支撑决策的信息；删掉无关细节。
3. **分节有论点**：每个 ## 节必须有独立论点，节内"立论→证据→指令"闭环。
4. **门禁必配**：只要有行动指令，就必须配门禁（一票否决/止损线/改判条件），否则视为未完成。
5. **对老板说话**：可用"老板/ <personal_info> "等称呼直接喊话，增强代入感。
6. **篇幅控制**：单篇约 2500–4500 字（Markdown 含图表），信息密度高，不注水。
7. **格式准确**：Markdown 层级、mermaid 代码块、表格语法必须正确，可直接渲染。
8. **语义标记**：分节标题前可加一个语义标记，指明该节内容性质，便于前端渲染为对应区块：[核心判断] [风险] [脆弱假设] [因果链] [历史提醒] [时间线] [行动] [门禁] [对比] [待验证] [引用]。标记写在 ## 后、标题前（如"## [风险] 一、xxx"），不得改变标题文字；拿不准就不加，不要为凑齐类型虚构内容。

# 五、输入挂载（系统自动注入，无需手动粘贴）

本次调用时，系统会在用户输入中自动注入以下内容：
1. <personal_info>：当前用户的身份、职责、偏好与记忆；
2. <company_info>：当前公司的行业、业务模式、发展阶段、资源条件；
3. <meeting_minutes>：本次会议纪要（主要材料）；
4. <related_history>：历史相关信息，JSON 格式——related_memories（结构化会议记忆，字段：memory_id、type、content、assertion_state、lifecycle_state、review_state、source_file_id、source_file、confidence、evidence_available、source_segment_ids）与 related_meetings（历史会议纪要，字段：file_id、title、minutes）；
5. <transcription>：会议转写（事实证据）。

使用规则：
- 信息冲突时按以下优先级：本次转写明确事实 > 本次纪要明确结论 > 已确认的历史信息 > 个人/公司背景 > 一般经验。
- 历史只能建立连续性，不能覆盖本次会议的最新事实；个人信息和公司信息只能校准判断，不能虚构事实；纪要与转写冲突时必须指出，不得自行选择更乐观的一方。
- 禁止使用"综上所述""总的来说""值得注意的是"等套话；禁止逐条罗列纪要或大段复述转写；禁止把讨论意见、初步倾向写成正式决策；禁止对会议决策无条件正面肯定；信息不足时减少结论并标记"待验证"。

# 附：标签词库（用于 **标签** 字段，按需选用或自造同型词）

- 领域分类：认知升级 / 商业化策略 / 方案研讨 / 战略坚守 / 外部镜像验证 / 外部案例复盘 / 战略定力 / 竞品校验 / 外部路演复盘 / 商业模式捍卫 / 执行门禁 / 交付复盘 / 战略底线防卫 / 风险纠偏 / 内部孵化复盘 / 价值重塑 / 品牌运营 / 战略压力测试 / 机会识别 / 组织提效
- 标签格式恒为：<领域分类> / <主题>（两个词用斜杠分隔）。

# 附：理论方法映射（六大透镜背后的方法论依据，便于理解"为什么这样写"）

| 透镜 | 对应方法论/管理理论 | 在洞察中的体现 |
|---|---|---|
| 镜像映射 | 案例教学法 / 对标管理 (Benchmarking) | 把外部案例当镜子，映射回本公司业务 |
| 价值重估 | 价值主张画布 (Value Proposition Canvas) / 第二曲线创新 | 识别表面效率价值背后的深层增收价值 |
| 成本重算 | 全生命周期成本 (TCO) / 机会成本 / 沉没成本 | 算"24h 免费推理"背后的折旧与人力账 |
| 风险识别 | 风险管理 / 合规审计 / 组织行为学（意图-执行异化） | 合规、财务、交付、组织四类雷区扫描 |
| 历史印证 | 决策连续性 / 复盘 (AAR) / 记忆锚点 | 用既往决策节点证明判断一脉相承 |
| 门禁设计 | 止损纪律 / 红队思维 / 一票否决机制 | 每条指令配止损线、改判条件、验收标准 |

> 说明：六大透镜均为**类型化、概念化**的分析方法，不绑定任何具体业务场景；
> 因此本 Prompt 可迁移至任意行业、任意会议的洞察生成，这正是其通用性的来源。
`

// GenerateInsights 纪要生成完成后异步触发，生成决策洞察。
//
// 输入：
//   - file_body.content（转写文本）
//   - recording_file_summaries(template_id=0) 的 SummaryContent（纪要 JSON）
//
// 输出：写入 file.insight_summary
func GenerateInsights(ctx context.Context, eid, fileID, userID int64) {
	config, err := model.ValidateOrCreateRecordingConfig(eid)
	if err != nil || config.InferenceModelID == 0 || config.InferenceModelName == "" {
		logger.Infof(ctx, "【洞察】推理模型未配置，跳过 fileID=%d", fileID)
		setInsightsStatus(fileID, "skipped")
		return
	}

	file, err := model.GetFileByID(eid, fileID)
	if err != nil || file == nil {
		logger.Errorf(ctx, "【洞察】读取文件信息失败 fileID=%d err=%v", fileID, err)
		setInsightsStatus(fileID, "failed")
		return
	}
	if file.UserID > 0 && userID != file.UserID {
		logger.Warnf(ctx, "【洞察】使用文件创建者作为记忆归属 fileID=%d requested_user_id=%d file_user_id=%d", fileID, userID, file.UserID)
		userID = file.UserID
	}
	if _, memoryErr := ensureRecordingMemoryReady(ctx, eid, fileID, userID); memoryErr != nil {
		logger.Warnf(ctx, "【洞察-记忆就绪】失败，继续使用可用降级上下文 fileID=%d err=%v", fileID, memoryErr)
	}
	generation := file.InsightGeneration
	if !isInsightGenerationCurrent(eid, fileID, generation) {
		return
	}
	requestedPerspective := model.NormalizeInsightPerspective(file.InsightPerspective)
	perspective := requestedPerspective
	profile := insightPromptProfileFor(perspective)

	// 查询用户信息
	user, _ := model.GetUserByIDAndEid(eid, userID)
	if user != nil {
		user.LoadDepartments(0)
	}

	// 查询用户记忆（职位、风格、智能记忆、自定义记忆）
	position := ""
	style := ""
	smartMemory := ""
	customMemory := ""
	if userMemory, _ := model.GetUserMemory(eid, userID); userMemory != nil {
		position = userMemory.Position
		style = userMemory.Style
		if items, err := userMemory.GetSmartMemoryItems(); err == nil {
			smartMemory = formatMemoryFacts(items)
		}
		if items, err := userMemory.GetCustomMemoryItems(); err == nil {
			customMemory = formatMemoryFacts(items)
		}
	}

	// 查询企业信息
	enterprise, _ := model.GetEnterpriseByID(eid)

	setInsightsStatusIfCurrent(eid, fileID, generation, "processing")
	// 上报 Keystone 阶段开始
	if client := keystone.GlobalClient; client != nil {
		client.ReportTaskStageStarted(keystone.TaskEvent{
			ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
			TaskType:       "RECORDING_PIPELINE",
			StageKey:       "insights",
			ServiceKey:     "recording-pipeline",
		})
	}
	startTime := time.Now()

	// 1. 所有内置视角都以本次录音生成的纪要为主要材料；原始转写在后面作为证据补充。
	primaryMaterial, err := loadInsightPrimaryMaterial(ctx, eid, fileID, profile)
	if err != nil {
		logger.Errorf(ctx, "【洞察】读取主要材料失败 fileID=%d perspective=%s err=%v", fileID, perspective, err)
		setInsightsStatusIfCurrent(eid, fileID, generation, "failed")
		return
	}

	// 视角未设置时，只有企业显式开启多视角才调用一次分类器；分类失败安全回退为内部会议。
	if requestedPerspective == model.InsightPerspectiveAuto {
		perspective = resolveInsightPerspective(ctx, config, insightSourceTitle(file.Path), primaryMaterial)
		profile = insightPromptProfileFor(perspective)
		logger.Infof(ctx, "【洞察】自动视角解析完成 fileID=%d perspective=%s enabled=%v", fileID, perspective, config.MultiPerspectiveEnabled)
	}

	// 构建视角化增强 Prompt。最终洞察请求仍会注入个人信息、公司信息和历史记忆。
	enrichedPrompt := buildEnrichedPrompt(enterprise, user, position, style, smartMemory, customMemory, buildInsightSystemPrompt(perspective))
	// 用户在协同研讨中确认的背景作为本次生成的高优先级补充上下文注入，
	// 不修改全局用户/企业资料，避免一次文件级修订意外影响其它录音。
	// 个人/企业信息已由 buildEnrichedPrompt 实时注入，快照只携带用户补充说明。
	if saved, ok := loadSavedInsightBackground(file.InsightContext); ok {
		enrichedPrompt += "\n\n" + formatInsightBackgroundPrompt(saved, mustLoadMinutesText(eid, fileID))
	}

	// 2. 查询历史数据（实体重叠匹配，受记忆开关控制）
	memCfg := config.MemoryExtraction
	if memCfg == nil {
		memCfg = &model.MemoryExtractionConfig{Enabled: true, Types: []string{model.EntityTypePerson, model.EntityTypeMatter, model.EntityTypeCommitment}}
	}
	historyRows := loadRelatedInsightHistory(ctx, eid, fileID, userID, memCfg)

	// 3. 计算转写预算并压缩转写
	// 3.1 计算非转写输入 token 占用
	ctxBudget := getRecordingContextBudget(ctx, config)
	historyStr := buildHistoricalContext(historyRows)
	systemPromptTokens := estimateTokens(enrichedPrompt)
	primaryTokens := estimateTokens(primaryMaterial)
	historyTokens := estimateTokens(historyStr)
	outputReserve := 4096
	safetyMargin := 500

	fixedInputTokens := systemPromptTokens + historyTokens
	if !profile.SourceIsPrimaryText {
		fixedInputTokens += primaryTokens
	}
	availableInputBudget := ctxBudget - fixedInputTokens - outputReserve - safetyMargin
	if availableInputBudget < 1000 {
		logger.Errorf(ctx, "【洞察】视角输入预算不足: budget=%d perspective=%s", availableInputBudget, perspective)
		setInsightsStatusIfCurrent(eid, fileID, generation, "failed")
		return
	}

	// 3.2 通过统一压缩方案获取精炼的转写或主要正文。
	rawMaterial := ""
	if profile.SourceIsPrimaryText {
		rawMaterial = primaryMaterial
	}
	prepared, err := getOrCompressTranscript(ctx, TranscriptPrepareRequest{
		EID:                eid,
		FileID:             fileID,
		Consumer:           "insights",
		ContextLength:      ctxBudget,
		FixedInputTokens:   fixedInputTokens,
		MaxOutputTokens:    outputReserve,
		SafetyMargin:       safetyMargin,
		Mode:               "strict",
		RawText:            rawMaterial,
		InferenceModelID:   config.InferenceModelID,
		InferenceModelName: config.InferenceModelName,
	})
	if err != nil {
		logger.Errorf(ctx, "【洞察】转写压缩失败 fileID=%d err=%v", fileID, err)
		setInsightsStatusIfCurrent(eid, fileID, generation, "failed")
		return
	}
	logger.Infof(ctx, "【洞察】转写压缩完成 fileID=%d inputKind=%s sourceTokens=%d resultTokens=%d cacheHit=%v degraded=%v",
		fileID, prepared.InputKind, prepared.SourceTokens, prepared.ResultTokens, prepared.CacheHit, prepared.Degraded)
	transcriptText := prepared.Text
	if profile.SourceIsPrimaryText {
		primaryMaterial = prepared.Text
		transcriptText = ""
	}

	// 4. 调用视角化 Prompt 生成洞察
	result, err := callInsightsLLMForPerspective(ctx, config, fileID, perspective, insightSourceTitle(file.Path), transcriptText, primaryMaterial, historyRows, enrichedPrompt)
	if err != nil {
		if !isInsightGenerationCurrent(eid, fileID, generation) {
			return
		}
		logger.Errorf(ctx, "【洞察】生成失败 fileID=%d err=%v", fileID, err)
		// 提取 LLM 错误类型
		errorType := model.ErrorTypeModelUnavailable
		var llmErr *model.LLMError
		if errors.As(err, &llmErr) {
			errorType = llmErr.ErrorType
		}
		if client := keystone.GlobalClient; client != nil {
			client.ReportTaskStageCompleted(keystone.TaskEvent{
				ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
				TaskType:       "RECORDING_PIPELINE",
				StageKey:       "insights",
				StageStatus:    keystone.TaskStatusFailed,
				FailureCode:    "INSIGHTS_FAILED",
				ServiceKey:     "recording-pipeline",
				FinishedAt:     time.Now().UTC(),
			})
		}
		model.SetInsightsStatus(fileID, "failed", err.Error(), errorType)
		return
	}

	// 5. 写入 file.insight_summary。将生成版本放进 UPDATE 条件，
	// 即使用户在检查后立即确认新背景，旧结果也无法覆盖新一代洞察。
	updateResult := model.DB.WithContext(ctx).Model(&model.File{}).
		Where("id = ? AND eid = ? AND insight_generation = ?", fileID, eid, generation).
		Update("insight_summary", result)
	if updateResult.Error != nil {
		logger.Errorf(ctx, "【洞察】保存失败 fileID=%d err=%v", fileID, updateResult.Error)
		setInsightsStatusIfCurrent(eid, fileID, generation, "failed")
		return
	}
	if updateResult.RowsAffected != 1 {
		logger.Infof(ctx, "【洞察】检测到更新的生成版本，丢弃旧结果 fileID=%d generation=%d", fileID, generation)
		return
	}

	elapsed := time.Since(startTime)
	logger.Infof(ctx, "【洞察】生成成功 fileID=%d elapsed=%v history=%d", fileID, elapsed, len(historyRows))
	// 上报 Keystone 阶段成功
	if client := keystone.GlobalClient; client != nil {
		client.ReportTaskStageCompleted(keystone.TaskEvent{
			ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
			TaskType:       "RECORDING_PIPELINE",
			StageKey:       "insights",
			StageStatus:    keystone.TaskStatusSucceeded,
			ServiceKey:     "recording-pipeline",
			FinishedAt:     time.Now().UTC(),
		})
	}
	setInsightsStatusIfCurrent(eid, fileID, generation, "completed")

	// 6. 调用 Prompt 5 生成决策页面编排
	go func() {
		pageCtx, pageCancel := context.WithTimeout(recordingPipelineCtx, 5*time.Minute)
		defer pageCancel()
		generateInsightPageForGeneration(pageCtx, eid, fileID, config, result, generation)
	}()
}

// generateInsightPage 调用 Prompt 5 将洞察结果编排为动态决策页面。
func generateInsightPage(ctx context.Context, eid, fileID int64, config *model.RecordingConfig, insightMarkdown string) {
	generateInsightPageForGeneration(ctx, eid, fileID, config, insightMarkdown, 0)
}

func generateInsightPageForGeneration(ctx context.Context, eid, fileID int64, config *model.RecordingConfig, insightMarkdown string, generation int64) {
	if !isInsightGenerationCurrent(eid, fileID, generation) {
		logger.Infof(ctx, "【页面】检测到更新的生成版本，跳过旧页面 fileID=%d generation=%d", fileID, generation)
		return
	}
	if isInsightGenerationCurrent(eid, fileID, generation) {
		setInsightPageStatus(fileID, "processing")
		// 上报 Keystone 阶段开始
		if client := keystone.GlobalClient; client != nil {
			client.ReportTaskStageStarted(keystone.TaskEvent{
				ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
				TaskType:       "RECORDING_PIPELINE",
				StageKey:       "insight_page",
				ServiceKey:     "recording-pipeline",
			})
		}
	} else {
		return
	}

	pageMarkdown, err := callPageLayoutLLM(ctx, config, fileID, insightMarkdown)
	if err != nil {
		if !isInsightGenerationCurrent(eid, fileID, generation) {
			return
		}
		logger.Warnf(ctx, "【页面】编排失败，降级使用原始洞察: fileID=%d err=%v", fileID, err)
		if client := keystone.GlobalClient; client != nil {
			client.ReportTaskStageCompleted(keystone.TaskEvent{
				ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
				TaskType:       "RECORDING_PIPELINE",
				StageKey:       "insight_page",
				StageStatus:    keystone.TaskStatusFailed,
				FailureCode:    "INSIGHT_PAGE_FAILED",
				ServiceKey:     "recording-pipeline",
				FinishedAt:     time.Now().UTC(),
			})
		}
		setInsightPageStatus(fileID, "failed")
		return
	}

	if !isInsightGenerationCurrent(eid, fileID, generation) {
		logger.Infof(ctx, "【页面】检测到更新的生成版本，跳过旧页面 fileID=%d generation=%d", fileID, generation)
		return
	}
	if err := upsertInsightPageIfCurrent(eid, fileID, generation, pageMarkdown); err != nil {
		if errors.Is(err, ErrInsightGenerationStale) {
			logger.Infof(ctx, "【页面】检测到更新的生成版本，跳过旧页面 fileID=%d generation=%d", fileID, generation)
			return
		}
		logger.Errorf(ctx, "【页面】保存失败 fileID=%d err=%v", fileID, err)
		if isInsightGenerationCurrent(eid, fileID, generation) {
			setInsightPageStatus(fileID, "failed")
		}
		return
	}

	logger.Infof(ctx, "【页面】编排成功 fileID=%d", fileID)
	// 上报 Keystone 阶段成功
	if client := keystone.GlobalClient; client != nil {
		client.ReportTaskStageCompleted(keystone.TaskEvent{
			ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
			TaskType:       "RECORDING_PIPELINE",
			StageKey:       "insight_page",
			StageStatus:    keystone.TaskStatusSucceeded,
			ServiceKey:     "recording-pipeline",
			FinishedAt:     time.Now().UTC(),
		})
	}
	if isInsightGenerationCurrent(eid, fileID, generation) {
		setInsightPageStatus(fileID, "completed")
	}
}

// loadMeetingMinutesText 读取纪要并渲染为 Markdown（双模式：已反转读 FileBody，未反转读 Summary(0)）。
func loadMeetingMinutesText(ctx context.Context, eid, fileID int64) (string, error) {
	return loadMinutesText(eid, fileID)
}

func loadInsightPrimaryMaterial(ctx context.Context, eid, fileID int64, profile insightPromptProfile) (string, error) {
	if profile.SourceIsPrimaryText {
		fileBody, err := model.GetLastFileBodyByFileID(eid, fileID)
		if err == nil && fileBody != nil {
			content, contentErr := fileBody.GetContent()
			if contentErr == nil && strings.TrimSpace(content) != "" {
				return content, nil
			}
		}
	}
	return loadMeetingMinutesText(ctx, eid, fileID)
}

func insightSourceTitle(filePath string) string {
	title := strings.TrimSpace(path.Base(strings.TrimSpace(filePath)))
	for strings.Contains(title, ".") {
		ext := path.Ext(title)
		if ext == "" {
			break
		}
		title = strings.TrimSuffix(title, ext)
		if ext != ".md" && ext != ".markdown" {
			break
		}
	}
	return strings.TrimSpace(title)
}

// callInsightsLLM 调用 Prompt 4 生成洞察（带重试）。
func callInsightsLLM(ctx context.Context, config *model.RecordingConfig, fileID int64, transcriptText, summaryMarkdown string, historyRows []historyMeeting, enrichedPrompt string) (string, error) {
	return callInsightsLLMForPerspective(ctx, config, fileID, model.DefaultInsightPerspective, "", transcriptText, summaryMarkdown, historyRows, enrichedPrompt)
}

func callInsightsLLMForPerspective(ctx context.Context, config *model.RecordingConfig, fileID int64, perspective model.InsightPerspective, sourceTitle, transcriptText, primaryMaterial string, historyRows []historyMeeting, enrichedPrompt string) (string, error) {
	historicalContext := buildHistoricalContext(historyRows)

	buildRequest := func() *relaymodel.GeneralOpenAIRequest {
		userPrompt := buildInsightUserPrompt(perspective, sourceTitle, historicalContext, primaryMaterial, transcriptText)

		return &relaymodel.GeneralOpenAIRequest{
			Model: config.InferenceModelName,
			Messages: []relaymodel.Message{
				{Role: "system", Content: enrichedPrompt},
				{Role: "user", Content: userPrompt},
			},
		}
	}

	return callLLMWithRetry(ctx, config, buildRequest)
}

// buildInsightsUserPrompt 构建 Prompt 4 的五段输入中的历史相关信息、纪要和转写部分。
// 个人信息和公司信息由 system prompt 中的独立标签注入。
func buildInsightsUserPrompt(historicalContext, summaryMarkdown, transcriptText string) string {
	return buildInsightUserPrompt(model.DefaultInsightPerspective, "", historicalContext, summaryMarkdown, transcriptText)
}

func buildInsightUserPrompt(perspective model.InsightPerspective, sourceTitle, historicalContext, primaryMaterial, transcriptText string) string {
	profile := insightPromptProfileFor(perspective)
	titleBlock := ""
	if strings.TrimSpace(sourceTitle) != "" {
		titleBlock = fmt.Sprintf("\n<source_title>\n%s\n</source_title>\n", sourceTitle)
	}

	return fmt.Sprintf(`请根据下面的%s生成决策洞察。使用 Markdown 输出，先保证视角匹配、事实依据、风险与行动内容的质量；不要输出 JSON 或页面结构。
%s
<related_history>
%s
</related_history>

<%s>
%s
</%s>

<transcription>
%s
</transcription>`, profile.SourceName, titleBlock, historicalContext, profile.SourceTag, primaryMaterial, profile.SourceTag, transcriptText)
}

// buildHistoricalContext 构建 historical_context JSON，只包含历史纪要，不包含历史洞察。
func buildHistoricalContext(rows []historyMeeting) string {
	if len(rows) == 0 {
		return `{"related_meetings":[]}`
	}

	var meetings []string
	var memories []string
	for _, r := range rows {
		// 已有结构化记忆时只发送压缩后的 Claim；没有编译结果时才发送整篇纪要 fallback，
		// 避免同一会议的旧纪要与记忆重复占用上下文。
		if len(r.Memories) == 0 && strings.TrimSpace(r.Minutes) != "" {
			escapedMinutes, _ := json.Marshal(r.Minutes)
			meeting := fmt.Sprintf(`{"file_id":%d,"title":%s,"minutes":%s}`,
				r.FileID, jsonMarshal(r.Title), string(escapedMinutes))
			meetings = append(meetings, meeting)
		}
		for _, memory := range r.Memories {
			memories = append(memories, fmt.Sprintf(
				`{"memory_id":%d,"type":%s,"content":%s,"assertion_state":%s,"lifecycle_state":%s,"review_state":%s,"source_file_id":%d,"source_file":%s,"confidence":%.4f,"evidence_available":%t,"source_segment_ids":%s}`,
				memory.MemoryID,
				jsonMarshal(memory.Kind),
				jsonMarshal(memory.Content),
				jsonMarshal(memory.AssertionState),
				jsonMarshal(memory.LifecycleState),
				jsonMarshal(memory.ReviewState),
				memory.SourceFileID,
				jsonMarshal(memory.SourceFile),
				memory.SourceConfidence,
				memory.EvidenceAvailable,
				jsonMarshal(memory.SourceSegmentIDs),
			))
		}
	}

	if len(memories) == 0 {
		return fmt.Sprintf(`{"related_meetings":[%s]}`,
			strings.Join(meetings, ","))
	}
	return fmt.Sprintf(`{"related_memories":[%s],"related_meetings":[%s]}`,
		strings.Join(memories, ","), strings.Join(meetings, ","))
}

// buildEnrichedPrompt 构建带用户上下文和公司信息的增强 Prompt。
// 空字段不输出，整块为空时整块不输出。
func buildEnrichedPrompt(enterprise *model.Enterprise, user *model.User, position, style, smartMemory, customMemory, basePrompt string) string {
	var sb strings.Builder

	// 个人信息块
	var personalFields []string
	if user != nil && user.Nickname != "" {
		personalFields = append(personalFields, fmt.Sprintf(`    "nickname": "%s"`, escapeJSON(user.Nickname)))
	}
	if user != nil && len(user.Departments) > 0 && user.Departments[0].Name != "" {
		personalFields = append(personalFields, fmt.Sprintf(`    "department": "%s"`, escapeJSON(user.Departments[0].Name)))
	}
	if position != "" {
		personalFields = append(personalFields, fmt.Sprintf(`    "position": "%s"`, escapeJSON(position)))
	}
	if style != "" {
		personalFields = append(personalFields, fmt.Sprintf(`    "preferred_style": "%s"`, escapeJSON(style)))
	}
	if smartMemory != "" {
		personalFields = append(personalFields, fmt.Sprintf(`    "smart_memory": "%s"`, escapeJSON(strings.TrimSpace(smartMemory))))
	}
	if customMemory != "" {
		personalFields = append(personalFields, fmt.Sprintf(`    "custom_memory": "%s"`, escapeJSON(strings.TrimSpace(customMemory))))
	}

	// 公司信息块
	var companyFields []string
	if enterprise != nil && enterprise.FullName != "" {
		companyFields = append(companyFields, fmt.Sprintf(`    "name": "%s"`, escapeJSON(enterprise.FullName)))
	}
	if enterprise != nil && enterprise.DisplayName != "" {
		companyFields = append(companyFields, fmt.Sprintf(`    "short_name": "%s"`, escapeJSON(enterprise.DisplayName)))
	}
	if enterprise != nil && enterprise.Industry != "" {
		companyFields = append(companyFields, fmt.Sprintf(`    "industry": "%s"`, escapeJSON(enterprise.Industry)))
	}
	if enterprise != nil && enterprise.Description != "" {
		companyFields = append(companyFields, fmt.Sprintf(`    "description": "%s"`, escapeJSON(enterprise.Description)))
	}
	if enterprise != nil && enterprise.Keywords != "" {
		companyFields = append(companyFields, fmt.Sprintf(`    "keywords": "%s"`, escapeJSON(enterprise.Keywords)))
	}
	if enterprise != nil && enterprise.Type != "" {
		companyFields = append(companyFields, fmt.Sprintf(`    "type": "%s"`, escapeJSON(enterprise.Type)))
	}
	if enterprise != nil && enterprise.Slogan != "" {
		companyFields = append(companyFields, fmt.Sprintf(`    "slogan": "%s"`, escapeJSON(enterprise.Slogan)))
	}

	// 如果两个块都为空，不输出个人或公司上下文
	if len(personalFields) == 0 && len(companyFields) == 0 {
		return basePrompt
	}

	if len(personalFields) > 0 {
		sb.WriteString("<personal_info>\n{\n")
		for i, f := range personalFields {
			sb.WriteString(f)
			if i < len(personalFields)-1 {
				sb.WriteString(",")
			}
			sb.WriteString("\n")
		}
		sb.WriteString("}\n</personal_info>\n\n")
	}

	if len(companyFields) > 0 {
		sb.WriteString("<company_info>\n{\n")
		for i, f := range companyFields {
			sb.WriteString(f)
			if i < len(companyFields)-1 {
				sb.WriteString(",")
			}
			sb.WriteString("\n")
		}
		sb.WriteString("}\n</company_info>\n\n")
	}

	sb.WriteString(basePrompt)
	return sb.String()
}

func formatMemoryFacts(items []model.MemoryItem) string {
	facts := make([]string, 0, len(items))
	for _, item := range items {
		if fact := strings.TrimSpace(item.Fact); fact != "" {
			facts = append(facts, fact)
		}
	}
	return strings.Join(facts, "\n")
}

// escapeJSON 转义 JSON 字符串中的特殊字符
func escapeJSON(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "\"", "\\\"")
	s = strings.ReplaceAll(s, "\n", "\\n")
	s = strings.ReplaceAll(s, "\r", "\\r")
	s = strings.ReplaceAll(s, "\t", "\\t")
	return s
}

func jsonMarshal(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// prompt5SystemPrompt 决策页面格式转换 System Prompt（Prompt 5）。
// 轻量保真版：只做格式校验与转换，不做内容编辑。完整保留 Prompt 4 产出的
// 《决策洞察》（洞察生成_Prompt.md 模板）结构与原意，仅修复 Markdown 渲染语法。
const prompt5SystemPrompt = `# 决策页面格式转换提示词（保真版）

你的唯一输入是第一步已经生成的《决策洞察》Markdown（位于 <decision_analysis> 中）。你只做格式校验与转换，不是编辑、不是分析师：不得增删、合并、重排或改写任何事实、判断、数字、行动、责任人或日期，不得新增摘要、行动项、门禁或结论。原文中的不确定性必须原样保留。

# 转换规则

1. 内容保真：完整保留原文的标题层级（# 一级标题 → ## 分节 → ### 子节）、段落、列表、表格、引用块（>）、加粗和 mermaid 图，顺序与措辞不变；原文没有的内容一律不得添加。
2. 格式修复：仅修复会影响渲染的 Markdown 语法问题：
   - 标题层级连续（跳级时用同级的下一级标题补位，不改标题文字）；
   - mermaid 图语法有效：节点 ID 用简单英文编号（如 A、B、C1），节点文案用"标题 | 简短说明"，不写 HTML、样式、脚本、链接或 click 行为；只修正语法，不得增删或重新设计节点、连线与文案；
   - 表格行列对齐、引用块闭合、列表缩进正确；
   - 去掉会破坏渲染的原始控制字符。
3. 语义标记保真：保留原文标题前已有的语义标记（[核心判断] [风险] [脆弱假设] [因果链] [历史提醒] [时间线] [行动] [门禁] [对比] [待验证] [引用]），不得删除、修改或新增；原文没有标记的分节保持原样，不得添加。
4. 输出：只输出转换后的 Markdown，不输出 JSON、代码块包裹、解释或任何额外说明。
`

// callPageLayoutLLM 调用 Prompt 5 将洞察结果保真转换为页面 Markdown（带重试）。
func callPageLayoutLLM(ctx context.Context, config *model.RecordingConfig, fileID int64, insightMarkdown string) (string, error) {
	buildRequest := func() *relaymodel.GeneralOpenAIRequest {
		userPrompt := fmt.Sprintf(`请将以下《决策洞察》转换为页面 Markdown。只做格式校验与转换，完整保留原文内容与结构，不得改变任何判断、事实、行动或表述。

<decision_analysis>
%s
</decision_analysis>

页面偏好：

<render_preferences>
{
  "language": "zh-CN",
  "mobile_long_image": true
}
</render_preferences>

严格按照系统要求输出。`, insightMarkdown)

		return &relaymodel.GeneralOpenAIRequest{
			Model: config.InferenceModelName,
			Messages: []relaymodel.Message{
				{Role: "system", Content: prompt5SystemPrompt},
				{Role: "user", Content: userPrompt},
			},
		}
	}

	return callLLMWithRetry(ctx, config, buildRequest)
}
