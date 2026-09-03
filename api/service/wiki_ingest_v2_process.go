package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

type wikiPromptLLMRunner struct {
	generator     *rag.ContentGeneratorService
	config        *rag.ChunkConfig
	usageRecorder *WikiPromptUsageRecorder
}

type WikiPromptRunnerOption func(*wikiPromptLLMRunner)

type WikiPromptUsageRecorder struct {
	mu      sync.Mutex
	summary model.RagJobUsageSummary
}

func NewWikiPromptUsageRecorder() *WikiPromptUsageRecorder {
	return &WikiPromptUsageRecorder{}
}

func (r *WikiPromptUsageRecorder) Record(usage *relaymodel.Usage) {
	if r == nil || usage == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.summary.PromptTokens += int64(usage.PromptTokens)
	r.summary.CompletionTokens += int64(usage.CompletionTokens)
	r.summary.TotalTokens += int64(usage.TotalTokens)
	r.summary.CallCount++
}

func (r *WikiPromptUsageRecorder) Snapshot() model.RagJobUsageSummary {
	if r == nil {
		return model.RagJobUsageSummary{}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.summary
}

func WithWikiPromptUsageRecorder(recorder *WikiPromptUsageRecorder) WikiPromptRunnerOption {
	return func(runner *wikiPromptLLMRunner) {
		runner.usageRecorder = recorder
	}
}

func NewWikiPromptLLMRunner(db *gorm.DB, config *rag.ChunkConfig, opts ...WikiPromptRunnerOption) WikiLLMRunner {
	runner := &wikiPromptLLMRunner{
		generator: rag.NewContentGeneratorService(db),
		config:    config,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(runner)
		}
	}
	return runner
}

func (r *wikiPromptLLMRunner) Generate(ctx context.Context, prompt string) (string, error) {
	if r == nil || r.generator == nil {
		return "", fmt.Errorf("wiki llm runner is nil")
	}
	if r.config == nil {
		return "", fmt.Errorf("wiki llm config is nil")
	}

	channel, modelName, err := r.config.SelectPipelineLLM()
	if err != nil {
		return "", err
	}

	// 永久诊断日志：记录每次 LLM 调用的提示词类型（按内容特征识别）+ 字符数，不打印正文
	step := classifyWikiPromptStep(prompt)
	start := time.Now()
	logger.Infof(ctx, "【Wiki生成】 开始 步骤=%s model=%s prompt_chars=%d", step, modelName, len(prompt))
	logger.Infof(ctx, "【Wiki生成】 步骤=%s model=%s\n%s", step, modelName, sanitizeWikiPromptForLog(prompt))
	response, usage, err := generateWikiPromptWithRetryWithUsage(ctx, func() (string, *relaymodel.Usage, error) {
		return r.generator.GenerateRawPromptWithUsage(ctx, channel, modelName, prompt)
	})
	if err != nil && !errors.Is(err, model.ErrJobCancelled) {
		if fallbackChannel, fallbackModel, fallbackOK := r.fallbackPipelineLLM(channel, modelName); fallbackOK {
			logger.Warnf(ctx, "【Wiki生成】 主模型失败，切换备用模型 primary=%s fallback=%s err=%v", modelName, fallbackModel, err)
			response, usage, err = generateWikiPromptWithRetryWithUsage(ctx, func() (string, *relaymodel.Usage, error) {
				return r.generator.GenerateRawPromptWithUsage(ctx, fallbackChannel, fallbackModel, prompt)
			})
			modelName = fallbackModel
		}
	}
	logger.Infof(ctx, "【Wiki生成】 结束 步骤=%s model=%s prompt_chars=%d 耗时=%s err=%v", step, modelName, len(prompt), time.Since(start), err)
	llmObservation := WikiGenerationObservation{Phase: "llm", Status: "success", Reason: step, LLMCalls: 1, DurationMs: time.Since(start).Milliseconds(), Data: map[string]interface{}{"step": step, "model": modelName, "prompt_preview": truncateWikiText(prompt, 200), "response_chars": len([]rune(strings.TrimSpace(response))), "response_preview": truncateWikiText(response, 200)}}
	if err != nil {
		llmObservation.Status = "failed"
		llmObservation.Reason = "llm_error"
		llmObservation.Error = err.Error()
	} else if strings.TrimSpace(response) == "" {
		llmObservation.Status = "failed"
		llmObservation.Reason = "llm_empty_response"
		llmObservation.Error = "模型返回为空"
	}
	recordWikiGenerationObservation(ctx, llmObservation)
	if err != nil {
		return "", err
	}
	logger.Infof(ctx, "%s", formatWikiLLMResponseLog(step, modelName, response))
	if r.usageRecorder != nil && usage != nil {
		r.usageRecorder.Record(usage)
	}
	return response, nil
}

func formatWikiLLMResponseLog(step, modelName, response string) string {
	response = strings.TrimSpace(response)
	return formatWikiGenerationLog("llm_response", fmt.Sprintf("步骤=%s model=%s response_chars=%d\n%s", step, modelName, len([]rune(response)), response))
}

func (r *wikiPromptLLMRunner) fallbackPipelineLLM(primary *model.Channel, primaryModel string) (*model.Channel, string, bool) {
	if r == nil || r.config == nil || r.config.FastReasoning.ChannelID == nil || r.config.FastReasoning.ModelName == nil {
		return nil, "", false
	}
	modelName := strings.TrimSpace(*r.config.FastReasoning.ModelName)
	if modelName == "" || modelName == primaryModel {
		return nil, "", false
	}
	channel, err := model.GetChannelByID(*r.config.FastReasoning.ChannelID)
	if err != nil || channel == nil || (primary != nil && channel.ChannelID == primary.ChannelID) {
		return nil, "", false
	}
	return channel, modelName, true
}

// sanitizeWikiPromptForLog 保留提示词的步骤结构和非正文参数，隐藏可能包含业务文档的正文区块。
func sanitizeWikiPromptForLog(prompt string) string {
	result := prompt
	for _, tag := range []string{
		"content",
		"chunks",
		"existing_page_content",
		"new_information",
		"deleted_documents",
		"remaining_source_documents",
	} {
		result = redactWikiPromptTag(result, tag)
	}
	return result
}

func redactWikiPromptTag(prompt, tag string) string {
	openTag := "<" + tag + ">"
	closeTag := "</" + tag + ">"
	var builder strings.Builder
	searchStart := 0
	for searchStart < len(prompt) {
		relativeStart := strings.Index(prompt[searchStart:], openTag)
		if relativeStart < 0 {
			break
		}
		start := searchStart + relativeStart
		contentStart := start + len(openTag)
		relativeEnd := strings.Index(prompt[contentStart:], closeTag)
		if relativeEnd < 0 {
			break
		}
		end := contentStart + relativeEnd
		builder.WriteString(prompt[searchStart:contentStart])
		builder.WriteString(fmt.Sprintf("[正文已隐藏 chars=%d]", len([]rune(prompt[contentStart:end]))))
		searchStart = end
	}
	if searchStart == 0 {
		return prompt
	}
	builder.WriteString(prompt[searchStart:])
	return builder.String()
}

// classifyWikiPromptStep 按 prompt 内容特征识别其用途（不打印正文，仅日志定位用）。
func classifyWikiPromptStep(prompt string) string {
	switch {
	case strings.Contains(prompt, "lightweight candidate set"):
		return "candidate_extract"
	case strings.Contains(prompt, "create a cohesive wiki summary page"):
		return "summary"
	case strings.Contains(prompt, "Scan the document chunks and decide"):
		return "citation"
	case strings.Contains(prompt, "organizing wiki pages into a navigation taxonomy"):
		return "taxonomy"
	case strings.Contains(prompt, "updating an existing wiki page using new source chunks"):
		return "page_modify"
	case strings.Contains(prompt, "你是分类器"):
		return "category_match"
	case strings.Contains(prompt, "你是 Wiki 编辑器"):
		return "category_generate"
	case strings.Contains(prompt, "You are a knowledge extraction system"):
		return "legacy_knowledge_extract"
	case strings.Contains(prompt, "Write a brief introduction for a wiki knowledge base index page"):
		return "index_intro"
	default:
		return "unknown"
	}
}

func generateWikiPromptWithRetry(ctx context.Context, fn func() (string, error), opts ...common.RetryOption) (string, error) {
	response, _, err := generateWikiPromptWithRetryWithUsage(ctx, func() (string, *relaymodel.Usage, error) {
		resp, callErr := fn()
		return resp, nil, callErr
	}, opts...)
	return response, err
}

func generateWikiPromptWithRetryWithUsage(ctx context.Context, fn func() (string, *relaymodel.Usage, error), opts ...common.RetryOption) (string, *relaymodel.Usage, error) {
	retryOpts := []common.RetryOption{
		common.WithMaxRetries(2),
		common.WithInitialDelay(500 * time.Millisecond),
		common.WithMaxDelay(2 * time.Second),
		common.WithRetryableFunc(isWikiPromptRetryableError),
	}
	retryOpts = append(retryOpts, opts...)

	var response string
	var usage *relaymodel.Usage
	if err := common.Retry(ctx, func() error {
		var callErr error
		response, usage, callErr = fn()
		return callErr
	}, retryOpts...); err != nil {
		return "", nil, err
	}
	return response, usage, nil
}

func isWikiPromptRetryableError(err error) bool {
	if err == nil {
		return false
	}
	if common.IsRetryableError(err) {
		return true
	}
	errStr := strings.ToLower(err.Error())
	return strings.Contains(errStr, "eof")
}

type WikiProcessFileInput struct {
	Eid       int64
	LibraryID int64
	FileID    int64
	Language  string
}

func (s *WikiIngestV2Service) ProcessFile(ctx context.Context, in WikiProcessFileInput) (*WikiIngestV2MapDocumentResult, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("wiki ingest v2 service is nil")
	}

	var file model.File
	if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", in.Eid, in.FileID).First(&file).Error; err != nil {
		return nil, fmt.Errorf("获取文件信息失败: %v", err)
	}

	libraryID := in.LibraryID
	if libraryID <= 0 {
		libraryID = file.LibraryID
	}

	title := strings.TrimSpace(file.Path)
	if err := file.LoadUploadFile(); err == nil && file.UploadFile != nil {
		title = firstNonEmpty(file.UploadFile.FileName, title)
	}
	title = firstNonEmpty(title, fmt.Sprintf("file-%d", file.ID))

	fileBody, err := model.GetLastFileBodyByFileID(in.Eid, in.FileID)
	if err != nil {
		return nil, fmt.Errorf("获取文件内容失败: %v", err)
	}
	if fileBody == nil {
		return nil, fmt.Errorf("文件内容为空，无法生成 wiki 页面")
	}

	content, err := fileBody.GetContent()
	if err != nil {
		return nil, fmt.Errorf("读取文件内容失败: %v", err)
	}

	if strings.TrimSpace(content) == "" {
		return nil, nil
	}

	return s.ProcessDocument(ctx, WikiIngestV2MapDocumentInput{
		Eid:       in.Eid,
		LibraryID: libraryID,
		FileID:    in.FileID,
		Title:     title,
		Content:   content,
		Language:  in.Language,
	})
}

func (s *WikiIngestV2Service) ProcessDocument(ctx context.Context, in WikiIngestV2MapDocumentInput) (result *WikiIngestV2MapDocumentResult, err error) {
	// 永久诊断日志：记录 ctx deadline（确认恢复超时是否生效）与各阶段耗时
	procStart := time.Now()
	partialFailure := false
	traceID := fmt.Sprintf("wiki-%d-%d-%d", in.FileID, in.JobID, procStart.UnixNano())
	ctx = withWikiGenerationContext(ctx, WikiGenerationObservation{Eid: in.Eid, FileID: in.FileID, JobID: in.JobID, TraceID: traceID, Title: in.Title})
	recordWikiGenerationObservation(ctx, WikiGenerationObservation{Eid: in.Eid, FileID: in.FileID, JobID: in.JobID, Phase: "process", Status: "started"})
	if dl, ok := ctx.Deadline(); ok {
		logger.Infof(ctx, "【Wiki生成】 开始 file_id=%d ctx_deadline=%s 剩余=%s", in.FileID, dl.Format(time.RFC3339), time.Until(dl).Round(time.Second))
	} else {
		logger.Infof(ctx, "【Wiki生成】 开始 file_id=%d ctx 无 deadline", in.FileID)
	}
	defer func() {
		status := wikiProcessStatus(err, partialFailure)
		recordWikiGenerationObservation(ctx, WikiGenerationObservation{Eid: in.Eid, FileID: in.FileID, JobID: in.JobID, Phase: "process", Status: status, DurationMs: time.Since(procStart).Milliseconds(), Error: errorText(err)})
		logger.Infof(ctx, "【Wiki生成】 结束 file_id=%d status=%s 总耗时=%s", in.FileID, status, time.Since(procStart))
	}()

	if s == nil || s.db == nil {
		return nil, fmt.Errorf("wiki ingest v2 service is nil")
	}
	if in.LibraryID <= 0 {
		return nil, fmt.Errorf("wiki library id is required")
	}
	if err := s.checkFileGenerationAllowed(ctx, s.db); err != nil {
		return nil, err
	}
	in.EnableWikiDynamicKnowledge = in.EnableWikiKnowledgeGraph && in.EnableWikiDynamicKnowledge

	spaceID, err := s.resolveLibrarySpaceID(ctx, in.Eid, in.LibraryID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.WikiGenerationMode) == "" {
		_, _, in.WikiGenerationMode = resolveWikiSpaceConfig(ctx, s.db, in.Eid, in.LibraryID)
	}
	logger.Infof(ctx, "【Wiki生成】 模式 file_id=%d library_id=%d generation_mode=%s", in.FileID, in.LibraryID, model.NormalizeWikiGenerationMode(in.WikiGenerationMode))
	categoryScopeFingerprint := ""
	if model.NormalizeWikiGenerationMode(in.WikiGenerationMode) == model.WikiGenerationModeStrict && in.EnableWikiKnowledgeGraph {
		in.strictCategoryScope, in.strictCategoryTypes, err = s.loadStrictWikiCategoryScope(ctx, in.Eid, spaceID)
		if err != nil {
			return nil, fmt.Errorf("load strict wiki category scope: %w", err)
		}
		categoryScopeFingerprint = wikiDocumentContentFingerprint(in.strictCategoryScope)
		logger.Infof(ctx, "【Wiki生成】 严格模式 file_id=%d enabled_categories=%d", in.FileID, countWikiCategoryScope(in.strictCategoryScope))
	}

	contentFingerprint := wikiDocumentContentFingerprint(in.Content)
	checkpoint, checkpointErr := loadWikiGenerationCheckpoint(ctx, s.db, in.JobID)
	if checkpointErr != nil {
		logger.Warnf(ctx, "【Wiki生成】 读取 checkpoint 失败，重新执行 map 阶段: file_id=%d job_id=%d err=%v", in.FileID, in.JobID, checkpointErr)
		checkpoint = nil
	}

	var updates []WikiSlugUpdate
	if checkpoint != nil && checkpoint.canResume(contentFingerprint, in.WikiGenerationMode, categoryScopeFingerprint) {
		result = checkpoint.Result
		result.candidates = append([]wikiIngestV2Candidate(nil), checkpoint.Candidates...)
		updates = append([]WikiSlugUpdate(nil), checkpoint.Updates...)
		logger.Infof(ctx, "【Wiki生成】 复用 map 阶段结果: file_id=%d job_id=%d updates=%d completed=%d", in.FileID, in.JobID, len(updates), len(checkpoint.CompletedSlugs))
	} else {
		if checkpoint != nil {
			logger.Infof(ctx, "【Wiki生成】 t 不可复用，重新执行 map 阶段: file_id=%d job_id=%d processing_version=%s", in.FileID, in.JobID, checkpoint.ProcessingVersion)
		}
		result, updates, err = s.mapDocument(ctx, in)
		if err != nil {
			recordWikiGenerationObservation(ctx, WikiGenerationObservation{Phase: "candidate_extract", Status: "failed", Reason: "candidate_extract_error", Error: err.Error()})
			return nil, err
		}
		if result == nil {
			recordWikiGenerationObservation(ctx, WikiGenerationObservation{Phase: "candidate_extract", Status: "failed", Reason: "empty_content", Error: "文档内容为空"})
			return nil, nil
		}
		checkpoint = &wikiGenerationCheckpoint{
			ProcessingVersion:            wikiGenerationCheckpointProcessingVersion,
			ContentFingerprint:           contentFingerprint,
			WikiGenerationMode:           model.NormalizeWikiGenerationMode(in.WikiGenerationMode),
			WikiCategoryScopeFingerprint: categoryScopeFingerprint,
			Result:                       result,
			Candidates:                   append([]wikiIngestV2Candidate(nil), result.candidates...),
			Updates:                      append([]WikiSlugUpdate(nil), updates...),
		}
		if persistErr := persistWikiGenerationCheckpoint(ctx, s.db, in.JobID, *checkpoint); persistErr != nil {
			logger.Warnf(ctx, "【Wiki生成】 保存 map 阶段结果失败，继续当前生成: file_id=%d job_id=%d err=%v", in.FileID, in.JobID, persistErr)
		}
	}
	s.checkpoint = checkpoint
	s.checkpointJobID = in.JobID
	logger.Infof(ctx, "【Wiki生成】 Document 完成 candidates=%d updates=%d 耗时=%s", len(result.CandidateSlugs), len(updates), time.Since(procStart))
	candidateObservation := WikiGenerationObservation{Phase: "candidate_extract", Status: "success", Candidates: int64(len(result.candidates)), Entities: int64(countWikiCandidateTypes(result.candidates, model.WikiPageTypeEntity)), Concepts: int64(countWikiCandidateTypes(result.candidates, model.WikiPageTypeConcept)), Data: map[string]interface{}{"candidates": wikiCandidateTraceItems(result.candidates), "updates": len(updates)}}
	if len(result.candidates) == 0 {
		candidateObservation.Reason = "no_candidates"
		candidateObservation.Error = "未提取到候选词条"
	}
	recordWikiGenerationObservation(ctx, candidateObservation)
	if len(updates) == 0 {
		recordWikiGenerationObservation(ctx, WikiGenerationObservation{Phase: "process", Status: "success", Reason: "no_updates", Error: "没有可生成的 Wiki 页面"})
		if err := s.recordWikiDocumentLog(ctx, in, result, nil); err != nil {
			logger.Errorf(ctx, "【Wiki生成】 文档生成记录写入失败，不影响流程完成: file_id=%d err=%v", in.FileID, err)
		}
		return result, nil
	}

	// 分类预判：命中分类的候选只生成分类页，不再生成常规 entity 页。
	var projections []wikiCategoryProjection
	if len(result.candidates) > 0 && in.EnableWikiKnowledgeGraph {
		projections, err = s.matchWikiCategories(ctx, in, spaceID, result.candidates)
		if err != nil {
			partialFailure = true
			recordWikiGenerationObservation(ctx, WikiGenerationObservation{Phase: "category_match", Status: "failed", Reason: "category_match_error", Error: err.Error()})
			logger.Errorf(ctx, "【Wiki生成】 预判失败: %v", err)
			projections = nil
		}
	} else {
		recordWikiGenerationObservation(ctx, WikiGenerationObservation{Phase: "category_match", Status: "success", Reason: "no_candidates", Data: map[string]interface{}{"enabled": in.EnableWikiKnowledgeGraph}})
	}
	hitSlugs := hitWikiCategorySlugs(projections)
	entityUpdates := make([]WikiSlugUpdate, 0, len(updates))
	for _, update := range updates {
		if _, hit := hitSlugs[update.Slug]; hit {
			continue
		}
		entityUpdates = append(entityUpdates, update)
	}
	if model.NormalizeWikiGenerationMode(in.WikiGenerationMode) == model.WikiGenerationModeStrict {
		beforeStrict := len(entityUpdates)
		beforeStrictItems := append([]WikiSlugUpdate(nil), entityUpdates...)
		entityUpdates = filterStrictWikiUpdates(entityUpdates)
		logger.Infof(ctx, "【Wiki生成】 仅保留系统产物，正常词条过滤后 updates=%d", len(entityUpdates))
		reason := ""
		if beforeStrict > 0 && len(entityUpdates) == 0 {
			reason = "strict_mode_filtered_all"
		}
		recordWikiGenerationObservation(ctx, WikiGenerationObservation{Phase: "strict_filter", Status: "success", Reason: reason, Data: map[string]interface{}{"before": beforeStrict, "after": len(entityUpdates), "before_items": wikiSlugTraceItems(beforeStrictItems), "after_items": wikiSlugTraceItems(entityUpdates)}})
	}
	logger.Infof(ctx, "【Wiki生成】 分类预判 命中分类页=%d 过滤常规页 %d->%d 耗时=%s", len(projections), len(updates), len(entityUpdates), time.Since(procStart))

	if len(entityUpdates) > 0 {
		if in.EnableWikiDynamicKnowledge && hasNormalWikiUpdates(entityUpdates) {
			taxonomyAssignments, err := s.planWikiBatchTaxonomy(ctx, in, spaceID, entityUpdates)
			if err != nil {
				partialFailure = true
				logger.Errorf(ctx, "【Wiki生成】 Taxonomy 规划失败，继续生成未分类页面: file_id=%d err=%v", in.FileID, err)
			} else if len(taxonomyAssignments) > 0 {
				for i := range entityUpdates {
					if folderID, ok := taxonomyAssignments[entityUpdates[i].Slug]; ok {
						entityUpdates[i].FolderID = folderID
					}
				}
			}
		}

		updatesBySlug := make(map[string][]WikiSlugUpdate, len(entityUpdates))
		for _, update := range entityUpdates {
			updatesBySlug[update.Slug] = append(updatesBySlug[update.Slug], update)
		}

		slugs := make([]string, 0, len(updatesBySlug))
		for slug := range updatesBySlug {
			slugs = append(slugs, slug)
		}
		sort.Strings(slugs)

		// 后处理只在本轮确实写入了页面时运行，避免重复摄入同一文档时反复重写正文。
		const maxWikiCompilationRetries = 3
		anyChanged := false
		for _, slug := range slugs {
			if checkpoint.isSlugCompleted(slug) {
				logger.Infof(ctx, "【Wiki生成】 跳过已完成 slug=%s file_id=%d", slug, in.FileID)
				continue
			}
			if err := s.checkFileGenerationAllowed(ctx, s.db); err != nil {
				return result, err
			}
			checkpoint.markSlugProcessing(slug)
			if persistErr := persistWikiGenerationCheckpoint(ctx, s.db, in.JobID, *checkpoint); persistErr != nil {
				logger.Warnf(ctx, "【Wiki生成】 保存 slug processing 状态失败: file_id=%d job_id=%d slug=%s err=%v", in.FileID, in.JobID, slug, persistErr)
			}
			changed, err := s.reduceSlugUpdatesWithRetry(ctx, in.Eid, in.LibraryID, spaceID, slug, updatesBySlug[slug], maxWikiCompilationRetries)
			if err != nil {
				partialFailure = true
				checkpoint.markSlugFailed(slug, err)
				if persistErr := persistWikiGenerationCheckpoint(ctx, s.db, in.JobID, *checkpoint); persistErr != nil {
					logger.Warnf(ctx, "【Wiki生成】 保存 slug failed 状态失败: file_id=%d job_id=%d slug=%s err=%v", in.FileID, in.JobID, slug, persistErr)
				}
				logger.Errorf(ctx, "【Wiki生成】 编译 slug=%s 最终失败(已重试%d次): %v", slug, maxWikiCompilationRetries, err)
				continue
			}
			if changed {
				anyChanged = true
				update := updatesBySlug[slug][0]
				data := map[string]interface{}{"slug": slug, "page_type": update.PageType, "name": firstNonEmpty(update.Title, update.DocTitle, slug), "body_preview": truncateWikiText(firstNonEmpty(update.Content, update.SummaryBody), 200)}
				recordWikiGenerationObservation(ctx, WikiGenerationObservation{Phase: "page_save", Status: "success", Reason: "page_saved", Slug: slug, PagesSucceeded: 1, Data: data})
			}
			checkpoint.markSlugCompleted(slug)
			if persistErr := persistWikiGenerationCheckpoint(ctx, s.db, in.JobID, *checkpoint); persistErr != nil {
				logger.Warnf(ctx, "【Wiki生成】 保存 slug 进度失败: file_id=%d job_id=%d slug=%s err=%v", in.FileID, in.JobID, slug, persistErr)
			}
		}
		if anyChanged {
			if in.EnableWikiDynamicKnowledge {
				if err := s.syncWikiIndexIntro(ctx, in, spaceID, result); err != nil {
					partialFailure = true
					logger.Errorf(ctx, "【Wiki生成】 索引简介同步失败，不阻断实体页面: file_id=%d err=%v", in.FileID, err)
				}
			}
			if err := s.postProcessWikiPages(ctx, in.Eid, in.LibraryID, entityUpdates); err != nil {
				partialFailure = true
				logger.Errorf(ctx, "【Wiki生成】 页面后处理失败，不阻断已生成页面: file_id=%d err=%v", in.FileID, err)
			}
		}
		logger.Infof(ctx, "【Wiki生成】 常规页编译完成 anyChanged=%v 耗时=%s", anyChanged, time.Since(procStart))
		if err := s.publishDraftWikiPages(ctx, in.Eid, in.LibraryID, entityUpdates); err != nil {
			partialFailure = true
			logger.Errorf(ctx, "【Wiki生成】 草稿发布失败，不阻断其他页面: file_id=%d err=%v", in.FileID, err)
		}
		if err := enqueueWikiPageVectorizationJobs(ctx, s.db, common.RDB, in.Eid, in.LibraryID, uniqueWikiUpdateSlugs(entityUpdates), "auto_after_wiki_generation"); err != nil {
			partialFailure = true
			logger.Errorf(ctx, "【Wiki生成】 生成完成后创建任务失败: eid=%d library_id=%d err=%v", in.Eid, in.LibraryID, err)
		}
	}

	if len(projections) > 0 {
		categorySlugs := s.generateWikiCategoryProjections(ctx, in, spaceID, projections, checkpoint)
		categoryPages := 0
		for _, projection := range projections {
			categoryPages += len(projection.Candidates)
		}
		recordWikiGenerationObservation(ctx, WikiGenerationObservation{Eid: in.Eid, FileID: in.FileID, JobID: in.JobID, Phase: "page_generation", Status: "success", PagesSucceeded: int64(len(categorySlugs)), PagesFailed: int64(categoryPages - len(categorySlugs))})
		if err := enqueueWikiPageVectorizationJobs(ctx, s.db, common.RDB, in.Eid, in.LibraryID, categorySlugs, "auto_after_wiki_category_generation"); err != nil {
			partialFailure = true
			logger.Errorf(ctx, "【Wiki生成】 页面向量化任务创建失败: file_id=%d err=%v", in.FileID, err)
		}
		logger.Infof(ctx, "【Wiki生成】 分类页生成完成 projections=%d 耗时=%s", len(projections), time.Since(procStart))
	}
	if err := s.recordWikiDocumentLog(ctx, in, result, entityUpdates); err != nil {
		partialFailure = true
		logger.Errorf(ctx, "【Wiki生成】 文档生成记录写入失败，不影响已生成页面: file_id=%d err=%v", in.FileID, err)
	}

	return result, nil
}

func countWikiCategoryScope(scope string) int {
	if strings.TrimSpace(scope) == "" {
		return 0
	}
	return strings.Count(scope, "- 分类：")
}

func countWikiCandidateTypes(candidates []wikiIngestV2Candidate, pageType string) int {
	count := 0
	for _, candidate := range candidates {
		if candidate.PageType == pageType {
			count++
		}
	}
	return count
}

func wikiCandidateTraceItems(candidates []wikiIngestV2Candidate) []map[string]string {
	items := make([]map[string]string, 0, len(candidates))
	for _, candidate := range candidates {
		items = append(items, map[string]string{"name": candidate.Name, "slug": candidate.Slug, "type": candidate.PageType, "entity_type": candidate.EntityType})
	}
	return items
}

func wikiSlugTraceItems(updates []WikiSlugUpdate) []map[string]string {
	items := make([]map[string]string, 0, len(updates))
	for _, update := range updates {
		items = append(items, map[string]string{"slug": update.Slug, "title": update.Title, "page_type": update.PageType})
	}
	return items
}

func wikiProcessStatus(err error, partialFailure bool) string {
	if err != nil {
		return "failed"
	}
	if partialFailure {
		return "partial_success"
	}
	return "success"
}

func (s *WikiIngestV2Service) checkFileGenerationAllowed(ctx context.Context, db *gorm.DB) error {
	if s == nil || s.fileGuard == nil {
		return nil
	}
	return s.fileGuard(ctx, db)
}

func (s *WikiIngestV2Service) resolveLibrarySpaceID(ctx context.Context, eid, libraryID int64) (int64, error) {
	if s == nil || s.db == nil || libraryID <= 0 {
		return 0, nil
	}

	var library model.Library
	err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", eid, libraryID).First(&library).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, nil
		}
		return 0, err
	}
	return library.SpaceID, nil
}

func (s *WikiIngestV2Service) publishDraftWikiPages(ctx context.Context, eid, libraryID int64, updates []WikiSlugUpdate) error {
	if s == nil || s.db == nil || len(updates) == 0 {
		return nil
	}

	slugs := uniqueWikiUpdateSlugs(updates)
	if len(slugs) == 0 {
		return nil
	}

	var failures []string
	for _, slug := range slugs {
		if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			page, err := loadWikiPageForWrite(tx, eid, libraryID, slug)
			if err != nil {
				return err
			}
			if page == nil || page.Status != model.WikiPageStatusDraft {
				return nil
			}
			page.Status = model.WikiPageStatusActive
			if err := tx.Model(page).Update("status", model.WikiPageStatusActive).Error; err != nil {
				return err
			}
			if page.CurrentVersionID > 0 {
				now := time.Now().UnixMilli()
				if err := tx.Model(&model.WikiPageVersion{}).
					Where("id = ?", page.CurrentVersionID).
					Updates(map[string]any{
						"is_published":   true,
						"publish_kind":   model.WikiPagePublishKindSync,
						"published_time": now,
					}).Error; err != nil {
					return err
				}
			}
			return upsertWikiPageLog(tx, page, page.CurrentVersionID, page.UpdaterID, "publish", "", map[string]any{
				"publish_kind": model.WikiPagePublishKindSync,
			})
		}); err != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", slug, err))
			logger.Errorf(ctx, "【Wiki生成】 单页面发布失败，继续其他页面: slug=%s err=%v", slug, err)
		}
	}
	if len(failures) > 0 {
		return fmt.Errorf("publish wiki pages partially failed: %s", strings.Join(failures, "; "))
	}
	return nil
}

// reduceSlugUpdatesWithRetry 对单个 slug 的编译进行有限次重试。
// 版本冲突（"during compilation"）是并发 wiki 生成的临时竞争，重试可恢复；
// 其他错误直接返回，由调用方决定是否跳过。
func (s *WikiIngestV2Service) reduceSlugUpdatesWithRetry(ctx context.Context, eid, libraryID, spaceID int64, slug string, updates []WikiSlugUpdate, maxRetries int) (bool, error) {
	changed, err := s.reduceSlugUpdates(ctx, eid, libraryID, spaceID, slug, updates)
	if err == nil || !isWikiCompilationConflictErr(err) {
		return changed, err
	}
	for attempt := 1; attempt <= maxRetries; attempt++ {
		if s.checkpoint != nil {
			delete(s.checkpoint.CompiledResults, slug)
		}
		sleepDuration := time.Duration(attempt*200) * time.Millisecond
		logger.Warnf(ctx, "【Wiki生成】 编译 slug=%s 版本冲突，第%d次重试(等待%v)...", slug, attempt, sleepDuration)
		time.Sleep(sleepDuration)
		changed, retryErr := s.reduceSlugUpdates(ctx, eid, libraryID, spaceID, slug, updates)
		if retryErr == nil {
			logger.Infof(ctx, "【Wiki生成】 编译 slug=%s 第%d次重试成功", slug, attempt)
			return changed, nil
		}
		if !isWikiCompilationConflictErr(retryErr) {
			return changed, retryErr
		}
		err = retryErr
	}
	return changed, fmt.Errorf("wiki compilation retry exhausted after %d attempts: %w", maxRetries, err)
}
