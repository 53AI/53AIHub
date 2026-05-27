package hashids

import (
	"strings"
)

// IDFieldMatcher ID字段匹配器
type IDFieldMatcher struct {
	exactPatterns   []string // 精确匹配的字段名
	suffixPatterns  []string // 后缀匹配的模式
	excludePatterns []string // 排除的字段名
}

// DefaultIDFieldMatcher 默认的ID字段匹配器
var DefaultIDFieldMatcher = &IDFieldMatcher{
	exactPatterns: []string{
		"id",
		// "user_id",
		// "userId",
		// "agent_id",
		// "agentId",
		"conversation_id",
		"conversationId",
		"resource_ids",
		"message_ids",
		// "channel_id",
		// "channelId",
		// "group_id",
		// "groupId",
		// "enterprise_id",
		// "enterpriseId",
		"eid",
		// "workspace_id",
		// "workspaceId",
		"space_id",
		"spaceId",
		"library_id",
		"libraryId",
		"file_id",
		"fileId",
		"resource_id",
		"resourceId",
		"file_body_id",
		"permission_id",
		"permission_ids",
		"knowledge_id",
		"chunk_id",
		"sandbox_output_file_id",
		// "did", // department id
		// "pid", // prompt id
		// "nav_id",
		// "navId",
		// "order_id",
		// "orderId",
		// "bot_id",
		// "botId",
		// "parent_id",
		// "parentId",
		// "creator_id",
		// "creatorId",
		// "owner_id",
		// "ownerId",
		"message_id",
		"job_id",
		"jobId",
		"origin_ref_id",
		"originRefId",
		"pipeline_id",
		"pipelineId",
		"strategy_id",
		"strategyId",
		"strategy_ids",
		"strategyIds",
		"related_id",
		"relatedId",
		"binding_id",
	},
	suffixPatterns: []string{
		// "_id",
		// "Id",
	},
	excludePatterns: []string{
		"valid",
		"uuid",
		"guid",
		"password",
		"token",
		"key",
		"secret",
	},
}

// IsIDField 判断字段是否为ID类型字段
func (m *IDFieldMatcher) IsIDField(fieldName string) bool {
	if fieldName == "" {
		return false
	}

	fieldLower := strings.ToLower(fieldName)

	// 检查排除列表
	for _, exclude := range m.excludePatterns {
		if strings.Contains(fieldLower, exclude) {
			return false
		}
	}

	// 精确匹配
	for _, pattern := range m.exactPatterns {
		if fieldLower == strings.ToLower(pattern) {
			return true
		}
	}

	// 后缀匹配
	for _, suffix := range m.suffixPatterns {
		if strings.HasSuffix(fieldLower, strings.ToLower(suffix)) {
			return true
		}
	}

	return false
}

// IsIDParam 判断路由参数是否为ID类型参数（兼容原有接口）
func (m *IDFieldMatcher) IsIDParam(paramName string) bool {
	return m.IsIDField(paramName)
}

// 全局便捷函数
func IsIDField(fieldName string) bool {
	return DefaultIDFieldMatcher.IsIDField(fieldName)
}

func IsIDParam(paramName string) bool {
	return DefaultIDFieldMatcher.IsIDParam(paramName)
}

// AddIDPattern 添加自定义ID字段模式
func AddIDPattern(pattern string) {
	DefaultIDFieldMatcher.exactPatterns = append(DefaultIDFieldMatcher.exactPatterns, pattern)
}

// AddIDSuffixPattern 添加自定义ID后缀模式
func AddIDSuffixPattern(suffix string) {
	DefaultIDFieldMatcher.suffixPatterns = append(DefaultIDFieldMatcher.suffixPatterns, suffix)
}

// AddExcludePattern 添加排除模式
func AddExcludePattern(pattern string) {
	DefaultIDFieldMatcher.excludePatterns = append(DefaultIDFieldMatcher.excludePatterns, pattern)
}
