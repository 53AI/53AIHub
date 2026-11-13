package rag

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"

	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

type DocumentQASummaryStage string

const (
	DocumentQASummaryStageMap    DocumentQASummaryStage = "map"
	DocumentQASummaryStageFile   DocumentQASummaryStage = "file"
	DocumentQASummaryStageGlobal DocumentQASummaryStage = "global"
)

type DocumentQASummaryNote struct {
	FileID     int64
	FileName   string
	Content    string
	SourceKeys []string
	References []string
}

// DocumentQASummaryOutput keeps model-selected citations separate from prose
// so the service can validate them against the callback's input sources.
type DocumentQASummaryOutput struct {
	Content string
	// References carries citations separately from prose; only keys present in
	// the input source set are preserved by the service.
	References []string
}

type DocumentQASummaryInput struct {
	Stage      DocumentQASummaryStage
	FileID     int64
	FileName   string
	Content    string
	SourceKeys []string
	Notes      []DocumentQASummaryNote
}

type DocumentQASummaryCallback func(context.Context, DocumentQASummaryInput) (DocumentQASummaryOutput, *relaymodel.Usage, error)

type DocumentQASummaryStats struct {
	Total     int  `json:"total"`
	Processed int  `json:"processed"`
	Failed    int  `json:"failed"`
	Complete  bool `json:"complete"`
}

type DocumentQASummaryResult struct {
	Notes                 []DocumentQASummaryNote
	FileSummaries         map[int64]DocumentQASummaryNote
	Summary               string
	References            []string
	Coverage              DocumentQACoverage
	ComprehensiveComplete bool
	Stats                 DocumentQASummaryStats
	ByFile                map[int64]DocumentQASummaryStats
	Usage                 relaymodel.Usage
}

type documentQASummaryCall struct {
	input        DocumentQASummaryInput
	index        int
	segmentIndex int
}

type documentQASummaryCallResult struct {
	index  int
	output DocumentQASummaryOutput
	usage  *relaymodel.Usage
	err    error
}

// SummarizeDocumentQASegments maps every supplied source segment, reduces notes
// per file, then reduces the file summaries. The caller owns the overall timeout.
func SummarizeDocumentQASegments(ctx context.Context, segments []DocumentQASegment, concurrency, maxInputTokens int, callback DocumentQASummaryCallback) DocumentQASummaryResult {
	result := DocumentQASummaryResult{
		Coverage:      DocumentQACoverageComplete,
		ByFile:        make(map[int64]DocumentQASummaryStats),
		FileSummaries: make(map[int64]DocumentQASummaryNote),
	}
	if concurrency < 1 {
		concurrency = 1
	}
	if concurrency > 2 {
		concurrency = 2
	}
	result.Stats.Total = len(segments)
	for _, segment := range segments {
		result.ByFile[segment.FileID] = addSummaryStats(result.ByFile[segment.FileID], DocumentQASummaryStats{Total: 1})
	}
	if len(segments) == 0 {
		result.ComprehensiveComplete = true
		return result
	}
	if callback == nil || maxInputTokens <= 0 {
		result.Stats.Failed = len(segments)
		for id, stats := range result.ByFile {
			stats.Failed = stats.Total
			result.ByFile[id] = stats
		}
		result.Coverage = DocumentQACoveragePartial
		result.Summary = "整体综合未完成：缺少有效的归纳回调或输入预算。"
		return result
	}

	calls := make([]documentQASummaryCall, 0, len(segments))
	for index, segment := range segments {
		key := documentQASourceKey(segment)
		pieces, err := splitDocumentQASegment(segment, maxInputTokens)
		if err != nil {
			calls = append(calls, documentQASummaryCall{index: len(calls), segmentIndex: index, input: DocumentQASummaryInput{Stage: DocumentQASummaryStageMap, FileID: segment.FileID, FileName: segment.FileName, SourceKeys: []string{key}}})
			continue
		}
		for _, piece := range pieces {
			calls = append(calls, documentQASummaryCall{index: len(calls), segmentIndex: index, input: DocumentQASummaryInput{Stage: DocumentQASummaryStageMap, FileID: piece.FileID, FileName: piece.FileName, Content: piece.Content, SourceKeys: []string{key}}})
		}
	}
	mapResults := runDocumentQASummaryCalls(ctx, calls, concurrency, callback, &result.Usage)
	segmentNotes := make([][]DocumentQASummaryNote, len(segments))
	segmentFailed := make([]bool, len(segments))
	for _, callResult := range mapResults {
		segment := segments[calls[callResult.index].segmentIndex]
		if callResult.err != nil {
			segmentFailed[calls[callResult.index].segmentIndex] = true
			continue
		}
		if callResult.output.Content == "" {
			segmentFailed[calls[callResult.index].segmentIndex] = true
			continue
		}
		key := documentQASourceKey(segment)
		segmentNotes[calls[callResult.index].segmentIndex] = append(segmentNotes[calls[callResult.index].segmentIndex], DocumentQASummaryNote{
			FileID: segment.FileID, FileName: segment.FileName, Content: callResult.output.Content,
			SourceKeys: []string{key}, References: filterDocumentQASummaryReferences(callResult.output.References, []string{key}),
		})
	}
	for i, segment := range segments {
		result.Notes = append(result.Notes, segmentNotes[i]...)
		if segmentFailed[i] || len(segmentNotes[i]) == 0 {
			result.Stats.Failed++
			stats := result.ByFile[segment.FileID]
			stats.Failed++
			result.ByFile[segment.FileID] = stats
		} else {
			result.Stats.Processed++
			stats := result.ByFile[segment.FileID]
			stats.Processed++
			result.ByFile[segment.FileID] = stats
		}
	}
	if result.Stats.Failed > 0 || ctx.Err() != nil {
		result.Coverage = DocumentQACoveragePartial
		result.Summary = incompleteDocumentQASummary(result.Notes)
		result.References = noteReferences(result.Notes)
		return result
	}

	fileIDs := make([]int64, 0, len(result.ByFile))
	for id := range result.ByFile {
		fileIDs = append(fileIDs, id)
	}
	sort.Slice(fileIDs, func(i, j int) bool { return fileIDs[i] < fileIDs[j] })
	fileSummaries := make([]DocumentQASummaryNote, 0, len(fileIDs))
	maxFileDepth := 0
	for _, fileID := range fileIDs {
		fileNotes := make([]DocumentQASummaryNote, 0)
		for _, note := range result.Notes {
			if note.FileID == fileID {
				fileNotes = append(fileNotes, note)
			}
		}
		depth := 0
		reduced, complete := reduceDocumentQASummary(ctx, fileNotes, DocumentQASummaryStageFile, maxInputTokens, concurrency, callback, &result.Usage, &depth)
		if !complete || len(reduced) != 1 {
			result.Coverage = DocumentQACoveragePartial
			result.Summary = incompleteDocumentQASummary(result.Notes)
			result.References = noteReferences(result.Notes)
			return result
		}
		if depth > maxFileDepth {
			maxFileDepth = depth
		}
		stats := result.ByFile[fileID]
		stats.Complete = true
		result.ByFile[fileID] = stats
		result.FileSummaries[fileID] = reduced[0]
		fileSummaries = append(fileSummaries, reduced...)
	}
	global := fileSummaries
	if len(fileSummaries) > 1 {
		depth := maxFileDepth
		var complete bool
		global, complete = reduceDocumentQASummary(ctx, fileSummaries, DocumentQASummaryStageGlobal, maxInputTokens, concurrency, callback, &result.Usage, &depth)
		if !complete || len(global) == 0 {
			result.Coverage = DocumentQACoveragePartial
			result.Summary = incompleteDocumentQASummary(result.Notes)
			result.References = noteReferences(result.Notes)
			return result
		}
	}
	result.Summary = global[0].Content
	result.References = global[0].References
	result.ComprehensiveComplete = true
	return result
}

func reduceDocumentQASummary(ctx context.Context, notes []DocumentQASummaryNote, stage DocumentQASummaryStage, budget, concurrency int, callback DocumentQASummaryCallback, usage *relaymodel.Usage, depth *int) ([]DocumentQASummaryNote, bool) {
	if len(notes) == 0 {
		return nil, false
	}
	current := notes
	for len(current) > 1 || stage == DocumentQASummaryStageFile || stage == DocumentQASummaryStageGlobal {
		if *depth >= 3 || ctx.Err() != nil {
			return nil, false
		}
		groups, err := groupDocumentQASummaryNotes(current, budget)
		if err != nil {
			return nil, false
		}
		calls := make([]documentQASummaryCall, 0, len(groups))
		for i, group := range groups {
			var sourceKeys []string
			for _, note := range group {
				sourceKeys = append(sourceKeys, note.SourceKeys...)
			}
			input := DocumentQASummaryInput{Stage: stage, FileID: group[0].FileID, FileName: group[0].FileName, SourceKeys: uniqueStrings(sourceKeys), Notes: group}
			calls = append(calls, documentQASummaryCall{index: i, input: input})
		}
		results := runDocumentQASummaryCalls(ctx, calls, concurrency, callback, usage)
		before := 0
		for _, note := range current {
			before += estimateDocumentQASummaryTokens(note.Content)
		}
		next := make([]DocumentQASummaryNote, 0, len(results))
		for i, callResult := range results {
			if callResult.err != nil || callResult.output.Content == "" {
				return nil, false
			}
			var keys []string
			for _, note := range groups[i] {
				keys = append(keys, note.SourceKeys...)
			}
			keys = uniqueStrings(keys)
			next = append(next, DocumentQASummaryNote{
				FileID: groups[i][0].FileID, FileName: groups[i][0].FileName,
				Content: callResult.output.Content, SourceKeys: keys,
				References: filterDocumentQASummaryReferences(callResult.output.References, keys),
			})
		}
		after := 0
		for _, note := range next {
			after += estimateDocumentQASummaryTokens(note.Content)
		}
		(*depth)++
		if after >= before {
			return nil, false
		}
		current = next
		if len(current) == 1 {
			return current, true
		}
	}
	return current, true
}

func groupDocumentQASummaryNotes(notes []DocumentQASummaryNote, budget int) ([][]DocumentQASummaryNote, error) {
	var pieces []DocumentQASummaryNote
	for _, note := range notes {
		if estimateDocumentQASummaryTokens(note.Content) <= budget {
			pieces = append(pieces, note)
			continue
		}
		segments, err := SegmentDocument(note.Content, note.FileID, note.FileName, budget)
		if err != nil || len(segments) == 0 {
			return nil, fmt.Errorf("cannot split oversized note")
		}
		for _, segment := range segments {
			pieces = append(pieces, DocumentQASummaryNote{FileID: note.FileID, FileName: note.FileName, Content: segment.Content, SourceKeys: append([]string(nil), note.SourceKeys...)})
		}
	}
	groups := make([][]DocumentQASummaryNote, 0)
	group := make([]DocumentQASummaryNote, 0)
	tokens := 0
	for _, note := range pieces {
		count := estimateDocumentQASummaryTokens(note.Content)
		if len(group) > 0 && tokens+count > budget {
			groups = append(groups, group)
			group = nil
			tokens = 0
		}
		group = append(group, note)
		tokens += count
	}
	if len(group) > 0 {
		groups = append(groups, group)
	}
	return groups, nil
}

func runDocumentQASummaryCalls(ctx context.Context, calls []documentQASummaryCall, concurrency int, callback DocumentQASummaryCallback, usage *relaymodel.Usage) []documentQASummaryCallResult {
	results := make([]documentQASummaryCallResult, len(calls))
	if len(calls) == 0 {
		return results
	}
	if concurrency < 1 {
		concurrency = 1
	}
	if concurrency > 2 {
		concurrency = 2
	}
	jobs := make(chan documentQASummaryCall)
	var workers sync.WaitGroup
	var usageMu sync.Mutex
	for i := 0; i < concurrency; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for call := range jobs {
				result := documentQASummaryCallResult{index: call.index}
				if err := ctx.Err(); err != nil {
					result.err = err
				} else {
					result.output, result.usage, result.err = callback(ctx, call.input)
				}
				if result.usage != nil {
					usageMu.Lock()
					usage.PromptTokens += result.usage.PromptTokens
					usage.CompletionTokens += result.usage.CompletionTokens
					usage.TotalTokens += result.usage.TotalTokens
					usageMu.Unlock()
				}
				results[call.index] = result
			}
		}()
	}
	for _, call := range calls {
		jobs <- call
	}
	close(jobs)
	workers.Wait()
	return results
}

func splitDocumentQASegment(segment DocumentQASegment, budget int) ([]DocumentQASegment, error) {
	if estimateDocumentQASummaryTokens(segment.Content) <= budget {
		return []DocumentQASegment{segment}, nil
	}
	pieces, err := SegmentDocument(segment.Content, segment.FileID, segment.FileName, budget)
	if err != nil {
		return nil, err
	}
	for i := range pieces {
		pieces[i].Index = segment.Index
	}
	return pieces, nil
}

func estimateDocumentQASummaryTokens(text string) int { return estimateDocumentQATokens(text) }

func documentQASourceKey(segment DocumentQASegment) string {
	return fmt.Sprintf("%d:%d", segment.FileID, segment.Index)
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	unique := make([]string, 0, len(values))
	for _, value := range values {
		if _, ok := seen[value]; !ok {
			seen[value] = struct{}{}
			unique = append(unique, value)
		}
	}
	return unique
}

func filterDocumentQASummaryReferences(references, allowed []string) []string {
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, key := range allowed {
		allowedSet[key] = struct{}{}
	}
	filtered := make([]string, 0, len(references))
	for _, key := range references {
		if _, ok := allowedSet[key]; ok {
			filtered = append(filtered, key)
		}
	}
	return uniqueStrings(filtered)
}

func noteReferences(notes []DocumentQASummaryNote) []string {
	var references []string
	for _, note := range notes {
		references = append(references, note.References...)
	}
	return uniqueStrings(references)
}

func addSummaryStats(left, right DocumentQASummaryStats) DocumentQASummaryStats {
	left.Total += right.Total
	left.Processed += right.Processed
	left.Failed += right.Failed
	return left
}

func incompleteDocumentQASummary(notes []DocumentQASummaryNote) string {
	var content strings.Builder
	content.WriteString("整体综合未完成。已获得的分段笔记：")
	for _, note := range notes {
		content.WriteString("\n")
		content.WriteString(note.Content)
	}
	return content.String()
}
