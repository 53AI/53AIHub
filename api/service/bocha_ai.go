package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/53AI/53AIHub/service/rag"
)

// BochaAIService 博查AI服务
type BochaAIService struct {
	BaseURL   string
	AuthToken string
}

// NewBochaAIService 创建一个新的博查AI服务实例
func NewBochaAIService(apiKey string) *BochaAIService {
	return &BochaAIService{
		BaseURL:   "https://api.bochaai.com",
		AuthToken: apiKey,
	}
}

// SearchRequest 搜索请求参数
type SearchRequest struct {
	Query     string `json:"query"`               // 用户的搜索词
	Freshness string `json:"freshness,omitempty"` // 搜索指定时间范围内的网页
	Summary   bool   `json:"summary,omitempty"`   // 是否显示文本摘要
	Include   string `json:"include,omitempty"`   // 指定搜索的网站范围
	Exclude   string `json:"exclude,omitempty"`   // 排除搜索的网站范围
	Count     int    `json:"count,omitempty"`     // 返回结果的条数
}

// SearchResponse 搜索响应
type SearchResponse struct {
	Code  interface{} `json:"code"` // API返回的code可能是字符串或整数
	LogID string      `json:"log_id"`
	Msg   interface{} `json:"msg"`
	Data  SearchData  `json:"data"`
}

// SearchData 搜索数据
type SearchData struct {
	Type         string            `json:"_type"`
	QueryContext QueryContext      `json:"queryContext"`
	WebPages     WebSearchWebPages `json:"webPages"`
	Images       WebSearchImages   `json:"images"`
	Videos       WebSearchVideos   `json:"videos"`
}

// QueryContext 查询上下文
type QueryContext struct {
	OriginalQuery string `json:"originalQuery"`
}

// WebSearchWebPages 网页搜索结果
type WebSearchWebPages struct {
	WebSearchUrl          string         `json:"webSearchUrl"`
	TotalEstimatedMatches int            `json:"totalEstimatedMatches"`
	Value                 []WebPageValue `json:"value"`
	SomeResultsRemoved    bool           `json:"someResultsRemoved"`
}

// WebPageValue 网页值
type WebPageValue struct {
	ID               string      `json:"id"`
	Name             string      `json:"name"`
	URL              string      `json:"url"`
	DisplayUrl       string      `json:"displayUrl"`
	Snippet          string      `json:"snippet"`
	Summary          string      `json:"summary,omitempty"`
	SiteName         string      `json:"siteName"`
	SiteIcon         string      `json:"siteIcon"`
	DatePublished    string      `json:"datePublished,omitempty"`
	DateLastCrawled  string      `json:"dateLastCrawled"`
	CachedPageUrl    interface{} `json:"cachedPageUrl"`
	Language         interface{} `json:"language"`
	IsFamilyFriendly interface{} `json:"isFamilyFriendly"`
	IsNavigational   interface{} `json:"isNavigational"`
}

// WebSearchImages 图片搜索结果
type WebSearchImages struct {
	ID               string       `json:"id"`
	ReadLink         interface{}  `json:"readLink"`
	WebSearchUrl     interface{}  `json:"webSearchUrl"`
	IsFamilyFriendly interface{}  `json:"isFamilyFriendly"`
	Value            []ImageValue `json:"value"`
}

// ImageValue 图片值
type ImageValue struct {
	WebSearchUrl       string      `json:"webSearchUrl"`
	Name               string      `json:"name"`
	ThumbnailUrl       string      `json:"thumbnailUrl"`
	DatePublished      interface{} `json:"datePublished"`
	ContentUrl         string      `json:"contentUrl"`
	HostPageUrl        string      `json:"hostPageUrl"`
	ContentSize        interface{} `json:"contentSize"`
	EncodingFormat     string      `json:"encodingFormat"`
	HostPageDisplayUrl string      `json:"hostPageDisplayUrl"`
	Width              int         `json:"width"`
	Height             int         `json:"height"`
	Thumbnail          interface{} `json:"thumbnail"`
}

// WebSearchVideos 视频搜索结果
type WebSearchVideos struct {
	ID               string       `json:"id"`
	ReadLink         interface{}  `json:"readLink"`
	WebSearchUrl     interface{}  `json:"webSearchUrl"`
	IsFamilyFriendly interface{}  `json:"isFamilyFriendly"`
	Scenario         interface{}  `json:"scenario"`
	Value            []VideoValue `json:"value"`
}

// VideoValue 视频值
type VideoValue struct {
	WebSearchUrl       string      `json:"webSearchUrl"`
	Name               string      `json:"name"`
	Description        string      `json:"description"`
	ThumbnailUrl       string      `json:"thumbnailUrl"`
	Publisher          []Publisher `json:"publisher"`
	Creator            Creator     `json:"creator"`
	ContentUrl         string      `json:"contentUrl"`
	HostPageUrl        string      `json:"hostPageUrl"`
	EncodingFormat     string      `json:"encodingFormat"`
	HostPageDisplayUrl string      `json:"hostPageDisplayUrl"`
	Width              int         `json:"width"`
	Height             int         `json:"height"`
	Duration           string      `json:"duration"`
	MotionThumbnailUrl string      `json:"motionThumbnailUrl"`
	EmbedHtml          string      `json:"embedHtml"`
	AllowHttpsEmbed    bool        `json:"allowHttpsEmbed"`
	ViewCount          int         `json:"viewCount"`
	Thumbnail          Thumbnail   `json:"thumbnail"`
	AllowMobileEmbed   bool        `json:"allowMobileEmbed"`
	IsSuperfresh       bool        `json:"isSuperfresh"`
	DatePublished      string      `json:"datePublished"`
}

// Publisher 发布者
type Publisher struct {
	Name string `json:"name"`
}

// Creator 创建者
type Creator struct {
	Name string `json:"name"`
}

// Thumbnail 缩略图
type Thumbnail struct {
	Height int `json:"height"`
	Width  int `json:"width"`
}

// Search 执行搜索请求
func (s *BochaAIService) Search(request SearchRequest) (*SearchResponse, error) {
	// 构建请求URL
	url := fmt.Sprintf("%s/v1/web-search", strings.TrimSuffix(s.BaseURL, "/"))

	// 序列化请求体
	body, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %v", err)
	}

	// 创建HTTP请求
	httpReq, err := http.NewRequest("POST", url, bytes.NewBuffer(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %v", err)
	}

	// 设置请求头
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", s.AuthToken))

	// 创建HTTP客户端并执行请求
	client := &http.Client{
		Timeout: 30 * time.Second,
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to execute request: %v", err)
	}
	defer resp.Body.Close()

	// 读取响应体
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %v", err)
	}

	// 反序列化响应
	var searchResp SearchResponse
	if err := json.Unmarshal(respBody, &searchResp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %v", err)
	}

	// 检查响应状态码
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("request failed with status code: %d, message: %s", resp.StatusCode, string(respBody))
	}

	return &searchResp, nil
}

func GetBochaSearchContext(response *SearchResponse) (string, error) {
	// 构建搜索结果上下文
	var contextBuilder strings.Builder
	contextBuilder.WriteString("以下是从网络搜索获得的相关信息：\n\n")

	for i, result := range response.Data.WebPages.Value {
		if i >= 3 { // 只使用前3个结果
			break
		}

		contextBuilder.WriteString(fmt.Sprintf("[Source:B-%d] %s\n", i+1, result.Name))
		if result.Summary != "" {
			contextBuilder.WriteString(fmt.Sprintf("%s\n", result.Summary))
		} else {
			contextBuilder.WriteString(fmt.Sprintf("%s\n", result.Snippet))
		}
		contextBuilder.WriteString("\n")
	}

	return contextBuilder.String(), nil
}

func BochaSearchReturn(response *SearchResponse) *rag.SearchResponse {
	searchResponse := &rag.SearchResponse{}
	searchLen := 0
	results := []rag.SearchResultItem{}
	if response != nil {
		webPagesLen := 0
		videosLen := 0
		imagesLen := 0

		if response.Data.WebPages.Value != nil {
			webPagesLen = len(response.Data.WebPages.Value)
			for i, item := range response.Data.WebPages.Value {
				results = append(results, rag.SearchResultItem{
					ChunkID:     int64(i + 1), // 为每个网页搜索结果分配唯一的ChunkID
					FileID:      int64(i + 1), // 为每个网页搜索结果分配唯一的FileID
					Summary:     item.Name,
					Content:     item.Summary,
					FilePath:    item.DisplayUrl,
					FileName:    item.Name,
					ChunkType:   "web_page",
					LibraryName: item.SiteName,
					LibraryIcon: item.SiteIcon,
				})
			}
		}

		if response.Data.Videos.Value != nil {
			videosLen = len(response.Data.Videos.Value)
			for i, item := range response.Data.Videos.Value {
				results = append(results, rag.SearchResultItem{
					ChunkID:   int64(webPagesLen + i + 1), // 继续分配唯一的ChunkID
					FileID:    int64(webPagesLen + i + 1), // 继续分配唯一的FileID
					Summary:   item.Name,
					Content:   item.Description,
					FilePath:  item.ContentUrl,
					FileName:  item.Name,
					ChunkType: "video",
				})
			}
		}

		if response.Data.Images.Value != nil {
			imagesLen = len(response.Data.Images.Value)
			for i, item := range response.Data.Images.Value {
				results = append(results, rag.SearchResultItem{
					ChunkID:   int64(webPagesLen + videosLen + i + 1), // 继续分配唯一的ChunkID
					FileID:    int64(webPagesLen + videosLen + i + 1), // 继续分配唯一的FileID
					Summary:   item.Name,
					Content:   item.ContentUrl,
					FilePath:  item.ContentUrl,
					FileName:  item.Name,
					ChunkType: "image",
				})
			}
		}

		searchLen = webPagesLen + videosLen + imagesLen
	}

	searchResponse.Total = searchLen
	searchResponse.Type = "web_search"
	searchResponse.Results = results
	searchResponse.Time = time.Now().UnixMilli()

	return searchResponse
}
