package enterpriseinit

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

const (
	defaultInstallationChannelName   = "默认模型渠道"
	defaultInstallationChannelConfig = "{}"
)

type installationChannelPreset struct {
	Models       string
	CustomConfig string
}

type selectedModelChannel struct {
	ChannelID   int64
	ChannelType int
	ModelName   string
}

type defaultModelSelection struct {
	LogicReasoning  *selectedModelChannel
	VectorEmbedding *selectedModelChannel
	Rerank          *selectedModelChannel
}

type defaultPromptSeed struct {
	Name        string
	LogoPath    string
	Content     string
	Description string
	Sort        int
}

type defaultPromptGroupSeed struct {
	GroupType int64
	Prompts   []defaultPromptSeed
}

var defaultPromptGroupSeeds = []defaultPromptGroupSeed{
	{
		GroupType: model.KM_FILE_CHAT_QUICK_COMMAND,
		Prompts: []defaultPromptSeed{
			{Name: "简化语言", Content: "请将本文改写成初中生也能看懂的语言，保留所有关键信息", Sort: 5},
			{Name: "总结文档", Content: "请用300字以内总结这篇文档的核心内容，突出关键结论和行动项。", Sort: 5},
			{Name: "阅读笔记", Content: "请为这篇文档生成结构化阅读笔记，包含：背景、核心观点、关键数据。", Sort: 4},
			{Name: "待办事项", Content: "请从文档中提取所有明确的待办任务，按负责人和截止时间（如有）列出清单。", Sort: 3},
			{Name: "问答自测", Content: "基于本文内容，生成5个关键问题并附答案，用于自我检测理解程度。", Sort: 2},
		},
	},
	{
		GroupType: model.KM_FILE_CHAT_SLIDE_COMMAND,
		Prompts: []defaultPromptSeed{
			{Name: "总结", LogoPath: "api/images/icon/note.png", Content: "用原语言总结概括以下内容：{划词内容} ", Sort: 6},
			{Name: "解释", LogoPath: "api/images/icon/book.png", Content: "请用通俗语言解释以下内容：{划词内容}，并举例说明。", Sort: 5},
			{Name: "翻译", LogoPath: "api/images/icon/book.png", Content: "请将以下中文翻译成专业、简洁的英文：{划词内容}", Sort: 4},
			{Name: "纠正", LogoPath: "api/images/icon/book.png", Content: "请检查并修正以下文本中的错别字、语法错误或表达不清之处，保持原意不变：{划词内容}", Sort: 3},
			{Name: "润色", LogoPath: "api/images/icon/book.png", Content: "请对以下文本进行语言润色，使其更流畅、简洁且专业，保持原意不变：{划词内容}", Sort: 2},
			{Name: "扩写", LogoPath: "api/images/icon/book.png", Content: "请围绕以下内容进行合理扩写，增加细节、背景或应用场景，使其更完整：{划词内容}", Sort: 1},
		},
	},
}

var defaultSystemPromptAILinks = []model.AILinkInfo{
	{Name: "百度AI+", Logo: "https://hubapi.53ai.com/api/preview/b5970a3697479df6b00d73ab827dabb2.png", URL: "https://chat.baidu.com", Description: "百度官方ai搜索", Sort: 0},
	{Name: "豆包", Logo: "https://hubapi.53ai.com/api/preview/d98b75d99fba38975312841a3c85aa72.png", URL: "https://www.doubao.com/", Description: "抖音旗下AI工具，你的智能助手", Sort: 0},
	{Name: "ChatGPT", Logo: "https://hubapi.53ai.com/api/preview/bcade7d1cebca9273da445ffc8671711.png", URL: "https://chat.openai.com", Description: "Chatgpt.com", Sort: 0},
	{Name: "腾讯元宝", Logo: "https://hubapi.53ai.com/api/preview/433b8834406d66420558b6f093f0fed1.png", URL: "https://yuanbao.tencent.com", Description: "腾讯元宝是一款基于腾讯混元大模型的AI产品，为用户提供多元化的AI能力", Sort: 0},
	{Name: "Kimi", Logo: "https://hubapi.53ai.com/api/preview/3df2f0d2e59edf80f4a1c93ce2d22035.png", URL: "https://www.kimi.com/", Description: "Kimi 是一款AI智能助手，由 Moonshot 自研的大语言模型驱动，支持在线搜索、深度思考、多模态推理和超长文本对话", Sort: 0},
}

var defaultSystemPromptSeeds = []defaultPromptSeed{
	{
		Name:        "快速解释概念",
		Content:     "请用通俗易懂的语言解释以下术语或概念，确保小白也能理解。\n要求：\n- 避免使用专业术语或缩写，必要时用比喻或类比说明；\n- 提供一个贴近生活的例子来帮助理解；\n- 语言简洁清晰，不超过150字；\n- 不添加主观评价或延伸讨论。\n\n需要解释的概念：\n{用户输入的术语或概念}",
		Description: "输入任意术语或概念，助手将用通俗语言解释其含义，并举例说明。适合学习或跨领域理解。",
		Sort:        8,
	},
	{
		Name:        "数据洞察提问",
		Content:     "请对以下数据进行分析，并回答以下问题：\n1. 主要趋势是什么？（上升/下降/波动）\n2. 哪些数据点异常？可能的原因是什么？\n3. 你能提出哪3条业务建议？（基于数据）\n\n请以简洁、专业的语言输出，避免猜测，只基于已有信息推断。\n\n数据：\n{用户粘贴的数据表格或列表}",
		Description: "粘贴一组数据（如销售表、用户反馈），助手将分析趋势、异常点并给出业务建议。",
		Sort:        7,
	},
	{
		Name:        "提取待办任务",
		Content:     "请从以下文本中提取所有明确的待办任务（To-do items），并按以下格式列出：\n- [ ] 任务描述（如：完成需求评审）\n- 负责人：XXX\n- 截止时间：YYYY-MM-DD（如有）\n\n仅提取有明确动作指令的内容，忽略建议、讨论或状态说明。\n\n原文：\n{用户粘贴的文档/邮件/聊天记录}",
		Description: "从文档、邮件或聊天记录中识别并列出所有明确的行动项，按优先级或责任人分类。",
		Sort:        6,
	},
	{
		Name:        "简化复杂文本",
		Content:     "请将以下专业性较强、语言复杂的段落改写成通俗易懂、适合初中生阅读的语言。\n要求：\n- 保留核心信息和关键事实；\n- 避免使用术语或缩写，必要时用比喻解释；\n- 分句清晰，逻辑连贯；\n- 不添加主观评价或额外信息。\n\n原文：\n{用户粘贴的复杂文本}",
		Description: "将专业、冗长或技术性强的段落改写成初中生可理解的语言，保留核心信息",
		Sort:        5,
	},
	{
		Name:        "整理会议纪要",
		Content:     "请将以下原始会议记录整理成一份结构化的会议纪要，包含以下部分：\n- 会议主题\n- 参会人员\n- 议题与讨论要点\n- 达成结论\n- 待办事项（按责任人和截止时间列出）\n\n请保持语言简洁准确，去除口语化表达，突出关键信息。\n\n原始记录：\n{用户粘贴的会议记录}",
		Description: "粘贴原始会议记录，自动输出结构化纪要，包含议题、结论、责任人与待办事项。",
		Sort:        5,
	},
	{
		Name:        "代码生成与注释",
		Content:     "请根据以下功能需求，生成一段完整、健壮的代码（推荐使用Python）。\n要求：\n- 包含必要的函数定义和变量说明；\n- 添加详细注释，解释每部分作用；\n- 处理常见异常情况（如输入错误、网络超时等）；\n- 返回结果应为可运行的代码块。\n\n功能需求：\n{用户描述的功能需求}",
		Description: "描述功能需求，生成带注释、异常处理的 Python/JavaScript 等语言代码片段。",
		Sort:        3,
	},
	{
		Name:        "生成社交媒体文案",
		Content:     "请根据以下产品或活动信息，生成一条适合发布在小红书、微博、朋友圈等社交平台的推广文案。\n要求：\n- 语言风格符合目标平台调性（如小红书偏种草、微博偏热点、朋友圈偏真诚分享）；\n- 突出核心卖点或亮点，激发兴趣；\n- 使用表情符号（如🌟💡🔥）增强视觉吸引力（可选）；\n- 包含明确的行动号召（CTA），如“立即体验”“点击了解”“限时优惠”；\n- 控制在200字以内，避免长篇大论。\n\n产品/活动信息：\n{用户输入的产品或活动详情}",
		Description: "提供产品/活动信息，自动生成适合小红书、微博、朋友圈等平台的推广文案，带情绪和号召力。",
		Sort:        1,
	},
	{
		Name:        "客户投诉回复模板",
		Content:     "请根据以下客户投诉内容，生成一封礼貌、专业且具有解决方案的客服回复邮件\n或话术。\n要求：\n- 使用正式但亲切的语言；\n- 先表达理解和歉意；\n- 明确问题原因（若已知）；\n- 提供具体解决步骤或替代方案；\n- 结尾鼓励客户再次联系或给予反馈。\n\n客户投诉内容：\n{用户粘贴的投诉内容}",
		Description: "输入客户投诉内容，生成礼貌、专业且具解决方案的客服回复邮件或话术。",
		Sort:        0,
	},
}

var defaultAILinkGroupSeedNames = []string{
	"豆包",
	"腾讯元宝",
	"千问",
	"DeepSeek",
	"Kimi",
	"秘塔搜索",
	"文心一言",
	"讯飞星火",
	"知乎直答",
}

var installationChannelPresets = map[int]installationChannelPreset{
	17: {
		Models:       "qwen-gte-rerank-v2,qwen-max,text-embedding-v4,vector_model_confidence",
		CustomConfig: `{"alias_map":{"qwen-gte-rerank-v2":"Qwen-gte-rerank-v2","qwen-max":"Qwen-Max","text-embedding-v4":"Qwen-text-embedding-v4","qwen-plus":"Qwen-plus"},"deep_thinking":[],"vision":[],"models":[],"qwen-gte-rerank-v2":"3","qwen-max":"1","text-embedding-v4":"2","vector_model_confidence":"[object Object]"}`,
	},
	900: {
		Models:       "doubao-embedding-large-text-250515,doubao-seed-1-6-flash-250828",
		CustomConfig: `{"alias_map":{"doubao-embedding-large-text-250515":"Doubao-embedding-large","doubao-seed-1-6-flash-250828":"Doubao-Seed-1.6-flash"},"deep_thinking":[],"vision":[],"models":[],"doubao-embedding-large-text-250515":"2","doubao-seed-1-6-flash-250828":"1"}`,
	},
	44: {
		Models:       "deepseek-ai/DeepSeek-V3.2-Exp,Qwen/Qwen3-Embedding-8B,qwen3-reranker-8b,Qwen/Qwen3-Reranker-8B",
		CustomConfig: `{"alias_map":{"deepseek-ai/DeepSeek-V3.2-Exp":"Deepseek-v3.2-Exp","Qwen/Qwen3-Embedding-8B":"Qwen/Qwen3-Embedding-8B","Qwen/Qwen3-Reranker-8B":"Qwen3-Reranker-8B","deepseek-ai/DeepSeek-R1":"Deepseek-R1","moonshotai/Kimi-K2-Instruct":"Kimi-K2-Instruct"},"deep_thinking":[],"vision":[],"models":[],"deepseek-ai/DeepSeek-V3.2-Exp":"1","Qwen/Qwen3-Embedding-8B":"2","qwen3-reranker-8b":"3","Qwen/Qwen3-Reranker-8B":"3"}`,
	},
}

// EnsureEnterprisePostInit ensures enterprise post-initialization resources are created.
// It is idempotent and can be safely called multiple times.
func EnsureEnterprisePostInit(tx *gorm.DB, enterprise *model.Enterprise, adminUser *model.User) error {
	if tx == nil {
		return errors.New("db is nil")
	}
	if enterprise == nil {
		return errors.New("enterprise is nil")
	}
	if adminUser == nil || adminUser.UserID == 0 {
		return errors.New("admin user is invalid")
	}

	logger.Debugf(nil, "【企业初始化】开始后置初始化: eid=%d, admin_user_id=%d", enterprise.Eid, adminUser.UserID)

	if err := ensureDefaultSpaceResources(tx, enterprise, adminUser); err != nil {
		return err
	}

	if err := EnsureDefaultRagPipelineAndStrategy(tx, enterprise.Eid); err != nil {
		return err
	}

	if err := ensureDefaultSiteModelConfigFromInitializedChannels(tx, enterprise.Eid); err != nil {
		return err
	}

	if err := ensureDefaultAgentsFromInitializedChannels(tx, enterprise.Eid, adminUser.UserID); err != nil {
		return err
	}

	if err := ensureDefaultPromptGroupsAndPrompts(tx, enterprise.Eid, adminUser.UserID); err != nil {
		return err
	}

	if err := ensureDefaultSystemPromptGroupAndPrompts(tx, enterprise.Eid, adminUser.UserID); err != nil {
		return err
	}

	if err := ensureDefaultAILinks(tx, enterprise.Eid, adminUser.UserID); err != nil {
		return err
	}

	logger.Debugf(nil, "【企业初始化】后置初始化完成: eid=%d", enterprise.Eid)
	return nil
}

// EnsureInstallationChannel creates or updates the default initialization channel.
// It is idempotent and can be reused by multiple initialization flows.
func EnsureInstallationChannel(tx *gorm.DB, eid int64, channelType int, baseURL, key string) (*model.Channel, error) {
	if tx == nil {
		return nil, errors.New("db is nil")
	}
	if eid <= 0 {
		return nil, errors.New("enterprise id is invalid")
	}
	if channelType == 0 {
		return nil, errors.New("channel type is required")
	}

	preset, ok := installationChannelPresets[channelType]
	if !ok {
		return nil, errors.New("unsupported channel type")
	}

	baseURL = strings.TrimSpace(baseURL)
	key = strings.TrimSpace(key)
	if key == "" {
		return nil, errors.New("channel key is required")
	}
	if channelType != 44 && baseURL == "" {
		return nil, errors.New("channel base_url is required")
	}

	if baseURL == "" && channelType == 44 {
		baseURL = ""
	}

	baseURLPtr := &baseURL
	var channel model.Channel
	err := tx.Where("eid = ? AND type = ?", eid, channelType).First(&channel).Error
	if err == nil {
		existingCustomConfig := channel.CustomConfig
		channel.Key = key
		channel.Name = defaultInstallationChannelName
		channel.Models = preset.Models
		channel.Config = defaultInstallationChannelConfig
		if strings.TrimSpace(existingCustomConfig) == "" {
			channel.CustomConfig = preset.CustomConfig
		} else {
			channel.CustomConfig = existingCustomConfig
		}
		channel.BaseURL = baseURLPtr
		channel.Status = model.ChannelStatusEnabled
		channel.ProviderID = 0
		if err := tx.Save(&channel).Error; err != nil {
			return nil, err
		}
		return &channel, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	channel = model.Channel{
		Eid:          eid,
		Type:         channelType,
		Key:          key,
		Name:         defaultInstallationChannelName,
		Models:       preset.Models,
		Config:       defaultInstallationChannelConfig,
		CustomConfig: preset.CustomConfig,
		BaseURL:      baseURLPtr,
		Status:       model.ChannelStatusEnabled,
		ProviderID:   0,
	}
	if err := tx.Create(&channel).Error; err != nil {
		return nil, err
	}

	return &channel, nil
}

func ensureDefaultSiteModelConfigFromInitializedChannels(tx *gorm.DB, eid int64) error {
	if tx == nil {
		return errors.New("db is nil")
	}

	channels, modelSelection, err := resolveDefaultModelSelectionFromInitializedChannels(tx, eid)
	if err != nil {
		return err
	}
	if modelSelection == nil {
		logger.Debugf(nil, "【企业初始化】站点默认模型配置跳过: eid=%d, 初始化渠道数=%d", eid, len(channels))
		return nil
	}

	modelConfig, err := buildDefaultSiteModelConfigFromChannels(channels, modelSelection)
	if err != nil {
		return err
	}
	if modelConfig == nil {
		return nil
	}

	configService := rag.NewChunkConfigService(tx)
	var siteSetting model.ChunkSetting
	err = tx.Where("eid = ? AND type = ? AND library_id IS NULL", eid, model.ChunkTypeDefault).First(&siteSetting).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		siteConfig, err := configService.CreateDefaultConfig(eid, nil, model.ChunkTypeDefault, rag.DefaultName)
		if err != nil {
			return err
		}
		return configService.UpdateModelConfigInChunkConfig(siteConfig, modelConfig)
	}

	siteConfig, err := configService.GetConfigByID(eid, siteSetting.ID)
	if err != nil {
		return err
	}

	return configService.UpdateModelConfigInChunkConfig(siteConfig, modelConfig)
}

func getInitializedChannels(tx *gorm.DB, eid int64) ([]model.Channel, error) {
	var channels []model.Channel
	if err := tx.Where("eid = ? AND status = ? AND type IN ?", eid, model.ChannelStatusEnabled, []int{17, 900, 44}).
		Order("channel_id asc").
		Find(&channels).Error; err != nil {
		return nil, err
	}
	return channels, nil
}

func resolveDefaultModelSelectionFromInitializedChannels(tx *gorm.DB, eid int64) ([]model.Channel, *defaultModelSelection, error) {
	channels, err := getInitializedChannels(tx, eid)
	if err != nil {
		return nil, nil, err
	}
	if len(channels) == 0 {
		return channels, nil, nil
	}

	modelSelection := buildDefaultModelSelectionFromChannels(channels)
	if modelSelection == nil {
		return channels, nil, nil
	}

	return channels, modelSelection, nil
}

func buildDefaultModelSelectionFromChannels(channels []model.Channel) *defaultModelSelection {
	loader := common.GetModelCatalogLoader()
	selection := &defaultModelSelection{}

	for i := range channels {
		channel := channels[i]
		modelNames := splitChannelModelNames(channel.Models)
		for _, modelName := range modelNames {
			meta, err := loader.GetModelMeta(channel.Type, modelName)
			if err != nil {
				continue
			}

			switch typedMeta := meta.(type) {
			case *common.ChatModelMeta:
				if selection.LogicReasoning == nil && typedMeta != nil {
					selection.LogicReasoning = &selectedModelChannel{
						ChannelID:   channel.ChannelID,
						ChannelType: channel.Type,
						ModelName:   typedMeta.ModelID,
					}
				}
			case *common.EmbeddingModelMeta:
				if selection.VectorEmbedding == nil && typedMeta != nil {
					selection.VectorEmbedding = &selectedModelChannel{
						ChannelID:   channel.ChannelID,
						ChannelType: channel.Type,
						ModelName:   typedMeta.ModelID,
					}
				}
			case *common.RerankModelMeta:
				if selection.Rerank == nil && typedMeta != nil {
					selection.Rerank = &selectedModelChannel{
						ChannelID:   channel.ChannelID,
						ChannelType: channel.Type,
						ModelName:   typedMeta.ModelID,
					}
				}
			}
		}
	}

	if selection.LogicReasoning == nil || selection.VectorEmbedding == nil {
		return nil
	}

	return selection
}

func buildDefaultSiteModelConfigFromChannels(channels []model.Channel, selection *defaultModelSelection) (*model.ModelConfigData, error) {
	if selection == nil {
		selection = buildDefaultModelSelectionFromChannels(channels)
	}
	if selection == nil {
		return nil, nil
	}

	modelConfig := &model.ModelConfigData{
		Version: "1.0",
		LogicReasoning: model.ModelChannelConfig{
			ChannelID: &selection.LogicReasoning.ChannelID,
			ModelName: &selection.LogicReasoning.ModelName,
		},
		VectorEmbedding: model.ModelChannelConfig{
			ChannelID: &selection.VectorEmbedding.ChannelID,
			ModelName: &selection.VectorEmbedding.ModelName,
		},
		FastReasoning: model.ModelChannelConfig{
			ChannelID: &selection.LogicReasoning.ChannelID,
			ModelName: &selection.LogicReasoning.ModelName,
		},
		SearchConfig: model.SearchConfigData{
			Vector:                true,
			Fulltext:              false,
			Hybrid:                false,
			RerankModel:           "rerank-english-v2.0",
			RerankChannelId:       0,
			RerankModelName:       "",
			RerankingEnable:       false,
			TopK:                  4,
			ScoreThreshold:        0,
			ScoreThresholdEnabled: false,
			Weights: model.SearchWeights{
				KeywordSetting: model.KeywordSetting{
					KeywordWeight: 0,
				},
				VectorSetting: model.VectorSetting{
					VectorWeight: 0,
				},
			},
		},
	}

	if selection.Rerank != nil {
		modelConfig.SearchConfig.RerankChannelId = int(selection.Rerank.ChannelID)
		modelConfig.SearchConfig.RerankModelName = selection.Rerank.ModelName
		modelConfig.SearchConfig.RerankingEnable = true
	}

	return modelConfig, nil
}

func ensureDefaultAgentsFromInitializedChannels(tx *gorm.DB, eid int64, createdBy int64) error {
	if tx == nil {
		return errors.New("db is nil")
	}

	channels, modelSelection, err := resolveDefaultModelSelectionFromInitializedChannels(tx, eid)
	if err != nil {
		return err
	}
	if modelSelection == nil {
		logger.Debugf(nil, "【企业初始化】默认 Agent 初始化跳过: eid=%d, 初始化渠道数=%d", eid, len(channels))
		return nil
	}

	logger.Debugf(nil, "【企业初始化】默认 Agent 模型推导结果: eid=%d, logic_channel_id=%d, logic_channel_type=%d, logic_model=%s, rerank_channel_id=%d, rerank_model=%s",
		eid, modelSelection.LogicReasoning.ChannelID, modelSelection.LogicReasoning.ChannelType, modelSelection.LogicReasoning.ModelName,
		func() int64 {
			if modelSelection.Rerank == nil {
				return 0
			}
			return modelSelection.Rerank.ChannelID
		}(), func() string {
			if modelSelection.Rerank == nil {
				return ""
			}
			return modelSelection.Rerank.ModelName
		}())

	for _, agent := range buildDefaultAgents(modelSelection, createdBy) {
		createdAgent, err := ensureDefaultAgent(tx, eid, agent)
		if err != nil {
			return err
		}

		if err := ensureDefaultAgentModel(tx, eid, createdAgent.AgentID, modelSelection.LogicReasoning); err != nil {
			return err
		}
	}

	return nil
}

func ensureDefaultAgent(tx *gorm.DB, eid int64, agent model.Agent) (*model.Agent, error) {
	if tx == nil {
		return nil, errors.New("db is nil")
	}

	var existing model.Agent
	err := tx.Where("eid = ? AND owner_id = ? AND agent_usage = ?", eid, model.AgentOwnerEnterprise, agent.AgentUsage).First(&existing).Error
	if err == nil {
		logger.Debugf(nil, "【企业初始化】默认 Agent 已存在，跳过: eid=%d, usage=%d, agent_id=%d, name=%s", eid, agent.AgentUsage, existing.AgentID, existing.Name)
		return &existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	agent.Eid = eid
	agent.OwnerID = model.AgentOwnerEnterprise
	if err := tx.Create(&agent).Error; err != nil {
		return nil, err
	}

	logger.Debugf(nil, "【企业初始化】默认 Agent 创建成功: eid=%d, usage=%d, agent_id=%d, name=%s", eid, agent.AgentUsage, agent.AgentID, agent.Name)
	return &agent, nil
}

func ensureDefaultAgentModel(tx *gorm.DB, eid, agentID int64, selection *selectedModelChannel) error {
	if tx == nil {
		return errors.New("db is nil")
	}
	if selection == nil {
		return nil
	}

	var existing model.AgentModels
	err := tx.Where("eid = ? AND agent_id = ? AND model = ? AND channel_type = ? AND channel_id = ?",
		eid, agentID, selection.ModelName, selection.ChannelType, selection.ChannelID).First(&existing).Error
	if err == nil {
		logger.Debugf(nil, "【企业初始化】默认 Agent 模型已存在，跳过: eid=%d, agent_id=%d, model=%s, channel_id=%d",
			eid, agentID, selection.ModelName, selection.ChannelID)
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	agentModel := &model.AgentModels{
		Eid:         eid,
		AgentID:     agentID,
		Model:       selection.ModelName,
		ChannelType: selection.ChannelType,
		ChannelID:   selection.ChannelID,
	}
	if err := tx.Create(agentModel).Error; err != nil {
		return err
	}

	logger.Debugf(nil, "【企业初始化】默认 Agent 模型创建成功: eid=%d, agent_id=%d, model=%s, channel_id=%d",
		eid, agentID, selection.ModelName, selection.ChannelID)
	return nil
}

func buildDefaultAgents(selection *defaultModelSelection, createdBy int64) []model.Agent {
	logic := selection.LogicReasoning
	rerank := selection.Rerank
	agents := []model.Agent{
		buildWorkAIAgent(logic, createdBy),
		buildAISearchAgent(logic, rerank, createdBy),
		buildDocumentAppAgent(logic, rerank, createdBy),
		buildKnowledgeMapAgent(logic, createdBy),
	}
	return agents
}

func buildWorkAIAgent(logic *selectedModelChannel, createdBy int64) model.Agent {
	settings := map[string]interface{}{
		"opening_statement": "下午好，希望我为你做些什么？",
		"fast_reasoning_config": map[string]interface{}{
			"enable":       true,
			"channel_id":   logic.ChannelID,
			"channel_type": logic.ChannelType,
			"model_name":   logic.ModelName,
			"temperature":  0.7,
		},
		"skill_run_config": map[string]interface{}{
			"enable":       true,
			"channel_id":   logic.ChannelID,
			"channel_type": logic.ChannelType,
			"model_name":   logic.ModelName,
			"temperature":  0.7,
		},
		"skills": []interface{}{},
	}

	return model.Agent{
		Name:         "工作台",
		Logo:         "",
		Sort:         0,
		Description:  "",
		ChannelType:  logic.ChannelType,
		Model:        logic.ModelName,
		Prompt:       "你是一个全能的数字员工。你不仅能回答问题，还能使用浏览器、代码解释器等工具自主完成复杂任务。面对任务时，请先进行规划(Plan)，然后逐步执行(Execute)，并在每一步后进行观察(0bserve)和反思(Reflect)。",
		Configs:      `{"completion_params":{"temperature":0.2,"top_p":0.75,"presence_penalty":0.5,"frequency_penalty":0.5}}`,
		Tools:        `[]`,
		GroupID:      0,
		UseCases:     `[]`,
		CreatedBy:    createdBy,
		CustomConfig: `{"agent_type":"prompt","provider_id":0,"channel_id":0,"channel_config":{},"file_parse":{"enable":false},"image_parse":{"enable":false},"agent_mode":"chat","skills":[{"label":"测试代码生成","img":"skill1"},{"label":"录音转文字","img":"skill2"},{"label":"天气查询","img":"skill3"}]}`,
		Settings:     mustMarshalJSONString(settings),
		Enable:       true,
		AgentType:    model.AgentTypeApp,
		AgentUsage:   model.AgentUsageWorkAI,
		OwnerID:      model.AgentOwnerEnterprise,
	}
}

func buildAISearchAgent(logic *selectedModelChannel, rerank *selectedModelChannel, createdBy int64) model.Agent {
	settings := map[string]interface{}{
		"opening_statement": "你好 ，我是初始化企业助手。无论你有什么问题，我都会尽我所能为你提供帮助和支持。",
		"suggested_questions": []map[string]string{
			{"id": "MSwrfQVqhH", "content": "最近几年哪几个行业的前景不错？"},
			{"id": "wAs9shG51z", "content": "说说AI行业的发展趋势和重要事件"},
		},
		"out_of_range_reply": map[string]interface{}{
			"enable": true,
			"reply":  "当前问题可能因内容未收录、解析中或权限限制无法解答。",
			"mode":   "fixed_reply",
			"prompt": "你是一个专业、友好的AI助手。现在用户提出的问题超出了你的知识库范围，你需要生成一个礼貌且有帮助的回复。\n\n## 回复要求\n- 诚实承认你无法提供准确答案\n- 简洁友好，不要过度道歉\n- 可以提供相关的建议或替代方案\n- 回复控制在50字以内\n- 使用礼貌、专业的语气\n\n## Few-shot示例\n用户问题: 今天杭州西湖的游客数量是多少?\n回复: 抱歉，我无法获取实时的杭州西湖游客数据。您可以通过杭州旅游官网或相关APP查询这一信息。\n",
		},
		"rerank_config": buildDefaultRerankConfig(0.5, 20, true, true, rerank),
		"question_rewrite_config": map[string]interface{}{
			"enable": false,
		},
		"web_search_setting": map[string]interface{}{
			"enable":              false,
			"platform_setting_id": "",
			"platform_key":        "",
			"top_k":               20,
		},
		"graph_search_setting": map[string]interface{}{
			"enable":         true,
			"default_enable": false,
		},
		"answer_preference_config": map[string]interface{}{
			"enable":  false,
			"content": "",
		},
		"answer_remarks_config": map[string]interface{}{
			"enable":  false,
			"content": "",
		},
		"fast_reasoning_config": map[string]interface{}{
			"enable":       true,
			"channel_id":   logic.ChannelID,
			"channel_type": logic.ChannelType,
			"model_name":   logic.ModelName,
			"temperature":  0.7,
		},
		"deep_thinking_config": map[string]interface{}{
			"enable":       false,
			"channel_id":   0,
			"channel_type": 0,
			"model_name":   "",
			"temperature":  0.7,
		},
	}

	return model.Agent{
		Name:         "AI 搜问",
		Logo:         "",
		Sort:         0,
		Description:  "",
		ChannelType:  logic.ChannelType,
		Model:        logic.ModelName,
		Prompt:       "",
		Configs:      `{"completion_params":{"temperature":0.2,"top_p":0.75,"presence_penalty":0.5,"frequency_penalty":0.5}}`,
		Tools:        `[]`,
		GroupID:      0,
		UseCases:     `[]`,
		CreatedBy:    createdBy,
		CustomConfig: `{"agent_type":"prompt","provider_id":0,"channel_id":0,"channel_config":{},"file_parse":{"enable":false},"image_parse":{"enable":false},"agent_mode":"chat"}`,
		Settings:     mustMarshalJSONString(settings),
		Enable:       true,
		AgentType:    model.AgentTypeApp,
		AgentUsage:   model.AgentUsageSearch,
		OwnerID:      model.AgentOwnerEnterprise,
	}
}

func buildDocumentAppAgent(logic *selectedModelChannel, rerank *selectedModelChannel, createdBy int64) model.Agent {
	settings := map[string]interface{}{
		"opening_statement":   "你好，我是深圳客优云信息有限公司助手。无论你有什么问题，我都会尽我所能为你提供帮助和支持。",
		"suggested_questions": []interface{}{},
		"out_of_range_reply": map[string]interface{}{
			"enable": false,
			"reply":  "当前问题可能因内容未收录、解析中或权限限制无法解答。",
		},
		"rerank_config": buildDefaultRerankConfig(0.8, 10, false, false, rerank),
		"question_rewrite_config": map[string]interface{}{
			"enable": false,
		},
		"web_search_setting": map[string]interface{}{
			"enable":              false,
			"platform_setting_id": "",
			"platform_key":        "",
			"top_k":               20,
		},
		"generate_summary": map[string]interface{}{
			"enable": false,
		},
		"generate_suggested_questions": map[string]interface{}{
			"enable": false,
		},
		"fast_reasoning_config": map[string]interface{}{
			"enable":       true,
			"channel_id":   logic.ChannelID,
			"channel_type": logic.ChannelType,
			"model_name":   logic.ModelName,
			"temperature":  0.7,
		},
		"deep_thinking_config": map[string]interface{}{
			"enable":       false,
			"channel_id":   0,
			"channel_type": 0,
			"model_name":   "",
			"temperature":  0.7,
		},
	}

	return model.Agent{
		Name:         "文档应用",
		Logo:         "",
		Sort:         0,
		Description:  "",
		ChannelType:  logic.ChannelType,
		Model:        logic.ModelName,
		Prompt:       "",
		Configs:      `{"completion_params":{"temperature":0.2,"top_p":0.75,"presence_penalty":0.5,"frequency_penalty":0.5}}`,
		Tools:        `[]`,
		GroupID:      0,
		UseCases:     `[]`,
		CreatedBy:    createdBy,
		CustomConfig: `{"agent_type":"prompt","provider_id":0,"channel_id":0,"channel_config":{},"file_parse":{"enable":false},"image_parse":{"enable":false},"agent_mode":"chat"}`,
		Settings:     mustMarshalJSONString(settings),
		Enable:       true,
		AgentType:    model.AgentTypeApp,
		AgentUsage:   model.AgentUsageFileChat,
		OwnerID:      model.AgentOwnerEnterprise,
	}
}

func buildKnowledgeMapAgent(logic *selectedModelChannel, createdBy int64) model.Agent {
	settings := map[string]interface{}{
		"auto_generate_map_config": map[string]interface{}{
			"enable":  false,
			"content": "",
		},
		"fast_reasoning_config": map[string]interface{}{
			"enable":       true,
			"channel_id":   logic.ChannelID,
			"channel_type": logic.ChannelType,
			"model_name":   logic.ModelName,
			"temperature":  0.7,
		},
		"opening_statement": "你好，我是知识地图助手。",
		"out_of_range_reply": map[string]interface{}{
			"enable": false,
		},
	}

	customConfig := map[string]interface{}{
		"agent_type":     "prompt",
		"provider_id":    0,
		"channel_id":     logic.ChannelID,
		"channel_config": map[string]interface{}{},
		"agent_mode":     "chat",
		"file_parse": map[string]interface{}{
			"enable": false,
		},
		"image_parse": map[string]interface{}{
			"enable": false,
		},
	}

	return model.Agent{
		Name:         "知识地图",
		Logo:         "",
		Sort:         0,
		Description:  "",
		ChannelType:  logic.ChannelType,
		Model:        logic.ModelName,
		Prompt:       "",
		Configs:      `{"completion_params":{"temperature":0.2,"top_p":0.75,"presence_penalty":0.5,"frequency_penalty":0.5}}`,
		Tools:        `[]`,
		GroupID:      0,
		UseCases:     `[]`,
		CreatedBy:    createdBy,
		CustomConfig: mustMarshalJSONString(customConfig),
		Settings:     mustMarshalJSONString(settings),
		Enable:       true,
		AgentType:    model.AgentTypeApp,
		AgentUsage:   model.AgentUsageKnowledgeMap,
		OwnerID:      model.AgentOwnerEnterprise,
	}
}

func buildDefaultRerankConfig(scoreThreshold float64, topK int, scoreThresholdEnabled bool, rerankingEnable bool, rerank *selectedModelChannel) map[string]interface{} {
	config := map[string]interface{}{
		"fulltext":                false,
		"hybrid":                  false,
		"rerank_model":            "reranking_model",
		"score_threshold":         scoreThreshold,
		"top_k":                   topK,
		"vector":                  true,
		"rerank_channel_id":       0,
		"rerank_model_name":       "",
		"reranking_enable":        rerankingEnable,
		"score_threshold_enabled": scoreThresholdEnabled,
		"weights": map[string]interface{}{
			"keyword_setting": map[string]interface{}{
				"keyword_weight": 1,
			},
			"vector_setting": map[string]interface{}{
				"vector_weight": 0,
			},
		},
	}

	if rerank != nil {
		config["rerank_channel_id"] = rerank.ChannelID
		config["rerank_model_name"] = rerank.ModelName
	}

	return config
}

func mustMarshalJSONString(v interface{}) string {
	bytes, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(bytes)
}

func splitChannelModelNames(models string) []string {
	parts := strings.Split(models, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		name := strings.TrimSpace(part)
		if name != "" {
			result = append(result, name)
		}
	}
	return result
}

func ensureDefaultSpaceResources(tx *gorm.DB, enterprise *model.Enterprise, adminUser *model.User) error {
	var count int64
	if err := tx.Model(&model.Space{}).
		Where("eid = ? AND is_default = ?", enterprise.Eid, true).
		Count(&count).Error; err != nil {
		return err
	}

	if count > 0 {
		return nil
	}

	return model.InitializeSpaces(enterprise, adminUser, tx)
}

func ensureDefaultPromptGroupsAndPrompts(tx *gorm.DB, eid int64, createdBy int64) error {
	if tx == nil {
		return errors.New("db is nil")
	}

	for _, groupSeed := range defaultPromptGroupSeeds {
		if err := ensureDefaultPromptGroupAndPrompts(tx, eid, createdBy, groupSeed); err != nil {
			return err
		}
	}

	return nil
}

func ensureDefaultAILinks(tx *gorm.DB, eid int64, createdBy int64) error {
	if tx == nil {
		return errors.New("db is nil")
	}

	var group model.Group
	err := tx.Where("eid = ? AND group_type = ?", eid, model.AI_LINKS_TYPE).First(&group).Error
	if err == nil {
		logger.Debugf(nil, "【企业初始化】AI链接分组已存在，跳过: eid=%d, group_id=%d", eid, group.GroupId)
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	group = model.Group{
		Eid:       eid,
		CreatedBy: createdBy,
		GroupName: "默认",
		GroupType: model.AI_LINKS_TYPE,
		Sort:      0,
	}
	if err := tx.Create(&group).Error; err != nil {
		return err
	}

	internalGroupIDs, err := getEnterpriseInternalUserGroupIDs(tx, eid, createdBy)
	if err != nil {
		return err
	}
	if len(internalGroupIDs) == 0 {
		logger.Debugf(nil, "【企业初始化】AI链接权限跳过: eid=%d, group_id=%d, 原因=未找到内部用户默认分组", eid, group.GroupId)
		return nil
	}

	defaultLinks := map[string]model.AILinkInfo{}
	for _, groupInfo := range model.GetDefaultGroupData() {
		for _, link := range groupInfo.Links {
			defaultLinks[link.Name] = link
		}
	}

	for _, linkName := range defaultAILinkGroupSeedNames {
		linkInfo, ok := defaultLinks[linkName]
		if !ok {
			return errors.New("default ai link data missing: " + linkName)
		}

		aiLink := model.AILink{
			Eid:           eid,
			GroupID:       group.GroupId,
			Name:          linkInfo.Name,
			Logo:          linkInfo.Logo,
			URL:           linkInfo.URL,
			Description:   linkInfo.Description,
			Sort:          linkInfo.Sort,
			CreatedBy:     createdBy,
			SharedAccount: "",
		}
		if err := tx.Create(&aiLink).Error; err != nil {
			return err
		}

		for _, groupID := range internalGroupIDs {
			permission := model.ResourcePermission{
				GroupID:      groupID,
				ResourceID:   aiLink.ID,
				ResourceType: model.ResourceTypeAILink,
				Permission:   model.PermissionRead,
			}
			if err := tx.Create(&permission).Error; err != nil {
				return err
			}
		}

		logger.Debugf(nil, "【企业初始化】AI链接创建成功: eid=%d, group_id=%d, ai_link_id=%d, name=%s", eid, group.GroupId, aiLink.ID, aiLink.Name)
	}

	return nil
}

func getEnterpriseInternalUserGroupIDs(tx *gorm.DB, eid int64, createdBy int64) ([]int64, error) {
	if tx == nil {
		return nil, errors.New("db is nil")
	}

	var groups []model.Group
	if err := tx.Where("eid = ? AND group_type = ?", eid, model.INTERNAL_USER_GROUP_TYPE).
		Order("sort desc, group_id asc").
		Find(&groups).Error; err != nil {
		return nil, err
	}

	if len(groups) == 0 {
		group := model.Group{
			Eid:       eid,
			CreatedBy: createdBy,
			GroupName: "默认",
			GroupType: model.INTERNAL_USER_GROUP_TYPE,
			Sort:      0,
		}
		if err := tx.Create(&group).Error; err != nil {
			return nil, err
		}
		return []int64{group.GroupId}, nil
	}

	groupIDs := make([]int64, 0, len(groups))
	for _, group := range groups {
		groupIDs = append(groupIDs, group.GroupId)
	}
	return groupIDs, nil
}

func ensureDefaultPromptGroupAndPrompts(tx *gorm.DB, eid int64, createdBy int64, seed defaultPromptGroupSeed) error {
	var group model.Group
	err := tx.Where("eid = ? AND group_type = ?", eid, seed.GroupType).First(&group).Error
	if err == nil {
		logger.Debugf(nil, "【企业初始化】提示词分组已存在，跳过: eid=%d, group_type=%d, group_id=%d", eid, seed.GroupType, group.GroupId)
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	group = model.Group{
		Eid:       eid,
		CreatedBy: createdBy,
		GroupName: "默认",
		GroupType: seed.GroupType,
		Sort:      0,
	}
	if err := tx.Create(&group).Error; err != nil {
		return err
	}

	logger.Debugf(nil, "【企业初始化】提示词分组创建成功: eid=%d, group_type=%d, group_id=%d", eid, seed.GroupType, group.GroupId)

	for _, promptSeed := range seed.Prompts {
		if err := createDefaultPromptWithGroup(tx, eid, createdBy, group.GroupId, promptSeed); err != nil {
			return err
		}
	}

	return nil
}

func ensureDefaultSystemPromptGroupAndPrompts(tx *gorm.DB, eid int64, createdBy int64) error {
	var group model.Group
	err := tx.Where("eid = ? AND group_type = ?", eid, model.SYSTEM_PROMPT_TYPE).First(&group).Error
	if err == nil {
		logger.Debugf(nil, "【企业初始化】系统提示词分组已存在，跳过: eid=%d, group_id=%d", eid, group.GroupId)
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	group = model.Group{
		Eid:       eid,
		CreatedBy: createdBy,
		GroupName: "默认",
		GroupType: model.SYSTEM_PROMPT_TYPE,
		Sort:      0,
	}
	if err := tx.Create(&group).Error; err != nil {
		return err
	}

	internalGroupIDs, err := getEnterpriseInternalUserGroupIDs(tx, eid, createdBy)
	if err != nil {
		return err
	}

	linksJSON, err := json.Marshal(defaultSystemPromptAILinks)
	if err != nil {
		return err
	}

	logger.Debugf(nil, "【企业初始化】系统提示词分组创建成功: eid=%d, group_id=%d", eid, group.GroupId)

	for _, promptSeed := range defaultSystemPromptSeeds {
		if err := createDefaultPromptWithGroups(tx, eid, createdBy, group.GroupId, internalGroupIDs, promptSeed, string(linksJSON)); err != nil {
			return err
		}
	}

	return nil
}

func createDefaultPromptWithGroups(tx *gorm.DB, eid int64, createdBy int64, groupID int64, additionalGroupIDs []int64, seed defaultPromptSeed, linksJSON string) error {
	prompt := model.Prompt{
		Name:         seed.Name,
		Logo:         "",
		Content:      seed.Content,
		Description:  seed.Description,
		Type:         model.PromptTypeSystem,
		Status:       model.PromptStatusNormal,
		UserID:       createdBy,
		Eid:          eid,
		Sort:         seed.Sort,
		CustomConfig: "{\"use_cases\":[]}",
		AILinks:      linksJSON,
	}
	if err := tx.Create(&prompt).Error; err != nil {
		return err
	}

	groupIDs := make([]int64, 0, 1+len(additionalGroupIDs))
	groupIDs = append(groupIDs, groupID)
	groupIDs = append(groupIDs, additionalGroupIDs...)

	seen := make(map[int64]struct{}, len(groupIDs))
	for _, gid := range groupIDs {
		if gid <= 0 {
			continue
		}
		if _, ok := seen[gid]; ok {
			continue
		}
		seen[gid] = struct{}{}

		permission := model.ResourcePermission{
			GroupID:      gid,
			ResourceID:   prompt.PromptID,
			ResourceType: model.ResourceTypePrompt,
			Permission:   model.PermissionRead,
		}
		if err := tx.Create(&permission).Error; err != nil {
			return err
		}
	}

	logger.Debugf(nil, "【企业初始化】系统提示词创建成功: eid=%d, group_id=%d, prompt_id=%d, name=%s", eid, groupID, prompt.PromptID, prompt.Name)
	return nil
}

func createDefaultPromptWithGroup(tx *gorm.DB, eid int64, createdBy int64, groupID int64, seed defaultPromptSeed) error {
	logo := seed.LogoPath
	if logo != "" {
		logo = config.GetApiHost() + logo
	}

	prompt := model.Prompt{
		Name:         seed.Name,
		Logo:         logo,
		Content:      seed.Content,
		Description:  seed.Description,
		Type:         model.PromptTypeSystem,
		Status:       model.PromptStatusNormal,
		UserID:       createdBy,
		Eid:          eid,
		Sort:         seed.Sort,
		CustomConfig: "",
		AILinks:      "[]",
	}
	if err := tx.Create(&prompt).Error; err != nil {
		return err
	}

	permission := model.ResourcePermission{
		GroupID:      groupID,
		ResourceID:   prompt.PromptID,
		ResourceType: model.ResourceTypePrompt,
		Permission:   model.PermissionRead,
	}
	if err := tx.Create(&permission).Error; err != nil {
		return err
	}

	logger.Debugf(nil, "【企业初始化】提示词创建成功: eid=%d, group_id=%d, prompt_id=%d, name=%s", eid, groupID, prompt.PromptID, prompt.Name)
	return nil
}

func ensureDefaultGraphTemplate(tx *gorm.DB, eid int64) (*model.GraphTemplate, error) {
	return ensureSeededGraphTemplates(tx, eid)
}

// EnsureDefaultRagPipelineAndStrategy ensures the default pipeline and routing strategy exist.
func EnsureDefaultRagPipelineAndStrategy(tx *gorm.DB, eid int64) error {
	if tx == nil {
		return errors.New("db is nil")
	}

	const defaultPipelineName = "默认流水线"
	const defaultStrategyName = "默认策略"
	const defaultStrategyPriority = 9999

	defaultGraphTemplate, err := ensureDefaultGraphTemplate(tx, eid)
	if err != nil {
		return err
	}
	defaultGraphTemplateHashID, err := hashids.Encode(defaultGraphTemplate.ID)
	if err != nil {
		return err
	}

	var pipeline model.RagPipelineProfile
	if err := tx.Where("eid = ? AND name = ?", eid, defaultPipelineName).First(&pipeline).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		profile := map[string]interface{}{
			"steps": []map[string]interface{}{
				{
					"run_mode": "auto",
					"step_key": "document_parsing",
					"config": map[string]interface{}{
						"engine":                  "markitdown",
						"enable_smart_match":      false,
						"match_preference_prompt": "",
					},
				},
				{
					"run_mode": "auto",
					"step_key": "document_chunking",
					"config": map[string]interface{}{
						"chunk_type":              "default",
						"enable_smart_match":      true,
						"match_preference_prompt": "",
						"parent_chunk": map[string]interface{}{
							"mode":             "custom",
							"strategy":         "identifier",
							"identifier_level": "h2",
							"max_length":       2048,
							"append_filename":  true,
							"append_title":     true,
							"append_subtitle":  true,
						},
						"child_chunk": map[string]interface{}{
							"mode":             "custom",
							"strategy":         "length",
							"identifier_level": "h3",
							"max_length":       512,
						},
						"index_enhancement": map[string]interface{}{
							"metadata_injection": map[string]interface{}{
								"append_filename": true,
								"append_title":    true,
								"append_subtitle": true,
							},
							"generative_enhancement": map[string]interface{}{
								"generate_summary": true,
								"generate_faq":     true,
							},
						},
					},
				},
				{
					"run_mode": "auto",
					"step_key": "vector_indexing",
					"config":   map[string]interface{}{},
				},
				{
					"run_mode": "auto",
					"step_key": "summary_generation",
					"config": map[string]interface{}{
						"summary_faq": map[string]interface{}{
							"enabled": true,
						},
						"knowledge_map": map[string]interface{}{
							"enabled": false,
						},
						"entity_extraction": map[string]interface{}{
							// 默认关闭，避免与 graph_generation 的实体抽取重复消耗 token
							"enabled": false,
						},
					},
				},
				{
					"run_mode": "auto",
					"step_key": "graph_generation",
					"config": map[string]interface{}{
						"graph_template_id":       defaultGraphTemplateHashID,
						"enable_smart_match":      false,
						"enable_smart_generation": false,
					},
				},
			},
		}

		profileBytes, err := json.Marshal(profile)
		if err != nil {
			return err
		}

		pipeline = model.RagPipelineProfile{
			Eid:         eid,
			Name:        defaultPipelineName,
			Icon:        "",
			Status:      model.RagPipelineStatusEnabled,
			ProfileJSON: string(profileBytes),
		}
		if err := tx.Create(&pipeline).Error; err != nil {
			return err
		}
	}

	var strategy model.RagRoutingStrategy
	if err := tx.Where("eid = ? AND name = ?", eid, defaultStrategyName).First(&strategy).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		strategy = model.RagRoutingStrategy{
			Eid:            eid,
			Name:           defaultStrategyName,
			Icon:           "",
			Priority:       defaultStrategyPriority,
			Enabled:        true,
			IsDefault:      true,
			PipelineID:     pipeline.ID,
			Logic:          model.RagRoutingLogicAnd,
			ConditionsJSON: "",
		}
		if err := tx.Create(&strategy).Error; err != nil {
			return err
		}
	}

	return nil
}
