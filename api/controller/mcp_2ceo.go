package controller

import (
	"context"
	_ "embed"
	"errors"
	"net/http"
	"strings"
	"sync"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const twoCEOResourceURI = "ui://2ceo/dashboard-v0.2.html"

//go:embed 2ceo_dashboard.html
var twoCEODashboardHTML string

var (
	twoCEOServerOnce     sync.Once
	twoCEOServerInstance *MCPServer
)

// Get2CEOMCPServer uses the existing km-* authentication while limiting the tool
// surface to 2CEO. Do not register generic file/key mutation tools on this server.
func Get2CEOMCPServer() *MCPServer {
	twoCEOServerOnce.Do(func() {
		server := mcp.NewServer(&mcp.Implementation{
			Name:    "2CEO - AI经营参谋",
			Version: config.Version,
		}, nil)
		handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
			return server
		}, &mcp.StreamableHTTPOptions{
			Stateless:                  true,
			JSONResponse:               true,
			DisableLocalhostProtection: true,
		})
		instance := &MCPServer{server: server, handler: handler}
		register2CEOTools(instance)
		register2CEOMeetingTools(instance)
		twoCEOServerInstance = instance
	})
	return twoCEOServerInstance
}

type twoCEOAttentionInput struct {
	OpportunityID string `json:"opportunity_id"`
}

func twoCEOScope(ctx context.Context) (int64, int64, error) {
	userID, eid, _, err := CurrentMCPAuthInfo(ctx)
	if err != nil {
		return 0, 0, err
	}
	if userID <= 0 || eid <= 0 {
		return 0, 0, errors.New("missing 2CEO enterprise or user scope")
	}
	return eid, userID, nil
}

func twoCEOAttentionList(ctx context.Context) (map[string]any, error) {
	eid, userID, err := twoCEOScope(ctx)
	if err != nil {
		return nil, err
	}
	items, err := service.DefaultActionRuntimeService().ListActionOpportunities(ctx, eid, userID)
	if err != nil {
		return nil, err
	}
	active := make([]*service.ActionOpportunityView, 0, len(items))
	for _, item := range items {
		if item != nil && item.Status != model.ActionOpportunityStatusDismissed {
			active = append(active, item)
		}
	}
	return map[string]any{"items": active, "total": len(active)}, nil
}

func twoCEOActionList(ctx context.Context) (map[string]any, error) {
	eid, userID, err := twoCEOScope(ctx)
	if err != nil {
		return nil, err
	}
	plans, err := service.DefaultActionRuntimeService().ListActionPlans(ctx, eid, userID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": plans, "total": len(plans)}, nil
}

func register2CEOTools(server *MCPServer) {
	server.Server().AddResource(&mcp.Resource{
		URI:      twoCEOResourceURI,
		Name:     "2CEO 经营工作台",
		MIMEType: "text/html;profile=mcp-app",
	}, func(_ context.Context, _ *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{
			URI:      twoCEOResourceURI,
			MIMEType: "text/html;profile=mcp-app",
			Text:     twoCEODashboardHTML,
			Meta:     mcp.Meta{"ui": map[string]any{"prefersBorder": false}},
		}}}, nil
	})

	// Global entrypoint is registered on this render-only tool; data tools
	// remain model-usable without attaching/re-rendering the iframe.
	AddTypedMCPTool(server, &mcp.Tool{
		Name:        "2ceo.dashboard",
		Title:       "打开 2CEO 经营工作台",
		Description: "在 ChatGPT 左侧打开 2CEO 工作台，查看真实经营关注、行动进度和来源。所有数据属于已授权的当前账户。",
		Meta: mcp.Meta{
			"ui":        map[string]any{"resourceUri": twoCEOResourceURI},
			"openai/ui": map[string]any{"entrypoints": []map[string]string{{"type": "global"}}},
		},
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		attention, err := twoCEOAttentionList(ctx)
		if err != nil {
			return nil, nil, err
		}
		actions, err := twoCEOActionList(ctx)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(map[string]any{
			"attention": attention, "actions": actions,
			"data_status": "live", "execution_enabled": false,
		}), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{
		Name:        "2ceo.attention.list",
		Title:       "查看经营关注",
		Description: "只读列出当前老板名下的真实行动机会/经营关注，不包括已忽略的机会，不制造假数据。",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		data, err := twoCEOAttentionList(ctx)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(data), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{
		Name:        "2ceo.attention.detail",
		Title:       "经营关注详情",
		Description: "按机会 ID 查询当前老板有权限访问的经营关注详情与关联来源；不把推测当作事实。",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input twoCEOAttentionInput) (*mcp.CallToolResult, any, error) {
		if strings.TrimSpace(input.OpportunityID) == "" {
			return nil, nil, errors.New("opportunity_id is required")
		}
		eid, userID, err := twoCEOScope(ctx)
		if err != nil {
			return nil, nil, err
		}
		detail, err := service.DefaultActionRuntimeService().GetActionOpportunity(ctx, eid, userID, input.OpportunityID)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(map[string]any{"item": detail}), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{
		Name:        "2ceo.action.list",
		Title:       "查看行动与成果",
		Description: "只读查询当前老板的行动规划、执行摘要和已有成果，不启动执行。",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		data, err := twoCEOActionList(ctx)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(data), nil
	})
}
