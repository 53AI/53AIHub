package ticnote

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
	"strings"
	"time"
)

// DeviceTypeTicNote 设备类型（recording_device_configs.device_type 与同步源 provider）。
const DeviceTypeTicNote = "ticnote"

// TicNoteProvider 同步源 provider 标识（与 device_type 一致，按设备隔离去重/溯源）。
const TicNoteProvider = "ticnote"

// maxAudioDownloadBytes 单条音频下载上限（流式写临时文件，不占内存）。
const maxAudioDownloadBytes = 500 << 20

// maxJSONResponseBytes JSON 响应读取上限。1MB 上限会截断大账号的文件树响应（大量录音时
// 单个 file-tree 可能超 1MB），导致整批同步失败；放宽到 100MB 并显式报错（而非静默截断后 JSON 解析失败）。
const maxJSONResponseBytes = 100 << 20

// appKeyPrefixMap AppKey 前缀 → API Base URL（sit/prd、国内/海外路由）。
var appKeyPrefixMap = []struct{ prefix, baseURL string }{
	{"tncn_sit_sk_", "https://voice-api-sit.ticnote.cn"},
	{"tncn_sk_", "https://voice-api.ticnote.cn"},
	{"tnovs_sit_sk_", "https://ainote-api-sit.mobvoi.com"},
	{"tnovs_sk_", "https://ainote-api.mobvoi.com"},
}

// resolveBaseURL 按 AppKey 前缀路由 Base URL；未知前缀回退国内生产域名。
func resolveBaseURL(appkey string) string {
	for _, m := range appKeyPrefixMap {
		if strings.HasPrefix(appkey, m.prefix) {
			return m.baseURL
		}
	}
	return "https://voice-api.ticnote.cn"
}

// recordingFileTypes 录音类 fileType（file-tree 节点）：仅这些视为待同步录音。
// 文档示例：agent_file（非录音）、upload_recording、recording_file（录音）。
// 使用包含匹配防漏（如 recording_file_xxx 变体）。
func isRecordingFileType(fileType string) bool {
	t := strings.ToLower(strings.TrimSpace(fileType))
	return strings.Contains(t, "recording")
}

type Client struct {
	baseURL string
	http    *http.Client
	// downloadHTTP 音频下载专用客户端：JSON 请求保持 30s 超时，大文件下载用更长超时，
	// 避免慢网/大录音下 30s 超时导致整个同步失败。
	downloadHTTP *http.Client
}

// NewClient 创建 TicNote 客户端；baseURL 按 appkey 前缀自动路由。
func NewClient(appkey string) *Client {
	return &Client{
		baseURL:      strings.TrimRight(resolveBaseURL(appkey), "/"),
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

// doJSON 通用请求：返回完整 JSON 对象（不统一检查业务 code——
// chats/file-tree 响应无 code 字段，file-detail 才有，由各调用方检查）。
func (c *Client) doJSON(ctx context.Context, method, path, token string, payload map[string]interface{}) (map[string]interface{}, error) {
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
		return nil, fmt.Errorf("TicNote %s %s 请求失败: %w", method, path, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxJSONResponseBytes+1))
	if len(raw) > maxJSONResponseBytes {
		return nil, fmt.Errorf("TicNote %s %s 响应超过 %d 字节（账号录音过多？），请联系管理员排查", method, path, maxJSONResponseBytes)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("TicNote %s %s 返回 HTTP %d: %s", method, path, resp.StatusCode, string(raw))
	}
	var out map[string]interface{}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("TicNote %s %s 返回非 JSON: %w", method, path, err)
	}
	return out, nil
}

// Login 使用 AppKey 登录，返回 Bearer Token（有效期 24h）。
func (c *Client) Login(ctx context.Context, appkey string) (string, error) {
	data, err := c.doJSON(ctx, http.MethodPost, "/api/p1/appkey/login", "", map[string]interface{}{"appkey": appkey})
	if err != nil {
		return "", err
	}
	if code, ok := data["code"].(float64); ok && code != 200 && code != 0 {
		msg, _ := data["msg"].(string)
		return "", fmt.Errorf("TicNote 登录失败 code=%v msg=%s", code, msg)
	}
	d, _ := data["data"].(map[string]interface{})
	token, _ := d["token"].(string)
	if token == "" {
		return "", fmt.Errorf("TicNote 登录响应缺少 token")
	}
	return token, nil
}

// Project 知识库项目（文件树的根）。
type Project struct {
	ID   string
	Name string
}

// ListProjects 获取当前用户全部项目（GET /api/v2/file-index/chats）。
func (c *Client) ListProjects(ctx context.Context, token string) ([]Project, error) {
	data, err := c.doJSON(ctx, http.MethodGet, "/api/v2/file-index/chats", token, nil)
	if err != nil {
		return nil, err
	}
	chats, _ := data["chats"].([]interface{})
	projects := make([]Project, 0, len(chats))
	for _, it := range chats {
		m, ok := it.(map[string]interface{})
		if !ok {
			continue
		}
		id, _ := m["project_id"].(string)
		name, _ := m["project_name"].(string)
		if id == "" {
			continue
		}
		projects = append(projects, Project{ID: id, Name: name})
	}
	return projects, nil
}

// Recording 远端录音（file-tree 中的录音节点）。
type Recording struct {
	RecordID string // 记录 ID（file-detail 查询用）
	FileName string
	FileType string
}

// maxProbeProjects 探测时遍历的项目数上限：CheckStatus 只统计前 N 个项目的录音数，
// 避免大账号（项目多、文件树大）探测被全量遍历拖慢/超时；真实计数以实际同步为准。
const maxProbeProjects = 3

// ListRecordings 遍历全部项目的文件树，收集录音类节点（GET /api/v1/file-index/file-tree?rootId=）。
func (c *Client) ListRecordings(ctx context.Context, token string) ([]Recording, error) {
	projects, err := c.ListProjects(ctx, token)
	if err != nil {
		return nil, err
	}
	var out []Recording
	for _, p := range projects {
		data, err := c.doJSON(ctx, http.MethodGet, "/api/v1/file-index/file-tree?rootId="+p.ID, token, nil)
		if err != nil {
			return nil, fmt.Errorf("TicNote 获取项目 %s 文件树失败: %w", p.ID, err)
		}
		tree, _ := data["fileTree"].([]interface{})
		collectRecordings(tree, &out)
	}
	return out, nil
}

// ListRecordingsLimited 遍历最多 maxProjects 个项目的文件树收集录音节点（探测用轻量版）。
func (c *Client) ListRecordingsLimited(ctx context.Context, token string, maxProjects int) ([]Recording, error) {
	if maxProjects <= 0 {
		maxProjects = maxProbeProjects
	}
	projects, err := c.ListProjects(ctx, token)
	if err != nil {
		return nil, err
	}
	if len(projects) > maxProjects {
		projects = projects[:maxProjects]
	}
	var out []Recording
	for _, p := range projects {
		data, err := c.doJSON(ctx, http.MethodGet, "/api/v1/file-index/file-tree?rootId="+p.ID, token, nil)
		if err != nil {
			return nil, fmt.Errorf("TicNote 获取项目 %s 文件树失败: %w", p.ID, err)
		}
		tree, _ := data["fileTree"].([]interface{})
		collectRecordings(tree, &out)
	}
	return out, nil
}

// collectRecordings 递归展平文件树，收集录音节点（children 目录嵌套）。
func collectRecordings(nodes []interface{}, out *[]Recording) {
	for _, it := range nodes {
		m, ok := it.(map[string]interface{})
		if !ok {
			continue
		}
		fileType, _ := m["fileType"].(string)
		if isRecordingFileType(fileType) {
			id, _ := m["id"].(string)
			name, _ := m["name"].(string)
			if id != "" {
				*out = append(*out, Recording{RecordID: id, FileName: name, FileType: fileType})
			}
		}
		if children, ok := m["children"].([]interface{}); ok {
			collectRecordings(children, out)
		}
	}
}

// FileDetail 文件详情（GET /api/v2/file-index/file-detail/{recordId}）。
type FileDetail struct {
	RecordID        string
	FileName        string
	FileURL         string // 原始音频 URL（可能为私有封装，如 opus）
	FormatURL       string // TicNote 服务端转码后的标准格式 URL（wav），优先用于下载
	DurationSec     int64
	Status          int
	TranscodeStatus string
	IsVoice         bool
}

// GetFileDetail 获取文件详情（音频下载 URL 等）。
func (c *Client) GetFileDetail(ctx context.Context, token, recordID string) (*FileDetail, error) {
	data, err := c.doJSON(ctx, http.MethodGet, "/api/v2/file-index/file-detail/"+recordID, token, nil)
	if err != nil {
		return nil, err
	}
	if code, ok := data["code"].(float64); ok && code != 200 && code != 0 {
		msg, _ := data["msg"].(string)
		return nil, fmt.Errorf("TicNote 文件详情失败 code=%v msg=%s", code, msg)
	}
	d, _ := data["data"].(map[string]interface{})
	if d == nil {
		return nil, fmt.Errorf("TicNote 文件详情响应缺少 data: recordId=%s", recordID)
	}
	fd := &FileDetail{
		RecordID:    recordID,
		FileName:    strVal(d["fileName"]),
		FileURL:     strVal(d["fileUrl"]),
		FormatURL:   strVal(d["formatUrl"]),
		DurationSec: int64(numVal(d["duration"])),
		Status:      int(numVal(d["status"])),
	}
	fd.TranscodeStatus = strVal(d["transcodeStatus"])
	if v, ok := d["isVoice"].(bool); ok {
		fd.IsVoice = v
	}
	return fd, nil
}

func strVal(v interface{}) string {
	s, _ := v.(string)
	return s
}

func numVal(v interface{}) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	}
	return 0
}

// DownloadAudioToFile 流式下载音频到临时文件，返回（临时文件路径, 字节数, sha256 hash, error）。
// 不带 Authorization，避免 JWT 泄漏到 CDN；内存占用固定（io.Copy 小缓冲）。
// 边写边算 sha256，供同内容转写/纪要复用匹配（与 SonicNote/导入 finalize 同算法）。
// 超过 maxBytes 或失败时自动清理临时文件；调用方负责成功后 os.Remove 清理。
func (c *Client) DownloadAudioToFile(ctx context.Context, audioURL string, maxBytes int64) (string, int64, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, audioURL, nil)
	if err != nil {
		return "", 0, "", err
	}
	resp, err := c.downloadClient().Do(req)
	if err != nil {
		return "", 0, "", fmt.Errorf("TicNote 音频下载失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", 0, "", fmt.Errorf("TicNote 音频下载返回 HTTP %d", resp.StatusCode)
	}
	tmp, err := os.CreateTemp("", "ticnote-audio-*")
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
		return "", 0, "", fmt.Errorf("TicNote 音频超过下载上限 %d 字节", maxBytes)
	}
	return path, n, hex.EncodeToString(hasher.Sum(nil)), nil
}
