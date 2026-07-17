package service

import (
	"context"
	"sync"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

type AuditLogEntry struct {
	Eid        int64
	AgentID    int64
	TokenID    int64
	Method     string
	Path       string
	IP         string
	StatusCode int
	LatencyMs  int64
	RequestID  string
}

type AuditLogService struct {
	ch     chan *AuditLogEntry
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

var (
	auditLogServiceInstance *AuditLogService
	auditLogServiceOnce     sync.Once
)

func NewAuditLogService() *AuditLogService {
	auditLogServiceOnce.Do(func() {
		ctx, cancel := context.WithCancel(context.Background())
		instance := &AuditLogService{
			ch:     make(chan *AuditLogEntry, 1024),
			ctx:    ctx,
			cancel: cancel,
		}
		instance.wg.Add(1)
		go instance.worker()
		auditLogServiceInstance = instance
	})
	return auditLogServiceInstance
}

func (s *AuditLogService) Log(entry *AuditLogEntry) {
	select {
	case s.ch <- entry:
	default:
		logger.SysLogf("audit log channel full, dropping entry: agent_id=%d path=%s", entry.AgentID, entry.Path)
	}
}

func (s *AuditLogService) worker() {
	defer s.wg.Done()

	const batchSize = 50
	var batch []*model.AuditLog

	flushBatch := func() {
		if len(batch) == 0 {
			return
		}
		if err := model.BatchCreateAuditLogs(batch); err != nil {
			logger.SysLogf("audit log batch insert error: %v", err)
		}
		batch = batch[:0]
	}

	for {
		select {
		case <-s.ctx.Done():
			flushBatch()
			return
		case entry := <-s.ch:
			batch = append(batch, &model.AuditLog{
				Eid:        entry.Eid,
				AgentID:    entry.AgentID,
				TokenID:    entry.TokenID,
				Method:     entry.Method,
				Path:       entry.Path,
				IP:         entry.IP,
				StatusCode: entry.StatusCode,
				LatencyMs:  entry.LatencyMs,
				RequestID:  entry.RequestID,
			})
			if len(batch) >= batchSize {
				flushBatch()
			}
		}
	}
}

func (s *AuditLogService) Shutdown() {
	s.cancel()
	s.wg.Wait()
}
