package rag

import (
	"bytes"
	"fmt"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/model"
)

const graphExtractionBatchTokenBudget = 4000

func GraphExtractionBatchTokenBudget() int {
	return graphExtractionBatchTokenBudget
}

type GraphExtractionBatch struct {
	Chunks     []model.DocumentChunk
	ChunkIDs   []int64
	TokenCount int
}

func BuildGraphExtractionBatches(chunks []model.DocumentChunk, maxTokens int) []GraphExtractionBatch {
	return buildGraphExtractionBatches(chunks, maxTokens)
}

func BuildGraphExtractionBatchXML(batch GraphExtractionBatch) string {
	return buildGraphExtractionBatchXML(batch)
}

func buildGraphExtractionBatches(chunks []model.DocumentChunk, maxTokens int) []GraphExtractionBatch {
	if maxTokens <= 0 {
		maxTokens = graphExtractionBatchTokenBudget
	}

	tokenizer := NewTokenizerService()
	knowledgeChunks := make([]model.DocumentChunk, 0, len(chunks))
	for _, chunk := range chunks {
		if chunk.ChunkType != "knowledge" {
			continue
		}
		if strings.TrimSpace(chunk.Content) == "" {
			continue
		}
		knowledgeChunks = append(knowledgeChunks, chunk)
	}

	sort.SliceStable(knowledgeChunks, func(i, j int) bool {
		return knowledgeChunks[i].ChunkIndex < knowledgeChunks[j].ChunkIndex
	})

	batches := make([]GraphExtractionBatch, 0)
	current := GraphExtractionBatch{
		Chunks:   make([]model.DocumentChunk, 0),
		ChunkIDs: make([]int64, 0),
	}

	flushCurrent := func() {
		if len(current.Chunks) == 0 {
			return
		}
		batches = append(batches, current)
		current = GraphExtractionBatch{
			Chunks:   make([]model.DocumentChunk, 0),
			ChunkIDs: make([]int64, 0),
		}
	}

	for _, chunk := range knowledgeChunks {
		chunkTokens := countGraphExtractionChunkTokens(tokenizer, chunk.Content)

		if len(current.Chunks) > 0 && current.TokenCount+chunkTokens > maxTokens {
			flushCurrent()
		}

		current.Chunks = append(current.Chunks, chunk)
		current.ChunkIDs = append(current.ChunkIDs, chunk.ID)
		current.TokenCount += chunkTokens

		if chunkTokens > maxTokens && len(current.Chunks) == 1 {
			flushCurrent()
		}
	}

	flushCurrent()
	return batches
}

func buildGraphExtractionBatchXML(batch GraphExtractionBatch) string {
	var buf bytes.Buffer
	buf.WriteString("<chunks>")
	for _, chunk := range batch.Chunks {
		buf.WriteString(fmt.Sprintf(`<chunk chunk_id="%d" chunk_index="%d">`, chunk.ID, chunk.ChunkIndex))
		_ = escapeXMLInto(&buf, strings.TrimSpace(chunk.Content))
		buf.WriteString("</chunk>")
	}
	buf.WriteString("</chunks>")
	return buf.String()
}

func countGraphExtractionChunkTokens(tokenizer *TokenizerService, content string) int {
	content = strings.TrimSpace(content)
	if content == "" {
		return 0
	}
	if tokenizer == nil {
		tokenizer = NewTokenizerService()
	}
	tokens, err := tokenizer.CountTokens(content)
	if err != nil {
		return 0
	}
	return tokens
}

func escapeXMLInto(buf *bytes.Buffer, text string) error {
	if text == "" {
		return nil
	}

	replacer := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		"\"", "&quot;",
		"'", "&apos;",
	)
	_, err := buf.WriteString(replacer.Replace(text))
	return err
}
