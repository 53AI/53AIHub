package rag

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
)

// DocumentQASegment is a request-local slice of the original document.
// Positions count Unicode code points and use an exclusive end offset.
type DocumentQASegment struct {
	FileID          int64
	FileName        string
	Index           int
	StartPosition   int
	EndPosition     int
	Content         string
	EstimatedTokens int
}

type DocumentQAContent struct {
	FileID      int64
	FileBodyID  int64
	ContentHash string
	Content     string
}

// ReadDocumentBody loads the current body. The caller must verify file access first.
func ReadDocumentBody(ctx context.Context, eid, fileID int64) (*DocumentQAContent, error) {
	body, err := model.GetLastFileBodyByFileIDWithContext(ctx, eid, fileID)
	if err != nil {
		return nil, err
	}
	content, err := body.GetContent()
	if err != nil {
		return nil, err
	}
	content = common.StripInternalContactComments(content)
	hash := sha256.Sum256([]byte(content))
	return &DocumentQAContent{
		FileID:      fileID,
		FileBodyID:  body.ID,
		ContentHash: hex.EncodeToString(hash[:]),
		Content:     content,
	}, nil
}

// SegmentDocument splits content without dropping or duplicating characters.
func SegmentDocument(content string, fileID int64, fileName string, maxTokens int) ([]DocumentQASegment, error) {
	if maxTokens <= 0 {
		return nil, errors.New("maxTokens must be positive")
	}
	if content == "" {
		return nil, nil
	}

	runes := []rune(content)
	segments := make([]DocumentQASegment, 0, (len(runes)+maxTokens-1)/maxTokens)
	for start := 0; start < len(runes); {
		low, high := start+1, len(runes)
		end := start
		for low <= high {
			middle := low + (high-low)/2
			if estimateDocumentQATokens(string(runes[start:middle])) <= maxTokens {
				end = middle
				low = middle + 1
			} else {
				high = middle - 1
			}
		}
		if end == start {
			return nil, errors.New("maxTokens is smaller than one rune")
		}
		if end < len(runes) {
			boundary := -1
			for i := end - 1; i > start+(end-start)/2; i-- {
				if runes[i] == '\n' {
					boundary = i + 1
					break
				}
			}
			if boundary > start {
				end = boundary
			}
		}

		segmentRunes := runes[start:end]
		segments = append(segments, DocumentQASegment{
			FileID:          fileID,
			FileName:        fileName,
			Index:           len(segments) + 1,
			StartPosition:   start,
			EndPosition:     end,
			Content:         string(segmentRunes),
			EstimatedTokens: estimateDocumentQATokens(string(segmentRunes)),
		})
		start = end
	}
	return segments, nil
}

func estimateDocumentQATokens(content string) int {
	tokens, _ := NewTokenizerService().CountTokens(content)
	return tokens
}

// JoinDocumentQASegments reconstructs the original text when segments are
// complete, ordered, and non-overlapping.
func JoinDocumentQASegments(segments []DocumentQASegment) string {
	var content strings.Builder
	for _, segment := range segments {
		content.WriteString(segment.Content)
	}
	return content.String()
}
