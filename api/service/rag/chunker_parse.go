package rag

import (
	"regexp"
	"strings"
)

// SplitPoint 表示一个分割点
type SplitPoint struct {
	Position   int    // 分割点在内容中的位置
	EndPos     int    // 分割符的结束位置
	Separator  string // 分割符内容
	Type       string // 分割符类型 (header, text, etc.)
}

// parseMarkdown parses the markdown content into structured parts
func (s *ChunkerService) parseMarkdown(content string) *ParsedContent {
	parsed := &ParsedContent{
		Content: content,
	}
	parsed.Headers = s.extractHeaders(content)
	parsed.Paragraphs = s.extractParagraphs(content)
	parsed.SpecialBlocks = s.extractSpecialBlocks(content)
	return parsed
}

// extractHeaders finds markdown headers (#..######)
func (s *ChunkerService) extractHeaders(content string) []HeaderInfo {
	headerRegex := regexp.MustCompile(`(?m)^(#{1,6})\s+(.+)$`)
	matches := headerRegex.FindAllStringSubmatchIndex(content, -1)

	var headers []HeaderInfo
	for _, match := range matches {
		headerText := content[match[0]:match[1]]
		level := len(content[match[2]:match[3]])
		title := content[match[4]:match[5]]
		headers = append(headers, HeaderInfo{
			Level:    level,
			Title:    title,
			Position: match[0],
			EndPos:   match[1],
			Content:  headerText,
		})
	}
	return headers
}

// extractParagraphs splits by double newlines
func (s *ChunkerService) extractParagraphs(content string) []ParagraphInfo {
	paragraphs := strings.Split(content, "\n\n")
	var infos []ParagraphInfo

	position := 0
	for _, paragraph := range paragraphs {
		p := strings.TrimSpace(paragraph)
		if p != "" {
			infos = append(infos, ParagraphInfo{
				Content:  p,
				Position: position,
				EndPos:   position + len(p),
			})
		}
		position += len(paragraph) + 2
	}
	return infos
}

// extractSpecialBlocks aggregates special blocks
func (s *ChunkerService) extractSpecialBlocks(content string) []SpecialBlock {
	var blocks []SpecialBlock
	blocks = append(blocks, s.extractCodeBlocks(content)...)
	blocks = append(blocks, s.extractTables(content)...)
	blocks = append(blocks, s.extractMathBlocks(content)...)
	blocks = append(blocks, s.extractMermaidBlocks(content)...)
	blocks = append(blocks, s.extractImageBlocks(content)...)
	return blocks
}

// extractCodeBlocks ``` ... ```
func (s *ChunkerService) extractCodeBlocks(content string) []SpecialBlock {
	codeRegex := regexp.MustCompile("(?s)```[\\s\\S]*?```")
	matches := codeRegex.FindAllStringIndex(content, -1)

	var blocks []SpecialBlock
	for _, m := range matches {
		blocks = append(blocks, SpecialBlock{
			Type:      "code",
			Content:   content[m[0]:m[1]],
			Position:  m[0],
			EndPos:    m[1],
			Protected: true,
		})
	}
	return blocks
}

// extractTables lines with '|'
func (s *ChunkerService) extractTables(content string) []SpecialBlock {
	lines := strings.Split(content, "\n")
	var blocks []SpecialBlock
	var tableStart, tableEnd int
	var inTable bool

	for i, line := range lines {
		if strings.Contains(line, "|") && strings.Count(line, "|") >= 2 {
			if !inTable {
				tableStart = i
				inTable = true
			}
			tableEnd = i
		} else if inTable {
			tableContent := strings.Join(lines[tableStart:tableEnd+1], "\n")
			blocks = append(blocks, SpecialBlock{
				Type:      "table",
				Content:   tableContent,
				Position:  s.getLinePosition(content, tableStart),
				EndPos:    s.getLinePosition(content, tableEnd+1),
				Protected: true,
			})
			inTable = false
		}
	}
	if inTable {
		tableContent := strings.Join(lines[tableStart:tableEnd+1], "\n")
		blocks = append(blocks, SpecialBlock{
			Type:      "table",
			Content:   tableContent,
			Position:  s.getLinePosition(content, tableStart),
			EndPos:    len(content),
			Protected: true,
		})
	}
	return blocks
}

// extractMathBlocks $...$ or $$...$$
func (s *ChunkerService) extractMathBlocks(content string) []SpecialBlock {
	mathRegex := regexp.MustCompile(`\$\$[\s\S]*?\$\$|\$[^$\n]+\$`)
	matches := mathRegex.FindAllStringIndex(content, -1)

	var blocks []SpecialBlock
	for _, m := range matches {
		blocks = append(blocks, SpecialBlock{
			Type:      "math",
			Content:   content[m[0]:m[1]],
			Position:  m[0],
			EndPos:    m[1],
			Protected: true,
		})
	}
	return blocks
}

// extractMermaidBlocks ```mermaid ... ```
func (s *ChunkerService) extractMermaidBlocks(content string) []SpecialBlock {
	mermaidRegex := regexp.MustCompile("(?s)" + "```mermaid[\\s\\S]*?```")
	matches := mermaidRegex.FindAllStringIndex(content, -1)

	var blocks []SpecialBlock
	for _, m := range matches {
		blocks = append(blocks, SpecialBlock{
			Type:      "mermaid",
			Content:   content[m[0]:m[1]],
			Position:  m[0],
			EndPos:    m[1],
			Protected: true,
		})
	}
	return blocks
}

// extractImageBlocks ![alt](url)
func (s *ChunkerService) extractImageBlocks(content string) []SpecialBlock {
	imageRegex := regexp.MustCompile(`!\[[^\]]*\]\([^)]+\)`)
	matches := imageRegex.FindAllStringIndex(content, -1)

	var blocks []SpecialBlock
	for _, m := range matches {
		blocks = append(blocks, SpecialBlock{
			Type:      "image",
			Content:   content[m[0]:m[1]],
			Position:  m[0],
			EndPos:    m[1],
			Protected: true,
		})
	}
	return blocks
}

// getLinePosition returns rune offset of a line
func (s *ChunkerService) getLinePosition(content string, lineNum int) int {
	lines := strings.Split(content, "\n")
	position := 0
	for i := 0; i < lineNum && i < len(lines); i++ {
		position += len(lines[i]) + 1
	}
	return position
}

// analyzeDocumentStructure builds sections by header level
func (s *ChunkerService) analyzeDocumentStructure(parsed *ParsedContent, targetLevel int) []DocumentSection {
	var sections []DocumentSection

	if len(parsed.Headers) == 0 {
		sections = append(sections, DocumentSection{
			Title:     "文档内容",
			Level:     0,
			StartPos:  0,
			EndPos:    len(parsed.Content),
			Content:   parsed.Content,
			HasHeader: false,
		})
		return sections
	}

	var relevant []HeaderInfo
	for _, h := range parsed.Headers {
		if h.Level <= targetLevel {
			relevant = append(relevant, h)
		}
	}

	if len(relevant) > 0 && relevant[0].Position > 0 {
		prologue := strings.TrimSpace(parsed.Content[0:relevant[0].Position])
		if prologue != "" {
			sections = append(sections, DocumentSection{
				Title:     "前言",
				Level:     0,
				StartPos:  0,
				EndPos:    relevant[0].Position,
				Content:   prologue,
				HasHeader: false,
			})
		}
	}

	for i, h := range relevant {
		endPos := len(parsed.Content)
		if i < len(relevant)-1 {
			endPos = relevant[i+1].Position
		}
		sectionContent := parsed.Content[h.Position:endPos]
		sections = append(sections, DocumentSection{
			Title:     h.Title,
			Level:     h.Level,
			StartPos:  h.Position,
			EndPos:    endPos,
			Content:   sectionContent,
			HasHeader: true,
		})
	}

	return sections
}

// splitIntoSentences splits by punctuation (keep simple)
func (s *ChunkerService) splitIntoSentences(text string) []string {
	sentenceRegex := regexp.MustCompile(`[.!?。！？]+\s*`)
	sentences := sentenceRegex.Split(text, -1)

	var result []string
	for _, sentence := range sentences {
		s := strings.TrimSpace(sentence)
		if s != "" {
			result = append(result, s)
		}
	}
	return result
}

// getHeaderLevel maps "h1".."h6" to level
func (s *ChunkerService) getHeaderLevel(headerLevel string) int {
	switch headerLevel {
	case "h1":
		return 1
	case "h2":
		return 2
	case "h3":
		return 3
	case "h4":
		return 4
	case "h5":
		return 5
	case "h6":
		return 6
	default:
		return 2
	}
}