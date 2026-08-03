package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

// prompt1SystemPrompt 逐字稿规范化 System Prompt（Prompt 1）。
const prompt1SystemPrompt = `你是一个企业会议逐字稿规范化引擎。

你的任务是将 ASR 语音识别结果整理为更易阅读、更适合后续会议纪要和实体抽取的修正版逐字稿。

你只能修正表达形式，不能改变发言人的真实意思，不能加入经营判断，不能生成会议总结。

你需要处理：
1. 恢复标点和断句；
2. 删除无意义的语气词和机械重复；
3. 保留具有语义价值的重复、犹豫、否定和程度表达；
4. 根据上下文修正高置信度的 ASR 错词；
5. 统一明确出现的人名、公司名、项目名和产品名；
6. 保留说话人和时间戳；
7. 对不确定内容标记 uncertain，不得擅自补全；
8. 不得把"可能、我觉得、好像"修改为确定事实；
9. 不得把提议修改为已经形成的决策；
10. 不得把讨论中的行动修改为已经完成的行动。

必须同时保留 raw_text 和 normalized_text。

严格输出 JSON，不输出 Markdown，不输出解释。

输出格式：
{
  "transcript_version": "1.0",
  "segments": [
    {
      "segment_id": "seg_001",
      "speaker": "",
      "start_time": "",
      "end_time": "",
      "raw_text": "",
      "normalized_text": "",
      "uncertain": false,
      "corrections": []
    }
  ],
  "detected_terms": []
}`

// normalizeTranscript 调用 Prompt 1 对转写文本进行规范化。
//
// 如果调用失败，返回原始文本和 error，调用方决定是否降级使用原始文本。
func normalizeTranscript(ctx context.Context, config *model.RecordingConfig, transcript string) (string, error) {
	channel, err := model.GetChannelByID(config.InferenceModelID)
	if err != nil {
		return transcript, fmt.Errorf("获取推理模型渠道失败: %w", err)
	}

	userPrompt := fmt.Sprintf(`请规范化以下原始语音逐字稿。

<raw_transcript>
%s
</raw_transcript>

严格按照系统规定输出 JSON。`, transcript)

	request := &relaymodel.GeneralOpenAIRequest{
		Model: config.InferenceModelName,
		Messages: []relaymodel.Message{
			{Role: "system", Content: prompt1SystemPrompt},
			{Role: "user", Content: userPrompt},
		},
	}

	ctxTimeout, cancel := context.WithTimeout(ctx, 180*time.Second)
	defer cancel()

	llmSemaphore <- struct{}{}
	generator := rag.NewContentGeneratorService(model.DB)
	result, err, openAIErr := generator.TestChannel(ctxTimeout, channel, request)
	<-llmSemaphore
	if err != nil {
		return transcript, fmt.Errorf("Prompt 1 调用失败: %w (openai_err=%v)", err, openAIErr)
	}

	normalized, err := extractNormalizedText(result)
	if err != nil {
		return transcript, fmt.Errorf("解析 Prompt 1 结果失败: %w", err)
	}

	return normalized, nil
}

// prompt1Result Prompt 1 返回的 JSON 结构（仅解析需要的字段）。
type prompt1Result struct {
	TranscriptVersion string            `json:"transcript_version"`
	Segments          []prompt1Segment  `json:"segments"`
	DetectedTerms     []json.RawMessage `json:"detected_terms"`
}

type prompt1Segment struct {
	SegmentID      string `json:"segment_id"`
	Speaker        string `json:"speaker"`
	StartTime      string `json:"start_time"`
	EndTime        string `json:"end_time"`
	RawText        string `json:"raw_text"`
	NormalizedText string `json:"normalized_text"`
	Uncertain      bool   `json:"uncertain"`
}

// extractNormalizedText 从 Prompt 1 返回的 JSON 中提取规范化后的纯文本。
func extractNormalizedText(rawJSON string) (string, error) {
	var result prompt1Result
	if err := json.Unmarshal([]byte(rawJSON), &result); err != nil {
		// 尝试清理 LLM 常见的前缀/后缀噪声
		cleaned := cleanLLMJSONOutput(rawJSON)
		if err := json.Unmarshal([]byte(cleaned), &result); err != nil {
			return "", fmt.Errorf("解析 Prompt 1 JSON 失败: %w", err)
		}
	}

	if len(result.Segments) == 0 {
		return "", fmt.Errorf("Prompt 1 返回的 segments 为空")
	}

	var texts []string
	for _, seg := range result.Segments {
		text := strings.TrimSpace(seg.NormalizedText)
		if text == "" {
			text = strings.TrimSpace(seg.RawText)
		}
		if text != "" {
			if seg.Speaker != "" {
				text = fmt.Sprintf("[%s] %s", seg.Speaker, text)
			}
			texts = append(texts, text)
		}
	}

	if len(texts) == 0 {
		return "", fmt.Errorf("规范化后的文本为空")
	}

	return strings.Join(texts, "\n\n"), nil
}

// cleanLLMJSONOutput 清理 LLM 输出中常见的 Markdown 代码块包裹。
func cleanLLMJSONOutput(raw string) string {
	raw = strings.TrimSpace(raw)
	// 移除 ```json ... ``` 包裹
	if strings.HasPrefix(raw, "```") {
		raw = strings.TrimPrefix(raw, "```json")
		raw = strings.TrimPrefix(raw, "```")
		if idx := strings.LastIndex(raw, "```"); idx >= 0 {
			raw = raw[:idx]
		}
	}
	return strings.TrimSpace(raw)
}