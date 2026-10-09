package service

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// WikiOtherCategoryPlan is a reviewed snapshot; applying it never regenerates page content.
type WikiOtherCategoryPlan struct {
	Eid       int64                       `json:"eid"`
	SpaceID   int64                       `json:"space_id"`
	CreatedAt time.Time                   `json:"created_at"`
	Items     []WikiOtherCategoryPlanItem `json:"items"`
}

type WikiOtherCategoryPlanItem struct {
	PageID           int64  `json:"page_id"`
	CurrentVersionID int64  `json:"current_version_id"`
	Slug             string `json:"slug"`
	Title            string `json:"title"`
	CategoryID       int64  `json:"category_id"`
	CategoryName     string `json:"category_name,omitempty"`
}

// PlanWikiOtherCategories only reads the database and calls the classifier.
// "other" means no WikiPageCategory mapping, not a persisted category.
func PlanWikiOtherCategories(ctx context.Context, db *gorm.DB, llm WikiLLMRunner, eid, spaceID, afterPageID int64, limit int) (*WikiOtherCategoryPlan, error) {
	if db == nil || llm == nil || eid <= 0 || spaceID <= 0 || afterPageID < 0 || limit <= 0 || limit > 100 {
		return nil, errors.New("invalid reclassification scope or limit")
	}
	var space model.Space
	if err := db.WithContext(ctx).Where("eid = ? AND id = ?", eid, spaceID).First(&space).Error; err != nil {
		return nil, fmt.Errorf("load wiki space: %w", err)
	}
	var categories []model.WikiCategory
	if err := db.WithContext(ctx).Where("eid = ? AND space_id = ? AND status = ?", eid, spaceID, model.WikiCategoryStatusEnabled).Order("sort ASC, id ASC").Find(&categories).Error; err != nil {
		return nil, err
	}
	if len(categories) == 0 {
		return nil, errors.New("space has no enabled wiki categories")
	}
	var libraryIDs []int64
	if err := db.WithContext(ctx).Model(&model.Library{}).Where("eid = ? AND space_id = ?", eid, spaceID).Pluck("id", &libraryIDs).Error; err != nil {
		return nil, err
	}
	plan := &WikiOtherCategoryPlan{Eid: eid, SpaceID: spaceID, CreatedAt: time.Now().UTC(), Items: []WikiOtherCategoryPlanItem{}}
	if len(libraryIDs) == 0 {
		return plan, nil
	}
	var pages []model.WikiPage
	query := db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND library_id IN ? AND id > ? AND status = ? AND page_type IN ?", eid, libraryIDs, afterPageID, model.WikiPageStatusActive, []string{model.WikiPageTypeEntity, model.WikiPageTypeConcept}).
		Where("current_version_id IN (?)", db.WithContext(ctx).Model(&model.WikiPageVersion{}).Select("id").Where("eid = ? AND is_published = ?", eid, true)).
		Where("NOT EXISTS (?)", db.WithContext(ctx).Model(&model.WikiPageCategory{}).Select("1").Where("eid = ? AND page_id = wiki_pages.id", eid)).
		Where("EXISTS (?)", db.WithContext(ctx).Model(&model.WikiPageSource{}).Select("1").Where("eid = ? AND page_id = wiki_pages.id AND source_kind = ?", eid, model.WikiPageSourceKindImport))
	if err := query.Order("id ASC").Limit(limit).Find(&pages).Error; err != nil {
		return nil, err
	}
	plan.Items = make([]WikiOtherCategoryPlanItem, 0, len(pages))
	if len(pages) == 0 {
		return plan, nil
	}
	categoryNames := make(map[int64]string, len(categories))
	for _, category := range categories {
		categoryNames[category.ID] = category.Name
	}
	svc := NewWikiIngestV2Service(db, llm)
	const batchSize = 20
	for start := 0; start < len(pages); start += batchSize {
		end := start + batchSize
		if end > len(pages) {
			end = len(pages)
		}
		candidates := make([]wikiIngestV2Candidate, 0, end-start)
		for _, page := range pages[start:end] {
			candidates = append(candidates, wikiIngestV2Candidate{PageType: page.PageType, EntityType: page.PageType, Name: page.Title, Slug: strconv.FormatInt(page.ID, 10), Description: page.Summary, Details: page.Body})
		}
		assignments, err := svc.matchWikiCategoryCandidates(ctx, WikiIngestV2MapDocumentInput{Eid: eid, Language: "中文"}, categories, candidates)
		if err != nil {
			return nil, fmt.Errorf("classify pages %d-%d: %w", start, end, err)
		}
		for _, page := range pages[start:end] {
			id := assignments[strconv.FormatInt(page.ID, 10)]
			plan.Items = append(plan.Items, WikiOtherCategoryPlanItem{PageID: page.ID, CurrentVersionID: page.CurrentVersionID, Slug: page.Slug, Title: page.Title, CategoryID: id, CategoryName: categoryNames[id]})
		}
	}
	return plan, nil
}

// ApplyWikiOtherCategoryPlan only adds missing category mappings after revalidating the snapshot.
// Page body, folder, source links, and publication state remain unchanged.
func ApplyWikiOtherCategoryPlan(ctx context.Context, db *gorm.DB, plan WikiOtherCategoryPlan) (int, error) {
	if db == nil || plan.Eid <= 0 || plan.SpaceID <= 0 || len(plan.Items) == 0 || len(plan.Items) > 100 {
		return 0, errors.New("invalid or empty reclassification plan")
	}
	created := 0
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var libraryIDs []int64
		if err := tx.Model(&model.Library{}).Where("eid = ? AND space_id = ?", plan.Eid, plan.SpaceID).Pluck("id", &libraryIDs).Error; err != nil {
			return err
		}
		librarySet := make(map[int64]struct{}, len(libraryIDs))
		for _, id := range libraryIDs {
			librarySet[id] = struct{}{}
		}
		var categories []model.WikiCategory
		if err := tx.Where("eid = ? AND space_id = ? AND status = ?", plan.Eid, plan.SpaceID, model.WikiCategoryStatusEnabled).Find(&categories).Error; err != nil {
			return err
		}
		byID := make(map[int64]model.WikiCategory, len(categories))
		for _, category := range categories {
			byID[category.ID] = category
		}
		seen := make(map[int64]struct{}, len(plan.Items))
		for _, item := range plan.Items {
			if item.PageID <= 0 || item.CurrentVersionID <= 0 || item.Slug == "" {
				return errors.New("invalid plan page")
			}
			if _, exists := seen[item.PageID]; exists {
				return fmt.Errorf("duplicate plan page %d", item.PageID)
			}
			seen[item.PageID] = struct{}{}
			var page model.WikiPage
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND eid = ? AND slug = ? AND current_version_id = ? AND status = ?", item.PageID, plan.Eid, item.Slug, item.CurrentVersionID, model.WikiPageStatusActive).First(&page).Error; err != nil {
				return fmt.Errorf("page changed since preview %s: %w", item.Slug, err)
			}
			if _, ok := librarySet[page.LibraryID]; !ok {
				return fmt.Errorf("page library is outside wiki space %s", item.Slug)
			}
			if page.PageType != model.WikiPageTypeEntity && page.PageType != model.WikiPageTypeConcept {
				return fmt.Errorf("page type changed since preview %s", item.Slug)
			}
			var published, imported int64
			if err := tx.Model(&model.WikiPageVersion{}).Where("id = ? AND eid = ? AND is_published = ?", page.CurrentVersionID, plan.Eid, true).Count(&published).Error; err != nil {
				return err
			}
			if err := tx.Model(&model.WikiPageSource{}).Where("eid = ? AND page_id = ? AND source_kind = ?", plan.Eid, page.ID, model.WikiPageSourceKindImport).Count(&imported).Error; err != nil {
				return err
			}
			if published == 0 || imported == 0 {
				return fmt.Errorf("page no longer eligible %s", item.Slug)
			}
			var mappingCount int64
			if err := tx.Model(&model.WikiPageCategory{}).Where("eid = ? AND page_id = ?", plan.Eid, page.ID).Count(&mappingCount).Error; err != nil {
				return err
			}
			if mappingCount != 0 {
				return fmt.Errorf("page already classified %s", item.Slug)
			}
			if item.CategoryID == 0 {
				continue
			}
			category, ok := byID[item.CategoryID]
			if !ok || category.Name != item.CategoryName {
				return fmt.Errorf("category changed since preview %s", item.Slug)
			}
			if err := tx.Create(&model.WikiPageCategory{Eid: plan.Eid, SpaceID: plan.SpaceID, CategoryID: category.ID, PageID: page.ID, EntitySlug: page.Slug, ClassificationReason: "historical other reclassification"}).Error; err != nil {
				return err
			}
			created++
		}
		return nil
	})
	return created, err
}
