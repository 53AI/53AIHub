package rag

import (
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

const (
	REDIS_KEY_CONTEXT_MESSAGE_TEMPLATE = "53AIKM_agent_context_message_template"

	BASE_PROMPT = `
# 用户消息为：
{{query}}

# 助理
{{context}}

在我给你的搜索结果中:
- 将获得一组与该问题相关的上下文，每个上下文都以参考编号开头，例如 [Source:x-y]，请使用上下文进行参考作答。 
- 如果一句话源自多个上下文，请列出所有相关的引用编号，例如：[Source:x-y][Source:x-y]。切记不要将引用集中在最后返回引用编号，而是在答案对应部分列出。
- ***引用编号应尽可能地返回***，但请勿重复上下文。
- 引用编号格式固定为 [Source:x-y]，请勿自行修改。

在回答时，请注意以下几点：
- 你是由 53AI 精心打造。
- 输出格式为 ***Markdown***。
- 今天是{{time}}。
- 公式格式：如果你的回答需要使用公式，请在公式前后标注"$"符号。
- 内容筛选：并非搜索结果的所有内容都与用户的问题密切相关，你需要结合问题，对搜索结果进行甄别、筛选。
- 回答时严格基于搜索结果：请严格围绕材料信息作答，禁止结合无关信息进行回答。你的回答必须完全且仅基于提供的搜索结果内容。
  - 禁止过度推理/强化表述：禁止对搜索结果内容进行超出原文表述范围的推断、总结或升华。
  - 禁止自行添加例子/细节：禁止添加搜索结果中未明确提及的具体例子、细节或属性。
  - 禁止添加背景/目的/关联：禁止添加搜索结果中未明确提及的背景信息、目的说明、原因分析、影响评估或与其他事物的关联信息。
  - 禁止引入外部知识：绝对禁止使用你在预训练或微调阶段学习到的、未在当前搜索结果中出现的任何知识或常识来补充答案。
- 特殊问题回答格式
  - 对于列举类的问题（如列举所有航班信息），尽量将答案控制在10个要点以内，并告诉用户可以查看搜索来源、获得完整信息。优先提供信息完整、最相关的列举项；不要主动告诉用户搜索结果未提供的内容。
  - 对于创作类的问题（如写论文），请务必在正文的段落中引用对应的参考编号，格式固定为[Source:x-y]。
- 结构化与可读性：
  - 如果回答很长，请尽量结构化、分段落总结。如果需要分点作答，尽量控制在5个点以内，并合并相关的内容。
  - 你需要根据用户要求和回答内容选择合适、美观的回答格式，确保可读性强。
  - 你的回答应该综合多个相关知识点来回答，不能重复引用一个知识点。
- 语言一致性：除非用户要求，否则你回答的语言需要和用户提问的语言保持一致。
- 图片嵌入与内容呈现形式：如果知识点中存在图片，请在合适的地方使用 markdown 语法 ![标题](url) 嵌入相应的图片，不能自己编造知识点中没有的链接。
- 图片确保上下文关联：在撰写每个段落时，主动检查是否有对应的图片可以嵌入。图片应紧随其最相关的内容之后，起到图文并茂、相互印证的作用。如果没有图片链接，不能编造。
- 知识库拒答判断
  - 当所有搜索结果未直接提及问题中所依赖主体信息时，你的回答必须包含：“根据搜索结果，知识库中未直接提及”，然后结束你的回答。不要尝试提供替代信息、相关案例或任何其他内容，也不要分析可能的原因。
  - 不要结合无关信息或你自己的知识进行回答。
`
)

// ChatService 聊天服务接口（简化实现）
type ChatService struct {
	db *gorm.DB
}

// NewChatService 创建聊天服务实例
func NewChatService(db *gorm.DB) *ChatService {
	return &ChatService{db: db}
}

// replaceTemplateVars 替换模板变量
func replaceTemplateVars(prompt string, context, query string) string {
	result := strings.ReplaceAll(prompt, "{{context}}", context)
	result = strings.ReplaceAll(result, "{{query}}", query)
	result = strings.ReplaceAll(result, "{{time}}", time.Now().Format("2006-01-02 15:04:05"))
	return result
}

// ChatRequest 聊天请求
type ChatRequest struct {
	Messages    []ChatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
	MaxTokens   int           `json:"max_tokens"`
	Stream      bool          `json:"stream"`
}

// ChatMessage 聊天消息
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatResponse 聊天响应
type ChatResponse struct {
	Choices []ChatChoice `json:"choices"`
	Usage   ChatUsage    `json:"usage"`
}

// ChatChoice 聊天选择
type ChatChoice struct {
	Message ChatMessage `json:"message"`
}

// ChatUsage Token使用情况
type ChatUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// Chat 执行聊天（简化实现）
func (s *ChatService) Chat(eid int64, channel *model.Channel, req *ChatRequest) (*ChatResponse, error) {
	// 这里应该调用实际的聊天API，现在返回模拟响应
	response := &ChatResponse{
		Choices: []ChatChoice{
			{
				Message: ChatMessage{
					Role:    "assistant",
					Content: "基于提供的文档内容，我可以为您解答相关问题。请注意，我的回答仅基于给定的文档信息。",
				},
			},
		},
		Usage: ChatUsage{
			PromptTokens:     len(req.Messages[0].Content) / 4, // 简化的token计算
			CompletionTokens: 50,
			TotalTokens:      len(req.Messages[0].Content)/4 + 50,
		},
	}

	return response, nil
}

// QAService RAG问答服务
type QAService struct {
	db            *gorm.DB
	searchService *SearchService
	chatService   *ChatService
	rerankService *RerankService // 新增
}

// NewQAService 创建RAG问答服务实例
func NewQAService(db *gorm.DB) *QAService {
	return &QAService{
		db:            db,
		searchService: NewSearchService(db),
		chatService:   NewChatService(db),
		rerankService: NewRerankService(db), // 初始化RerankService
	}
}

// QARequest RAG问答请求
type QARequest struct {
	Question       string                  `json:"question" binding:"required"`
	LibraryIDs     []int64                 `json:"library_ids,omitempty"`
	ConversationID *int64                  `json:"conversation_id,omitempty"`
	SearchConfig   *model.SearchConfigData `json:"search_config,omitempty"`
	ContextLength  int                     `json:"context_length,omitempty"`
	IncludeSources bool                    `json:"include_sources"`
	StreamResponse bool                    `json:"stream_response"`
	Temperature    float64                 `json:"temperature,omitempty"`
	MaxTokens      int                     `json:"max_tokens,omitempty"`
}

// QAResponse RAG问答响应
type QAResponse struct {
	Answer           string               `json:"answer"`
	Sources          []SourceReference    `json:"sources,omitempty"`
	SearchResults    []QASearchResultItem `json:"search_results,omitempty"`
	ProcessingTime   int64                `json:"processing_time_ms"`
	TokenUsage       *TokenUsageInfo      `json:"token_usage,omitempty"`
	Confidence       float64              `json:"confidence"`
	RetrievalContext string               `json:"retrieval_context,omitempty"`
}

// SourceReference 引用来源
type SourceReference struct {
	ReferenceID   string  `json:"reference_id"`
	ChunkID       int64   `json:"chunk_id"`
	FileID        int64   `json:"file_id"`
	FileName      string  `json:"file_name"`
	ChunkType     string  `json:"chunk_type"`
	Content       string  `json:"content"`
	Score         float64 `json:"score"`
	StartPosition int     `json:"start_position,omitempty"`
	EndPosition   int     `json:"end_position,omitempty"`
	URL           string  `json:"url,omitempty"`
	FilePath      string  `json:"file_path,omitempty"`
	// 新增字段：知识库信息
	KnowledgeBaseID   int64  `json:"knowledge_base_id"`   // 知识库ID
	KnowledgeBaseName string `json:"knowledge_base_name"` // 知识库名称
	KnowledgeBaseLogo string `json:"knowledge_base_logo"` // 知识库logo
	LibraryID         string `json:"library_id,omitempty"`
	LibraryName       string `json:"library_name,omitempty"`
	LibraryIcon       string `json:"library_icon,omitempty"`
	// 新增字段：文件创建时间
	FileCreatedAt int64  `json:"file_created_at"` // 文件创建时间（Unix毫秒时间戳）
	SourceKey     string `json:"source_key"`      // 来源key
	// 新增字段：空间信息
	SpaceID   string `json:"space_id"`   // 空间ID
	SpaceName string `json:"space_name"` // 空间名称

	// 图谱聚合结构化结果
	EntityCount                  int                  `json:"entity_count,omitempty"`
	EntitySupportingChunkCount   int                  `json:"entity_supporting_chunk_count,omitempty"`
	RelationSupportingChunkCount int                  `json:"relation_supporting_chunk_count,omitempty"`
	SupportingChunkCountTotal    int                  `json:"supporting_chunk_count_total,omitempty"`
	Graph                        *GraphAggregateGraph `json:"graph,omitempty"`
}

// GraphAggregateGraph 图谱聚合结果的结构化图数据
type GraphAggregateGraph struct {
	Entities  []*GraphAggregateGraphEntity   `json:"entities"`
	Relations []*GraphAggregateGraphRelation `json:"relations"`
}

// GraphAggregateGraphEntity 图谱聚合节点数据
type GraphAggregateGraphEntity struct {
	ID          string            `json:"id"`
	Type        string            `json:"type"`
	Name        string            `json:"name"`
	Properties  map[string]string `json:"properties"`
	ChunkIDs    []string          `json:"chunk_ids"`
	CreatedTime int64             `json:"created_time"`
}

// GraphAggregateGraphRelation 图谱聚合边数据
type GraphAggregateGraphRelation struct {
	ID             string   `json:"id"`
	SourceEntityID string   `json:"source_entity_id"`
	TargetEntityID string   `json:"target_entity_id"`
	Predicate      string   `json:"predicate"`
	ChunkIDs       []string `json:"chunk_ids"`
	CreatedTime    int64    `json:"created_time"`
}

// QASearchResultItem 问答搜索结果项
type QASearchResultItem struct {
	ChunkID     int64                  `json:"chunk_id"`
	Content     string                 `json:"content"`
	Score       float64                `json:"score"`
	ChunkType   string                 `json:"chunk_type"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
	Highlighted string                 `json:"highlighted,omitempty"`
}

// TokenUsageInfo Token使用信息
type TokenUsageInfo struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// GetContextMessage 构建包含上下文和问题的完整提示词
func GetContextMessage(context, question string) string {
	if context == "" {
		// 如果没有上下文，只返回问题
		return question
	}
	// 从 redis 中获取上下文prompt
	// 如果没有则使用默认的prompt
	template, err := common.RedisGet(REDIS_KEY_CONTEXT_MESSAGE_TEMPLATE)
	if err != nil || template == "" {
		template = BASE_PROMPT
	}

	return replaceTemplateVars(template, context, question)
}
