package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

// historyMeeting 历史会议数据，用于 Prompt 4 的 historical_context。
// 只包含纪要（Minutes），不包含历史洞察（Insights），
// 避免用上轮输出作为本轮输入导致自我强化。
type historyMeeting struct {
	FileID  int64
	Title   string
	Minutes string
}

// prompt4SystemPrompt 老板决策分析 System Prompt（Prompt 4）。
// 来源：docs/录音转决策关键prompt.md -> Prompt 4
// 新版：输出 Markdown（非 JSON），引入共识分级与战略锚定。
const prompt4SystemPrompt = `# 角色
老板定乾坤，二号谋全局，你是能帮老板谋全局的二号位，兼具企业管理咨询、经营风险评估和辅助老板谋全局的视角。你理解中小企业的经营权与决策权高度集中，老板承担战略、销售、管理、财务、人事和外部关系等多类判断，老板的核心痛点是信息过载、分身乏术、决策孤独、情绪透支，你对老板绝对忠诚，给老板托付感。
你的任务是基于【老板简介+相关记忆+会议纪要+会议转写】生成一份【决策洞察】。

# 核心原则
1. 你不是"摘要员"，而是洞察全局的"二号位"，要帮老板从每天的会议和沟通中主动发现需要判断、拍板或跟进的事项，转化为带证据、带风险、带行动建议的决策卡片，不要复述会议说了什么，要判断这意味着什么。
2. 站的高度：你服务公司老板，他没时间看【过往记忆+会议转写+会议纪要】，需要你告诉他"一针见血的洞见、是否值得做、风险是什么、什么时候该叫停"。
3. 语言风格：犀利、果断、有文学底蕴。用词精准，拒绝套话。每一段都要有解读。
4. 敢于"唱反调"：如果会议纪要存在关键信息丢失或过于乐观，必须明确指出。

# 输出结构（严格遵循）

## 核心洞察
- 用一句话来命名本次会议的核心洞察（不是会议主题，而是会议内容定性）
- 格式示例：「知识库投标战略评估与成本警示」「安心录移动端MVP产品路线与极简心智定调」

## 内容总结（固定格式，1段，3句）
- 参考模板：
  "[核心议题]：[关键决策]，基于[风险/矛盾分析]，[潜在后果]。需[止损条件/行动方向]。"
- 必须包含：讨论了什么 → 做出了什么关键决定 → 但是有什么风险 →谋全局视角的观点

## 一句话定性（固定格式）
- 用 "标签词 / 标签词：一句话定性" 的格式
- 标签词从以下选择或组合：风险阻击、止损纠偏、MVP边界定调、招聘评估、战略对齐、路线分歧
- 示例："风险阻击 / 止损纠偏：强攻大概率"陪跑"的招标项目，低估了隐性履约代价"

## 主体内容块（自由，1-3块）
- 每块有独立标题，标题风格灵活（可用判断句、疑问句、比喻句）
- 块的数量和角度由会议内容决定，不固定模板
- 常见的思维维度（不要求全部覆盖，按实际情况呈现）：
  * 假设拆解：会议决策基于什么隐含假设？这些假设是否脆弱？
  * 对比表格：被选方案 vs 被否方案的优劣对比
  * 时间线/倒计时：关键里程碑节点与对应的风险
  * 外部校准：从行业常识、历史经验角度纠偏会议的乐观预期
  * 我记得有：如果提供了基于过往会议提炼的过往记忆，必须关联过往记忆进行洞察
- 每块内部可自由使用：表格、列表、流程图、emoji图标等
- 核心要求：不搬运纪要事实，而是做"升维判断"

## 行动建议/止损条件（固定板块）
- 列出1-3条具体的行动改判条件
- 每条必须有可执行的"行动标准"（到什么条件就做什么）
- 示例："放弃'极限低价'策略 → 测算真实成本以此为底线报价"

## 尾部金句（固定格式，1句）
- 一句格言级的战略警示语
- 修辞模式（二选一）：
  * "不要用A去掩饰B" — 示例：不要用"战略投资"的美颜滤镜，去掩饰一场缺乏筹码的盲目陪跑。
  * "X的终极Y，不是...而是..." — 示例：产品设计的终极克制，不是把能做的全塞给用户，而是替他们果断砍掉九成"以后可能会用"的伪需求。
- 要求：必须与本次会议的核心矛盾直接相关，不能是通用鸡汤

# 过往记忆注入规则
- 如果提供了过往记忆（如相关的人物、事件、项目、决策、教训、观点），必须在主体内容块中至少引用一次，格式为"你还记得"或"我们曾经"。
- 引用方式：指出当前会议与过往记忆的相关性/差异性，并判断之间产生的关联和影响。
- 注意：过往记忆仅为参考，不能作为会议决策的依据，不能覆盖会议纪要的事实内容。

# 禁止事项
- 禁止使用"综上所述"、"总的来说"、"值得注意的是"等套话
- 禁止逐条罗列纪要内容
- 禁止对会议决策进行无条件的正面肯定
- 禁止生成超过原文信息量的篇幅（决策应比纪要更精炼、更高密度）
- 如果纪要的主体内容没有足够的信息，请不要生成太多的洞察内容，可以只输出一句话定性，其他板块可省略。
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

	setInsightsStatus(fileID, "processing")
	startTime := time.Now()

	// 1. 读取纪要（渲染为 Markdown）
	summaryMarkdown, err := loadMeetingMinutesText(ctx, eid, fileID)
	if err != nil {
		logger.Errorf(ctx, "【洞察】读取纪要失败 fileID=%d err=%v", fileID, err)
		setInsightsStatus(fileID, "failed")
		return
	}

	// 2. 查询历史数据（实体重叠匹配，无实体时降级）
	var historyRows []historyMeeting

	// 2.1 查当前文件的实体 ID 集合
	var currentEntityIDs []int64
	model.DB.Model(&model.EntityChunkRelation{}).
		Where("eid = ? AND file_id = ? AND status = ?", eid, fileID, "active").
		Where("source IN ?", []string{"auto_llm", "auto_meta"}).
		Distinct("entity_id").
		Pluck("entity_id", &currentEntityIDs)

	if len(currentEntityIDs) > 0 {
		// 2.2 有实体：按实体重叠度匹配
		var historyFileIDs []int64
		model.DB.Table("entity_chunk_relations ecr").
			Joins("JOIN files f ON f.id = ecr.file_id").
			Where("ecr.eid = ? AND ecr.entity_id IN ? AND ecr.file_id != ? AND ecr.status = ?",
				eid, currentEntityIDs, fileID, "active").
			Where("f.user_id = ? AND f.origin_type IN ? AND f.parsing_status = ? AND f.insight_summary != ''",
				userID, model.RecordingOriginTypes(), "normal").
			Where("f.is_deleted = ?", false).
			Group("ecr.file_id").
			Order("COUNT(DISTINCT ecr.entity_id) DESC").
			Limit(5).
			Pluck("ecr.file_id", &historyFileIDs)

		// 2.3 用 loadMinutesText 双模式读纪要
		for _, fid := range historyFileIDs {
			var f model.File
			if err := model.DB.Where("id = ?", fid).First(&f).Error; err != nil {
				continue
			}
			minutes, err := loadMinutesText(eid, fid)
			if err != nil {
				logger.Errorf(ctx, "【洞察】读取历史纪要失败 fileID=%d err=%v", fid, err)
				continue
			}
			historyRows = append(historyRows, historyMeeting{
				FileID:  fid,
				Title:   f.Path,
				Minutes: minutes,
			})
		}
	}

	// 3. 计算转写预算并压缩转写
	// 3.1 计算非转写输入 token 占用
	ctxBudget := getRecordingContextBudget(ctx, config)
	historyStr := buildHistoricalContext(historyRows)
	systemPromptTokens := estimateTokens(prompt4SystemPrompt)
	minutesTokens := estimateTokens(summaryMarkdown)
	historyTokens := estimateTokens(historyStr)
	outputReserve := 4096
	safetyMargin := 500

	transcriptBudget := ctxBudget - systemPromptTokens - minutesTokens - historyTokens - outputReserve - safetyMargin
	if transcriptBudget < 1000 {
		logger.Errorf(ctx, "【洞察】转写预算不足: budget=%d < 1000", transcriptBudget)
		setInsightsStatus(fileID, "failed")
		return
	}

	// 3.2 通过压缩方案获取精炼转写
	prepared, err := getOrCompressTranscript(ctx, TranscriptPrepareRequest{
		EID:                eid,
		FileID:             fileID,
		Consumer:           "insights",
		ContextLength:      ctxBudget,
		FixedInputTokens:   systemPromptTokens + minutesTokens + historyTokens,
		MaxOutputTokens:    outputReserve,
		SafetyMargin:       safetyMargin,
		Mode:               "strict",
		InferenceModelID:   config.InferenceModelID,
		InferenceModelName: config.InferenceModelName,
	})
	if err != nil {
		logger.Errorf(ctx, "【洞察】转写压缩失败 fileID=%d err=%v", fileID, err)
		setInsightsStatus(fileID, "failed")
		return
	}
	logger.Infof(ctx, "【洞察】转写压缩完成 fileID=%d inputKind=%s sourceTokens=%d resultTokens=%d cacheHit=%v degraded=%v",
		fileID, prepared.InputKind, prepared.SourceTokens, prepared.ResultTokens, prepared.CacheHit, prepared.Degraded)

	// 4. 调用 Prompt 4 生成洞察
	result, err := callInsightsLLM(ctx, config, fileID, prepared.Text, summaryMarkdown, historyRows)
	if err != nil {
		logger.Errorf(ctx, "【洞察】生成失败 fileID=%d err=%v", fileID, err)
		setInsightsStatus(fileID, "failed")
		return
	}

	// 5. 写入 file.insight_summary
	if err := model.DB.Model(&model.File{}).Where("id = ?", fileID).
		Update("insight_summary", result).Error; err != nil {
		logger.Errorf(ctx, "【洞察】保存失败 fileID=%d err=%v", fileID, err)
		setInsightsStatus(fileID, "failed")
		return
	}

	elapsed := time.Since(startTime)
	logger.Infof(ctx, "【洞察】生成成功 fileID=%d elapsed=%v history=%d", fileID, elapsed, len(historyRows))
	setInsightsStatus(fileID, "completed")

	// 6. 调用 Prompt 5 生成决策页面编排
	go func() {
		pageCtx, pageCancel := context.WithTimeout(recordingPipelineCtx, 5*time.Minute)
		defer pageCancel()
		generateInsightPage(pageCtx, eid, fileID, config, result)
	}()
}

// generateInsightPage 调用 Prompt 5 将洞察结果编排为动态决策页面。
func generateInsightPage(ctx context.Context, eid, fileID int64, config *model.RecordingConfig, insightMarkdown string) {
	setInsightPageStatus(fileID, "processing")

	pageMarkdown, err := callPageLayoutLLM(ctx, config, fileID, insightMarkdown)
	if err != nil {
		logger.Warnf(ctx, "【页面】编排失败，降级使用原始洞察: fileID=%d err=%v", fileID, err)
		setInsightPageStatus(fileID, "failed")
		return
	}

	if err := model.UpsertRecordingFileInsightPage(fileID, pageMarkdown); err != nil {
		logger.Errorf(ctx, "【页面】保存失败 fileID=%d err=%v", fileID, err)
		setInsightPageStatus(fileID, "failed")
		return
	}

	logger.Infof(ctx, "【页面】编排成功 fileID=%d", fileID)
	setInsightPageStatus(fileID, "completed")
}

// loadMeetingMinutesText 读取纪要并渲染为 Markdown（双模式：已反转读 FileBody，未反转读 Summary(0)）。
func loadMeetingMinutesText(ctx context.Context, eid, fileID int64) (string, error) {
	return loadMinutesText(eid, fileID)
}

// callInsightsLLM 调用 Prompt 4 生成洞察（带重试）。
func callInsightsLLM(ctx context.Context, config *model.RecordingConfig, fileID int64, transcriptText, summaryMarkdown string, historyRows []historyMeeting) (string, error) {
	historicalContext := buildHistoricalContext(historyRows)

	buildRequest := func() *relaymodel.GeneralOpenAIRequest {
		userPrompt := fmt.Sprintf(`请根据下面的会议材料生成决策会议总结。使用 Markdown 输出协议，先保证战略判断、事实肌理、风险与行动内容的质量；不要输出 JSON 或页面结构。

<related_memories>
%s
</related_memories>

<meeting_minutes>
%s
</meeting_minutes>

<transcription>
%s
</transcription>`,
			historicalContext, summaryMarkdown, transcriptText)

		return &relaymodel.GeneralOpenAIRequest{
			Model: config.InferenceModelName,
			Messages: []relaymodel.Message{
				{Role: "system", Content: prompt4SystemPrompt},
				{Role: "user", Content: userPrompt},
			},
		}
	}

	return callLLMWithRetry(ctx, config, buildRequest)
}

// buildHistoricalContext 构建 historical_context JSON，只包含历史纪要，不包含历史洞察。
func buildHistoricalContext(rows []historyMeeting) string {
	if len(rows) == 0 {
		return `{"related_meetings":[]}`
	}

	var meetings []string
	for _, r := range rows {
		escapedMinutes, _ := json.Marshal(r.Minutes)
		meeting := fmt.Sprintf(`{"file_id":%d,"title":%s,"minutes":%s}`,
			r.FileID, jsonMarshal(r.Title), string(escapedMinutes))
		meetings = append(meetings, meeting)
	}

	return fmt.Sprintf(`{"related_meetings":[%s]}`,
		strings.Join(meetings, ","))
}

func jsonMarshal(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// prompt5SystemPrompt 决策页面动态编排 System Prompt（Prompt 5）。
// 来源：docs/录音转决策关键prompt.md -> Prompt 5
// 新版：输出 Markdown 语义标记（非 JSON Block），编辑式编排。
const prompt5SystemPrompt = `# 决策页面编排提示词（内容优先版）

你是一名企业决策简报编辑。你的唯一输入是第一步已经生成的"决策会议总结草稿"。

你的工作是把草稿编排成适合阅读的页面文案；不得重新分析会议，不得新增事实、判断、风险、数字、行动、责任人或日期。草稿中的不确定性必须保留为不确定性。

请只输出 Markdown，不输出 JSON、代码块或解释。使用宽松结构即可。为了让页面根据内容呈现不同视觉层次，内容合适时可在二级标题前加一个语义标记；不要为了凑齐类型而虚构内容：

- ` + "`" + `[风险]` + "`" + `：风险警示或成本提醒
- ` + "`" + `[脆弱假设]` + "`" + ` / ` + "`" + `[因果链]` + "`" + `：从假设到后果的链路，适合流程图
- ` + "`" + `[历史提醒]` + "`" + `：历史教训或经验映射
- ` + "`" + `[时间线]` + "`" + `：有明确日期、节点或倒计时
- ` + "`" + `[行动]` + "`" + ` / ` + "`" + `[门禁]` + "`" + `：下一步、改判条件、红线
- ` + "`" + `[对比]` + "`" + `：两种路径、取舍或边界
- ` + "`" + `[待验证]` + "`" + `：未决问题和验证事项
- ` + "`" + `[引用]` + "`" + `：一句有代表性的原话或金句

流程图规则：

- 只有草稿明确表达了因果、依赖、先后或汇聚关系时才输出 Mermaid 图；并列事实不要擅自画箭头。
- 使用 ` + "`flowchart TB`" + ` 表示上下流程，使用 ` + "`flowchart LR`" + ` 表示横向流程；优先使用 ` + "`TB`" + `，让手机阅读不被压缩。
- 节点 ID 只能使用简单英文编号，例如 ` + "`A`" + `、` + "`B`" + `、` + "`C1`" + `；节点文案使用 ` + "`标题 | 简短说明`" + `，不要写 HTML 标签、样式、脚本、链接或 ` + "`click`" + ` 行为。
- 支持 ` + "`A --> C`" + `、` + "`A & B --> C`" + `、` + "`A --> C --> D`" + ` 等关系；边标签只用于草稿明确出现的“导致、依赖、进入”等关系。
- 节点可在节点文案后添加一个白名单语义类名：` + "`:::neutral`" + `、` + "`:::positive`" + `、` + "`:::info`" + `、` + "`:::warning`" + `、` + "`:::danger`" + `、` + "`:::critical`" + `、` + "`:::pending`" + `。它只表达草稿中已经明确的性质，不得使用 ` + "`classDef`" + ` 或 ` + "`style`" + ` 自定义颜色。
- 如果草稿没有明确性质，省略类名，页面按 ` + "`neutral`" + ` 渲染；多个并列风险或负面结果应分别标记相同的 ` + "`warning`" + `、` + "`danger`" + ` 或 ` + "`critical`" + `，不能只给最后一个节点染色。
- Mermaid 图必须放在对应的 ` + "`[因果链]`" + `、` + "`[脆弱假设]`" + ` 或流程板块内，图下可继续用普通 Markdown 补充说明。

示例：

` + "```mermaid" + `
flowchart TB
    A["需求发散 | 流程不标准，需要不断返工"]:::neutral
    B["能力缺口 | 缺乏底层理解，需要重度带教"]:::neutral
    A & B --> C["FDE团队被动兜底 | 承担沟通与修复成本"]:::warning
    C --> D["产能崩塌 | 深度业务融合难题超出边界"]:::danger
` + "```" + `

` + "```markdown" + `
# 页面标题

100～220字开头摘要。

## [脆弱假设] 内容块标题
正文、列表或引用。

如果是流程或时间线，优先使用三级标题表示节点，让页面形成视觉层次：

` + "```markdown" + `
## [因果链] 揭开脆弱假设
### 假设一：硬套案例会失分
具体说明
### 后果：低价中标仍可能亏损
具体说明

## [时间线] 关键动作与交付倒计时
### 7月15日
完成自证与报价核查
### 7月22日 09:00
提交文件并完成现场交锋
` + "```" + `

## 下一步行动

- 行动项

## 待验证事项

- 待验证项

> 一句收束金句

` + "```" + `

可根据草稿自由决定 3～6 个内容块。优先保留会议的核心判断、具体事项、风险或未决问题以及行动。若草稿没有正式决定，必须如实表达为方向性判断或待确认事项。`

// callPageLayoutLLM 调用 Prompt 5 将洞察结果编排为决策页面（带重试）。
func callPageLayoutLLM(ctx context.Context, config *model.RecordingConfig, fileID int64, insightMarkdown string) (string, error) {
	buildRequest := func() *relaymodel.GeneralOpenAIRequest {
		userPrompt := fmt.Sprintf(`请将以下决策信息单元编排为动态决策简报。

<decision_analysis>
%s
</decision_analysis>

页面偏好：

<render_preferences>
{
  "language": "zh-CN",
  "max_blocks": 10,
  "max_actions": 4,
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
