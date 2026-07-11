package controller

import (
	"context"
	"errors"
	"strings"

	"github.com/53AI/53AIHub/model"
	mcpservice "github.com/53AI/53AIHub/service/mcp"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type MCPKeyCreateInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type MCPKeyIDInput struct {
	ID MCPHashID `json:"id"`
}

type MCPSpaceListInput struct {
	Status int    `json:"status"`
	Name   string `json:"name"`
	Offset int    `json:"offset"`
	Limit  int    `json:"limit"`
	View   string `json:"view"`
}

type MCPSpaceDetailInput struct {
	SpaceID MCPHashID `json:"space_id"`
}

type MCPLibraryListInput struct {
	Name          string     `json:"name"`
	Status        *int       `json:"status"`
	SpaceID       *MCPHashID `json:"space_id"`
	Offset        int        `json:"offset"`
	Limit         int        `json:"limit"`
	WithFileCount bool       `json:"with_file_count"`
}

type MCPLibraryDetailInput struct {
	LibraryID MCPHashID `json:"library_id"`
}

type MCPFileListInput struct {
	LibraryID MCPHashID `json:"library_id"`
	Path      string    `json:"path"`
	Recursive bool      `json:"recursive"`
	Sort      string    `json:"sort"`
}

type MCPFileDetailInput struct {
	FileID MCPHashID `json:"file_id"`
}

type MCPFileSearchInput struct {
	Query          string      `json:"query"`
	TopK           int         `json:"top_k"`
	LibraryIDs     []MCPHashID `json:"library_ids"`
	CaseSensitive  *bool       `json:"case_sensitive"`
	FuzzyThreshold *int        `json:"fuzzy_threshold"`
}

type MCPFileCreateInput struct {
	LibraryID MCPHashID `json:"library_id"`
	Path      string    `json:"path"`
	Type      string    `json:"type"`
	Content   string    `json:"content"`
}

type MCPKnowledgeSearchInput struct {
	LibraryID MCPHashID `json:"library_id"`
	Query     string    `json:"query"`
	TopK      int       `json:"top_k"`
}

type MCPFileRenameInput struct {
	FileID MCPHashID `json:"file_id"`
	Path   string    `json:"path"`
}

type MCPFileEditInput struct {
	FileID  MCPHashID `json:"file_id"`
	Mode    string    `json:"mode"`
	Content string    `json:"content"`
}

func registerMCPTools(server *MCPServer) {
	if server == nil {
		return
	}
	registerMCPKeyTools(server)
	registerMCPSpaceTools(server)
	registerMCPLibraryTools(server)
	registerMCPFileTools(server)
	registerMCPBatchUploadTools(server)
}

func registerMCPKeyTools(server *MCPServer) {
	AddTypedMCPTool(server, &mcp.Tool{Name: "mcp_key.create", Description: "创建当前用户的 MCP KEY"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPKeyCreateInput) (*mcp.CallToolResult, any, error) {
		userID, eid, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewAPIKeyService()
		apiKey, keyValue, err := svc.CreateOwnedAPIKey(ctx, eid, userID, in.Name, in.Description)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(map[string]any{
			"id":          apiKey.ID,
			"key":         keyValue,
			"name":        apiKey.Name,
			"description": apiKey.Description,
			"status":      apiKey.Status,
		}), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{Name: "mcp_key.list", Description: "列出当前用户创建的 MCP KEY"}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		userID, eid, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewAPIKeyService()
		keys, err := svc.ListOwnedAPIKeys(ctx, eid, userID)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(map[string]any{"items": keys, "total": len(keys)}), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{Name: "mcp_key.detail", Description: "查看当前用户创建的 MCP KEY 详情"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPKeyIDInput) (*mcp.CallToolResult, any, error) {
		userID, eid, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewAPIKeyService()
		key, err := svc.GetOwnedAPIKey(ctx, eid, userID, in.ID.Int64())
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(key), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{Name: "mcp_key.disable", Description: "禁用当前用户创建的 MCP KEY"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPKeyIDInput) (*mcp.CallToolResult, any, error) {
		userID, eid, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewAPIKeyService()
		if err := svc.DisableOwnedAPIKey(ctx, eid, userID, in.ID.Int64()); err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(map[string]any{"id": in.ID.Int64(), "status": model.APIKeyStatusDisabled}), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{Name: "mcp_key.delete", Description: "删除当前用户创建的 MCP KEY"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPKeyIDInput) (*mcp.CallToolResult, any, error) {
		userID, eid, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewAPIKeyService()
		if err := svc.DeleteOwnedAPIKey(ctx, eid, userID, in.ID.Int64()); err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(map[string]any{"id": in.ID.Int64(), "deleted": true}), nil
	})
}

func registerMCPSpaceTools(server *MCPServer) {
	AddTypedMCPTool(server, &mcp.Tool{Name: "space.list", Description: "获取当前用户可访问的空间列表"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPSpaceListInput) (*mcp.CallToolResult, any, error) {
		userID, eid, role, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		admin := role >= model.RoleAdminUser
		svc := mcpservice.NewSpaceService()
		count, spaces, err := svc.ListVisibleSpaces(ctx, eid, userID, in.Status, in.Name, in.Offset, in.Limit, in.View, admin)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(map[string]any{"count": count, "items": spaces}), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{Name: "space.detail", Description: "获取空间详情"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPSpaceDetailInput) (*mcp.CallToolResult, any, error) {
		userID, eid, role, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		admin := role >= model.RoleAdminUser
		svc := mcpservice.NewSpaceService()
		space, err := svc.GetVisibleSpaceDetail(ctx, eid, userID, in.SpaceID.Int64(), admin)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(space), nil
	})
}

func registerMCPLibraryTools(server *MCPServer) {
	AddTypedMCPTool(server, &mcp.Tool{Name: "library.list", Description: "获取当前用户可访问的知识库列表"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPLibraryListInput) (*mcp.CallToolResult, any, error) {
		userID, eid, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewLibraryService()
		var spaceID *int64
		if in.SpaceID != nil {
			decoded := in.SpaceID.Int64()
			spaceID = &decoded
		}
		count, libraries, err := svc.ListVisibleLibraries(ctx, eid, userID, in.Name, in.Status, spaceID, in.Offset, in.Limit, in.WithFileCount)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(map[string]any{"count": count, "items": libraries}), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{Name: "library.detail", Description: "获取知识库详情"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPLibraryDetailInput) (*mcp.CallToolResult, any, error) {
		userID, eid, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewLibraryService()
		library, err := svc.GetVisibleLibraryDetail(ctx, eid, userID, in.LibraryID.Int64())
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(library), nil
	})
}

func registerMCPFileTools(server *MCPServer) {
	AddTypedMCPTool(server, &mcp.Tool{Name: "file.create", Description: "创建文件或文件夹"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPFileCreateInput) (*mcp.CallToolResult, any, error) {
		userID, eid, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewFileService()
		fileType, err := parseMCPFileType(in.Type)
		if err != nil {
			return nil, nil, err
		}
		result, err := svc.CreateFileOrFolder(ctx, eid, userID, in.LibraryID.Int64(), in.Path, fileType, in.Content)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(result), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{Name: "file.list", Description: "获取文件或文件夹列表"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPFileListInput) (*mcp.CallToolResult, any, error) {
		userID, eid, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewFileService()
		files, err := svc.ListFilesByLibraryAndPath(ctx, eid, userID, in.LibraryID.Int64(), in.Path, in.Recursive, in.Sort)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(map[string]any{"items": files, "total": len(files)}), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{Name: "file.detail", Description: "获取文件或文件夹详情"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPFileDetailInput) (*mcp.CallToolResult, any, error) {
		userID, eid, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewFileService()
		detail, err := svc.GetFileDetailWithBody(ctx, eid, userID, in.FileID.Int64())
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(detail), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{Name: "file.delete", Description: "删除文件或文件夹"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPFileDetailInput) (*mcp.CallToolResult, any, error) {
		userID, eid, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewFileService()
		deletedFile, err := svc.DeleteFile(ctx, eid, userID, in.FileID.Int64())
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(map[string]any{
			"deleted": true,
			"file":    deletedFile,
		}), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{Name: "file.search_name", Description: "按文件名称搜索"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPFileSearchInput) (*mcp.CallToolResult, any, error) {
		userID, eid, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewSearchService(model.DB)
		response, err := svc.SearchFileNames(ctx, eid, userID, &mcpservice.FileNameSearchRequest{
			Query:          in.Query,
			TopK:           in.TopK,
			LibraryIDs:     MCPHashIDsToInt64(in.LibraryIDs),
			CaseSensitive:  in.CaseSensitive,
			FuzzyThreshold: in.FuzzyThreshold,
		})
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(response), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{Name: "knowledge.search", Description: "按知识库搜索知识分块，使用知识库默认搜索配置"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPKnowledgeSearchInput) (*mcp.CallToolResult, any, error) {
		userID, eid, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewKnowledgeSearchService(model.DB)
		response, err := svc.SearchKnowledgeChunks(ctx, eid, userID, in.LibraryID.Int64(), in.Query, in.TopK)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(map[string]any{
			"count":       response.Total,
			"items":       response.Results,
			"search_type": response.Type,
			"time_ms":     response.Time,
			"query_id":    response.QueryID,
		}), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{Name: "file.rename", Description: "重命名文件或文件夹"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPFileRenameInput) (*mcp.CallToolResult, any, error) {
		userID, eid, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewFileService()
		file, err := svc.RenameFileOrDirectory(ctx, eid, userID, in.FileID.Int64(), in.Path)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(file), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{Name: "file.edit", Description: "编辑文件内容，支持 replace 和 append"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPFileEditInput) (*mcp.CallToolResult, any, error) {
		userID, eid, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewFileService()
		switch in.Mode {
		case "replace":
			body, err := svc.UpdateFileContentReplace(ctx, eid, userID, in.FileID.Int64(), in.Content)
			if err != nil {
				return nil, nil, err
			}
			return &mcp.CallToolResult{}, encodeMCPToolOutput(body), nil
		case "append":
			body, err := svc.UpdateFileContentAppend(ctx, eid, userID, in.FileID.Int64(), in.Content)
			if err != nil {
				return nil, nil, err
			}
			return &mcp.CallToolResult{}, encodeMCPToolOutput(body), nil
		default:
			return nil, nil, errors.New("mode 仅支持 replace 或 append")
		}
	})
}

func parseMCPFileType(value string) (int, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "file":
		return model.FILE_TYPE_FILE, nil
	case "folder", "dir", "directory":
		return model.FILE_TYPE_DIR, nil
	default:
		return 0, errors.New("type 仅支持 file 或 folder")
	}
}
