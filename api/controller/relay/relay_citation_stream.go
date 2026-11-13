package relay

import (
	"strings"

	"github.com/gin-gonic/gin"
)

// StreamCitationSanitizer 流式引用清洗器 (Phase 2E P0-1)。
//
// 核心机理：
// LLM 流式输出时，会将引用标记（如 [Source:boss_cognitions-1]）切碎为多个极小 chunk 发送
// （例如：chunk1=" ["、chunk2="Source:"、chunk3="boss_"、chunk4="cognitions-1]"）。
// 任何单 chunk 级别的正则匹配都会因分片而漏检。
//
// 本清洗器维护一个有界括号缓冲（最多 64 字符）：
// 1. 普通文字实时流出，零延迟；
// 2. 遇到引用起始符号 [ 或 【 时，开始将标签字符暂留在 tagBuf 中；
// 3. 当闭合符号 ] 或 】 到来时，组装出完整标签，交由 sanitizeAndValidateAnswer 校验：
//   - 若为无来源的编造引用，直接剔除（丢弃该标签）；
//   - 若为有真实来源支撑的合法引用，规范化输出 [Source:canonical]；
//
// 4. 若 tagBuf 累积超过 64 字符或出现换行（非单行引用标签），判定为普通括号文本，原样流出；
// 5. 流式结束 (Flush) 时，若有未闭合的残留缓冲，一并流出。
type StreamCitationSanitizer struct {
	c          *gin.Context
	tagBuf     strings.Builder
	inTag      bool
	bracketLen int
}

func NewStreamCitationSanitizer(c *gin.Context) *StreamCitationSanitizer {
	return &StreamCitationSanitizer{c: c}
}

// Feed 接收一个流式 content chunk，返回清洗后应发给客户端的文本。
func (s *StreamCitationSanitizer) Feed(chunk string) string {
	if chunk == "" {
		return ""
	}

	var out strings.Builder
	runes := []rune(chunk)

	for _, r := range runes {
		if !s.inTag {
			if r == '[' || r == '【' {
				s.inTag = true
				s.tagBuf.Reset()
				s.tagBuf.WriteRune(r)
				s.bracketLen = 1
			} else {
				out.WriteRune(r)
			}
		} else {
			s.tagBuf.WriteRune(r)
			s.bracketLen++

			// 遇到闭合括号
			if r == ']' || r == '】' {
				tag := s.tagBuf.String()
				s.inTag = false
				s.tagBuf.Reset()
				s.bracketLen = 0

				// 用标准引用校验函数裁定该标签
				cleaned, _ := sanitizeStreamAnswerFragment(s.c, tag)
				if cleaned != "" {
					out.WriteString(cleaned)
				}
				continue
			}

			// 超出引用标签最大可能长度，或出现换行（非单行引用标签），回退为普通文本
			if s.bracketLen > 64 || r == '\n' || r == '\r' {
				out.WriteString(s.tagBuf.String())
				s.inTag = false
				s.tagBuf.Reset()
				s.bracketLen = 0
			}
		}
	}

	res := out.String()
	return res
}

// Flush 在流结束时调用，清空并返回剩余缓冲区中的普通文本。
func (s *StreamCitationSanitizer) Flush() string {
	if s.inTag && s.tagBuf.Len() > 0 {
		rem := s.tagBuf.String()
		s.inTag = false
		s.tagBuf.Reset()
		s.bracketLen = 0
		cleaned, _ := sanitizeStreamAnswerFragment(s.c, rem)
		return cleaned
	}
	return ""
}

// sanitizeStreamDeltaContent 为保持向后兼容保留的辅助函数接口。
func sanitizeStreamDeltaContent(c *gin.Context, content string, force bool) (string, string) {
	if content == "" {
		return "", ""
	}

	if !force {
		runes := []rune(content)
		lastBracket := -1
		for i := len(runes) - 1; i >= 0 && len(runes)-1-i <= 64; i-- {
			r := runes[i]
			if r == ']' || r == '】' {
				break
			}
			if r == '[' || r == '【' {
				lastBracket = i
				break
			}
		}

		if lastBracket >= 0 {
			toFlush := string(runes[:lastBracket])
			remaining := string(runes[lastBracket:])
			if toFlush != "" {
				cleaned, _ := sanitizeStreamAnswerFragment(c, toFlush)
				return cleaned, remaining
			}
			return "", remaining
		}
	}

	cleaned, _ := sanitizeStreamAnswerFragment(c, content)
	return cleaned, ""
}
