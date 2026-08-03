package service

import (
	"strings"
	"unicode/utf8"
)

// 常见语气词/口头禅，用于质量检查
var fillerWords = []string{
	"呃", "嗯", "那个", "这个", "就是", "然后", "反正", "其实",
	"那个那个", "就是说", "这样一个", "这样的话", "那那个",
}

// needsNormalization 判断转写文本是否需要经过 Prompt 1 规范化。
//
// 纯启发式规则，不调用 LLM，零额外成本。
// fun-asr 等商用引擎的输出通常不需要规范化，此检查作为兜底。
func needsNormalization(transcript string) bool {
	text := strings.TrimSpace(transcript)
	if text == "" {
		return false
	}

	runeCount := utf8.RuneCountInString(text)
	if runeCount < 50 {
		return false // 太短，不需要规范化
	}

	return hasHighFillerRatio(text, runeCount) ||
		hasExcessiveRepetition(text) ||
		hasMissingPunctuation(text, runeCount)
}

// hasHighFillerRatio 检查语气词占比是否过高（>5%）。
func hasHighFillerRatio(text string, totalRunes int) bool {
	if totalRunes == 0 {
		return false
	}
	fillerCount := 0
	for _, fw := range fillerWords {
		fillerCount += strings.Count(text, fw)
	}
	return float64(fillerCount)/float64(totalRunes) > 0.05
}

// hasExcessiveRepetition 检查是否存在连续重复片段（同一子串连续出现 3 次以上）。
func hasExcessiveRepetition(text string) bool {
	runes := []rune(text)
	// 检查 3-10 字长度的重复片段
	for length := 3; length <= 10 && length <= len(runes)/2; length++ {
		for i := 0; i <= len(runes)-length*2; i++ {
			segment := string(runes[i : i+length])
			// 看后面是否紧跟着相同片段
			next := string(runes[i+length : i+length*2])
			if segment == next {
				// 再检查第三次
				if i+length*3 <= len(runes) {
					third := string(runes[i+length*2 : i+length*3])
					if segment == third {
						return true
					}
				}
				return true
			}
		}
	}
	return false
}

// hasMissingPunctuation 检查标点符号占比是否过低（<1%）。
func hasMissingPunctuation(text string, totalRunes int) bool {
	if totalRunes == 0 {
		return false
	}
	punctuationCount := 0
	for _, r := range text {
		if r == '，' || r == '。' || r == '？' || r == '！' ||
			r == '、' || r == '；' || r == '：' || r == '.' ||
			r == ',' || r == '?' || r == '!' {
			punctuationCount++
		}
	}
	return float64(punctuationCount)/float64(totalRunes) < 0.01
}