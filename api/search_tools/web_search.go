package search_tools

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
)

func NewWebSearcher(c *SearchConfig) *WebSearcher {
	return &WebSearcher{C: c}
}

// 全网搜索器
func (w *WebSearcher) Search(query string, count int) ([]*SearchItem, error) {
	if w.C.Wsc == nil {
		return nil, errors.New("web search config is nil")
	}

	switch w.C.Wsc.ApiType {
	case model.PLATFORM_BOCHAAI:
		return w.searchBochai(query, count)
	default:
		return nil, errors.New("unsupported web search api type")
	}
}

func (w *WebSearcher) searchBochai(query string, count int) ([]*SearchItem, error) {
	// 创建博查AI服务实例
	bochaAIService := service.NewBochaAIService(w.C.Wsc.ApiKey)

	// 创建搜索请求
	request := service.SearchRequest{
		Query:   query,
		Count:   count,
		Summary: true,
	}

	// 执行搜索
	response, err := bochaAIService.Search(request)
	if err != nil {
		return nil, fmt.Errorf("搜索请求失败: %v", err)
	}

	// 处理不同类型的code字段（字符串或数字）
	var statusCode int
	switch code := response.Code.(type) {
	case string:
		// 字符串类型的code
		if codeInt, err := strconv.Atoi(code); err != nil {
			return nil, fmt.Errorf("解析code字符串失败: %v", err)
		} else {
			statusCode = codeInt
		}
	case float64:
		// JSON数字默认解析为float64
		statusCode = int(code)
	case int:
		statusCode = code
	case int64:
		statusCode = int(code)
	default:
		return nil, fmt.Errorf("无法识别的code字段类型: %T, 值: %v", response.Code, response.Code)
	}

	// 检查搜索响应状态
	if statusCode != 200 {
		return nil, fmt.Errorf("搜索响应状态错误: %d", statusCode)
	}

	// 解析搜索结果
	var searchItems []*SearchItem
	idCounter := int64(1) // 用于生成唯一的ChunkID和FileID

	// 处理网页搜索结果
	if response.Data.WebPages.Value != nil {
		for _, item := range response.Data.WebPages.Value {
			searchItems = append(searchItems, &SearchItem{
				ChunkID:     idCounter,
				FileID:      idCounter,
				LibraryID:   0,
				FilePath:    item.URL,
				FileName:    item.Name,
				LibraryName: item.SiteName,
				LibraryIcon: item.SiteIcon,
				ChunkType:   "web_page",
				Content:     item.Summary,
				Score:       1.0,
			})
			idCounter++
		}
	}

	// 处理视频搜索结果
	if response.Data.Videos.Value != nil {
		for _, item := range response.Data.Videos.Value {
			libraryName := ""
			if len(item.Publisher) > 0 {
				libraryName = item.Publisher[0].Name
			} else if item.Creator.Name != "" {
				libraryName = item.Creator.Name
			} else {
				libraryName = item.HostPageDisplayUrl
			}

			searchItems = append(searchItems, &SearchItem{
				ChunkID:     idCounter,
				FileID:      idCounter,
				LibraryID:   0,
				FilePath:    item.ContentUrl,
				FileName:    item.Name,
				LibraryName: libraryName,
				LibraryIcon: item.ThumbnailUrl, // 视频使用缩略图作为图标
				ChunkType:   "video",
				Content:     item.Description,
				Score:       1.0,
			})
			idCounter++
		}
	}

	// 处理图片搜索结果
	if response.Data.Images.Value != nil {
		for _, item := range response.Data.Images.Value {
			searchItems = append(searchItems, &SearchItem{
				ChunkID:     idCounter,
				FileID:      idCounter,
				LibraryID:   0,
				FilePath:    item.ContentUrl,
				FileName:    item.Name,
				LibraryName: item.HostPageDisplayUrl,
				LibraryIcon: item.ThumbnailUrl, // 图片使用缩略图作为图标
				ChunkType:   "image",
				Content:     item.ContentUrl, // 图片的Content使用URL
				Score:       1.0,
			})
			idCounter++
		}
	}

	// 如果没有找到任何结果
	if len(searchItems) == 0 {
		return nil, fmt.Errorf("未找到搜索结果")
	}

	return searchItems, nil
}
