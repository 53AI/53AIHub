package steps

import (
	"github.com/53AI/53AIHub/common/logger"
)

type HelloWorldStep struct {
	BaseStep
	StepProcessor
}

type HelloWorldParameters struct {
	Message string `json:"message"`
}

type HelloWorldResult struct {
	ProcessedMessage string `json:"processed_message"`
	Timestamp        int64  `json:"timestamp"`
}

func (h *HelloWorldStep) Execute(parameters any) error {
	h.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(HelloWorldParameters)
	if !ok {
		h.Step.CompleteWithError("Invalid parameters type")
		return nil
	}

	// 处理消息
	processedMessage := "Processed: " + params.Message
	logger.SysLogf("HelloWorldStep Execute: %s", processedMessage)

	// 创建结果
	result := HelloWorldResult{
		ProcessedMessage: processedMessage,
		Timestamp:        h.Step.StartTime,
	}

	// 完成步骤并返回结果
	h.Step.CompleteSuccessfully(result)
	return nil
}
