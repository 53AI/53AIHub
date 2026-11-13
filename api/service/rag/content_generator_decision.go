package rag

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/decision"
	"github.com/53AI/53AIHub/service/skill"
	"gorm.io/gorm"
)

// Decision routing is enabled only by the enterprise site model configuration.
// Existing agent-level intent_decision_config values are intentionally ignored.
func loadIntentDecisionSettings(db *gorm.DB, eid int64) (*model.IntentDecisionConfig, error) {
	var setting model.ChunkSetting
	err := db.Select("model_config_json").Where("eid = ? AND library_id IS NULL AND type = ?", eid, model.ChunkTypeDefault).
		Order("id ASC").First(&setting).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	modelConfig, err := setting.GetModelConfig()
	if err != nil {
		return nil, err
	}
	cfg := modelConfig.IntentDecision
	if cfg == nil || !cfg.Enable {
		return nil, nil
	}
	if cfg.ChannelID <= 0 || strings.TrimSpace(cfg.ModelName) == "" {
		return nil, fmt.Errorf("decision model is not configured")
	}
	if cfg.ConfidenceThreshold == 0 {
		cfg.ConfidenceThreshold = 0.85
	}
	if cfg.ConfidenceThreshold < 0.5 || cfg.ConfidenceThreshold > 1 {
		return nil, fmt.Errorf("invalid decision threshold")
	}
	return cfg, nil
}

func eligibleForDecisionIntent(request *IntentClassificationRequest, skills []*skill.Skill) bool {
	// These tasks require the richer LLM fields or access to previous turns.
	return request != nil && strings.TrimSpace(request.Query) != "" && len(request.Conversation) == 0 &&
		len(request.AttachmentTypes) == 0 && len(skills) == 0 && len([]rune(request.Query)) <= 500 &&
		!requiresEnhancedIntent(request.Query)
}

// Document titles and field names can themselves be quoted; only instructions
// need to be outside quotes to count as the current user's request.
func requiresEnhancedIntent(query string) bool {
	if hasNegatedEnhancedIntent(query) {
		return false
	}
	question := strings.ToLower(query)
	if containsIntentTerm(question, "报告", "合同", "说明书", "制度", "文档", "文件") &&
		containsIntentTerm(question, "型号", "参数", "数值", "字段", "条款") {
		return true
	}
	return hasExplicitEnhancedIntent(query)
}

func hasExplicitEnhancedIntent(query string) bool {
	if hasNegatedEnhancedIntent(query) {
		return false
	}
	question := unquotedIntentQuestion(query)
	return containsIntentTerm(question, "请", "要求", "强制", "必须", "需要", "使用", "进行", "执行") &&
		containsIntentTerm(question, "复杂", "多轮", "加强") && containsIntentTerm(question, "rag", "搜索", "检索")
}

func hasNegatedEnhancedIntent(query string) bool {
	question := unquotedIntentQuestion(query)
	if !containsIntentTerm(question, "rag", "搜索", "检索") {
		return false
	}
	for _, negative := range []string{"不要", "不需要", "不必", "禁止", "无需", "不用"} {
		for _, action := range []string{"", "用", "使用", "进行", "执行", "强制使用"} {
			if containsIntentTerm(question, negative+action+"复杂", negative+action+"多轮", negative+action+"加强") {
				return true
			}
		}
	}
	return false
}

func unquotedIntentQuestion(query string) string {
	var unquoted strings.Builder
	var closing rune
	for _, r := range query {
		if closing != 0 {
			if r == closing {
				closing = 0
			}
			continue
		}
		switch r {
		case '"':
			closing = '"'
		case '“':
			closing = '”'
		case '‘':
			closing = '’'
		case '「':
			closing = '」'
		default:
			unquoted.WriteRune(r)
		}
	}
	return strings.ToLower(unquoted.String())
}

func containsIntentTerm(question string, terms ...string) bool {
	for _, term := range terms {
		if strings.Contains(question, term) {
			return true
		}
	}
	return false
}

func (s *ContentGeneratorService) tryDecisionIntent(ctx context.Context, eid int64, request *IntentClassificationRequest, skills []*skill.Skill) (*IntentClassificationResult, bool) {
	if !eligibleForDecisionIntent(request, skills) {
		return nil, false
	}
	cfg, err := loadIntentDecisionSettings(s.chatService.db, eid)
	if err != nil {
		logger.Warnf(ctx, "decision intent config invalid: %v", err)
		return nil, false
	}
	if cfg == nil {
		logger.Debugf(ctx, "decision intent skipped: reason=disabled_or_not_configured eid=%d", eid)
		return nil, false
	}
	if !decision.IsAvailable(cfg.ChannelID) {
		logger.Warnf(ctx, "decision intent fallback: reason=channel_cooldown channel_id=%d", cfg.ChannelID)
		return nil, false
	}
	channel, err := model.GetChannelByID(cfg.ChannelID)
	if err != nil || channel == nil || channel.Eid != eid || (channel.Type != model.ChannelApiTypeTypeSafeDecision && channel.Type != 17) ||
		channel.Status != model.ChannelStatusEnabled ||
		(channel.Type == 17 && !decision.IsBailianDecisionModel(channel.CustomConfig, cfg.ModelName)) ||
		(channel.Type == model.ChannelApiTypeTypeSafeDecision && !hasDecisionModel(channel.Models, cfg.ModelName)) {
		logger.Warnf(ctx, "decision channel unavailable, fallback: eid=%d channel_id=%d", eid, cfg.ChannelID)
		return nil, false
	}
	callCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	criteria := map[string]string{
		"CHITCHAT":      "Everyday greetings, thanks, smalltalk with no enterprise knowledge need",
		"SIMPLE_RAG":    "One concrete question requiring enterprise records, single-fact knowledge retrieval",
		"COMPLEX_AGENT": "Multi-document synthesis, planning, comparison, complex reasoning or analysis",
		"STATS_COUNT":   "Counting or listing matching files or documents across a knowledge base",
		"USE_SKILL":     "Request to explicitly run a named automation, skill or tool",
	}
	logger.Infof(ctx, "decision intent request: eid=%d channel_id=%d model=%s", eid, cfg.ChannelID, cfg.ModelName)
	started := time.Now()
	reply, callErr := (&decision.Client{}).Evaluate(callCtx, channel, cfg.ModelName, request.Query, map[string]decision.Question{
		"intent": {Type: "choice", Instructions: "Classify the user's request for enterprise knowledge routing. Select exactly one intent. Prefer SIMPLE_RAG if uncertain.", Criteria: criteria},
	})
	decision.RecordResult(cfg.ChannelID, callErr)
	elapsedMs := time.Since(started).Milliseconds()
	if callErr != nil {
		reason := "api_error"
		if errors.Is(callErr, context.DeadlineExceeded) || errors.Is(callErr, context.Canceled) {
			reason = "timeout_or_canceled"
		}
		logger.Warnf(ctx, "decision intent fallback: reason=%s channel_id=%d elapsed_ms=%d err=%v", reason, cfg.ChannelID, elapsedMs, callErr)
		return nil, false
	}
	answer := reply.Answers["intent"]
	confidence := "missing"
	if answer.Confidence != nil {
		confidence = fmt.Sprintf("%.3f", *answer.Confidence)
	}
	outcome := "accepted"
	// Complex routes still need LLM-generated artifacts. For CHITCHAT the
	// response model supplies the answer, instead of the intent classifier.
	if answer.Choice != "SIMPLE_RAG" && answer.Choice != "CHITCHAT" {
		outcome = "non_simple_intent"
	} else if answer.Confidence == nil {
		outcome = "missing_confidence"
	} else if *answer.Confidence < cfg.ConfidenceThreshold {
		outcome = "below_threshold"
	}
	logger.Infof(ctx, "decision intent result: channel_id=%d model=%s choice=%s confidence=%s threshold=%.3f elapsed_ms=%d outcome=%s", cfg.ChannelID, cfg.ModelName, answer.Choice, confidence, cfg.ConfidenceThreshold, elapsedMs, outcome)
	if outcome != "accepted" {
		return nil, false
	}
	return &IntentClassificationResult{
		Intent: answer.Choice, Confidence: *answer.Confidence, NormalizedQuery: strings.TrimSpace(request.Query),
		Keywords: nil, DocumentType: "", Reasoning: "decision:jev",
	}, true
}

func hasDecisionModel(models, name string) bool {
	for _, value := range strings.Split(models, ",") {
		if strings.TrimSpace(value) == name {
			return true
		}
	}
	return false
}
