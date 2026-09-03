package service

import (
	"crypto/sha256"
	"encoding/hex"

	"github.com/53AI/53AIHub/model"
)

func wikiDocumentContentFingerprint(content string) string {
	digest := sha256.Sum256([]byte(content))
	return hex.EncodeToString(digest[:])
}

func wikiCompiledSourcesMatchUpdates(existing []model.WikiPageSource, eid int64, additions, retracts []WikiSlugUpdate) bool {
	candidate := buildWikiPageSourcesForCompiledUpdates(existing, eid, additions, retracts)
	if len(candidate) == 0 {
		return len(existing) == 0
	}
	for _, source := range candidate {
		if source.SourceContentHash == "" {
			return false
		}
	}
	return wikiPageSourcesEqual(existing, candidate)
}
