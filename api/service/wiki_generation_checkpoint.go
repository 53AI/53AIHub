package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type wikiGenerationCheckpoint struct {
	ProcessingVersion            string                             `json:"processing_version,omitempty"`
	ContentFingerprint           string                             `json:"content_fingerprint"`
	WikiGenerationMode           string                             `json:"wiki_generation_mode,omitempty"`
	WikiCategoryScopeFingerprint string                             `json:"wiki_category_scope_fingerprint,omitempty"`
	Result                       *WikiIngestV2MapDocumentResult     `json:"result,omitempty"`
	Candidates                   []wikiIngestV2Candidate            `json:"candidates,omitempty"`
	Updates                      []WikiSlugUpdate                   `json:"updates,omitempty"`
	CompletedSlugs               []string                           `json:"completed_slugs,omitempty"`
	CompletedCategoryPages       []string                           `json:"completed_category_pages,omitempty"`
	CompiledResults              map[string]string                  `json:"compiled_results,omitempty"`
	SlugStates                   map[string]wikiSlugCheckpointState `json:"slug_states,omitempty"`
}

type wikiSlugCheckpointState struct {
	Status    string `json:"status"`
	Attempts  int    `json:"attempts"`
	LastError string `json:"last_error,omitempty"`
}

const (
	wikiGenerationCheckpointProcessingVersion = "candidate-fields-v2"
	wikiSlugStateProcessing                   = "processing"
	wikiSlugStateSuccess                      = "success"
	wikiSlugStateFailed                       = "failed"
)

func (c wikiGenerationCheckpoint) canResume(contentFingerprint, generationMode, categoryScopeFingerprint string) bool {
	return c.ProcessingVersion == wikiGenerationCheckpointProcessingVersion &&
		c.ContentFingerprint != "" && c.ContentFingerprint == contentFingerprint &&
		model.NormalizeWikiGenerationMode(c.WikiGenerationMode) == model.NormalizeWikiGenerationMode(generationMode) &&
		(model.NormalizeWikiGenerationMode(generationMode) != model.WikiGenerationModeStrict || c.WikiCategoryScopeFingerprint == categoryScopeFingerprint) && c.Result != nil
}

func (c *wikiGenerationCheckpoint) markSlugCompleted(slug string) {
	if c == nil || slug == "" {
		return
	}
	for _, completed := range c.CompletedSlugs {
		if completed == slug {
			return
		}
	}
	c.CompletedSlugs = append(c.CompletedSlugs, slug)
	sort.Strings(c.CompletedSlugs)
	c.markSlugState(slug, wikiSlugStateSuccess, "")
}

func (c *wikiGenerationCheckpoint) markSlugState(slug, status string, lastError string) {
	if c == nil || slug == "" {
		return
	}
	if c.SlugStates == nil {
		c.SlugStates = make(map[string]wikiSlugCheckpointState)
	}
	state := c.SlugStates[slug]
	state.Status = status
	state.LastError = lastError
	c.SlugStates[slug] = state
}

func (c wikiGenerationCheckpoint) isSlugCompleted(slug string) bool {
	for _, completed := range c.CompletedSlugs {
		if completed == slug {
			return true
		}
	}
	return false
}

func wikiCategoryCheckpointKey(categorySlug, entitySlug string) string {
	return strings.TrimSpace(categorySlug) + "|" + strings.TrimSpace(entitySlug)
}

func (c *wikiGenerationCheckpoint) markCategoryPageCompleted(key string) {
	if c == nil || strings.TrimSpace(key) == "" || c.isCategoryPageCompleted(key) {
		return
	}
	c.CompletedCategoryPages = append(c.CompletedCategoryPages, key)
	sort.Strings(c.CompletedCategoryPages)
}

func (c wikiGenerationCheckpoint) isCategoryPageCompleted(key string) bool {
	for _, completed := range c.CompletedCategoryPages {
		if completed == key {
			return true
		}
	}
	return false
}

func (c wikiGenerationCheckpoint) slugState(slug string) wikiSlugCheckpointState {
	if c.SlugStates == nil {
		return wikiSlugCheckpointState{}
	}
	return c.SlugStates[slug]
}

func (c wikiGenerationCheckpoint) shouldProcessSlug(slug string) bool {
	return !c.isSlugCompleted(slug)
}

func (c *wikiGenerationCheckpoint) markSlugProcessing(slug string) {
	if c == nil || slug == "" {
		return
	}
	if c.SlugStates == nil {
		c.SlugStates = make(map[string]wikiSlugCheckpointState)
	}
	state := c.SlugStates[slug]
	state.Status = wikiSlugStateProcessing
	state.Attempts++
	state.LastError = ""
	c.SlugStates[slug] = state
}

func (c *wikiGenerationCheckpoint) markSlugFailed(slug string, err error) {
	if c == nil || slug == "" {
		return
	}
	if c.SlugStates == nil {
		c.SlugStates = make(map[string]wikiSlugCheckpointState)
	}
	state := c.SlugStates[slug]
	state.Status = wikiSlugStateFailed
	if err != nil {
		state.LastError = err.Error()
	}
	c.SlugStates[slug] = state
}

func (c *wikiGenerationCheckpoint) cacheCompiledResult(slug, result string) {
	if c == nil || slug == "" || result == "" {
		return
	}
	if c.CompiledResults == nil {
		c.CompiledResults = make(map[string]string)
	}
	c.CompiledResults[slug] = result
}

func (c wikiGenerationCheckpoint) compiledResult(slug string) string {
	return c.CompiledResults[slug]
}

func loadWikiGenerationCheckpoint(ctx context.Context, db *gorm.DB, jobID int64) (*wikiGenerationCheckpoint, error) {
	if db == nil || jobID <= 0 {
		return nil, nil
	}

	var step model.RagJobStep
	if err := db.WithContext(ctx).Where("job_id = ?", jobID).First(&step).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	if step.Results == "" {
		return nil, nil
	}

	var checkpoint wikiGenerationCheckpoint
	if err := json.Unmarshal([]byte(step.Results), &checkpoint); err != nil {
		return nil, fmt.Errorf("parse wiki generation checkpoint: %w", err)
	}
	return &checkpoint, nil
}

func persistWikiGenerationCheckpoint(ctx context.Context, db *gorm.DB, jobID int64, checkpoint wikiGenerationCheckpoint) error {
	if db == nil || jobID <= 0 {
		return nil
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var step model.RagJobStep
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("job_id = ?", jobID).First(&step).Error; err != nil {
			return err
		}
		var current wikiGenerationCheckpoint
		if step.Results != "" {
			if err := json.Unmarshal([]byte(step.Results), &current); err != nil {
				return fmt.Errorf("parse wiki generation checkpoint: %w", err)
			}
		}
		merged := mergeWikiGenerationCheckpoint(current, checkpoint)
		data, err := json.Marshal(merged)
		if err != nil {
			return fmt.Errorf("marshal wiki generation checkpoint: %w", err)
		}
		return tx.Model(&step).Update("results", string(data)).Error
	})
}

func mergeWikiGenerationCheckpoint(current, incoming wikiGenerationCheckpoint) wikiGenerationCheckpoint {
	if incoming.ProcessingVersion != "" {
		current.ProcessingVersion = incoming.ProcessingVersion
	}
	if incoming.ContentFingerprint != "" {
		current.ContentFingerprint = incoming.ContentFingerprint
	}
	if incoming.WikiGenerationMode != "" {
		current.WikiGenerationMode = incoming.WikiGenerationMode
	}
	if incoming.WikiCategoryScopeFingerprint != "" {
		current.WikiCategoryScopeFingerprint = incoming.WikiCategoryScopeFingerprint
	}
	if incoming.Result != nil {
		current.Result = incoming.Result
	}
	if incoming.Candidates != nil {
		current.Candidates = incoming.Candidates
	}
	if incoming.Updates != nil {
		current.Updates = incoming.Updates
	}
	completed := make(map[string]struct{}, len(current.CompletedSlugs)+len(incoming.CompletedSlugs))
	for _, slug := range append(current.CompletedSlugs, incoming.CompletedSlugs...) {
		completed[slug] = struct{}{}
	}
	current.CompletedSlugs = current.CompletedSlugs[:0]
	for slug := range completed {
		current.CompletedSlugs = append(current.CompletedSlugs, slug)
	}
	sort.Strings(current.CompletedSlugs)
	categoryPages := make(map[string]struct{}, len(current.CompletedCategoryPages)+len(incoming.CompletedCategoryPages))
	for _, key := range append(current.CompletedCategoryPages, incoming.CompletedCategoryPages...) {
		categoryPages[key] = struct{}{}
	}
	current.CompletedCategoryPages = current.CompletedCategoryPages[:0]
	for key := range categoryPages {
		current.CompletedCategoryPages = append(current.CompletedCategoryPages, key)
	}
	sort.Strings(current.CompletedCategoryPages)
	if current.CompiledResults == nil {
		current.CompiledResults = make(map[string]string)
	}
	for slug, result := range incoming.CompiledResults {
		current.CompiledResults[slug] = result
	}
	if current.SlugStates == nil {
		current.SlugStates = make(map[string]wikiSlugCheckpointState)
	}
	for slug, state := range incoming.SlugStates {
		previous := current.SlugStates[slug]
		if previous.Status == wikiSlugStateSuccess || state.Attempts >= previous.Attempts {
			current.SlugStates[slug] = state
		}
	}
	for _, slug := range current.CompletedSlugs {
		state := current.SlugStates[slug]
		state.Status = wikiSlugStateSuccess
		state.LastError = ""
		current.SlugStates[slug] = state
	}
	return current
}
