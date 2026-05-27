package pipelines

// init 初始化函数，注册所有流水线
func init() {
	// 注册 Hello 流水线
	RegisterPipeline("hello", func() Pipeline {
		return NewHelloPipeline()
	})

	// 注册 Reindex 流水线
	RegisterPipeline("reindex", func() Pipeline {
		return NewReindexPipeline()
	})

	// 注册 RechunkAndReindex 流水线
	RegisterPipeline("rechunk_and_reindex", func() Pipeline {
		return NewRechunkAndReindexPipeline()
	})

	// 注册 GenerateQuestionsAndSummary 流水线
	RegisterPipeline("generate_questions_and_summary", func() Pipeline {
		return NewGenerateQuestionsAndSummaryPipeline()
	})

	// 注册 GenerateKnowledgeMap 流水线
	RegisterPipeline("generate_knowledge_map", func() Pipeline {
		return NewGenerateKnowledgeMapPipeline()
	})
}
