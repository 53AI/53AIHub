package controller

import (
	"context"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

type WikiGenerationFileView struct {
	FileID           string `json:"file_id"`
	JobID            string `json:"job_id"`
	TraceID          string `json:"trace_id"`
	Title            string `json:"title"`
	Status           string `json:"status"`
	Phase            string `json:"phase"`
	TerminalReason   string `json:"terminal_reason,omitempty"`
	StartedAt        int64  `json:"started_at"`
	UpdatedAt        int64  `json:"updated_at"`
	DurationMs       int64  `json:"duration_ms"`
	Candidates       int64  `json:"candidates"`
	Entities         int64  `json:"entities"`
	Concepts         int64  `json:"concepts"`
	CategoryMatched  int64  `json:"category_matched"`
	PagesSucceeded   int64  `json:"pages_succeeded"`
	PagesFailed      int64  `json:"pages_failed"`
	LLMCalls         int64  `json:"llm_calls"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
}

// GetWikiGenerationFiles godoc
// @Summary Wiki生成文件列表
// @Description 获取最近24小时发生过Wiki生成事件的文件列表（仅 FILE_LOG_VIEWER_ACCESS_TOKEN）
// @Tags SystemLog
// @Produce json
// @Param eid query int true "企业ID"
// @Success 200 {object} model.CommonResponse{data=[]WikiGenerationFileView}
// @Router /api/system_logs/wiki_generation/files [get]
func GetWikiGenerationFiles(c *gin.Context) {
	eid, ok := parseWikiGenerationEID(c)
	if !ok {
		return
	}
	if !common.IsRedisEnabled() || common.RDB == nil {
		c.JSON(http.StatusOK, model.Success.ToResponse([]WikiGenerationFileView{}))
		return
	}
	files, err := service.ListWikiGenerationFiles(context.Background(), eid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	views := make([]WikiGenerationFileView, 0, len(files))
	for _, file := range files {
		views = append(views, wikiGenerationFileView(file))
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(views))
}

// GetWikiGenerationFileTrace godoc
// @Summary Wiki生成文件链路
// @Description 获取单个文件最近24小时的Wiki生成阶段事件和中间结果（仅 FILE_LOG_VIEWER_ACCESS_TOKEN）
// @Tags SystemLog
// @Produce json
// @Param file_id path string true "文件ID"
// @Param eid query int true "企业ID"
// @Success 200 {object} model.CommonResponse{data=[]service.WikiGenerationTraceEvent}
// @Router /api/system_logs/wiki_generation/files/{file_id} [get]
func GetWikiGenerationFileTrace(c *gin.Context) {
	eid, ok := parseWikiGenerationEID(c)
	if !ok {
		return
	}
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil || fileID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}
	if !common.IsRedisEnabled() || common.RDB == nil {
		c.JSON(http.StatusOK, model.Success.ToResponse([]service.WikiGenerationTraceEvent{}))
		return
	}
	events, err := service.LoadWikiGenerationTrace(context.Background(), eid, fileID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(events))
}

func parseWikiGenerationEID(c *gin.Context) (int64, bool) {
	eid, err := strconv.ParseInt(c.Query("eid"), 10, 64)
	if err != nil || eid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("eid 参数无效"))
		return 0, false
	}
	return eid, true
}

func wikiGenerationFileView(file service.WikiGenerationFileSummary) WikiGenerationFileView {
	return WikiGenerationFileView{FileID: encodeWikiID(file.FileID), JobID: encodeWikiID(file.JobID), TraceID: file.TraceID, Title: file.Title, Status: file.Status, Phase: file.Phase, TerminalReason: file.TerminalReason, StartedAt: file.StartedAt, UpdatedAt: file.UpdatedAt, DurationMs: file.DurationMs, Candidates: file.Candidates, Entities: file.Entities, Concepts: file.Concepts, CategoryMatched: file.CategoryMatched, PagesSucceeded: file.PagesSucceeded, PagesFailed: file.PagesFailed, LLMCalls: file.LLMCalls, PromptTokens: file.PromptTokens, CompletionTokens: file.CompletionTokens, TotalTokens: file.TotalTokens}
}
