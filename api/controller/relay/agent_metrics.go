package relay

import (
	"sync"

	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

const agentRunMetricsContextKey = "agent_run_metrics"
const agentRunMetricsEventType = "agent.metrics"

// agentRunMetrics accumulates only run-local counters. Its snapshot is appended
// to the existing AgentRun event stream and never changes the client SSE shape.
type agentRunMetrics struct {
	mu sync.Mutex

	turnCount                int
	toolCallCount            int
	toolArgumentInvalidCount int
	toolDedupHit             int
	toolResultTruncated      int
	providerRetryAttempts    int
	emptyResponseCorrection  int
	maxTurnsReached          bool
	completionOK             bool
	completionSource         string
	failureReason            string
	dimensions               map[string]interface{}
}

func newAgentRunMetrics(dimensions ...map[string]interface{}) *agentRunMetrics {
	m := &agentRunMetrics{}
	if len(dimensions) > 0 && dimensions[0] != nil {
		m.dimensions = make(map[string]interface{}, len(dimensions[0]))
		for key, value := range dimensions[0] {
			m.dimensions[key] = value
		}
	}
	return m
}

func newAgentRunMetricsDimensions(agent *model.Agent, skillName, modelName string, flags agentToolFeatureFlags) map[string]interface{} {
	flagValues := map[string]bool{
		"tool_pipeline": flags.ToolPipeline, "tool_input_guard": flags.ToolInputGuard,
		"unified_tool_result": flags.UnifiedToolResult, "structured_provider_retry": flags.StructuredProviderRetry,
		"completion_policy": flags.CompletionPolicy, "read_continuation": flags.ReadContinuation,
		"argument_adapter": flags.ArgumentAdapter, "edit_v2": flags.EditV2,
		"edit_normalized_match": flags.EditNormalizedMatch, "edit_batch": flags.EditBatch,
		"shell_output_v2": flags.ShellOutputV2,
	}
	dimensions := map[string]interface{}{
		"skill_name": skillName, "model": modelName, "flags": flagValues,
	}
	if agent != nil {
		dimensions["enterprise_id"] = agent.Eid
		dimensions["agent_id"] = agent.AgentID
	}
	return dimensions
}

func agentRunMetricsFromGin(c *gin.Context) *agentRunMetrics {
	if c == nil {
		return nil
	}
	value, exists := c.Get(agentRunMetricsContextKey)
	if !exists {
		return nil
	}
	metrics, _ := value.(*agentRunMetrics)
	return metrics
}

func (m *agentRunMetrics) setTurnCount(value int)  { m.update(func() { m.turnCount = value }) }
func (m *agentRunMetrics) incToolCall()            { m.update(func() { m.toolCallCount++ }) }
func (m *agentRunMetrics) incToolArgumentInvalid() { m.update(func() { m.toolArgumentInvalidCount++ }) }
func (m *agentRunMetrics) incToolDedupHit()        { m.update(func() { m.toolDedupHit++ }) }
func (m *agentRunMetrics) incToolResultTruncated() { m.update(func() { m.toolResultTruncated++ }) }
func (m *agentRunMetrics) incProviderRetry()       { m.update(func() { m.providerRetryAttempts++ }) }
func (m *agentRunMetrics) incEmptyResponseCorrection() {
	m.update(func() { m.emptyResponseCorrection++ })
}
func (m *agentRunMetrics) complete(source string) {
	m.update(func() { m.completionOK, m.completionSource, m.failureReason = true, source, "" })
}
func (m *agentRunMetrics) fail(reason string) { m.update(func() { m.failureReason = reason }) }
func (m *agentRunMetrics) markMaxTurnsReached() {
	m.update(func() { m.maxTurnsReached = true })
}

func (m *agentRunMetrics) update(apply func()) {
	if m == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	apply()
}

func (m *agentRunMetrics) snapshot() map[string]interface{} {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return map[string]interface{}{
		"skill.turn_count":                  m.turnCount,
		"skill.completion_ok":               m.completionOK,
		"skill.completion_source":           m.completionSource,
		"skill.failure_reason":              m.failureReason,
		"skill.tool_call_count":             m.toolCallCount,
		"skill.tool_argument_invalid_count": m.toolArgumentInvalidCount,
		"skill.tool_dedup_hit":              m.toolDedupHit,
		"skill.tool_result_truncated":       m.toolResultTruncated,
		"skill.provider_retry_attempts":     m.providerRetryAttempts,
		"skill.empty_response_correction":   m.emptyResponseCorrection,
		"skill.max_turns_reached":           m.maxTurnsReached,
		"skill.final_answer_missing":        !m.completionOK,
		// Stable rollout-facing aliases. The skill.* counters remain for
		// backwards-compatible dashboards, while these keys form the Gate query
		// contract and are emitted even when their value is zero.
		"tool.argument_invalid":                m.toolArgumentInvalidCount,
		"tool.arg_alias_adapter_hit":           0,
		"tool.edit.not_found":                  0,
		"tool.edit.not_unique":                 0,
		"tool.edit.normalized_match_hit":       0,
		"tool.result_pair_missing":             0,
		"provider.retry_attempts":              m.providerRetryAttempts,
		"provider.stream_incomplete":           boolToMetricCount(m.failureReason == "provider_stream_incomplete"),
		"tool.side_effect_duplicate_suspected": m.toolDedupHit,
	}
}

func boolToMetricCount(value bool) int {
	if value {
		return 1
	}
	return 0
}

func (m *agentRunMetrics) persist(c *gin.Context, requestID string) {
	metrics := m.snapshot()
	if len(metrics) == 0 {
		return
	}
	mirrorAgentRunTimelineEvent(c, requestID, agentRunMetricsEventType, map[string]interface{}{
		"object": "agent.metrics", "metrics": metrics, "dimensions": m.dimensions, "version": 1,
	})
}
