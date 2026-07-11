package controller

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

// UserMemoryUpdateRequest 用户可编辑字段的更新请求
//
// smart_memory 和 custom_memory 都接受两种格式：
//  1. 纯文本：每行一条记忆（推荐，对应前端 textarea 输入）
//  2. JSON 数组字符串：MemoryItem[] 序列化结果（兼容结构化输入）
//
// 后端自动识别格式：以 [ 开头视为 JSON，否则按行解析为 MemoryItem。
type UserMemoryUpdateRequest struct {
	SmartMemory  string `json:"smart_memory" example:"我是一名位于纽约市的分析师，主要从事 React 和 SQL"`
	CustomMemory string `json:"custom_memory" example:"简洁直接。除非另行说明，默认使用 Python"`
}

// UserMemoryMergeRequest 增量合并记忆请求
type UserMemoryMergeRequest struct {
	SmartMemoryItems  []model.MemoryItem `json:"smart_memory_items"`
	CustomMemoryItems []model.MemoryItem `json:"custom_memory_items"`
}

// @Summary 获取个人全局记忆
// @Description 获取当前用户的全局记忆（包含系统只读信息：昵称、部门，和用户可编辑记忆）
// @Tags UserMemory
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=model.UserMemoryResponse} "成功返回记忆数据，无记录时返回空对象"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/memory [get]
func GetMyMemory(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	svc := service.NewUserMemoryService()
	resp, err := svc.GetUserMemoryWithSystemInfo(c, eid, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if resp == nil {
		resp = &model.UserMemoryResponse{}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(resp))
}

// @Summary 更新个人全局记忆（用户可编辑部分）
// @Description 全量替换用户的智能记忆和自定义记忆。系统信息（昵称、部门）不可编辑，实时从用户信息读取。
// @Tags UserMemory
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body UserMemoryUpdateRequest true "记忆数据"
// @Success 200 {object} model.CommonResponse{data=model.UserMemoryResponse} "成功返回更新后的记忆"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/memory [put]
func UpdateMyMemory(c *gin.Context) {
	var req UserMemoryUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	memory, err := model.GetUserMemory(eid, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if memory == nil {
		memory = &model.UserMemory{
			Eid:    eid,
			UserID: userID,
		}
	}

	var warning string
	if model.ContainsSensitiveInfo(req.SmartMemory) || model.ContainsSensitiveInfo(req.CustomMemory) {
		warning = "记忆内容包含敏感信息（API Key/密码/身份证/银行卡号等），已自动脱敏处理"
	}

	smartItems, err := parseMemoryInputItems(req.SmartMemory, "user_input")
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("smart_memory 格式错误: "+err.Error()))
		return
	}
	customItems, err := parseMemoryInputItems(req.CustomMemory, "user_input")
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("custom_memory 格式错误: "+err.Error()))
		return
	}

	existingSmartItems, _ := memory.GetSmartMemoryItems()
	existingCustomItems, _ := memory.GetCustomMemoryItems()
	if err := memory.SetSmartMemoryItems(model.MergeMemoryItemsForReplacement(existingSmartItems, smartItems)); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}
	if err := memory.SetCustomMemoryItems(model.MergeMemoryItemsForReplacement(existingCustomItems, customItems)); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if err := memory.Upsert(); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}
	service.InvalidateUserMemoryCache(eid)

	svc := service.NewUserMemoryService()

	nickname, department := svc.GetUserSystemInfo(c, eid, userID)
	resp := model.Success.ToResponse(memory.ToResponse(nickname, department))
	if warning != "" {
		resp = model.Success.ToResponseWithWarning(memory.ToResponse(nickname, department), warning)
	}
	c.JSON(http.StatusOK, resp)
}

// @Summary 增量合并个人全局记忆
// @Description 增量追加新的记忆条目到智能记忆或自定义记忆，按 fact 去重。
// @Tags UserMemory
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body UserMemoryMergeRequest true "要追加的记忆条目"
// @Success 200 {object} model.CommonResponse{data=model.UserMemoryResponse} "成功返回合并后的记忆"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/memory/merge [post]
func MergeMyMemory(c *gin.Context) {
	var req UserMemoryMergeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var warning string
	if model.ItemsContainSensitiveInfo(req.SmartMemoryItems) || model.ItemsContainSensitiveInfo(req.CustomMemoryItems) {
		warning = "记忆内容包含敏感信息（API Key/密码/身份证/银行卡号等），已自动脱敏处理"
	}

	if len(req.SmartMemoryItems) > 0 {
		model.NormalizeItemsSource(req.SmartMemoryItems, "user_input")
		if err := model.MergeSmartMemory(eid, userID, req.SmartMemoryItems); err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	if len(req.CustomMemoryItems) > 0 {
		model.NormalizeItemsSource(req.CustomMemoryItems, "user_input")
		if err := model.MergeCustomMemory(eid, userID, req.CustomMemoryItems); err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	service.InvalidateUserMemoryCache(eid)

	svc := service.NewUserMemoryService()
	resp, err := svc.GetUserMemoryWithSystemInfo(c, eid, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	r := model.Success.ToResponse(resp)
	if warning != "" {
		r = model.Success.ToResponseWithWarning(resp, warning)
	}
	c.JSON(http.StatusOK, r)
}

// @Summary 删除单条智能记忆
// @Description 删除指定索引位置的智能记忆条目
// @Tags UserMemory
// @Produce json
// @Security BearerAuth
// @Param index path int true "记忆条目索引（从0开始）"
// @Success 200 {object} model.CommonResponse{data=model.UserMemoryResponse} "成功返回更新后的记忆"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 404 {object} model.CommonResponse "索引超出范围"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/memory/smart-memory/{index} [delete]
func DeleteSmartMemoryItem(c *gin.Context) {
	index, err := strconv.Atoi(c.Param("index"))
	if err != nil || index < 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	memory, err := model.GetUserMemory(eid, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if memory == nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	items, err := memory.GetSmartMemoryItems()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if index >= len(items) {
		c.JSON(http.StatusNotFound, model.NotFound.ToNewErrorResponse("索引超出范围"))
		return
	}

	items = append(items[:index], items[index+1:]...)
	if err := memory.SetSmartMemoryItems(items); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if err := memory.Upsert(); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}
	service.InvalidateUserMemoryCache(eid)

	svc := service.NewUserMemoryService()
	nickname, department := svc.GetUserSystemInfo(c, eid, userID)
	c.JSON(http.StatusOK, model.Success.ToResponse(memory.ToResponse(nickname, department)))
}

// @Summary 删除单条自定义记忆
// @Description 删除指定索引位置的自定义记忆条目
// @Tags UserMemory
// @Produce json
// @Security BearerAuth
// @Param index path int true "记忆条目索引（从0开始）"
// @Success 200 {object} model.CommonResponse{data=model.UserMemoryResponse} "成功返回更新后的记忆"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 404 {object} model.CommonResponse "索引超出范围"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/memory/custom-memory/{index} [delete]
func DeleteCustomMemoryItem(c *gin.Context) {
	index, err := strconv.Atoi(c.Param("index"))
	if err != nil || index < 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	memory, err := model.GetUserMemory(eid, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if memory == nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	items, err := memory.GetCustomMemoryItems()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if index >= len(items) {
		c.JSON(http.StatusNotFound, model.NotFound.ToNewErrorResponse("索引超出范围"))
		return
	}

	items = append(items[:index], items[index+1:]...)
	if err := memory.SetCustomMemoryItems(items); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if err := memory.Upsert(); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}
	service.InvalidateUserMemoryCache(eid)

	svc := service.NewUserMemoryService()
	nickname, department := svc.GetUserSystemInfo(c, eid, userID)
	c.JSON(http.StatusOK, model.Success.ToResponse(memory.ToResponse(nickname, department)))
}

// ImportMemoryRequest 记忆导入请求
type ImportMemoryRequest struct {
	Content string `json:"content" binding:"required" example:"用户偏好简洁回答，使用 Go 语言开发，喜欢 Markdown 输出"`
}

// @Summary 导入用户记忆
// @Description 接受一段自由文本描述的用户信息，通过 LLM 自动标准化为结构化记忆条目。智能记忆（画像/知识）与自定义记忆（偏好/习惯）自动分开导入。适用于从其他 AI 工具（豆包、ChatGPT、Gemini 等）导出的用户上下文转移文件。
// @Tags UserMemory
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body ImportMemoryRequest true "记忆文本内容"
// @Success 200 {object} model.CommonResponse{data=model.UserMemoryResponse} "成功返回导入后的记忆"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/memory/import [post]
func ImportMyMemory(c *gin.Context) {
	var req ImportMemoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var warning string
	if model.ContainsSensitiveInfo(req.Content) {
		warning = "记忆内容包含敏感信息（API Key/密码/身份证/银行卡号等），已自动脱敏处理"
	}

	svc := service.NewUserMemoryService()
	result, err := svc.StandardizeImportText(c.Request.Context(), req.Content, eid, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ParamError.ToNewErrorResponse("记忆导入失败: "+err.Error()))
		return
	}

	if len(result.SmartItems) > 0 {
		if err := model.MergeSmartMemory(eid, userID, result.SmartItems); err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	if len(result.CustomItems) > 0 {
		if err := model.MergeCustomMemory(eid, userID, result.CustomItems); err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	service.InvalidateUserMemoryCache(eid)

	// 同步触发 Topic 融合：同 topic 的条目合并为一段，避免异步导致的数据不一致
	mergeCtx, cancel := context.WithTimeout(c.Request.Context(), 25*time.Second)
	defer cancel()
	if err := svc.TriggerUserTopicMerge(mergeCtx, eid, userID); err != nil {
		logger.Warnf(mergeCtx, "Topic merge failed after import: %v", err)
	}

	resp, err := svc.GetUserMemoryWithSystemInfo(c, eid, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	r := model.Success.ToResponse(resp)
	if warning != "" {
		r = model.Success.ToResponseWithWarning(resp, warning)
	}
	c.JSON(http.StatusOK, r)
}

// parseMemoryInputItems 兼容两种输入格式：
//   - JSON 数组字符串（以 [ 开头）：按 MemoryItem[] 解析并归一化
//   - 纯文本（textarea 输入）：按行拆分为 MemoryItem，自动设置 source 为 defaultSource
func parseMemoryInputItems(input, defaultSource string) ([]model.MemoryItem, error) {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return []model.MemoryItem{}, nil
	}
	if strings.HasPrefix(trimmed, "[") {
		return model.ParseItemsJSON(input)
	}
	items := parseImportText(input)
	for i := range items {
		items[i] = model.NormalizeMemoryItem(items[i], defaultSource)
	}
	return items, nil
}

// normalizeMemoryInput 兼容两种输入格式：
//   - JSON 数组字符串（以 [ 开头）：按 MemoryItem[] 解析并归一化 source
//   - 纯文本（textarea 输入）：按行拆分为 MemoryItem，自动设置 source 为 defaultSource
//
// 空输入返回空 JSON 数组 "[]"。
func normalizeMemoryInput(input, defaultSource string) (string, error) {
	items, err := parseMemoryInputItems(input, defaultSource)
	if err != nil {
		return "", err
	}
	if len(items) == 0 {
		return "[]", nil
	}
	data, err := json.Marshal(items)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// parseImportText 将自由文本解析为 MemoryItem 列表
// 支持格式：
//   - 普通文本：每行一个记忆点
//   - Markdown 列表：以 - 或 * 开头的行
//   - 编号列表：以 1. 2. 等开头的行
//   - 带标题的分段文本：## 标题 下的内容
func parseImportText(text string) []model.MemoryItem {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}

	lines := strings.Split(text, "\n")
	var items []model.MemoryItem
	now := time.Now().UnixMilli()

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// 跳过 Markdown 标题行
		if strings.HasPrefix(line, "#") {
			continue
		}
		// 去掉列表前缀
		fact := line
		for _, prefix := range []string{"- ", "* ", "+ "} {
			if strings.HasPrefix(fact, prefix) {
				fact = fact[len(prefix):]
				break
			}
		}
		// 去掉编号前缀如 "1. " "2. "
		if len(fact) > 2 && fact[1] == '.' {
			if fact[0] >= '0' && fact[0] <= '9' {
				fact = fact[2:]
			}
		}
		fact = strings.TrimSpace(fact)
		if fact == "" {
			continue
		}

		items = append(items, model.MemoryItem{
			Fact:     fact,
			Source:   "user_input",
			Category: "fact",
			Time:     now,
		})
	}

	return items
}
