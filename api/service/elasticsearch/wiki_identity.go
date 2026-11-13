package elasticsearch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/model"
	"github.com/elastic/go-elasticsearch/v7/esapi"
)

// SearchWikiIdentityIDs finds possible existing Wiki identities without the
// user-facing search's full-library page-ID and permission preflight.
// Caller must verify the returned IDs against its tenant/library/type database scope.
func (c *Client) SearchWikiIdentityIDs(ctx context.Context, eid, libraryID int64, pageType, name, slug string, aliases []string, limit int) ([]int64, error) {
	if c == nil || c.IsDisabled() || eid <= 0 || libraryID <= 0 || limit <= 0 {
		return nil, nil
	}
	if limit > 20 {
		limit = 20
	}
	should := make([]map[string]interface{}, 0, len(aliases)+3)
	if slug = strings.TrimSpace(slug); slug != "" {
		should = append(should, map[string]interface{}{"term": map[string]interface{}{"slug": map[string]interface{}{"value": slug, "boost": 12}}})
	}
	for _, word := range append([]string{name}, aliases...) {
		word = strings.TrimSpace(word)
		if word == "" {
			continue
		}
		should = append(should, map[string]interface{}{"multi_match": map[string]interface{}{
			"query": word, "fields": []string{"title^8", "aliases^6", "summary^1"}, "type": "best_fields", "operator": "and",
		}})
	}
	if len(should) == 0 {
		return nil, nil
	}
	body, err := json.Marshal(map[string]interface{}{
		"size":    limit,
		"_source": []string{"page_id"},
		"query": map[string]interface{}{"bool": map[string]interface{}{
			"filter": []map[string]interface{}{
				{"term": map[string]interface{}{"eid": eid}},
				{"term": map[string]interface{}{"library_id": libraryID}},
				{"term": map[string]interface{}{"page_type": pageType}},
				{"term": map[string]interface{}{"status": model.WikiPageStatusActive}},
			},
			"should": should, "minimum_should_match": 1,
		}},
	})
	if err != nil {
		return nil, err
	}
	res, err := (esapi.SearchRequest{Index: []string{c.GetWikiIndexName()}, Body: bytes.NewReader(body)}).Do(ctx, c)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == 404 {
		return nil, nil
	}
	if res.IsError() {
		return nil, fmt.Errorf("wiki identity ES search: %s", res.Status())
	}
	var result struct {
		Hits struct {
			Hits []struct {
				Source struct {
					PageID int64 `json:"page_id"`
				} `json:"_source"`
			} `json:"hits"`
		} `json:"hits"`
	}
	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(result.Hits.Hits))
	for _, hit := range result.Hits.Hits {
		if hit.Source.PageID > 0 {
			ids = append(ids, hit.Source.PageID)
		}
	}
	return ids, nil
}

// SyncWikiPage applies the committed database snapshot; archived pages are deleted.
// This is a best-effort near-real-time update; the scoped reindex command repairs gaps.
func (c *Client) SyncWikiPage(ctx context.Context, page *model.WikiPage) error {
	if c == nil || c.IsDisabled() || page == nil {
		return nil
	}
	if page.Status != model.WikiPageStatusActive {
		res, err := (esapi.DeleteRequest{Index: c.GetWikiIndexName(), DocumentID: wikiDocumentID(page.ID)}).Do(ctx, c)
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode == 404 {
			return nil
		}
		if res.IsError() {
			return fmt.Errorf("delete archived wiki ES page: %s", res.Status())
		}
		return nil
	}
	body, err := json.Marshal(convertToWikiDocument(page))
	if err != nil {
		return err
	}
	res, err := (esapi.IndexRequest{
		Index: c.GetWikiIndexName(), DocumentID: wikiDocumentID(page.ID), Body: bytes.NewReader(body), Refresh: "false",
	}).Do(ctx, c)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.IsError() {
		return fmt.Errorf("index wiki ES page: %s", res.Status())
	}
	return nil
}
