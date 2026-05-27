package steps

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	relay_model "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

// GenerateKnowledgeMapGenerateStep 生成知识地图生成步骤
type GenerateKnowledgeMapGenerateStep struct {
	BaseStep
	DB *gorm.DB
}

// GenerateKnowledgeMapGenerateParameters 生成知识地图生成步骤的参数
type GenerateKnowledgeMapGenerateParameters struct {
	Eid            int64 `json:"eid"`
	FileID         int64 `json:"file_id"`
	UserID         int64 `json:"user_id"`
	ConversationID int64 `json:"conversation_id"` // 可选，用于关联会话
}

// GenerateKnowledgeMapGenerateResult 生成知识地图生成步骤的结果
type GenerateKnowledgeMapGenerateResult struct {
	File         *model.File `json:"file"`
	Success      bool        `json:"success"`
	KnowledgeMap string      `json:"knowledge_map"`
}

// NewGenerateKnowledgeMapGenerateStep 创建新的生成知识地图生成步骤
func NewGenerateKnowledgeMapGenerateStep(db *gorm.DB) *GenerateKnowledgeMapGenerateStep {
	return &GenerateKnowledgeMapGenerateStep{
		DB: db,
	}
}

// Execute 执行生成知识地图生成步骤
func (s *GenerateKnowledgeMapGenerateStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(GenerateKnowledgeMapGenerateParameters)
	if !ok {
		s.Step.CompleteWithError("Invalid parameters type")
		return nil
	}

	ctx := context.Background()
	startTime := time.Now()
	logger.Debugf(ctx, "[GenerateKnowledgeMapGenerate] 开始生成知识地图 - EID: %d, FileID: %d", params.Eid, params.FileID)

	// 获取文件信息
	var file model.File
	err := s.DB.Where("eid = ? AND id = ?", params.Eid, params.FileID).First(&file).Error
	if err != nil {
		errMsg := fmt.Sprintf("获取文件信息失败: %v", err)
		logger.Errorf(ctx, "[GenerateKnowledgeMapGenerate] %s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 获取上传文件信息以获取文件名
	var uploadFile model.UploadFile
	if err := s.DB.First(&uploadFile, file.UploadFileID).Error; err == nil {
		file.UploadFile = &uploadFile
	}

	// 检查是否有停止信号
	err = common.CheckRagTaskStop(file.LibraryID, file.ID)
	if err != nil {
		s.Step.CompleteWithError(err)
		return err
	}

	// 获取文件内容
	fileBody, err := model.GetLastFileBodyByFileID(params.Eid, file.ID)
	if err != nil {
		errMsg := fmt.Sprintf("获取文件内容失败: %v", err)
		logger.Errorf(ctx, "[GenerateKnowledgeMapGenerate] %s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}
	content, err := fileBody.GetContent()
	if err != nil {
		errMsg := fmt.Sprintf("获取文件内容失败: %v", err)
		logger.Errorf(ctx, "[GenerateKnowledgeMapGenerate] %s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	if content == "" {
		errMsg := "文件内容为空，无法生成知识地图"
		logger.Warnf(ctx, "[GenerateKnowledgeMapGenerate] %s - FileID: %d", errMsg, file.ID)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	_, agents, agentErr := model.GetAvailableAgentList(params.Eid, []int{model.AgentTypeApp}, []int{model.AgentUsageKnowledgeMap}, 0, 1)
	if agentErr != nil || len(agents) == 0 {
		errMsg := "未配置知识地图智能体，无法生成知识地图"
		logger.Warnf(ctx, "[GenerateKnowledgeMapGenerate] %s - FileID: %d", errMsg, file.ID)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}
	agent := agents[0]
	modelName := agent.Model
	if modelName == "" {
		errMsg := "知识地图智能体未配置模型，无法生成知识地图"
		logger.Warnf(ctx, "[GenerateKnowledgeMapGenerate] %s - FileID: %d", errMsg, file.ID)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	channel, err := model.GetRandomChannel(params.Eid, agent.ChannelType, modelName)
	if err != nil {
		errMsg := fmt.Sprintf("获取知识地图渠道失败: %v", err)
		logger.Errorf(ctx, "[GenerateKnowledgeMapGenerate] %s - FileID: %d", errMsg, file.ID)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 创建内容生成器
	contentGenerator := rag.NewContentGeneratorService(s.DB)

	// 创建生成请求
	fileName := "Root"
	if file.UploadFile != nil {
		fileName = file.UploadFile.FileName
	}
	request := &rag.GenerateKnowledgeMapRequest{
		Content:   content,
		RootTitle: fileName,
	}

	// 调用生成方法
	knowledgeMap, usage, err := contentGenerator.GenerateKnowledgeMap(ctx, channel, modelName, request)

	// 记录消息日志
	elapsedTime := time.Since(startTime).Milliseconds()

	rootTitle := request.RootTitle
	if rootTitle == "" {
		rootTitle = "知识地图"
	}
	systemPrompt := fmt.Sprintf(`你是一个擅长结构化内容梳理的文档分析助手。
请根据给定的文档内容，生成一份 Mermaid 思维导图 (mindmap) 的 Markdown 代码。

要求：
1. 只输出 Mermaid 代码块，不要添加任何解释或前后缀文本。
2. 使用如下基本格式：
   `+"```"+`mermaid
   mindmap
     root((%s))
       一级节点
         二级节点
   `+"```"+`
3. 结构要求：
   - 根节点使用圆角形：root((%s))
   - 1-3 级层次，避免过深嵌套
   - 覆盖文档的核心模块、关键流程、重要概念
   - 节点文本简洁清晰，不要超过 20 个字
4. 不要生成与内容无关的节点，不要虚构信息。

下面是待分析的文档内容：`, rootTitle, rootTitle)

	contentForModel := request.Content
	if len(contentForModel) > 50000 {
		contentForModel = contentForModel[:50000]
	}

	chatMessages := []relay_model.Message{
		{
			Role:    "system",
			Content: systemPrompt,
		},
		{
			Role:    "user",
			Content: contentForModel,
		},
	}
	messageContentJSON, marshalMsgErr := json.Marshal(chatMessages)
	if marshalMsgErr != nil {
		messageContentJSON = []byte("[]")
	}

	answerContent := knowledgeMap
	if err != nil {
		answerContent = err.Error()
	}

	promptTokens := 0
	completionTokens := 0
	totalTokens := 0
	if usage != nil {
		promptTokens = usage.PromptTokens
		completionTokens = usage.CompletionTokens
		totalTokens = usage.TotalTokens
	}

	msg := &model.Message{
		Eid:              params.Eid,
		UserID:           params.UserID,
		Message:          string(messageContentJSON),
		AgentID:          agent.AgentID,
		ConversationID:   params.ConversationID, // 如果有会话ID则关联
		Answer:           answerContent,
		ModelName:        modelName,
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		TotalTokens:      totalTokens,
		ChannelId:        int(channel.ChannelID),
		ElapsedTime:      elapsedTime,
		IsStream:         false,
		ResponseStatus:   model.ResponseStatusNormal,
		ThinkingMode:     model.ThinkingModeQuick,
		KnowledgeType:    model.KnowledgeTypeDatabase,
		FileID:           file.ID,
	}

	// 如果没有ConversationID，创建一个新的会话或查找现有会话？
	// 这里假设如果有params.ConversationID就用，没有就为0（不关联或后续处理）
	// 通常工作流日志可能不需要强关联会话，除非是用户触发的。

	if createMsgErr := model.CreateMessage(msg); createMsgErr != nil {
		logger.Errorf(ctx, "[GenerateKnowledgeMapGenerate] 创建消息记录失败: %v", createMsgErr)
	} else {
		logger.SysLogf("[GenerateKnowledgeMapGenerate] 知识地图生成日志已记录，消息ID: %d", msg.ID)
	}

	if err != nil {
		errMsg := fmt.Sprintf("生成知识地图失败: %v", err)
		logger.Errorf(ctx, "[GenerateKnowledgeMapGenerate] %s - FileID: %d", errMsg, file.ID)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	logger.Infof(ctx, "[GenerateKnowledgeMapGenerate] 成功生成知识地图 - FileID: %d, 长度: %d", file.ID, len(knowledgeMap))

	// 更新文件信息
	updateData := map[string]interface{}{
		"knowledge_map": knowledgeMap,
	}

	err = s.DB.Model(&model.File{}).Where("id = ?", file.ID).Updates(updateData).Error
	if err != nil {
		errMsg := fmt.Sprintf("更新文件知识地图失败: %v", err)
		logger.Errorf(ctx, "[GenerateKnowledgeMapGenerate] %s - FileID: %d", errMsg, file.ID)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 创建结果
	result := GenerateKnowledgeMapGenerateResult{
		File:         &file,
		Success:      true,
		KnowledgeMap: knowledgeMap,
	}

	s.Step.CompleteSuccessfully(result)
	return nil
}
