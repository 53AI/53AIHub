package document

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
)

// maxOpenAIAudioBytes OpenAI 兼容语音转写单文件上限（OpenAI API 限制）。
const maxOpenAIAudioBytes = 25 << 20

// OpenAIAudioDocumentStrategy OpenAI 兼容语音转写策略（/v1/audio/transcriptions，multipart 上传）。
// parse_type 格式：openai:{channel_type}:{model_name}（channel_type 恒 1012）。
type OpenAIAudioDocumentStrategy struct{}

// NewOpenAIAudioDocumentStrategy 创建 OpenAI 兼容语音转写策略。
func NewOpenAIAudioDocumentStrategy() *OpenAIAudioDocumentStrategy {
	return &OpenAIAudioDocumentStrategy{}
}

// GetStrategyName 返回策略名（document_parsing 分派 Process/ProcessWithUploadFile 用）。
func (s *OpenAIAudioDocumentStrategy) GetStrategyName() string {
	return "openai_audio"
}

// Process 非 UploadFile 路径不支持（语音转写必须关联 UploadFile）。
func (s *OpenAIAudioDocumentStrategy) Process(content []byte, filename string, fileSize int64, eid, userID int64) (*DocumentProcessResult, error) {
	return nil, fmt.Errorf("OpenAIAudioDocumentStrategy requires UploadFile, use ProcessWithUploadFile instead")
}

// ProcessWithUploadFile OpenAI 兼容语音转写：
//   1. 解析 openai:{type}:{model} → channel + model（channel_id/model 名从 RecordingConfig 读取，同 voice 策略）
//   2. key = channel.Key；base_url = voice_models.{model}.api_domain 或 channel.GetBaseURL()，归一化后拼 /v1/audio/transcriptions
//   3. 文件：本地版读本地字节 / SaaS 版 URL 下载（ResolveAudioFile）→ multipart 上传
//   4. 响应归一化为 DashScope transcripts 结构（保证纪要/导出/分享消费端兼容）
func (s *OpenAIAudioDocumentStrategy) ProcessWithUploadFile(fileID int64, content []byte, filename string, fileSize int64, eid, userID int64, uploadFile *model.UploadFile, parseType string) (*DocumentProcessResult, error) {
	ctx := context.Background()

	// 解析 parseType：openai:{channel_type}:{model_name}（channel_type 路由标识）
	if !strings.HasPrefix(parseType, model.PLATFORM_KEY_OPENAI_AUDIO_PREFIX) {
		return nil, fmt.Errorf("无效的 parseType: %s", parseType)
	}
	parts := strings.Split(parseType, ":")
	if len(parts) < 3 {
		return nil, fmt.Errorf("无效的 parseType 格式: %s（期望 openai:{channel_type}:{model_name}）", parseType)
	}
	if _, err := strconv.ParseInt(parts[1], 10, 64); err != nil {
		return nil, fmt.Errorf("无效的 channel_type: %s", parts[1])
	}

	// channel_id 与模型名从企业录音配置读取（对齐 voice 策略）
	rc, err := model.ValidateOrCreateRecordingConfig(eid)
	if err != nil {
		return nil, fmt.Errorf("获取录音配置失败: %w", err)
	}
	if !rc.Enabled || rc.ParserPlatform == "" {
		return nil, fmt.Errorf("录音功能未启用或未配置解析平台，请先在后台配置语音模型")
	}
	channelID := rc.VoiceModelID
	modelName := rc.VoiceModelName
	if channelID <= 0 || modelName == "" {
		return nil, fmt.Errorf("录音配置中缺少 voice_model_id 或 voice_model_name")
	}

	channel, err := model.GetChannelByID(channelID)
	if err != nil || !model.IsOpenAIAudioChannel(channel) {
		return nil, fmt.Errorf("OpenAI 语音模型渠道不存在或未配置: channel_id=%d", channelID)
	}

	apiKey := channel.Key
	if apiKey == "" {
		return nil, fmt.Errorf("Channel 缺少 key（API Key）")
	}

	// base_url：voice_models.{model}.api_domain 优先，否则 channel.BaseURL
	cfg, parseErr := model.ParseChannelCustomConfig(channel.CustomConfig)
	if parseErr != nil {
		return nil, fmt.Errorf("解析 CustomConfig 失败: %w", parseErr)
	}
	voiceModels, _ := cfg["voice_models"].(map[string]interface{})
	vm, _ := voiceModels[modelName].(map[string]interface{})

	baseURL := channel.GetBaseURL()
	if d, ok := vm["api_domain"].(string); ok && strings.TrimSpace(d) != "" {
		baseURL = d
	}
	transcriptionsURL := NormalizeOpenAIBaseURL(baseURL) + "/v1/audio/transcriptions"
	if baseURL == "" {
		return nil, fmt.Errorf("缺少 base_url：请在 voice_models.%s.api_domain 或 channel.base_url 中配置", modelName)
	}

	if fileSize > maxOpenAIAudioBytes {
		return nil, fmt.Errorf("音频超过 OpenAI 语音转写上限 %dMB，请压缩后重试", maxOpenAIAudioBytes>>20)
	}

	// 文件提供（本地版读本地字节 / SaaS 版 URL 下载）
	src, err := ResolveAudioFile(ctx, uploadFile)
	if err != nil {
		return nil, err
	}

	// 构造 multipart 请求
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("file", uploadFile.FileName)
	if err != nil {
		return nil, fmt.Errorf("构造 multipart 失败: %w", err)
	}
	if _, err := part.Write(src.Data); err != nil {
		return nil, fmt.Errorf("写入音频数据失败: %w", err)
	}
	_ = writer.WriteField("model", modelName)
	responseFormat := "json"
	if strings.Contains(modelName, "diarize") {
		responseFormat = "diarized_json"
	}
	_ = writer.WriteField("response_format", responseFormat)
	writer.Close()

	req, err := http.NewRequest(http.MethodPost, transcriptionsURL, &buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("OpenAI 语音转写请求失败: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("OpenAI 语音转写返回 HTTP %d: %s", resp.StatusCode, string(raw))
	}

	// 响应归一化：OpenAI {text,segments} → DashScope transcripts 结构
	normalized, err := NormalizeOpenAITranscript(raw)
	if err != nil {
		return nil, err
	}
	var result struct {
		Text string `json:"text"`
	}
	_ = json.Unmarshal(raw, &result)

	// 时长：从 segments 最末 end 或原响应（尽力而为，缺失则 0）
	var durationMs int64
	var durResp struct {
		Duration float64 `json:"duration"`
		Segments []struct {
			End float64 `json:"end"`
		} `json:"segments"`
	}
	_ = json.Unmarshal(raw, &durResp)
	if durResp.Duration > 0 {
		durationMs = int64(durResp.Duration * 1000)
	} else if len(durResp.Segments) > 0 {
		last := durResp.Segments[len(durResp.Segments)-1].End
		if last > 0 {
			durationMs = int64(last * 1000)
		}
	}

	// 写 File.summary/duration_ms + 转写状态（对齐 voice 策略）
	if fileID > 0 && result.Text != "" {
		updates := map[string]interface{}{}
		updates["summary"] = result.Text
		if durationMs > 0 {
			updates["duration_ms"] = durationMs
		}
		if err := model.DB.Model(&model.File{}).Where("id = ?", fileID).Updates(updates).Error; err != nil {
			logger.Errorf(ctx, "【OpenAI语音】保存摘要失败 fileID=%d err=%v", fileID, err)
		}
	}
	if fileID > 0 {
		_ = model.SetFileTranscriptionStatus(fileID, "completed")
	}

	logger.Infof(ctx, "【OpenAI语音】转写成功 fileID=%d model=%s duration_ms=%d", fileID, modelName, durationMs)
	return &DocumentProcessResult{
		ProcessedContent: string(normalized),
		FileType:         "json",
		FileName:         fmt.Sprintf("transcription_%d.json", fileID),
		DurationMs:       durationMs,
	}, nil
}

// NormalizeOpenAIBaseURL 归一化 base_url：去尾部斜杠、去掉 /v1 后缀（兼容 https://host / https://host/v1 / https://host/）。
// 返回可直接拼 /v1/audio/transcriptions 的根地址（OpenAI 兼容端点为 {base}/v1/audio/transcriptions）。
func NormalizeOpenAIBaseURL(baseURL string) string {
	u := strings.TrimSpace(baseURL)
	u = strings.TrimSuffix(u, "/")
	if strings.HasSuffix(u, "/v1") {
		u = strings.TrimSuffix(u, "/v1")
	}
	return u
}

// NormalizeOpenAITranscript 将 OpenAI 语音转写响应归一化为 DashScope transcripts 结构：
// OpenAI: {"text":"...","segments":[{"id":0,"start":0.0,"end":1.5,"text":"...","speaker":0}]}
// → DashScope: {"transcripts":[{"text":"...","sentences":[{"begin_time":0,"end_time":1500,"speaker_id":0,"text":"..."}]}]}
// 秒 → 毫秒；speaker → speaker_id；无 segments 时仅 text。
func NormalizeOpenAITranscript(raw []byte) ([]byte, error) {
	var resp struct {
		Text     string `json:"text"`
		Segments []struct {
			Text    string  `json:"text"`
			Start   float64 `json:"start"`
			End     float64 `json:"end"`
			Speaker *int    `json:"speaker"`
		} `json:"segments"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, fmt.Errorf("OpenAI 语音转写响应非 JSON: %w", err)
	}

	type sentence struct {
		BeginTime int64  `json:"begin_time"`
		EndTime   int64  `json:"end_time"`
		SpeakerID int    `json:"speaker_id"`
		Text      string `json:"text"`
	}
	type transcript struct {
		Text      string     `json:"text"`
		Sentences []sentence `json:"sentences,omitempty"`
	}
	out := transcript{Text: resp.Text}
	for _, seg := range resp.Segments {
		speakerID := 0
		if seg.Speaker != nil {
			speakerID = *seg.Speaker
		}
		out.Sentences = append(out.Sentences, sentence{
			BeginTime: int64(seg.Start * 1000),
			EndTime:   int64(seg.End * 1000),
			SpeakerID: speakerID,
			Text:      seg.Text,
		})
	}
	wrapped := struct {
		Transcripts []transcript `json:"transcripts"`
	}{Transcripts: []transcript{out}}
	return json.Marshal(wrapped)
}

var _ = config.IS_SAAS // 保留 config 引用（环境判断在 ResolveAudioFile）
