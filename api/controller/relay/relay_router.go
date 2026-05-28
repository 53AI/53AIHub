package relay

import (
	"context"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/53AI/53AIHub/service/skill"
)

func (rr *RelayRouter) LevelSkillRouter() *RouterResult {
	query := rr.MS.OriginalQuestion
	if rr.MS.RewrittenQuestion != "" {
		query = rr.MS.RewrittenQuestion
	}

	scope := skill.BuildDefaultRunScope()
	if rr.MS != nil && rr.MS.SkillRunScope != nil {
		scope = *rr.MS.SkillRunScope
	}
	match := skill.GetManager().MatchSkillWithScope(rr.MS.AgentModel.Eid, query, scope)
	if match != nil {
		return &RouterResult{
			Err:       nil,
			ReplyStop: false,
			Content:   "",
			IntentClassificationResult: &rag.IntentClassificationResult{
				Intent:     "SKILL_AGENT",
				Confidence: match.Score,
				Keywords:   []string{match.Skill.Name},
			},
			Skill: match.Skill,
		}
	}
	return nil
}

func (rr *RelayRouter) PresetAnswer() *RouterResult {
	// 从 MessageStatsInfo.OriginalQuestion 中获取原始问题
	question := rr.MS.OriginalQuestion

	// 检查是否有预设答案
	if answer, exists := presetAnswers[question]; exists {
		return &RouterResult{
			Err:       nil,
			ReplyStop: true, // 停止后续处理，直接返回给用户
			Content:   answer,
		}
	}

	// 没有匹配的预设答案，返回 nil 表示继续正常处理流程
	return nil
}

func NewRelayRouter(cr *ChatRequest, ms *MessageStatsInfo) *RelayRouter {
	return &RelayRouter{
		CR: cr,
		MS: ms,
	}
}

/*
*
逻辑：
●正则匹配：比如用户输入 "你好"、"帮助"、"清除上下文"，直接返回前端 UI 需要的指令或写死的回复。
●缓存命中：计算 Query 的 Hash，查 Redis。如果这个问题 10 分钟前有人问过，直接把上次生成的最终答案吐出来（特别是对于企业规章制度类的问题，答案是固定的）。
*/
func (rr *RelayRouter) Level1Router() *RouterResult {
	// 处理预设回答，预设的配置明前还没确定
	if presetResult := rr.PresetAnswer(); presetResult != nil {
		return presetResult
	}
	// todo Cache Router

	return nil
}

// 第二层是一个类似于 53AI Studio的语义记忆的额外的小向量库，进行匹配问答
func (rr *RelayRouter) Level2Router() *RouterResult {
	// todo Knowledge Base Router
	return nil
}

// L3 小模型意图识别 (智能决策)
func (rr *RelayRouter) Level3Router() *RouterResult {
	// 使用改写后的问题进行意图分类
	query := rr.MS.RewrittenQuestion
	if query == "" {
		query = rr.MS.OriginalQuestion
	}

	if query == "" {
		return nil // 没有问题可分类
	}

	ctx := context.Background()
	eid := rr.MS.AgentModel.Eid

	// 获取 ChunkConfig
	configService := rag.NewChunkConfigService(model.DB)
	chunkConfig, err := configService.GetConfig(eid, nil, model.ChunkTypeDefault)
	if err != nil || chunkConfig == nil {
		logger.Warnf(ctx, "Failed to get chunk config: %v", err)
		return nil
	}

	// 构建意图分类请求（对话历史暂时为空）
	request := &rag.IntentClassificationRequest{
		Query:        query,
		Conversation: []rag.ConversationItem{}, // 暂时不使用对话历史
	}

	// 调用意图分类服务
	contentGenerator := rag.NewContentGeneratorService(model.DB)
	// 修正：调用GenerateIntentClassification时需要传入nil或空技能列表，
	// 因为 Level3Router 是在这里被调用的，但逻辑已经移到了 relay.go 主流程中。
	// 然而，如果这里还在被使用，我们需要保持兼容。
	// 为了避免循环依赖或者逻辑混乱，这里我们传入空的技能列表，因为Level3Router主要用于RAG/Chitchat分类
	// 实际的Skill路由已经在 relay.go 中处理了。

	scope := skill.BuildDefaultRunScope()
	if rr.MS != nil && rr.MS.SkillRunScope != nil {
		scope = *rr.MS.SkillRunScope
	}
	availableSkills := buildIntentSkillCandidates(rr.MS.AgentModel, rr.CR, buildIntentSkillCandidateQuery(query, request.Conversation), scope, nil)

	result, err := contentGenerator.GenerateFastIntentRoute(ctx, eid, chunkConfig, request, availableSkills, rr.MS.AgentModel)
	if err != nil {
		logger.Warnf(ctx, "Intent classification failed: %v", err)
		return nil // 分类失败，继续默认流程
	}
	if result != nil && result.Intent == "COMPLEX_AGENT" {
		expansionQuery := strings.TrimSpace(result.NormalizedQuery)
		if expansionQuery == "" {
			expansionQuery = query
		}
		expansion, expansionErr := contentGenerator.GenerateComplexQueryExpansion(ctx, eid, chunkConfig, &rag.IntentClassificationRequest{
			Query:        expansionQuery,
			Conversation: request.Conversation,
		}, rr.MS.AgentModel)
		if expansionErr != nil {
			logger.Warnf(ctx, "Query expansion failed: %v", expansionErr)
		} else {
			mergeComplexQueryExpansionResult(result, expansion)
		}
	}

	if rr.MS != nil && result != nil {
		if normalizedQuery := strings.TrimSpace(result.NormalizedQuery); normalizedQuery != "" {
			rr.MS.RewrittenQuestion = normalizedQuery
		}
	}

	logger.Infof(ctx, "Intent classification result: %s (confidence: %.2f)", result.Intent, result.Confidence)

	// 根据意图进行路由
	switch result.Intent {
	case "CHITCHAT":
		if result.Answer == "" {
			return nil
		}
		// 生成闲聊回复
		return &RouterResult{
			Err:                        nil,
			ReplyStop:                  true,
			Content:                    result.Answer,
			IntentClassificationResult: result,
		}
	case "SIMPLE_RAG", "COMPLEX_AGENT":
		return &RouterResult{
			Err:                        nil,
			ReplyStop:                  false,
			Content:                    "",
			IntentClassificationResult: result,
		}
	default:
		// 未知意图，继续默认流程
		return nil
	}
}
