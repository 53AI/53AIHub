package rag

import (
	"fmt"
	"strings"
)

// ComposeSummaryInput reshapes long document text into a stitched set of
// distributed windows so the model can still see the document's overall arc
// without relying on a single front-truncated excerpt.
func ComposeSummaryInput(content string, maxChars int) string {
	content = strings.TrimSpace(content)
	if content == "" || maxChars <= 0 {
		return content
	}
	if len([]rune(content)) <= maxChars {
		return content
	}

	blocks := splitSummaryInputBlocks(content)
	if len(blocks) == 0 {
		return truncateRunes(content, maxChars)
	}

	windowCount := estimateSummaryWindowCount(len([]rune(content)), len(blocks), maxChars)
	if windowCount <= 1 {
		return truncateRunes(content, maxChars)
	}

	perWindowBudget := maxChars / windowCount
	if perWindowBudget < 256 {
		perWindowBudget = 256
	}

	parts := make([]string, 0, windowCount)
	for windowIndex := 0; windowIndex < windowCount; windowIndex++ {
		start := windowIndex * len(blocks) / windowCount
		end := (windowIndex + 1) * len(blocks) / windowCount
		if start >= end {
			continue
		}

		window := packSummaryInputBlocks(blocks[start:end], perWindowBudget)
		if window == "" {
			continue
		}
		parts = append(parts, fmt.Sprintf("[[window %d/%d]]\n%s", windowIndex+1, windowCount, window))
	}

	stitched := strings.Join(parts, "\n\n")
	if stitched == "" {
		return truncateRunes(content, maxChars)
	}
	return stitched
}

func estimateSummaryWindowCount(contentLen, blockCount, maxChars int) int {
	if contentLen <= maxChars || blockCount <= 1 {
		return 1
	}

	windowCount := (contentLen + maxChars - 1) / maxChars
	if windowCount < 2 {
		windowCount = 2
	}
	if windowCount > 6 {
		windowCount = 6
	}
	if blockCount > 0 && windowCount > blockCount {
		windowCount = blockCount
	}
	return windowCount
}

func splitSummaryInputBlocks(content string) []string {
	rawBlocks := strings.Split(content, "\n\n")
	blocks := make([]string, 0, len(rawBlocks))
	for _, raw := range rawBlocks {
		block := strings.TrimSpace(raw)
		if block != "" {
			blocks = append(blocks, block)
		}
	}
	if len(blocks) > 1 {
		return blocks
	}

	lines := strings.Split(content, "\n")
	blocks = blocks[:0]
	current := make([]string, 0, len(lines))

	flush := func() {
		if len(current) == 0 {
			return
		}
		blocks = append(blocks, strings.Join(current, "\n"))
		current = current[:0]
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			flush()
			continue
		}
		if strings.HasPrefix(trimmed, "#") {
			flush()
			blocks = append(blocks, trimmed)
			continue
		}
		current = append(current, trimmed)
	}
	flush()

	if len(blocks) == 0 {
		return []string{content}
	}
	return blocks
}

func packSummaryInputBlocks(blocks []string, budget int) string {
	if len(blocks) == 0 || budget <= 0 {
		return ""
	}

	parts := make([]string, 0, len(blocks))
	used := 0
	for _, block := range blocks {
		block = strings.TrimSpace(block)
		if block == "" {
			continue
		}

		blockLen := len([]rune(block))
		if len(parts) == 0 && blockLen > budget {
			parts = append(parts, truncateRunes(block, budget))
			break
		}
		if len(parts) > 0 && used+2+blockLen > budget {
			break
		}

		parts = append(parts, block)
		used += blockLen
	}

	return strings.Join(parts, "\n\n")
}

func truncateRunes(s string, maxRunes int) string {
	if maxRunes <= 0 {
		return ""
	}

	runes := []rune(strings.TrimSpace(s))
	if len(runes) <= maxRunes {
		return strings.TrimSpace(s)
	}
	return string(runes[:maxRunes])
}
