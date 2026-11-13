package relay

import "strings"

// Some compatible providers occasionally include their tokenizer's BOS/EOS
// sentinel text inside content. These are protocol markers, never user text.
var providerSentenceTokens = []string{
	"<｜begin_of_sentence｜>", "<｜end_of_sentence｜>",
	"<|begin_of_sentence|>", "<|end_of_sentence|>",
}

// streamThoughtSanitizer keeps tagged reasoning out of answer content even when
// a provider splits the tags across deltas. Native reasoning_content stays separate.
type streamThoughtSanitizer struct {
	pending  string
	thinking bool
}

func (s *streamThoughtSanitizer) Add(chunk string) string {
	s.pending += chunk
	var out strings.Builder
	for s.pending != "" {
		open, close := strings.Index(s.pending, "<think>"), strings.Index(s.pending, "</think>")
		index, tag, thinking := open, "<think>", true
		if close >= 0 && (index < 0 || close < index) {
			index, tag, thinking = close, "</think>", false
		}
		for _, marker := range providerSentenceTokens {
			if offset := strings.Index(s.pending, marker); offset >= 0 && (index < 0 || offset < index) {
				index, tag, thinking = offset, marker, s.thinking
			}
		}
		if index >= 0 {
			if !s.thinking {
				out.WriteString(s.pending[:index])
			}
			s.pending = s.pending[index+len(tag):]
			s.thinking = thinking
			continue
		}
		keep := 0
		for _, tag := range append([]string{"<think>", "</think>"}, providerSentenceTokens...) {
			for n := 1; n < len(tag) && n <= len(s.pending); n++ {
				if n > keep && strings.HasSuffix(s.pending, tag[:n]) {
					keep = n
				}
			}
		}
		if !s.thinking {
			out.WriteString(s.pending[:len(s.pending)-keep])
		}
		s.pending = s.pending[len(s.pending)-keep:]
		break
	}
	return out.String()
}

func (s *streamThoughtSanitizer) Flush() string {
	pending, thinking := s.pending, s.thinking
	s.pending, s.thinking = "", false
	if thinking {
		return ""
	}
	// Add already emits complete visible text. A remaining multi-character
	// prefix is an unfinished control tag, not answer content.
	if len(pending) > 1 {
		for _, tag := range append([]string{"<think>", "</think>"}, providerSentenceTokens...) {
			if strings.HasPrefix(tag, pending) {
				return ""
			}
		}
	}
	return pending
}

func sanitizeThoughtContent(content string) string {
	sanitizer := streamThoughtSanitizer{}
	return sanitizer.Add(content) + sanitizer.Flush()
}
