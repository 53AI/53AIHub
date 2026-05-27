package elasticsearch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/elastic/go-elasticsearch/v7/esapi"
)

// IndexManager 索引管理器
type IndexManager struct {
	client *Client
}

// NewIndexManager 创建索引管理器
func NewIndexManager(client *Client) *IndexManager {
	return &IndexManager{
		client: client,
	}
}

// CreateFilesIndex 创建文件索引
func (m *IndexManager) CreateFilesIndex() error {
	if m.client.IsDisabled() {
		logger.SysLogf("Elasticsearch 已禁用，跳过索引创建")
		return nil
	}

	// 定义索引映射
	mapping := m.buildFilesIndexMapping()

	// 序列化映射
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(mapping); err != nil {
		return fmt.Errorf("编码索引映射失败: %v", err)
	}

	// 检查索引是否已存在
	exists, err := m.IndexExists()
	if err != nil {
		return fmt.Errorf("检查索引存在性失败: %v", err)
	}

	if exists {
		logger.SysLogf("索引 %s 已存在，尝试补充字段映射", m.client.GetIndexName())
		if err := m.updateFilesIndexMapping(); err != nil {
			return fmt.Errorf("更新索引映射失败: %v", err)
		}
		return nil
	}

	// 创建索引
	req := esapi.IndicesCreateRequest{
		Index: m.client.GetIndexName(),
		Body:  &buf,
	}

	res, err := req.Do(context.Background(), m.client)
	if err != nil {
		return fmt.Errorf("创建索引失败: %v", err)
	}
	defer res.Body.Close()

	if res.IsError() {
		return fmt.Errorf("创建索引响应错误: %s", res.Status())
	}

	logger.SysLogf("成功创建索引: %s", m.client.GetIndexName())
	return nil
}

func (m *IndexManager) buildFilesIndexMapping() map[string]interface{} {
	return map[string]interface{}{
		"mappings": map[string]interface{}{
			"properties": map[string]interface{}{
				"file_id": map[string]interface{}{
					"type": "long",
				},
				"eid": map[string]interface{}{
					"type": "long",
				},
				"library_id": map[string]interface{}{
					"type": "long",
				},
				"origin_type": map[string]interface{}{
					"type": "keyword",
				},
				"origin_ref_id": map[string]interface{}{
					"type": "long",
				},
				"origin_source": map[string]interface{}{
					"type": "keyword",
				},
				"path": map[string]interface{}{
					"type":     "text",
					"analyzer": "standard",
					"fields": map[string]interface{}{
						"keyword": map[string]interface{}{
							"type": "keyword",
						},
					},
				},
				"file_name": map[string]interface{}{
					"type":     "text",
					"analyzer": "filename_analyzer",
					"fields": map[string]interface{}{
						"keyword": map[string]interface{}{
							"type": "keyword",
						},
						"case_sensitive": map[string]interface{}{
							"type": "keyword",
						},
						"fuzzy": map[string]interface{}{
							"type":     "text",
							"analyzer": "standard",
						},
					},
				},
				"base_name": map[string]interface{}{
					"type":     "text",
					"analyzer": "filename_analyzer",
					"fields": map[string]interface{}{
						"keyword": map[string]interface{}{
							"type": "keyword",
						},
						"suggest": map[string]interface{}{
							"type": "completion",
						},
						"case_sensitive": map[string]interface{}{
							"type": "keyword",
						},
						"fuzzy": map[string]interface{}{
							"type":     "text",
							"analyzer": "standard",
						},
					},
				},
				"lower_base_name": map[string]interface{}{
					"type":     "text",
					"analyzer": "filename_analyzer",
					"fields": map[string]interface{}{
						"keyword": map[string]interface{}{
							"type": "keyword",
						},
						"suggest": map[string]interface{}{
							"type": "completion",
						},
						"case_sensitive": map[string]interface{}{
							"type": "keyword",
						},
						"fuzzy": map[string]interface{}{
							"type":     "text",
							"analyzer": "standard",
						},
					},
				},
				"type": map[string]interface{}{
					"type": "integer",
				},
				"is_deleted": map[string]interface{}{
					"type": "boolean",
				},
				"user_id": map[string]interface{}{
					"type": "long",
				},
				"created_at": map[string]interface{}{
					"type": "date",
				},
				"updated_at": map[string]interface{}{
					"type": "date",
				},
			},
		},
		"settings": map[string]interface{}{
			"number_of_shards":   1,
			"number_of_replicas": 0,
			"analysis": map[string]interface{}{
				"analyzer": map[string]interface{}{
					"filename_analyzer": map[string]interface{}{
						"type":      "custom",
						"tokenizer": "standard",
						"filter":    []string{"lowercase", "stop", "asciifolding"},
					},
					"filename_fuzzy_analyzer": map[string]interface{}{
						"type":      "custom",
						"tokenizer": "keyword",
						"filter":    []string{"lowercase", "asciifolding"},
					},
				},
				"filter": map[string]interface{}{
					"filename_ngram": map[string]interface{}{
						"type":     "ngram",
						"min_gram": 2,
						"max_gram": 10,
					},
				},
			},
		},
	}
}

func (m *IndexManager) updateFilesIndexMapping() error {
	mapping := map[string]interface{}{
		"properties": map[string]interface{}{
			"origin_type": map[string]interface{}{
				"type": "keyword",
			},
			"origin_ref_id": map[string]interface{}{
				"type": "long",
			},
			"origin_source": map[string]interface{}{
				"type": "keyword",
			},
		},
	}

	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(mapping); err != nil {
		return fmt.Errorf("编码索引映射失败: %v", err)
	}

	req := esapi.IndicesPutMappingRequest{
		Index: []string{m.client.GetIndexName()},
		Body:  &buf,
	}

	res, err := req.Do(context.Background(), m.client)
	if err != nil {
		return fmt.Errorf("更新索引映射失败: %v", err)
	}
	defer res.Body.Close()

	if res.IsError() {
		return fmt.Errorf("更新索引映射响应错误: %s", res.Status())
	}

	logger.SysLogf("成功更新索引映射: %s", m.client.GetIndexName())
	return nil
}

// IndexExists 检查索引是否存在
func (m *IndexManager) IndexExists() (bool, error) {
	if m.client.IsDisabled() {
		return false, nil
	}

	req := esapi.IndicesExistsRequest{
		Index: []string{m.client.GetIndexName()},
	}

	res, err := req.Do(context.Background(), m.client)
	if err != nil {
		return false, fmt.Errorf("检查索引存在性失败: %v", err)
	}
	defer res.Body.Close()

	return res.StatusCode == 200, nil
}

// DeleteIndex 删除索引
func (m *IndexManager) DeleteIndex() error {
	if m.client.IsDisabled() {
		return nil
	}

	req := esapi.IndicesDeleteRequest{
		Index: []string{m.client.GetIndexName()},
	}

	res, err := req.Do(context.Background(), m.client)
	if err != nil {
		return fmt.Errorf("删除索引失败: %v", err)
	}
	defer res.Body.Close()

	if res.IsError() && res.StatusCode != 404 {
		return fmt.Errorf("删除索引响应错误: %s", res.Status())
	}

	logger.SysLogf("成功删除索引: %s", m.client.GetIndexName())
	return nil
}

// ReindexFiles 重建所有文件索引
func (m *IndexManager) ReindexFiles(eid int64, db interface{}) error {
	if m.client.IsDisabled() {
		return nil
	}

	logger.SysLogf("开始重建文件索引: eid=%d", eid)

	// 删除现有索引
	if err := m.DeleteIndex(); err != nil {
		return fmt.Errorf("删除现有索引失败: %v", err)
	}

	// 创建新索引
	if err := m.CreateFilesIndex(); err != nil {
		return fmt.Errorf("创建新索引失败: %v", err)
	}

	// TODO: 从数据库重新加载所有文件并索引
	// 这里需要根据实际的数据库访问方式来实现

	logger.SysLogf("文件索引重建完成: eid=%d", eid)
	return nil
}

// GetIndexStats 获取索引统计信息
func (m *IndexManager) GetIndexStats() (map[string]interface{}, error) {
	if m.client.IsDisabled() {
		return map[string]interface{}{
			"disabled": true,
		}, nil
	}

	req := esapi.IndicesStatsRequest{
		Index: []string{m.client.GetIndexName()},
	}

	res, err := req.Do(context.Background(), m.client)
	if err != nil {
		return nil, fmt.Errorf("获取索引统计失败: %v", err)
	}
	defer res.Body.Close()

	if res.IsError() {
		return nil, fmt.Errorf("获取索引统计响应错误: %s", res.Status())
	}

	var stats map[string]interface{}
	if err := json.NewDecoder(res.Body).Decode(&stats); err != nil {
		return nil, fmt.Errorf("解析统计响应失败: %v", err)
	}

	return stats, nil
}

// RefreshIndex 刷新索引
func (m *IndexManager) RefreshIndex() error {
	if m.client.IsDisabled() {
		return nil
	}

	req := esapi.IndicesRefreshRequest{
		Index: []string{m.client.GetIndexName()},
	}

	res, err := req.Do(context.Background(), m.client)
	if err != nil {
		return fmt.Errorf("刷新索引失败: %v", err)
	}
	defer res.Body.Close()

	if res.IsError() {
		return fmt.Errorf("刷新索引响应错误: %s", res.Status())
	}

	return nil
}
