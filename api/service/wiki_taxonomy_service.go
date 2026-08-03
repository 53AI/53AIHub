package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

type wikiTaxonomyItem struct {
	slug     string
	title    string
	pageType string
	about    string
}

type WikiTaxonomyService struct {
	db      *gorm.DB
	prompts *WikiPromptService
	llm     WikiLLMRunner
}

func NewWikiTaxonomyService(db *gorm.DB, llm WikiLLMRunner) *WikiTaxonomyService {
	return &WikiTaxonomyService{
		db:      db,
		prompts: NewWikiPromptService(),
		llm:     llm,
	}
}

func (s *WikiTaxonomyService) PlanBatchTaxonomy(ctx context.Context, eid, libraryID int64, updates []WikiSlugUpdate, language string) (map[string][]string, error) {
	if s == nil || s.db == nil || s.llm == nil {
		return nil, nil
	}
	items := collectWikiTaxonomyItems(updates)
	if len(items) == 0 {
		return nil, nil
	}
	if s.prompts == nil {
		s.prompts = NewWikiPromptService()
	}

	existingPaths, err := s.ListDistinctCategoryPaths(ctx, eid, libraryID, 256)
	if err != nil {
		return nil, err
	}

	prompt, err := s.prompts.Render(WikiTaxonomyPlanPrompt, map[string]any{
		"ExistingTaxonomy": renderWikiTaxonomyPaths(existingPaths),
		"Items":            renderWikiTaxonomyItems(items),
		"Language":         firstNonEmpty(language, "中文"),
	})
	if err != nil {
		return nil, err
	}

	raw, err := s.llm.Generate(ctx, prompt)
	if err != nil {
		return nil, err
	}

	planned := parseWikiTaxonomyAssignments(raw)
	if len(planned) == 0 {
		return nil, nil
	}

	return planned, nil
}

func (s *WikiTaxonomyService) ResolvePlannedFolders(ctx context.Context, eid, libraryID, spaceID int64, planned map[string][]string) (map[string]int64, error) {
	if s == nil || s.db == nil || len(planned) == 0 {
		return nil, nil
	}

	pathCache := make(map[string]int64, len(planned))
	out := make(map[string]int64, len(planned))
	for slug, path := range planned {
		clean := cleanWikiFolderPath(path)
		if len(clean) == 0 {
			continue
		}
		key := strings.Join(clean, "/")
		folderID, ok := pathCache[key]
		if !ok {
			var err error
			folderID, err = s.findOrCreateFolderPath(ctx, eid, libraryID, spaceID, clean)
			if err != nil {
				return nil, err
			}
			pathCache[key] = folderID
		}
		if folderID > 0 {
			out[slug] = folderID
		}
	}
	return out, nil
}

func (s *WikiTaxonomyService) ListDistinctCategoryPaths(ctx context.Context, eid, libraryID int64, limit int) ([][]string, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}

	var folders []model.WikiFolder
	query := s.db.WithContext(ctx).Where("eid = ? AND library_id = ? AND status = ?", eid, libraryID, model.WikiFolderStatusActive)
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Order("path ASC, id ASC").Find(&folders).Error; err != nil {
		return nil, err
	}

	seen := make(map[string]struct{}, len(folders))
	paths := make([][]string, 0, len(folders))
	for _, folder := range folders {
		path := cleanWikiFolderPath(strings.Split(folder.Path, "/"))
		if len(path) == 0 {
			continue
		}
		key := strings.Join(path, "/")
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		paths = append(paths, path)
	}
	return paths, nil
}

func (s *WikiTaxonomyService) findOrCreateFolderPath(ctx context.Context, eid, libraryID, spaceID int64, path []string) (int64, error) {
	clean := cleanWikiFolderPath(path)
	if len(clean) == 0 {
		return 0, nil
	}
	if s == nil || s.db == nil {
		return 0, fmt.Errorf("wiki taxonomy db is required")
	}

	var folderID int64
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var parentID int64
		var currentPath []string
		for _, label := range clean {
			currentPath = append(currentPath, label)
			slug := model.NewWikiPageSlug(label, "folder")

			var folder model.WikiFolder
			err := tx.Where("eid = ? AND library_id = ? AND parent_id = ? AND slug = ?", eid, libraryID, parentID, slug).First(&folder).Error
			if err != nil {
				if !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
				folder = model.WikiFolder{
					Eid:       eid,
					SpaceID:   spaceID,
					LibraryID: libraryID,
					ParentID:  parentID,
					Name:      label,
					Slug:      slug,
					Path:      strings.Join(currentPath, "/"),
					Status:    model.WikiFolderStatusActive,
					CreatorID: 0,
					UpdaterID: 0,
				}
				if err := tx.Create(&folder).Error; err != nil {
					return err
				}
			} else {
				updated := false
				if spaceID > 0 && folder.SpaceID == 0 {
					folder.SpaceID = spaceID
					updated = true
				}
				if strings.TrimSpace(folder.Name) == "" {
					folder.Name = label
					updated = true
				}
				if strings.TrimSpace(folder.Path) == "" {
					folder.Path = strings.Join(currentPath, "/")
					updated = true
				}
				if folder.Status != model.WikiFolderStatusActive {
					folder.Status = model.WikiFolderStatusActive
					updated = true
				}
				if updated {
					if err := tx.Save(&folder).Error; err != nil {
						return err
					}
				}
			}
			parentID = folder.ID
			folderID = folder.ID
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return folderID, nil
}

func collectWikiTaxonomyItems(updates []WikiSlugUpdate) []wikiTaxonomyItem {
	items := make([]wikiTaxonomyItem, 0, len(updates))
	for _, update := range updates {
		if update.PageType != model.WikiPageTypeEntity && update.PageType != model.WikiPageTypeConcept {
			continue
		}
		title := firstNonEmpty(update.Title, update.DocTitle, update.Slug)
		if title == "" {
			continue
		}
		items = append(items, wikiTaxonomyItem{
			slug:     update.Slug,
			title:    title,
			pageType: update.PageType,
			about:    firstNonEmpty(update.Summary, update.DocSummary, update.SummaryBody, update.Content),
		})
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].slug < items[j].slug
	})
	return items
}

func renderWikiTaxonomyItems(items []wikiTaxonomyItem) string {
	if len(items) == 0 {
		return ""
	}
	var builder strings.Builder
	for _, item := range items {
		fmt.Fprintf(&builder, "- slug: %s | title: %s | type: %s | about: %s\n", item.slug, item.title, item.pageType, truncateWikiText(item.about, 120))
	}
	return strings.TrimSpace(builder.String())
}

func renderWikiTaxonomyPaths(paths [][]string) string {
	if len(paths) == 0 {
		return ""
	}
	var builder strings.Builder
	for _, path := range paths {
		if len(path) == 0 {
			continue
		}
		builder.WriteString("- ")
		builder.WriteString(strings.Join(path, " / "))
		builder.WriteString("\n")
	}
	return strings.TrimSpace(builder.String())
}

func parseWikiTaxonomyAssignments(raw string) map[string][]string {
	raw = cleanLLMJSON(raw)
	if raw == "" {
		return nil
	}
	var batch WikiTaxonomyBatch
	if err := json.Unmarshal([]byte(raw), &batch); err != nil {
		return nil
	}
	out := make(map[string][]string, len(batch.Assignments))
	for _, assignment := range batch.Assignments {
		slug := strings.TrimSpace(assignment.Slug)
		if slug == "" {
			continue
		}
		out[slug] = cleanWikiFolderPath(assignment.Path)
	}
	return out
}

func cleanWikiFolderPath(parts []string) []string {
	cleaned := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		for _, label := range cleanWikiFolderPart(part) {
			if _, ok := seen[label]; ok {
				continue
			}
			seen[label] = struct{}{}
			cleaned = append(cleaned, label)
			if len(cleaned) >= 3 {
				return cleaned
			}
		}
	}
	return cleaned
}

func cleanWikiFolderPart(part string) []string {
	part = strings.TrimSpace(part)
	if part == "" {
		return nil
	}
	part = strings.NewReplacer("／", "/", "｜", "/", "|", "/").Replace(part)
	rawParts := strings.Split(part, "/")
	cleaned := make([]string, 0, len(rawParts))
	for _, raw := range rawParts {
		label := strings.TrimSpace(raw)
		label = strings.Trim(label, `"'“”‘’[]（）()`)
		label = strings.TrimSpace(label)
		if label == "" {
			continue
		}
		if isWikiTypeCategoryLabel(label) {
			continue
		}
		cleaned = append(cleaned, label)
	}
	return cleaned
}

func isWikiTypeCategoryLabel(label string) bool {
	normalized := strings.ToLower(strings.TrimSpace(label))
	normalized = strings.TrimSuffix(normalized, "s")
	switch normalized {
	case "entity", "实体", "實體", "concept", "概念", "summary", "摘要", "wiki", "pages", "page", "页面", "頁面":
		return true
	default:
		return false
	}
}
