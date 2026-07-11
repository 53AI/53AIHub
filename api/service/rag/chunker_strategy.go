package rag

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/53AI/53AIHub/model"
)

// ChunkStrategy 定义分块策略接口
type ChunkStrategy interface {
	// ProcessChunking 执行具体的分块处理
	ProcessChunking(service *ChunkerService, eid int64, fileID int64, content string, config *ChunkConfig) (*ChunkResult, error)
	// GetType 返回策略类型
	GetType() string
}

// GetChunkStrategy 根据类型获取分块策略
func GetChunkStrategy(chunkType string) ChunkStrategy {
	switch chunkType {
	case model.ChunkTypeDefault:
		return &DefaultChunkStrategy{}
	case model.ChunkTypeQA:
		return &QAChunkStrategy{}
	case model.ChunkTypeDataTable:
		return &DataTableChunkStrategy{}
	case model.ChunkTypeProductPlan:
		return &ProductPlanChunkStrategy{}
	case model.ChunkTypeProductCatalog:
		return &ProductCatalogChunkStrategy{}
	case model.ChunkTypeVideoCourse:
		return &VideoCourseChunkStrategy{}
	default:
		return &DefaultChunkStrategy{}
	}
}

// DefaultChunkStrategy 默认分块策略
type DefaultChunkStrategy struct{}

func (s *DefaultChunkStrategy) GetType() string {
	return model.ChunkTypeDefault
}

func (s *DefaultChunkStrategy) ProcessChunking(service *ChunkerService, eid int64, fileID int64, content string, config *ChunkConfig) (*ChunkResult, error) {
	// 解析文档结构
	parsed := service.parseMarkdown(content)

	// 执行分块
	result := &ChunkResult{
		Chunks:   []DocumentChunk{},
		Warnings: []string{},
		Errors:   []string{},
	}

	// 移除触发条件检查，直接执行分块逻辑
	knowledgeChunks := service.chunkByRules(parsed, config.KnowledgeChunk.ChunkMode, config.KnowledgeChunk.GetSplitRules(), config.KnowledgeMaxLength, "knowledge")

	result.Chunks = append(result.Chunks, knowledgeChunks...)

	// 处理重叠（对所有分块，包括单个分块）
	service.addOverlaps(result.Chunks, config)

	return result, nil
}

// QAChunkStrategy QA类型分块策略
type QAChunkStrategy struct{}

func (s *QAChunkStrategy) GetType() string {
	return model.ChunkTypeQA
}

func (s *QAChunkStrategy) ProcessChunking(service *ChunkerService, eid int64, fileID int64, content string, config *ChunkConfig) (*ChunkResult, error) {
	// QA类型特殊处理 - 严格按照Python代码逻辑实现
	result := &ChunkResult{
		Chunks:   []DocumentChunk{},
		Warnings: []string{},
		Errors:   []string{},
	}

	maxLength := config.KnowledgeMaxLength
	if maxLength <= 0 {
		maxLength = DefaultKnowledgeMaxLength
	}

	// 解析QA对，按照Python代码逻辑实现
	qas := service.parseQAContent(content)
	if len(qas) == 0 {
		result.Warnings = append(result.Warnings, "no_qa_pairs_detected")
	}

	// 为每个QA对创建一个分块
	currentPos := 0
	for _, qa := range qas {
		qaContent := "问题：" + qa.Question + "\n回答：" + qa.Answer
		tokenCount, _ := service.tokenizer.CountTokens(qaContent)

		chunk := DocumentChunk{
			Index:       0, // 索引会在ChunkDocument方法中统一设置
			Type:        "knowledge",
			Content:     qaContent,
			StartPos:    currentPos,
			EndPos:      currentPos + len(qaContent),
			TokenCount:  tokenCount,
			ContentHash: "", // 哈希会在ChunkDocument方法中统一设置
		}
		result.Chunks = append(result.Chunks, chunk)

		// 更新位置，考虑换行符
		currentPos += len(qaContent) + 1

		// 如果单个QA对超过最大长度，需要进一步分块
		if len(qaContent) > maxLength {
			// 对超长的QA对进行分块处理
			subChunks := service.chunkLongQA(qa, maxLength)
			// 替换原来的chunk
			result.Chunks = append(result.Chunks[:len(result.Chunks)-1], subChunks...)

			// 重新计算subChunks的位置信息
			subPos := currentPos - (len(qaContent) + 1) // 回退到QA对开始位置
			for i := range subChunks {
				subChunks[i].StartPos = subPos
				subChunks[i].EndPos = subPos + len(subChunks[i].Content)
				subChunks[i].TokenCount, _ = service.tokenizer.CountTokens(subChunks[i].Content)
				subPos += len(subChunks[i].Content) + 1
			}
			currentPos = subPos
		}
	}

	// QA类型通常不需要重叠处理，因为每个QA对应该是独立完整的
	// 如果需要重叠，可以取消下面的注释
	// service.addOverlaps(result.Chunks, config)

	return result, nil
}

// QA_pair 表示一个问答对
type QA_pair struct {
	Question string
	Answer   string
}

// parseQAContent 解析QA内容
func (s *ChunkerService) parseQAContent(content string) []QA_pair {
	content = strings.TrimSpace(content)
	var qas []QA_pair

	// 基于 DataTableChunkStrategy 的处理方式，先解析表格内容
	rows := s.parseMarkdownTable(content)

	// 对每个表格行执行 QA 解析
	for _, row := range rows {
		// 从表格行中提取 QA 对
		qaPairs := s.parseQAContentFromText(row.Content)
		qas = append(qas, qaPairs...)
	}

	// 如果没有从表格中提取到 QA 对，则尝试直接从原始内容中解析
	if len(qas) == 0 {
		qas = s.parseQAContentFromText(content)
	}

	return qas
}

// parseQAContentFromText 从文本中解析 QA 对
func (s *ChunkerService) parseQAContentFromText(content string) []QA_pair {
	var qas []QA_pair

	normalizePrefix := func(line string) string {
		l := strings.TrimSpace(line)
		for {
			changed := false
			for _, prefix := range []string{"-", "*", "•"} {
				if strings.HasPrefix(l, prefix) {
					l = strings.TrimSpace(strings.TrimPrefix(l, prefix))
					changed = true
				}
			}
			reNum := regexp.MustCompile(`^\d+[.)、]\s*`)
			if reNum.MatchString(l) {
				l = reNum.ReplaceAllString(l, "")
				l = strings.TrimSpace(l)
				changed = true
			}
			if !changed {
				break
			}
		}
		return l
	}

	isQuestionLine := func(line string) (string, bool) {
		l := normalizePrefix(line)
		patterns := []string{
			`^问题\s*[:：]\s*`,
			`^问题\s+\d+\s*[:：]\s*`, // 问题 1：、问题 2: 等带编号的格式（有空格）
			`^问题\d+\s*[:：]\s*`,   // 问题1：、问题2: 等带编号的格式（无空格）
			`^问\s*[:：]\s*`,
			`^问\s+\d+\s*[:：]\s*`, // 问 1：、问 3: 等带编号的格式（有空格）
			`^问\d+\s*[:：]\s*`,   // 问1：、问2: 等带编号的格式（无空格）
			`^Question\s*[:：]\s*`,
			`^[Qq]\s*[:：]\s*`,
			// Markdown 标题格式
			`^#{1,6}\s*[Qq]\s*[:：]\s*`,      // ### Q: 问题
			`^#{1,6}\s*问题\s*[:：]\s*`,     // ### 问题：xxx
			`^#{1,6}\s*问题\s+\d+\s*[:：]\s*`, // ### 问题 1：xxx（有空格）
			`^#{1,6}\s*问题\d+\s*[:：]\s*`,   // ### 问题1：xxx（无空格）
			`^#{1,6}\s*问\s*[:：]\s*`,       // ### 问：xxx
			`^#{1,6}\s*问\s+\d+\s*[:：]\s*`, // ### 问 1：xxx（有空格）
			`^#{1,6}\s*问\d+\s*[:：]\s*`,   // ### 问1：xxx（无空格）
			// 中文方括号格式
			`^【问题】\s*`,                    // 【问题】xxx
			`^【问】\s*`,                      // 【问】xxx
			`^【Q】\s*`,                       // 【Q】xxx
			`^【q】\s*`,                       // 【q】xxx
		}
		for _, p := range patterns {
			re := regexp.MustCompile(p)
			if re.MatchString(l) {
				return strings.TrimSpace(re.ReplaceAllString(l, "")), true
			}
		}
		return "", false
	}

	isAnswerLine := func(line string) (string, bool) {
		l := normalizePrefix(line)
		patterns := []string{
			`^回答话术\s*[:：]\s*`,
			`^回答\s*[:：]\s*`,
			`^答案\s*[:：]\s*`,
			`^答\s*[:：]\s*`,
			`^Answer\s*[:：]\s*`,
			`^[Aa]\s*[:：]\s*`,
			// 专家答复/回答/回复格式
			`^专家答复\s*[:：]\s*`,       // 专家答复：xxx
		`^专家回答\s*[:：]\s*`,       // 专家回答：xxx
		`^专家回复\s*[:：]\s*`,       // 专家回复：xxx
		`^答复\s*[:：]\s*`,            // 答复：xxx
		`^解答\s*[:：]\s*`,            // 解答：xxx
			// Markdown 加粗格式
			`^\*\*[Aa]\s*[:：]\*\*\s*`,                     // **A:** 回答
			`^\*\*回答话术\s*[:：]\*\*\s*`,                // **回答话术:** 回答
			`^\*\*回答\s*[:：]\*\*\s*`,                    // **回答:** 回答
			`^\*\*答案\s*[:：]\*\*\s*`,                    // **答案:** 回答
			`^\*\*答\s*[:：]\*\*\s*`,                      // **答:** 回答
			`^\*\*专家答复\s*[:：]\*\*\s*`,                // **专家答复:** 回答
			`^\*\*专家回答\s*[:：]\*\*\s*`,                // **专家回答:** 回答
			`^\*\*答复\s*[:：]\*\*\s*`,                     // **答复:** 回答
			`^\*\*解答\s*[:：]\*\*\s*`,                     // **解答:** 回答
			// 中文方括号格式
			`^【回答】\s*`,                                  // 【回答】xxx
			`^【答案】\s*`,                                  // 【答案】xxx
			`^【答】\s*`,                                    // 【答】xxx
			`^【A】\s*`,                                     // 【A】xxx
			`^【a】\s*`,                                     // 【a】xxx
			`^【专家答复】\s*`,                              // 【专家答复】xxx
			`^【专家回答】\s*`,                              // 【专家回答】xxx
			`^【专家回复】\s*`,                              // 【专家回复】xxx
			`^【答复】\s*`,                                  // 【答复】xxx
			`^【解答】\s*`,                                  // 【解答】xxx
		}
		for _, p := range patterns {
			re := regexp.MustCompile(p)
			if re.MatchString(l) {
				return strings.TrimSpace(re.ReplaceAllString(l, "")), true
			}
		}
		return "", false
	}

	lines := strings.Split(content, "\n")
	var currentQ string
	var currentA []string
	flush := func() {
		q := strings.TrimSpace(currentQ)
		a := strings.TrimSpace(strings.Join(currentA, "\n"))
		if q != "" && a != "" {
			qas = append(qas, QA_pair{Question: q, Answer: a})
		}
		currentQ = ""
		currentA = nil
	}

	for _, raw := range lines {
		line := strings.TrimRight(raw, "\r")
		if q, ok := isQuestionLine(line); ok {
			if currentQ != "" {
				flush()
			}
			currentQ = q
			currentA = nil
			continue
		}
		if a, ok := isAnswerLine(line); ok {
			if currentQ == "" {
				continue
			}
			if a != "" {
				currentA = append(currentA, a)
			}
			continue
		}
		if currentQ != "" && len(currentA) > 0 {
			trimmed := strings.TrimSpace(line)
			if trimmed != "" {
				currentA = append(currentA, trimmed)
			}
		}
	}
	if currentQ != "" {
		flush()
	}

	if len(qas) > 0 {
		return qas
	}

	normalized := strings.TrimSpace(content)
	normalized = regexp.MustCompile(`(?m)^\s*(?:[-*•]\s*)*`).ReplaceAllString(normalized, "")
	normalized = regexp.MustCompile(`(?m)^\s*\d+[.)、]\s*`).ReplaceAllString(normalized, "")
	normalized = regexp.MustCompile(`(?m)^(?:问题|问|Question|[Qq])(?:\s+\d+)?\s*[:：]\s*`).ReplaceAllString(normalized, "问题：")
	normalized = regexp.MustCompile(`(?m)^(?:(?:回答话术|回答|答案|答|Answer|[Aa])|(?:专家答复|专家回答|答复|解答))\s*[:：]\s*`).ReplaceAllString(normalized, "回答：")

	qaPattern := regexp.MustCompile(`问题：(.*?)(?:\n|\s+)回答：((?s).*?)(?:\n问题：|\z)`)
	matches := qaPattern.FindAllStringSubmatch(normalized, -1)
	for _, match := range matches {
		if len(match) < 3 {
			continue
		}
		question := strings.TrimSpace(match[1])
		answer := strings.TrimSpace(match[2])
		if question != "" && answer != "" {
			qas = append(qas, QA_pair{Question: question, Answer: answer})
		}
	}

	return qas
}

// chunkLongQA 对过长的QA对进行分块处理
func (s *ChunkerService) chunkLongQA(qa QA_pair, maxLength int) []DocumentChunk {
	var chunks []DocumentChunk

	// 构造完整内容
	fullContent := "问题：" + qa.Question + "\n回答：" + qa.Answer

	// 如果整体不超长，直接作为一个块
	if len(fullContent) <= maxLength {
		tokenCount, _ := s.tokenizer.CountTokens(fullContent)
		chunk := DocumentChunk{
			Index:       0,
			Type:        "knowledge",
			Content:     fullContent,
			StartPos:    0,
			EndPos:      len(fullContent),
			TokenCount:  tokenCount,
			ContentHash: "",
		}
		return []DocumentChunk{chunk}
	}

	// 超长情况处理 - 简单按最大长度分割
	// 这里我们尝试保持问题完整，答案可以分割
	questionPart := "问题：" + qa.Question
	answerPart := "回答：" + qa.Answer

	// 跟踪当前位置
	currentPos := 0

	// 如果问题本身就超长了，需要分割问题
	if len(questionPart) > maxLength {
		// 分割问题部分
		questionChunks := s.splitTextByLength(questionPart, maxLength)
		for _, qChunk := range questionChunks {
			tokenCount, _ := s.tokenizer.CountTokens(qChunk)
			chunk := DocumentChunk{
				Index:       0,
				Type:        "knowledge",
				Content:     qChunk,
				StartPos:    currentPos,
				EndPos:      currentPos + len(qChunk),
				TokenCount:  tokenCount,
				ContentHash: "",
			}
			chunks = append(chunks, chunk)
			currentPos += len(qChunk) + 1 // +1 for newline
		}
	} else {
		// 问题不超长，直接添加
		tokenCount, _ := s.tokenizer.CountTokens(questionPart)
		chunk := DocumentChunk{
			Index:       0,
			Type:        "knowledge",
			Content:     questionPart,
			StartPos:    currentPos,
			EndPos:      currentPos + len(questionPart),
			TokenCount:  tokenCount,
			ContentHash: "",
		}
		chunks = append(chunks, chunk)
		currentPos += len(questionPart) + 1 // +1 for newline
	}

	// 分割答案部分
	if len(answerPart) > maxLength {
		answerChunks := s.splitTextByLength(answerPart, maxLength)
		for _, aChunk := range answerChunks {
			tokenCount, _ := s.tokenizer.CountTokens(aChunk)
			chunk := DocumentChunk{
				Index:       0,
				Type:        "knowledge",
				Content:     aChunk,
				StartPos:    currentPos,
				EndPos:      currentPos + len(aChunk),
				TokenCount:  tokenCount,
				ContentHash: "",
			}
			chunks = append(chunks, chunk)
			currentPos += len(aChunk) + 1 // +1 for newline
		}
	} else if len(questionPart) <= maxLength {
		// 如果问题和答案都能放入一个块中
		tokenCount, _ := s.tokenizer.CountTokens(fullContent)
		chunk := DocumentChunk{
			Index:       0,
			Type:        "knowledge",
			Content:     fullContent,
			StartPos:    0,
			EndPos:      len(fullContent),
			TokenCount:  tokenCount,
			ContentHash: "",
		}
		// 清空之前添加的部分，因为我们现在要把整个QA对作为一个块
		chunks = []DocumentChunk{chunk}
	}

	return chunks
}

// splitTextByLength 按指定长度分割文本
func (s *ChunkerService) splitTextByLength(text string, maxLength int) []string {
	var chunks []string

	if maxLength <= 0 {
		return []string{text}
	}

	// 如果文本本身就不超过最大长度，直接返回
	if len(text) <= maxLength {
		return []string{text}
	}

	// 分割文本
	for len(text) > 0 {
		if len(text) <= maxLength {
			chunks = append(chunks, text)
			break
		}

		// 取最大长度的片段
		chunk := text[:maxLength]
		chunks = append(chunks, chunk)
		text = text[maxLength:]
	}

	return chunks
}

// DataTableChunkStrategy 数据表格类型分块策略
type DataTableChunkStrategy struct{}

func (s *DataTableChunkStrategy) GetType() string {
	return model.ChunkTypeDataTable
}

func (s *DataTableChunkStrategy) ProcessChunking(service *ChunkerService, eid int64, fileID int64, content string, config *ChunkConfig) (*ChunkResult, error) {
	// 数据表格类型特殊处理 - 每行数据作为一个分块
	result := &ChunkResult{
		Chunks:   []DocumentChunk{},
		Warnings: []string{},
		Errors:   []string{},
	}

	// 解析表格内容
	rows := service.parseMarkdownTable(content)

	// 为每一行创建一个分块
	currentPos := 0
	for _, row := range rows {
		tokenCount, _ := service.tokenizer.CountTokens(row.Content)

		chunk := DocumentChunk{
			Index:       0, // 索引会在ChunkDocument方法中统一设置
			Type:        "knowledge",
			Content:     row.Content,
			StartPos:    currentPos,
			EndPos:      currentPos + len(row.Content),
			TokenCount:  tokenCount,
			ContentHash: "", // 哈希会在ChunkDocument方法中统一设置
		}
		result.Chunks = append(result.Chunks, chunk)

		// 更新位置，考虑换行符
		currentPos += len(row.Content) + 1
	}

	// 数据表格类型通常不需要重叠处理，因为每行数据应该是独立完整的
	return result, nil
}

// TableRow 表示表格中的一行数据
type TableRow struct {
	Content  string
	Metadata map[string]interface{}
}

// parseMarkdownTable 解析Markdown表格内容
func (s *ChunkerService) parseMarkdownTable(content string) []TableRow {
	var rows []TableRow

	// 使用已有的extractTables方法提取表格
	tables := s.extractTables(content)

	// 处理每个表格
	for _, table := range tables {
		// 分割表格内容为行
		lines := strings.Split(strings.TrimSpace(table.Content), "\n")

		if len(lines) < 2 {
			continue // 至少需要表头和一行数据
		}

		// 解析表头
		headerLine := strings.Trim(lines[0], "| ")
		headers := strings.Split(headerLine, "|")
		for i := range headers {
			headers[i] = strings.TrimSpace(headers[i])
			// 处理空表头
			if headers[i] == "" {
				headers[i] = "列" + fmt.Sprintf("%d", i+1)
			}
		}

		// 确定数据开始行（跳过分隔符行）
		dataStartIndex := 1
		if len(lines) > 1 && s.isSeparatorLine(lines[1]) {
			dataStartIndex = 2
		}

		// 解析数据行
		for i := dataStartIndex; i < len(lines); i++ {
			line := strings.Trim(lines[i], "| ")
			if line == "" {
				continue
			}

			// 分割数据
			values := strings.Split(line, "|")
			for j := range values {
				values[j] = strings.TrimSpace(values[j])
			}

			// 构建内容字符串
			var contentBuilder strings.Builder
			for j, value := range values {
				var header string
				if j < len(headers) {
					header = headers[j]
				} else {
					header = "列" + fmt.Sprintf("%d", j+1)
				}

				// 处理空值
				if value == "" {
					value = "无"
				}

				contentBuilder.WriteString(fmt.Sprintf("%s: %s\n", header, value))
			}

			row := TableRow{
				Content: contentBuilder.String(),
				Metadata: map[string]interface{}{
					"row": i - dataStartIndex,
				},
			}
			rows = append(rows, row)
		}
	}

	return rows
}

// isSeparatorLine 检查是否是表格分隔符行（如 | --- | --- |）
func (s *ChunkerService) isSeparatorLine(line string) bool {
	// 去掉首尾的管道符和空格
	trimmed := strings.Trim(line, "| ")

	// 检查是否只包含连字符、空格和冒号
	parts := strings.Split(trimmed, "|")
	for _, part := range parts {
		trimmedPart := strings.TrimSpace(part)
		if trimmedPart == "" {
			continue
		}

		// 检查是否只包含连字符和冒号（允许 :---, ---:, :---: 等格式）
		valid := true
		for _, char := range trimmedPart {
			if char != '-' && char != ':' && char != ' ' {
				valid = false
				break
			}
		}
		if !valid {
			return false
		}
	}

	return true
}

// ProductPlanChunkStrategy 产品方案类型分块策略
type ProductPlanChunkStrategy struct{}

func (s *ProductPlanChunkStrategy) GetType() string {
	return model.ChunkTypeProductPlan
}

func (s *ProductPlanChunkStrategy) ProcessChunking(service *ChunkerService, eid int64, fileID int64, content string, config *ChunkConfig) (*ChunkResult, error) {
	// TODO: 实现产品方案类型分块逻辑

	// 这里暂时使用默认策略，后续再实现具体的产品方案分块逻辑
	defaultStrategy := &DefaultChunkStrategy{}
	return defaultStrategy.ProcessChunking(service, eid, fileID, content, config)
}

// ProductCatalogChunkStrategy 产品画册类型分块策略
type ProductCatalogChunkStrategy struct{}

func (s *ProductCatalogChunkStrategy) GetType() string {
	return model.ChunkTypeProductCatalog
}

func (s *ProductCatalogChunkStrategy) ProcessChunking(service *ChunkerService, eid int64, fileID int64, content string, config *ChunkConfig) (*ChunkResult, error) {
	// TODO: 实现产品画册类型分块逻辑

	// 这里暂时使用默认策略，后续再实现具体的产品画册分块逻辑
	defaultStrategy := &DefaultChunkStrategy{}
	return defaultStrategy.ProcessChunking(service, eid, fileID, content, config)
}

// VideoCourseChunkStrategy 视频课程类型分块策略
type VideoCourseChunkStrategy struct{}

func (s *VideoCourseChunkStrategy) GetType() string {
	return model.ChunkTypeVideoCourse
}

func (s *VideoCourseChunkStrategy) ProcessChunking(service *ChunkerService, eid int64, fileID int64, content string, config *ChunkConfig) (*ChunkResult, error) {
	// TODO: 实现视频课程类型分块逻辑

	// 这里暂时使用默认策略，后续再实现具体的视频课程分块逻辑
	defaultStrategy := &DefaultChunkStrategy{}
	return defaultStrategy.ProcessChunking(service, eid, fileID, content, config)
}
