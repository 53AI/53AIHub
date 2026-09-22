package actionruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

var (
	ErrInvalidResultSpec = errors.New("invalid result spec")
	ErrResultSpecOutput  = errors.New("result spec output is unavailable")
)

// ResultSpec is the Host-owned content contract between a runtime and the
// deterministic document renderer. The renderer and template metadata are
// persisted alongside, but never inferred from, the document bytes.
type ResultSpec struct {
	ResultSpecVersion string              `json:"result_spec_version"`
	RendererVersion   string              `json:"renderer_version"`
	TemplateVersion   string              `json:"template_version"`
	Title             string              `json:"title"`
	Subtitle          string              `json:"subtitle"`
	ExecutiveSummary  string              `json:"executive_summary"`
	Sections          []ResultSpecSection `json:"sections"`
	Findings          []string            `json:"findings"`
	Recommendations   []string            `json:"recommendations"`
	Sources           []ResultSpecSource  `json:"sources"`
	Appendices        []string            `json:"appendices"`
	// Diagnostics lists ignored unknown fields (server-side only, never rendered).
	Diagnostics []string `json:"-"`
}

type ResultSpecSection struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

type ResultSpecSource struct {
	Role          string `json:"role"`
	SourceType    string `json:"source_type"`
	CanonicalID   string `json:"canonical_id"`
	SourceVersion string `json:"source_version,omitempty"`
}

// ErrResultSpecMissing / ErrResultSpecParse / ErrResultSpecValidation split the
// delivery-contract failures so an operator can tell "the model never produced a
// spec" from "the spec was malformed" from "the spec was incomplete".
var (
	ErrResultSpecMissing    = errors.New("result spec message is missing")
	ErrResultSpecParse      = errors.New("result spec is not parsable JSON")
	ErrResultSpecValidation = errors.New("result spec failed validation")
)

// ParseResultSpec is syntax tolerant and semantically strict:
//   - Markdown code fences are stripped;
//   - a short prose prefix/suffix around the JSON object is tolerated;
//   - the single JSON object is extracted from the text;
//   - unknown fields are ignored (collected as diagnostics), not fatal;
//   - required fields, field types, section completeness and version shape stay strict.
func ParseResultSpec(data []byte) (ResultSpec, error) {
	text := strings.TrimSpace(string(data))
	if text == "" {
		return ResultSpec{}, ErrResultSpecMissing
	}
	raw, _, err := extractJSONObject(text)
	if err != nil {
		return ResultSpec{}, fmt.Errorf("%w: %v", ErrResultSpecParse, err)
	}
	spec, unknownFields, err := decodeResultSpec(raw)
	if err != nil {
		return ResultSpec{}, fmt.Errorf("%w: %v", ErrResultSpecParse, err)
	}
	if err := spec.Validate(); err != nil {
		return ResultSpec{}, err
	}
	spec.Diagnostics = unknownFields
	return spec, nil
}

// stripCodeFences removes ```json ... ``` wrappers (with or without a language tag).
func stripCodeFences(text string) string {
	trimmed := strings.TrimSpace(text)
	if !strings.HasPrefix(trimmed, "```") {
		return trimmed
	}
	body := strings.TrimPrefix(trimmed, "```")
	if index := strings.IndexByte(body, '\n'); index >= 0 {
		body = body[index+1:]
	}
	if index := strings.LastIndex(body, "```"); index >= 0 {
		body = body[:index]
	}
	return strings.TrimSpace(body)
}

// extractJSONObject finds the first balanced JSON object in the text, tolerating
// surrounding prose.
func extractJSONObject(text string) ([]byte, []string, error) {
	text = stripCodeFences(text)
	start := strings.IndexByte(text, '{')
	if start < 0 {
		return nil, nil, errors.New("no JSON object found")
	}
	depth, inString, escaped := 0, false, false
	for index := start; index < len(text); index++ {
		char := text[index]
		switch {
		case escaped:
			escaped = false
		case char == '\\' && inString:
			escaped = true
		case char == '"':
			inString = !inString
		case inString:
		case char == '{':
			depth++
		case char == '}':
			depth--
			if depth == 0 {
				return []byte(text[start : index+1]), nil, nil
			}
		}
	}
	return nil, nil, errors.New("JSON object is not balanced (possibly truncated)")
}

// decodeResultSpec decodes strictly typed fields while tolerating unknown ones.
func decodeResultSpec(raw []byte) (ResultSpec, []string, error) {
	var spec ResultSpec
	if err := json.Unmarshal(raw, &spec); err != nil {
		return ResultSpec{}, nil, err
	}
	var generic map[string]json.RawMessage
	if err := json.Unmarshal(raw, &generic); err != nil {
		return ResultSpec{}, nil, err
	}
	known := map[string]bool{
		"result_spec_version": true, "renderer_version": true, "template_version": true, "title": true, "subtitle": true,
		"executive_summary": true, "sections": true, "findings": true, "recommendations": true, "sources": true, "appendices": true,
	}
	diagnostics := make([]string, 0, 4)
	for key := range generic {
		if !known[key] && len(diagnostics) < 8 {
			diagnostics = append(diagnostics, key)
		}
	}
	sort.Strings(diagnostics)
	return spec, diagnostics, nil
}

func (s ResultSpec) Validate() error {
	if strings.TrimSpace(s.Title) == "" || strings.TrimSpace(s.ExecutiveSummary) == "" || len(s.Sections) == 0 {
		return fmt.Errorf("%w: title, executive_summary and sections are required", ErrResultSpecValidation)
	}
	for index, section := range s.Sections {
		if strings.TrimSpace(section.Title) == "" || strings.TrimSpace(section.Body) == "" {
			return fmt.Errorf("%w: section %d is incomplete", ErrResultSpecValidation, index+1)
		}
	}
	for index, source := range s.Sources {
		if strings.TrimSpace(source.CanonicalID) == "" || strings.TrimSpace(source.SourceType) == "" {
			return fmt.Errorf("%w: source %d is incomplete", ErrResultSpecValidation, index+1)
		}
	}
	return nil
}

func resultSpecContextError(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	return ctx.Err()
}
