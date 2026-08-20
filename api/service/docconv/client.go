package docconv

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/env"
	"github.com/53AI/53AIHub/common/utils/helper"
)

// tingwuResults 存储通义听悟处理结果的内存缓存
var tingwuResults = make(map[string]*ConvertResponse)
var tingwuResultsMutex sync.RWMutex

// storeTingWuResult 存储通义听悟的处理结果
func storeTingWuResult(jobID string, result *ConvertResponse) {
	tingwuResultsMutex.Lock()
	defer tingwuResultsMutex.Unlock()

	tingwuResults[jobID] = result
}

// getTingWuResult 获取通义听悟的处理结果
func getTingWuResult(jobID string) (*ConvertResponse, bool) {
	tingwuResultsMutex.RLock()
	defer tingwuResultsMutex.RUnlock()

	result, exists := tingwuResults[jobID]
	return result, exists
}

// removeTingWuResult 删除通义听悟的处理结果
func removeTingWuResult(jobID string) {
	tingwuResultsMutex.Lock()
	defer tingwuResultsMutex.Unlock()

	delete(tingwuResults, jobID)
}

// TingWuTask 用于存储通义听悟任务的相关信息
type TingWuTask struct {
	SourceURL string
	Config    *TingWuConfig
	FileID    int64
}

// tingwuTasks 存储通义听悟任务相关信息的内存缓存
var tingwuTasks = make(map[string]*TingWuTask)
var tingwuTasksMutex sync.RWMutex

// extractTingWuTaskID 从jobID中提取真实的任务ID
func extractTingWuTaskID(jobID string) (string, bool) {
	// tingwu_开头的jobID格式为: tingwu_REAL_TASK_ID_timestamp
	parts := strings.SplitN(jobID, "_", 3)
	if len(parts) < 3 {
		return "", false
	}

	// 提取中间的真实任务ID部分
	return parts[1], true
}

// storeTingWuTask 存储通义听悟的任务信息
func storeTingWuTask(taskID string, task *TingWuTask) {
	tingwuTasksMutex.Lock()
	defer tingwuTasksMutex.Unlock()

	tingwuTasks[taskID] = task
}

// getTingWuTask 获取通义听悟的任务信息
func getTingWuTask(taskID string) (*TingWuTask, bool) {
	tingwuTasksMutex.RLock()
	defer tingwuTasksMutex.RUnlock()

	task, exists := tingwuTasks[taskID]
	return task, exists
}

// removeTingWuTask 删除通义听悟的任务信息
func removeTingWuTask(taskID string) {
	tingwuTasksMutex.Lock()
	defer tingwuTasksMutex.Unlock()

	delete(tingwuTasks, taskID)
}

// Client 文档转换服务客户端
type Client struct {
	baseURL      string
	apiKey       string
	timeout      time.Duration
	pollTimeout  time.Duration
	maxSize      int64
	retryTimes   int
	pollInterval time.Duration
	healthTimeout  time.Duration
	httpClient   *http.Client
}

// NewClient 创建新的文档转换客户端
func NewClient() *Client {
	timeoutSeconds := env.Int("DOC_CONVERT_TIMEOUT", 1800)
	if timeoutSeconds <= 0 {
		timeoutSeconds = 1800
	}
	timeout := time.Duration(timeoutSeconds) * time.Second
	pollTimeoutSeconds := env.Int("DOC_CONVERT_POLL_TIMEOUT", timeoutSeconds)
	if pollTimeoutSeconds <= 0 {
		pollTimeoutSeconds = timeoutSeconds
	}
	pollTimeout := time.Duration(pollTimeoutSeconds) * time.Second
	maxSizeStr := env.String("DOC_CONVERT_MAX_FILE_SIZE", "1GB")
	maxSize, _ := helper.ParseSize(maxSizeStr)

	return &Client{
		baseURL:      env.String("DOC_CONVERT_BASE_URL", ""),
		apiKey:       env.String("DOC_CONVERT_API_KEY", ""),
		timeout:      timeout,
		pollTimeout:  pollTimeout,
		maxSize:      maxSize,
		retryTimes:   env.Int("DOC_CONVERT_RETRY_TIMES", 3),
		pollInterval: time.Duration(env.Int("DOC_CONVERT_POLL_INTERVAL", 5)) * time.Second,
		healthTimeout: time.Duration(env.Int("DOC_CONVERT_HEALTH_TIMEOUT", 30)) * time.Second,
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}
}

// ConvertRequest 转换请求
type ConvertRequest struct {
	SourceURL    string `json:"source_url"`
	OutputFormat string `json:"output_format,omitempty"`
	ParserType   string `json:"parser_type,omitempty"`
	FileID       int64  `json:"file_id,omitempty"` // 新增字段用于传递fileID

	// New field for complex job parameters (used by textin)
	JobParams *JobParams `json:"job_params,omitempty"`
}

// JobParams contains parameters for document conversion jobs
type JobParams struct {
	ParserType         string              `json:"parser_type"`
	TextinConfig       *TextinConfig       `json:"textin_config,omitempty"`
	MinerUConfig       *MinerUConfig       `json:"mineru_net_config,omitempty"`
	MinerULocalConfig  *MinerULocalConfig  `json:"mineru_local_config,omitempty"`
	PaddlePaddleConfig *PaddlePaddleConfig `json:"paddlepaddle_config,omitempty"`
	TingWuConfig       *TingWuConfig       `json:"tingwu_config,omitempty"`
}

// TextinConfig represents the configuration for Textin XParse v1.3 API
type TextinConfig struct {
	AppID      string        `json:"app_id"`
	SecretCode string        `json:"secret_code"`
	Parse      *TextinXParse `json:"parse,omitempty"`
}

// TextinXParse wraps the parse block for Textin XParse v1.3
type TextinXParse struct {
	Document     *TextinDocument     `json:"document,omitempty"`
	Capabilities *TextinCapabilities `json:"capabilities,omitempty"`
	Scope        *TextinScope        `json:"scope,omitempty"`
	Config       *TextinConfigBlock  `json:"config,omitempty"`
}

type TextinDocument struct {
	Password string `json:"password,omitempty"`
}

type TextinCapabilities struct {
	TableView             string `json:"table_view,omitempty"`
	IncludeImageData      *bool  `json:"include_image_data,omitempty"`
	IncludeTableStructure *bool  `json:"include_table_structure,omitempty"`
	Pages                 *bool  `json:"pages,omitempty"`
	CropDewarp            *bool  `json:"crop_dewarp,omitempty"`
	RemoveWatermark       *bool  `json:"remove_watermark,omitempty"`
	TitleTree             *bool  `json:"title_tree,omitempty"`
	IncludeCharDetails    *bool  `json:"include_char_details,omitempty"`
	IncludeHierarchy      *bool  `json:"include_hierarchy,omitempty"`
	IncludeInlineObjects  *bool  `json:"include_inline_objects,omitempty"`
}

type TextinScope struct {
	PageRange string `json:"page_range,omitempty"`
}

type TextinConfigBlock struct {
	ForceEngine  string              `json:"force_engine,omitempty"`
	EngineParams *TextinEngineParams `json:"engine_params,omitempty"`
}

type TextinEngineParams struct {
	FormulaLevel      int    `json:"formula_level,omitempty"`
	ImageOutputType   string `json:"image_output_type,omitempty"`
	ParseMode         string `json:"parse_mode,omitempty"`
	RecognizeChemical *bool  `json:"recognize_chemical,omitempty"`
	Dpi               int    `json:"dpi,omitempty"`
}

// buildPageRange converts old flat page_start/page_count to XParse page_range string.
// page_start is 0-based, page_range is 1-based.
func buildPageRange(pageStart, pageCount int) string {
	if pageCount <= 0 {
		pageCount = 1000
	}
	return strconv.Itoa(pageStart+1) + "-" + strconv.Itoa(pageStart+pageCount)
}

// MinerUConfig represents the configuration for MinerU API
type MinerUConfig struct {
	// API authentication
	Token         string   `json:"token"`                    // 必需
	BaseURL       string   `json:"base_url,omitempty"`       // 可选，默认"https://mineru.net/api/v4"
	Language      string   `json:"language,omitempty"`       // 可选，默认"ch"
	IsOCR         *bool    `json:"is_ocr,omitempty"`         // 可选，默认false
	EnableFormula *bool    `json:"enable_formula,omitempty"` // 可选，默认true
	EnableTable   *bool    `json:"enable_table,omitempty"`   // 可选，默认true
	PageRanges    string   `json:"page_ranges,omitempty"`    // 可选
	ModelVersion  string   `json:"model_version,omitempty"`  // 可选
	DataID        string   `json:"data_id,omitempty"`        // 可选
	Callback      string   `json:"callback,omitempty"`       // 可选
	Seed          string   `json:"seed,omitempty"`           // 可选
	ExtraFormats  []string `json:"extra_formats,omitempty"`  // 可选
}

type MinerULocalConfig struct {
	BaseURL           string   `json:"base_url"`
	APIKey            string   `json:"api_key,omitempty"`
	OutputDir         string   `json:"output_dir,omitempty"`
	LangList          []string `json:"lang_list,omitempty"`
	Backend           string   `json:"backend,omitempty"`
	ParseMethod       string   `json:"parse_method,omitempty"`
	FormulaEnable     *bool    `json:"formula_enable,omitempty"`
	TableEnable       *bool    `json:"table_enable,omitempty"`
	ServerURL         string   `json:"server_url,omitempty"`
	ReturnMD          *bool    `json:"return_md,omitempty"`
	ReturnMiddleJSON  *bool    `json:"return_middle_json,omitempty"`
	ReturnModelOutput *bool    `json:"return_model_output,omitempty"`
	ReturnContentList *bool    `json:"return_content_list,omitempty"`
	ReturnImages      *bool    `json:"return_images,omitempty"`
	ResponseFormatZip *bool    `json:"response_format_zip,omitempty"`
	StartPageID       *int     `json:"start_page_id,omitempty"`
	EndPageID         *int     `json:"end_page_id,omitempty"`
}

type PaddlePaddleConfig struct {
	APIURL                    string `json:"api_url"`
	Token                     string `json:"token"`
	APIType                   string `json:"api_type"`
	FileType                  *int   `json:"file_type,omitempty"`
	UseDocOrientationClassify *bool  `json:"use_doc_orientation_classify,omitempty"`
	UseDocUnwarping           *bool  `json:"use_doc_unwarping,omitempty"`
	UseTextlineOrientation    *bool  `json:"use_textline_orientation,omitempty"`
	UseChartRecognition       *bool  `json:"use_chart_recognition,omitempty"`
}

// JobResponse 任务响应
type JobResponse struct {
	JobID  string `json:"job_id"`
	Status string `json:"status"`
}

// JobStatus 任务状态
type JobStatus struct {
	JobID                 string `json:"job_id"`
	Status                string `json:"status"`
	Stage                 string `json:"stage,omitempty"`
	Progress              int    `json:"progress,omitempty"`
	ElapsedMs             int64  `json:"elapsed_ms,omitempty"`
	StartedAt             string `json:"started_at,omitempty"`
	CompletedAt           string `json:"completed_at,omitempty"`
	TextPreview           string `json:"text_preview,omitempty"`
	DownloadURL           string `json:"download_url,omitempty"`
	OriginalFilename      string `json:"original_filename,omitempty"`
	OriginalContentType   string `json:"original_content_type,omitempty"`
	OriginalContentLength int64  `json:"original_content_length,omitempty"`
	OriginalURL           string `json:"original_url,omitempty"`
}

// ConvertError 转换错误
type ConvertError struct {
	Op         string `json:"op"`
	HTTPStatus int    `json:"http_status"`
	Code       string `json:"code"`
	Message    string `json:"message"`
	RawBody    string `json:"raw_body,omitempty"`
	Retryable  bool   `json:"retryable"`
	RequestID  string `json:"request_id,omitempty"`
}

func (e *ConvertError) Error() string {
	return fmt.Sprintf("docconv %s error: %s (code: %s, status: %d)", e.Op, e.Message, e.Code, e.HTTPStatus)
}

// Health 健康检查
func (c *Client) Health(ctx context.Context) error {
	if c.baseURL == "" {
		return &ConvertError{
			Op:      "health",
			Code:    "config_error",
			Message: "DOC_CONVERT_BASE_URL not configured",
		}
	}

	url := strings.TrimSuffix(c.baseURL, "/") + "/v1/health"
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return &ConvertError{
			Op:      "health",
			Code:    "request_error",
			Message: err.Error(),
		}
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return &ConvertError{
			Op:      "health",
			Code:    "network_error",
			Message: err.Error(),
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return &ConvertError{
			Op:         "health",
			HTTPStatus: resp.StatusCode,
			Code:       "http_error",
			Message:    fmt.Sprintf("health check failed with status %d", resp.StatusCode),
			RawBody:    c.truncateBody(string(body)),
		}
	}

	return nil
}

// checkFileSize 检查文件大小
func (c *Client) checkFileSize(ctx context.Context, sourceURL string) error {
	if c.maxSize <= 0 {
		return nil
	}

	req, err := http.NewRequestWithContext(ctx, "HEAD", sourceURL, nil)
	if err != nil {
		return nil // 无法检查则放行
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil // 无法检查则放行
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil // 无法检查则放行
	}

	contentLength := resp.Header.Get("Content-Length")
	if contentLength == "" {
		return nil // 无长度信息则放行
	}

	size, err := strconv.ParseInt(contentLength, 10, 64)
	if err != nil {
		return nil // 解析失败则放行
	}

	if size > c.maxSize {
		return &ConvertError{
			Op:      "submit",
			Code:    "file_too_large",
			Message: fmt.Sprintf("file size %d exceeds limit %d", size, c.maxSize),
		}
	}

	return nil
}

// SubmitJob 提交转换任务
func (c *Client) SubmitJob(ctx context.Context, req *ConvertRequest) (*JobResponse, error) {
	if c.baseURL == "" || c.apiKey == "" {
		return nil, &ConvertError{
			Op:      "submit",
			Code:    "config_error",
			Message: "DOC_CONVERT_BASE_URL or DOC_CONVERT_API_KEY not configured",
		}
	}

	if req.SourceURL == "" {
		return nil, &ConvertError{
			Op:      "submit",
			Code:    "invalid_request",
			Message: "source_url is required",
		}
	}

	// 检查文件大小
	if err := c.checkFileSize(ctx, req.SourceURL); err != nil {
		return nil, err
	}

	// 设置默认值
	if req.OutputFormat == "" {
		req.OutputFormat = "md"
	}

	// Handle different parameter structures for backward compatibility
	if req.JobParams != nil {
		// New format with JobParams (used by textin)
		if req.JobParams.ParserType == "" {
			req.JobParams.ParserType = "markitdown"
		}

		// 如果包含TingWuConfig，调用通义听悟API提交任务
		if req.JobParams.TingWuConfig != nil {
			logger.Infof(ctx, "👂 [CLIENT] 准备通义听悟任务 - source_url: %s", req.SourceURL)

			// 创建TingWuClient实例
			tingwuClient, err := NewTingWuClient(req.JobParams.TingWuConfig)
			if err != nil {
				logger.Errorf(ctx, "❌ [CLIENT] failed to create tingwu client: %v", err)
				return nil, &ConvertError{
					Op:      "submit",
					Code:    "tingwu_client_error",
					Message: fmt.Sprintf("failed to create tingwu client: %v", err),
				}
			}

			// 提交任务到通义听悟API
			convertResp, err := tingwuClient.SubmitJobWithProgress(ctx, req)
			if err != nil {
				logger.Errorf(ctx, "❌ [CLIENT] failed to submit tingwu task: %v", err)
				return nil, &ConvertError{
					Op:      "submit",
					Code:    "tingwu_submit_error",
					Message: fmt.Sprintf("failed to submit tingwu task: %v", err),
				}
			}

			// 从响应中获取任务ID
			taskID, ok := convertResp.Metadata["task_id"].(string)
			if !ok {
				logger.Errorf(ctx, "❌ [CLIENT] unable to extract task_id from response metadata")
				return nil, &ConvertError{
					Op:      "submit",
					Code:    "tingwu_response_error",
					Message: "unable to extract task_id from response metadata",
				}
			}

			// 创建一个唯一标识符用于后续跟踪
			jobID := fmt.Sprintf("tingwu_%s_%d", taskID, time.Now().Unix())

			// 将任务信息存储起来，供后续查询和下载使用
			task := &TingWuTask{
				SourceURL: req.SourceURL,
				Config:    req.JobParams.TingWuConfig,
				FileID:    req.FileID, // 使用传入的FileID
			}
			storeTingWuTask(jobID, task)

			// 返回任务ID，后续由QueryJob和DownloadResult处理
			jobResp := &JobResponse{
				JobID:  jobID,
				Status: "queued", // 初始状态为排队中
			}

			return jobResp, nil
		}

		// Validate textin config if present
		if req.JobParams.TextinConfig != nil {
			config := req.JobParams.TextinConfig

			if config.AppID == "" || config.SecretCode == "" {
				return nil, &ConvertError{
					Op:      "submit",
					Code:    "invalid_request",
					Message: "textin_config requires both app_id and secret_code",
				}
			}
		}

		// Validate mineru config if present
		if req.JobParams.MinerUConfig != nil {
			config := req.JobParams.MinerUConfig

			// Check required parameters for mineru
			if config.Token == "" {
				return nil, &ConvertError{
					Op:      "submit",
					Code:    "mineru_token_missing",
					Message: "create mineru.net converter: mineru.net token is required in job_params",
				}
			}

			// Apply sensible defaults based on API documentation
			if config.BaseURL == "" {
				config.BaseURL = "https://mineru.net/api/v4"
			}
			if config.Language == "" {
				config.Language = "ch"
			}
			if config.IsOCR == nil {
				isOCR := true
				config.IsOCR = &isOCR
			}
			if config.EnableFormula == nil {
				enableFormula := true
				config.EnableFormula = &enableFormula
			}
			if config.EnableTable == nil {
				enableTable := true
				config.EnableTable = &enableTable
			}
			if config.ModelVersion == "" {
				config.ModelVersion = "vlm"
			}
			// if len(config.ExtraFormats) == 0 {
			// 	config.ExtraFormats = []string{"md"}
			// }
		}

		if req.JobParams.MinerULocalConfig != nil {
			config := req.JobParams.MinerULocalConfig
			if strings.TrimSpace(config.BaseURL) == "" {
				return nil, &ConvertError{
					Op:      "submit",
					Code:    "invalid_request",
					Message: "mineru_local_config requires base_url",
				}
			}
		}

		if req.JobParams.PaddlePaddleConfig != nil {
			config := req.JobParams.PaddlePaddleConfig

			if strings.TrimSpace(config.APIURL) == "" || strings.TrimSpace(config.Token) == "" || strings.TrimSpace(config.APIType) == "" {
				return nil, &ConvertError{
					Op:      "submit",
					Code:    "invalid_request",
					Message: "paddlepaddle_config requires api_url, token and api_type",
				}
			}
		}
	} else {
		// Legacy format for backward compatibility
		if req.ParserType == "" {
			req.ParserType = "markitdown"
		}
	}

	reqBody, err := json.Marshal(req)
	if err != nil {
		return nil, &ConvertError{
			Op:      "submit",
			Code:    "marshal_error",
			Message: err.Error(),
		}
	}

	url := strings.TrimSuffix(c.baseURL, "/") + "/v1/jobs"
	if req.JobParams != nil && req.JobParams.TextinConfig != nil {
		logger.Debugf(ctx, "【诊断-Textin请求】endpoint=%s source_url_set=%t parser_type=%s %s",
			url, req.SourceURL != "", req.JobParams.ParserType, textinConfigDebugSummary(req.JobParams.TextinConfig))
	}
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(reqBody)))
	if err != nil {
		return nil, &ConvertError{
			Op:      "submit",
			Code:    "request_error",
			Message: err.Error(),
		}
	}

	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, &ConvertError{
			Op:      "submit",
			Code:    "network_error",
			Message: err.Error(),
		}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, &ConvertError{
			Op:      "submit",
			Code:    "read_error",
			Message: err.Error(),
		}
	}
	if req.JobParams != nil && req.JobParams.TextinConfig != nil {
		logger.Debugf(ctx, "【诊断-Textin响应】http_status=%d content_type=%s request_id=%s body_len=%d body=%s",
			resp.StatusCode, resp.Header.Get("Content-Type"), resp.Header.Get("X-Request-ID"), len(body), c.truncateBody(string(body)))
	}

	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusOK {
		return nil, c.parseErrorResponse("submit", resp.StatusCode, body, resp.Header.Get("X-Request-ID"))
	}

	var jobResp JobResponse
	if err := json.Unmarshal(body, &jobResp); err != nil {
		return nil, &ConvertError{
			Op:      "submit",
			Code:    "unmarshal_error",
			Message: err.Error(),
			RawBody: c.truncateBody(string(body)),
		}
	}
	logger.Infof(ctx, "submitted conversion job: %s for URL: %s", jobResp.JobID, req.SourceURL)
	return &jobResp, nil
}

// textinConfigDebugSummary 返回不包含密钥原文的 TextIn 请求摘要。
func textinConfigDebugSummary(config *TextinConfig) string {
	if config == nil {
		return "config=nil"
	}

	parsePresent := config.Parse != nil
	capabilitiesPresent := parsePresent && config.Parse.Capabilities != nil
	scopePresent := parsePresent && config.Parse.Scope != nil
	configBlockPresent := parsePresent && config.Parse.Config != nil
	engineParamsPresent := configBlockPresent && config.Parse.Config.EngineParams != nil

	parseMode := ""
	pageRange := ""
	tableView := ""
	forceEngine := ""
	if engineParamsPresent {
		parseMode = config.Parse.Config.EngineParams.ParseMode
	}
	if scopePresent {
		pageRange = config.Parse.Scope.PageRange
	}
	if capabilitiesPresent {
		tableView = config.Parse.Capabilities.TableView
	}
	if configBlockPresent {
		forceEngine = config.Parse.Config.ForceEngine
	}

	return fmt.Sprintf("app_id=%s app_id_len=%d secret_code_set=%t secret_code_len=%d app_id_trimmed=%t secret_code_trimmed=%t parse_present=%t capabilities_present=%t scope_present=%t config_present=%t engine_params_present=%t force_engine=%s parse_mode=%s page_range=%s table_view=%s",
		maskTextinAppID(config.AppID), len(config.AppID), config.SecretCode != "", len(config.SecretCode),
		config.AppID == strings.TrimSpace(config.AppID), config.SecretCode == strings.TrimSpace(config.SecretCode),
		parsePresent, capabilitiesPresent, scopePresent, configBlockPresent, engineParamsPresent,
		forceEngine, parseMode, pageRange, tableView)
}

func maskTextinAppID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "<empty>"
	}
	if len(value) <= 4 {
		return "****"
	}
	return value[:2] + "***" + value[len(value)-2:]
}

// QueryJob 查询任务状态
func (c *Client) QueryJob(ctx context.Context, jobID string) (*JobStatus, error) {
	// 检查是否是通义听悟任务（以tingwu_开头的jobID）
	if strings.HasPrefix(jobID, "tingwu_") {
		task, exists := getTingWuTask(jobID)
		if !exists {
			return &JobStatus{
				JobID:       jobID,
				Status:      "failed",
				Progress:    0,
				TextPreview: "tingwu task not found",
			}, nil
		}

		// 创建TingWuClient实例
		tingwuClient, err := NewTingWuClient(task.Config)
		if err != nil {
			logger.Errorf(ctx, "❌ [CLIENT] failed to create tingwu client: %v", err)
			return &JobStatus{
				JobID:       jobID,
				Status:      "failed",
				Progress:    0,
				TextPreview: fmt.Sprintf("failed to create tingwu client: %v", err),
			}, nil
		}

		// 从任务信息中获取真实的任务ID
		taskID, ok := extractTingWuTaskID(jobID)
		if !ok {
			return &JobStatus{
				JobID:       jobID,
				Status:      "failed",
				Progress:    0,
				TextPreview: "unable to extract real task id from job id",
			}, nil
		}

		// 查询任务状态
		taskInfo, err := tingwuClient.getTaskInfo(ctx, taskID)
		if err != nil {
			logger.Errorf(ctx, "❌ [CLIENT] failed to get tingwu task info: %v", err)
			return &JobStatus{
				JobID:       jobID,
				Status:      "failed",
				Progress:    0,
				TextPreview: fmt.Sprintf("failed to get tingwu task info: %v", err),
			}, nil
		}

		// 根据任务状态返回相应的JobStatus
		var status, textPreview string
		progress := taskInfo.Progress

		switch taskInfo.Status {
		case "COMPLETED":
			status = "succeeded"
			textPreview = "Task completed successfully"
		case "FAILED", "FAIL":
			status = "failed"
			textPreview = taskInfo.ErrorMessage
			logger.Warnf(ctx, "[TINGWU] task %s failed - error_code=%s, error_message=%s",
				taskID, taskInfo.ErrorCode, taskInfo.ErrorMessage)
		case "CREATED", "PROCESSING", "ONGOING":
			status = "processing"
			textPreview = "Task is being processed"
		default:
			status = "unknown"
			textPreview = fmt.Sprintf("Unknown task status: %s", taskInfo.Status)
		}

		return &JobStatus{
			JobID:       jobID,
			Status:      status,
			Progress:    progress,
			TextPreview: textPreview,
		}, nil
	}

	if c.baseURL == "" || c.apiKey == "" {
		return nil, &ConvertError{
			Op:      "query",
			Code:    "config_error",
			Message: "DOC_CONVERT_BASE_URL or DOC_CONVERT_API_KEY not configured",
		}
	}

	url := strings.TrimSuffix(c.baseURL, "/") + "/v1/jobs/" + jobID
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, &ConvertError{
			Op:      "query",
			Code:    "request_error",
			Message: err.Error(),
		}
	}

	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, &ConvertError{
			Op:      "query",
			Code:    "network_error",
			Message: err.Error(),
		}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, &ConvertError{
			Op:      "query",
			Code:    "read_error",
			Message: err.Error(),
		}
	}

	if resp.StatusCode != http.StatusOK {
		return nil, c.parseErrorResponse("query", resp.StatusCode, body, resp.Header.Get("X-Request-ID"))
	}

	var status JobStatus
	if err := json.Unmarshal(body, &status); err != nil {
		return nil, &ConvertError{
			Op:      "query",
			Code:    "unmarshal_error",
			Message: err.Error(),
			RawBody: c.truncateBody(string(body)),
		}
	}

	return &status, nil
}

// DownloadResult 下载转换结果
func (c *Client) DownloadResult(ctx context.Context, jobID string) (string, error) {
	// 检查是否是通义听悟任务（以tingwu_开头的jobID）
	if strings.HasPrefix(jobID, "tingwu_") {
		result, exists := getTingWuResult(jobID)
		if !exists {
			return "", &ConvertError{
				Op:      "download",
				Code:    "not_found",
				Message: "tingwu result not found",
			}
		}

		// 从结果中删除已使用的条目
		defer removeTingWuResult(jobID)

		// 返回内容
		return result.Content, nil
	}

	if c.baseURL == "" || c.apiKey == "" {
		return "", &ConvertError{
			Op:      "download",
			Code:    "config_error",
			Message: "DOC_CONVERT_BASE_URL or DOC_CONVERT_API_KEY not configured",
		}
	}

	url := strings.TrimSuffix(c.baseURL, "/") + "/v1/files/" + jobID
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", &ConvertError{
			Op:      "download",
			Code:    "request_error",
			Message: err.Error(),
		}
	}

	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", &ConvertError{
			Op:      "download",
			Code:    "network_error",
			Message: err.Error(),
		}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", &ConvertError{
			Op:      "download",
			Code:    "read_error",
			Message: err.Error(),
		}
	}

	if resp.StatusCode == http.StatusConflict {
		return "", &ConvertError{
			Op:         "download",
			HTTPStatus: resp.StatusCode,
			Code:       "not_ready",
			Message:    "result not ready",
			Retryable:  true,
		}
	}

	if resp.StatusCode != http.StatusOK {
		return "", c.parseErrorResponse("download", resp.StatusCode, body, resp.Header.Get("X-Request-ID"))
	}

	type paddlePaddleDownloadResponse struct {
		Result struct {
			LayoutParsingResults []struct {
				Markdown struct {
					Text   string `json:"text"`
					Images []struct {
						ImgName string `json:"img_name"`
						ImgPath string `json:"img_path"`
					} `json:"images"`
				} `json:"markdown"`
			} `json:"layoutParsingResults"`
		} `json:"result"`
	}

	var ppResp paddlePaddleDownloadResponse
	if err := json.Unmarshal(body, &ppResp); err == nil {
		var markdownParts []string
		imageNameToPath := make(map[string]string)
		for _, r := range ppResp.Result.LayoutParsingResults {
			if text := strings.TrimSpace(r.Markdown.Text); text != "" {
				markdownParts = append(markdownParts, text)
			}
			for _, img := range r.Markdown.Images {
				imgName := strings.TrimSpace(img.ImgName)
				imgPath := strings.TrimSpace(img.ImgPath)
				if imgName == "" || imgPath == "" {
					continue
				}
				imageNameToPath[imgName] = imgPath
			}
		}

		if len(markdownParts) > 0 {
			result := strings.Join(markdownParts, "\n\n")
			if len(imageNameToPath) > 0 {
				for imgName, imgPath := range imageNameToPath {
					result = strings.ReplaceAll(result, "]("+imgName+")", "]("+imgPath+")")
					result = strings.ReplaceAll(result, "](./"+imgName+")", "]("+imgPath+")")
				}
			}

			logger.SysLogf("✅ 下载转换结果成功(job=%s)，PaddlePaddle Markdown 大小: %d bytes", jobID, len(result))
			return result, nil
		}
	}

	result := string(body)
	logger.SysLogf("✅ 下载转换结果成功(job=%s)，原始结果大小: %d bytes", jobID, len(result))
	return result, nil
}

// parseErrorResponse 解析错误响应
func (c *Client) parseErrorResponse(op string, statusCode int, body []byte, requestID string) *ConvertError {
	var errorResp map[string]interface{}
	message := fmt.Sprintf("HTTP %d", statusCode)

	if json.Unmarshal(body, &errorResp) == nil {
		if msg, ok := errorResp["error"].(string); ok {
			message = msg
		}
	}

	retryable := statusCode >= 500 || statusCode == 429 || statusCode == 409

	return &ConvertError{
		Op:         op,
		HTTPStatus: statusCode,
		Code:       "http_error",
		Message:    message,
		RawBody:    c.truncateBody(string(body)),
		Retryable:  retryable,
		RequestID:  requestID,
	}
}

// truncateBody 截断响应体
func (c *Client) truncateBody(body string) string {
	const maxLen = 500
	if len(body) <= maxLen {
		return body
	}
	return body[:maxLen] + "... (truncated)"
}
