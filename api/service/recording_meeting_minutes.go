package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/keystone"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/tokenlimit"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/elasticsearch"
	"github.com/53AI/53AIHub/service/rag"
	jsonrepair "github.com/aichy126/json_repair"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// llmSemaphore 限制 LLM 并发调用数，避免瞬间打爆 API
var llmSemaphore = make(chan struct{}, 10)

// recordingPipelineCtx 是录音管线的包级上下文，服务关闭时通过 StopRecordingPipeline() 取消。
// 异步 goroutine 从此 context 派生，确保服务停止时能优雅终止。
var (
	recordingPipelineCtx        context.Context
	recordingPipelineCancel     context.CancelFunc
	recordingPipelineCancelOnce sync.Once
)

func init() {
	recordingPipelineCtx, recordingPipelineCancel = context.WithCancel(context.Background())
}

// StopRecordingPipeline 取消所有正在运行的录音管线异步任务。服务关闭时由外层调用。
func StopRecordingPipeline() {
	recordingPipelineCancelOnce.Do(func() {
		recordingPipelineCancel()
	})
}

// prompt2SystemPrompt 会议纪要生成 System Prompt（Prompt 2）。
// 来源：docs/录音转决策关键prompt.md → Prompt 2
const prompt2SystemPrompt = `你是一个企业会议纪要与会议知识抽取引擎。

你会收到经过规范化的会议逐字稿。

你的任务是生成一份准确、清晰、可追溯的会议纪要，并将会议中的关键知识转化为结构化数据，供后续历史检索和决策分析使用。

本阶段只回答：

- 会议讨论了什么；
- 涉及哪些人物、客户、项目、产品和议题；
- 提出了哪些问题、观点、方案和风险；
- 形成了哪些明确决策；
- 安排了哪些行动；
- 哪些问题仍然没有解决。

本阶段不得进行过度经营推演，不得生成"老板应该如何决策"的深度建议。

例如：

可以写：
"会议认为 VIVO 项目不能继续被动等待，应优先解决上次会议遗留的问题。"

不应在本阶段写：
"当前最大的风险是内部战略认知失控，必须立即进入关系修复战。"

后者属于后续决策分析阶段。

一、事实纪律

必须区分：

1. confirmed：
原文明确表达并已经形成的事实、决策或行动。

2. proposed：
会议中提出，但尚未正式确认的建议或方案。

3. inferred：
为了形成纪要而进行的低风险概括，不得超出原意。

4. uncertain：
信息不足、说话人不明确或表达存在歧义。

不得虚构：

- 人物职位；
- 预算金额；
- 客户关系；
- 决策权限；
- 截止时间；
- 已完成状态；
- 未明确出现的会议结论。

二、会议纪要头部

必须生成：

- 会议主题；
- 开始时间；
- 结束时间；
- 时长；
- 参与者；
- 关键实体；
- 关键词。

三、会议纪要主体

主体结构不固定，应根据本次会议内容选择最自然的组织方式，例如：

- 按议题；
- 按问题与解决方案；
- 按决策与执行事项；
- 按人物观点；
- 按业务流程；
- 按时间演进。

不要强行生成不存在的模块。

四、结构化知识

必须提取：

- topics；
- entities；
- viewpoints；
- decisions；
- issues；
- risks；
- opportunities；
- actions；
- commitments；
- open_questions；
- key_quotes。

每个重要对象必须包含 source_segment_ids，用于回溯逐字稿。

五、实体提取

允许实体类型：

- person
- company
- project
- product
- department
- topic
- issue
- technology
- platform

实体中的 canonical_name 只有在可以高置信度确定时才填写。无法确定时置空，不得自行补全。

六、安心录实体记忆

除 key_entities 外，必须输出 memory_entities。它仅用于安心录后续决策洞察，不是通用知识图谱实体。

只允许以下四类，且只提取逐字稿或纪要中有明确证据的内容：

- person：company、position、demand、relationship(potential_customer|customer|partner|competitor|irrelevant)；
- matter：status(todo|in_progress|completed|shelved)、priority(high|medium|low)、deliverable、dependency；
- risk：risk_type(compliance|delivery|financial|technical)、risk_level(high|medium|low)、probability、response；
- principle：principle_type(company_policy|industry_norm|compliance_req|business_principle)、applicable_scope、binding_force(mandatory|recommended|reference)、exceptions。

属性无法由证据确认时不要输出该属性；特别是不得编造联系人、截止日期、概率或人物关系。每条事实必须包含 source_segment_ids。canonical_name 只在身份明确时填写；同名但身份不明的人物不要擅自合并。

七、输出格式

严格输出 JSON，不输出 Markdown，不输出 JSON 之外的说明。

{
  "minutes_version": "1.0",
  "meeting": {
    "title": "",
    "started_at": "",
    "ended_at": "",
    "duration_seconds": 0,
    "participants": [
      {
        "name": "",
        "role": "",
        "confidence": 0
      }
    ]
  },
  "key_entities": [
    {
      "mention": "",
      "entity_type": "person|company|project|product|department|topic|issue|technology|platform",
      "canonical_name": "",
      "entity_id": null,
      "description": "",
      "confidence": 0,
      "source_segment_ids": []
    }
  ],
  "memory_entities": [
    {
      "entity_type": "person|matter|risk|principle",
      "mention": "",
      "canonical_name": "",
      "summary": "",
      "aliases": [],
      "attributes": {},
      "facts": [
        {
          "content": "",
          "attributes": {},
          "source_segment_ids": []
        }
      ]
    }
  ],
  "keywords": [],
  "executive_summary": "",
  "sections": [
    {
      "title": "",
      "summary": "",
      "section_type": "topic|problem_solution|decision_action|viewpoint|process|timeline|other",
      "source_segment_ids": []
    }
  ],
  "topics": [
    {
      "id": "topic_001",
      "title": "",
      "summary": "",
      "related_entity_mentions": [],
      "source_segment_ids": []
    }
  ],
  "viewpoints": [
    {
      "id": "view_001",
      "speaker": "",
      "content": "",
      "status": "confirmed|proposed|inferred|uncertain",
      "source_segment_ids": []
    }
  ],
  "decisions": [
    {
      "id": "decision_001",
      "content": "",
      "status": "confirmed|proposed|rejected|deferred|uncertain",
      "decision_maker": "",
      "reason": "",
      "related_entity_mentions": [],
      "source_segment_ids": [],
      "confidence": 0
    }
  ],
  "issues": [
    {
      "id": "issue_001",
      "content": "",
      "status": "open|resolved|uncertain",
      "impact": "",
      "related_entity_mentions": [],
      "source_segment_ids": []
    }
  ],
  "risks": [
    {
      "id": "risk_001",
      "title": "",
      "description": "",
      "severity": "low|medium|high|uncertain",
      "status": "confirmed|proposed|inferred|uncertain",
      "related_entity_mentions": [],
      "source_segment_ids": []
    }
  ],
  "opportunities": [
    {
      "id": "opportunity_001",
      "title": "",
      "description": "",
      "status": "confirmed|proposed|inferred|uncertain",
      "related_entity_mentions": [],
      "source_segment_ids": []
    }
  ],
  "actions": [
    {
      "id": "action_001",
      "content": "",
      "owner": "",
      "deadline": "",
      "status": "new|ongoing|completed|unknown",
      "deliverable": "",
      "acceptance_criteria": "",
      "related_entity_mentions": [],
      "source_segment_ids": []
    }
  ],
  "commitments": [
    {
      "id": "commitment_001",
      "content": "",
      "made_by": "",
      "made_to": "",
      "deadline": "",
      "status": "new|fulfilled|unfulfilled|unknown",
      "source_segment_ids": []
    }
  ],
  "open_questions": [
    {
      "id": "question_001",
      "content": "",
      "why_important": "",
      "source_segment_ids": []
    }
  ],
  "key_quotes": [
    {
      "speaker": "",
      "quote": "",
      "meaning": "",
      "source_segment_ids": []
    }
  ]
}

输出前检查：

1. 是否把提议误写成了决策；
2. 是否把主观判断误写成了事实；
3. 是否遗漏关键实体；
4. 是否为关键对象保留了原文证据；
5. 纪要主体是否根据内容自由组织，而不是套固定格式；
6. 是否在纪要阶段做了过度经营推演；
7. 是否存在原文未出现的人物、预算、权限或截止时间；
8. memory_entities 的每个属性和事实是否都有对应证据。`

// getRecordingContextBudget 获取录音管线的上下文预算（token 数）。
func getRecordingContextBudget(ctx context.Context, config *model.RecordingConfig) int {
	channel, err := model.GetChannelByID(config.InferenceModelID)
	if err != nil || channel == nil {
		return tokenlimit.DefaultContextBudget
	}
	tokenCfg := tokenlimit.ParseConfig(ctx, channel.ChannelID, channel.Config, config.InferenceModelName)
	if tokenCfg.ContextLength > 0 {
		return int(tokenCfg.ContextLength)
	}
	return tokenlimit.DefaultContextBudget
}

// GenerateMeetingMinutes 转写完成后同步触发，生成会议纪要并执行存储反转。
//
// 返回 nil 表示成功（或 skipped），返回 error 表示失败（管线应终止）。
func GenerateMeetingMinutes(ctx context.Context, eid, fileID, userID int64) error {
	config, err := model.ValidateOrCreateRecordingConfig(eid)
	if err != nil || config.InferenceModelID == 0 || config.InferenceModelName == "" {
		logger.Infof(ctx, "【纪要】推理模型未配置，跳过 fileID=%d", fileID)
		setMeetingMinutesStatus(fileID, "skipped")
		return nil
	}

	// 纪要复用（仅录音文件）：同内容源文件（同 upload_files.hash 或同 upload_file_id）已有
	// completed 纪要 → 直接拷贝反转布局（FileBody=纪要 + Summary(-1)=转写），跳过 LLM 生成与存储反转。
	// 源无/pending/failed → 走正常生成。template_id>0 自定义总结不拷贝。
	// 与 SonicNote 预置转写互斥：目标 parse_type=sonicnote_transcript（预置官方转写）时跳过复用，
	// 走 LLM 生成（反转保留预置转写），避免源转写覆盖预置转写（与 document_parsing 转写复用同一不变量）。
	if file, ferr := model.GetFileByID(eid, fileID); ferr == nil && file.ParseType != model.PLATFORM_KEY_SONICNOTE &&
		file.IsRecordingOriginType() && file.UploadFileID > 0 {
		if uf, uerr := model.GetUploadFileByID(file.UploadFileID); uerr == nil && uf != nil {
			cands, cerr := findReuseSourceCandidates(ctx, eid, uf.Hash, uf.ID, fileID)
			if cerr == nil {
				for _, cand := range cands {
					ok, herr := ReuseSourceHasMinutes(ctx, eid, cand.ID)
					if herr != nil || !ok {
						continue
					}
					if rerr := ReuseMinutesForFile(ctx, eid, cand.ID, fileID, userID); rerr != nil {
						logger.Warnf(ctx, "【纪要】复用失败，降级生成 fileID=%d: %v", fileID, rerr)
						break
					}
					// 复用成功后按会议标题重命名文件（对齐正常生成路径第 8 步；失败不阻塞）
					if srcBody, berr := model.GetLastFileBodyByFileID(eid, cand.ID); berr == nil {
						if minutesJSON, cerr := srcBody.GetContent(); cerr == nil {
							renameFileByMeetingTitle(ctx, eid, fileID, file, minutesJSON)
						}
					}
					setMeetingMinutesStatus(fileID, "completed")
					logger.Infof(ctx, "【纪要】复用完成 fileID=%d src_file_id=%d", fileID, cand.ID)
					return nil
				}
			}
		}
	}

	setMeetingMinutesStatus(fileID, "processing")
	if client := keystone.GlobalClient; client != nil {
		client.ReportTaskStageStarted(keystone.TaskEvent{
			ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
			TaskType:       "RECORDING_PIPELINE",
			StageKey:       "meeting_minutes",
			StageStatus:    keystone.TaskStatusRunning,
			ServiceKey:     "recording-pipeline",
			StartedAt:      time.Now().UTC(),
		})
	}

	startTime := time.Now()

	// 1. 读取录音任务时间（会议开始/结束时间）
	startedAt := int64(0)
	endedAt := int64(0)
	recordingJob, err := model.GetRecordingJobByOutputFileID(eid, fileID)
	if err == nil && recordingJob != nil {
		startedAt = recordingJob.StartedAt
		endedAt = recordingJob.EndedAt
		logger.Infof(ctx, "【纪要】读取录音任务时间: fileID=%d started_at=%d ended_at=%d", fileID, startedAt, endedAt)
	} else {
		logger.Infof(ctx, "【纪要】未找到录音任务，会议时间使用空值: fileID=%d err=%v", fileID, err)
	}

	// 2. 读取转写原文（原始 JSON，供 step 6 存储反转使用）
	transcriptText, err := loadTranscriptTextRaw(ctx, eid, fileID)
	if err != nil {
		logger.Errorf(ctx, "【纪要】读取转写文本失败 fileID=%d err=%v", fileID, err)
		if client := keystone.GlobalClient; client != nil {
			client.ReportTaskStageCompleted(keystone.TaskEvent{
				ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
				TaskType:       "RECORDING_PIPELINE",
				StageKey:       "meeting_minutes",
				StageStatus:    keystone.TaskStatusFailed,
				FailureCode:    "MEETING_MINUTES_FAILED",
				FailureMessage: err.Error(),
				ServiceKey:     "recording-pipeline",
				FinishedAt:     time.Now().UTC(),
			})
		}
		setMeetingMinutesStatus(fileID, "failed")
		return fmt.Errorf("读取转写文本失败: %w", err)
	}

	// 3. 压缩转写文本（通过统一入口，传入原始 JSON 避免重复 DB 查询）
	prepared, err := getOrCompressTranscript(ctx, TranscriptPrepareRequest{
		EID:                eid,
		FileID:             fileID,
		Consumer:           "meeting_minutes",
		ContextLength:      getRecordingContextBudget(ctx, config),
		FixedInputTokens:   0,
		MaxOutputTokens:    4096,
		SafetyMargin:       500,
		Mode:               "strict",
		RawText:            transcriptText,
		InferenceModelID:   config.InferenceModelID,
		InferenceModelName: config.InferenceModelName,
	})
	if err != nil {
		logger.Errorf(ctx, "【纪要】转写压缩失败 fileID=%d err=%v", fileID, err)
		if client := keystone.GlobalClient; client != nil {
			client.ReportTaskStageCompleted(keystone.TaskEvent{
				ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
				TaskType:       "RECORDING_PIPELINE",
				StageKey:       "meeting_minutes",
				StageStatus:    keystone.TaskStatusFailed,
				FailureCode:    "MEETING_MINUTES_FAILED",
				FailureMessage: err.Error(),
				ServiceKey:     "recording-pipeline",
				FinishedAt:     time.Now().UTC(),
			})
		}
		setMeetingMinutesStatus(fileID, "failed")
		return fmt.Errorf("转写压缩失败: %w", err)
	}
	logger.Infof(ctx, "【纪要】转写压缩完成 fileID=%d inputKind=%s sourceTokens=%d resultTokens=%d cacheHit=%v degraded=%v",
		fileID, prepared.InputKind, prepared.SourceTokens, prepared.ResultTokens, prepared.CacheHit, prepared.Degraded)

	// 4. 调用 Prompt 2 生成纪要
	result, err := callMeetingMinutesLLM(ctx, config, fileID, prepared.Text, startedAt, endedAt)
	if err != nil {
		logger.Errorf(ctx, "【纪要】生成失败 fileID=%d err=%v", fileID, err)
		if client := keystone.GlobalClient; client != nil {
			client.ReportTaskStageCompleted(keystone.TaskEvent{
				ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
				TaskType:       "RECORDING_PIPELINE",
				StageKey:       "meeting_minutes",
				StageStatus:    keystone.TaskStatusFailed,
				FailureCode:    "MEETING_MINUTES_FAILED",
				FailureMessage: err.Error(),
				ServiceKey:     "recording-pipeline",
				FinishedAt:     time.Now().UTC(),
			})
		}
		setMeetingMinutesStatus(fileID, "failed")
		return fmt.Errorf("纪要生成失败: %w", err)
	}

	// 5. 加载 File 获取 LibraryID（FileBody 必填）
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		logger.Errorf(ctx, "【纪要】加载文件失败 fileID=%d err=%v", fileID, err)
		if client := keystone.GlobalClient; client != nil {
			client.ReportTaskStageCompleted(keystone.TaskEvent{
				ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
				TaskType:       "RECORDING_PIPELINE",
				StageKey:       "meeting_minutes",
				StageStatus:    keystone.TaskStatusFailed,
				FailureCode:    "MEETING_MINUTES_FAILED",
				FailureMessage: err.Error(),
				ServiceKey:     "recording-pipeline",
				FinishedAt:     time.Now().UTC(),
			})
		}
		setMeetingMinutesStatus(fileID, "failed")
		return fmt.Errorf("加载文件失败: %w", err)
	}
	resolvedOwnerID := resolveRecordingMinutesOwnerID(userID, file.UserID)
	if resolvedOwnerID != userID {
		logger.Warnf(ctx, "【纪要】user_id 无效，使用文件创建者 fileID=%d job_user_id=%d file_user_id=%d", fileID, userID, file.UserID)
		userID = resolvedOwnerID
	}

	// 6. transcriptText 已是原始 DashScope JSON（step 2 调用 loadTranscriptTextRaw 获取）
	// 直接用于存储反转，无需再读 FileBody--重生成时 FileBody 存的是旧纪要 JSON 而非转写原文

	// 7. 存储反转（录音文件特有设计，目的是最小改动复用 FileBody 作为"文件当前内容"载体）：
	//    反转前：FileBody=转写 JSON，Summary(-1) 不存在
	//    反转后：FileBody=纪要 JSON，Summary(-1)=转写 JSON（供 loadTranscriptTextRaw 读取）
	//    事务内：新建 Summary(-1) 存转写、新建 FileBody 存纪要、删旧 FileBody、删旧 Summary(0)/Summary(-1)
	transcriptSummary := &model.RecordingFileSummary{
		FileID:           fileID,
		TemplateID:       -1,
		TemplateName:     "转写原文",
		InferenceModelID: 0,
		SummaryContent:   model.LongText(transcriptText),
	}
	fileBody := &model.FileBody{
		Eid:       eid,
		FileID:    fileID,
		LibraryID: file.LibraryID,
		Content:   result,
		UserID:    userID,
	}

	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(transcriptSummary).Error; err != nil {
			return err
		}
		if err := tx.Create(fileBody).Error; err != nil {
			return err
		}
		// 删除旧 FileBody（含旧的转写或旧纪要），避免累积
		if err := tx.Where("file_id = ? AND id != ?", fileID, fileBody.ID).
			Delete(&model.FileBody{}).Error; err != nil {
			return err
		}
		if err := tx.Where("file_id = ? AND template_id = 0", fileID).
			Delete(&model.RecordingFileSummary{}).Error; err != nil {
			return err
		}
		if err := tx.Where("file_id = ? AND template_id = -1 AND id != ?", fileID, transcriptSummary.ID).
			Delete(&model.RecordingFileSummary{}).Error; err != nil {
			return err
		}
		return nil
	}); err != nil {
		logger.Errorf(ctx, "【纪要】存储反转失败 fileID=%d err=%v", fileID, err)
		if client := keystone.GlobalClient; client != nil {
			client.ReportTaskStageCompleted(keystone.TaskEvent{
				ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
				TaskType:       "RECORDING_PIPELINE",
				StageKey:       "meeting_minutes",
				StageStatus:    keystone.TaskStatusFailed,
				FailureCode:    "MEETING_MINUTES_FAILED",
				FailureMessage: err.Error(),
				ServiceKey:     "recording-pipeline",
				FinishedAt:     time.Now().UTC(),
			})
		}
		setMeetingMinutesStatus(fileID, "failed")
		return fmt.Errorf("存储反转失败: %w", err)
	}

	elapsed := time.Since(startTime)
	logger.Infof(ctx, "【纪要】生成成功 fileID=%d elapsed=%v", fileID, elapsed)

	// 纪要已经以新版本落库后，编译结构化会议记忆。编译失败不阻断纪要和洞察主链路，
	// GenerateInsights 仍会使用现有实体+历史纪要 fallback。
	if recordingMemoryExtractionEnabled(config) {
		if _, memoryErr := CompileRecordingMemory(ctx, eid, fileID, userID); memoryErr != nil {
			logger.Warnf(ctx, "【会议记忆】当前纪要编译失败，洞察将降级: fileID=%d err=%v", fileID, memoryErr)
		}
		if _, entityMemoryErr := CompileRecordingEntityMemory(ctx, eid, fileID, userID); entityMemoryErr != nil {
			logger.Warnf(ctx, "【实体记忆】当前纪要编译失败，洞察将降级: fileID=%d err=%v", fileID, entityMemoryErr)
		}
	}

	// 8. 按会议标题重命名文件（失败不阻塞管线）
	renameFileByMeetingTitle(ctx, eid, fileID, file, result)

	if client := keystone.GlobalClient; client != nil {
		client.ReportTaskStageCompleted(keystone.TaskEvent{
			ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
			TaskType:       "RECORDING_PIPELINE",
			StageKey:       "meeting_minutes",
			StageStatus:    keystone.TaskStatusSucceeded,
			ServiceKey:     "recording-pipeline",
			FinishedAt:     time.Now().UTC(),
		})
	}
	setMeetingMinutesStatus(fileID, "completed")

	return nil
}

func resolveRecordingMinutesOwnerID(userID, fileOwnerID int64) int64 {
	if userID <= 0 && fileOwnerID > 0 {
		return fileOwnerID
	}
	return userID
}

// loadTranscriptTextRaw 读取转写原文（DashScope ASR 原始 JSON，不提取）。
//
// 存储反转设计（见 GenerateMeetingMinutes step 7）：
//   - 反转前（纪要未生成）：转写 JSON 在 FileBody
//   - 反转后（纪要已生成）：转写 JSON 移到 Summary(template_id=-1)，纪要 JSON 进 FileBody
//
// 本函数双模式兼容两种状态。需要纯文本的调用方用 loadTranscriptText（自动提取）。
func loadTranscriptTextRaw(ctx context.Context, eid, fileID int64) (string, error) {
	// 反转后：转写在 Summary(template_id=-1)
	summary, err := model.GetSummaryByTemplateID(fileID, -1)
	if err == nil && summary != nil {
		return string(summary.SummaryContent), nil
	}

	// 反转前：转写在 FileBody
	fileBody, err := model.GetLastFileBodyByFileID(eid, fileID)
	if err != nil {
		return "", fmt.Errorf("获取 FileBody 失败: %w", err)
	}
	if fileBody == nil {
		return "", fmt.Errorf("FileBody 不存在")
	}

	content, err := fileBody.GetContent()
	if err != nil {
		return "", fmt.Errorf("读取 FileBody 内容失败: %w", err)
	}
	if strings.TrimSpace(content) == "" {
		return "", fmt.Errorf("FileBody 内容为空")
	}

	return content, nil
}

// loadTranscriptText 读取转写原文并提取纯文本（DashScope JSON -> 纯文本）。
// 非 JSON 格式时原样返回（降级兼容）。
func loadTranscriptText(ctx context.Context, eid, fileID int64) (string, error) {
	raw, err := loadTranscriptTextRaw(ctx, eid, fileID)
	if err != nil {
		return "", err
	}
	plain := extractTranscriptFromJSON(raw)
	if plain != "" {
		return plain, nil
	}
	return raw, nil
}

// LoadTranscriptText 导出版本，供 controller 调用（返回原始 JSON，不提取）。
func LoadTranscriptText(eid, fileID int64) (string, error) {
	return loadTranscriptTextRaw(context.Background(), eid, fileID)
}

// loadMinutesText 双模式读取纪要，并渲染为 Markdown（类似 tingwu 的 contentBuilder 模式）。
// 已反转：从 FileBody 读 JSON -> 渲染 Markdown；未反转：从 Summary(template_id=0) 读 JSON -> 渲染 Markdown。
func loadMinutesText(eid, fileID int64) (string, error) {
	var raw string
	if model.HasTranscriptSummary(fileID) {
		// 已反转：纪要在 FileBody
		fileBody, err := model.GetLastFileBodyByFileID(eid, fileID)
		if err != nil {
			return "", fmt.Errorf("读取 FileBody 失败: %w", err)
		}
		raw, err = fileBody.GetContent()
		if err != nil {
			return "", err
		}
	} else {
		// 未反转：纪要在 Summary(template_id=0)
		summary, err := model.GetSummaryByTemplateID(fileID, 0)
		if err != nil {
			return "", fmt.Errorf("读取纪要失败: %w", err)
		}
		raw = string(summary.SummaryContent)
	}
	return BuildMinutesMarkdown(raw), nil
}

// extractJSON 从 LLM 输出中提取 JSON 内容。
// 参考：https://lawzava.com/blog/2024-04-29-structured-output-patterns/
// 处理三种常见情况：
//  1. 被 markdown 代码块包裹（```json ... ```）
//  2. 前后有自然语言说明文字（如 "Here is the summary: {...}"）
//  3. 纯 JSON
func extractJSON(raw string) string {
	s := strings.TrimSpace(raw)

	// Step 1: 去除 markdown 代码块标记
	if strings.HasPrefix(s, "```") {
		lines := strings.Split(s, "\n")
		// 去掉第一行（```json、```javascript 等）
		start := 1
		// 去掉最后一行（```），如果倒数第二行是 ``` 则也去掉
		end := len(lines) - 1
		if end > start && strings.TrimSpace(lines[end-1]) == "```" {
			end = end - 1
		}
		s = strings.Join(lines[start:end], "\n")
		s = strings.TrimSpace(s)
	}

	// Step 2: 从前后文字中提取 JSON 对象或数组
	// 先找 { } 对象
	if firstBrace := strings.Index(s, "{"); firstBrace >= 0 {
		if lastBrace := strings.LastIndex(s, "}"); lastBrace > firstBrace {
			return s[firstBrace : lastBrace+1]
		}
	}
	// 再找 [ ] 数组
	if firstBracket := strings.Index(s, "["); firstBracket >= 0 {
		if lastBracket := strings.LastIndex(s, "]"); lastBracket > firstBracket {
			return s[firstBracket : lastBracket+1]
		}
	}

	return s
}

// BuildMinutesMarkdown 将 Prompt 2 输出的纪要 JSON 渲染为可读 Markdown。
// 类似 tingwu 的 contentBuilder 模式：代码从结构化 JSON 拼接内容块，而非让 LLM 输出 Markdown。
// 解析失败时返回 Markdown 格式错误提示，不暴露原始数据。
func BuildMinutesMarkdown(raw string) string {
	// 1+2: 空或空白输入直接返回，避免 json.Unmarshal 返回 raw
	if strings.TrimSpace(raw) == "" {
		return ""
	}

	cleaned := extractJSON(raw)
	// 8: 剥离 BOM 字符
	cleaned = strings.TrimPrefix(cleaned, "\ufeff")

	var data map[string]interface{}
	if err := json.Unmarshal([]byte(cleaned), &data); err != nil {
		// 标准解析失败 → 尝试 jsonrepair 修复常见 JSON 格式问题
		// 修复：缺失引号、单引号、多余逗号、缺失括号、截断、Python 常量、注释等
		if repaired, repairErr := jsonrepair.RepairJSON(cleaned); repairErr == nil && repaired != cleaned {
			if err := json.Unmarshal([]byte(repaired), &data); err == nil {
				cleaned = repaired
				goto RENDER
			}
			cleaned = repaired
		}

		// 修复后仍不是预期结构，返回 Markdown 格式错误提示
		return "> 纪要解析失败。"
	}

RENDER:

	var b strings.Builder

	// 1. 会议头部
	if meeting, ok := data["meeting"].(map[string]interface{}); ok {
		if title, ok := meeting["title"].(string); ok && title != "" {
			b.WriteString(fmt.Sprintf("# %s\n\n", title))
		}
		var meta []string
		if s, ok := meeting["started_at"].(string); ok && s != "" {
			meta = append(meta, fmt.Sprintf("开始: %s", s))
		}
		if e, ok := meeting["ended_at"].(string); ok && e != "" {
			meta = append(meta, fmt.Sprintf("结束: %s", e))
		}
		if dur, ok := meeting["duration_seconds"].(float64); ok && dur > 0 {
			minutes := int(dur) / 60
			meta = append(meta, fmt.Sprintf("时长: %d分钟", minutes))
		}
		if len(meta) > 0 {
			b.WriteString(fmt.Sprintf("> %s\n\n", strings.Join(meta, " | ")))
		}
		if participants, ok := meeting["participants"].([]interface{}); ok && len(participants) > 0 {
			var names []string
			for _, p := range participants {
				if pm, ok := p.(map[string]interface{}); ok {
					if name, ok := pm["name"].(string); ok && name != "" {
						names = append(names, name)
					}
				}
			}
			if len(names) > 0 {
				b.WriteString(fmt.Sprintf("**参与者**：%s\n\n", strings.Join(names, "、")))
			}
		}
	} else {
		b.WriteString("# 会议纪要\n\n")
	}

	// 2. 执行摘要
	b.WriteString("## 执行摘要\n\n")
	if exec, ok := data["executive_summary"].(string); ok && exec != "" {
		b.WriteString(exec)
		b.WriteString("\n\n")
	} else {
		b.WriteString("（无）\n\n")
	}

	// 3. 会议内容（sections）
	b.WriteString("## 会议内容\n\n")
	if sections, ok := data["sections"].([]interface{}); ok && len(sections) > 0 {
		for _, s := range sections {
			section, ok := s.(map[string]interface{})
			if !ok {
				continue
			}
			title, _ := section["title"].(string)
			summary, _ := section["summary"].(string)
			if title == "" && summary == "" {
				continue
			}
			if title != "" {
				b.WriteString(fmt.Sprintf("### %s\n\n", title))
			}
			if summary != "" {
				b.WriteString(summary)
				b.WriteString("\n\n")
			}
		}
	} else {
		b.WriteString("（无）\n\n")
	}

	// 4. 关键决策
	b.WriteString("## 关键决策\n\n")
	if decisions, ok := data["decisions"].([]interface{}); ok && len(decisions) > 0 {
		for _, d := range decisions {
			dec, ok := d.(map[string]interface{})
			if !ok {
				continue
			}
			content, _ := dec["content"].(string)
			if content == "" {
				continue
			}
			status, _ := dec["status"].(string)
			maker, _ := dec["decision_maker"].(string)
			reason, _ := dec["reason"].(string)

			b.WriteString(fmt.Sprintf("- **%s**", content))
			if status != "" {
				b.WriteString(fmt.Sprintf("（%s）", status))
			}
			b.WriteString("\n")
			if maker != "" {
				b.WriteString(fmt.Sprintf("  - 决策人：%s\n", maker))
			}
			if reason != "" {
				b.WriteString(fmt.Sprintf("  - 原因：%s\n", reason))
			}
		}
		b.WriteString("\n")
	} else {
		b.WriteString("（无）\n\n")
	}

	// 5. 行动项
	b.WriteString("## 行动项\n\n")
	if actions, ok := data["actions"].([]interface{}); ok && len(actions) > 0 {
		for i, a := range actions {
			act, ok := a.(map[string]interface{})
			if !ok {
				continue
			}
			content, _ := act["content"].(string)
			if content == "" {
				continue
			}
			owner, _ := act["owner"].(string)
			deadline, _ := act["deadline"].(string)
			deliverable, _ := act["deliverable"].(string)
			acceptance, _ := act["acceptance_criteria"].(string)

			b.WriteString(fmt.Sprintf("%d. **%s**\n", i+1, content))
			if owner != "" {
				b.WriteString(fmt.Sprintf("   - 负责人：%s\n", owner))
			}
			if deadline != "" {
				b.WriteString(fmt.Sprintf("   - 截止时间：%s\n", deadline))
			}
			if deliverable != "" {
				b.WriteString(fmt.Sprintf("   - 交付物：%s\n", deliverable))
			}
			if acceptance != "" {
				b.WriteString(fmt.Sprintf("   - 验收标准：%s\n", acceptance))
			}
		}
		b.WriteString("\n")
	} else {
		b.WriteString("（无）\n\n")
	}

	// 6. 待解决问题
	b.WriteString("## 待解决问题\n\n")
	if issues, ok := data["issues"].([]interface{}); ok && len(issues) > 0 {
		for _, iss := range issues {
			issue, ok := iss.(map[string]interface{})
			if !ok {
				continue
			}
			content, _ := issue["content"].(string)
			if content == "" {
				continue
			}
			status, _ := issue["status"].(string)
			impact, _ := issue["impact"].(string)

			b.WriteString(fmt.Sprintf("- **%s**", content))
			if status != "" {
				b.WriteString(fmt.Sprintf("（%s）", status))
			}
			b.WriteString("\n")
			if impact != "" {
				b.WriteString(fmt.Sprintf("  - 影响：%s\n", impact))
			}
		}
		b.WriteString("\n")
	} else {
		b.WriteString("（无）\n\n")
	}

	// 7. 风险
	b.WriteString("## 风险\n\n")
	if risks, ok := data["risks"].([]interface{}); ok && len(risks) > 0 {
		for _, r := range risks {
			risk, ok := r.(map[string]interface{})
			if !ok {
				continue
			}
			title, _ := risk["title"].(string)
			desc, _ := risk["description"].(string)
			severityStr, _ := risk["severity"].(string)
			if title == "" {
				continue
			}

			b.WriteString(fmt.Sprintf("- **%s**", title))
			if severityStr != "" {
				b.WriteString(fmt.Sprintf("（严重程度：%s）", severityStr))
			}
			b.WriteString("\n")
			if desc != "" {
				b.WriteString(fmt.Sprintf("  - %s\n", desc))
			}
		}
		b.WriteString("\n")
	} else {
		b.WriteString("（无）\n\n")
	}

	// 8. 关键引用
	b.WriteString("## 关键引用\n\n")
	if quotes, ok := data["key_quotes"].([]interface{}); ok && len(quotes) > 0 {
		for _, q := range quotes {
			quote, ok := q.(map[string]interface{})
			if !ok {
				continue
			}
			text, _ := quote["quote"].(string)
			if text == "" {
				continue
			}
			speaker, _ := quote["speaker"].(string)

			b.WriteString(fmt.Sprintf("> %s\n", text))
			if speaker != "" {
				b.WriteString(fmt.Sprintf("> —— %s\n", speaker))
			}
			b.WriteString("\n")
		}
	} else {
		b.WriteString("（无）\n\n")
	}

	// 9. 未决问题
	b.WriteString("## 未决问题\n\n")
	if questions, ok := data["open_questions"].([]interface{}); ok && len(questions) > 0 {
		for _, q := range questions {
			question, ok := q.(map[string]interface{})
			if !ok {
				continue
			}
			content, _ := question["content"].(string)
			if content == "" {
				continue
			}
			why, _ := question["why_important"].(string)

			b.WriteString(fmt.Sprintf("- %s\n", content))
			if why != "" {
				b.WriteString(fmt.Sprintf("  - 重要性：%s\n", why))
			}
		}
		b.WriteString("\n")
	} else {
		b.WriteString("（无）\n\n")
	}

	result := strings.TrimSpace(b.String())
	if result == "" {
		return "> 纪要解析失败。"
	}
	return result
}

// extractTranscriptFromJSON 提取转写纯文本。支持两种来源格式：
//  1. SonicNote：JSON 数组 [{spokesperson,text,time}, ...]（逐条取 text 拼接）
//  2. DashScope：{"transcripts":[{"text":...}]}（含外层 text 兜底）
//
// 非 JSON 或内容为空返回 ""，调用方维持现有退化行为。
func extractTranscriptFromJSON(raw string) string {
	// 先尝试 SonicNote 数组格式（DashScope 是对象，unmarshal 进数组会报错，自动落到下方）
	var sonicItems []map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &sonicItems); err == nil && len(sonicItems) > 0 {
		var texts []string
		for _, it := range sonicItems {
			if text, ok := it["text"].(string); ok && strings.TrimSpace(text) != "" {
				texts = append(texts, strings.TrimSpace(text))
			}
		}
		if len(texts) > 0 {
			return strings.Join(texts, "\n\n")
		}
		return ""
	}

	var data map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		return ""
	}

	transcripts, ok := data["transcripts"].([]interface{})
	if !ok || len(transcripts) == 0 {
		return ""
	}

	var texts []string
	for _, t := range transcripts {
		tMap, ok := t.(map[string]interface{})
		if !ok {
			continue
		}
		if text, ok := tMap["text"].(string); ok && strings.TrimSpace(text) != "" {
			texts = append(texts, strings.TrimSpace(text))
		}
	}

	if len(texts) == 0 {
		// 尝试直接取最外层 text
		if text, ok := data["text"].(string); ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
		return ""
	}

	return strings.Join(texts, "\n\n")
}

// chunkTranscript 将转写文本按段落分片，每片不超过 maxChars 字符。
func chunkTranscript(text string, maxChars int) []string {
	if maxChars <= 0 {
		return []string{text}
	}
	runes := []rune(text)
	if len(runes) <= maxChars {
		return []string{text}
	}

	paragraphs := strings.Split(text, "\n\n")
	var chunks []string
	var current strings.Builder
	currentLen := 0

	for _, para := range paragraphs {
		paraRunes := len([]rune(para))

		if paraRunes > maxChars {
			if currentLen > 0 {
				chunks = append(chunks, current.String())
				current.Reset()
				currentLen = 0
			}
			sentences := splitBySentence(para)
			for _, sent := range sentences {
				sentRunes := len([]rune(sent))
				if currentLen+sentRunes > maxChars && currentLen > 0 {
					chunks = append(chunks, current.String())
					current.Reset()
					currentLen = 0
				}
				current.WriteString(sent)
				currentLen += sentRunes
			}
			continue
		}

		if currentLen+paraRunes > maxChars && currentLen > 0 {
			chunks = append(chunks, current.String())
			current.Reset()
			currentLen = 0
		}
		current.WriteString(para)
		current.WriteString("\n\n")
		currentLen += paraRunes + 2
	}

	if currentLen > 0 {
		chunks = append(chunks, current.String())
	}
	return chunks
}

// splitBySentence 按句末标点分割文本。
func splitBySentence(text string) []string {
	var sentences []string
	var current strings.Builder
	for _, r := range text {
		current.WriteRune(r)
		if r == '。' || r == '！' || r == '？' || r == '.' || r == '!' || r == '?' {
			sentences = append(sentences, current.String())
			current.Reset()
		}
	}
	if current.Len() > 0 {
		sentences = append(sentences, current.String())
	}
	return sentences
}

// callMeetingMinutesLLM 直接调用 Prompt 2 生成会议纪要。
func callMeetingMinutesLLM(ctx context.Context, config *model.RecordingConfig, fileID int64, transcript string, startedAt, endedAt int64) (string, error) {
	buildRequest := func() *relaymodel.GeneralOpenAIRequest {
		startedAtStr := ""
		endedAtStr := ""
		if startedAt > 0 {
			startedAtStr = time.UnixMilli(startedAt).UTC().Format(time.RFC3339)
		}
		if endedAt > 0 {
			endedAtStr = time.UnixMilli(endedAt).UTC().Format(time.RFC3339)
		}
		userPrompt := fmt.Sprintf(`请根据以下规范化逐字稿生成会议纪要和结构化会议知识。

<meeting_metadata>
{
  "meeting_id": "%d",
  "started_at": "%s",
  "ended_at": "%s"
}
</meeting_metadata>

<normalized_transcript>
%s
</normalized_transcript>

<known_entities>
{}
</known_entities>

严格按照系统要求输出 JSON。`, fileID, startedAtStr, endedAtStr, transcript)

		return &relaymodel.GeneralOpenAIRequest{
			Model: config.InferenceModelName,
			Messages: []relaymodel.Message{
				{Role: "system", Content: prompt2SystemPrompt},
				{Role: "user", Content: userPrompt},
			},
		}
	}

	return callLLMWithRetry(ctx, config, buildRequest)
}

// setStageStatus 更新 FileCleaningRuleInfo 中指定阶段的状态。
// 使用 SELECT FOR UPDATE 事务，防止与 UpdateFileCleaningRuleInfoHelper 的并发读写竞态。
func setStageStatus(fileID int64, stage, status string) {
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		var file model.File
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("cleaning_rule_info").First(&file, fileID).Error; err != nil {
			return err
		}
		var info model.FileCleaningRuleInfo
		if file.CleaningRuleInfo != "" {
			json.Unmarshal([]byte(file.CleaningRuleInfo), &info)
		}
		switch stage {
		case "meeting_minutes":
			info.MeetingMinutesStatus = status
		case "insights":
			info.InsightsStatus = status
		case "insight_page":
			info.InsightPageStatus = status
		case "transcription":
			info.TranscriptionStatus = status
		}
		data, _ := json.Marshal(info)
		return tx.Model(&model.File{}).Where("id = ?", fileID).
			Update("cleaning_rule_info", string(data)).Error
	}); err != nil {
		logger.Warn(context.Background(), fmt.Sprintf("setStageStatus failed: fileID=%d, stage=%s, err=%v", fileID, stage, err))
	}
}

// setMeetingMinutesStatus 更新 cleaning_rule_info 中的纪要状态。
func setMeetingMinutesStatus(fileID int64, status string) {
	setStageStatus(fileID, "meeting_minutes", status)
}

// setInsightsStatus 更新 cleaning_rule_info 中的洞察状态。
func setInsightsStatus(fileID int64, status string) {
	setStageStatus(fileID, "insights", status)
}

// setInsightPageStatus 更新 cleaning_rule_info 中的页面编排状态。
func setInsightPageStatus(fileID int64, status string) {
	setStageStatus(fileID, "insight_page", status)
}

// SetInsightsStatus 公开导出，供 controller 直接调用触发洞察状态更新。
func SetInsightsStatus(fileID int64, status string) {
	setInsightsStatus(fileID, status)
}

// SetInsightPageStatus 公开导出，供 controller 直接调用触发页面编排状态更新。
func SetInsightPageStatus(fileID int64, status string) {
	setInsightPageStatus(fileID, status)
}

// setTranscriptionStatus 更新 cleaning_rule_info 中的转写状态（独立于 parsing_status，避免被 RAG 管线失败覆盖）。
func setTranscriptionStatus(fileID int64, status string) {
	setStageStatus(fileID, "transcription", status)
}

// callLLMWithRetry 调用 LLM，失败时自动重试（指数退避，最多 2 次）。
// 重试 2 次 + 单次超时 120s 是录音场景的合理折中：临时故障（如 429）可恢复，
// 若仍失败用户可手动重试。避免 3 次重试累计 17s+ 的等待和 3×180s 的超时。
// 定义为变量以便测试时替换为 mock。
var callLLMWithRetry = func(ctx context.Context, config *model.RecordingConfig, buildRequest func() *relaymodel.GeneralOpenAIRequest) (string, error) {
	channel, err := model.GetChannelByID(config.InferenceModelID)
	if err != nil {
		return "", fmt.Errorf("获取推理模型渠道失败: %w", err)
	}

	generator := rag.NewContentGeneratorService(model.DB)
	maxRetries := 2
	baseDelay := 2 * time.Second

	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			delay := time.Duration(math.Pow(2, float64(attempt))) * baseDelay
			// 加入随机抖动，防止多个请求同时重试
			jitter := time.Duration(rand.Int63n(int64(delay / 2)))
			timer := time.NewTimer(delay + jitter)
			select {
			case <-ctx.Done():
				timer.Stop()
				return "", ctx.Err()
			case <-timer.C:
			}
		}

		// 获取信号量，限制并发
		llmSemaphore <- struct{}{}
		request := buildRequest()
		ctxTimeout, cancel := context.WithTimeout(ctx, 120*time.Second)
		result, err, openAIErr := generator.TestChannel(ctxTimeout, channel, request)
		cancel()
		<-llmSemaphore

		if err == nil {
			return result, nil
		}

		// 非重试性错误直接返回，不浪费重试
		if openAIErr != nil {
			// 优先用类型断言判断 HTTP 状态码
			if httpCode, ok := openAIErr.Code.(float64); ok {
				code := int(httpCode)
				if code == 401 || code == 403 || code == 400 {
					errorType := model.ErrorTypeModelUnavailable
					if code == 401 || code == 403 {
						errorType = model.ErrorTypeAPIKeyInvalid
					}
					return "", &model.LLMError{
						Err:       fmt.Errorf("非重试性错误: %w (http_code=%d)", err, code),
						ErrorType: errorType,
					}
				}
				if code == 402 {
					return "", &model.LLMError{
						Err:       fmt.Errorf("非重试性错误: %w (http_code=%d)", err, code),
						ErrorType: model.ErrorTypeInsufficientBalance,
					}
				}
			}
			// 字符串匹配作为兜底
			codeStr := fmt.Sprintf("%v", openAIErr.Code)
			if strings.Contains(codeStr, "invalid") || strings.Contains(codeStr, "unauthorized") {
				return "", &model.LLMError{
					Err:       fmt.Errorf("非重试性错误: %w (raw_code=%v)", err, openAIErr.Code),
					ErrorType: model.ErrorTypeAPIKeyInvalid,
				}
			}
		}

		lastErr = fmt.Errorf("attempt %d: %w (openai_err=%v)", attempt+1, err, openAIErr)
		logger.Warnf(ctx, "【LLM】调用失败，准备重试 attempt=%d err=%v", attempt+1, lastErr)
	}
	// 所有重试都失败，判断错误类型
	lastErrMsg := lastErr.Error()
	if strings.Contains(lastErrMsg, "http_code=402") || strings.Contains(lastErrMsg, "Insufficient Balance") || strings.Contains(lastErrMsg, "insufficient") {
		return "", &model.LLMError{
			Err:       lastErr,
			ErrorType: model.ErrorTypeInsufficientBalance,
		}
	}
	if strings.Contains(lastErrMsg, "timeout") || strings.Contains(lastErrMsg, "Timeout") || strings.Contains(lastErrMsg, "deadline") {
		return "", &model.LLMError{
			Err:       lastErr,
			ErrorType: model.ErrorTypeTimeout,
		}
	}
	return "", &model.LLMError{
		Err:       lastErr,
		ErrorType: model.ErrorTypeModelUnavailable,
	}
}

// GetFileParseStatus 获取文件的四阶段解析状态及管线可达性。
func GetFileParseStatus(eid, fileID int64) map[string]interface{} {
	result := map[string]interface{}{
		"transcription":   map[string]interface{}{"status": "pending", "pipeline": "inactive", "updated_at": int64(0)},
		"meeting_minutes": map[string]interface{}{"status": "pending", "pipeline": "inactive", "updated_at": int64(0)},
		"insights":        map[string]interface{}{"status": "pending", "pipeline": "inactive", "updated_at": int64(0)},
		"insight_page":    map[string]interface{}{"status": "pending", "pipeline": "inactive", "updated_at": int64(0)},
	}

	// 带 eid 校验文件归属，防止跨企业访问
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return result
	}

	// 最新 document_parsing job 状态：用于无转写内容时区分"处理中/失败/未开始"
	var parsingJobStatus string
	model.DB.Model(&model.RagJob{}).
		Where("eid = ? AND related_id = ? AND type = ?", eid, fileID, "document_parsing").
		Order("job_id DESC").Limit(1).Pluck("status", &parsingJobStatus)

	// 转写状态：优先使用 cleaning_rule_info 中的独立字段，避免被 RAG 管线的 parsing_status 覆盖
	transcription := result["transcription"].(map[string]interface{})
	var ruleInfo model.FileCleaningRuleInfo
	if file.CleaningRuleInfo != "" {
		json.Unmarshal([]byte(file.CleaningRuleInfo), &ruleInfo)
	}
	if ruleInfo.TranscriptionStatus != "" {
		transcription["status"] = ruleInfo.TranscriptionStatus
		if ruleInfo.TranscriptionStatus == "failed" {
			if ruleInfo.TranscriptionError != "" {
				transcription["error"] = ruleInfo.TranscriptionError
			}
			if ruleInfo.TranscriptionErrorType != "" {
				transcription["error_type"] = ruleInfo.TranscriptionErrorType
			}
		}
	} else {
		// 无录音管线专用转写状态（如走了通用文档管线）：按实际判定，
		// 避免盲目兜底 parsing_status（其 "normal" 会掩盖 document_parsing 失败、无转写的事实）。
		if txt, terr := loadTranscriptTextRaw(context.Background(), eid, fileID); terr == nil && strings.TrimSpace(txt) != "" {
			// 已有转写内容（Summary(-1) 或 FileBody）→ completed
			// （即使最近一次 document_parsing 失败、旧转写残留，也以"有数据可导出"为准）
			transcription["status"] = "completed"
		} else if ruleInfo.StepKey == "document_parsing" && ruleInfo.Status == "failed" {
			// 无转写内容且文档解析（对录音即转写）步骤失败 → failed
			transcription["status"] = "failed"
			transcription["error"] = "文档解析（转写）失败"
		} else {
			// 无转写内容且无录音管线专用转写状态：按 document_parsing job 状态区分，
			// 避免 "pending" 混淆"正在处理"与"从未开始/不会自动处理"。
			switch parsingJobStatus {
			case model.RagJobStatusPending, model.RagJobStatusProcessing:
				// 有转写 job 排队/执行中 → 处理中（会有任务自动完成）
				transcription["status"] = "processing"
			case model.RagJobStatusSuccess:
				// job 已成功但无转写内容（如静音/ASR 返回空）→ 不能误报"未触发"，
				// 明确提示"已完成但无内容"，避免与"从未触发"混淆
				transcription["status"] = "failed"
				transcription["error"] = "转写已完成但未识别到转写内容"
			case model.RagJobStatusPaused:
				// job 被暂停（系统级）→ 非终态，保持处理中语义，避免误报"未触发/失败"
				transcription["status"] = "processing"
			case model.RagJobStatusFailed, model.RagJobStatusCancelled:
				// 转写 job 失败（且 cleaning_rule_info 未标记失败）→ failed
				transcription["status"] = "failed"
				transcription["error"] = "文档解析（转写）失败"
			default:
				// 无转写 job → 没有任何任务会自动处理该文件（转写管线靠 job 驱动），
				// pending 会永久停留误导用户等待 → 直接 failed，提示需手动触发转写
				transcription["status"] = "failed"
				transcription["error"] = "未触发转写任务，需手动处理"
			}
		}
	}
	transcription["updated_at"] = file.UpdatedTime

	// 纪要状态：直接用 MeetingMinutesStatus（不依赖 Summary(0)）
	meetingMinutes := result["meeting_minutes"].(map[string]interface{})
	if ruleInfo.MeetingMinutesStatus != "" {
		meetingMinutes["status"] = ruleInfo.MeetingMinutesStatus
		meetingMinutes["updated_at"] = file.UpdatedTime
		if ruleInfo.MeetingMinutesStatus == "failed" {
			if ruleInfo.MeetingMinutesError != "" {
				meetingMinutes["error"] = ruleInfo.MeetingMinutesError
			}
			if ruleInfo.MeetingMinutesErrorType != "" {
				meetingMinutes["error_type"] = ruleInfo.MeetingMinutesErrorType
			}
		}
	}
	if ruleInfo.InsightsStatus != "" {
		insights := result["insights"].(map[string]interface{})
		insights["status"] = ruleInfo.InsightsStatus
		insights["updated_at"] = file.UpdatedTime
		if ruleInfo.InsightsStatus == "failed" {
			if ruleInfo.InsightsError != "" {
				insights["error"] = ruleInfo.InsightsError
			}
			if ruleInfo.InsightsErrorType != "" {
				insights["error_type"] = ruleInfo.InsightsErrorType
			}
		}
	}
	if ruleInfo.InsightPageStatus != "" {
		insightPage := result["insight_page"].(map[string]interface{})
		insightPage["status"] = ruleInfo.InsightPageStatus
		insightPage["updated_at"] = file.UpdatedTime
	}

	// 洞察状态
	insights := result["insights"].(map[string]interface{})
	if file.InsightSummary != "" {
		insights["status"] = "completed"
		insights["updated_at"] = file.UpdatedTime
	}

	// 页面编排状态
	insightPage := result["insight_page"].(map[string]interface{})
	if page, err := model.GetRecordingFileInsightPageByFileID(fileID); err == nil && page != nil {
		insightPage["status"] = "completed"
		insightPage["updated_at"] = page.UpdatedTime
	} else if ruleInfo.InsightPageStatus != "" {
		insightPage["updated_at"] = file.UpdatedTime
	}

	_, ragJobs, _, ragErr := GetLatestRunJobsWithStepsByRelatedID(context.Background(), eid, fileID)
	if ragErr == nil {
		var parsingJobStatus, chunkingJobStatus string
		for _, job := range ragJobs {
			switch job.Type {
			case "document_parsing":
				parsingJobStatus = job.Status
			case "document_chunking":
				chunkingJobStatus = job.Status
			}
		}

		isActive := func(s string) bool {
			return s == model.RagJobStatusPending || s == model.RagJobStatusProcessing
		}
		isFailed := func(s string) bool {
			return s == model.RagJobStatusFailed || s == model.RagJobStatusCancelled
		}

		parsingPipeline := "inactive"
		if isActive(parsingJobStatus) {
			parsingPipeline = "active"
		} else if isFailed(parsingJobStatus) {
			parsingPipeline = "failed"
		}
		result["transcription"].(map[string]interface{})["pipeline"] = parsingPipeline
		result["meeting_minutes"].(map[string]interface{})["pipeline"] = parsingPipeline

		insightsPipeline := "inactive"
		if ruleInfo.InsightsStatus == "processing" {
			insightsPipeline = "active"
		} else if isActive(chunkingJobStatus) && !isFailed(parsingJobStatus) {
			insightsPipeline = "active"
		} else if isActive(parsingJobStatus) {
			insightsPipeline = "active"
		} else if ruleInfo.InsightsStatus == "failed" {
			insightsPipeline = "failed"
		} else if isFailed(chunkingJobStatus) {
			insightsPipeline = "failed"
		} else if isFailed(parsingJobStatus) {
			insightsPipeline = "failed"
		}
		result["insights"].(map[string]interface{})["pipeline"] = insightsPipeline

		pagePipeline := "inactive"
		if ruleInfo.InsightPageStatus == "processing" {
			pagePipeline = "active"
		} else if ruleInfo.InsightsStatus == "processing" {
			pagePipeline = "active"
		} else if isActive(chunkingJobStatus) && !isFailed(parsingJobStatus) {
			pagePipeline = "active"
		} else if isActive(parsingJobStatus) {
			pagePipeline = "active"
		} else if ruleInfo.InsightsStatus == "failed" {
			pagePipeline = "failed"
		} else if isFailed(chunkingJobStatus) {
			pagePipeline = "failed"
		} else if isFailed(parsingJobStatus) {
			pagePipeline = "failed"
		}
		result["insight_page"].(map[string]interface{})["pipeline"] = pagePipeline

		// 为 insights 补充 pending_reason，解释为什么还没开始
		insights = result["insights"].(map[string]interface{})
		insStat, _ := insights["status"].(string)
		insPipe, _ := insights["pipeline"].(string)

		switch {
		case insStat == "completed" || insStat == "processing":
			// 已完成或正在生成，不需要原因
		case insStat == "skipped":
			insights["pending_reason"] = "model_not_configured"
		case insStat == "pending" && insPipe == "active" && isActive(chunkingJobStatus):
			insights["pending_reason"] = "waiting_for_entity_extraction"
		case insStat == "pending" && insPipe == "active" && isActive(parsingJobStatus):
			insights["pending_reason"] = "waiting_for_parsing"
		case insStat == "pending" && insPipe == "inactive":
			insights["pending_reason"] = "waiting_for_manual_trigger"
		case insStat == "pending" && insPipe == "failed":
			insights["pending_reason"] = "step_failed"
		}
	}

	return result
}

// CountMyQueuedFiles 统计当前用户排队中的录音文件数（RAG 任务 status=pending）。
func CountMyQueuedFiles(eid, userID int64) int64 {
	var count int64
	model.DB.Model(&model.RagJob{}).
		Joins("JOIN files f ON f.id = rag_jobs.related_id").
		Where("f.eid = ? AND f.user_id = ? AND f.origin_type IN ? AND rag_jobs.status = ?",
			eid, userID, model.RecordingOriginTypes(), model.RagJobStatusPending).
		Count(&count)
	return count
}

// sanitizeMeetingTitle 清理会议标题使其可作为文件名。
// 替换路径分隔符和非法字符，截断超长标题。
func sanitizeMeetingTitle(title string) string {
	name := strings.TrimSpace(title)
	if name == "" {
		return ""
	}
	name = strings.NewReplacer(
		"/", "_", "\\", "_", ":", "_",
		"*", "_", "?", "_", "\"", "_",
		"<", "_", ">", "_", "|", "_",
	).Replace(name)
	name = strings.Trim(name, ". ")
	if r := []rune(name); len(r) > 100 {
		name = string(r[:100])
	}
	return name
}

// ensureUniqueRecordingFilePath 确保路径在同库下唯一，冲突时追加（1）（2）...
// excludeFileID: 排除的文件ID（重命名场景下排除自身）。
func ensureUniqueRecordingFilePath(eid, libraryID int64, targetPath string, excludeFileID int64) (string, error) {
	existing, err := model.GetFileByPathAndLibraryNotDeleted(eid, libraryID, targetPath)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", err
	}
	if existing == nil || existing.ID == excludeFileID {
		return targetPath, nil
	}

	// 分离基名与扩展名：冲突序号（1）（2）... 应插入扩展名前（如 标题（1）.mp3.md），
	// 而不是追加到扩展名后（标题.mp3（1）.md）。
	name := strings.TrimSuffix(path.Base(targetPath), ".md")
	ext := path.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for i := 1; i <= 1000; i++ {
		candidate := fmt.Sprintf("/%s（%d）%s.md", base, i, ext)
		existingCandidate, candidateErr := model.GetFileByPathAndLibraryNotDeleted(eid, libraryID, candidate)
		if candidateErr != nil && !errors.Is(candidateErr, gorm.ErrRecordNotFound) {
			return "", candidateErr
		}
		if existingCandidate == nil || existingCandidate.ID == excludeFileID {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("cannot generate unique recording file path")
}

// renameFileByMeetingTitle 纪要生成后将文件重命名为会议标题。
// 失败不阻塞管线，仅记录日志。
func renameFileByMeetingTitle(ctx context.Context, eid, fileID int64, file *model.File, minutesJSON string) {
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(minutesJSON), &data); err != nil {
		logger.Infof(ctx, "【纪要】重命名跳过：JSON解析失败 fileID=%d err=%v", fileID, err)
		return
	}
	meeting, ok := data["meeting"].(map[string]interface{})
	if !ok {
		logger.Infof(ctx, "【纪要】重命名跳过：缺少meeting字段 fileID=%d", fileID)
		return
	}
	title, ok := meeting["title"].(string)
	if !ok || strings.TrimSpace(title) == "" {
		logger.Infof(ctx, "【纪要】重命名跳过：title为空 fileID=%d", fileID)
		return
	}

	sanitized := sanitizeMeetingTitle(title)
	if sanitized == "" {
		logger.Infof(ctx, "【纪要】重命名跳过：清理后标题为空 fileID=%d", fileID)
		return
	}

	// 保留原始文件扩展名，最后追加 .md
	// 如果文件已有 .md 后缀（如 .m4a.md），先去掉 .md 再取真实扩展名
	extractPath := strings.TrimSuffix(file.Path, ".md")
	ext := path.Ext(extractPath)
	newPath := "/" + sanitized + ext + ".md"

	if newPath == file.Path {
		logger.Infof(ctx, "【纪要】重命名跳过：路径未变 fileID=%d path=%s", fileID, newPath)
		return
	}

	uniquePath, err := ensureUniqueRecordingFilePath(eid, file.LibraryID, newPath, fileID)
	if err != nil {
		logger.Errorf(ctx, "【纪要】重命名失败：重名检查出错 fileID=%d err=%v", fileID, err)
		return
	}

	result := model.DB.Model(&model.File{}).
		Where("id = ? AND eid = ?", fileID, eid).
		Update("path", uniquePath)
	if result.Error != nil {
		logger.Errorf(ctx, "【纪要】重命名失败：DB更新出错 fileID=%d err=%v", fileID, result.Error)
		return
	}

	oldPath := file.Path
	file.Path = uniquePath
	elasticsearch.SyncFileToES(file, "update")
	logger.Infof(ctx, "【纪要】重命名成功 fileID=%d oldPath=%s newPath=%s", fileID, oldPath, uniquePath)
}
