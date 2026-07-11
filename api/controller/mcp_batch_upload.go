package controller

import (
	"context"

	core "github.com/53AI/53AIHub/service"
	mcpservice "github.com/53AI/53AIHub/service/mcp"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type MCPBatchFileStructureItem struct {
	RelativePath string `json:"relative_path"`
	Size         int64  `json:"size"`
	IsDirectory  bool   `json:"is_directory"`
	ParentPath   string `json:"parent_path"`
	Depth        int    `json:"depth"`
}

type MCPBatchUploadInitInput struct {
	LibraryID     MCPHashID                   `json:"library_id"`
	BasePath      string                      `json:"base_path"`
	TotalFiles    int                         `json:"total_files"`
	TotalSize     int64                       `json:"total_size"`
	FileStructure []MCPBatchFileStructureItem `json:"file_structure"`
}

type MCPBatchUploadProgressInput struct {
	BatchID      string `json:"batch_id"`
	Detail       bool   `json:"detail,omitempty"`
	FileUploadID string `json:"file_upload_id,omitempty"`
	Since        int64  `json:"since,omitempty"`
}

type MCPBatchUploadCancelInput struct {
	BatchID string `json:"batch_id"`
}

type MCPBatchUploadExchangeTokenInput struct{}

func registerMCPBatchUploadTools(server *MCPServer) {
	AddTypedMCPTool(server, &mcp.Tool{Name: "batch_upload.init", Description: "初始化批量上传批次"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPBatchUploadInitInput) (*mcp.CallToolResult, any, error) {
		userID, eid, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewBatchUploadService()
		req := &core.BatchInitRequest{
			LibraryID:     in.LibraryID.Int64(),
			BasePath:      in.BasePath,
			TotalFiles:    in.TotalFiles,
			TotalSize:     in.TotalSize,
			FileStructure: convertMCPBatchFileStructure(in.FileStructure),
		}
		resp, err := svc.InitBatch(ctx, eid, userID, req)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(resp), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{Name: "batch_upload.exchange_token", Description: "为批量上传任务换发短期 API Token"}, func(ctx context.Context, _ *mcp.CallToolRequest, _ MCPBatchUploadExchangeTokenInput) (*mcp.CallToolResult, any, error) {
		userID, eid, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		apiKeyID, err := CurrentMCPAPIKeyID(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewUploadTokenService()
		resp, err := svc.IssueBatchUploadToken(ctx, userID, eid, apiKeyID)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(map[string]any{
			"token_type": resp.TokenType,
			"scope":      resp.Scope,
			"token":      resp.Token,
			"expires_at": resp.ExpiresAt,
		}), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{Name: "batch_upload.progress", Description: "查看批量上传进度"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPBatchUploadProgressInput) (*mcp.CallToolResult, any, error) {
		_, _, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewBatchUploadService()
		resp, err := svc.GetProgress(ctx, in.BatchID, in.Detail, in.FileUploadID, in.Since)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(resp), nil
	})

	AddTypedMCPTool(server, &mcp.Tool{Name: "batch_upload.cancel", Description: "取消批量上传批次"}, func(ctx context.Context, _ *mcp.CallToolRequest, in MCPBatchUploadCancelInput) (*mcp.CallToolResult, any, error) {
		_, _, _, err := CurrentMCPAuthInfo(ctx)
		if err != nil {
			return nil, nil, err
		}
		svc := mcpservice.NewBatchUploadService()
		if err := svc.CancelBatch(ctx, in.BatchID); err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{}, encodeMCPToolOutput(map[string]any{
			"batch_id": in.BatchID,
			"status":   "cancelled",
		}), nil
	})
}

func convertMCPBatchFileStructure(items []MCPBatchFileStructureItem) []core.FileStructureItem {
	if len(items) == 0 {
		return []core.FileStructureItem{}
	}
	result := make([]core.FileStructureItem, 0, len(items))
	for _, item := range items {
		result = append(result, core.FileStructureItem{
			RelativePath: item.RelativePath,
			Size:         item.Size,
			IsDirectory:  item.IsDirectory,
			ParentPath:   item.ParentPath,
			Depth:        item.Depth,
		})
	}
	return result
}
