package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
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
	data, err := json.Marshal(checkpoint)
	if err != nil {
		return fmt.Errorf("marshal wiki generation checkpoint: %w", err)
	}
	result := db.WithContext(ctx).Model(&model.RagJobStep{}).
		Where("job_id = ?", jobID).
		Update("results", string(data))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
