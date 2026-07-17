package rag

// SearchScope 统一表达搜索范围，替代松散传递 space_ids / library_ids / file_ids
// 企业级 collection 模式下，所有向量检索通过 SearchScope 构建 payload filter
type SearchScope struct {
	Eid        int64
	SpaceIDs   []int64
	LibraryIDs []int64
	FileIDs    []int64
	ChunkTypes []string

	// 展开后的安全范围（由实体收敛或权限过滤后填充）
	ResolvedLibraryIDs []int64
	ResolvedFileIDs    []int64

	// 来源标识：space / library / file / mixed / default
	Source string
}

// Normalize 去重并保持顺序的 ID 列表
func (s SearchScope) Normalize() SearchScope {
	s.SpaceIDs = uniqueInt64IDsInOrder(s.SpaceIDs)
	s.LibraryIDs = uniqueInt64IDsInOrder(s.LibraryIDs)
	s.FileIDs = uniqueInt64IDsInOrder(s.FileIDs)
	s.ResolvedLibraryIDs = uniqueInt64IDsInOrder(s.ResolvedLibraryIDs)
	s.ResolvedFileIDs = uniqueInt64IDsInOrder(s.ResolvedFileIDs)
	return s
}

// BuildVectorFilter 构建 Qdrant payload filter，包含 eid 以及非空的层级条件
func (s SearchScope) BuildVectorFilter() map[string]interface{} {
	normalized := s.Normalize()
	must := []map[string]interface{}{
		{
			"key":   "eid",
			"match": map[string]interface{}{"value": normalized.Eid},
		},
	}
	if len(normalized.SpaceIDs) > 0 {
		must = append(must, map[string]interface{}{
			"key":   "space_id",
			"match": map[string]interface{}{"any": normalized.SpaceIDs},
		})
	}
	if len(normalized.LibraryIDs) > 0 {
		must = append(must, map[string]interface{}{
			"key":   "library_id",
			"match": map[string]interface{}{"any": normalized.LibraryIDs},
		})
	}
	if len(normalized.FileIDs) > 0 {
		must = append(must, map[string]interface{}{
			"key":   "file_id",
			"match": map[string]interface{}{"any": normalized.FileIDs},
		})
	}
	if len(normalized.ChunkTypes) > 0 {
		must = append(must, map[string]interface{}{
			"key":   "chunk_type",
			"match": map[string]interface{}{"any": normalized.ChunkTypes},
		})
	}
	return map[string]interface{}{"must": must}
}
