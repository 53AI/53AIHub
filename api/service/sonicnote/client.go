package sonicnote

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

const DefaultBaseURL = "https://ainote.easylinkin.com:18048/prod-api"

// sonicNoteAudioIDPattern 远端 audioId 白名单（hex/uuid/短横线），防路径拼接注入。
var sonicNoteAudioIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// maxAudioDownloadBytes 单条音频下载上限（流式写临时文件，不占内存）。
const maxAudioDownloadBytes = 500 << 20

type Client struct {
	baseURL string
	http    *http.Client
	// downloadHTTP 音频下载专用客户端：JSON 请求保持 30s 超时，大文件下载用更长超时，
	// 避免慢网/大录音下 30s 超时导致整个同步失败。
	downloadHTTP *http.Client
}

func NewClient(baseURL string) *Client {
	if strings.TrimSpace(baseURL) == "" {
		baseURL = DefaultBaseURL
	}
	return &Client{
		baseURL:      strings.TrimRight(baseURL, "/"),
		http:         &http.Client{Timeout: 30 * time.Second},
		downloadHTTP: &http.Client{Timeout: 30 * time.Minute},
	}
}

// downloadClient 返回下载专用客户端（未显式设置时回退到通用客户端）。
func (c *Client) downloadClient() *http.Client {
	if c.downloadHTTP != nil {
		return c.downloadHTTP
	}
	return c.http
}

func (c *Client) doJSON(ctx context.Context, method, path string, token string, payload map[string]interface{}) (map[string]interface{}, error) {
	var body io.Reader
	if payload != nil {
		b, _ := json.Marshal(payload)
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("SonicNote %s %s 请求失败: %w", method, path, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("SonicNote %s %s 返回 HTTP %d: %s", method, path, resp.StatusCode, string(raw))
	}
	var out map[string]interface{}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("SonicNote %s %s 返回非 JSON: %w", method, path, err)
	}
	if code, ok := out["code"].(float64); ok && code != 200 && code != 0 {
		// 拼接远端 msg/message，保留失败原因（如 "apiKey 无效"），供分类与取证
		msg, _ := out["msg"].(string)
		if msg == "" {
			msg, _ = out["message"].(string)
		}
		if msg != "" {
			return nil, fmt.Errorf("SonicNote %s %s 返回 code=%v: %s", method, path, out["code"], msg)
		}
		return nil, fmt.Errorf("SonicNote %s %s 返回 code=%v", method, path, out["code"])
	}
	data, _ := out["data"].(map[string]interface{})
	return data, nil
}

// Login 使用 MCP Key 登录，返回 JWT token。
func (c *Client) Login(ctx context.Context, apiKey string) (string, error) {
	data, err := c.doJSON(ctx, http.MethodPost, "/app/mcp/login", "", map[string]interface{}{"apiKey": apiKey})
	if err != nil {
		return "", err
	}
	token, _ := data["token"].(string)
	if token == "" {
		if t, ok := data["accessToken"].(string); ok {
			token = t
		}
	}
	if token == "" {
		return "", fmt.Errorf("SonicNote 登录响应缺少 token")
	}
	return token, nil
}

// ListRecordings 分页获取录音列表。
func (c *Client) ListRecordings(ctx context.Context, token string, page, size int) ([]map[string]interface{}, int, error) {
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 50 {
		size = 50
	}
	path := fmt.Sprintf("/app/recording/list?page=%d&size=%d", page, size)
	data, err := c.doJSON(ctx, http.MethodGet, path, token, nil)
	if err != nil {
		return nil, 0, err
	}
	var items []map[string]interface{}
	if list, ok := data["list"].([]interface{}); ok {
		for _, it := range list {
			if m, ok := it.(map[string]interface{}); ok {
				items = append(items, m)
			}
		}
	}
	total := len(items)
	if t, ok := data["total"].(float64); ok {
		total = int(t)
	}
	return items, total, nil
}

// GetRecordingDetail 获取录音详情。
func (c *Client) GetRecordingDetail(ctx context.Context, token, audioID string) (map[string]interface{}, error) {
	path := "/app/recording/detail?audioId=" + audioID
	data, err := c.doJSON(ctx, http.MethodGet, path, token, nil)
	if err != nil {
		return nil, err
	}
	if data == nil {
		return map[string]interface{}{}, nil
	}
	return data, nil
}

// DownloadAudioToFile 流式下载音频到临时文件，返回（临时文件路径, 字节数, sha256 hash, error）。
// 不带 Authorization，避免 JWT 泄漏到 OSS；内存占用固定（io.Copy 小缓冲），不随音频大小增长。
// 边写边算 sha256（与录音导入 finalize 的 outputHash 同算法），供同内容转写/纪要复用匹配。
// 超过 maxBytes 或失败时自动清理临时文件；调用方负责成功后 os.Remove 清理。
func (c *Client) DownloadAudioToFile(ctx context.Context, audioURL string, maxBytes int64) (string, int64, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, audioURL, nil)
	if err != nil {
		return "", 0, "", err
	}
	resp, err := c.downloadClient().Do(req)
	if err != nil {
		return "", 0, "", fmt.Errorf("SonicNote 音频下载失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", 0, "", fmt.Errorf("SonicNote 音频下载返回 HTTP %d", resp.StatusCode)
	}
	tmp, err := os.CreateTemp("", "sonicnote-audio-*")
	if err != nil {
		return "", 0, "", fmt.Errorf("创建临时文件失败: %w", err)
	}
	path := tmp.Name()
	hasher := sha256.New()
	n, err := io.Copy(io.MultiWriter(tmp, hasher), io.LimitReader(resp.Body, maxBytes+1))
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(path)
		return "", 0, "", err
	}
	if n > maxBytes {
		_ = os.Remove(path)
		return "", 0, "", fmt.Errorf("SonicNote 音频超过下载上限 %d 字节", maxBytes)
	}
	return path, n, hex.EncodeToString(hasher.Sum(nil)), nil
}
