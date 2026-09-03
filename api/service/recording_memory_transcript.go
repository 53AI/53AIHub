package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"strings"
)

// 转写 Markdown → 实体/会议记忆抽取（D2）。
// 新布局 FileBody=转写 Markdown，与 RAG 管线同源。转写无"决策/行动"等结构化字段，
// 因此从转写文本抽取：可信 speaker → confirmed person 实体，发言 → 陈述型 Claim。

// transcriptMarkdownStatement 转写 Markdown 中的一句话。
type transcriptMarkdownStatement struct {
	Time    string // [HH:MM:SS]，可能为空
	Speaker string // A说话人 / 说话人N，可能为空
	Text    string
}

// transcriptTimeLinePattern 匹配 "[HH:MM:SS] A说话人: 内容" / "[HH:MM:SS] 内容"。
// 说话人前缀首字符不允许是数字或冒号，避免 "[00:00:02] 12:30 开始" 把 "12" 误当说话人。
var transcriptTimeLinePattern = regexp.MustCompile(`^\[(\d{1,2}:\d{2}:\d{2})\]\s*(?:(?:([^\d:：][^:：]*))[:：]\s*)?(.*)$`)

// transcriptSpeakerLinePattern 匹配 "A说话人: 内容"（无时间戳行）。
var transcriptSpeakerLinePattern = regexp.MustCompile(`^(?:([^\d:：][^:：]*)[:：]\s*)(.+)$`)

var generatedSpeakerLabelRE = regexp.MustCompile(`(?i)^(?:[a-z]\s*说话人|说话人\s*\d*|发言人\s*\d*|speaker\s*\d+|无说话人|未知说话人)$`)

func isGeneratedSpeakerLabel(name string) bool {
	return generatedSpeakerLabelRE.MatchString(strings.TrimSpace(name))
}

// isTranscriptProtocolName 判断字符串是否为小写协议名（https/http/ftp 等），用于 URL 防护：
// 说话人位置被 "https" 等协议名占据且后续是 "//" 时，视为 URL 行而非说话人发言。
func isTranscriptProtocolName(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < 'a' || r > 'z' {
			return false
		}
	}
	return true
}

// parseTranscriptMarkdown 解析转写 Markdown 为逐句列表。跳过标题行与纯空白。
func parseTranscriptMarkdown(md string) []transcriptMarkdownStatement {
	var out []transcriptMarkdownStatement
	for _, rawLine := range strings.Split(md, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if m := transcriptTimeLinePattern.FindStringSubmatch(line); m != nil {
			speaker := strings.TrimSpace(m[2])
			text := strings.TrimSpace(m[3])
			// URL 防护："[00:00:00] https://x.com" 中 "https" 是协议名非说话人，恢复整行文本
			if strings.HasPrefix(text, "//") && isTranscriptProtocolName(speaker) {
				text = speaker + ":" + text
				speaker = ""
			}
			if text == "" {
				continue
			}
			out = append(out, transcriptMarkdownStatement{
				Time:    m[1],
				Speaker: speaker,
				Text:    text,
			})
			continue
		}
		if m := transcriptSpeakerLinePattern.FindStringSubmatch(line); m != nil {
			text := strings.TrimSpace(m[2])
			// URL 防护：无时间戳的 URL 行（如 "https://x.com"）不当作说话人发言
			if strings.HasPrefix(text, "//") && isTranscriptProtocolName(strings.TrimSpace(m[1])) {
				continue
			}
			if text == "" {
				continue
			}
			out = append(out, transcriptMarkdownStatement{
				Speaker: strings.TrimSpace(m[1]),
				Text:    text,
			})
		}
	}
	return out
}

// 限制转写记忆抽取产出的实体/声明数量，避免长会议打爆记忆概览。
const (
	maxTranscriptionSpeakers = 30
	maxSpeakerFacts          = 50
	maxClaimContentRunes     = 400
	maxClaimSegments         = 20
)

// buildRecordingStatementClaims 从转写 Markdown 编译"陈述型" Claim（按说话人聚合）。
func buildRecordingStatementClaims(md string) []recordingMemoryItem {
	stmts := parseTranscriptMarkdown(md)
	if len(stmts) == 0 {
		return nil
	}

	groups := map[string][]transcriptMarkdownStatement{}
	var order []string
	for _, s := range stmts {
		speaker := s.Speaker
		if speaker == "" {
			speaker = "无发言人"
		}
		if _, ok := groups[speaker]; !ok {
			order = append(order, speaker)
		}
		groups[speaker] = append(groups[speaker], s)
	}

	var items []recordingMemoryItem
	for _, speaker := range order {
		if len(items) >= maxTranscriptionSpeakers {
			break
		}
		lines := groups[speaker]
		content := truncateRunes(buildSpeakerContent(lines), maxClaimContentRunes)
		if content == "" {
			continue
		}
		segmentIDs := collectClaimSegments(lines)
		itemID := speaker
		if len(lines) > 0 && lines[0].Time != "" {
			itemID = speaker + "|" + lines[0].Time
		}
		sourceKey := "transcript|" + itemID
		keyHash := sha256.Sum256([]byte(sourceKey))
		evidence := len(segmentIDs) > 0
		item := recordingMemoryItem{
			sourceItemType:    "transcript",
			sourceItemID:      itemID,
			sourceKeyHash:     hex.EncodeToString(keyHash[:]),
			claimKind:         "quote",
			content:           content,
			assertionState:    "confirmed",
			epistemicType:     memoryEpistemicType("confirmed", evidence),
			lifecycleState:    memoryLifecycleState(""),
			reviewState:       memoryReviewState("confirmed", evidence),
			sourceConfidence:  0.8,
			evidenceAvailable: evidence,
			sourceSegmentIDs:  segmentIDs,
		}
		segmentJSON, _ := json.Marshal(segmentIDs)
		item.sourceSegmentJSON = string(segmentJSON)
		items = append(items, item)
	}
	return items
}

// buildRecordingSpeakerEntities 将可信 ASR 已解析出的具体 speaker 编译为 person 实体。
// 默认标签只承担发言归属，不生成实体；具体名称的可信度来自调用方传入的 ASR 转写源。
func buildRecordingSpeakerEntities(md string, allowedTypes map[string]bool) []recordingEntityMemoryItem {
	if !allowedTypes["person"] {
		return nil
	}
	stmts := parseTranscriptMarkdown(md)
	if len(stmts) == 0 {
		return nil
	}

	groups := map[string][]transcriptMarkdownStatement{}
	var order []string
	for _, s := range stmts {
		speaker := strings.TrimSpace(s.Speaker)
		if speaker == "" || isGeneratedSpeakerLabel(speaker) {
			continue
		}
		if _, ok := groups[speaker]; !ok {
			order = append(order, speaker)
		}
		groups[speaker] = append(groups[speaker], s)
	}

	var items []recordingEntityMemoryItem
	for _, speaker := range order {
		if len(items) >= maxTranscriptionSpeakers {
			break
		}
		lines := groups[speaker]
		item := recordingEntityMemoryItem{
			entityType:         "person",
			canonicalName:      speaker,
			identityClass:      "person",
			identityConfidence: 1,
			identityStatus:     "confirmed",
			attributes: map[string]string{
				recordingEntityIdentityPolicyKey:     "person",
				recordingEntityIdentityConfidenceKey: "1.0000",
				recordingEntityIdentityStatusKey:     "confirmed",
			},
		}
		if evidence := collectClaimSegments(lines); len(evidence) > 0 {
			item.attributes[recordingEntityIdentityEvidenceKey] = strings.Join(evidence, ",")
		}
		for _, s := range lines {
			if len(item.facts) >= maxSpeakerFacts {
				break
			}
			if strings.TrimSpace(s.Text) == "" {
				continue
			}
			fact := recordingEntityMemoryFactItem{
				content: s.Text,
			}
			if s.Time != "" {
				fact.sourceSegmentIDs = []string{s.Time}
			}
			item.facts = append(item.facts, fact)
		}
		if len(item.facts) > 0 {
			items = append(items, item)
		}
	}
	return items
}

// buildSpeakerContent 将某说话人的发言拼接为一段文本。
func buildSpeakerContent(lines []transcriptMarkdownStatement) string {
	var parts []string
	for _, s := range lines {
		if t := strings.TrimSpace(s.Text); t != "" {
			parts = append(parts, t)
		}
	}
	return strings.Join(parts, "；")
}

// collectClaimSegments 收集发言的时间戳作为 source segment。
func collectClaimSegments(lines []transcriptMarkdownStatement) []string {
	var out []string
	for _, s := range lines {
		if s.Time != "" {
			out = append(out, s.Time)
			if len(out) >= maxClaimSegments {
				break
			}
		}
	}
	return out
}

// truncateRunes 将字符串截断到 runeLen（含）以内，超出追加省略号。
func truncateRunes(s string, runeLen int) string {
	runes := []rune(s)
	if len(runes) <= runeLen {
		return s
	}
	return string(runes[:runeLen]) + "…"
}

// NormalizeRecordingContentForLLM 按内容类型将录音文件内容规范化为 Markdown（document_chunking 回调）。
//   - 新布局 FileBody=转写 Markdown → 原样返回
//   - 历史布局 FileBody=纪要 JSON → 渲染为纪要 Markdown
//   - 最老布局 FileBody=转写 JSON → 渲染为转写 Markdown
//
// 其余（普通文档等）原样返回，保证不会把非纪要内容误渲染成 "纪要解析失败"。
func NormalizeRecordingContentForLLM(content string) string {
	switch classifyRecordingContent(content) {
	case recordingContentMinutesJSON:
		return BuildMinutesMarkdown(content)
	case recordingContentTranscriptJSON:
		if md, err := RenderTranscriptMarkdown(content, ""); err == nil && md != "" {
			return md
		}
	}
	return content
}
