package service

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"

	"github.com/53AI/53AIHub/service/rag"
)

const (
	wikiPageChunkWindowTokens  = 512
	wikiPageChunkOverlapTokens = wikiPageChunkWindowTokens / 10

	WikiPageChunkTypeSummary      = "summary"
	WikiPageChunkTypeContent      = "content"
	WikiPageChunkTypeTable        = "table"
	WikiPageChunkTypeImageCaption = "image_caption"
	WikiPageChunkTypeCode         = "code"
	WikiPageChunkTypeWikiLink     = "wiki_link"
)

var (
	wikiPageHeadingPattern = regexp.MustCompile(`^(#{1,2})\s+(.+?)\s*$`)
	wikiPageImagePattern   = regexp.MustCompile(`!\[[^\]]*\]\([^)]*\)`)
)

type WikiPageChunkInput struct {
	PageID    int64
	VersionID int64
	Title     string
	Summary   string
	Body      string
}

type WikiPageChunk struct {
	ChunkID         string
	PageID          int64
	VersionID       int64
	ParentSectionID string
	ChunkType       string
	ChunkIndex      int
	HeadingPath     string
	Content         string
	OriginalStart   int
	OriginalEnd     int
	TokenCount      int
	ContentHash     string
	Oversized       bool
}

type WikiPageChunker struct {
	tokenizer *rag.TokenizerService
}

func NewWikiPageChunker() *WikiPageChunker {
	return &WikiPageChunker{tokenizer: rag.NewTokenizerService()}
}

func (c *WikiPageChunker) Chunk(in WikiPageChunkInput) ([]WikiPageChunk, error) {
	if c == nil || c.tokenizer == nil {
		return nil, fmt.Errorf("wiki page chunker is nil")
	}
	if strings.TrimSpace(in.Body) == "" && strings.TrimSpace(in.Summary) == "" {
		return nil, nil
	}

	chunks := make([]WikiPageChunk, 0)
	if summary := strings.TrimSpace(in.Summary); summary != "" {
		content := strings.TrimSpace(strings.Join([]string{strings.TrimSpace(in.Title), summary}, "\n\n"))
		chunks = append(chunks, c.newChunk(in, WikiPageChunkTypeSummary, "", "", content, 0, len(in.Body)))
	}

	sections := splitWikiPageSections(in.Body)
	for _, section := range sections {
		chunks = append(chunks, c.chunkSection(in, section)...)
	}
	for i := range chunks {
		chunks[i].ChunkIndex = i
		chunks[i].ChunkID = wikiPageChunkID(in.PageID, in.VersionID, chunks[i].ChunkType, chunks[i].ParentSectionID, chunks[i].ContentHash)
	}
	return chunks, nil
}

type wikiPageSection struct {
	HeadingPath     string
	ParentSectionID string
	Content         string
	Start           int
	End             int
}

func splitWikiPageSections(content string) []wikiPageSection {
	if strings.TrimSpace(content) == "" {
		return nil
	}
	type heading struct {
		level int
		title string
	}
	var path []heading
	sections := make([]wikiPageSection, 0)
	sectionStart := 0
	sectionPath := ""
	flush := func(end int) {
		if end <= sectionStart || strings.TrimSpace(content[sectionStart:end]) == "" {
			return
		}
		sections = append(sections, wikiPageSection{
			HeadingPath:     sectionPath,
			ParentSectionID: wikiPageSectionID(sectionPath),
			Content:         content[sectionStart:end],
			Start:           sectionStart,
			End:             end,
		})
	}

	for lineStart := 0; lineStart < len(content); {
		lineEnd := strings.IndexByte(content[lineStart:], '\n')
		if lineEnd < 0 {
			lineEnd = len(content)
		} else {
			lineEnd += lineStart
		}
		line := strings.TrimSpace(content[lineStart:lineEnd])
		match := wikiPageHeadingPattern.FindStringSubmatch(line)
		if len(match) == 3 {
			flush(lineStart)
			level := len(match[1])
			for len(path) > 0 && path[len(path)-1].level >= level {
				path = path[:len(path)-1]
			}
			path = append(path, heading{level: level, title: strings.TrimSpace(match[2])})
			parts := make([]string, 0, len(path))
			for _, item := range path {
				parts = append(parts, item.title)
			}
			sectionPath = strings.Join(parts, " > ")
			sectionStart = lineStart
		}
		if lineEnd == len(content) {
			break
		}
		lineStart = lineEnd + 1
	}
	flush(len(content))
	if len(sections) == 0 {
		return []wikiPageSection{{
			ParentSectionID: wikiPageSectionID(""),
			Content:         content,
			Start:           0,
			End:             len(content),
		}}
	}
	return sections
}

type wikiPageAtomicBlock struct {
	Type    string
	Content string
	Start   int
	End     int
}

func (c *WikiPageChunker) chunkSection(in WikiPageChunkInput, section wikiPageSection) []WikiPageChunk {
	atoms := splitWikiPageAtomicBlocks(section.Content, section.Start)
	chunks := make([]WikiPageChunk, 0)
	ordinary := make([]wikiPageAtomicBlock, 0)
	flushOrdinary := func() {
		if len(ordinary) == 0 {
			return
		}
		content := joinWikiPageBlocks(ordinary)
		start := ordinary[0].Start
		end := ordinary[len(ordinary)-1].End
		chunks = append(chunks, c.splitOrdinary(in, section, content, start, end)...)
		ordinary = ordinary[:0]
	}
	for _, atom := range atoms {
		if atom.Type == WikiPageChunkTypeContent {
			ordinary = append(ordinary, atom)
			continue
		}
		flushOrdinary()
		over := c.tokenCount(atom.Content) > wikiPageChunkWindowTokens
		chunks = append(chunks, c.newChunk(in, atom.Type, section.ParentSectionID, section.HeadingPath, atom.Content, atom.Start, atom.End, over))
	}
	flushOrdinary()
	return chunks
}

func (c *WikiPageChunker) splitOrdinary(in WikiPageChunkInput, section wikiPageSection, content string, start, end int) []WikiPageChunk {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil
	}
	if c.tokenCount(content) <= wikiPageChunkWindowTokens {
		return []WikiPageChunk{c.newChunk(in, WikiPageChunkTypeContent, section.ParentSectionID, section.HeadingPath, content, start, end)}
	}

	chunks := make([]WikiPageChunk, 0)
	runes := []rune(content)
	base := start
	for offset := 0; offset < len(runes); {
		remaining := string(runes[offset:])
		take := maxRunePrefixForTokens(c, remaining, wikiPageChunkWindowTokens)
		if take <= 0 {
			take = 1
		}
		part := strings.TrimSpace(string(runes[offset : offset+take]))
		partStart := base + len(string(runes[:offset]))
		partEnd := partStart + len(part)
		chunks = append(chunks, c.newChunk(in, WikiPageChunkTypeContent, section.ParentSectionID, section.HeadingPath, part, partStart, partEnd))
		if offset+take >= len(runes) {
			break
		}
		overlap := minRuneSuffixForTokens(c, string(runes[offset:offset+take]), wikiPageChunkOverlapTokens)
		next := take - overlap
		if next <= 0 {
			next = take
		}
		offset += next
	}
	return chunks
}

func splitWikiPageAtomicBlocks(content string, base int) []wikiPageAtomicBlock {
	lines := strings.SplitAfter(content, "\n")
	blocks := make([]wikiPageAtomicBlock, 0)
	ordinaryStart := 0
	position := 0
	flushOrdinary := func(end int) {
		if end > ordinaryStart && strings.TrimSpace(content[ordinaryStart:end]) != "" {
			blocks = append(blocks, wikiPageAtomicBlock{Type: WikiPageChunkTypeContent, Content: content[ordinaryStart:end], Start: base + ordinaryStart, End: base + end})
		}
	}
	for i := 0; i < len(lines); {
		line := strings.TrimSpace(lines[i])
		if strings.HasPrefix(line, "```") {
			flushOrdinary(position)
			start := position
			position += len(lines[i])
			i++
			for i < len(lines) {
				position += len(lines[i])
				if strings.HasPrefix(strings.TrimSpace(lines[i]), "```") {
					i++
					break
				}
				i++
			}
			blocks = append(blocks, wikiPageAtomicBlock{Type: WikiPageChunkTypeCode, Content: content[start:position], Start: base + start, End: base + position})
			ordinaryStart = position
			continue
		}
		if strings.Contains(line, "|") && strings.Count(line, "|") >= 2 {
			flushOrdinary(position)
			start := position
			for i < len(lines) {
				candidate := strings.TrimSpace(lines[i])
				if !strings.Contains(candidate, "|") || strings.Count(candidate, "|") < 2 {
					break
				}
				position += len(lines[i])
				i++
			}
			blocks = append(blocks, wikiPageAtomicBlock{Type: WikiPageChunkTypeTable, Content: content[start:position], Start: base + start, End: base + position})
			ordinaryStart = position
			continue
		}
		if wikiPageImagePattern.MatchString(line) {
			flushOrdinary(position)
			end := position + len(lines[i])
			blocks = append(blocks, wikiPageAtomicBlock{Type: WikiPageChunkTypeImageCaption, Content: lines[i], Start: base + position, End: base + end})
			position = end
			ordinaryStart = position
			i++
			continue
		}
		if strings.Contains(line, "[[") && strings.Contains(line, "]]") {
			flushOrdinary(position)
			end := position + len(lines[i])
			blocks = append(blocks, wikiPageAtomicBlock{Type: WikiPageChunkTypeWikiLink, Content: lines[i], Start: base + position, End: base + end})
			position = end
			ordinaryStart = position
			i++
			continue
		}
		position += len(lines[i])
		i++
	}
	flushOrdinary(position)
	return blocks
}

func joinWikiPageBlocks(blocks []wikiPageAtomicBlock) string {
	parts := make([]string, 0, len(blocks))
	for _, block := range blocks {
		parts = append(parts, strings.TrimSpace(block.Content))
	}
	return strings.Join(parts, "\n\n")
}

func (c *WikiPageChunker) newChunk(in WikiPageChunkInput, chunkType, parentID, headingPath, content string, start, end int, oversized ...bool) WikiPageChunk {
	content = strings.TrimSpace(content)
	return WikiPageChunk{
		PageID:          in.PageID,
		VersionID:       in.VersionID,
		ParentSectionID: parentID,
		ChunkType:       chunkType,
		HeadingPath:     headingPath,
		Content:         content,
		OriginalStart:   start,
		OriginalEnd:     end,
		TokenCount:      c.tokenCount(content),
		ContentHash:     wikiPageContentHash(content),
		Oversized:       len(oversized) > 0 && oversized[0],
	}
}

func (c *WikiPageChunker) tokenCount(content string) int {
	count, err := c.tokenizer.CountTokens(content)
	if err != nil {
		return 0
	}
	return count
}

func maxRunePrefixForTokens(c *WikiPageChunker, text string, maxTokens int) int {
	runes := []rune(text)
	low, high := 1, len(runes)
	best := 0
	for low <= high {
		mid := (low + high) / 2
		if c.tokenCount(string(runes[:mid])) <= maxTokens {
			best = mid
			low = mid + 1
		} else {
			high = mid - 1
		}
	}
	return best
}

func minRuneSuffixForTokens(c *WikiPageChunker, text string, maxTokens int) int {
	runes := []rune(text)
	low, high := 0, len(runes)
	best := 0
	for low <= high {
		mid := (low + high) / 2
		if c.tokenCount(string(runes[len(runes)-mid:])) <= maxTokens {
			best = mid
			low = mid + 1
		} else {
			high = mid - 1
		}
	}
	return best
}

func wikiPageSectionID(path string) string {
	return shortWikiPageHash("section:" + path)
}

func wikiPageChunkID(pageID, versionID int64, chunkType, parentID, contentHash string) string {
	return shortWikiPageHash(fmt.Sprintf("%d:%d:%s:%s:%s", pageID, versionID, chunkType, parentID, contentHash))
}

func wikiPageContentHash(content string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(content)))
	return hex.EncodeToString(sum[:])
}

func shortWikiPageHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])[:24]
}

func minRune(a, b int) int {
	if a < b {
		return a
	}
	return b
}
