package mcp

import (
	"context"
	"errors"
	"strings"

	ragservice "github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

type KnowledgeSearchService struct {
	librarySearchService *ragservice.LibrarySearchService
}

func NewKnowledgeSearchService(db *gorm.DB) *KnowledgeSearchService {
	return &KnowledgeSearchService{
		librarySearchService: ragservice.NewLibrarySearchService(db),
	}
}

func (s *KnowledgeSearchService) SearchKnowledgeChunks(ctx context.Context, eid, userID, libraryID int64, query string, topK int) (*ragservice.LibrarySearchResult, error) {
	if strings.TrimSpace(query) == "" {
		return nil, errors.New("搜索关键词不能为空")
	}
	if libraryID <= 0 {
		return nil, errors.New("知识库ID不能为空")
	}
	if topK <= 0 {
		topK = 10
	}

	return s.librarySearchService.Search(ctx, &ragservice.LibrarySearchParams{
		EID:       eid,
		UserID:    userID,
		LibraryID: libraryID,
		Query:     query,
		TopK:      topK,
	})
}
