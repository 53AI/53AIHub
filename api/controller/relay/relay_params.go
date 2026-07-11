package relay

import (
	"encoding/json"
	"errors"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

// ProcessRequestParams 处理请求参数，包括参数解析、验证和转换
func ProcessRequestParams(c *gin.Context, body []byte) ([]byte, *model.Agent, error) {
	// 先获取 agent 信息来判断类型
	agent, err := GetSessionAgent(c)
	if err != nil {
		return nil, nil, err
	}

	// 检查是否为工作流类型的 agent
	if agent.AgentType == model.AgentTypeWorkflow {
		return nil, nil, errors.New("工作流类型的 Agent 请使用 /v1/workflow/run 接口")
	}

	// 解析请求体为 map 以便处理参数
	var rawMap map[string]interface{}
	if err := json.Unmarshal(body, &rawMap); err != nil {
		return nil, nil, errors.New("无法解析请求体")
	}

	if agent.IsOpenClawWSCompatible() {
		processedBody, err := json.Marshal(rawMap)
		if err != nil {
			return nil, nil, errors.New("处理参数时发生内部错误")
		}
		return processedBody, agent, nil
	}

	// 处理 conversation_id 参数转换
	if err := processConversationID(rawMap); err != nil {
		return nil, nil, err
	}

	// 处理 message_file_id 参数转换
	if err := processMessageFileID(rawMap); err != nil {
		return nil, nil, err
	}

	// 重新序列化处理后的请求体
	processedBody, err := json.Marshal(rawMap)
	if err != nil {
		return nil, nil, errors.New("处理参数时发生内部错误")
	}

	return processedBody, agent, nil
}

// processConversationID 处理 conversation_id 参数的类型转换
func processConversationID(rawMap map[string]interface{}) error {
	convID, ok := rawMap["conversation_id"]
	if !ok || convID == nil {
		return nil
	}

	var convIDInt int64
	switch convIDVal := convID.(type) {
	case string:
		// 如果是字符串，尝试使用hashids解密
		id, err := hashids.TryParseID(convIDVal)
		if err != nil {
			return errors.New("conversation_id格式无效")
		}
		convIDInt = id
	case float64:
		// JSON中的数字默认是float64类型
		convIDInt = int64(convIDVal)
	case int64:
		convIDInt = convIDVal
	default:
		return errors.New("conversation_id格式无效")
	}

	// 更新解析后的值
	rawMap["conversation_id"] = convIDInt
	return nil
}

// processMessageFileID 处理 message_file_id 参数的类型转换
func processMessageFileID(rawMap map[string]interface{}) error {
	messageFileID, ok := rawMap["message_file_id"]
	if !ok || messageFileID == nil {
		return nil
	}

	var messageFileIDInt int64
	switch messageFileIDVal := messageFileID.(type) {
	case string:
		// 如果是字符串，尝试使用hashids解密
		id, err := hashids.TryParseID(messageFileIDVal)
		if err != nil {
			return errors.New("message_file_id格式无效")
		}
		messageFileIDInt = id
	case float64:
		// JSON中的数字默认是float64类型
		messageFileIDInt = int64(messageFileIDVal)
	case int64:
		messageFileIDInt = messageFileIDVal
	default:
		return errors.New("message_file_id格式无效")
	}

	// 更新解析后的值
	rawMap["message_file_id"] = messageFileIDInt
	return nil
}

func SetUpStreamResponseHeaders(c *gin.Context) {
	if c.Writer.Header().Get("Content-Type") == "" {
		h := c.Writer.Header()
		h.Set("Content-Type", "text/event-stream; charset=utf-8")
		h.Set("Cache-Control", "no-cache")
		h.Set("Connection", "keep-alive")
		h.Set("X-Accel-Buffering", "no")
	}
}

// RAG查询来源为全网搜索
func (cr *ChatRequest) DatasetIsWebSearch() bool {
	if cr == nil {
		logger.SysLogf("[网络搜索] 请求级开关判定：ChatRequest 为空，默认关闭")
		return false
	}

	enabled := cr.WebSearchConfig != nil && cr.WebSearchConfig.Enable
	if cr.WebSearchConfig == nil {
		logger.SysLogf("[网络搜索] 请求级开关判定：未设置 web_search_config，默认关闭")
		return false
	}

	logger.SysLogf(
		"[网络搜索] 请求级开关判定：enable=%t，platform_key=%s，platform_setting_id=%s，判定结果=%t",
		cr.WebSearchConfig.Enable,
		cr.WebSearchConfig.PlatformKey,
		cr.WebSearchConfig.PlatformSettingID,
		enabled,
	)
	return enabled
}

// RAG查询来源为知识库或文件或空间
func (cr *ChatRequest) DatasetIsKnowledgeBase() bool {
	return len(cr.KnowledgeBaseIDs) > 0 || len(cr.FileIDs) > 0 || len(cr.SpaceIDs) > 0
}

// RAG查询来源为单文件
func (cr *ChatRequest) DatasetIsSoloFile() bool {
	return cr.SoloFileMode && len(cr.FileIDs) == 1
}
