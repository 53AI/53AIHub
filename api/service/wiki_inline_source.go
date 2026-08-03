package service

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

type wikiInlineSourceNormalization struct {
	Body    string
	Sources []model.WikiPageSource
}

var wikiInlineSourcePattern = regexp.MustCompile(`\[source:\s*file:\s*([^\]#\s]+)\s*(?:#\s*([^\]\s]+))?\s*\]`)
var wikiFileSourceRefPattern = regexp.MustCompile(`^file:\s*([^#\s]+)\s*(?:#\s*([^\s]+))?$`)

func normalizeWikiInlineSources(body string) (wikiInlineSourceNormalization, error) {
	result := wikiInlineSourceNormalization{Body: body}
	seen := make(map[string]struct{})
	var normalizeErr error

	result.Body = wikiInlineSourcePattern.ReplaceAllStringFunc(body, func(token string) string {
		if normalizeErr != nil {
			return token
		}
		matches := wikiInlineSourcePattern.FindStringSubmatch(token)
		if len(matches) < 2 {
			return token
		}
		fileID, err := hashids.TryParseID(strings.TrimSpace(matches[1]))
		if err != nil || fileID <= 0 {
			if err == nil {
				err = fmt.Errorf("file id must be positive")
			}
			normalizeErr = fmt.Errorf("invalid wiki inline source file id %q: %w", matches[1], err)
			return token
		}

		sourceRef := fmt.Sprintf("file:%d", fileID)
		if chunk := strings.TrimSpace(matches[2]); chunk != "" {
			sourceRef += "#" + chunk
		}
		if _, exists := seen[sourceRef]; !exists {
			seen[sourceRef] = struct{}{}
			result.Sources = append(result.Sources, model.WikiPageSource{
				SourceKind:    model.WikiPageSourceKindManual,
				SourceRef:     sourceRef,
				SourceFileID:  fileID,
				SourceChunkID: 0,
			})
		}
		return "[source: " + sourceRef + "]"
	})
	if normalizeErr != nil {
		return wikiInlineSourceNormalization{}, normalizeErr
	}
	return result, nil
}

func normalizeWikiPageSourceInput(input WikiPageSourceInput, eid, creatorID, pageID int64, pageSlug string) (model.WikiPageSource, error) {
	row := model.WikiPageSource{
		Eid:               eid,
		PageID:            pageID,
		SourceKind:        firstNonEmpty(strings.TrimSpace(input.SourceKind), model.WikiPageSourceKindManual),
		SourceRef:         strings.TrimSpace(input.SourceRef),
		SourceFileID:      input.SourceFileID,
		SourceChunkID:     input.SourceChunkID,
		SourceSlug:        strings.TrimSpace(input.SourceSlug),
		SourceLocation:    strings.TrimSpace(input.SourceLocation),
		SourceContentHash: strings.TrimSpace(input.SourceContentHash),
		SourceURL:         strings.TrimSpace(input.SourceURL),
		ExternalID:        strings.TrimSpace(input.ExternalID),
		ExternalDigest:    strings.TrimSpace(input.ExternalDigest),
		MetaJSON:          strings.TrimSpace(input.MetaJSON),
		LastSyncedTime:    input.LastSyncedTime,
		CreatorID:         creatorID,
	}
	if row.SourceRef != "" {
		if matches := wikiFileSourceRefPattern.FindStringSubmatch(row.SourceRef); len(matches) > 0 {
			fileID, err := parseWikiInlineFileID(matches[1])
			if err != nil {
				return model.WikiPageSource{}, err
			}
			if row.SourceFileID > 0 && row.SourceFileID != fileID {
				return model.WikiPageSource{}, fmt.Errorf("wiki source file id mismatch: %d != %d", row.SourceFileID, fileID)
			}
			row.SourceFileID = fileID
			row.SourceRef = fmt.Sprintf("file:%d", fileID)
			if chunk := strings.TrimSpace(matches[2]); chunk != "" {
				row.SourceRef += "#" + chunk
			}
		}
	}
	if row.SourceRef == "" && row.SourceFileID > 0 {
		row.SourceRef = fmt.Sprintf("file:%d", row.SourceFileID)
	}
	if row.SourceRef == "" {
		row.SourceRef = firstNonEmpty(row.SourceSlug, pageSlug)
	}
	return row, nil
}

func parseWikiInlineFileID(raw string) (int64, error) {
	id, err := hashids.TryParseID(strings.TrimSpace(raw))
	if err != nil || id <= 0 {
		if err == nil {
			err = fmt.Errorf("file id must be positive")
		}
		return 0, fmt.Errorf("invalid wiki source file id %q: %w", raw, err)
	}
	return id, nil
}

func buildWikiPageSources(eid, creatorID, pageID int64, pageSlug string, inputs []WikiPageSourceInput) ([]model.WikiPageSource, error) {
	if len(inputs) == 0 {
		return nil, nil
	}
	rows := make([]model.WikiPageSource, 0, len(inputs))
	seen := make(map[string]struct{}, len(inputs))
	for _, input := range inputs {
		row, err := normalizeWikiPageSourceInput(input, eid, creatorID, pageID, pageSlug)
		if err != nil {
			return nil, err
		}
		key := wikiPageSourceKey(row)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		rows = append(rows, row)
	}
	return rows, nil
}

func mergeWikiPageSources(base, additions []model.WikiPageSource) []model.WikiPageSource {
	merged := make([]model.WikiPageSource, 0, len(base)+len(additions))
	seen := make(map[string]struct{}, len(base)+len(additions))
	for _, source := range append(append([]model.WikiPageSource{}, base...), additions...) {
		key := wikiPageSourceKey(source)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		merged = append(merged, source)
	}
	return merged
}

func wikiPageSourceKey(source model.WikiPageSource) string {
	return fmt.Sprintf("%d\x00%s", source.SourceFileID, strings.TrimSpace(source.SourceRef))
}

func wikiPageSourcesForWrite(sources []model.WikiPageSource, eid, creatorID, pageID int64) []model.WikiPageSource {
	for i := range sources {
		sources[i].Eid = eid
		sources[i].PageID = pageID
		sources[i].CreatorID = creatorID
	}
	return sources
}

func retainWikiAutomaticSources(sources []model.WikiPageSource) []model.WikiPageSource {
	retained := make([]model.WikiPageSource, 0, len(sources))
	for _, source := range sources {
		if source.SourceKind != model.WikiPageSourceKindManual {
			retained = append(retained, source)
		}
	}
	return retained
}

func validateWikiPageSourceFiles(tx *gorm.DB, eid, userID int64, sources []model.WikiPageSource) error {
	fileIDs := make([]int64, 0, len(sources))
	seen := make(map[int64]struct{}, len(sources))
	for _, source := range sources {
		if source.SourceFileID <= 0 {
			continue
		}
		if _, exists := seen[source.SourceFileID]; exists {
			continue
		}
		seen[source.SourceFileID] = struct{}{}
		fileIDs = append(fileIDs, source.SourceFileID)
	}
	if len(fileIDs) == 0 {
		return nil
	}

	var files []model.File
	if err := tx.Where("eid = ? AND id IN ?", eid, fileIDs).Find(&files).Error; err != nil {
		return err
	}
	filesByID := make(map[int64]model.File, len(files))
	for _, file := range files {
		filesByID[file.ID] = file
	}
	for _, fileID := range fileIDs {
		file, exists := filesByID[fileID]
		if !exists || file.IsDeleted {
			logger.Warnf(nil, "wiki inline source: source file %d not found or deleted, skipping", fileID)
			continue
		}
		if file.UserID == userID {
			continue
		}
		permission, err := common.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
		if err != nil {
			return fmt.Errorf("check wiki source file %d permission: %w", fileID, err)
		}
		if permission < model.PERMISSION_VIEW_ONLY {
			return fmt.Errorf("wiki source file %d is not accessible", fileID)
		}
	}
	return nil
}
