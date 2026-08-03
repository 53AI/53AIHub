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

	response, usage, err := generateWikiPromptWithRetryWithUsage(ctx, func() (string, *relaymodel.Usage, error) {
		return r.generator.GenerateRawPromptWithUsage(ctx, channel, modelName, prompt)
	})
	if err != nil {
		return "", err
	}
	if r.usageRecorder != nil && usage != nil {
		r.usageRecorder.Record(usage)
	}
	return response, nil
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

func (s *WikiIngestV2Service) ProcessDocument(ctx context.Context, in WikiIngestV2MapDocumentInput) (*WikiIngestV2MapDocumentResult, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("wiki ingest v2 service is nil")
	}
	if in.LibraryID <= 0 {
		return nil, fmt.Errorf("wiki library id is required")
	}
	in.EnableWikiDynamicKnowledge = in.EnableWikiKnowledgeGraph && in.EnableWikiDynamicKnowledge

	spaceID, err := s.resolveLibrarySpaceID(ctx, in.Eid, in.LibraryID)
	if err != nil {
		return nil, err
	}

	result, updates, err := s.mapDocument(ctx, in)
	if err != nil {
		return nil, err
	}
	if len(updates) == 0 {
		if err := s.recordWikiDocumentLog(ctx, in, result, nil); err != nil {
			return result, err
		}
		return result, nil
	}

	if in.EnableWikiDynamicKnowledge {
		taxonomyAssignments, err := s.planWikiBatchTaxonomy(ctx, in, spaceID, updates)
		if err != nil {
			return result, err
		}
		if len(taxonomyAssignments) > 0 {
			for i := range updates {
				if folderID, ok := taxonomyAssignments[updates[i].Slug]; ok {
					updates[i].FolderID = folderID
				}
			}
		}
	}

	updatesBySlug := make(map[string][]WikiSlugUpdate, len(updates))
	for _, update := range updates {
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
		changed, err := s.reduceSlugUpdatesWithRetry(ctx, in.Eid, in.LibraryID, spaceID, slug, updatesBySlug[slug], maxWikiCompilationRetries)
		if err != nil {
			logger.Errorf(ctx, "【Wiki编译】slug=%s 编译最终失败(已重试%d次): %v", slug, maxWikiCompilationRetries, err)
			continue
		}
		if changed {
			anyChanged = true
		}
	}
	if anyChanged {
		if in.EnableWikiDynamicKnowledge {
			if err := s.syncWikiIndexIntro(ctx, in, spaceID, result); err != nil {
				return result, err
			}
		}
		if err := s.postProcessWikiPages(ctx, in.Eid, in.LibraryID, updates); err != nil {
			return result, err
		}
	}
	if err := s.publishDraftWikiPages(ctx, in.Eid, in.LibraryID, updates); err != nil {
		return result, err
	}
	if err := s.recordWikiDocumentLog(ctx, in, result, updates); err != nil {
		return result, err
	}
	if err := enqueueWikiPageVectorizationJobs(ctx, s.db, common.RDB, in.Eid, in.LibraryID, uniqueWikiUpdateSlugs(updates), "auto_after_wiki_generation"); err != nil {
		logger.Errorf(ctx, "【Wiki向量化】生成完成后创建任务失败: eid=%d library_id=%d err=%v", in.Eid, in.LibraryID, err)
	}

	return result, nil
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

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, slug := range slugs {
			page, err := loadWikiPageForWrite(tx, eid, libraryID, slug)
			if err != nil {
				return err
			}
			if page == nil || page.Status != model.WikiPageStatusDraft {
				continue
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
			if err := upsertWikiPageLog(tx, page, page.CurrentVersionID, page.UpdaterID, "publish", "", map[string]any{
				"publish_kind": model.WikiPagePublishKindSync,
			}); err != nil {
				return err
			}
		}
		return nil
	})
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
		sleepDuration := time.Duration(attempt*200) * time.Millisecond
		logger.Warnf(ctx, "【Wiki编译】slug=%s 版本冲突，第%d次重试(等待%v)...", slug, attempt, sleepDuration)
		time.Sleep(sleepDuration)
		changed, retryErr := s.reduceSlugUpdates(ctx, eid, libraryID, spaceID, slug, updates)
		if retryErr == nil {
			logger.Infof(ctx, "【Wiki编译】slug=%s 第%d次重试成功", slug, attempt)
			return changed, nil
		}
		if !isWikiCompilationConflictErr(retryErr) {
			return changed, retryErr
		}
		err = retryErr
	}
	return changed, fmt.Errorf("wiki compilation retry exhausted after %d attempts: %w", maxRetries, err)
}
