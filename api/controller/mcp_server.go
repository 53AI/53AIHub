package controller

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"sync"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// MCPServer owns the shared MCP server and its HTTP handler.
type MCPServer struct {
	server  *mcp.Server
	handler http.Handler
}

var (
	mcpServerOnce sync.Once
	mcpServerInst *MCPServer
)

// GetMCPServer returns the singleton MCP server used by the backend.
func GetMCPServer() *MCPServer {
	mcpServerOnce.Do(func() {
		mcpServerInst = newMCPServer()
	})
	return mcpServerInst
}

func newMCPServer() *MCPServer {
	server := mcp.NewServer(&mcp.Implementation{
		Name:    "53AIHub MCP",
		Version: config.Version,
	}, nil)

	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		return server
	}, &mcp.StreamableHTTPOptions{
		Stateless:                  true,
		JSONResponse:               true,
		DisableLocalhostProtection: true,
	})

	mcpServer := &MCPServer{
		server:  server,
		handler: handler,
	}
	registerMCPTools(mcpServer)
	return mcpServer
}

// Server exposes the underlying MCP server for tool registration.
func (s *MCPServer) Server() *mcp.Server {
	if s == nil {
		return nil
	}
	return s.server
}

// Handler returns the HTTP handler for MCP traffic.
func (s *MCPServer) Handler() http.Handler {
	if s == nil {
		return http.NotFoundHandler()
	}
	return s.handler
}

// AddTool registers a raw MCP tool with the shared server.
func (s *MCPServer) AddTool(tool *mcp.Tool, handler mcp.ToolHandler) {
	if s == nil || s.server == nil {
		logger.SysError("MCP server is not initialized")
		return
	}
	s.server.AddTool(tool, handler)
}

// CurrentMCPUserID extracts the authenticated user ID from the MCP request context.
func CurrentMCPUserID(ctx context.Context) (int64, error) {
	tokenInfo := auth.TokenInfoFromContext(ctx)
	if tokenInfo == nil || tokenInfo.UserID == "" {
		return 0, errors.New("missing MCP authentication context")
	}

	userID, err := strconv.ParseInt(tokenInfo.UserID, 10, 64)
	if err != nil {
		return 0, err
	}
	return userID, nil
}

// CurrentMCPUser loads the authenticated user from the current MCP context.
func CurrentMCPUser(ctx context.Context) (*model.User, error) {
	userID, err := CurrentMCPUserID(ctx)
	if err != nil {
		return nil, err
	}
	return model.GetUserByID(userID)
}

// CurrentMCPAuthInfo extracts the current authenticated user, enterprise and role.
func CurrentMCPAuthInfo(ctx context.Context) (userID int64, eid int64, role int64, err error) {
	tokenInfo := auth.TokenInfoFromContext(ctx)
	if tokenInfo == nil {
		return 0, 0, 0, errors.New("missing MCP authentication context")
	}

	userID, err = CurrentMCPUserID(ctx)
	if err != nil {
		return 0, 0, 0, err
	}

	if tokenInfo.Extra != nil {
		if v, ok := tokenInfo.Extra["user_eid"]; ok {
			switch value := v.(type) {
			case int64:
				eid = value
			case int:
				eid = int64(value)
			case float64:
				eid = int64(value)
			case string:
				eid, _ = strconv.ParseInt(value, 10, 64)
			}
		}
		if v, ok := tokenInfo.Extra["user_role"]; ok {
			switch value := v.(type) {
			case int64:
				role = value
			case int:
				role = int64(value)
			case float64:
				role = int64(value)
			case string:
				role, _ = strconv.ParseInt(value, 10, 64)
			}
		}
	}
	return userID, eid, role, nil
}

// CurrentMCPAPIKeyID extracts the current MCP API key ID from the request context.
func CurrentMCPAPIKeyID(ctx context.Context) (int64, error) {
	tokenInfo := auth.TokenInfoFromContext(ctx)
	if tokenInfo == nil {
		return 0, errors.New("missing MCP authentication context")
	}
	if tokenInfo.Extra == nil {
		return 0, errors.New("missing MCP authentication context")
	}
	v, ok := tokenInfo.Extra["api_key_id"]
	if !ok {
		return 0, errors.New("missing MCP api key context")
	}
	switch value := v.(type) {
	case int64:
		return value, nil
	case int:
		return int64(value), nil
	case float64:
		return int64(value), nil
	case string:
		return strconv.ParseInt(value, 10, 64)
	default:
		return 0, errors.New("invalid MCP api key context")
	}
}

// AddTypedMCPTool registers a typed MCP tool with the shared server.
func AddTypedMCPTool[In, Out any](server *MCPServer, tool *mcp.Tool, handler mcp.ToolHandlerFor[In, Out]) {
	if server == nil || server.server == nil {
		logger.SysError("MCP server is not initialized")
		return
	}
	mcp.AddTool(server.server, tool, handler)
}
