package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

var (
	ErrWikiCategoryNotFound  = errors.New("wiki category not found")
	ErrWikiCategoryDuplicate = errors.New("wiki category name already exists")
)

// StylePreset 写作风格预设：标题用于前端快捷选项展示，prompt 为注入生成 prompt 的文案。
type StylePreset struct {
	Title  string `json:"title"`
	Prompt string `json:"prompt"`
}

// WikiCategoryStylePresets 智能生成模式的写作风格预设（全局静态，写死三个）。
var WikiCategoryStylePresets = []StylePreset{
	{Title: "专业严谨", Prompt: "专业严谨，使用业务人员容易理解的语言，多用数据和事实支撑"},
	{Title: "通俗易懂", Prompt: "通俗易懂，像讲故事一样，多用比喻和日常例子，避免术语堆砌"},
	{Title: "对话访谈", Prompt: "对话访谈，以一问一答或采访的形式展开，语气自然亲切"},
}

type WikiCategoryService interface {
	List(ctx context.Context, eid, spaceID int64, status, keyword string, offset, limit int) ([]model.WikiCategory, int64, error)
	ListVisible(ctx context.Context, eid, spaceID, libraryID, userID int64) ([]WikiCategorySummary, error)
	Get(ctx context.Context, eid, spaceID, id int64) (*model.WikiCategory, error)
	Create(ctx context.Context, category *model.WikiCategory) (*model.WikiCategory, error)
	Update(ctx context.Context, category *model.WikiCategory) (*model.WikiCategory, error)
	Delete(ctx context.Context, eid, spaceID, id int64) error
}

type WikiCategorySummary struct {
	ID               int64  `json:"id"`
	Name             string `json:"name"`
	Slug             string `json:"slug"`
	Description      string `json:"description,omitempty"`
	TargetEntityType string `json:"target_entity_type,omitempty"`
	Sort             int64  `json:"sort"`
	PageCount        int64  `json:"page_count"`
	IsVirtual        bool   `json:"is_virtual"`
}

type wikiCategoryService struct{ db *gorm.DB }

func NewWikiCategoryService(db *gorm.DB) WikiCategoryService {
	if db == nil {
		db = model.DB
	}
	return &wikiCategoryService{db: db}
}

func (s *wikiCategoryService) List(ctx context.Context, eid, spaceID int64, status, keyword string, offset, limit int) ([]model.WikiCategory, int64, error) {
	query := s.db.WithContext(ctx).Where("eid = ? AND space_id = ?", eid, spaceID)
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		query = query.Where("name LIKE ?", "%"+keyword+"%")
	}
	var total int64
	if err := query.Model(&model.WikiCategory{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	var items []model.WikiCategory
	err := query.Order("sort ASC, id ASC").Offset(maxInt(offset, 0)).Limit(limit).Find(&items).Error
	return items, total, err
}

func (s *wikiCategoryService) ListVisible(ctx context.Context, eid, spaceID, libraryID, userID int64) ([]WikiCategorySummary, error) {
	if eid <= 0 || spaceID <= 0 {
		return nil, errors.New("eid and space_id are required")
	}

	var categories []model.WikiCategory
	if err := s.db.WithContext(ctx).Where("eid = ? AND space_id = ? AND status = ?", eid, spaceID, model.WikiCategoryStatusEnabled).
		Order("sort ASC, id ASC").Find(&categories).Error; err != nil {
		return nil, err
	}

	// 取该范围候选页面 id，再按当前用户权限过滤（与列表接口同口径，含 Source 交集+快照缓存）。
	var pageIDs []int64
	pageQuery := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND space_id = ? AND status = ?", eid, spaceID, model.WikiPageStatusActive).
		Select("id")
	if libraryID > 0 {
		pageQuery = pageQuery.Where("library_id = ?", libraryID)
	}
	if err := pageQuery.Pluck("id", &pageIDs).Error; err != nil {
		return nil, err
	}
	visibleIDs := pageIDs
	if userID > 0 && len(pageIDs) > 0 {
		permissions, err := batchGetWikiPermissions(eid, model.RESOURCE_TYPE_WIKI_PAGE, pageIDs, userID, ctx)
		if err != nil {
			return nil, err
		}
		visibleIDs = make([]int64, 0, len(pageIDs))
		for _, id := range pageIDs {
			if permissions[id] >= model.PERMISSION_VIEW_ONLY {
				visibleIDs = append(visibleIDs, id)
			}
		}
	}

	type categoryCount struct {
		CategoryID int64
		Count      int64
	}
	countByCategory := make(map[int64]int64)
	otherCount := int64(0)
	if len(visibleIDs) > 0 {
		countQuery := s.db.WithContext(ctx).Model(&model.WikiPageCategory{}).
			Select("wiki_page_categories.category_id AS category_id, COUNT(DISTINCT wiki_page_categories.page_id) AS count").
			Joins("JOIN wiki_pages ON wiki_pages.id = wiki_page_categories.page_id").
			Where("wiki_page_categories.eid = ? AND wiki_page_categories.space_id = ? AND wiki_pages.eid = ? AND wiki_pages.space_id = ? AND wiki_pages.status = ? AND wiki_page_categories.page_id IN ?", eid, spaceID, eid, spaceID, model.WikiPageStatusActive, visibleIDs)
		if libraryID > 0 {
			countQuery = countQuery.Where("wiki_pages.library_id = ?", libraryID)
		}
		var counts []categoryCount
		if err := countQuery.Group("wiki_page_categories.category_id").Scan(&counts).Error; err != nil {
			return nil, err
		}
		for _, count := range counts {
			countByCategory[count.CategoryID] = count.Count
		}

		otherQuery := s.db.WithContext(ctx).Model(&model.WikiPage{}).Table("wiki_pages AS wp").
			Where("wp.eid = ? AND wp.space_id = ? AND wp.status = ? AND wp.page_type IN ? AND wp.id IN ?", eid, spaceID, model.WikiPageStatusActive, []string{model.WikiPageTypeEntity, model.WikiPageTypeConcept}, visibleIDs).
			Where("NOT EXISTS (?)", s.db.WithContext(ctx).Model(&model.WikiPageCategory{}).
				Select("1").Where("eid = ? AND space_id = ? AND page_id = wp.id", eid, spaceID))
		if libraryID > 0 {
			otherQuery = otherQuery.Where("wp.library_id = ?", libraryID)
		}
		if err := otherQuery.Count(&otherCount).Error; err != nil {
			return nil, err
		}
	}

	items := make([]WikiCategorySummary, 0, len(categories)+1)
	for _, category := range categories {
		items = append(items, WikiCategorySummary{
			ID: category.ID, Name: category.Name, Slug: category.Slug, Description: category.Description,
			TargetEntityType: category.TargetEntityType, Sort: category.Sort, PageCount: countByCategory[category.ID],
		})
	}
	items = append(items, WikiCategorySummary{ID: 0, Name: "其他", Slug: "other", Description: "尚未归入任何分类的 Wiki 页面", Sort: int64(^uint64(0) >> 1), PageCount: otherCount, IsVirtual: true})
	return items, nil
}

func (s *wikiCategoryService) Get(ctx context.Context, eid, spaceID, id int64) (*model.WikiCategory, error) {
	var category model.WikiCategory
	err := s.db.WithContext(ctx).Where("eid = ? AND space_id = ? AND id = ?", eid, spaceID, id).First(&category).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrWikiCategoryNotFound
	}
	if err != nil {
		return nil, err
	}
	return &category, nil
}

func (s *wikiCategoryService) Create(ctx context.Context, category *model.WikiCategory) (*model.WikiCategory, error) {
	if category == nil {
		return nil, errors.New("category is required")
	}
	category.Name = strings.TrimSpace(category.Name)
	category.Description = strings.TrimSpace(category.Description)
	for i := range category.TemplateSections {
		category.TemplateSections[i].Title = strings.TrimSpace(category.TemplateSections[i].Title)
		category.TemplateSections[i].Description = strings.TrimSpace(category.TemplateSections[i].Description)
		if category.TemplateSections[i].Level == 0 {
			category.TemplateSections[i].Level = 2
		}
	}
	category.TargetEntityType = strings.TrimSpace(category.TargetEntityType)
	if normalized, ok := model.NormalizeWikiCategoryTargetType(category.TargetEntityType); ok {
		category.TargetEntityType = normalized
	}
	if strings.TrimSpace(category.StylePromptTitle) == "" {
		category.StylePromptTitle = model.WikiCategoryStylePromptTitleCustom
	}
	if category.GrowthMode == "" {
		category.GrowthMode = model.WikiCategoryGrowthModeSmart
	}
	if category.GraphDepth == 0 {
		category.GraphDepth = 1
	}
	if category.Status == "" {
		category.Status = model.WikiCategoryStatusEnabled
	}
	if category.Slug == "" {
		category.Slug = model.NormalizeWikiPageSlug(category.Name)
	}
	if category.Slug == "page" || len([]rune(category.Name)) != len([]byte(category.Name)) {
		// lazy: 中文名归一化为 page（客户→page）或极短 ASCII（客户A→a）会跨分类碰撞,
		// 存在非 ASCII 字符即用内容哈希兜底保证唯一; 纯英文名保持可读 slug
		category.Slug = "cat-" + wikiShortHash(category.Name)
	}
	if err := ValidateWikiCategoryTemplate(category); err != nil {
		return nil, err
	}
	var count int64
	if err := s.db.WithContext(ctx).Model(&model.WikiCategory{}).Where("eid = ? AND space_id = ? AND name = ?", category.Eid, category.SpaceID, category.Name).Count(&count).Error; err != nil {
		return nil, err
	}
	if count > 0 {
		return nil, ErrWikiCategoryDuplicate
	}
	if err := s.db.WithContext(ctx).Create(category).Error; err != nil {
		return nil, err
	}
	return category, nil
}

func (s *wikiCategoryService) Update(ctx context.Context, category *model.WikiCategory) (*model.WikiCategory, error) {
	if category == nil {
		return nil, errors.New("category is required")
	}
	current, err := s.Get(ctx, category.Eid, category.SpaceID, category.ID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(category.Name) == "" {
		return nil, errors.New("category name is required")
	}
	category.Name = strings.TrimSpace(category.Name)
	category.Description = strings.TrimSpace(category.Description)
	for i := range category.TemplateSections {
		category.TemplateSections[i].Title = strings.TrimSpace(category.TemplateSections[i].Title)
		category.TemplateSections[i].Description = strings.TrimSpace(category.TemplateSections[i].Description)
		if category.TemplateSections[i].Level == 0 {
			category.TemplateSections[i].Level = 2
		}
	}
	category.TargetEntityType = strings.TrimSpace(category.TargetEntityType)
	if normalized, ok := model.NormalizeWikiCategoryTargetType(category.TargetEntityType); ok {
		category.TargetEntityType = normalized
	}
	if strings.TrimSpace(category.StylePromptTitle) == "" {
		category.StylePromptTitle = model.WikiCategoryStylePromptTitleCustom
	}
	if category.GrowthMode == "" {
		category.GrowthMode = current.GrowthMode
	}
	if category.GraphDepth == 0 {
		category.GraphDepth = current.GraphDepth
	}
	if category.Status == "" {
		category.Status = current.Status
	}
	if category.Slug == "" {
		category.Slug = current.Slug
	}
	if err := ValidateWikiCategoryTemplate(category); err != nil {
		return nil, err
	}
	var count int64
	if err := s.db.WithContext(ctx).Model(&model.WikiCategory{}).Where("eid = ? AND space_id = ? AND name = ? AND id <> ?", category.Eid, category.SpaceID, category.Name, category.ID).Count(&count).Error; err != nil {
		return nil, err
	}
	if count > 0 {
		return nil, ErrWikiCategoryDuplicate
	}
	templateSections, err := json.Marshal(category.TemplateSections)
	if err != nil {
		return nil, err
	}
	updates := map[string]interface{}{"name": category.Name, "slug": category.Slug, "description": category.Description, "target_entity_type": category.TargetEntityType, "okf_type": category.OKFType, "growth_mode": category.GrowthMode, "style_prompt": category.StylePrompt, "style_prompt_title": category.StylePromptTitle, "graph_depth": category.GraphDepth, "creativity": category.Creativity, "anchor_links_enabled": category.AnchorLinksEnabled, "template_markdown": category.TemplateMarkdown, "template_sections": string(templateSections), "strict_fill": category.StrictFill, "status": category.Status, "sort": category.Sort}
	if err := s.db.WithContext(ctx).Model(&model.WikiCategory{}).Where("eid = ? AND space_id = ? AND id = ?", category.Eid, category.SpaceID, category.ID).Updates(updates).Error; err != nil {
		return nil, err
	}
	return s.Get(ctx, category.Eid, category.SpaceID, category.ID)
}

func (s *wikiCategoryService) Delete(ctx context.Context, eid, spaceID, id int64) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Where("eid = ? AND space_id = ? AND id = ?", eid, spaceID, id).Delete(&model.WikiCategory{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrWikiCategoryNotFound
		}
		return tx.Where("eid = ? AND space_id = ? AND category_id = ?", eid, spaceID, id).Delete(&model.WikiPageCategory{}).Error
	})
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
