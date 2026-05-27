package logviewer

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var legacyLinePattern = regexp.MustCompile(`^\[(DEBUG|INFO|WARN|ERROR|CRASH|FATAL)\]\s+(\d{4}/\d{2}/\d{2}\s-\s\d{2}:\d{2}:\d{2})(?:\s\|\s([^|\s]+))?.*$`)
var ragLinePattern = regexp.MustCompile(`^\[(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}(?:\.\d{3})?)\]\s+\[(DEBUG|INFO|WARN|ERROR|CRASH|FATAL)\]\s+(.*)$`)
var requestIDPattern = regexp.MustCompile(`(?i)request[_-]?id\s*[:=]\s*([a-zA-Z0-9._:-]+)`)

type SearchQuery struct {
	Dir        string
	FileType   string
	Keyword    string
	Level      string
	RequestID  string
	Line       int
	StartTime  int64
	EndTime    int64
	Offset     int
	Limit      int
	AnchorFile string
	AnchorLine int
	Around     int
	Direction  string
}

type LogItem struct {
	File      string `json:"file"`
	Line      int    `json:"line"`
	Timestamp int64  `json:"timestamp"`
	Level     string `json:"level"`
	RequestID string `json:"request_id"`
	Message   string `json:"message"`
	Raw       string `json:"raw"`
}

type SearchResult struct {
	Logs    []LogItem `json:"logs"`
	HasMore bool      `json:"has_more"`
}

type fileMeta struct {
	Path    string
	ModTime time.Time
}

func SearchLogs(query SearchQuery) (SearchResult, error) {
	result := SearchResult{Logs: make([]LogItem, 0)}

	if strings.TrimSpace(query.Dir) == "" {
		return result, errors.New("log dir is required")
	}
	if query.Offset < 0 {
		query.Offset = 0
	}
	if query.Limit <= 0 {
		query.Limit = 50
	}
	if query.Limit > 200 {
		query.Limit = 200
	}
	if query.Around <= 0 {
		query.Around = 20
	}
	if query.Around > 200 {
		query.Around = 200
	}

	if strings.TrimSpace(query.AnchorFile) != "" && query.AnchorLine > 0 {
		return searchAnchorLogs(query)
	}

	logs, err := searchSequentialLogs(query)
	if err != nil {
		return result, err
	}

	sortLogsByTimestampDesc(logs)

	start := query.Offset
	if start < 0 {
		start = 0
	}
	if start >= len(logs) {
		return result, nil
	}

	end := start + query.Limit
	if end > len(logs) {
		end = len(logs)
	}

	result.Logs = logs[start:end]
	result.HasMore = end < len(logs)

	return result, nil
}

func searchSequentialLogs(query SearchQuery) ([]LogItem, error) {
	files, err := resolveFiles(query.Dir, query.FileType)
	if err != nil {
		return nil, err
	}

	logs := make([]LogItem, 0, 128)
	for _, meta := range files {
		f, openErr := os.Open(meta.Path)
		if openErr != nil {
			continue
		}

		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 0, 64*1024), 2*1024*1024)
		lineNo := 0
		for scanner.Scan() {
			lineNo++
			entry := parseLine(scanner.Text(), filepath.Base(meta.Path), lineNo)
			if !matches(entry, query) {
				continue
			}
			logs = append(logs, entry)
		}
		_ = f.Close()
	}

	return logs, nil
}

func sortLogsByTimestampDesc(logs []LogItem) {
	sort.SliceStable(logs, func(i, j int) bool {
		if logs[i].Timestamp != logs[j].Timestamp {
			return logs[i].Timestamp > logs[j].Timestamp
		}
		return false
	})
}

func searchAnchorLogs(query SearchQuery) (SearchResult, error) {
	result := SearchResult{Logs: make([]LogItem, 0)}
	files, err := resolveFiles(query.Dir, query.FileType)
	if err != nil {
		return result, err
	}

	anchorBase := filepath.Base(strings.TrimSpace(query.AnchorFile))
	targetPath := ""
	for _, meta := range files {
		if filepath.Base(meta.Path) == anchorBase {
			targetPath = meta.Path
			break
		}
	}
	if targetPath == "" {
		return result, nil
	}

	direction := strings.ToLower(strings.TrimSpace(query.Direction))
	startLine := 1
	endLine := 0
	switch direction {
	case "up":
		endLine = query.AnchorLine - 1
		if endLine < 1 {
			return result, nil
		}
		startLine = endLine - query.Around + 1
		if startLine < 1 {
			startLine = 1
		}
	case "down":
		startLine = query.AnchorLine + 1
		endLine = startLine + query.Around - 1
	default:
		startLine = query.AnchorLine - query.Around
		if startLine < 1 {
			startLine = 1
		}
		endLine = query.AnchorLine + query.Around
	}

	f, openErr := os.Open(targetPath)
	if openErr != nil {
		return result, nil
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 2*1024*1024)
	lineNo := 0
	for scanner.Scan() {
		lineNo++
		if lineNo < startLine {
			continue
		}
		if lineNo > endLine {
			break
		}
		result.Logs = append(result.Logs, parseLine(scanner.Text(), filepath.Base(targetPath), lineNo))
	}

	return result, nil
}

func resolveFiles(dir string, fileType string) ([]fileMeta, error) {
	typeSet := strings.ToLower(strings.TrimSpace(fileType))
	if typeSet == "" {
		typeSet = "all"
	}

	all, err := collectLogFiles(dir)
	if err != nil {
		return nil, err
	}

	files := make([]string, 0, len(all))
	for _, f := range all {
		base := filepath.Base(f)
		switch typeSet {
		case "all":
			files = append(files, f)
		case "main":
			if strings.Contains(base, "53AIHub-error") || strings.Contains(base, "53AIHub-crash") {
				continue
			}
			files = append(files, f)
		case "error":
			if strings.Contains(base, "53AIHub-error") {
				files = append(files, f)
			}
		case "crash":
			if strings.Contains(base, "53AIHub-crash") {
				files = append(files, f)
			}
		case "ragjob":
			if strings.HasPrefix(base, "Ragjob-") {
				files = append(files, f)
			}
		default:
			return nil, errors.New("invalid file_type")
		}
	}

	metas := make([]fileMeta, 0, len(files))
	for _, f := range files {
		stat, statErr := os.Stat(f)
		if statErr != nil {
			continue
		}
		metas = append(metas, fileMeta{Path: f, ModTime: stat.ModTime()})
	}
	sort.Slice(metas, func(i, j int) bool {
		return metas[i].ModTime.After(metas[j].ModTime)
	})
	return metas, nil
}

func collectLogFiles(dir string) ([]string, error) {
	patterns := []string{
		filepath.Join(dir, "53AIHub*.log"),
		filepath.Join(dir, "Ragjob-*.log"),
	}
	seen := make(map[string]struct{}, 16)
	files := make([]string, 0, 16)
	for _, p := range patterns {
		matched, err := filepath.Glob(p)
		if err != nil {
			return nil, err
		}
		for _, f := range matched {
			if _, ok := seen[f]; ok {
				continue
			}
			seen[f] = struct{}{}
			files = append(files, f)
		}
	}
	return files, nil
}

func parseLine(line string, file string, lineNo int) LogItem {
	item := LogItem{
		File: file,
		Line: lineNo,
		Raw:  line,
	}

	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return item
	}

	var payload map[string]interface{}
	if strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}") {
		if err := json.Unmarshal([]byte(trimmed), &payload); err == nil {
			item.Level = strings.ToLower(asString(payload["level"]))
			item.Message = asString(payload["msg"])
			item.RequestID = asString(payload["request_id"])
			item.Timestamp = parseTs(asString(payload["ts"]))
			if item.Message == "" {
				item.Message = asString(payload["message"])
			}
			if item.RequestID == "" {
				item.RequestID = extractRequestID(item.Message)
			}
			return item
		}
	}

	if match := legacyLinePattern.FindStringSubmatch(trimmed); len(match) >= 3 {
		item.Level = strings.ToLower(strings.TrimSpace(match[1]))
		ts := strings.TrimSpace(match[2])
		if parsed, err := time.Parse("2006/01/02 - 15:04:05", ts); err == nil {
			item.Timestamp = parsed.UnixMilli()
		}
		if len(match) >= 4 {
			item.RequestID = strings.TrimSpace(match[3])
		}
		item.Message = trimmed
		if item.RequestID == "" {
			item.RequestID = extractRequestID(item.Message)
		}
		return item
	}

	if match := ragLinePattern.FindStringSubmatch(trimmed); len(match) >= 4 {
		item.Level = strings.ToLower(strings.TrimSpace(match[2]))
		item.Message = strings.TrimSpace(match[3])
		ts := strings.TrimSpace(match[1])
		if parsed, err := time.Parse("2006-01-02 15:04:05.000", ts); err == nil {
			item.Timestamp = parsed.UnixMilli()
		} else if parsed, err := time.Parse("2006-01-02 15:04:05", ts); err == nil {
			item.Timestamp = parsed.UnixMilli()
		}
		item.RequestID = extractRequestID(item.Message)
		return item
	}

	item.Message = trimmed
	item.RequestID = extractRequestID(item.Message)
	return item
}

func extractRequestID(text string) string {
	if text == "" {
		return ""
	}
	match := requestIDPattern.FindStringSubmatch(text)
	if len(match) >= 2 {
		return strings.TrimSpace(match[1])
	}
	return ""
}

func matches(item LogItem, query SearchQuery) bool {
	keyword := strings.TrimSpace(strings.ToLower(query.Keyword))
	if keyword != "" {
		raw := strings.ToLower(item.Raw)
		msg := strings.ToLower(item.Message)
		if !strings.Contains(raw, keyword) && !strings.Contains(msg, keyword) {
			return false
		}
	}

	level := strings.TrimSpace(strings.ToLower(query.Level))
	if level != "" {
		if strings.ToLower(item.Level) != level {
			return false
		}
	}

	reqID := strings.TrimSpace(query.RequestID)
	if reqID != "" {
		if item.RequestID != reqID {
			return false
		}
	}

	if query.Line > 0 && item.Line != query.Line {
		return false
	}

	if query.StartTime > 0 {
		if item.Timestamp == 0 || item.Timestamp < query.StartTime {
			return false
		}
	}
	if query.EndTime > 0 {
		if item.Timestamp == 0 || item.Timestamp > query.EndTime {
			return false
		}
	}

	return true
}

func parseTs(ts string) int64 {
	if ts == "" {
		return 0
	}
	if parsed, err := time.Parse(time.RFC3339Nano, ts); err == nil {
		return parsed.UnixMilli()
	}
	if parsed, err := time.Parse(time.RFC3339, ts); err == nil {
		return parsed.UnixMilli()
	}
	return 0
}

func asString(v interface{}) string {
	switch t := v.(type) {
	case string:
		return t
	case nil:
		return ""
	default:
		return ""
	}
}
