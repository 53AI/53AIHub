package rag

import (
	"regexp"
	"strings"
)

// chunkBySentences 按句子分块
func (s *ChunkerService) chunkBySentences(parsed *ParsedContent, maxLength int, chunkType string) []DocumentChunk {
	// 将所有段落合并，然后按句子分割
	allContent := strings.Join(func() []string {
		var contents []string
		for _, p := range parsed.Paragraphs {
			contents = append(contents, p.Content)
		}
		return contents
	}(), "\n\n")

	sentences := s.splitIntoSentences(allContent)
	var chunks []DocumentChunk
	var currentChunk strings.Builder
	var currentTokens int
	var startPos int

	for _, sentence := range sentences {
		sentenceTokens, _ := s.tokenizer.CountTokens(sentence)

		if currentTokens+sentenceTokens <= maxLength {
			if currentChunk.Len() == 0 {
				startPos = strings.Index(parsed.Content, sentence)
			} else {
				currentChunk.WriteString(" ")
			}
			currentChunk.WriteString(sentence)
			currentTokens += sentenceTokens
		} else {
			// 保存当前分块
			if currentChunk.Len() > 0 {
				chunks = append(chunks, DocumentChunk{
					Type:       chunkType,
					Content:    currentChunk.String(),
					StartPos:   startPos,
					EndPos:     startPos + currentChunk.Len(),
					TokenCount: currentTokens,
				})
			}

			currentChunk.Reset()
			currentChunk.WriteString(sentence)
			currentTokens = sentenceTokens
			startPos = strings.Index(parsed.Content, sentence)
		}
	}

	// 保存最后一个分块
	if currentChunk.Len() > 0 {
		chunks = append(chunks, DocumentChunk{
			Type:       chunkType,
			Content:    currentChunk.String(),
			StartPos:   startPos,
			EndPos:     startPos + currentChunk.Len(),
			TokenCount: currentTokens,
		})
	}

	return chunks
}

// splitLargeContent 分割大内容，优先按语义边界拆分
func (s *ChunkerService) splitLargeContent(content string, maxLength int, chunkType string, basePos int) []DocumentChunk {
	// 首先尝试按语义边界（句子）拆分
	chunks := s.splitBySemanticBoundaries(content, maxLength, chunkType, basePos)
	if len(chunks) > 1 {
		return chunks
	}

	// 如果语义拆分无效，使用tokenizer强制拆分
	textChunks, err := s.tokenizer.SplitTextByTokens(content, maxLength, 0)
	if err != nil {
		// 如果分割失败，返回原内容
		tokenCount, _ := s.tokenizer.CountTokens(content)
		return []DocumentChunk{{
			Type:       chunkType,
			Content:    content,
			StartPos:   basePos,
			EndPos:     basePos + len(content),
			TokenCount: tokenCount,
		}}
	}

	var result []DocumentChunk
	currentPos := basePos

	for _, textChunk := range textChunks {
		tokenCount, _ := s.tokenizer.CountTokens(textChunk)
		result = append(result, DocumentChunk{
			Type:       chunkType,
			Content:    textChunk,
			StartPos:   currentPos,
			EndPos:     currentPos + len(textChunk),
			TokenCount: tokenCount,
		})
		currentPos += len(textChunk)
	}

	return result
}

// findSeparatorIndices 找到所有分隔符的位置（返回分隔符起始索引，升序）
func (s *ChunkerService) findSeparatorIndices(content string, separator string) []int {
	if separator == "" || content == "" {
		return nil
	}
	var indices []int
	sepLen := len(separator)
	searchFrom := 0
	for {
		i := strings.Index(content[searchFrom:], separator)
		if i == -1 {
			break
		}
		pos := searchFrom + i
		indices = append(indices, pos)
		searchFrom = pos + sepLen
		if searchFrom >= len(content) {
			break
		}
	}
	return indices
}

// splitBySemanticBoundaries 按语义边界拆分大内容
func (s *ChunkerService) splitBySemanticBoundaries(content string, maxLength int, chunkType string, basePos int) []DocumentChunk {
	// 定义语义边界分隔符，按优先级排序
	semanticSeparators := []struct {
		pattern string
		desc    string
	}{
		{`[.!?。！？]+\s*`, "句号、感叹号、问号"},
		{`[;；]+\s*`, "分号"},
		{`[,，]+\s*`, "逗号"},
		{`[:：]+\s*`, "冒号"},
		{`[-—–]+\s*`, "破折号"},
		{`\s+`, "空格"},
	}

	// 尝试每个分隔符
	for _, separator := range semanticSeparators {
		chunks := s.splitByPattern(content, separator.pattern, maxLength, chunkType, basePos)
		if len(chunks) > 1 {
			// 如果成功拆分成多个块，返回结果
			return chunks
		}
	}

	// 如果所有语义边界都无法拆分，返回单个块
	tokenCount, _ := s.tokenizer.CountTokens(content)
	return []DocumentChunk{{
		Type:       chunkType,
		Content:    content,
		StartPos:   basePos,
		EndPos:     basePos + len(content),
		TokenCount: tokenCount,
	}}
}

// splitByPattern 按指定模式拆分内容，保留分隔符
func (s *ChunkerService) splitByPattern(content string, pattern string, maxLength int, chunkType string, basePos int) []DocumentChunk {
	// 使用FindAllStringIndex找到所有分隔符位置，保留分隔符
	regex := regexp.MustCompile(pattern)
	matches := regex.FindAllStringIndex(content, -1)

	if len(matches) == 0 {
		// 没有找到分隔符，无法拆分
		return nil
	}

	// 提取文本段落（包含分隔符）
	var segments []string
	lastEnd := 0

	for _, match := range matches {
		// 添加分隔符前的内容
		if match[0] > lastEnd {
			segments = append(segments, content[lastEnd:match[0]])
		}
		// 添加分隔符本身
		separator := content[match[0]:match[1]]
		if len(segments) > 0 {
			// 将分隔符附加到前一个段落
			segments[len(segments)-1] += separator
		}
		lastEnd = match[1]
	}

	// 添加最后一段内容
	if lastEnd < len(content) {
		remaining := content[lastEnd:]
		if strings.TrimSpace(remaining) != "" {
			segments = append(segments, remaining)
		}
	}

	if len(segments) <= 1 {
		// 实际上无法有效拆分
		return nil
	}

	// 按maxLength组合段落
	var chunks []DocumentChunk
	var currentChunk strings.Builder
	var currentTokens int
	var chunkStartPos int
	currentPos := basePos

	for _, segment := range segments {
		segment = strings.TrimSpace(segment)
		if segment == "" {
			continue
		}

		segmentTokens, _ := s.tokenizer.CountTokens(segment)

		// 如果单个段落就超过最大长度，需要进一步处理
		if segmentTokens > maxLength {
			// 先保存当前累积的块
			if currentChunk.Len() > 0 {
				chunks = append(chunks, DocumentChunk{
					Type:       chunkType,
					Content:    currentChunk.String(),
					StartPos:   chunkStartPos,
					EndPos:     currentPos,
					TokenCount: currentTokens,
				})
				currentChunk.Reset()
				currentTokens = 0
			}

			// 对超长段落递归处理
			subChunks := s.splitBySemanticBoundaries(segment, maxLength, chunkType, currentPos)
			chunks = append(chunks, subChunks...)

			// 更新位置
			currentPos += len(segment)
			chunkStartPos = currentPos
			continue
		}

		// 检查是否可以添加到当前块
		if currentTokens+segmentTokens <= maxLength {
			if currentChunk.Len() == 0 {
				chunkStartPos = currentPos
			} else {
				currentChunk.WriteString(" ")
			}
			currentChunk.WriteString(segment)
			currentTokens += segmentTokens
		} else {
			// 保存当前块
			if currentChunk.Len() > 0 {
				chunks = append(chunks, DocumentChunk{
					Type:       chunkType,
					Content:    currentChunk.String(),
					StartPos:   chunkStartPos,
					EndPos:     currentPos,
					TokenCount: currentTokens,
				})
			}

			// 开始新块
			currentChunk.Reset()
			currentChunk.WriteString(segment)
			currentTokens = segmentTokens
			chunkStartPos = currentPos
		}

		currentPos += len(segment)
	}

	// 保存最后一个块
	if currentChunk.Len() > 0 {
		chunks = append(chunks, DocumentChunk{
			Type:       chunkType,
			Content:    currentChunk.String(),
			StartPos:   chunkStartPos,
			EndPos:     currentPos,
			TokenCount: currentTokens,
		})
	}

	return chunks
}

// splitBySeparatorWithLength 按分隔符分割内容，控制长度
func (s *ChunkerService) splitBySeparatorWithLength(content string, separator string, maxLength int, chunkType string, basePos int) []DocumentChunk {
	if separator == "" {
		// 如果没有分隔符，直接返回整个内容
		tokenCount, _ := s.tokenizer.CountTokens(content)
		return []DocumentChunk{{
			Type:       chunkType,
			Content:    content,
			StartPos:   basePos,
			EndPos:     basePos + len(content),
			TokenCount: tokenCount,
		}}
	}

	var chunks []DocumentChunk
	var currentChunk strings.Builder
	var currentTokens int
	var chunkStartPos int = basePos
	currentPos := 0
	contentLen := len(content)
	sepLen := len(separator)

	for currentPos < contentLen {
		// 找到下一个分隔符的位置
		nextSep := strings.Index(content[currentPos:], separator)
		if nextSep == -1 {
			// 没有更多分隔符，处理剩余内容
			remaining := content[currentPos:]
			remainingTokens, _ := s.tokenizer.CountTokens(remaining)

			// 如果当前块加上剩余内容会超过最大长度，先保存当前块
			if currentTokens+remainingTokens > maxLength && currentChunk.Len() > 0 {
				chunkContent := currentChunk.String()
				chunks = append(chunks, DocumentChunk{
					Type:       chunkType,
					Content:    chunkContent,
					StartPos:   chunkStartPos,
					EndPos:     chunkStartPos + len(chunkContent),
					TokenCount: currentTokens,
				})
				// 重置当前块
				currentChunk.Reset()
				currentTokens = 0
				chunkStartPos = currentPos + basePos
			}

			// 添加剩余内容
			currentChunk.WriteString(remaining)
			currentTokens += remainingTokens
			break
		}

		// 计算分隔符的实际结束位置
		sepEndPos := currentPos + nextSep + sepLen

		// 提取内容部分（包含分隔符）
		part := content[currentPos:sepEndPos]
		partTokens, _ := s.tokenizer.CountTokens(part)

		// 对于中英文标点符号，确保分割后的内容完整
		// 如果分隔符是标点符号，检查后面是否紧跟空格或中文字符
		if s.isPunctuationSeparator(separator) {
			// 对于标点符号，确保不会在不合适的位置分割
			if sepEndPos < contentLen {
				// 如果是英文标点后跟空格，考虑将空格也包含进来
				if s.isEnglishPunctuation(separator) && strings.HasPrefix(content[sepEndPos:], " ") {
					part += " "
					sepEndPos++
				}
			}
			// 重新计算token数（因为可能修改了part）
			partTokens, _ = s.tokenizer.CountTokens(part)
		}

		// 如果当前块加上这个部分会超过最大长度，先保存当前块
		if currentTokens+partTokens > maxLength && currentChunk.Len() > 0 {
			chunkContent := currentChunk.String()
			chunks = append(chunks, DocumentChunk{
				Type:       chunkType,
				Content:    chunkContent,
				StartPos:   chunkStartPos,
				EndPos:     chunkStartPos + len(chunkContent),
				TokenCount: currentTokens,
			})
			// 重置当前块
			currentChunk.Reset()
			currentTokens = 0
			chunkStartPos = currentPos + basePos
		}

		// 添加当前部分到当前块
		currentChunk.WriteString(part)
		currentTokens += partTokens
		currentPos = sepEndPos
	}

	// 添加最后一个块
	if currentChunk.Len() > 0 {
		chunkContent := currentChunk.String()
		chunks = append(chunks, DocumentChunk{
			Type:       chunkType,
			Content:    chunkContent,
			StartPos:   chunkStartPos,
			EndPos:     chunkStartPos + len(chunkContent),
			TokenCount: currentTokens,
		})
	}

	return chunks
}

// isPunctuationSeparator 判断分隔符是否为标点符号
func (s *ChunkerService) isPunctuationSeparator(separator string) bool {
	punctuationSeparators := []string{
		"。", ".", "！", "!", "？", "?", "；", ";", "，", ",", "：", ":", "、", "·",
	}
	for _, p := range punctuationSeparators {
		if separator == p {
			return true
		}
	}
	return false
}

// isEnglishPunctuation 判断分隔符是否为英文标点符号
func (s *ChunkerService) isEnglishPunctuation(separator string) bool {
	englishPunctuation := []string{".", "!", "?", ";", ",", ":"}
	for _, p := range englishPunctuation {
		if separator == p {
			return true
		}
	}
	return false
}

// addOverlaps 添加重叠
func (s *ChunkerService) addOverlaps(chunks []DocumentChunk, config *ChunkConfig) {
	if len(chunks) <= 1 {
		return
	}

	overlapSize := config.KnowledgeOverlapSize
	if config.IndexOverlapSize > overlapSize {
		overlapSize = config.IndexOverlapSize
	}

	if overlapSize <= 0 {
		return
	}

	for i := range chunks {
		if i > 0 {
			// 添加前一个分块的结尾
			prevTail := s.getTextTail(chunks[i-1].Content, overlapSize)
			if prevTail != "" {
				chunks[i].Content = prevTail + "\n\n" + chunks[i].Content
			}
		}

		if i < len(chunks)-1 {
			// 添加下一个分块的开头
			nextHead := s.getTextHead(chunks[i+1].Content, overlapSize)
			if nextHead != "" {
				chunks[i].Content = chunks[i].Content + "\n\n" + nextHead
			}
		}

		// 重新计算Token数量
		chunks[i].TokenCount, _ = s.tokenizer.CountTokens(chunks[i].Content)
	}
}

// getTextHead 获取文本开头
func (s *ChunkerService) getTextHead(text string, maxTokens int) string {
	if text == "" || maxTokens <= 0 {
		return ""
	}

	words := strings.Fields(text)
	var result strings.Builder
	var tokenCount int

	for _, word := range words {
		wordTokens, _ := s.tokenizer.CountTokens(word)
		if tokenCount+wordTokens > maxTokens {
			break
		}

		if result.Len() > 0 {
			result.WriteString(" ")
		}
		result.WriteString(word)
		tokenCount += wordTokens
	}

	return result.String()
}

// getTextTail 获取文本结尾
func (s *ChunkerService) getTextTail(text string, maxTokens int) string {
	if text == "" || maxTokens <= 0 {
		return ""
	}

	words := strings.Fields(text)
	var result []string
	var tokenCount int

	for i := len(words) - 1; i >= 0; i-- {
		wordTokens, _ := s.tokenizer.CountTokens(words[i])
		if tokenCount+wordTokens > maxTokens {
			break
		}

		result = append([]string{words[i]}, result...)
		tokenCount += wordTokens
	}

	return strings.Join(result, " ")
}

// splitLargeContentBySystemSeparators 使用系统自定义分隔符分割超长内容
func (s *ChunkerService) splitLargeContentBySystemSeparators(content string, maxLength int, chunkType string, basePos int) []DocumentChunk {
	// 系统预定义的分隔符，按优先级排序（从高到低）
	systemSeparators := []string{
		"\n\n", // 段落分隔符
		"\n",   // 行分隔符
		"。",    // 中文句号
		".",    // 英文句号
		"！",    // 中文感叹号
		"!",    // 英文感叹号
		"？",    // 中文问号
		"?",    // 英文问号
		"；",    // 中文分号
		";",    // 英文分号
		"，",    // 中文逗号
		",",    // 英文逗号
		" ",    // 空格
	}

	// 尝试每个分隔符
	for _, separator := range systemSeparators {
		if strings.Contains(content, separator) {
			chunks := s.splitBySeparatorWithLength(content, separator, maxLength, chunkType, basePos)
			if len(chunks) > 1 {
				// 检查是否所有分块都在合理范围内
				allValid := true
				for _, chunk := range chunks {
					if chunk.TokenCount > maxLength*2 { // 允许一定的超出
						allValid = false
						break
					}
				}
				if allValid {
					return chunks
				}
			}
		}
	}

	// 如果所有分隔符都无效，使用tokenizer强制拆分
	return s.splitLargeContent(content, maxLength, chunkType, basePos)
}
