package rag

import (
	"strings"

	"github.com/53AI/53AIHub/service/hub_adaptor/openai"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

type DocumentQATask string

const (
	DocumentQATaskLookup    DocumentQATask = "lookup"
	DocumentQATaskCompare   DocumentQATask = "compare"
	DocumentQATaskSummarize DocumentQATask = "summarize"
)

type DocumentQAStrategy string

const (
	DocumentQAStrategyFullDocument DocumentQAStrategy = "full_document"
	DocumentQAStrategyRetrieval    DocumentQAStrategy = "retrieval"
	DocumentQAStrategyMapReduce    DocumentQAStrategy = "map_reduce"
)

type DocumentQACoverage string

const (
	DocumentQACoverageComplete    DocumentQACoverage = "complete"
	DocumentQACoveragePartial     DocumentQACoverage = "partial"
	DocumentQACoverageUnavailable DocumentQACoverage = "unavailable"
)

type DocumentQAPlan struct {
	Task                 DocumentQATask
	Strategy             DocumentQAStrategy
	Coverage             DocumentQACoverage // availability of requested source text before processing
	RequiredInputTokens  int
	AvailableInputTokens int
}

func DetectDocumentQATask(query string) DocumentQATask {
	lowerQuery := strings.ToLower(query)
	for _, marker := range []string{"比较", "对比", "差异", "异同", "区别"} {
		if strings.Contains(query, marker) {
			return DocumentQATaskCompare
		}
	}
	for _, marker := range []string{"总结", "概括", "梳理", "归纳", "主要内容", "摘要", "逐章", "每章", "所有章节", "全篇", "全文总结", "全文概括", "全文要点", "讲了什么", "说了什么", "讲什么", "说什么"} {
		if strings.Contains(query, marker) {
			return DocumentQATaskSummarize
		}
	}
	for _, marker := range []string{"summarize", "summarise", "summary", "entire document", "whole document", "all chapters", "key points of each chapter"} {
		if strings.Contains(lowerQuery, marker) {
			return DocumentQATaskSummarize
		}
	}
	return DocumentQATaskLookup
}

func BuildDocumentQAPlan(task DocumentQATask, documents []DocumentQAContent, availableInputTokens int, modelName string) DocumentQAPlan {
	plan := DocumentQAPlan{
		Task:                 task,
		Strategy:             DocumentQAStrategyRetrieval,
		Coverage:             DocumentQACoverageUnavailable,
		AvailableInputTokens: availableInputTokens,
	}
	if len(documents) == 0 {
		return plan
	}

	var input strings.Builder
	missingDocument := false
	availableDocuments := 0
	for _, document := range documents {
		if strings.TrimSpace(document.Content) == "" {
			missingDocument = true
			continue
		}
		availableDocuments++
		input.WriteString(document.Content)
		input.WriteString("\n")
	}
	if availableDocuments == 0 {
		return plan
	}
	plan.RequiredInputTokens = openai.CountTokenMessages([]relaymodel.Message{{Role: "system", Content: input.String()}}, modelName)
	plan.Coverage = DocumentQACoverageComplete
	if missingDocument {
		plan.Coverage = DocumentQACoveragePartial
	}
	if availableInputTokens > 0 && plan.RequiredInputTokens <= availableInputTokens {
		plan.Strategy = DocumentQAStrategyFullDocument
		return plan
	}
	plan.Coverage = DocumentQACoveragePartial
	if task == DocumentQATaskSummarize {
		plan.Strategy = DocumentQAStrategyMapReduce
		if !missingDocument {
			plan.Coverage = DocumentQACoverageComplete
		}
	}
	return plan
}
