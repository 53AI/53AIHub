package service

import (
	"context"
	"strings"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/elasticsearch"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/53AI/53AIHub/service/vectorstore"
	"gorm.io/gorm"
)

func searchWikiIdentityES(ctx context.Context, eid, libraryID int64, item WikiDedupItem) ([]int64, error) {
	client := elasticsearch.GetInitializedClient()
	if client == nil || client.IsDisabled() {
		return nil, nil
	}
	return client.SearchWikiIdentityIDs(ctx, eid, libraryID, item.Type, item.Name, item.Slug, item.Aliases, 8)
}

// 复用现有 Wiki 正文向量索引补充候选；向量命中本身不构成实体合并的证据。
func searchWikiIdentitySemantic(ctx context.Context, db *gorm.DB, eid, libraryID int64, item WikiDedupItem) ([]int64, error) {
	if !db.Migrator().HasTable(&model.WikiPageChunk{}) {
		return nil, nil
	}
	var indexed []model.WikiPageChunk
	if err := db.WithContext(ctx).Model(&model.WikiPageChunk{}).Select("id").
		Where("eid = ? AND index_status = ?", eid, model.WikiPageChunkIndexStatusActive).
		Limit(1).Find(&indexed).Error; err != nil || len(indexed) == 0 {
		return nil, err
	}
	store, err := vectorstore.GetGlobalVectorStore()
	if err != nil || store == nil {
		return nil, err
	}
	config, err := rag.NewChunkConfigService(db).GetEnterpriseEmbeddingConfig(eid)
	if err != nil {
		return nil, nil
	}
	query := strings.TrimSpace(item.Name + " " + wikiIdentityShortText(item.Description, 200))
	if query == "" {
		return nil, nil
	}
	embedding, err := rag.NewEmbeddingService(db).GetQueryEmbedding(eid, query, *config.EmbeddingChannelID, config)
	if err != nil {
		return nil, err
	}
	vector := make([]float32, len(embedding))
	for i, n := range embedding {
		vector[i] = float32(n)
	}
	filter := rag.SearchScope{Eid: eid, LibraryIDs: []int64{libraryID}}.BuildVectorFilter()
	filter["must"] = append(filter["must"].([]map[string]interface{}),
		map[string]interface{}{"key": "source_type", "match": map[string]interface{}{"value": "wiki"}},
		map[string]interface{}{"key": "status", "match": map[string]interface{}{"value": model.WikiPageChunkIndexStatusActive}},
	)
	result, err := store.Search(ctx, vectorstore.SearchRequest{
		Collection: WikiVectorCollectionName(eid), Vector: vector, TopK: 12, Filters: filter,
	})
	if vectorstore.IsNotFoundError(err) {
		return nil, nil
	}
	if err != nil || result == nil {
		return nil, err
	}
	ids := make([]int64, 0, len(result.Results))
	seen := make(map[int64]bool)
	for _, hit := range result.Results {
		id := wikiMetadataInt64(hit.Metadata, "wiki_page_id")
		if id > 0 && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids, nil
}

// 将本次候选实际命中的别名提前，避免长别名列表截断后丢失关键消歧依据。
func wikiIdentityRankAliases(aliases, names []string) []string {
	wanted := make(map[string]bool, len(names))
	for _, name := range names {
		wanted[strings.ToLower(strings.TrimSpace(name))] = true
	}
	ranked := make([]string, 0, len(aliases))
	for _, alias := range aliases {
		if wanted[strings.ToLower(strings.TrimSpace(alias))] {
			ranked = append(ranked, alias)
		}
	}
	for _, alias := range aliases {
		if !wanted[strings.ToLower(strings.TrimSpace(alias))] {
			ranked = append(ranked, alias)
		}
	}
	return ranked
}

func wikiIdentityNamesOverlap(a, b WikiDedupItem) bool {
	known := make(map[string]bool)
	for _, v := range append([]string{a.Name}, a.Aliases...) {
		v = strings.ToLower(strings.TrimSpace(v))
		if v != "" {
			known[v] = true
		}
	}
	for _, v := range append([]string{b.Name}, b.Aliases...) {
		if known[strings.ToLower(strings.TrimSpace(v))] {
			return true
		}
	}
	return false
}

func wikiIdentityShortText(s string, limit int) string {
	runes := []rune(strings.TrimSpace(s))
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes)
}
