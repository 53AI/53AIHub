package service

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

type AgentAPIService struct{}

func NewAgentAPIService() *AgentAPIService {
	return &AgentAPIService{}
}

func (s *AgentAPIService) LogAPIAuditWithResult(agentID, tokenID, eid int64, method, path, ip, requestID string, statusCode int, startTime time.Time) {
	latencyMs := time.Since(startTime).Milliseconds()
	entry := &AuditLogEntry{
		Eid:        eid,
		AgentID:    agentID,
		TokenID:    tokenID,
		Method:     method,
		Path:       path,
		IP:         ip,
		StatusCode: statusCode,
		LatencyMs:  latencyMs,
		RequestID:  requestID,
	}
	NewAuditLogService().Log(entry)
}

type StatusCodeRecorder struct {
	gin.ResponseWriter
	StatusCode int
}

func NewStatusCodeRecorder(w gin.ResponseWriter) *StatusCodeRecorder {
	return &StatusCodeRecorder{
		ResponseWriter: w,
		StatusCode:     http.StatusOK,
	}
}

func (w *StatusCodeRecorder) WriteHeader(code int) {
	w.StatusCode = code
	w.ResponseWriter.WriteHeader(code)
}
