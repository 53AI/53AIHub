package service

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/model"
)

// transcriptSentence 对应 DashScope 转写 JSON 中 transcripts[].sentences[]。
type transcriptSentence struct {
	BeginTime int64  `json:"begin_time"`
	EndTime   int64  `json:"end_time"`
	Text      string `json:"text"`
	SpeakerID int    `json:"speaker_id"`
}

// transcriptBlock 对应 transcripts[] 元素。
type transcriptBlock struct {
	Text      string               `json:"text"`
	Sentences []transcriptSentence `json:"sentences"`
}

// dashScopeTranscriptJSON 顶层结构。
type dashScopeTranscriptJSON struct {
	Transcripts []transcriptBlock `json:"transcripts"`
}

// formatTranscriptTime 毫秒转 HH:MM:SS。
func formatTranscriptTime(ms int64) string {
	if ms < 0 {
		ms = 0
	}
	total := ms / 1000
	h := total / 3600
	m := (total % 3600) / 60
	s := total % 60
	return fmt.Sprintf("%02d:%02d:%02d", h, m, s)
}

// sonicNoteTranscriptItem 对应 SonicNote /share/{audioId}/transcript/result 的 data 元素。
type sonicNoteTranscriptItem struct {
	Spokesperson string `json:"spokesperson"`
	Text         string `json:"text"`
	Time         string `json:"time"`
}

// sonicSpeakerPattern 匹配 SonicNote 发言人 "说话人N"（N 从 1 开始）。
var sonicSpeakerPattern = regexp.MustCompile(`^说话人(\d+)$`)

// speakerLabelByIndex 说话人标签统一映射（SonicNote 与 DashScope 两分支共用，
// 前端无需区分来源做二次处理）：0-25 → A说话人~Z说话人；26+ → 说话人N+1。
func speakerLabelByIndex(idx int) string {
	if idx >= 26 {
		return fmt.Sprintf("说话人%d", idx+1)
	}
	return fmt.Sprintf("%c说话人", 'A'+idx)
}

// RenderTranscriptMarkdown 渲染转写 Markdown。按首字符分流：
//   - "["：SonicNote 数组格式，说话人统一为字母标签（与 DashScope 分支一致）
//   - "{": DashScope JSON，走现有逻辑（speaker_id → A说话人/B说话人…）
//   - 其他：按非 JSON 处理
func RenderTranscriptMarkdown(rawJSON string, title string) (string, error) {
	if strings.HasPrefix(strings.TrimSpace(rawJSON), "[") {
		return renderSonicNoteTranscriptMarkdown(rawJSON, title)
	}
	return renderDashScopeTranscriptMarkdown(rawJSON, title)
}

// renderSonicNoteTranscriptMarkdown 渲染 SonicNote 数组转写。
// 每句格式：[HH:MM:SS] A说话人: 内容；说话人统一为字母标签，无说话人/时间时省略对应前缀。
func renderSonicNoteTranscriptMarkdown(rawJSON, title string) (string, error) {
	var items []sonicNoteTranscriptItem
	if err := json.Unmarshal([]byte(rawJSON), &items); err != nil {
		return "", fmt.Errorf("解析转写 JSON 失败: %w", err)
	}

	var b strings.Builder
	if strings.TrimSpace(title) != "" {
		b.WriteString("# ")
		b.WriteString(title)
		b.WriteString("\n\n")
	}

	// 非"说话人N"格式的发言人按出现顺序分配字母标签（同源同标签）
	var fallbackSeen = map[string]string{}
	lineCount := 0
	for _, it := range items {
		text := strings.TrimSpace(it.Text)
		if text == "" {
			continue
		}
		lineCount++
		ts := strings.TrimSpace(it.Time)
		speaker := strings.TrimSpace(it.Spokesperson)
		label := ""
		if speaker != "" {
			if m := sonicSpeakerPattern.FindStringSubmatch(speaker); m != nil {
				// 说话人N（N 从 1 开始）→ 索引 N-1；N<1（异常命名如"说话人0"）回退按出现顺序分配
				if n, err := strconv.Atoi(m[1]); err == nil && n >= 1 {
					label = speakerLabelByIndex(n - 1)
				}
			}
			if label == "" {
				// 非"说话人N"格式或异常 N：按出现顺序分配字母标签（同源同标签）
				if seen, ok := fallbackSeen[speaker]; ok {
					label = seen
				} else {
					label = speakerLabelByIndex(len(fallbackSeen))
					fallbackSeen[speaker] = label
				}
			}
		}
		switch {
		case label != "" && ts != "":
			b.WriteString(fmt.Sprintf("[%s] %s: %s\n\n", ts, label, text))
		case label != "":
			b.WriteString(fmt.Sprintf("%s: %s\n\n", label, text))
		case ts != "":
			b.WriteString(fmt.Sprintf("[%s] %s\n\n", ts, text))
		default:
			b.WriteString(text)
			b.WriteString("\n\n")
		}
	}

	if lineCount == 0 {
		return "", fmt.Errorf("转写内容为空")
	}
	return strings.TrimRight(b.String(), "\n"), nil
}

// renderDashScopeTranscriptMarkdown 解析 DashScope 转写 JSON，渲染为 Markdown。
// 每句格式：[HH:MM:SS] A说话人: 内容；speaker_id=-1 或无说话人时省略前缀。
// 说话人按出现顺序编号为 A说话人/B说话人/...（字母递增）。
func renderDashScopeTranscriptMarkdown(rawJSON string, title string) (string, error) {
	var data dashScopeTranscriptJSON
	if err := json.Unmarshal([]byte(rawJSON), &data); err != nil {
		// 非 JSON 输入：按规格返回原样文本（旧行为是报错；纯文本转写场景不应失败）
		if text := strings.TrimSpace(rawJSON); text != "" {
			return text, nil
		}
		return "", fmt.Errorf("解析转写 JSON 失败: %w", err)
	}

	var b strings.Builder
	if strings.TrimSpace(title) != "" {
		b.WriteString("# ")
		b.WriteString(title)
		b.WriteString("\n\n")
	}

	var speakerSeen = map[int]string{}
	lineCount := 0
	for _, block := range data.Transcripts {
		for _, s := range block.Sentences {
			text := strings.TrimSpace(s.Text)
			if text == "" {
				continue
			}
			lineCount++
			ts := formatTranscriptTime(s.BeginTime)
			if s.SpeakerID >= 0 {
				speaker, ok := speakerSeen[s.SpeakerID]
				if !ok {
					speaker = speakerLabelByIndex(s.SpeakerID)
					speakerSeen[s.SpeakerID] = speaker
				}
				b.WriteString(fmt.Sprintf("[%s] %s: %s\n\n", ts, speaker, text))
			} else {
				b.WriteString(fmt.Sprintf("[%s] %s\n\n", ts, text))
			}
		}
		// 兼容无 sentences 只有整段 text 的情况
		if len(block.Sentences) == 0 {
			if text := strings.TrimSpace(block.Text); text != "" {
				lineCount++
				b.WriteString(text)
				b.WriteString("\n\n")
			}
		}
	}

	if lineCount == 0 {
		return "", fmt.Errorf("转写内容为空")
	}
	return strings.TrimRight(b.String(), "\n"), nil
}

// ExportTranscriptMarkdown 导出录音转写为 Markdown。返回 (markdown, 文件名, error)。
func ExportTranscriptMarkdown(ctx context.Context, eid, fileID int64) (string, string, error) {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return "", "", fmt.Errorf("文件不存在: %w", err)
	}

	raw, err := loadTranscriptTextRaw(ctx, eid, fileID)
	if err != nil {
		return "", "", fmt.Errorf("读取转写失败: %w", err)
	}

	title := strings.TrimSpace(file.GetAccurateFileName())
	if title == "" {
		title = fmt.Sprintf("录音_%d", fileID)
	}
	md, err := RenderTranscriptMarkdown(raw, title)
	if err != nil {
		return "", "", err
	}

	fileName := title + "_转写.md"
	return md, fileName, nil
}
