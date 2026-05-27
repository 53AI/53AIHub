package steps

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	relay_model "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

type SummaryGenerationConfig struct {
	SummaryFaq struct {
		Enabled bool `json:"enabled"`
	} `json:"summary_faq"`
	KnowledgeMap struct {
		Enabled bool `json:"enabled"`
	} `json:"knowledge_map"`
	EntityExtraction struct {
		Enabled bool `json:"enabled"`
	} `json:"entity_extraction"`
}

func selectEnterpriseDefaultGenerationConfig(enterpriseConfig, _ *rag.ChunkConfig) (*rag.ChunkConfig, error) {
	if enterpriseConfig == nil {
		return nil, fmt.Errorf("未配置企业默认逻辑推理渠道，无法生成摘要和知识地图")
	}
	if enterpriseConfig.LogicChannel == nil {
		return nil, fmt.Errorf("未配置企业默认逻辑推理渠道，无法生成摘要和知识地图")
	}
	if enterpriseConfig.LogicModelName == nil || strings.TrimSpace(*enterpriseConfig.LogicModelName) == "" {
		return nil, fmt.Errorf("未配置企业默认逻辑推理模型，无法生成摘要和知识地图")
	}
	return enterpriseConfig, nil
}

func NewSummaryGenerationHandler(db *gorm.DB) func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
	return func(ctx context.Context, job *model.RagJob, stepConfig json.RawMessage) error {
		var params map[string]interface{}
		if err := json.Unmarshal([]byte(job.StartParameters), &params); err != nil {
			return fmt.Errorf("解析任务参数失败: %v", err)
		}

		eid := int64(0)
		if v, ok := params["eid"]; ok {
			eid = int64(v.(float64))
		}
		fileID := int64(0)
		if v, ok := params["file_id"]; ok {
			fileID = int64(v.(float64))
		}
		userID := int64(0)
		if v, ok := params["user_id"]; ok {
			switch vv := v.(type) {
			case float64:
				userID = int64(vv)
			case int64:
				userID = vv
			}
		}
		conversationID := int64(0)
		if v, ok := params["conversation_id"]; ok {
			switch vv := v.(type) {
			case float64:
				conversationID = int64(vv)
			case int64:
				conversationID = vv
			}
		}

		logger.Info(ctx, fmt.Sprintf("SummaryGenerationStepHandler: processing job %d for file %d", job.JobID, fileID))

		var file model.File
		if err := db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
			return fmt.Errorf("获取文件信息失败: %v", err)
		}
		if userID == 0 {
			userID = file.UserID
		}

		if err := common.CheckRagTaskStop(file.LibraryID, file.ID); err != nil {
			return err
		}

		if err := model.UpdateFileAIGenerateSQStatus(file.ID, model.AIGenerateSQStatusParsing); err != nil {
			return fmt.Errorf("更新文件生成状态失败: %v", err)
		}

		fileBody, err := model.GetLastFileBodyByFileID(eid, fileID)
		if err != nil {
			_ = model.UpdateFileAIGenerateSQStatus(file.ID, model.AIGenerateSQStatusFail)
			return fmt.Errorf("获取文件内容失败: %v", err)
		}
		if fileBody == nil {
			_ = model.UpdateFileAIGenerateSQStatus(file.ID, model.AIGenerateSQStatusFail)
			return fmt.Errorf("文件内容为空，无法生成摘要")
		}
		content, err := fileBody.GetContent()
		if err != nil {
			_ = model.UpdateFileAIGenerateSQStatus(file.ID, model.AIGenerateSQStatusFail)
			return fmt.Errorf("读取文件内容失败: %v", err)
		}
		if strings.TrimSpace(content) == "" {
			_ = model.UpdateFileAIGenerateSQStatus(file.ID, model.AIGenerateSQStatusFail)
			return fmt.Errorf("文件内容为空，无法生成摘要")
		}

		var cfg SummaryGenerationConfig
		if len(stepConfig) > 0 && string(stepConfig) != "null" {
			if err := json.Unmarshal(stepConfig, &cfg); err != nil {
				_ = model.UpdateFileAIGenerateSQStatus(file.ID, model.AIGenerateSQStatusFail)
				return fmt.Errorf("解析步骤配置失败: %v", err)
			}
		}

		generateSummaryFaq := cfg.SummaryFaq.Enabled
		generateKnowledgeMap := cfg.KnowledgeMap.Enabled
		generateEntities := cfg.EntityExtraction.Enabled

		if !generateSummaryFaq && !generateKnowledgeMap && !generateEntities {
			if err := model.UpdateFileAIGenerateSQStatus(file.ID, model.AIGenerateSQStatusNormal); err != nil {
				return fmt.Errorf("更新文件生成状态失败: %v", err)
			}
			return completeSummaryGenerationStep(db, job.JobID, map[string]interface{}{
				"summary":       "",
				"questions":     []string{},
				"knowledge_map": "",
				"word_count":    0,
				"total_tokens":  0,
			})
		}

		var chunkConfig *rag.ChunkConfig
		var generationConfig *rag.ChunkConfig
		configService := rag.NewChunkConfigService(db)
		if generateSummaryFaq || generateKnowledgeMap {
			chunkConfig, err = configService.GetConfigWithFileID(eid, &file.LibraryID, &file.ID)
			if err != nil {
				logger.Warnf(ctx, "获取分块配置失败，将继续使用企业默认逻辑推理配置生成内容: %v", err)
			}

			enterpriseConfig, enterpriseErr := configService.GetConfig(eid, nil, model.ChunkTypeDefault)
			if enterpriseErr != nil {
				_ = model.UpdateFileAIGenerateSQStatus(file.ID, model.AIGenerateSQStatusFail)
				return fmt.Errorf("获取企业默认分块配置失败: %v", enterpriseErr)
			}

			generationConfig, err = selectEnterpriseDefaultGenerationConfig(enterpriseConfig, chunkConfig)
			if err != nil {
				_ = model.UpdateFileAIGenerateSQStatus(file.ID, model.AIGenerateSQStatusFail)
				return err
			}
		}

		contentGenerator := rag.NewContentGeneratorService(db)
		totalTokens := 0
		summaryText := ""
		var questions []string
		knowledgeMap := ""
		rootTitle := "Root"
		if generateSummaryFaq || generateKnowledgeMap {
			_ = file.LoadUploadFile()
			if file.UploadFile != nil && file.UploadFile.FileName != "" {
				rootTitle = file.UploadFile.FileName
			}
		}

		if generateSummaryFaq || generateKnowledgeMap {
			startTime := time.Now()
			resp, usage, err := contentGenerator.GenerateSummaryQuestionsKnowledgeMap(ctx, eid, generationConfig, &rag.GenerateSummaryQuestionsKnowledgeMapRequest{
				Content:              content,
				RootTitle:            rootTitle,
				GenerateSummary:      generateSummaryFaq,
				GenerateQuestions:    generateSummaryFaq,
				GenerateKnowledgeMap: generateKnowledgeMap,
			})
			elapsedTime := time.Since(startTime).Milliseconds()

			if err != nil {
				_ = model.UpdateFileAIGenerateSQStatus(file.ID, model.AIGenerateSQStatusFail)
				return err
			}
			if resp != nil {
				summaryText = resp.Summary
				questions = resp.Questions
				knowledgeMap = resp.KnowledgeMap
			}
			if usage != nil {
				totalTokens += usage.TotalTokens
			}

			if generateKnowledgeMap && strings.TrimSpace(knowledgeMap) != "" {
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

				contentForModel := content
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

				promptTokens := 0
				completionTokens := 0
				usageTokens := 0
				if usage != nil {
					promptTokens = usage.PromptTokens
					completionTokens = usage.CompletionTokens
					usageTokens = usage.TotalTokens
				}

				msg := &model.Message{
					Eid:              eid,
					UserID:           userID,
					Message:          string(messageContentJSON),
					AgentID:          0,
					ConversationID:   conversationID,
					Answer:           knowledgeMap,
					ModelName:        *generationConfig.LogicModelName,
					PromptTokens:     promptTokens,
					CompletionTokens: completionTokens,
					TotalTokens:      usageTokens,
					ChannelId:        int(generationConfig.LogicChannel.ChannelID),
					ElapsedTime:      elapsedTime,
					IsStream:         false,
					ResponseStatus:   model.ResponseStatusNormal,
					ThinkingMode:     model.ThinkingModeQuick,
					KnowledgeType:    model.KnowledgeTypeDatabase,
					FileID:           file.ID,
				}

				if createMsgErr := model.CreateMessage(msg); createMsgErr != nil {
					logger.Errorf(ctx, "创建知识地图消息记录失败: %v", createMsgErr)
				} else {
					logger.SysLogf("知识地图生成日志已记录，消息ID: %d", msg.ID)
				}
			}
		}

		if generateEntities {
			extractor := rag.NewEntityExtractionService(db)
			if err := extractor.ExtractAndStoreForFileContent(ctx, eid, fileID, content); err != nil {
				logger.Errorf(ctx, "实体生成失败: %v", err)
			}
			if err := extractor.ExtractAndStoreForFileMeta(ctx, eid, fileID); err != nil {
				logger.Errorf(ctx, "元信息实体生成失败: %v", err)
			}
		}

		wordCount := 0
		if summaryText != "" {
			wordCount += len([]rune(summaryText))
		}
		for _, q := range questions {
			wordCount += len([]rune(q))
		}
		if knowledgeMap != "" {
			wordCount += len([]rune(knowledgeMap))
		}

		result := map[string]interface{}{
			"summary":       summaryText,
			"questions":     questions,
			"knowledge_map": knowledgeMap,
			"word_count":    wordCount,
			"total_tokens":  totalTokens,
		}

		updateData := map[string]interface{}{
			"ai_generate_sq_status": model.AIGenerateSQStatusNormal,
		}
		if generateSummaryFaq {
			updateData["summary"] = summaryText
			questionsJSON, _ := json.Marshal(questions)
			updateData["questions"] = string(questionsJSON)
		}
		if generateKnowledgeMap {
			updateData["knowledge_map"] = knowledgeMap
		}
		if err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Model(&model.File{}).Where("id = ?", file.ID).Updates(updateData).Error; err != nil {
				return err
			}

			svc := rag.NewGeneratedContentService(tx)

			if generateSummaryFaq && summaryText != "" {
				if err := svc.UpsertSummaryChunks(eid, &file, summaryText, chunkConfig); err != nil {
					return err
				}
			}
			if generateKnowledgeMap && knowledgeMap != "" {
				if err := svc.UpsertKnowledgeMapChunks(eid, &file, knowledgeMap, chunkConfig); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			_ = model.UpdateFileAIGenerateSQStatus(file.ID, model.AIGenerateSQStatusFail)
			return fmt.Errorf("更新文件生成结果失败: %v", err)
		}

		return completeSummaryGenerationStep(db, job.JobID, result)
	}
}

func completeSummaryGenerationStep(db *gorm.DB, jobID int64, result map[string]interface{}) error {
	var jobStep model.RagJobStep
	if err := db.Where("job_id = ?", jobID).First(&jobStep).Error; err != nil {
		return fmt.Errorf("获取任务步骤失败: %v", err)
	}
	if err := jobStep.CompleteSuccessfully(result); err != nil {
		return err
	}
	return db.Save(&jobStep).Error
}
