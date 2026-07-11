package rag

import (
	"strings"
)

// chunkByRule 按规则分块(分片)（支持单个分割符，向后兼容）
func (s *ChunkerService) chunkByRule(parsed *ParsedContent, rule string, maxLength int, chunkType string) []DocumentChunk {
	var chunks []DocumentChunk

	switch rule {
	case "", "none":
		// 空字符串或"none"都表示不拆分，将整个文档作为一个分块
		chunks = s.chunkAsWhole(parsed, chunkType)
	case "h1", "h2", "h3", "h4", "h5", "h6":
		chunks = s.chunkByHeaders(parsed, rule, maxLength, chunkType)
	case "paragraph":
		chunks = s.chunkBySeparator(parsed, "\n\n", maxLength, chunkType)
	case "\n", "\\n":
		chunks = s.chunkBySeparator(parsed, "\n", maxLength, chunkType)
	case "sentence":
		chunks = s.chunkBySentences(parsed, maxLength, chunkType)
	default:
		chunks = s.chunkBySeparator(parsed, rule, maxLength, chunkType)
	}

	return chunks
}

// chunkByRules 按多个规则分块（支持多个分割符）
func (s *ChunkerService) chunkByRules(parsed *ParsedContent, chunkMode string, rules []string, maxLength int, chunkType string) []DocumentChunk {
	return s.chunkByRulesWithContext(parsed, chunkMode, rules, maxLength, chunkType)
}

// chunkByRulesWithContext 带上下文的通用分块方法
func (s *ChunkerService) chunkByRulesWithContext(parsed *ParsedContent, chunkMode string, rules []string, maxLength int, chunkType string) []DocumentChunk {
	if len(rules) == 0 {
		return s.chunkAsWhole(parsed, chunkType)
	}
	if chunkMode == ChunkModelIdentifierFirst {
		// 标识符优先
		if len(rules) == 1 {
			// 只有一个规则时，使用原有的单规则函数
			return s.chunkByRule(parsed, rules[0], maxLength, chunkType)
		}

		// 多个分割符时，使用多个分隔符分块
		return s.chunkByMultipleSeparators(parsed, rules, maxLength, chunkType)

	} else {
		return s.chunkByRuleV2(parsed, rules, maxLength, chunkType)
	}
}

// ChunkByRulesForRetrieval 为检索场景提供的公开分块方法
func (s *ChunkerService) ChunkByRulesForRetrieval(content string, chunkMode string, rules []string, maxLength int) []string {
	// 创建模拟的 ParsedContent
	paragraphs := make([]ParagraphInfo, 0)
	paragraphs = append(paragraphs, ParagraphInfo{
		Content:  content,
		Position: 0,
		EndPos:   0,
	})
	parsed := &ParsedContent{
		Content:    content,
		Paragraphs: paragraphs,
	}
	// 复用现有的分块逻辑
	documentChunks := s.chunkByRulesWithContext(parsed, chunkMode, rules, maxLength, "retrieval")

	// 提取纯文本内容
	chunks := make([]string, len(documentChunks))
	for i, chunk := range documentChunks {
		chunks[i] = chunk.Content
	}

	return chunks
}

// 第二版本的分片｜分块
// 1. 标题，标题作为段落休止符，如果遇到下一个目标标题，则把前面的内容作为一块
// 2. 其他分割符，遇到了按分割符分割
// 3. 循环这些分片，再按最大分割长度，如果超长则强制分割，如果不够长则补充到一起（注意有标题的不能强制补在一起）
func (s *ChunkerService) chunkByRuleV2(parsed *ParsedContent, separators []string, maxLength int, chunkType string) []DocumentChunk {
	// 分离标题分隔符和普通分隔符
	headerSeparators := []string{}
	regularSeparators := []string{}

	for _, sep := range separators {
		if s.isHeaderSeparator(sep) {
			headerSeparators = append(headerSeparators, sep)
		} else {
			regularSeparators = append(regularSeparators, sep)
		}
	}

	// 第一步：按标题进行初步分块
	var initialChunks []DocumentChunk
	if len(headerSeparators) > 0 {
		initialChunks = s.chunkByHeadersWithMultipleLevels(parsed, headerSeparators, maxLength, chunkType)
	} else {
		// 没有标题分隔符，将整个内容作为初始分块
		content := strings.TrimSpace(parsed.Content)
		if content == "" {
			return []DocumentChunk{}
		}

		tokenCount, _ := s.tokenizer.CountTokens(content)
		initialChunks = []DocumentChunk{
			{
				Type:       chunkType,
				Content:    content,
				StartPos:   0,
				EndPos:     len(parsed.Content),
				TokenCount: tokenCount,
			},
		}
	}

	// 第二步：对初始分块应用普通分隔符
	finalChunks := initialChunks
	for _, separator := range regularSeparators {
		// 跳过对已有标题的分块应用行分隔符，避免破坏标题结构
		var chunksToSplit []DocumentChunk
		var headerChunks []DocumentChunk

		for _, chunk := range finalChunks {
			if s.contentHasHeader(chunk.Content) {
				headerChunks = append(headerChunks, chunk)
			} else {
				chunksToSplit = append(chunksToSplit, chunk)
			}
		}

		// 只对无标题的分块应用分隔符
		if len(chunksToSplit) > 0 {
			splitChunks := s.applySeparatorToChunks(chunksToSplit, separator, maxLength, chunkType)
			// 合并标题分块和分割后的分块，保持顺序
			finalChunks = s.mergeChunksPreservingOrder(headerChunks, splitChunks)
		}
	}

	// 第三步：按最大长度处理分片 - 超长则强制分割，不够长则合并（有标题的不能强制合并）
	return s.mergeAndSplitChunks(finalChunks, maxLength, chunkType)
}

// mergeAndSplitChunks 合并和分割分片，确保每个分块长度合适
// 规则：超长则强制分割，不够长则合并（有标题的分片不能强制合并）
func (s *ChunkerService) mergeAndSplitChunks(chunks []DocumentChunk, maxLength int, chunkType string) []DocumentChunk {
	if len(chunks) == 0 {
		return chunks
	}

	var result []DocumentChunk
	var currentMerge *DocumentChunk // 当前正在合并的分块

	for _, chunk := range chunks {
		// 如果分块超长，直接分割
		if chunk.TokenCount > maxLength {
			// 如果有正在合并的分块，先保存它
			if currentMerge != nil {
				result = append(result, *currentMerge)
				currentMerge = nil
			}

			// 分割当前超长分块
			subChunks := s.splitLargeContentBySystemSeparators(chunk.Content, maxLength, chunkType, chunk.StartPos)
			result = append(result, subChunks...)
			continue
		}

		// 检查分块是否包含标题（通过简单判断是否包含 # 符号）
		hasHeader := s.contentHasHeader(chunk.Content)

		// 如果当前没有正在合并的分块
		if currentMerge == nil {
			if hasHeader || chunk.TokenCount >= maxLength*2/3 {
				// 有标题或长度够长的分块单独作为一块
				result = append(result, chunk)
			} else {
				// 开始新的合并
				currentMerge = &chunk
			}
			continue
		}

		// 当前有正在合并的分块
		if hasHeader {
			// 当前分块有标题，不能合并，先保存现有合并块
			result = append(result, *currentMerge)
			currentMerge = nil
			// 单独处理这个有标题的分块
			if chunk.TokenCount >= maxLength*2/3 {
				result = append(result, chunk)
			} else {
				currentMerge = &chunk
			}
		} else {
			// 当前分块没有标题，尝试合并
			mergedContent := currentMerge.Content + "\n\n" + chunk.Content
			mergedTokenCount, _ := s.tokenizer.CountTokens(mergedContent)

			if mergedTokenCount <= maxLength {
				// 合并后不超长，更新当前合并块
				currentMerge.Content = mergedContent
				currentMerge.EndPos = chunk.EndPos
				currentMerge.TokenCount = mergedTokenCount
			} else {
				// 合并后会超长，保存当前合并块，当前分块单独处理
				result = append(result, *currentMerge)
				currentMerge = nil

				if chunk.TokenCount >= maxLength*2/3 {
					result = append(result, chunk)
				} else {
					currentMerge = &chunk
				}
			}
		}
	}

	// 处理最后一个正在合并的分块
	if currentMerge != nil {
		result = append(result, *currentMerge)
	}

	return result
}

// contentHasHeader 检查内容是否包含标题
func (s *ChunkerService) contentHasHeader(content string) bool {
	lines := strings.Split(content, "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			return true
		}
	}
	return false
}

// isHeaderSeparator 判断是否为标题分隔符
func (s *ChunkerService) isHeaderSeparator(separator string) bool {
	switch separator {
	case "h1", "h2", "h3", "h4", "h5", "h6":
		return true
	default:
		return false
	}
}

// chunkByHeadersWithMultipleLevels 支持多级标题的分块方法
// 处理多个标题级别，以最高级别的标题作为分块标准（数字最小的）
func (s *ChunkerService) chunkByHeadersWithMultipleLevels(parsed *ParsedContent, headerLevels []string, maxLength int, chunkType string) []DocumentChunk {
	if len(headerLevels) == 0 {
		return s.chunkAsWhole(parsed, chunkType)
	}

	// 找到目标标题级别中的最高级别（数字最小的）
	maxLevel := 0
	for _, headerLevel := range headerLevels {
		level := s.getHeaderLevel(headerLevel)
		if level > maxLevel {
			maxLevel = level
		}
	}

	// 如果只指定了h3，但文档中只有h1和h2，应该使用最匹配的（最接近的）级别
	// 所以我们检查文档中是否存在指定级别的标题，如果没有，使用最接近的更高级别
	return s.chunkByHeadersWithBestMatch(parsed, headerLevels, maxLevel, maxLength, chunkType)
}

// getHeaderString 根据级别返回标题字符串
func (s *ChunkerService) getHeaderString(level int) string {
	switch level {
	case 1:
		return "h1"
	case 2:
		return "h2"
	case 3:
		return "h3"
	case 4:
		return "h4"
	case 5:
		return "h5"
	case 6:
		return "h6"
	default:
		return "h6" // 默认返回h6
	}
}

// chunkAsWhole 将整个文档作为一个分块（不拆分）
func (s *ChunkerService) chunkAsWhole(parsed *ParsedContent, chunkType string) []DocumentChunk {
	// 将所有内容合并为一个分块
	var allContent strings.Builder

	// 合并所有段落内容
	for _, paragraph := range parsed.Paragraphs {
		if allContent.Len() > 0 {
			allContent.WriteString("\n\n")
		}
		allContent.WriteString(paragraph.Content)
	}

	content := allContent.String()
	if content == "" {
		return []DocumentChunk{} // 如果没有内容，返回空分块
	}

	// 计算token数量
	tokenCount, err := s.tokenizer.CountTokens(content)
	if err != nil {
		tokenCount = len(content) / 4 // 简单估算
	}

	return []DocumentChunk{
		{
			Index:      0,
			Type:       chunkType,
			Content:    content,
			StartPos:   0,
			EndPos:     len(content),
			TokenCount: tokenCount,
		},
	}
}

// chunkByHeaders 按标题分块
// 根据需求：每次从头开始拆，发现指定级别的标题后，把标题前的一整个归为一块，不包括最后找到的标题
func (s *ChunkerService) chunkByHeaders(parsed *ParsedContent, headerLevel string, maxLength int, chunkType string) []DocumentChunk {
	targetLevel := s.getHeaderLevel(headerLevel)
	var chunks []DocumentChunk

	// 找到目标级别或更高级别的标题
	var targetHeaders []HeaderInfo
	for _, header := range parsed.Headers {
		if header.Level <= targetLevel {
			targetHeaders = append(targetHeaders, header)
		}
	}

	// 如果没有找到任何标题，按段落分块
	if len(targetHeaders) == 0 {
		return s.chunkByParagraphs(parsed, maxLength, chunkType)
	}

	// 按照需求进行拆分：标题和其内容作为一个分块，遇到下一个目标标题时结束当前分块
	for i, header := range targetHeaders {
		var sectionEndPos int
		if i < len(targetHeaders)-1 {
			// 如果不是最后一个标题，以下一个标题位置作为结束位置
			sectionEndPos = targetHeaders[i+1].Position
		} else {
			// 如果是最后一个标题，以文档结束位置作为结束位置
			sectionEndPos = len(parsed.Content)
		}

		// 提取从当前标题开始到下一个标题之前的所有内容（包括标题本身）
		fullContent := strings.TrimSpace(parsed.Content[header.Position:sectionEndPos])

		if fullContent != "" {
			tokenCount, _ := s.tokenizer.CountTokens(fullContent)
			if tokenCount <= maxLength {
				chunks = append(chunks, DocumentChunk{
					Type:       chunkType,
					Content:    fullContent,
					StartPos:   header.Position,
					EndPos:     sectionEndPos,
					TokenCount: tokenCount,
				})
			} else {
				// 内容过长，使用系统自定义分隔符进一步分割，但保留标题
				subChunks := s.splitLargeContentBySystemSeparators(fullContent, maxLength, chunkType, header.Position)
				chunks = append(chunks, subChunks...)
			}
		}
	}

	// 处理第一个标题之前的内容（如果存在）
	if len(targetHeaders) > 0 && targetHeaders[0].Position > 0 {
		prefaceContent := strings.TrimSpace(parsed.Content[0:targetHeaders[0].Position])
		if prefaceContent != "" {
			tokenCount, _ := s.tokenizer.CountTokens(prefaceContent)
			if tokenCount <= maxLength {
				chunks = append([]DocumentChunk{{
					Type:       chunkType,
					Content:    prefaceContent,
					StartPos:   0,
					EndPos:     targetHeaders[0].Position,
					TokenCount: tokenCount,
				}}, chunks...)
			} else {
				// 内容过长，使用系统自定义分隔符进一步分割
				subChunks := s.splitLargeContentBySystemSeparators(prefaceContent, maxLength, chunkType, 0)
				chunks = append(subChunks, chunks...)
			}
		}
	}

	// 后处理：将单独的标题块合并到下一个分块中
	chunks = s.mergeIsolatedTitleChunks(chunks, targetLevel)

	return chunks
}

// mergeIsolatedTitleChunks 将单独的标题块合并到下一个分块中
// 解决当使用较低级别标题分块时，较高级别标题被单独分成一块的问题
func (s *ChunkerService) mergeIsolatedTitleChunks(chunks []DocumentChunk, targetLevel int) []DocumentChunk {
	if len(chunks) <= 1 {
		return chunks
	}

	var result []DocumentChunk

	for i := 0; i < len(chunks); i++ {
		current := chunks[i]

		// 检查当前分块是否是一个单独的标题，且标题级别高于目标级别
		if s.isIsolatedHigherTitle(current, targetLevel) && i < len(chunks)-1 {
			// 合并到下一个分块
			next := chunks[i+1]
			mergedContent := current.Content + "\n\n" + next.Content
			mergedTokenCount, _ := s.tokenizer.CountTokens(mergedContent)

			result = append(result, DocumentChunk{
				Type:       current.Type,
				Content:    mergedContent,
				StartPos:   current.StartPos,
				EndPos:     next.EndPos,
				TokenCount: mergedTokenCount,
			})

			// 跳过下一个分块，因为已经合并了
			i++
		} else {
			// 直接添加当前分块
			result = append(result, current)
		}
	}

	return result
}

// isIsolatedHigherTitle 检查分块是否是单独的更高级别标题
func (s *ChunkerService) isIsolatedHigherTitle(chunk DocumentChunk, targetLevel int) bool {
	// 检查内容是否主要由标题构成
	lines := strings.Split(strings.TrimSpace(chunk.Content), "\n")
	if len(lines) == 0 {
		return false
	}

	// 统计标题行和非标题行
	titleLines := 0
	nonTitleLines := 0

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "#") {
			titleLines++
			// 检查标题级别是否高于目标级别（数字更小）
			level := s.getHeaderLevelFromLine(trimmed)
			if level > 0 && level < targetLevel {
				// 找到更高级别的标题
				continue
			}
		} else {
			nonTitleLines++
		}
	}

	// 如果主要是标题且标题级别高于目标级别，且无实质内容，则认为是单独的标题块
	// 条件 nonTitleLines < titleLines 确保有实质性内容的块不会被合并
	return titleLines > 0 && nonTitleLines < titleLines
}

// getHeaderLevelFromLine 从文本行中提取标题级别
func (s *ChunkerService) getHeaderLevelFromLine(line string) int {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "#") {
		return 0
	}

	level := 0
	for _, char := range trimmed {
		if char == '#' {
			level++
		} else {
			break
		}
	}

	return level
}

// chunkByParagraphs 按段落分块
func (s *ChunkerService) chunkByParagraphs(parsed *ParsedContent, maxLength int, chunkType string) []DocumentChunk {
	var chunks []DocumentChunk
	var currentChunk strings.Builder
	var currentTokens int
	var startPos int

	for _, paragraph := range parsed.Paragraphs {
		paragraphTokens, _ := s.tokenizer.CountTokens(paragraph.Content)

		if currentTokens+paragraphTokens <= maxLength {
			if currentChunk.Len() == 0 {
				startPos = paragraph.Position
			} else {
				currentChunk.WriteString("\n\n")
			}
			currentChunk.WriteString(paragraph.Content)
			currentTokens += paragraphTokens
		} else {
			// 保存当前分块
			if currentChunk.Len() > 0 {
				chunks = append(chunks, DocumentChunk{
					Type:       chunkType,
					Content:    currentChunk.String(),
					StartPos:   startPos,
					EndPos:     paragraph.Position,
					TokenCount: currentTokens,
				})
			}

			// 检查单个段落是否过长
			if paragraphTokens > maxLength {
				subChunks := s.splitLargeContent(paragraph.Content, maxLength, chunkType, paragraph.Position)
				chunks = append(chunks, subChunks...)
				currentChunk.Reset()
				currentTokens = 0
			} else {
				currentChunk.Reset()
				currentChunk.WriteString(paragraph.Content)
				currentTokens = paragraphTokens
				startPos = paragraph.Position
			}
		}
	}

	// 保存最后一个分块
	if currentChunk.Len() > 0 {
		chunks = append(chunks, DocumentChunk{
			Type:       chunkType,
			Content:    currentChunk.String(),
			StartPos:   startPos,
			EndPos:     len(parsed.Content),
			TokenCount: currentTokens,
		})
	}

	return chunks
}

// chunkByMultipleSeparators 按多个分隔符分块
// 递归模式：依次使用每个分隔符对已有分块进行进一步分割
func (s *ChunkerService) chunkByMultipleSeparators(parsed *ParsedContent, separators []string, maxLength int, chunkType string) []DocumentChunk {
	// 如果没有分隔符，整个内容作为一块
	if len(separators) == 0 {
		return s.chunkAsWhole(parsed, chunkType)
	}

	// 从初始内容开始
	initialChunks := []DocumentChunk{{
		Type:       chunkType,
		Content:    strings.TrimSpace(parsed.Content),
		StartPos:   0,
		EndPos:     len(parsed.Content),
		TokenCount: 0, // 稍后计算
	}}

	// 计算初始token数
	tokenCount, _ := s.tokenizer.CountTokens(initialChunks[0].Content)
	initialChunks[0].TokenCount = tokenCount

	// 依次对每个分隔符进行分块处理
	currentChunks := initialChunks
	for _, separator := range separators {
		currentChunks = s.applySeparatorToChunks(currentChunks, separator, maxLength, chunkType)
	}

	// 检查是否成功进行了拆分，如果没有则使用最大长度强制拆分
	if len(currentChunks) == 0 {
		// 使用系统自定义分隔符分割超长内容
		return s.splitLargeContentBySystemSeparators(parsed.Content, maxLength, chunkType, 0)
	}

	return currentChunks
}

// applySeparatorToChunks 对现有分块集合应用指定分隔符进行进一步分割
func (s *ChunkerService) applySeparatorToChunks(chunks []DocumentChunk, separator string, maxLength int, chunkType string) []DocumentChunk {
	var resultChunks []DocumentChunk

	// 预处理分隔符
	processedSep := separator
	if strings.HasPrefix(separator, "\\n") {
		processedSep = strings.ReplaceAll(separator, "\\n", "\n")
	}

	for _, chunk := range chunks {
		// 如果分块内容为空，直接保留
		if strings.TrimSpace(chunk.Content) == "" {
			resultChunks = append(resultChunks, chunk)
			continue
		}

		// 使用单个分隔符对当前分块的内容进行分块
		subChunks := s.chunkContentBySeparator(chunk.Content, processedSep, maxLength, chunkType)

		// 调整子分块的位置信息
		for i := range subChunks {
			subChunks[i].StartPos += chunk.StartPos
			subChunks[i].EndPos += chunk.StartPos
		}

		resultChunks = append(resultChunks, subChunks...)
	}

	return resultChunks
}

// mergeChunksPreservingOrder 合并标题分块和分割分块，保持原始顺序
func (s *ChunkerService) mergeChunksPreservingOrder(headerChunks, splitChunks []DocumentChunk) []DocumentChunk {
	var result []DocumentChunk

	// 简化处理：先添加所有标题分块，再添加分割后的分块
	// 这样可以避免复杂的顺序计算，且在实际使用中效果更好
	result = append(result, headerChunks...)
	result = append(result, splitChunks...)

	return result
}

// chunkByHeadersWithBestMatch 使用最佳匹配策略进行标题分块
func (s *ChunkerService) chunkByHeadersWithBestMatch(parsed *ParsedContent, headerLevels []string, maxLevel int, maxLength int, chunkType string) []DocumentChunk {
	// 首先检查文档中是否存在指定级别的标题
	documentLevels := make(map[int]bool)
	for _, header := range parsed.Headers {
		documentLevels[header.Level] = true
	}

	// 检查是否有完全匹配的标题级别
	hasDirectMatch := false
	for _, headerLevel := range headerLevels {
		level := s.getHeaderLevel(headerLevel)
		if documentLevels[level] {
			hasDirectMatch = true
			break
		}
	}

	// 如果有完全匹配，使用现有的chunkByHeaders方法处理每个指定级别
	if hasDirectMatch {
		return s.chunkByHeadersWithMultipleMatches(parsed, headerLevels, maxLength, chunkType)
	}

	// 如果没有完全匹配，使用最接近的级别（优先使用指定级别本身）
	// 例如：指定h2但有h1,h2，应该使用h2（指定的级别）
	bestMatchLevel := 0
	for _, headerLevel := range headerLevels {
		targetLevel := s.getHeaderLevel(headerLevel)
		// 首先检查目标级别本身是否存在
		if documentLevels[targetLevel] {
			bestMatchLevel = targetLevel
			break
		}
		// 如果目标级别不存在，才寻找最接近的更高级别
		for docLevel := range documentLevels {
			if docLevel <= targetLevel && docLevel > bestMatchLevel {
				bestMatchLevel = docLevel
			}
		}
	}

	// 如果找到了匹配的级别，使用该级别
	if bestMatchLevel > 0 {
		return s.chunkByHeaders(parsed, s.getHeaderString(bestMatchLevel), maxLength, chunkType)
	}

	// 如果没有任何匹配，回退到最高级标题
	return s.chunkByHeaders(parsed, s.getHeaderString(1), maxLength, chunkType)
}

// chunkByHeadersWithMultipleMatches 处理多个级别都有匹配的情况
func (s *ChunkerService) chunkByHeadersWithMultipleMatches(parsed *ParsedContent, headerLevels []string, maxLength int, chunkType string) []DocumentChunk {
	var targetLevels []int
	for _, headerLevel := range headerLevels {
		level := s.getHeaderLevel(headerLevel)
		targetLevels = append(targetLevels, level)
	}

	// 使用最严格的级别（最高级别数字）
	strictestLevel := 6
	for _, level := range targetLevels {
		if level < strictestLevel {
			strictestLevel = level
		}
	}

	return s.chunkByHeaders(parsed, s.getHeaderString(strictestLevel), maxLength, chunkType)
}

// chunkContentBySeparator 对内容使用指定分隔符进行分块
func (s *ChunkerService) chunkContentBySeparator(content string, separator string, maxLength int, chunkType string) []DocumentChunk {
	// 创建一个临时的 ParsedContent
	tempParsed := &ParsedContent{
		Content: content,
	}

	// 解析临时内容（获取标题信息）
	tempParsed.Headers = s.extractHeaders(content)

	// 使用现有的 chunkByRule 方法
	return s.chunkByRule(tempParsed, separator, maxLength, chunkType)
}

// chunkBySeparator 按指定分隔符分块
// 根据需求：每次从头开始拆，发现指定分隔符后，把的元素列为一块，包括找到的分隔符
func (s *ChunkerService) chunkBySeparator(parsed *ParsedContent, separator string, maxLength int, chunkType string) []DocumentChunk {
	var chunks []DocumentChunk
	content := parsed.Content

	// 如果分隔符以两个反斜杠开头，则改为一个反斜杠
	if strings.HasPrefix(separator, "\\n") {
		separator = strings.ReplaceAll(separator, "\\n", "\n")
	}

	// 使用正则表达式找到所有分隔符的位置
	separatorIndices := s.findSeparatorIndices(content, separator)

	if len(separatorIndices) == 0 {
		// 没有找到分隔符，整个内容作为一块
		tokenCount, _ := s.tokenizer.CountTokens(content)
		if tokenCount <= maxLength {
			return []DocumentChunk{{
				Type:       chunkType,
				Content:    strings.TrimSpace(content),
				StartPos:   0,
				EndPos:     len(content),
				TokenCount: tokenCount,
			}}
		} else {
			// 内容过长，使用系统自定义分隔符进一步分割
			return s.splitLargeContentBySystemSeparators(content, maxLength, chunkType, 0)
		}
	}

	// 按照需求进行拆分：每次从头开始拆，发现指定分隔符后，把的元素列为一块，包括找到的分隔符
	lastPos := 0
	for _, sepIndex := range separatorIndices {
		// 包括分隔符在内的内容
		endPos := sepIndex + len(separator)
		sectionContent := content[lastPos:endPos] // 不再使用TrimSpace，保留原始格式

		if strings.TrimSpace(sectionContent) != "" {
			tokenCount, _ := s.tokenizer.CountTokens(sectionContent)
			if tokenCount <= maxLength {
				chunks = append(chunks, DocumentChunk{
					Type:       chunkType,
					Content:    strings.TrimSpace(sectionContent), // 在添加到chunks时再TrimSpace
					StartPos:   lastPos,
					EndPos:     endPos,
					TokenCount: tokenCount,
				})
			} else {
				// 内容过长，使用系统自定义分隔符进一步分割，但保留原始分隔符信息
				subChunks := s.splitLargeContentBySystemSeparators(sectionContent, maxLength, chunkType, lastPos)
				chunks = append(chunks, subChunks...)
			}
		}
		lastPos = endPos
	}

	// 处理最后一个分隔符之后的内容
	if lastPos < len(content) {
		remainingContent := content[lastPos:] // 不再使用TrimSpace，保留原始格式
		if strings.TrimSpace(remainingContent) != "" {
			tokenCount, _ := s.tokenizer.CountTokens(remainingContent)
			if tokenCount <= maxLength {
				chunks = append(chunks, DocumentChunk{
					Type:       chunkType,
					Content:    strings.TrimSpace(remainingContent), // 在添加到chunks时再TrimSpace
					StartPos:   lastPos,
					EndPos:     len(content),
					TokenCount: tokenCount,
				})
			} else {
				// 内容过长，使用系统自定义分隔符进一步分割，但保留原始分隔符信息
				subChunks := s.splitLargeContentBySystemSeparators(remainingContent, maxLength, chunkType, lastPos)
				chunks = append(chunks, subChunks...)
			}
		}
	}

	return chunks
}
