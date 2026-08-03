package service

import "context"

func (s *WikiIngestV2Service) planWikiBatchTaxonomy(ctx context.Context, in WikiIngestV2MapDocumentInput, spaceID int64, updates []WikiSlugUpdate) (map[string]int64, error) {
	if s == nil || s.taxonomy == nil {
		return nil, nil
	}

	plannedPaths, err := s.taxonomy.PlanBatchTaxonomy(ctx, in.Eid, in.LibraryID, updates, in.Language)
	if err != nil || len(plannedPaths) == 0 {
		return nil, err
	}
	return s.taxonomy.ResolvePlannedFolders(ctx, in.Eid, in.LibraryID, spaceID, plannedPaths)
}
