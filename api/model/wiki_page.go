package model

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"unicode"
)

const (
	wikiPageSlugMaxLen = 96

	WikiPageStatusDraft    = "draft"
	WikiPageStatusActive   = "active"
	WikiPageStatusArchived = "archived"

	WikiPageTypeSummary = "summary"
	WikiPageTypeEntity  = "entity"
	WikiPageTypeConcept = "concept"
	WikiPageTypeIndex   = "index"
	WikiPageTypeLog     = "log"

	WikiPageVisibilityPrivate   = "private"
	WikiPageVisibilityWorkspace = "workspace"
	WikiPageVisibilityPublic    = "public"

	WikiPageSourceKindManual   = "manual"
	WikiPageSourceKindImport   = "import"
	WikiPageSourceKindExternal = "external"

	WikiPageLinkKindWiki     = "wiki"
	WikiPageLinkKindRedirect = "redirect"

	WikiPageBodyFormatMarkdown = "markdown"
	WikiPageBodyFormatHTML     = "html"

	WikiPagePublishKindManual = "manual"
	WikiPagePublishKindSync   = "sync"

	WikiFolderStatusActive   = "active"
	WikiFolderStatusArchived = "archived"

	WikiPendingOpStatusQueued     = "queued"
	WikiPendingOpStatusProcessing = "processing"
	WikiPendingOpStatusFailed     = "failed"
	WikiPendingOpStatusDone       = "done"

	WikiRedirectStatusActive  = "active"
	WikiRedirectStatusRetired = "retired"
)

type WikiPage struct {
	ID               int64    `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid              int64    `json:"eid" gorm:"not null;index;uniqueIndex:idx_wiki_pages_library_slug,priority:1"`
	SpaceID          int64    `json:"space_id" gorm:"not null;index"`
	LibraryID        int64    `json:"library_id" gorm:"not null;index;uniqueIndex:idx_wiki_pages_library_slug,priority:2"`
	FolderID         int64    `json:"folder_id" gorm:"not null;default:0;index"`
	CurrentVersionID int64    `json:"current_version_id" gorm:"not null;default:0;index"`
	Title            string   `json:"title" gorm:"not null;size:255"`
	Slug             string   `json:"slug" gorm:"not null;size:96;uniqueIndex:idx_wiki_pages_library_slug,priority:3"`
	PageType         string   `json:"page_type" gorm:"not null;size:32;default:concept;index"`
	Body             string   `json:"body" gorm:"type:text"`
	BodyFormat       string   `json:"body_format" gorm:"not null;size:32;default:markdown"`
	Summary          string   `json:"summary" gorm:"type:text"`
	Aliases          []string `json:"aliases,omitempty" gorm:"serializer:json"`
	Status           string   `json:"status" gorm:"not null;size:32;default:active;index"`
	Visibility       string   `json:"visibility" gorm:"not null;size:32;default:workspace;index"`
	CreatorID        int64    `json:"creator_id" gorm:"not null;index"`
	UpdaterID        int64    `json:"updater_id" gorm:"not null;index"`
	Sort             int64    `json:"sort" gorm:"not null;default:0"`
	BaseModel
}

type WikiPageSource struct {
	ID                int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid               int64  `json:"eid" gorm:"not null;index"`
	PageID            int64  `json:"page_id" gorm:"not null;index"`
	SourceKind        string `json:"source_kind" gorm:"not null;size:32;index"`
	SourceRef         string `json:"source_ref" gorm:"not null;size:255"`
	SourceFileID      int64  `json:"source_file_id" gorm:"not null;default:0;index"`
	SourceChunkID     int64  `json:"source_chunk_id" gorm:"not null;default:0;index"`
	SourceSlug        string `json:"source_slug" gorm:"size:255;index"`
	SourceLocation    string `json:"source_location" gorm:"size:512;index"`
	SourceContentHash string `json:"source_content_hash" gorm:"size:128;index"`
	SourceURL         string `json:"source_url" gorm:"size:512"`
	ExternalID        string `json:"external_id" gorm:"size:255"`
	ExternalDigest    string `json:"external_digest" gorm:"size:128"`
	MetaJSON          string `json:"meta_json" gorm:"type:text"`
	LastSyncedTime    int64  `json:"last_synced_time" gorm:"not null;default:0"`
	CreatorID         int64  `json:"creator_id" gorm:"not null;index"`
	BaseModel
}

type WikiPageLink struct {
	ID         int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid        int64  `json:"eid" gorm:"not null;index"`
	FromPageID int64  `json:"from_page_id" gorm:"not null;index:idx_wiki_page_links_from_to,priority:1"`
	ToPageID   int64  `json:"to_page_id" gorm:"not null;default:0;index:idx_wiki_page_links_from_to,priority:2"`
	LinkKind   string `json:"link_kind" gorm:"not null;size:32;default:wiki;index"`
	AnchorText string `json:"anchor_text" gorm:"size:255"`
	TargetSlug string `json:"target_slug" gorm:"size:96;index"`
	CreatorID  int64  `json:"creator_id" gorm:"not null;index"`
	BaseModel
}

type WikiPageVersion struct {
	ID            int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid           int64  `json:"eid" gorm:"not null;index"`
	PageID        int64  `json:"page_id" gorm:"not null;index;uniqueIndex:idx_wiki_page_versions_page_version,priority:1"`
	VersionNo     int64  `json:"version_no" gorm:"not null;uniqueIndex:idx_wiki_page_versions_page_version,priority:2"`
	Title         string `json:"title" gorm:"not null;size:255"`
	Slug          string `json:"slug" gorm:"not null;size:96"`
	PageType      string `json:"page_type" gorm:"not null;size:32;default:concept"`
	AliasesJSON   string `json:"aliases_json" gorm:"type:text"`
	SourcesJSON   string `json:"sources_json" gorm:"type:text"`
	LinksJSON     string `json:"links_json" gorm:"type:text"`
	BacklinksJSON string `json:"backlinks_json" gorm:"type:text"`
	Body          string `json:"body" gorm:"type:text"`
	BodyFormat    string `json:"body_format" gorm:"not null;size:32;default:markdown"`
	ChangeSummary string `json:"change_summary" gorm:"size:255"`
	Checksum      string `json:"checksum" gorm:"size:128"`
	SourceVersion string `json:"source_version" gorm:"size:128"`
	EditorID      int64  `json:"editor_id" gorm:"not null;index"`
	IsPublished   bool   `json:"is_published" gorm:"not null;default:false;index"`
	PublishKind   string `json:"publish_kind" gorm:"not null;size:32;default:manual"`
	PublishedTime int64  `json:"published_time" gorm:"not null;default:0"`
	VersionTag    string `json:"version_tag" gorm:"size:128"`
	BaseModel
}

type WikiFolder struct {
	ID        int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid       int64  `json:"eid" gorm:"not null;index;uniqueIndex:idx_wiki_folders_library_parent_slug,priority:1"`
	SpaceID   int64  `json:"space_id" gorm:"not null;index"`
	LibraryID int64  `json:"library_id" gorm:"not null;index;uniqueIndex:idx_wiki_folders_library_parent_slug,priority:2"`
	ParentID  int64  `json:"parent_id" gorm:"not null;default:0;index;uniqueIndex:idx_wiki_folders_library_parent_slug,priority:3"`
	Name      string `json:"name" gorm:"not null;size:255"`
	Slug      string `json:"slug" gorm:"not null;size:96;uniqueIndex:idx_wiki_folders_library_parent_slug,priority:4"`
	Path      string `json:"path" gorm:"size:512"`
	Status    string `json:"status" gorm:"not null;size:32;default:active;index"`
	CreatorID int64  `json:"creator_id" gorm:"not null;index"`
	UpdaterID int64  `json:"updater_id" gorm:"not null;index"`
	Sort      int64  `json:"sort" gorm:"not null;default:0"`
	BaseModel
}

type WikiLogEntry struct {
	ID              int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid             int64  `json:"eid" gorm:"not null;index"`
	KnowledgeBaseID string `json:"knowledge_base_id" gorm:"size:128;index"`
	KnowledgeID     string `json:"knowledge_id" gorm:"size:128;index"`
	DocTitle        string `json:"doc_title" gorm:"size:512"`
	Summary         string `json:"summary" gorm:"type:text"`
	PagesAffected   string `json:"pages_affected" gorm:"type:text"`
	PageID          int64  `json:"page_id" gorm:"not null;default:0;index"`
	VersionID       int64  `json:"version_id" gorm:"not null;default:0;index"`
	ActorID         int64  `json:"actor_id" gorm:"not null;default:0;index"`
	Action          string `json:"action" gorm:"not null;size:32;index"`
	RequestID       string `json:"request_id" gorm:"size:64;index"`
	Message         string `json:"message" gorm:"type:text"`
	MetaJSON        string `json:"meta_json" gorm:"type:text"`
	BaseModel
}

type WikiPendingOp struct {
	ID           int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid          int64  `json:"eid" gorm:"not null;index"`
	PageID       int64  `json:"page_id" gorm:"not null;default:0;index"`
	OpKind       string `json:"op_kind" gorm:"not null;size:32;index"`
	Status       string `json:"status" gorm:"not null;size:32;default:queued;index"`
	Payload      string `json:"payload" gorm:"type:text"`
	AttemptCount int    `json:"attempt_count" gorm:"not null;default:0"`
	MaxAttempts  int    `json:"max_attempts" gorm:"not null;default:0"`
	NextRunTime  int64  `json:"next_run_time" gorm:"not null;default:0;index"`
	LastError    string `json:"last_error" gorm:"type:text"`
	LockedBy     string `json:"locked_by" gorm:"size:64"`
	LockedTime   int64  `json:"locked_time" gorm:"not null;default:0"`
	CreatorID    int64  `json:"creator_id" gorm:"not null;default:0;index"`
	BaseModel
}

type WikiDeadLetter struct {
	ID           int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid          int64  `json:"eid" gorm:"not null;index"`
	PendingOpID  int64  `json:"pending_op_id" gorm:"not null;default:0;index"`
	PageID       int64  `json:"page_id" gorm:"not null;default:0;index"`
	OpKind       string `json:"op_kind" gorm:"not null;size:32;index"`
	Payload      string `json:"payload" gorm:"type:text"`
	ErrorMessage string `json:"error_message" gorm:"type:text"`
	FailedTime   int64  `json:"failed_time" gorm:"not null;default:0;index"`
	BaseModel
}

type WikiPageRedirect struct {
	ID        int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid       int64  `json:"eid" gorm:"not null;index;uniqueIndex:idx_wiki_redirects_library_slug,priority:1"`
	LibraryID int64  `json:"library_id" gorm:"not null;index;uniqueIndex:idx_wiki_redirects_library_slug,priority:2"`
	FromSlug  string `json:"from_slug" gorm:"not null;size:96;uniqueIndex:idx_wiki_redirects_library_slug,priority:3"`
	ToPageID  int64  `json:"to_page_id" gorm:"not null;default:0;index"`
	ToSlug    string `json:"to_slug" gorm:"not null;size:96"`
	Status    string `json:"status" gorm:"not null;size:32;default:active;index"`
	CreatorID int64  `json:"creator_id" gorm:"not null;index"`
	BaseModel
}

func NewWikiPageSlug(title string, fallback string) string {
	slug := NormalizeWikiPageSlug(title)
	if slug != "page" {
		return slug
	}

	if hasNonASCII(strings.TrimSpace(title)) {
		return "page-" + shortWikiPageHash(title)
	}

	fallback = NormalizeWikiPageSlug(fallback)
	if fallback == "page" && strings.TrimSpace(title) != "" {
		return slug
	}
	return fallback
}

func hasNonASCII(input string) bool {
	for _, r := range input {
		if r > unicode.MaxASCII {
			return true
		}
	}
	return false
}

func shortWikiPageHash(input string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(input)))
	return hex.EncodeToString(sum[:6])
}

func NormalizeWikiPageSlug(input string) string {
	var b strings.Builder
	b.Grow(len(input))

	lastDash := false
	for _, r := range strings.ToLower(strings.TrimSpace(input)) {
		if r > unicode.MaxASCII {
			if !lastDash && b.Len() > 0 {
				b.WriteByte('-')
				lastDash = true
			}
			continue
		}
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteByte(byte(r))
			lastDash = false
			continue
		}
		if !lastDash && b.Len() > 0 {
			b.WriteByte('-')
			lastDash = true
		}
	}

	slug := strings.Trim(b.String(), "-")
	if slug == "" {
		return "page"
	}
	if len(slug) <= wikiPageSlugMaxLen {
		return slug
	}
	slug = strings.Trim(slug[:wikiPageSlugMaxLen], "-")
	if slug == "" {
		return "page"
	}
	return slug
}

type wikiPageTypeCountRow struct {
	PageType string
	Count    int64
}

func CountWikiPagesByTypes(eid int64, spaceID int64) (map[string]int64, error) {
	var rows []wikiPageTypeCountRow
	err := DB.Model(&WikiPage{}).
		Select("page_type, COUNT(*) AS count").
		Where("eid = ? AND space_id = ? AND status = ?", eid, spaceID, WikiPageStatusActive).
		Group("page_type").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[string]int64, len(rows))
	for _, row := range rows {
		result[row.PageType] = row.Count
	}
	return result, nil
}

func GetWikiPageByID(eid, pageID int64) (*WikiPage, error) {
	var page WikiPage
	err := DB.Where("eid = ? AND id = ?", eid, pageID).First(&page).Error
	if err != nil {
		return nil, err
	}
	return &page, nil
}

func GetWikiPageBySlug(eid, libraryID int64, slug string) (*WikiPage, error) {
	var page WikiPage
	err := DB.Where("eid = ? AND library_id = ? AND slug = ?", eid, libraryID, slug).First(&page).Error
	if err != nil {
		return nil, err
	}
	return &page, nil
}

func GetWikiPagesByIDs(eid int64, pageIDs []int64) ([]WikiPage, error) {
	if len(pageIDs) == 0 {
		return nil, nil
	}
	var pages []WikiPage
	err := DB.Where("eid = ? AND id IN ? AND status = 'active'", eid, pageIDs).Find(&pages).Error
	if err != nil {
		return nil, err
	}
	return pages, nil
}
