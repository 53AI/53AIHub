package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	ragservice "github.com/53AI/53AIHub/service/rag"
)

type RecordingEnterpriseKnowledgeSearchRequest struct {
	EID        int64
	UserID     int64
	Query      string
	LibraryIDs []int64
	FileIDs    []int64
	TopK       int
}

// SearchRecordingEnterpriseKnowledge delegates permission, status, quality
// threshold and rerank decisions to the existing LibrarySearchService. An
// empty library scope is an explicit no-op, never an enterprise-wide search.
func SearchRecordingEnterpriseKnowledge(ctx context.Context, request RecordingEnterpriseKnowledgeSearchRequest) ([]RecordingDecisionEnterpriseKnowledgeCandidate, []string, error) {
	if strings.TrimSpace(request.Query) == "" {
		return nil, nil, fmt.Errorf("enterprise knowledge query is empty")
	}
	libraryIDs := normalizePositiveInt64s(request.LibraryIDs)
	if len(libraryIDs) == 0 {
		return []RecordingDecisionEnterpriseKnowledgeCandidate{}, []string{"enterprise_knowledge_scope_missing"}, nil
	}
	fileFilter := make(map[int64]struct{}, len(request.FileIDs))
	for _, fileID := range normalizePositiveInt64s(request.FileIDs) {
		fileFilter[fileID] = struct{}{}
	}
	searcher := ragservice.NewLibrarySearchService(model.DB)
	candidates := make([]RecordingDecisionEnterpriseKnowledgeCandidate, 0)
	omitted := make([]string, 0)
	for _, libraryID := range libraryIDs {
		result, err := searcher.Search(ctx, &ragservice.LibrarySearchParams{EID: request.EID, UserID: request.UserID, LibraryID: libraryID, Query: strings.TrimSpace(request.Query), TopK: request.TopK})
		if err != nil {
			omitted = append(omitted, enterpriseKnowledgeSearchFailureReason(libraryID, err))
			continue
		}
		for _, item := range result.Results {
			if len(fileFilter) > 0 {
				if _, allowed := fileFilter[item.FileID]; !allowed {
					continue
				}
			}
			chunkID, encodeErr := hashids.Encode(item.ChunkID)
			if encodeErr != nil {
				return nil, omitted, fmt.Errorf("encode enterprise chunk id: %w", encodeErr)
			}
			libraryHashID := hashIDOrEmpty(item.LibraryID)
			candidates = append(candidates, RecordingDecisionEnterpriseKnowledgeCandidate{
				ChunkID: chunkID, Content: strings.TrimSpace(item.Content), EvidenceRefs: []string{chunkID},
				PermissionScope: "library:" + libraryHashID, RetrievalReason: fmt.Sprintf("rag_%s_score_%.4f", result.Type, item.Score), Authorized: true,
			})
		}
	}
	omitted = enterpriseKnowledgeSearchOmittedReasons(candidates, omitted)
	return candidates, omitted, nil
}

func enterpriseKnowledgeSearchFailureReason(libraryID int64, err error) string {
	code := "enterprise_knowledge_search_failed"
	if errors.Is(err, context.DeadlineExceeded) {
		code = "enterprise_knowledge_timeout"
	}
	return code + ":" + hashIDOrEmpty(libraryID)
}

func enterpriseKnowledgeSearchOmittedReasons(candidates []RecordingDecisionEnterpriseKnowledgeCandidate, omitted []string) []string {
	if len(candidates) == 0 && len(omitted) == 0 {
		return append(omitted, "enterprise_knowledge_no_hit")
	}
	return omitted
}

func normalizePositiveInt64s(values []int64) []int64 {
	seen := make(map[int64]struct{}, len(values))
	result := make([]int64, 0, len(values))
	for _, value := range values {
		if value > 0 {
			if _, exists := seen[value]; !exists {
				seen[value] = struct{}{}
				result = append(result, value)
			}
		}
	}
	return result
}

func hashIDOrEmpty(value int64) string {
	encoded, err := hashids.Encode(value)
	if err != nil {
		return ""
	}
	return encoded
}
