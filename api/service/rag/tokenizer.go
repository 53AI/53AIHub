package rag

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// TokenizerService Token计数服务
type TokenizerService struct {
	// 可以后续扩展支持不同的tokenizer
}

// TokenInfo Token信息
type TokenInfo struct {
	Count     int      `json:"count"`
	CharCount int      `json:"char_count"`
	WordCount int      `json:"word_count"`
	Tokens    []string `json:"tokens,omitempty"`
}

// NewTokenizerService 创建Token计数服务
func NewTokenizerService() *TokenizerService {
	return &TokenizerService{}
}

// CountTokens 计算文本的Token数量
// 使用简化的Token计算方法，适用于中英文混合文本
func (ts *TokenizerService) CountTokens(text string) (int, error) {
	if text == "" {
		return 0, nil
	}

	// 清理文本
	cleanText := ts.cleanText(text)

	// 计算Token数量
	tokenCount := ts.estimateTokenCount(cleanText)

	return tokenCount, nil
}

// CountTokensWithInfo 计算Token数量并返回详细信息
func (ts *TokenizerService) CountTokensWithInfo(text string) (*TokenInfo, error) {
	if text == "" {
		return &TokenInfo{}, nil
	}

	// 清理文本
	cleanText := ts.cleanText(text)

	// 计算各种统计信息
	tokenCount := ts.estimateTokenCount(cleanText)
	charCount := utf8.RuneCountInString(cleanText)
	wordCount := ts.countWords(cleanText)

	return &TokenInfo{
		Count:     tokenCount,
		CharCount: charCount,
		WordCount: wordCount,
	}, nil
}

// EstimateChunks 估算需要的分块数量
func (ts *TokenizerService) EstimateChunks(text string, maxTokens int, overlap int) (int, error) {
	totalTokens, err := ts.CountTokens(text)
	if err != nil {
		return 0, err
	}

	if totalTokens <= maxTokens {
		return 1, nil
	}

	// 考虑重叠的情况下计算分块数
	effectiveChunkSize := maxTokens - overlap
	if effectiveChunkSize <= 0 {
		effectiveChunkSize = maxTokens / 2 // 防止重叠过大
	}

	chunks := (totalTokens + effectiveChunkSize - 1) / effectiveChunkSize
	return chunks, nil
}

// cleanText 清理文本，移除多余的空白字符
func (ts *TokenizerService) cleanText(text string) string {
	// 移除多余的空白字符
	text = regexp.MustCompile(`\s+`).ReplaceAllString(text, " ")

	// 移除首尾空白
	text = strings.TrimSpace(text)

	return text
}

// estimateTokenCount 估算Token数量
// 使用简化的规则：中文字符按1个token计算，英文单词按0.75个token计算
func (ts *TokenizerService) estimateTokenCount(text string) int {
	if text == "" {
		return 0
	}

	var tokenCount float64
	var currentWord strings.Builder

	for _, r := range text {
		if ts.isCJK(r) {
			// 中日韩字符，每个字符约1个token
			if currentWord.Len() > 0 {
				// 处理之前积累的英文单词
				tokenCount += float64(ts.countEnglishTokens(currentWord.String()))
				currentWord.Reset()
			}
			tokenCount += 1.0
		} else if unicode.IsLetter(r) || unicode.IsDigit(r) {
			// 英文字母或数字，积累到单词中
			currentWord.WriteRune(r)
		} else {
			// 其他字符（标点、空格等）
			if currentWord.Len() > 0 {
				tokenCount += float64(ts.countEnglishTokens(currentWord.String()))
				currentWord.Reset()
			}

			// 标点符号等按0.5个token计算
			if !unicode.IsSpace(r) {
				tokenCount += 0.5
			}
		}
	}

	// 处理最后的英文单词
	if currentWord.Len() > 0 {
		tokenCount += float64(ts.countEnglishTokens(currentWord.String()))
	}

	return int(tokenCount + 0.5) // 四舍五入
}

// isCJK 判断是否为中日韩字符
func (ts *TokenizerService) isCJK(r rune) bool {
	return (r >= 0x4E00 && r <= 0x9FFF) || // CJK Unified Ideographs
		(r >= 0x3400 && r <= 0x4DBF) || // CJK Extension A
		(r >= 0x20000 && r <= 0x2A6DF) || // CJK Extension B
		(r >= 0x2A700 && r <= 0x2B73F) || // CJK Extension C
		(r >= 0x2B740 && r <= 0x2B81F) || // CJK Extension D
		(r >= 0x2B820 && r <= 0x2CEAF) || // CJK Extension E
		(r >= 0xF900 && r <= 0xFAFF) || // CJK Compatibility Ideographs
		(r >= 0x2F800 && r <= 0x2FA1F) // CJK Compatibility Supplement
}

// countEnglishTokens 计算英文单词的token数量
func (ts *TokenizerService) countEnglishTokens(word string) int {
	if word == "" {
		return 0
	}

	// 简化规则：
	// - 短单词（1-4字符）：1个token
	// - 中等单词（5-8字符）：1个token
	// - 长单词（9+字符）：可能被分割，按长度/4计算
	length := len(word)

	if length <= 8 {
		return 1
	} else {
		return (length + 3) / 4 // 向上取整
	}
}

// countWords 计算单词数量
func (ts *TokenizerService) countWords(text string) int {
	if text == "" {
		return 0
	}

	// 使用正则表达式分割单词
	wordRegex := regexp.MustCompile(`\S+`)
	words := wordRegex.FindAllString(text, -1)

	return len(words)
}

// SplitTextByTokens 按Token数量分割文本
func (ts *TokenizerService) SplitTextByTokens(text string, maxTokens int, overlap int) ([]string, error) {
	if text == "" {
		return []string{}, nil
	}

	if maxTokens <= 0 {
		return nil, fmt.Errorf("maxTokens must be greater than 0")
	}

	// 清理文本
	cleanText := ts.cleanText(text)

	// 如果总token数不超过maxTokens，直接返回原文本
	totalTokens, err := ts.CountTokens(cleanText)
	if err != nil {
		return nil, err
	}

	if totalTokens <= maxTokens {
		return []string{cleanText}, nil
	}

	chunks := ts.forceSplitText(cleanText, maxTokens)

	return chunks, nil
}

// forceSplitText 强制分割文本
func (ts *TokenizerService) forceSplitText(text string, maxTokens int) []string {
	// 按字符强制分割
	runes := []rune(text)
	var chunks []string

	chunkSize := len(runes) * maxTokens / (ts.estimateTokenCount(text) + 1)
	if chunkSize <= 0 {
		chunkSize = maxTokens
	}

	for i := 0; i < len(runes); i += chunkSize {
		end := i + chunkSize
		if end > len(runes) {
			end = len(runes)
		}

		chunk := string(runes[i:end])
		if strings.TrimSpace(chunk) != "" {
			chunks = append(chunks, strings.TrimSpace(chunk))
		}
	}

	return chunks
}

// getTextHead 获取文本开头指定token数量的内容
func (ts *TokenizerService) getTextHead(text string, maxTokens int) string {
	if text == "" || maxTokens <= 0 {
		return ""
	}

	words := strings.Fields(text)
	var result strings.Builder
	var tokenCount int

	for _, word := range words {
		wordTokens, _ := ts.CountTokens(word)
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

// getTextTail 获取文本结尾指定token数量的内容
func (ts *TokenizerService) getTextTail(text string, maxTokens int) string {
	if text == "" || maxTokens <= 0 {
		return ""
	}

	words := strings.Fields(text)
	var result []string
	var tokenCount int

	// 从后往前计算
	for i := len(words) - 1; i >= 0; i-- {
		wordTokens, _ := ts.CountTokens(words[i])
		if tokenCount+wordTokens > maxTokens {
			break
		}

		result = append([]string{words[i]}, result...)
		tokenCount += wordTokens
	}

	return strings.Join(result, " ")
}
