package relay

import (
	"bytes"
)

// extractJSONFromMixedOutput scans the mixed output (SSE logs + JSON) and extracts the valid JSON object
// Deprecated: Use ParseMixedOutput instead
func extractJSONFromMixedOutput(body []byte) []byte {
	_, jsonBody := ParseMixedOutput(body)
	return jsonBody
}

// ParseMixedOutput separates SSE events (lines starting with "data:") from other content (JSON)
func ParseMixedOutput(body []byte) (sse []byte, jsonBody []byte) {
	var sseBuf bytes.Buffer
	var jsonBuf bytes.Buffer

	i := 0
	n := len(body)
	for i < n {
		// Skip leading whitespace
		for i < n && (body[i] == ' ' || body[i] == '\n' || body[i] == '\r' || body[i] == '\t') {
			i++
		}
		if i >= n {
			break
		}

		// Check for "data:"
		if bytes.HasPrefix(body[i:], []byte("data:")) {
			// This is an SSE line. Read until newline.
			lineStart := i
			idx := bytes.IndexByte(body[i:], '\n')
			var lineEnd int
			if idx == -1 {
				lineEnd = n
			} else {
				lineEnd = i + idx + 1 // Include newline
			}

			sseBuf.Write(body[lineStart:lineEnd])
			// Ensure it ends with proper newlines if not present (though we captured newline if it existed)
			if idx == -1 || (lineEnd-lineStart > 0 && body[lineEnd-1] != '\n') {
				sseBuf.WriteString("\n")
			}
			sseBuf.WriteString("\n") // Extra newline to ensure event separation

			i = lineEnd
			continue
		}

		// If not "data:", and starts with `{`, it's likely the JSON.
		if body[i] == '{' {
			// Capture JSON using brace counting
			start := i
			end, success := findJSONEnd(body, start)
			if success {
				jsonBuf.Write(body[start:end])
				i = end
				continue
			}
		}

		// If we are here, it's some other content or junk.
		// Skip byte
		i++
	}

	return sseBuf.Bytes(), jsonBuf.Bytes()
}

// findJSONEnd finds the end index of a JSON object starting at `start`
func findJSONEnd(body []byte, start int) (int, bool) {
	depth := 0
	inString := false
	escaped := false

	for i := start; i < len(body); i++ {
		b := body[i]
		if escaped {
			escaped = false
			continue
		}
		if b == '\\' {
			escaped = true
			continue
		}
		if b == '"' {
			inString = !inString
			continue
		}
		if !inString {
			if b == '{' {
				depth++
			} else if b == '}' {
				depth--
				if depth == 0 {
					return i + 1, true
				}
			}
		}
	}
	return start, false
}
