package tools

import (
	"context"
	"fmt"
	"sort"
	"strings"

	sandboxclient "github.com/53AI/53AIHub/service/sandbox"
)

type editV2Operation struct {
	Old        string
	New        string
	ReplaceAll bool
}
type editV2Span struct {
	Start       int
	End         int
	Replacement string
}

func executeEditFileV2(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	path, ok := args["path"].(string)
	if !ok || strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("missing path argument")
	}
	path, err := normalizeSandboxWorkspacePath(path)
	if err != nil {
		return nil, err
	}
	features := agentSuccessRateFeatureFlagsFromContext(ctx)
	operations, err := parseEditV2OperationsWithBatch(args, features.EditBatch)
	if err != nil {
		return nil, err
	}
	sessionID, cwd := resolveSandboxSessionID(ctx, args), resolveSandboxCWD(ctx, args)
	if _, err := normalizeSandboxRelativePath(cwd); err != nil {
		return nil, err
	}
	if err := ensureSandboxSessionSeeded(ctx, sessionID, cwd); err != nil {
		return nil, err
	}
	readResp, err := getSandboxClient().ReadFile(ctx, sandboxclient.FileReadRequest{Path: path, SessionID: sessionID, Cwd: cwd})
	if err != nil {
		return nil, wrapSandboxServiceError(err)
	}
	spans, matchMode, err := buildEditV2SpansForContentWithNormalizedMatch(readResp.Content, operations, features.EditNormalizedMatch)
	if err != nil {
		return nil, err
	}
	newContent := applyEditV2Spans(readResp.Content, spans)
	if newContent == readResp.Content {
		return nil, fmt.Errorf("EDIT_NO_CHANGE: edits do not change file content")
	}
	writeReq := sandboxclient.FileWriteRequest{Path: path, Content: newContent, SessionID: sessionID, Cwd: cwd}
	if files, buildErr := buildSkillFilesForSandbox(ctx); buildErr == nil && len(files) > 0 {
		writeReq.Files = files
	}
	if _, err := getSandboxClient().WriteFile(ctx, writeReq); err != nil {
		return nil, wrapSandboxServiceError(err)
	}
	if err := formatSandboxClientWrittenFile(ctx, sessionID, cwd, path); err != nil {
		return nil, err
	}
	if err := validateSandboxClientWrittenFile(ctx, sessionID, cwd, path); err != nil {
		return nil, err
	}
	return &ToolResult{Output: fmt.Sprintf("Edited %s (%d replacement(s), atomic batch)", path, len(spans)), ExitCode: 0, Meta: map[string]interface{}{"edit_count": len(operations), "match_mode": matchMode}}, nil
}

func buildEditV2SpansForContent(content string, operations []editV2Operation) ([]editV2Span, string, error) {
	return buildEditV2SpansForContentWithNormalizedMatch(content, operations, agentSuccessRateFeatureFlagsFromContext(context.Background()).EditNormalizedMatch)
}

func buildEditV2SpansForContentWithNormalizedMatch(content string, operations []editV2Operation, normalizedMatch bool) ([]editV2Span, string, error) {
	if !normalizedMatch {
		spans, err := buildEditV2Spans(content, operations)
		return spans, "exact", err
	}
	normalized, offsets := normalizeEditLineEndingsForMatch(content)
	spans, err := buildEditV2Spans(normalized, operations)
	if err != nil {
		return nil, "normalized_line_endings", err
	}
	for index := range spans {
		spans[index].Start = offsets[spans[index].Start]
		spans[index].End = offsets[spans[index].End]
		spans[index].Replacement = normalizeEditV2ReplacementLineEndings(spans[index].Replacement, content[spans[index].Start:spans[index].End])
	}
	return spans, "normalized_line_endings", nil
}

// normalizeEditLineEndingsForMatch returns a matching-only view and a mapping
// from every normalized byte boundary back to the original byte boundary.
// Replacements are then applied to the original bytes, preserving all
// unaffected CRLF sequences.
func normalizeEditLineEndingsForMatch(content string) (string, []int) {
	var normalized strings.Builder
	offsets := make([]int, 1, len(content)+1)
	for index := 0; index < len(content); {
		if content[index] == '\r' && index+1 < len(content) && content[index+1] == '\n' {
			normalized.WriteByte('\n')
			index += 2
			offsets = append(offsets, index)
			continue
		}
		normalized.WriteByte(content[index])
		index++
		offsets = append(offsets, index)
	}
	return normalized.String(), offsets
}

// normalizeEditV2ReplacementLineEndings preserves the line-ending convention
// of a normalized-match target. Matching accepts LF tool calls against CRLF
// files, but the replacement must not turn that target into mixed line endings.
func normalizeEditV2ReplacementLineEndings(replacement, matchedContent string) string {
	if !strings.Contains(matchedContent, "\r\n") || !strings.Contains(replacement, "\n") {
		return replacement
	}
	replacement = strings.ReplaceAll(replacement, "\r\n", "\n")
	return strings.ReplaceAll(replacement, "\n", "\r\n")
}

func parseEditV2Operations(args map[string]interface{}) ([]editV2Operation, error) {
	return parseEditV2OperationsWithBatch(args, agentSuccessRateFeatureFlagsFromContext(context.Background()).EditBatch)
}

func parseEditV2OperationsWithBatch(args map[string]interface{}, batchEnabled bool) ([]editV2Operation, error) {
	if raw, exists := args["edits"]; exists {
		if !batchEnabled {
			return nil, fmt.Errorf("EDIT_BATCH_DISABLED: edits is disabled by feature flag")
		}
		items, ok := raw.([]interface{})
		if !ok || len(items) == 0 {
			return nil, fmt.Errorf("EDIT_INVALID: edits must be a non-empty array")
		}
		operations := make([]editV2Operation, 0, len(items))
		for index, item := range items {
			edit, ok := item.(map[string]interface{})
			if !ok {
				return nil, fmt.Errorf("EDIT_INVALID: edits[%d] must be an object", index)
			}
			old, oldOK := edit["old_string"].(string)
			newValue, newOK := edit["new_string"].(string)
			if !oldOK || old == "" || !newOK {
				return nil, fmt.Errorf("EDIT_INVALID: edits[%d] requires old_string and new_string", index)
			}
			operations = append(operations, editV2Operation{Old: old, New: newValue, ReplaceAll: parseBoolValue(edit["replace_all"])})
		}
		return operations, nil
	}
	old, oldOK := args["old_string"].(string)
	newValue, newOK := args["new_string"].(string)
	if !oldOK || old == "" || !newOK {
		return nil, fmt.Errorf("EDIT_INVALID: old_string and new_string are required")
	}
	return []editV2Operation{{Old: old, New: newValue, ReplaceAll: parseBoolValue(args["replace_all"])}}, nil
}

func buildEditV2Spans(content string, operations []editV2Operation) ([]editV2Span, error) {
	spans := make([]editV2Span, 0, len(operations))
	for index, operation := range operations {
		positions := exactEditPositions(content, operation.Old)
		if len(positions) == 0 {
			return nil, fmt.Errorf("EDIT_TEXT_NOT_FOUND: edit %d text was not found", index+1)
		}
		if !operation.ReplaceAll && len(positions) > 1 {
			return nil, fmt.Errorf("EDIT_TEXT_NOT_UNIQUE: edit %d text appears %d times", index+1, len(positions))
		}
		if !operation.ReplaceAll {
			positions = positions[:1]
		}
		for _, start := range positions {
			spans = append(spans, editV2Span{Start: start, End: start + len(operation.Old), Replacement: operation.New})
		}
	}
	sort.Slice(spans, func(i, j int) bool { return spans[i].Start < spans[j].Start })
	for index := 1; index < len(spans); index++ {
		if spans[index].Start < spans[index-1].End {
			return nil, fmt.Errorf("EDIT_RANGES_OVERLAP: edit ranges overlap")
		}
	}
	return spans, nil
}
func exactEditPositions(content, needle string) []int {
	var positions []int
	for offset := 0; ; {
		found := strings.Index(content[offset:], needle)
		if found < 0 {
			return positions
		}
		start := offset + found
		positions = append(positions, start)
		offset = start + len(needle)
	}
}
func applyEditV2Spans(content string, spans []editV2Span) string {
	for index := len(spans) - 1; index >= 0; index-- {
		span := spans[index]
		content = content[:span.Start] + span.Replacement + content[span.End:]
	}
	return content
}
