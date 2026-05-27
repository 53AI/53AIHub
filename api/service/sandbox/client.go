package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type FileDownloadInfo struct {
	FileName string `json:"file_name"`
	URL      string `json:"url"`
	MimeType string `json:"mime_type,omitempty"`
	Size     int64  `json:"size,omitempty"`
}

type ExecuteCodeRequest struct {
	Code          string             `json:"code"`
	Language      string             `json:"language"`
	Timeout       int                `json:"timeout"`
	SessionID     string             `json:"session_id,omitempty"`
	Cwd           string             `json:"cwd,omitempty"`
	EnvVars       map[string]string  `json:"env_vars,omitempty"`
	Files         map[string]string  `json:"files,omitempty"`
	DownloadFiles []FileDownloadInfo `json:"download_files,omitempty"`
}

type OutputFile struct {
	FileName string `json:"file_name"`
	Content  string `json:"content"`
	MimeType string `json:"mime_type"`
	Size     int    `json:"size"`
}

type ExecuteCodeResponse struct {
	Stdout      string       `json:"stdout"`
	Stderr      string       `json:"stderr"`
	ExitCode    int          `json:"exit_code"`
	OutputFiles []OutputFile `json:"output_files,omitempty"`
}

type ShellRequest struct {
	Command   string            `json:"command"`
	Timeout   int               `json:"timeout,omitempty"`
	SessionID string            `json:"session_id,omitempty"`
	Cwd       string            `json:"cwd,omitempty"`
	EnvVars   map[string]string `json:"env_vars,omitempty"`
	Files     map[string]string `json:"files,omitempty"`
}

type ShellResponse struct {
	Stdout      string       `json:"stdout"`
	Stderr      string       `json:"stderr"`
	ExitCode    int          `json:"exit_code"`
	OutputFiles []OutputFile `json:"output_files,omitempty"`
}

type FileReadRequest struct {
	Path      string            `json:"path"`
	SessionID string            `json:"session_id,omitempty"`
	Cwd       string            `json:"cwd,omitempty"`
	MaxBytes  int               `json:"max_bytes,omitempty"`
	Files     map[string]string `json:"files,omitempty"`
}

type FileReadResponse struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Size    int    `json:"size"`
}

type FileWriteRequest struct {
	Path      string            `json:"path"`
	Content   string            `json:"content"`
	SessionID string            `json:"session_id,omitempty"`
	Cwd       string            `json:"cwd,omitempty"`
	Append    bool              `json:"append,omitempty"`
	Files     map[string]string `json:"files,omitempty"`
}

type FileWriteResponse struct {
	Path    string `json:"path"`
	Size    int    `json:"size"`
	Written int    `json:"written"`
	Mode    string `json:"mode"`
}

type FileListRequest struct {
	Path       string            `json:"path,omitempty"`
	SessionID  string            `json:"session_id,omitempty"`
	Cwd        string            `json:"cwd,omitempty"`
	Recursive  bool              `json:"recursive,omitempty"`
	MaxEntries int               `json:"max_entries,omitempty"`
	Files      map[string]string `json:"files,omitempty"`
}

type FileListResponse struct {
	BasePath string   `json:"base_path"`
	Entries  []string `json:"entries"`
}

type SessionInfo struct {
	SessionID  string `json:"session_id"`
	Workspace  string `json:"workspace"`
	Exists     bool   `json:"exists"`
	LastAccess int64  `json:"last_access"`
	FileCount  int    `json:"file_count"`
	TotalBytes int64  `json:"total_bytes"`
	TTLSeconds int    `json:"ttl_seconds"`
}

type SessionListResponse struct {
	Sessions []SessionInfo `json:"sessions"`
}

type SessionInfoRequest struct {
	SessionID string `json:"session_id"`
}

type SessionCleanupRequest struct {
	SessionID   string `json:"session_id,omitempty"`
	ExpiredOnly bool   `json:"expired_only,omitempty"`
}

type SessionCleanupResponse struct {
	OK        bool   `json:"ok"`
	Mode      string `json:"mode,omitempty"`
	Removed   bool   `json:"removed,omitempty"`
	SessionID string `json:"session_id,omitempty"`
}

type Client struct {
	baseURL    string
	httpClient *http.Client
}

func NewClient(baseURL string) *Client {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	return &Client{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 60 * time.Second},
	}
}

func (c *Client) ExecuteCode(ctx context.Context, req ExecuteCodeRequest) (*ExecuteCodeResponse, error) {
	var resp ExecuteCodeResponse
	if err := c.postJSON(ctx, "/execute", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) ExecuteCodeStream(ctx context.Context, req ExecuteCodeRequest) (*http.Response, error) {
	jsonData, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %v", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/execute/stream", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("sandbox streaming failed (status %d): %s", resp.StatusCode, string(body))
	}
	return resp, nil
}

func (c *Client) ExecuteShell(ctx context.Context, req ShellRequest) (*ShellResponse, error) {
	var resp ShellResponse
	if err := c.postJSON(ctx, "/shell", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) ReadFile(ctx context.Context, req FileReadRequest) (*FileReadResponse, error) {
	var resp FileReadResponse
	if err := c.postJSON(ctx, "/file/read", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) WriteFile(ctx context.Context, req FileWriteRequest) (*FileWriteResponse, error) {
	var resp FileWriteResponse
	if err := c.postJSON(ctx, "/file/write", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) ListFiles(ctx context.Context, req FileListRequest) (*FileListResponse, error) {
	var resp FileListResponse
	if err := c.postJSON(ctx, "/file/list", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) ListSessions(ctx context.Context) (*SessionListResponse, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/session/list", nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("sandbox request failed (status %d): %s", resp.StatusCode, string(body))
	}
	var data SessionListResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("failed to decode response: %v", err)
	}
	return &data, nil
}

func (c *Client) SessionInfo(ctx context.Context, req SessionInfoRequest) (*SessionInfo, error) {
	var resp SessionInfo
	if err := c.postJSON(ctx, "/session/info", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) CleanupSession(ctx context.Context, req SessionCleanupRequest) (*SessionCleanupResponse, error) {
	var resp SessionCleanupResponse
	if err := c.postJSON(ctx, "/session/cleanup", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) postJSON(ctx context.Context, endpoint string, reqBody interface{}, respBody interface{}) error {
	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %v", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+endpoint, bytes.NewBuffer(jsonData))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("sandbox request failed (status %d): %s", resp.StatusCode, string(body))
	}

	if err := json.NewDecoder(resp.Body).Decode(respBody); err != nil {
		return fmt.Errorf("failed to decode response: %v", err)
	}
	return nil
}
