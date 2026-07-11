package docconv

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	openapi "github.com/alibabacloud-go/darabonba-openapi/v2/client"
	util "github.com/alibabacloud-go/tea-utils/v2/service"
	"github.com/alibabacloud-go/tea/tea"
	tingwu "github.com/alibabacloud-go/tingwu-20230930/v2/client"
)

// ConvertResponse 转换响应
type ConvertResponse struct {
	Content        string                 `json:"content"`
	Summary        string                 `json:"summary"`         // 全文概要（Markdown格式）
	InsightSummary string                 `json:"insight_summary"` // 完整的洞察内容（JSON格式）
	Metadata       map[string]interface{} `json:"metadata"`
}

// TingWuConfig 通义听悟配置结构体，用于API调用
type TingWuConfig struct {
	AccessKeyId     string `json:"access_key_id"`
	AccessKeySecret string `json:"access_key_secret"`
	Endpoint        string `json:"endpoint"`
	AppKey          string `json:"app_key"`
}

// TingWuClient 通义听悟客户端
type TingWuClient struct {
	client     *tingwu.Client
	config     *TingWuConfig
	httpClient *http.Client
}

func NewTingWuClient(config *TingWuConfig) (*TingWuClient, error) {
	if config.AccessKeyId == "" || config.AccessKeySecret == "" || config.Endpoint == "" || config.AppKey == "" {
		return nil, fmt.Errorf("tingwu client 配置不完整: AccessKeyId, AccessKeySecret, Endpoint 和 AppKey 不能为空")
	}

	client, err := tingwu.NewClient(&openapi.Config{
		AccessKeyId:     tea.String(config.AccessKeyId),
		AccessKeySecret: tea.String(config.AccessKeySecret),
		Endpoint:        tea.String(config.Endpoint),
	})
	if err != nil {
		return nil, fmt.Errorf("创建 tingwu client 失败: %w", err)
	}

	return &TingWuClient{
		client:     client,
		config:     config,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}, nil
}

// SubmitJob 提交音频/视频处理任务
func (c *TingWuClient) SubmitJob(ctx context.Context, req *ConvertRequest) (*ConvertResponse, error) {
	taskID, err := c.createTask(ctx, req.SourceURL)
	if err != nil {
		return nil, fmt.Errorf("tingwu create task error: %w", err)
	}

	return &ConvertResponse{
		Content:  "",
		Summary:  "",
		Metadata: map[string]interface{}{"task_id": taskID},
	}, nil
}

// SubmitJobWithProgress 提交音频/视频处理任务并返回任务ID（保留此方法以兼容接口）
func (c *TingWuClient) SubmitJobWithProgress(ctx context.Context, req *ConvertRequest) (*ConvertResponse, error) {
	return c.SubmitJob(ctx, req)
}

// createTask 创建通义听悟处理任务
func (c *TingWuClient) createTask(ctx context.Context, sourceURL string) (string, error) {
	// 创建CreateTask请求参数，根据API文档调整参数结构
	input := &tingwu.CreateTaskRequestInput{
		SourceLanguage: tea.String("fspk"),                                    // 根据API文档设置语言
		TaskKey:        tea.String(fmt.Sprintf("task_%d", time.Now().Unix())), // 任务唯一标识
		FileUrl:        tea.String(sourceURL),
	}

	// 设置参数，根据API文档包含需要的功能
	parameters := &tingwu.CreateTaskRequestParameters{
		AutoChaptersEnabled: tea.Bool(true),
		AutoChapters: &tingwu.CreateTaskRequestParametersAutoChapters{
			ChapterGranularity: tea.String("General"),
		},
		SummarizationEnabled: tea.Bool(true),
		Summarization: &tingwu.CreateTaskRequestParametersSummarization{
			Types: []*string{
				tea.String("Paragraph"),
				tea.String("Conversational"),
				tea.String("QuestionsAnswering"),
				tea.String("MindMap"),
			},
		},
		MeetingAssistanceEnabled: tea.Bool(true),
		MeetingAssistance: &tingwu.CreateTaskRequestParametersMeetingAssistance{
			Types: []*string{
				tea.String("Actions"),
				tea.String("KeyInformation"),
			},
		},
		Transcription: &tingwu.CreateTaskRequestParametersTranscription{
			DiarizationEnabled: tea.Bool(true),
			Diarization: &tingwu.CreateTaskRequestParametersTranscriptionDiarization{
				SpeakerCount: tea.Int32(0),
			},
		},
	}

	request := &tingwu.CreateTaskRequest{
		AppKey:     tea.String(c.config.AppKey),
		Input:      input,
		Parameters: parameters,
		Type:       tea.String("offline"), // 设置为离线处理类型
	}

	// 使用WithOptions方式发送请求，添加运行时选项
	headers := make(map[string]*string)
	runtime := &util.RuntimeOptions{}

	// 发送请求
	response, err := c.client.CreateTaskWithOptions(request, headers, runtime)
	if err != nil {
		return "", fmt.Errorf("create task request error: %w", err)
	}

	// 检查响应是否成功 - 根据API文档，Code为0表示成功
	if tea.StringValue(response.Body.Code) != "0" {
		return "", fmt.Errorf("create task api error, code: %s, message: %s",
			tea.StringValue(response.Body.Code),
			tea.StringValue(response.Body.Message))
	}

	// 提取任务ID
	if response.Body.Data != nil && response.Body.Data.TaskId != nil {
		return tea.StringValue(response.Body.Data.TaskId), nil
	}

	return "", fmt.Errorf("create task response does not contain task id: %v", response)
}

// 定义通义听悟API响应结构体
type TaskInfoResponse struct {
	RequestId string   `json:"request_id"`
	Code      int      `json:"code"`
	Message   string   `json:"message"`
	Data      TaskInfo `json:"data"`
}

type TaskInfo struct {
	TaskId              string             `json:"task_id"`
	TaskKey             string             `json:"task_key"`
	TaskStatus          string             `json:"task_status"`
	OutputMp3Path       string             `json:"output_mp3_path"`
	OutputMp4Path       string             `json:"output_mp4_path"`
	OutputThumbnailPath string             `json:"output_thumbnail_path"`
	OutputSpectrumPath  string             `json:"output_spectrum_path"`
	ErrorCode           string             `json:"error_code"`
	ErrorMessage        string             `json:"error_message"`
	Result              TaskResultResponse `json:"result"`
}

type TaskResultResponse struct {
	Transcription       string `json:"transcription"`
	AutoChapters        string `json:"auto_chapters"`
	MeetingAssistance   string `json:"meeting_assistance"`
	Summarization       string `json:"summarization"`
	Translation         string `json:"translation"`
	PptExtraction       string `json:"ppt_extraction"`
	TextPolish          string `json:"text_polish"`
	CustomPrompt        string `json:"custom_prompt"`
	ServiceInspection   string `json:"service_inspection"`
	IdentityRecognition string `json:"identity_recognition"`
	ContentExtraction   string `json:"content_extraction"`
}

// taskInfo 任务信息结构体，用于轮询时的状态跟踪
type taskInfo struct {
	TaskId              string              `json:"task_id"`
	TaskKey             string              `json:"task_key"`
	TaskStatus          string              `json:"task_status"`
	OutputMp3Path       string              `json:"output_mp3_path"`
	OutputMp4Path       string              `json:"output_mp4_path"`
	OutputThumbnailPath string              `json:"output_thumbnail_path"`
	OutputSpectrumPath  string              `json:"output_spectrum_path"`
	ErrorCode           string              `json:"error_code"`
	ErrorMessage        string              `json:"error_message"`
	Result              *TaskResultResponse `json:"result"`
	Status              string              `json:"status"`     // 兼容字段，等于TaskStatus
	Progress            int                 `json:"progress"`   // 进度信息
	Title               string              `json:"title"`      // 任务标题
	SourceUri           string              `json:"source_uri"` // 源URI
	ResultUri           string              `json:"result_uri"` // 结果URI
}

// getTaskInfo 获取任务信息
func (c *TingWuClient) getTaskInfo(ctx context.Context, taskID string) (*taskInfo, error) {
	response, err := c.client.GetTaskInfoWithOptions(&taskID, make(map[string]*string), &util.RuntimeOptions{})
	if err != nil {
		return nil, fmt.Errorf("get task info request error: %w", err)
	}

	// 检查响应是否成功 - 根据API文档，Code为0表示成功
	codeStr := tea.StringValue(response.Body.Code)
	codeVal, err := strconv.Atoi(codeStr)
	if err != nil {
		return nil, fmt.Errorf("parse response code error: %w", err)
	}
	if codeVal != 0 {
		return nil, fmt.Errorf("get task info api error, code: %d, message: %s",
			codeVal,
			tea.StringValue(response.Body.Message))
	}

	// 提取任务信息
	data := response.Body.Data
	taskInfo := &taskInfo{
		TaskId:              tea.StringValue(data.TaskId),
		TaskKey:             tea.StringValue(data.TaskKey),
		TaskStatus:          tea.StringValue(data.TaskStatus),
		OutputMp3Path:       tea.StringValue(data.OutputMp3Path),
		OutputMp4Path:       tea.StringValue(data.OutputMp4Path),
		OutputThumbnailPath: tea.StringValue(data.OutputThumbnailPath),
		OutputSpectrumPath:  tea.StringValue(data.OutputSpectrumPath),
		ErrorCode:           tea.StringValue(data.ErrorCode),
		ErrorMessage:        tea.StringValue(data.ErrorMessage),
		Result:              convertResultData(data.Result),
	}

	// 根据实际可用的字段设置状态
	if data.TaskStatus != nil {
		taskInfo.Status = tea.StringValue(data.TaskStatus)
	} else {
		taskInfo.Status = "UNKNOWN"
	}

	// 根据任务状态设置进度
	taskInfo.Progress = calculateProgress(taskInfo.Status)

	// 任务信息补充
	taskInfo.Title = ""
	taskInfo.SourceUri = ""
	taskInfo.ResultUri = ""

	return taskInfo, nil
}

// calculateProgress 根据任务状态计算进度
func calculateProgress(status string) int {
	switch status {
	case "CREATED":
		return 10 // 刚创建
	case "PROCESSING":
		return 50 // 处理中
	case "COMPLETED":
		return 100 // 完成
	case "FAILED", "FAIL":
		return 0 // 失败
	default:
		return 0
	}
}

// getResult 获取处理结果
func (c *TingWuClient) getResult(ctx context.Context, taskInfo *taskInfo) (*ConvertResponse, error) {
	logger.Infof(ctx, "🚀🚀🚀 [TINGWU-NEW-CODE] getResult 方法开始执行 - task_id=%s", taskInfo.TaskId)

	contentBuilder := strings.Builder{}
	var transcriptionContent string
	var transcriptionJSON string
	var paragraphs []TranscriptionParagraph
	hasValidTranscription := false // 标记是否有有效的转录内容

	if taskInfo.Result != nil && taskInfo.Result.Transcription != "" {
		trans, err := c.fetchContentFromURL(ctx, taskInfo.Result.Transcription)
		if err != nil {
			logger.Warnf(ctx, "[TINGWU] failed to fetch transcription URL: %v", err)
		} else {
			transcriptionJSON = trans
			preview := transcriptionJSON
			if len(preview) > 200 {
				preview = preview[:200] + "..."
			}
			logger.Infof(ctx, "[TINGWU] fetched transcription JSON: len=%d, preview=%s", len(transcriptionJSON), preview)

			var transcription TranscriptionData
			if err := json.Unmarshal([]byte(transcriptionJSON), &transcription); err != nil {
				logger.Warnf(ctx, "[TINGWU] failed to parse transcription JSON: %v, json_len=%d", err, len(transcriptionJSON))
				transcriptionContent = transcriptionJSON
			} else {
				paragraphs = transcription.Transcription.Paragraphs
				logger.Infof(ctx, "[TINGWU] parsed transcription: task_id=%s, paragraphs_count=%d, audio_info_duration=%d",
					transcription.TaskId, len(paragraphs), transcription.Transcription.AudioInfo.Duration)
				transcriptionContent = buildTranscriptionMarkdown(&transcription)
				hasValidTranscription = true // 成功解析转录内容
			}

			contentBuilder.WriteString("## 音频/视频转录内容\n")
			contentBuilder.WriteString(transcriptionContent)
			contentBuilder.WriteString("\n\n")
		}
	} else {
		logger.Warnf(ctx, "[TINGWU] no transcription URL in result: result_nil=%v, transcription_empty=%v",
			taskInfo.Result == nil,
			taskInfo.Result == nil || taskInfo.Result.Transcription == "")
	}

	// 只有当有有效转录内容时才设置段落，否则保持为空切片
	if !hasValidTranscription {
		paragraphs = []TranscriptionParagraph{} // 确保是空切片而非nil
		logger.Infof(ctx, "[TINGWU] 无有效转录内容，paragraphs 设为空切片")
	}

	logger.Infof(ctx, "[TINGWU] transcriptionContent 状态: len=%d, hasValidTranscription=%v, paragraphs_count=%d",
		len(transcriptionContent), hasValidTranscription, len(paragraphs))

	summaryData := &TingwuSummaryData{
		Keywords:                  []string{},
		KeySentences:              []KeySentenceItem{},
		AutoChapters:              []AutoChapterItem{},
		ConversationalSummary:     []ConversationalItem{},
		QuestionsAnsweringSummary: []QuestionsAnsweringItem{},
		MindMapSummary:            []MindMapItem{},
		Actions:                   []ActionItem{},
		Classifications:           ClassificationData{},
		Paragraphs:                paragraphs, // 根据转录状态决定是否有段落
	}

	if taskInfo.Result != nil && taskInfo.Result.AutoChapters != "" {
		autoChaptersContent, err := c.fetchContentFromURL(ctx, taskInfo.Result.AutoChapters)
		if err == nil {
			var acResult AutoChaptersResult
			if err := json.Unmarshal([]byte(autoChaptersContent), &acResult); err == nil {
				if acResult.AutoChapters != nil {
					summaryData.AutoChapters = acResult.AutoChapters
				}
				contentBuilder.WriteString("## 章节速览\n")
				for _, chapter := range summaryData.AutoChapters {
					contentBuilder.WriteString(fmt.Sprintf("### %s\n", chapter.Headline))
					contentBuilder.WriteString(fmt.Sprintf("%s\n\n", chapter.Summary))
				}
			}
		}
	}

	if taskInfo.Result != nil && taskInfo.Result.MeetingAssistance != "" {
		meetingAssistanceContent, err := c.fetchContentFromURL(ctx, taskInfo.Result.MeetingAssistance)
		if err == nil {
			var maResult MeetingAssistanceResult
			if err := json.Unmarshal([]byte(meetingAssistanceContent), &maResult); err == nil {
				if maResult.MeetingAssistance.Keywords != nil {
					summaryData.Keywords = maResult.MeetingAssistance.Keywords
				}
				if maResult.MeetingAssistance.KeySentences != nil {
					summaryData.KeySentences = maResult.MeetingAssistance.KeySentences
				}
				if maResult.MeetingAssistance.Actions != nil {
					summaryData.Actions = maResult.MeetingAssistance.Actions
				}
				if maResult.MeetingAssistance.Classifications != nil {
					summaryData.Classifications = *maResult.MeetingAssistance.Classifications
				}

				if len(maResult.MeetingAssistance.Keywords) > 0 {
					contentBuilder.WriteString("## 关键词\n")
					contentBuilder.WriteString(strings.Join(maResult.MeetingAssistance.Keywords, "、"))
					contentBuilder.WriteString("\n\n")
				}

				if len(maResult.MeetingAssistance.KeySentences) > 0 {
					contentBuilder.WriteString("## 重点内容\n")
					for _, ks := range maResult.MeetingAssistance.KeySentences {
						contentBuilder.WriteString(fmt.Sprintf("- %s\n", ks.Text))
					}
					contentBuilder.WriteString("\n")
				}

				if len(maResult.MeetingAssistance.Actions) > 0 {
					contentBuilder.WriteString("## 待办事项\n")
					for _, action := range maResult.MeetingAssistance.Actions {
						contentBuilder.WriteString(fmt.Sprintf("- %s\n", action.Text))
					}
					contentBuilder.WriteString("\n")
				}
			}
		}
	}

	if taskInfo.Result != nil && taskInfo.Result.Summarization != "" {
		summaryContent, err := c.fetchContentFromURL(ctx, taskInfo.Result.Summarization)
		if err == nil {
			var sumResult SummarizationResult
			if err := json.Unmarshal([]byte(summaryContent), &sumResult); err == nil {
				summaryData.ParagraphSummary = sumResult.Summarization.ParagraphSummary
				if sumResult.Summarization.ConversationalSummary != nil {
					summaryData.ConversationalSummary = sumResult.Summarization.ConversationalSummary
				}
				if sumResult.Summarization.QuestionsAnsweringSummary != nil {
					summaryData.QuestionsAnsweringSummary = sumResult.Summarization.QuestionsAnsweringSummary
				}
				if sumResult.Summarization.MindMapSummary != nil {
					summaryData.MindMapSummary = sumResult.Summarization.MindMapSummary
				}

				if sumResult.Summarization.ParagraphSummary != "" {
					contentBuilder.WriteString("## 全文概要\n")
					contentBuilder.WriteString(sumResult.Summarization.ParagraphSummary)
					contentBuilder.WriteString("\n\n")
				}

				if len(sumResult.Summarization.ConversationalSummary) > 0 {
					contentBuilder.WriteString("## 发言总结\n")
					for _, conv := range sumResult.Summarization.ConversationalSummary {
						contentBuilder.WriteString(fmt.Sprintf("### %s\n%s\n\n", conv.SpeakerName, conv.Summary))
					}
				}

				if len(sumResult.Summarization.QuestionsAnsweringSummary) > 0 {
					contentBuilder.WriteString("## 问答回顾\n")
					for _, qa := range sumResult.Summarization.QuestionsAnsweringSummary {
						contentBuilder.WriteString(fmt.Sprintf("**Q:** %s\n**A:** %s\n\n", qa.Question, qa.Answer))
					}
				}

				if len(sumResult.Summarization.MindMapSummary) > 0 {
					contentBuilder.WriteString("## 思维导图\n")
					contentBuilder.WriteString(renderMindMap(sumResult.Summarization.MindMapSummary, 0))
					contentBuilder.WriteString("\n")
				}
			}
		}
	}

	summaryJSON, err := json.Marshal(summaryData)
	if err != nil {
		logger.Errorf(ctx, "[TINGWU] failed to marshal summary data: %v", err)
	}

	logger.Infof(ctx, "[TINGWU] summaryData: paragraphs_count=%d, keywords_count=%d, auto_chapters_count=%d, paragraph_summary_len=%d",
		len(summaryData.Paragraphs), len(summaryData.Keywords), len(summaryData.AutoChapters), len(summaryData.ParagraphSummary))

	insightSummary := string(summaryJSON)

	summary := "音频/视频处理完成"
	if summaryData.ParagraphSummary != "" {
		summary = "## 全文概要\n" + summaryData.ParagraphSummary
	}

	logger.Infof(ctx, "[TINGWU] getResult final: task_id=%s, content_len=%d, summary_len=%d, insight_summary_len=%d",
		taskInfo.TaskId, len(transcriptionContent), len(summary), len(insightSummary))

	var resultTranscription, resultSummarization string
	if taskInfo.Result != nil {
		resultTranscription = taskInfo.Result.Transcription
		resultSummarization = taskInfo.Result.Summarization
	}

	metadata := map[string]interface{}{
		"task_id":               taskInfo.TaskId,
		"task_key":              taskInfo.TaskKey,
		"result_uri":            taskInfo.ResultUri,
		"result_transcription":  resultTranscription,
		"result_summarization":  resultSummarization,
		"output_mp3_path":       taskInfo.OutputMp3Path,
		"output_mp4_path":       taskInfo.OutputMp4Path,
		"output_thumbnail_path": taskInfo.OutputThumbnailPath,
		"output_spectrum_path":  taskInfo.OutputSpectrumPath,
		"error_code":            taskInfo.ErrorCode,
		"error_message":         taskInfo.ErrorMessage,
	}

	return &ConvertResponse{
		Content:        transcriptionContent,
		Summary:        summary,
		InsightSummary: string(summaryJSON),
		Metadata:       metadata,
	}, nil
}

// TranscriptionData represents the structure of the transcription JSON
type TranscriptionData struct {
	TaskId        string               `json:"TaskId"`
	Transcription TranscriptionContent `json:"Transcription"`
}

type TranscriptionContent struct {
	AudioInfo     TranscriptionAudioInfo   `json:"AudioInfo"`
	Paragraphs    []TranscriptionParagraph `json:"Paragraphs"`
	AudioSegments [][]int                  `json:"AudioSegments"`
}

type TranscriptionAudioInfo struct {
	Size       int    `json:"Size"`
	Duration   int    `json:"Duration"`
	SampleRate int    `json:"SampleRate"`
	Language   string `json:"Language"`
}

type TranscriptionParagraph struct {
	ParagraphId string              `json:"ParagraphId"`
	SpeakerId   string              `json:"SpeakerId"`
	Words       []TranscriptionWord `json:"Words"`
}

type TranscriptionWord struct {
	Id         int    `json:"Id"`
	SentenceId int    `json:"SentenceId"`
	Start      int    `json:"Start"`
	End        int    `json:"End"`
	Text       string `json:"Text"`
}

// buildTranscriptionMarkdown generates markdown from parsed transcription data
func buildTranscriptionMarkdown(transcription *TranscriptionData) string {
	var result strings.Builder

	if len(transcription.Transcription.Paragraphs) == 0 {
		return "转录内容为空"
	}

	// Group paragraphs by speaker
	currentSpeaker := ""
	var speakerStartTime int
	var speakerEndTime int
	var speakerTexts []string

	for i, paragraph := range transcription.Transcription.Paragraphs {
		// Get the start and end time of this paragraph
		if len(paragraph.Words) == 0 {
			if i == len(transcription.Transcription.Paragraphs)-1 && currentSpeaker != "" {
				writeSpeakerSection(&result, currentSpeaker, speakerStartTime, speakerEndTime, speakerTexts)
			}
			continue
		}
		paragraphStartTime := paragraph.Words[0].Start
		paragraphEndTime := paragraph.Words[len(paragraph.Words)-1].End

		// If speaker changes or it's the first paragraph
		if currentSpeaker != paragraph.SpeakerId {
			// Write the previous speaker's content if there is one
			if currentSpeaker != "" {
				writeSpeakerSection(&result, currentSpeaker, speakerStartTime, speakerEndTime, speakerTexts)
			}

			// Initialize for new speaker
			currentSpeaker = paragraph.SpeakerId
			speakerStartTime = paragraphStartTime
			speakerEndTime = paragraphEndTime
			speakerTexts = []string{}
		} else {
			// Same speaker, update the end time if this paragraph ends later
			if paragraphEndTime > speakerEndTime {
				speakerEndTime = paragraphEndTime
			}
		}

		// Collect the text for this paragraph
		var paragraphTexts []string
		for _, word := range paragraph.Words {
			paragraphTexts = append(paragraphTexts, word.Text)
		}

		text := strings.Join(paragraphTexts, "")
		speakerTexts = append(speakerTexts, text)

		// If this is the last paragraph, write the final section for the current speaker
		if i == len(transcription.Transcription.Paragraphs)-1 {
			writeSpeakerSection(&result, currentSpeaker, speakerStartTime, speakerEndTime, speakerTexts)
		}
	}

	return result.String()
}

// formatTime converts milliseconds to MM:SS format
func formatTime(ms int) string {
	totalSeconds := ms / 1000
	minutes := totalSeconds / 60
	seconds := totalSeconds % 60
	return fmt.Sprintf("%02d:%02d", minutes, seconds)
}

// writeSpeakerSection writes a speaker's section in markdown format
func writeSpeakerSection(builder *strings.Builder, speakerId string, startMs, endMs int, texts []string) {
	startTime := formatTime(startMs)
	endTime := formatTime(endMs)

	fmt.Fprintf(builder, "## %s\n", speakerId)
	fmt.Fprintf(builder, "> %s - %s\n", startTime, endTime)

	for _, text := range texts {
		builder.WriteString(text)
	}
	builder.WriteString("\n\n")
}

// fetchContentFromURL 从URL获取内容
func (c *TingWuClient) fetchContentFromURL(ctx context.Context, url string) (string, error) {
	if url == "" {
		return "", nil
	}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to fetch content from URL: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("failed to fetch content, status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response body: %w", err)
	}

	return string(body), nil
}

// convertResultData 将API返回的结果数据转换为内部使用的TaskResultResponse类型
func convertResultData(apiResult *tingwu.GetTaskInfoResponseBodyDataResult) *TaskResultResponse {
	if apiResult == nil {
		return nil
	}

	return &TaskResultResponse{
		Transcription:       tea.StringValue(apiResult.Transcription),
		AutoChapters:        tea.StringValue(apiResult.AutoChapters),
		MeetingAssistance:   tea.StringValue(apiResult.MeetingAssistance),
		Summarization:       tea.StringValue(apiResult.Summarization),
		Translation:         tea.StringValue(apiResult.Translation),
		PptExtraction:       tea.StringValue(apiResult.PptExtraction),
		TextPolish:          tea.StringValue(apiResult.TextPolish),
		CustomPrompt:        tea.StringValue(apiResult.CustomPrompt),
		ServiceInspection:   tea.StringValue(apiResult.ServiceInspection),
		IdentityRecognition: tea.StringValue(apiResult.IdentityRecognition),
		ContentExtraction:   tea.StringValue(apiResult.ContentExtraction),
	}
}

type AutoChaptersResult struct {
	TaskId       string            `json:"TaskId"`
	AutoChapters []AutoChapterItem `json:"AutoChapters"`
}

type AutoChapterItem struct {
	Id       int    `json:"Id"`
	Start    int64  `json:"Start"`
	End      int64  `json:"End"`
	Headline string `json:"Headline"`
	Summary  string `json:"Summary"`
}

type MeetingAssistanceResult struct {
	TaskId            string                `json:"TaskId"`
	MeetingAssistance MeetingAssistanceData `json:"MeetingAssistance"`
}

type MeetingAssistanceData struct {
	Keywords        []string            `json:"Keywords"`
	KeySentences    []KeySentenceItem   `json:"KeySentences"`
	Actions         []ActionItem        `json:"Actions"`
	Classifications *ClassificationData `json:"Classifications,omitempty"`
}

type KeySentenceItem struct {
	Id         int64  `json:"Id"`
	SentenceId int64  `json:"SentenceId"`
	Start      int64  `json:"Start"`
	End        int64  `json:"End"`
	Text       string `json:"Text"`
}

type ActionItem struct {
	Id         int64  `json:"Id"`
	SentenceId int64  `json:"SentenceId"`
	Start      int64  `json:"Start"`
	End        int64  `json:"End"`
	Text       string `json:"Text"`
}

type ClassificationData struct {
	Interview float64 `json:"Interview"`
	Lecture   float64 `json:"Lecture"`
	Meeting   float64 `json:"Meeting"`
}

type SummarizationResult struct {
	TaskId        string            `json:"TaskId"`
	Summarization SummarizationData `json:"Summarization"`
}

type SummarizationData struct {
	ParagraphSummary          string                   `json:"ParagraphSummary"`
	ConversationalSummary     []ConversationalItem     `json:"ConversationalSummary"`
	QuestionsAnsweringSummary []QuestionsAnsweringItem `json:"QuestionsAnsweringSummary"`
	MindMapSummary            []MindMapItem            `json:"MindMapSummary"`
}

type ConversationalItem struct {
	SpeakerId   string `json:"SpeakerId"`
	SpeakerName string `json:"SpeakerName"`
	Summary     string `json:"Summary"`
}

type QuestionsAnsweringItem struct {
	Question              string  `json:"Question"`
	SentenceIdsOfQuestion []int64 `json:"SentenceIdsOfQuestion"`
	Answer                string  `json:"Answer"`
	SentenceIdsOfAnswer   []int64 `json:"SentenceIdsOfAnswer"`
}

type TingwuSummaryData struct {
	Keywords                  []string                 `json:"keywords"`
	KeySentences              []KeySentenceItem        `json:"key_sentences"`
	ParagraphSummary          string                   `json:"paragraph_summary"`
	AutoChapters              []AutoChapterItem        `json:"auto_chapters"`
	ConversationalSummary     []ConversationalItem     `json:"conversational_summary"`
	QuestionsAnsweringSummary []QuestionsAnsweringItem `json:"questions_answering_summary"`
	MindMapSummary            []MindMapItem            `json:"mind_map_summary"`
	Actions                   []ActionItem             `json:"actions"`
	Classifications           ClassificationData       `json:"classifications"`
	Paragraphs                []TranscriptionParagraph `json:"paragraphs"`
}

type MindMapItem struct {
	Title string        `json:"Title"`
	Topic []MindMapItem `json:"Topic"`
}

func renderMindMap(items []MindMapItem, level int) string {
	var result strings.Builder
	indent := strings.Repeat("  ", level)
	for _, item := range items {
		result.WriteString(fmt.Sprintf("%s- %s\n", indent, item.Title))
		if len(item.Topic) > 0 {
			result.WriteString(renderMindMap(item.Topic, level+1))
		}
	}
	return result.String()
}

// ConvertSync 直接调用听悟 SDK 完成转换（绕过 docconv 网关），返回完整 ConvertResponse
func (c *TingWuClient) ConvertSync(ctx context.Context, sourceURL string) (*ConvertResponse, error) {
	taskID, err := c.createTask(ctx, sourceURL)
	if err != nil {
		return nil, fmt.Errorf("tingwu create task failed: %w", err)
	}

	pollInterval := 5 * time.Second
	maxWait := 30 * time.Minute
	deadline := time.Now().Add(maxWait)

	for {
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("tingwu task timeout after %v", maxWait)
		}

		info, err := c.getTaskInfo(ctx, taskID)
		if err != nil {
			return nil, fmt.Errorf("tingwu get task info failed: %w", err)
		}

		switch info.Status {
		case "COMPLETED":
			resp, err := c.getResult(ctx, info)
			if err != nil {
				return nil, fmt.Errorf("tingwu get result failed: %w", err)
			}
			return resp, nil
		case "FAILED", "FAIL":
			return nil, fmt.Errorf("tingwu task failed: code=%s message=%s", info.ErrorCode, info.ErrorMessage)
		}

		time.Sleep(pollInterval)
	}
}
