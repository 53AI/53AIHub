package service

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	v2model "github.com/53AI/53AIHub/rag-pipeline-v2/model"
	"github.com/53AI/53AIHub/service/rag"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

var generateKnowledgeMapContentFn = generateKnowledgeMapContent

func standaloneKnowledgeMapProfile() v2model.RuntimeProfile {
	return v2model.RuntimeProfile{Steps: []v2model.ProfileStep{{
		Enabled: true, RunMode: v2model.RunModeAuto, StepKey: "generate_knowledge_map",
	}}}
}

// EnqueueKnowledgeMapDirect creates a standalone asynchronous knowledge-map job.
func EnqueueKnowledgeMapDirect(ctx context.Context, eid, userID, fileID int64) (*model.RagJob, error) {
	factory := GetRagJobFactoryV2()
	if factory == nil {
		return nil, fmt.Errorf("RAG Job Engine 未初始化")
	}

	params, err := json.Marshal(map[string]int64{
		"eid": eid, "file_id": fileID, "user_id": userID,
	})
	if err != nil {
		return nil, fmt.Errorf("序列化知识地图任务参数失败: %w", err)
	}
	jobs, err := factory.CreateJobsFromProfile(ctx, eid, standaloneKnowledgeMapProfile(), 0, string(params), "")
	if err != nil {
		return nil, fmt.Errorf("创建知识地图任务失败: %w", err)
	}
	if len(jobs) == 0 {
		return nil, fmt.Errorf("未创建知识地图任务")
	}
	return jobs[0], nil
}

func generateKnowledgeMapContent(ctx context.Context, _ int64, file *model.File, agent *model.Agent, content string) (string, *relaymodel.Usage, error) {
	channel, err := model.GetRandomChannel(agent.Eid, agent.ChannelType, agent.Model)
	if err != nil {
		return "", nil, fmt.Errorf("获取知识地图渠道失败: %w", err)
	}

	rootTitle := filepath.Base(file.Path)
	if rootTitle == "." || rootTitle == "" || rootTitle == "/" {
		rootTitle = "知识地图"
	}
	return rag.NewContentGeneratorService(model.DB).GenerateKnowledgeMap(ctx, channel, agent.Model, &rag.GenerateKnowledgeMapRequest{
		Content:   content,
		RootTitle: rootTitle,
	})
}

// GenerateKnowledgeMapDirect generates a map without creating or touching an RAG pipeline run.
func GenerateKnowledgeMapDirect(ctx context.Context, eid, userID, fileID int64) (*model.Message, error) {
	startedAt := time.Now()
	logger.Infof(ctx, "【知识地图直生成】开始: eid=%d user_id=%d file_id=%d", eid, userID, fileID)

	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		logger.Errorf(ctx, "【知识地图直生成】读取文件失败: eid=%d user_id=%d file_id=%d err=%v", eid, userID, fileID, err)
		return nil, fmt.Errorf("获取文件失败: %w", err)
	}

	fileBody, err := model.GetLastFileBodyByFileID(eid, fileID)
	if err != nil {
		logger.Errorf(ctx, "【知识地图直生成】读取文件正文失败: eid=%d user_id=%d file_id=%d err=%v", eid, userID, fileID, err)
		return nil, fmt.Errorf("获取文件内容失败: %w", err)
	}
	content, err := fileBody.GetContent()
	if err != nil {
		logger.Errorf(ctx, "【知识地图直生成】加载文件正文失败: eid=%d user_id=%d file_id=%d body_id=%d err=%v", eid, userID, fileID, fileBody.ID, err)
		return nil, fmt.Errorf("获取文件内容失败: %w", err)
	}
	if content == "" {
		logger.Warnf(ctx, "【知识地图直生成】文件正文为空: eid=%d user_id=%d file_id=%d body_id=%d", eid, userID, fileID, fileBody.ID)
		return nil, fmt.Errorf("文件内容为空，无法生成知识地图")
	}

	_, agents, err := model.GetAvailableAgentList(eid, []int{model.AgentTypeApp}, []int{model.AgentUsageKnowledgeMap}, 0, 1)
	if err != nil {
		logger.Errorf(ctx, "【知识地图直生成】查询生成 Agent 失败: eid=%d user_id=%d file_id=%d err=%v", eid, userID, fileID, err)
		return nil, fmt.Errorf("获取知识地图智能体失败: %w", err)
	}
	if len(agents) == 0 {
		logger.Warnf(ctx, "【知识地图直生成】没有可用生成 Agent: eid=%d user_id=%d file_id=%d", eid, userID, fileID)
		return nil, fmt.Errorf("未配置知识地图智能体")
	}
	agent := agents[0]
	logger.Infof(ctx, "【知识地图直生成】选中 Agent: eid=%d user_id=%d file_id=%d agent_id=%d channel_type=%d model=%s content_bytes=%d", eid, userID, fileID, agent.AgentID, agent.ChannelType, agent.Model, len(content))
	logger.Infof(ctx, "【知识地图直生成】开始调用模型: eid=%d user_id=%d file_id=%d agent_id=%d", eid, userID, fileID, agent.AgentID)
	knowledgeMap, usage, err := generateKnowledgeMapContentFn(ctx, eid, file, agent, content)
	if err != nil {
		logger.Errorf(ctx, "【知识地图直生成】模型生成失败: eid=%d user_id=%d file_id=%d agent_id=%d elapsed_ms=%d err=%v", eid, userID, fileID, agent.AgentID, time.Since(startedAt).Milliseconds(), err)
		return nil, err
	}
	logger.Infof(ctx, "【知识地图直生成】模型生成成功: eid=%d user_id=%d file_id=%d agent_id=%d result_bytes=%d elapsed_ms=%d", eid, userID, fileID, agent.AgentID, len(knowledgeMap), time.Since(startedAt).Milliseconds())

	messageContent, err := json.Marshal([]relaymodel.Message{{Role: "user", Content: "生成知识地图"}})
	if err != nil {
		logger.Errorf(ctx, "【知识地图直生成】序列化消息失败: eid=%d user_id=%d file_id=%d err=%v", eid, userID, fileID, err)
		return nil, fmt.Errorf("序列化消息内容失败: %w", err)
	}
	message := &model.Message{
		Eid:              eid,
		UserID:           userID,
		Message:          string(messageContent),
		AgentID:          agent.AgentID,
		Answer:           knowledgeMap,
		ModelName:        agent.Model,
		FileID:           fileID,
		DocumentType:     model.DocumentTypeFile,
		DocumentID:       fileID,
		ResponseStatus:   model.ResponseStatusNormal,
		ThinkingMode:     model.ThinkingModeQuick,
		KnowledgeType:    model.KnowledgeTypeSingleFile,
		RequestSource:    model.MessageRequestSourceConsole,
		ConversationID:   0,
		IsStream:         false,
		PromptTokens:     usagePromptTokens(usage),
		CompletionTokens: usageCompletionTokens(usage),
		TotalTokens:      usageTotalTokens(usage),
	}

	if err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.File{}).Where("eid = ? AND id = ?", eid, fileID).Update("knowledge_map", knowledgeMap).Error; err != nil {
			return fmt.Errorf("更新文件知识地图失败: %w", err)
		}
		return tx.Create(message).Error
	}); err != nil {
		logger.Errorf(ctx, "【知识地图直生成】结果落库失败: eid=%d user_id=%d file_id=%d agent_id=%d result_bytes=%d elapsed_ms=%d err=%v", eid, userID, fileID, agent.AgentID, len(knowledgeMap), time.Since(startedAt).Milliseconds(), err)
		return nil, err
	}
	logger.Infof(ctx, "【知识地图直生成】完成: eid=%d user_id=%d file_id=%d agent_id=%d message_id=%d result_bytes=%d elapsed_ms=%d", eid, userID, fileID, agent.AgentID, message.ID, len(knowledgeMap), time.Since(startedAt).Milliseconds())

	return message, nil
}

func usagePromptTokens(usage *relaymodel.Usage) int {
	if usage == nil {
		return 0
	}
	return usage.PromptTokens
}

func usageCompletionTokens(usage *relaymodel.Usage) int {
	if usage == nil {
		return 0
	}
	return usage.CompletionTokens
}

func usageTotalTokens(usage *relaymodel.Usage) int {
	if usage == nil {
		return 0
	}
	return usage.TotalTokens
}
