package controller

import (
	"context"
	_ "embed"
	"errors"
	"path"
	"strings"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/gorm"
)

const twoCEOMeetingsResourceURI = "ui://2ceo/meeting-insights-v0.4.html"

//go:embed 2ceo_meeting_insights.html
var twoCEOMeetingsHTML string

type twoCEOMeetingsQuery struct {
	Offset  int    `json:"offset"`
	Limit   int    `json:"limit"`
	Keyword string `json:"keyword"`
}

type twoCEOMeetingDetailInput struct {
	FileID string `json:"file_id"`
}

type twoCEOMeetingItem struct {
	FileID      string `json:"file_id"`
	Title       string `json:"title"`
	Scene       string `json:"scene"`
	CreatedTime int64  `json:"created_time"`
	DurationMs  int64  `json:"duration_ms"`
	Status      string `json:"status"`
	Preview     string `json:"preview"`
	HasPage     bool   `json:"has_page"`
}

func twoCEOLimitText(raw string, maxRunes int) (string, bool) {
	chars := []rune(strings.TrimSpace(raw))
	if len(chars) <= maxRunes {
		return string(chars), false
	}
	return string(chars[:maxRunes]), true
}

func twoCEOMeetingDisplayName(file *model.File) string {
	if file == nil {
		return ""
	}
	name := path.Base(strings.TrimSpace(file.Path))
	if name == "." || name == "/" || name == "" {
		return "未命名会议"
	}
	return name
}

func twoCEOMeetingView(file *model.File, hasPage bool) (*twoCEOMeetingItem, error) {
	id, err := hashids.Encode(file.ID)
	if err != nil {
		return nil, err
	}
	preview, _ := twoCEOLimitText(string(file.InsightSummary), 260)
	status := "pending"
	if strings.TrimSpace(string(file.InsightSummary)) != "" || hasPage {
		status = "ready"
	}
	return &twoCEOMeetingItem{
		FileID: id, Title: twoCEOMeetingDisplayName(file),
		Scene: file.Scene, CreatedTime: file.CreatedTime,
		DurationMs: file.DurationMs, Status: status,
		Preview: preview, HasPage: hasPage,
	}, nil
}

// Lists only files from the user's own recording library. No direct tenant-wide
// file scans and no automatic ingestion of recordings from other team members.
func twoCEOMeetingsList(ctx context.Context, input twoCEOMeetingsQuery) (map[string]any, error) {
	eid, userID, err := twoCEOScope(ctx)
	if err != nil {
		return nil, err
	}
	if input.Offset < 0 {
		return nil, errors.New("offset must be non-negative")
	}
	if input.Limit <= 0 {
		input.Limit = 20
	}
	if input.Limit > 50 {
		input.Limit = 50
	}
	keyword, _ := twoCEOLimitText(input.Keyword, 100)
	fileType := model.FILE_TYPE_FILE
	files, total, err := service.NewMySpaceRecordingService(eid).ListEntries(
		ctx, userID, "", &fileType, keyword, input.Offset, input.Limit, 0,
		"created_time", "desc", 0, 0, "", false,
	)
	if err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(files))
	for i := range files {
		ids = append(ids, files[i].ID)
	}
	pages := make([]model.RecordingFileInsightPage, 0)
	if len(ids) > 0 {
		if err := model.DB.WithContext(ctx).Where("file_id IN ?", ids).Find(&pages).Error; err != nil {
			return nil, err
		}
	}
	pageIDs := make(map[int64]bool, len(pages))
	for _, page := range pages {
		pageIDs[page.FileID] = true
	}
	items := make([]*twoCEOMeetingItem, 0, len(files))
	for i := range files {
		file := &files[i]
		// No insight yet: omit it from the insights list; do not invent one.
		if strings.TrimSpace(string(file.InsightSummary)) == "" && !pageIDs[file.ID] {
			continue
		}
		item, err := twoCEOMeetingView(file, pageIDs[file.ID])
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return map[string]any{
		"items": items, "offset": input.Offset, "limit": input.Limit,
		"recording_total": total, "next_offset": input.Offset + len(files),
		"has_more": int64(input.Offset+len(files)) < total,
		"filter":   "insights_only",
	}, nil
}

func twoCEOMeetingsDetail(ctx context.Context, input twoCEOMeetingDetailInput) (map[string]any, error) {
	eid, userID, err := twoCEOScope(ctx)
	if err != nil {
		return nil, err
	}
	fileID, err := hashids.TryParseID(strings.TrimSpace(input.FileID))
	if err != nil || fileID <= 0 {
		return nil, errors.New("invalid file_id")
	}
	file, err := service.GetViewableRecordingFile(ctx, eid, userID, fileID)
	if err != nil {
		return nil, err
	}
	if file == nil || file.IsDeleted || file.Type != model.FILE_TYPE_FILE || !file.IsRecordingOriginType() {
		return nil, errors.New("recording file is not available")
	}
	var page model.RecordingFileInsightPage
	hasPage := false
	err = model.DB.WithContext(ctx).Where("file_id = ?", fileID).First(&page).Error
	if err == nil {
		hasPage = true
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	item, err := twoCEOMeetingView(file, hasPage)
	if err != nil {
		return nil, err
	}
	// Render text as textContent inside the sandboxed ChatGPT iframe; never
	// inject LLM-generated Markdown/HTML as raw DOM or executable script.
	summary, truncated := twoCEOLimitText(string(file.InsightSummary), 30000)
	result := map[string]any{
		"item": item, "insight_summary": summary,
		"summary_truncated": truncated, "has_insight_page": hasPage,
	}
	if hasPage {
		// page_json may contain a complete html_v2 document. Do not cut
		// JSON/HTML mid-document: that would make the formal insight page
		// unreadable in ChatGPT. Bound payload size and fall back to the
		// Markdown summary if it is too large to transmit.
		pageText, pageTruncated := twoCEOLimitText(string(page.PageJSON), 350000)
		if !pageTruncated {
			result["page_json"] = pageText
		}
		result["page_truncated"] = pageTruncated
	}
	return result, nil
}

func register2CEOMeetingTools(server *MCPServer) {
	server.Server().AddResource(&mcp.Resource{
		URI: twoCEOMeetingsResourceURI, Name: "2CEO 会议洞察",
		MIMEType: "text/html;profile=mcp-app",
	}, func(_ context.Context, _ *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{
			URI:      twoCEOMeetingsResourceURI,
			MIMEType: "text/html;profile=mcp-app", Text: twoCEOMeetingsHTML,
		}}}, nil
	})
	AddTypedMCPTool(server, &mcp.Tool{
		Name: "2ceo.meetings.open", Title: "2CEO · 会议洞察",
		Description: "打开 ChatGPT 内的独立会议洞察界面，查看当前账户实际存在的录音洞察列表和详情。",
		Meta: mcp.Meta{
			"ui":        map[string]any{"resourceUri": twoCEOMeetingsResourceURI},
			"openai/ui": map[string]any{"entrypoints": []map[string]string{{"type": "global"}}},
		},
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		result, err := twoCEOMeetingsList(ctx, twoCEOMeetingsQuery{Limit: 20})
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(result), nil
	})
	AddTypedMCPTool(server, &mcp.Tool{
		Name: "2ceo.meetings.list", Title: "查询会议洞察列表",
		Description: "按照当前登录用户的录音库和文件权限只读列出已生成洞察的会议；支持关键词与分页。空库返回空列表。",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input twoCEOMeetingsQuery) (*mcp.CallToolResult, any, error) {
		result, err := twoCEOMeetingsList(ctx, input)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(result), nil
	})
	AddTypedMCPTool(server, &mcp.Tool{
		Name: "2ceo.meetings.detail", Title: "查看单场会议洞察",
		Description: "按 HashID 读取有权访问的会议洞察摘要和原始编排结果；不修改任何经营记录。",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input twoCEOMeetingDetailInput) (*mcp.CallToolResult, any, error) {
		result, err := twoCEOMeetingsDetail(ctx, input)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(result), nil
	})
}
