package service

type WikiCandidateSlug struct {
	Name        string   `json:"name"`
	Slug        string   `json:"slug"`
	Aliases     []string `json:"aliases"`
	Description string   `json:"description"`
	Details     string   `json:"details"`
}

type WikiCandidateSlugBatch struct {
	Entities []WikiCandidateSlug `json:"entities"`
	Concepts []WikiCandidateSlug `json:"concepts"`
}

type WikiDiscoveredSlug struct {
	Type         string   `json:"type"`
	Name         string   `json:"name"`
	Slug         string   `json:"slug"`
	Aliases      []string `json:"aliases"`
	Description  string   `json:"description"`
	Details      string   `json:"details"`
	SourceChunks []string `json:"source_chunks"`
}

type WikiCitationBatch struct {
	Citations map[string][]string  `json:"citations"`
	NewSlugs  []WikiDiscoveredSlug `json:"new_slugs"`
}

type WikiTaxonomyAssignment struct {
	Slug string   `json:"slug"`
	Path []string `json:"path"`
}

type WikiTaxonomyBatch struct {
	Assignments []WikiTaxonomyAssignment `json:"assignments"`
}

type WikiSummaryParts struct {
	Summary string
	Body    string
}

type WikiSlugUpdate struct {
	Slug              string   `json:"slug"`
	PageType          string   `json:"page_type"`
	Title             string   `json:"title,omitempty"`
	Aliases           []string `json:"aliases,omitempty"`
	FolderID          int64    `json:"folder_id,omitempty"`
	Summary           string   `json:"summary,omitempty"`
	Content           string   `json:"content,omitempty"`
	SummaryLine       string   `json:"summary_line,omitempty"`
	SummaryBody       string   `json:"summary_body,omitempty"`
	DocTitle          string   `json:"doc_title,omitempty"`
	DocSummary        string   `json:"doc_summary,omitempty"`
	RetractDocContent string   `json:"retract_doc_content,omitempty"`
	Eid               int64    `json:"eid,omitempty"`
	LibraryID         int64    `json:"library_id,omitempty"`
	SourceFileID      int64    `json:"source_file_id,omitempty"`
	SourceChunks      []string `json:"source_chunks,omitempty"`
}

type WikiPageModifyInput struct {
	PageSlug         string
	PageTitle        string
	PageType         string
	PageAliases      string
	ExistingContent  string
	NewInformation   string
	DeletedContent   string
	RemainingSources string
	AvailableSlugs   string
	Language         string
	HasAdditions     bool
	HasRetractions   bool
}
