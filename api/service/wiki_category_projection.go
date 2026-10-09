package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

type wikiCategoryProjection struct {
	Category   model.WikiCategory
	Candidates []wikiIngestV2Candidate
}

func (s *WikiIngestV2Service) loadStrictWikiCategoryScope(ctx context.Context, eid, spaceID int64) (string, map[string]struct{}, error) {
	if s == nil || s.db == nil || spaceID <= 0 {
		return "", nil, nil
	}
	var categories []model.WikiCategory
	if err := s.db.WithContext(ctx).Where("eid = ? AND space_id = ? AND status = ?", eid, spaceID, model.WikiCategoryStatusEnabled).
		Order("sort ASC, id ASC").Find(&categories).Error; err != nil {
		return "", nil, err
	}
	var b strings.Builder
	types := make(map[string]struct{}, len(categories))
	for _, category := range categories {
		name := strings.TrimSpace(category.Name)
		if name == "" {
			continue
		}
		if targetType, ok := model.NormalizeWikiCategoryTargetType(category.TargetEntityType); ok {
			types[targetType] = struct{}{}
		}
		fmt.Fprintf(&b, "- 分类：%s；适用范围：%s；目标类型：%s\n", name, strings.TrimSpace(category.Description), strings.TrimSpace(category.TargetEntityType))
	}
	return strings.TrimSpace(b.String()), types, nil
}

// matchWikiCategories 一次比较所有启用分类，保证每个候选至多命中一个分类。
func (s *WikiIngestV2Service) matchWikiCategories(ctx context.Context, in WikiIngestV2MapDocumentInput, spaceID int64, candidates []wikiIngestV2Candidate) ([]wikiCategoryProjection, error) {
	if s == nil || s.db == nil || s.llm == nil || spaceID <= 0 || !in.EnableWikiKnowledgeGraph || len(candidates) == 0 {
		return nil, nil
	}
	var categories []model.WikiCategory
	if err := s.db.WithContext(ctx).Where("eid = ? AND space_id = ? AND status = ?", in.Eid, spaceID, model.WikiCategoryStatusEnabled).Order("sort ASC, id ASC").Find(&categories).Error; err != nil {
		return nil, err
	}
	if len(categories) == 0 {
		return nil, nil
	}
	start := time.Now()
	assignments, err := s.matchWikiCategoryCandidates(ctx, in, categories, candidates)
	observation := WikiGenerationObservation{Eid: in.Eid, FileID: in.FileID, JobID: in.JobID, Phase: "category_llm_match", LLMCalls: 1, DurationMs: time.Since(start).Milliseconds(), Data: map[string]interface{}{"candidates": len(candidates), "categories": len(categories)}}
	if err != nil {
		observation.Status, observation.Error = "failed", err.Error()
		recordWikiGenerationObservation(ctx, observation)
		return nil, err
	}
	matched := 0
	for _, categoryID := range assignments {
		if categoryID != 0 {
			matched++
		}
	}
	observation.Status = "success"
	observation.CategoryMatched = int64(matched)
	observation.Data["unclassified"] = len(candidates) - matched
	recordWikiGenerationObservation(ctx, observation)
	projections := make([]wikiCategoryProjection, 0, len(categories))
	for _, category := range categories {
		var accepted []wikiIngestV2Candidate
		for _, candidate := range candidates {
			if assignments[candidate.Slug] == category.ID {
				accepted = append(accepted, candidate)
			}
		}
		if len(accepted) > 0 {
			projections = append(projections, wikiCategoryProjection{Category: category, Candidates: accepted})
		}
	}
	return projections, nil
}

// hitWikiCategorySlugs 收集所有命中分类的候选 slug（这些候选不再生成常规 entity 页）。
func hitWikiCategorySlugs(projections []wikiCategoryProjection) map[string]struct{} {
	slugs := make(map[string]struct{})
	for _, projection := range projections {
		for _, candidate := range projection.Candidates {
			slugs[candidate.Slug] = struct{}{}
		}
	}
	return slugs
}

func filterStrictWikiUpdates(updates []WikiSlugUpdate) []WikiSlugUpdate {
	filtered := make([]WikiSlugUpdate, 0, len(updates))
	for _, update := range updates {
		if update.PageType == model.WikiPageTypeIndex || update.PageType == model.WikiPageTypeLog ||
			update.PageType == model.WikiPageTypeSummary || isSummarySlug(update.Slug) {
			filtered = append(filtered, update)
		}
	}
	return filtered
}

func hasNormalWikiUpdates(updates []WikiSlugUpdate) bool {
	for _, update := range updates {
		if update.PageType != model.WikiPageTypeIndex && update.PageType != model.WikiPageTypeLog &&
			update.PageType != model.WikiPageTypeSummary && !isSummarySlug(update.Slug) {
			return true
		}
	}
	return false
}

// generateWikiCategoryProjections 按预判结果生成各分类页面。
func (s *WikiIngestV2Service) generateWikiCategoryProjections(ctx context.Context, in WikiIngestV2MapDocumentInput, spaceID int64, projections []wikiCategoryProjection, checkpoint *wikiGenerationCheckpoint) []string {
	if s == nil || s.db == nil || s.llm == nil {
		return nil
	}
	generated := make([]string, 0)
	for _, projection := range projections {
		category := projection.Category
		for _, candidate := range projection.Candidates {
			checkpointKey := wikiCategoryCheckpointKey(category.Slug, candidate.Slug)
			if checkpoint != nil && checkpoint.isCategoryPageCompleted(checkpointKey) {
				// 断点续跑也要重新检查并修复历史上已落库但未发布的分类页。
				if err := s.reconcileWikiPageCategory(ctx, in, spaceID, category, candidate); err != nil {
					logger.Errorf(ctx, "【Wiki生成】 分类关联修复失败: slug=%s err=%v", candidate.Slug, err)
					continue
				}
				generated = append(generated, candidate.Slug)
				continue
			}
			prompt, err := BuildWikiCategoryPrompt(WikiCategoryGenerationInput{Category: category, EntityName: candidate.Name, EntityType: candidate.EntityType, EntitySlug: candidate.Slug, EntitySummary: candidate.Description, EntityDetails: candidate.Details, Language: in.Language})
			if err != nil {
				logger.Errorf(ctx, "【Wiki生成】 页面提示词构建失败，继续下一个页面: category=%s slug=%s err=%v", category.Slug, candidate.Slug, err)
				continue
			}
			body, err := s.llm.Generate(ctx, prompt)
			if err != nil {
				recordWikiGenerationObservation(ctx, WikiGenerationObservation{Eid: in.Eid, FileID: in.FileID, JobID: in.JobID, Phase: "page_generation", Status: "failed", Reason: "page_llm_error", Category: category.Name, Slug: candidate.Slug, Error: err.Error()})
				logger.Errorf(ctx, "【Wiki生成】 页面生成失败，继续下一个页面: category=%s slug=%s err=%v", category.Slug, candidate.Slug, err)
				continue
			}
			body = strings.TrimSpace(body)
			recordWikiGenerationObservation(ctx, WikiGenerationObservation{Eid: in.Eid, FileID: in.FileID, JobID: in.JobID, Phase: "page_generation", Status: "success", Reason: "page_generated", Category: category.Name, Slug: candidate.Slug, Data: map[string]interface{}{"body_preview": truncateWikiText(body, 200), "body_bytes": len(body), "headings": wikiMarkdownHeadingSummary(body)}})
			logger.Infof(ctx, "【Wiki生成】 固定结构正文已生成: category=%s category_name=%s slug=%s growth_mode=%s strict_fill=%t structured_sections=%d legacy_template_bytes=%d headings=%s body_bytes=%d", category.Slug, category.Name, candidate.Slug, category.GrowthMode, category.StrictFill, len(category.TemplateSections), len(category.TemplateMarkdown), wikiMarkdownHeadingSummary(body), len(body))
			if len(category.TemplateSections) > 0 && category.GrowthMode == model.WikiCategoryGrowthModeFixed {
				sections, err := WikiCategoryTemplateSections(category)
				if err != nil {
					recordWikiGenerationObservation(ctx, WikiGenerationObservation{Eid: in.Eid, FileID: in.FileID, JobID: in.JobID, Phase: "fixed_structure", Status: "failed", Reason: "template_invalid", Category: category.Name, Slug: candidate.Slug, Data: map[string]interface{}{"expected": wikiCategorySectionsSummary(sections)}, Error: err.Error()})
					logger.Errorf(ctx, "【Wiki生成】 模板读取失败，跳过页面: category=%s slug=%s sections=%s err=%v", category.Slug, candidate.Slug, wikiCategorySectionSummary(category), err)
					continue
				}
				logger.Infof(ctx, "【Wiki生成】 开始校验固定结构: category=%s slug=%s expected=%s actual=%s", category.Slug, candidate.Slug, wikiCategorySectionsSummary(sections), wikiMarkdownHeadingSummary(body))
				body, err = NormalizeWikiCategoryMarkdown(body, sections)
				if err != nil {
					recordWikiGenerationObservation(ctx, WikiGenerationObservation{Eid: in.Eid, FileID: in.FileID, JobID: in.JobID, Phase: "fixed_structure", Status: "failed", Reason: "structure_validation_failed", Category: category.Name, Slug: candidate.Slug, Data: map[string]interface{}{"expected": wikiCategorySectionsSummary(sections), "actual": wikiMarkdownHeadingSummary(body)}, Error: err.Error()})
					logger.Errorf(ctx, "【Wiki生成】 固定结构校验失败，跳过页面: category=%s slug=%s expected=%s actual=%s err=%v", category.Slug, candidate.Slug, wikiCategorySectionsSummary(sections), wikiMarkdownHeadingSummary(body), err)
					continue
				}
				logger.Infof(ctx, "【Wiki生成】 固定结构校验通过: category=%s slug=%s normalized_headings=%s body_bytes=%d", category.Slug, candidate.Slug, wikiMarkdownHeadingSummary(body), len(body))
			}
			if err := s.upsertWikiCategoryPage(ctx, in, spaceID, category, candidate, body); err != nil {
				recordWikiGenerationObservation(ctx, WikiGenerationObservation{Eid: in.Eid, FileID: in.FileID, JobID: in.JobID, Phase: "page_save", Status: "failed", Reason: "page_save_failed", Category: category.Name, Slug: candidate.Slug, Error: err.Error()})
				logger.Errorf(ctx, "【Wiki生成】 页面保存失败，继续下一个页面: category=%s slug=%s body_bytes=%d err=%v", category.Slug, candidate.Slug, len(body), err)
				continue
			}
			logger.Infof(ctx, "【Wiki生成】 固定结构页面保存成功: category=%s slug=%s", category.Slug, candidate.Slug)
			recordWikiGenerationObservation(ctx, WikiGenerationObservation{Eid: in.Eid, FileID: in.FileID, JobID: in.JobID, Phase: "page_save", Status: "success", Reason: "page_saved", Category: category.Name, Slug: candidate.Slug, PagesSucceeded: 1, Data: map[string]interface{}{"name": candidate.Name, "category": category.Name, "slug": candidate.Slug, "body_preview": truncateWikiText(body, 200), "body_bytes": len(body)}})
			generated = append(generated, candidate.Slug)
			if checkpoint != nil {
				checkpoint.markCategoryPageCompleted(checkpointKey)
				if err := persistWikiGenerationCheckpoint(ctx, s.db, in.JobID, *checkpoint); err != nil {
					logger.Warnf(ctx, "【Wiki生成】 分类页完成状态保存失败: category=%s slug=%s err=%v", category.Slug, candidate.Slug, err)
				}
			}
		}
	}
	return generated
}

func wikiCategorySectionSummary(category model.WikiCategory) string {
	sections, err := WikiCategoryTemplateSections(category)
	if err != nil {
		return fmt.Sprintf("error:%v", err)
	}
	return wikiCategorySectionsSummary(sections)
}

func wikiCategorySectionsSummary(sections []model.WikiCategoryTemplateSection) string {
	parts := make([]string, 0, len(sections))
	for _, section := range sections {
		parts = append(parts, fmt.Sprintf("%d:%s", section.Level, section.Title))
	}
	return strings.Join(parts, "|")
}

func wikiMarkdownHeadingSummary(body string) string {
	parts := make([]string, 0)
	for _, line := range strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n") {
		matches := wikiMarkdownHeadingPattern.FindStringSubmatch(line)
		if len(matches) == 0 {
			continue
		}
		parts = append(parts, fmt.Sprintf("%d:%s", len(matches[2]), strings.TrimSpace(matches[3])))
	}
	if len(parts) == 0 {
		return "(none)"
	}
	return strings.Join(parts, "|")
}

// matchWikiCategoryCandidates 一次批量 LLM 调用，判断候选是否属于该分类。
// 判断失败按保守策略：返回错误，由调用方跳过该分类并记录日志。
func (s *WikiIngestV2Service) matchWikiCategoryCandidates(ctx context.Context, in WikiIngestV2MapDocumentInput, categories []model.WikiCategory, candidates []wikiIngestV2Candidate) (map[string]int64, error) {
	if len(candidates) == 0 {
		return nil, nil
	}
	prompt, err := BuildWikiCategoryMatchPrompt(WikiCategoryMatchInput{Categories: categories, Candidates: candidates, Language: in.Language})
	if err != nil {
		return nil, err
	}
	raw, err := s.llm.Generate(ctx, prompt)
	if err != nil {
		return nil, fmt.Errorf("match wiki category candidates: %w", err)
	}
	var batch WikiCategoryMatchBatch
	if err := decodeWikiLLMJSON(raw, &batch); err != nil {
		return nil, fmt.Errorf("parse category match JSON: %w", err)
	}
	bySlug := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		bySlug[candidate.Slug] = struct{}{}
	}
	byID := make(map[int64]struct{}, len(categories))
	for _, category := range categories {
		byID[category.ID] = struct{}{}
	}
	result := make(map[string]int64, len(candidates))
	for _, r := range batch.Results {
		if _, ok := bySlug[r.Slug]; !ok {
			return nil, fmt.Errorf("unknown category candidate slug %q", r.Slug)
		}
		if _, ok := result[r.Slug]; ok {
			return nil, fmt.Errorf("duplicate category candidate slug %q", r.Slug)
		}
		if r.CategoryID != 0 {
			if _, ok := byID[r.CategoryID]; !ok {
				return nil, fmt.Errorf("unknown category id %d", r.CategoryID)
			}
		}
		if r.Confidence < 0 || r.Confidence > 1 {
			return nil, fmt.Errorf("invalid category confidence for %q", r.Slug)
		}
		result[r.Slug] = r.CategoryID
	}
	if len(result) != len(bySlug) {
		return nil, fmt.Errorf("incomplete category match: got %d of %d candidates", len(result), len(bySlug))
	}
	return result, nil
}

func wikiCategoryPageSlug(entitySlug string) string {
	return strings.TrimSpace(entitySlug)
}

func (s *WikiIngestV2Service) upsertWikiCategoryPage(ctx context.Context, in WikiIngestV2MapDocumentInput, spaceID int64, category model.WikiCategory, candidate wikiIngestV2Candidate, body string) error {
	slug := wikiCategoryPageSlug(candidate.Slug)
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		folder, err := ensureWikiCategoryFolder(tx, in.Eid, in.LibraryID, spaceID, category)
		if err != nil {
			return err
		}
		page, err := loadWikiPageForWrite(tx, in.Eid, in.LibraryID, slug)
		if err != nil {
			return err
		}
		if page == nil {
			page = &model.WikiPage{Eid: in.Eid, SpaceID: spaceID, LibraryID: in.LibraryID, Slug: slug, Title: candidate.Name, PageType: model.WikiPageTypeEntity, BodyFormat: model.WikiPageBodyFormatMarkdown, Status: model.WikiPageStatusActive, Visibility: model.WikiPageVisibilityWorkspace, CreatorID: in.Eid, UpdaterID: in.Eid}
		}
		page.SpaceID = spaceID
		page.Title = candidate.Name
		page.PageType = model.WikiPageTypeEntity
		page.Body = strings.TrimSpace(body)
		page.Summary = candidate.Description
		page.FolderID = folder.ID
		page.Status = model.WikiPageStatusActive
		page.UpdaterID = in.Eid
		if s.linkSvc == nil {
			s.linkSvc = NewWikiLinkService()
		}
		if category.AnchorLinksEnabled {
			linkedBody, _, err := linkifyWikiPageContent(tx, in.Eid, in.LibraryID, slug, page.Body)
			if err != nil {
				return err
			}
			page.Body = linkedBody
		}
		sources := buildWikiPageSourcesForUpdates(0, in.Eid, WikiSlugUpdate{Eid: in.Eid, SourceFileID: in.FileID, SourceChunks: candidate.SourceChunks, Title: candidate.Name, Summary: candidate.Description}, model.WikiPageSourceKindImport)
		links := buildWikiPageLinksForContent(page.ID, in.Eid, in.LibraryID, page.Body, s.linkSvc, tx, in.Eid)
		if err := persistWikiPageWrite(ctx, tx, page, sources, links, "category projection"); err != nil {
			return err
		}
		if err := tx.Where("eid = ? AND space_id = ? AND page_id = ? AND category_id <> ?", in.Eid, spaceID, page.ID, category.ID).Delete(&model.WikiPageCategory{}).Error; err != nil {
			return err
		}
		var mapping model.WikiPageCategory
		err = tx.Where("eid = ? AND space_id = ? AND category_id = ? AND page_id = ?", in.Eid, spaceID, category.ID, page.ID).First(&mapping).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return tx.Create(&model.WikiPageCategory{Eid: in.Eid, SpaceID: spaceID, CategoryID: category.ID, PageID: page.ID, EntityType: candidate.EntityType, EntitySlug: candidate.Slug, ClassificationReason: category.Description, Confidence: 1}).Error
		}
		if err != nil {
			return err
		}
		return tx.Model(&mapping).Updates(map[string]interface{}{"entity_type": candidate.EntityType, "entity_slug": candidate.Slug, "classification_reason": category.Description, "confidence": 1}).Error
	})
}

func (s *WikiIngestV2Service) reconcileWikiPageCategory(ctx context.Context, in WikiIngestV2MapDocumentInput, spaceID int64, category model.WikiCategory, candidate wikiIngestV2Candidate) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		page, err := loadWikiPageForWrite(tx, in.Eid, in.LibraryID, candidate.Slug)
		if err != nil {
			return err
		}
		if page == nil {
			return fmt.Errorf("category page %s not found", candidate.Slug)
		}
		if err := tx.Where("eid = ? AND space_id = ? AND page_id = ? AND category_id <> ?", in.Eid, spaceID, page.ID, category.ID).Delete(&model.WikiPageCategory{}).Error; err != nil {
			return err
		}
		return tx.Where("eid = ? AND space_id = ? AND category_id = ? AND page_id = ?", in.Eid, spaceID, category.ID, page.ID).
			FirstOrCreate(&model.WikiPageCategory{Eid: in.Eid, SpaceID: spaceID, CategoryID: category.ID, PageID: page.ID, EntityType: candidate.EntityType, EntitySlug: candidate.Slug, ClassificationReason: category.Description, Confidence: 1}).Error
	})
}

func (s *WikiIngestV2Service) clearWikiPageCategories(ctx context.Context, in WikiIngestV2MapDocumentInput, spaceID int64, slug string) error {
	page, err := loadWikiPageForWrite(s.db.WithContext(ctx), in.Eid, in.LibraryID, slug)
	if err != nil || page == nil {
		return err
	}
	return s.db.WithContext(ctx).Where("eid = ? AND space_id = ? AND page_id = ?", in.Eid, spaceID, page.ID).Delete(&model.WikiPageCategory{}).Error
}

func ensureWikiCategoryFolder(tx *gorm.DB, eid, libraryID, spaceID int64, category model.WikiCategory) (*model.WikiFolder, error) {
	var folder model.WikiFolder
	err := tx.Where("eid = ? AND library_id = ? AND parent_id = ? AND slug = ?", eid, libraryID, int64(0), category.Slug).First(&folder).Error
	if err == nil {
		return &folder, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	folder = model.WikiFolder{Eid: eid, SpaceID: spaceID, LibraryID: libraryID, ParentID: 0, Name: category.Name, Slug: category.Slug, Path: category.Name, Status: model.WikiFolderStatusActive, CreatorID: eid, UpdaterID: eid}
	if err := tx.Create(&folder).Error; err != nil {
		return nil, err
	}
	return &folder, nil
}
