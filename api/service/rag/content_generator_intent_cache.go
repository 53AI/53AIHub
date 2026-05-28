package rag

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/skill"
)

const (
	intentClassificationCachePrefix  = "Cache:rag:intent_classification"
	intentClassificationCacheVersion = "v1"
	fastIntentRouteCachePrefix       = "Cache:rag:fast_intent_route"
	fastIntentRouteCacheVersion      = "v1"
	queryExpansionCachePrefix        = "Cache:rag:query_expansion"
	queryExpansionCacheVersion       = "v1"
	intentClassificationCacheTTL     = 2 * time.Hour
)

var intentClassificationSingleflight singleflightGroup
var queryExpansionSingleflight singleflightGroup

type intentClassificationCacheSkillSnapshot struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type intentClassificationCachePayload struct {
	Version            string                                   `json:"version"`
	EID                int64                                    `json:"eid"`
	AgentID            int64                                    `json:"agent_id"`
	AgentUpdatedTime   int64                                    `json:"agent_updated_time"`
	ConfigID           int64                                    `json:"config_id"`
	ConfigType         string                                   `json:"config_type"`
	ConfigUpdatedTime  int64                                    `json:"config_updated_time"`
	ChannelID          int64                                    `json:"channel_id"`
	ChannelUpdatedTime int64                                    `json:"channel_updated_time"`
	ModelName          string                                   `json:"model_name"`
	TimeBucket         string                                   `json:"time_bucket"`
	Query              string                                   `json:"query"`
	Conversation       []ConversationItem                       `json:"conversation"`
	Skills             []intentClassificationCacheSkillSnapshot `json:"skills"`
}

func init() {
	intentClassificationSingleflight = newSyncSingleflight()
	queryExpansionSingleflight = newSyncSingleflight()
}

func buildIntentClassificationCacheKey(
	eid int64,
	agent *model.Agent,
	config *ChunkConfig,
	request *IntentClassificationRequest,
	availableSkills []*skill.Skill,
	selectedChannel *model.Channel,
	selectedModelName string,
) string {
	fingerprint := buildIntentTaskCacheFingerprint(
		intentClassificationCacheVersion,
		eid,
		agent,
		config,
		request,
		availableSkills,
		selectedChannel,
		selectedModelName,
		time.Now().Format("2006-01-02-15"),
	)
	if fingerprint == "" {
		return ""
	}
	return fmt.Sprintf("%s:eid:%d:hash:%s", intentClassificationCachePrefix, eid, fingerprint)
}

func buildFastIntentRouteCacheKey(
	eid int64,
	agent *model.Agent,
	config *ChunkConfig,
	request *IntentClassificationRequest,
	availableSkills []*skill.Skill,
	selectedChannel *model.Channel,
	selectedModelName string,
) string {
	fingerprint := buildIntentTaskCacheFingerprint(
		fastIntentRouteCacheVersion,
		eid,
		agent,
		config,
		request,
		availableSkills,
		selectedChannel,
		selectedModelName,
		time.Now().Format("2006-01-02-15"),
	)
	if fingerprint == "" {
		return ""
	}
	return fmt.Sprintf("%s:eid:%d:hash:%s", fastIntentRouteCachePrefix, eid, fingerprint)
}

func buildQueryExpansionCacheKey(
	eid int64,
	agent *model.Agent,
	config *ChunkConfig,
	request *IntentClassificationRequest,
	selectedChannel *model.Channel,
	selectedModelName string,
) string {
	fingerprint := buildIntentTaskCacheFingerprint(
		queryExpansionCacheVersion,
		eid,
		agent,
		config,
		request,
		nil,
		selectedChannel,
		selectedModelName,
		time.Now().Format("2006-01-02-15"),
	)
	if fingerprint == "" {
		return ""
	}
	return fmt.Sprintf("%s:eid:%d:hash:%s", queryExpansionCachePrefix, eid, fingerprint)
}

func buildIntentClassificationCacheFingerprint(
	eid int64,
	agent *model.Agent,
	config *ChunkConfig,
	request *IntentClassificationRequest,
	availableSkills []*skill.Skill,
	selectedChannel *model.Channel,
	selectedModelName string,
	timeBucket string,
) string {
	return buildIntentTaskCacheFingerprint(
		intentClassificationCacheVersion,
		eid,
		agent,
		config,
		request,
		availableSkills,
		selectedChannel,
		selectedModelName,
		timeBucket,
	)
}

func buildIntentTaskCacheFingerprint(
	cacheVersion string,
	eid int64,
	agent *model.Agent,
	config *ChunkConfig,
	request *IntentClassificationRequest,
	availableSkills []*skill.Skill,
	selectedChannel *model.Channel,
	selectedModelName string,
	timeBucket string,
) string {
	if eid <= 0 || agent == nil || config == nil || request == nil || selectedChannel == nil || strings.TrimSpace(selectedModelName) == "" || strings.TrimSpace(timeBucket) == "" {
		return ""
	}

	skillSnapshots := make([]intentClassificationCacheSkillSnapshot, 0, len(availableSkills))
	for _, item := range availableSkills {
		if item == nil {
			continue
		}
		skillSnapshots = append(skillSnapshots, intentClassificationCacheSkillSnapshot{
			Name:        strings.TrimSpace(item.Name),
			Description: strings.TrimSpace(item.Description),
		})
	}

	payload := intentClassificationCachePayload{
		Version:            cacheVersion,
		EID:                eid,
		AgentID:            agent.AgentID,
		AgentUpdatedTime:   agent.UpdatedTime,
		ConfigID:           config.ID,
		ConfigType:         config.Type,
		ConfigUpdatedTime:  config.UpdatedTime,
		ChannelID:          selectedChannel.ChannelID,
		ChannelUpdatedTime: selectedChannel.UpdatedTime,
		ModelName:          strings.TrimSpace(selectedModelName),
		TimeBucket:         timeBucket,
		Query:              strings.TrimSpace(request.Query),
		Conversation:       request.Conversation,
		Skills:             skillSnapshots,
	}

	cacheBytes, err := json.Marshal(payload)
	if err != nil {
		logger.Warnf(context.Background(), "【缓存】序列化意图分类缓存指纹失败: eid=%d, err=%v", eid, err)
		return ""
	}

	sum := sha256.Sum256(cacheBytes)
	return hex.EncodeToString(sum[:])
}

func (s *ContentGeneratorService) getCachedIntentClassification(ctx context.Context, cacheKey string) (*IntentClassificationResult, bool) {
	if cacheKey == "" || !common.IsRedisEnabled() {
		return nil, false
	}

	cacheValue, err := common.RedisGet(cacheKey)
	if err != nil {
		if errors.Is(err, common.ErrRedisNil) || errors.Is(err, common.ErrRedisNotEnabled) {
			return nil, false
		}
		logger.Warnf(ctx, "【缓存】读取意图分类缓存失败: key=%s, err=%v", cacheKey, err)
		return nil, false
	}
	if cacheValue == "" {
		return nil, false
	}

	var result IntentClassificationResult
	if err := json.Unmarshal([]byte(cacheValue), &result); err != nil {
		logger.Warnf(ctx, "【缓存】解析意图分类缓存失败: key=%s, err=%v", cacheKey, err)
		return nil, false
	}

	if strings.TrimSpace(result.Intent) == "" {
		return nil, false
	}

	logger.Debugf(ctx, "【缓存】意图分类缓存命中: key=%s", cacheKey)
	return &result, true
}

func (s *ContentGeneratorService) setCachedIntentClassification(ctx context.Context, cacheKey string, result *IntentClassificationResult) {
	if cacheKey == "" || result == nil || !common.IsRedisEnabled() {
		return
	}

	cacheBytes, err := json.Marshal(result)
	if err != nil {
		logger.Warnf(ctx, "【缓存】序列化意图分类结果失败: key=%s, err=%v", cacheKey, err)
		return
	}

	if err := common.RedisSet(cacheKey, string(cacheBytes), intentClassificationCacheTTL); err != nil {
		if errors.Is(err, common.ErrRedisNotEnabled) {
			return
		}
		logger.Warnf(ctx, "【缓存】写入意图分类缓存失败: key=%s, err=%v", cacheKey, err)
	}
}

func (s *ContentGeneratorService) getOrBuildCachedIntentClassification(
	ctx context.Context,
	cacheKey string,
	build func() (*IntentClassificationResult, error),
) (*IntentClassificationResult, error) {
	if cacheKey == "" {
		return build()
	}

	if cachedResult, hit := s.getCachedIntentClassification(ctx, cacheKey); hit {
		return cachedResult, nil
	}

	result, err := intentClassificationSingleflight.Do(cacheKey, func() (interface{}, error) {
		if cachedResult, hit := s.getCachedIntentClassification(ctx, cacheKey); hit {
			return cachedResult, nil
		}

		builtResult, buildErr := build()
		if buildErr != nil {
			return nil, buildErr
		}

		s.setCachedIntentClassification(ctx, cacheKey, builtResult)
		return builtResult, nil
	})
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, nil
	}

	cachedResult, ok := result.(*IntentClassificationResult)
	if !ok {
		return nil, fmt.Errorf("意图分类缓存返回类型异常: %T", result)
	}
	return cachedResult, nil
}

func (s *ContentGeneratorService) getCachedQueryExpansion(ctx context.Context, cacheKey string) (*QueryExpansionResult, bool) {
	if cacheKey == "" || !common.IsRedisEnabled() {
		return nil, false
	}

	cacheValue, err := common.RedisGet(cacheKey)
	if err != nil {
		if errors.Is(err, common.ErrRedisNil) || errors.Is(err, common.ErrRedisNotEnabled) {
			return nil, false
		}
		logger.Warnf(ctx, "【缓存】读取复杂问题拆解缓存失败: key=%s, err=%v", cacheKey, err)
		return nil, false
	}
	if cacheValue == "" {
		return nil, false
	}

	var result QueryExpansionResult
	if err := json.Unmarshal([]byte(cacheValue), &result); err != nil {
		logger.Warnf(ctx, "【缓存】解析复杂问题拆解缓存失败: key=%s, err=%v", cacheKey, err)
		return nil, false
	}

	if strings.TrimSpace(result.NormalizedQuery) == "" && len(result.ExpandedQueries) == 0 {
		return nil, false
	}

	logger.Debugf(ctx, "【缓存】复杂问题拆解缓存命中: key=%s", cacheKey)
	return &result, true
}

func (s *ContentGeneratorService) setCachedQueryExpansion(ctx context.Context, cacheKey string, result *QueryExpansionResult) {
	if cacheKey == "" || result == nil || !common.IsRedisEnabled() {
		return
	}

	cacheBytes, err := json.Marshal(result)
	if err != nil {
		logger.Warnf(ctx, "【缓存】序列化复杂问题拆解结果失败: key=%s, err=%v", cacheKey, err)
		return
	}

	if err := common.RedisSet(cacheKey, string(cacheBytes), intentClassificationCacheTTL); err != nil {
		if errors.Is(err, common.ErrRedisNotEnabled) {
			return
		}
		logger.Warnf(ctx, "【缓存】写入复杂问题拆解缓存失败: key=%s, err=%v", cacheKey, err)
	}
}

func (s *ContentGeneratorService) getOrBuildCachedQueryExpansion(
	ctx context.Context,
	cacheKey string,
	build func() (*QueryExpansionResult, error),
) (*QueryExpansionResult, error) {
	if cacheKey == "" {
		return build()
	}

	if cachedResult, hit := s.getCachedQueryExpansion(ctx, cacheKey); hit {
		return cachedResult, nil
	}

	result, err := queryExpansionSingleflight.Do(cacheKey, func() (interface{}, error) {
		if cachedResult, hit := s.getCachedQueryExpansion(ctx, cacheKey); hit {
			return cachedResult, nil
		}

		builtResult, buildErr := build()
		if buildErr != nil {
			return nil, buildErr
		}

		s.setCachedQueryExpansion(ctx, cacheKey, builtResult)
		return builtResult, nil
	})
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, nil
	}

	cachedResult, ok := result.(*QueryExpansionResult)
	if !ok {
		return nil, fmt.Errorf("复杂问题拆解缓存返回类型异常: %T", result)
	}
	return cachedResult, nil
}
