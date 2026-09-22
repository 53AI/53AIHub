package service

import (
	"context"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
)

// insightTask 定义排队中的洞察任务
type insightTask struct {
	eid    int64
	fileID int64
	userID int64
}

// InsightsWorkerPool 限制全局与单租户并发的洞察调度器
type InsightsWorkerPool struct {
	mu           sync.Mutex
	queue        []insightTask
	queuedKeys   map[int64]struct{} // 按 fileID 去重防止重复入队
	running      map[int64]struct{} // 当前正在执行的 fileID
	runningByEid map[int64]int      // 各租户活跃任务数
	maxGlobal    int                // 全局最大并发，默认 4
	maxPerEid    int                // 单租户最大并发，默认 2
	cond         *sync.Cond
	closed       bool
	runner       func(ctx context.Context, eid, fileID, userID int64) // 供测试注入或默认调用 GenerateInsights
}

var (
	globalInsightsPool     *InsightsWorkerPool
	globalInsightsPoolOnce sync.Once
)

// GetInsightsWorkerPool 获取全局单例洞察任务池
func GetInsightsWorkerPool() *InsightsWorkerPool {
	globalInsightsPoolOnce.Do(func() {
		p := &InsightsWorkerPool{
			queuedKeys:   make(map[int64]struct{}),
			running:      make(map[int64]struct{}),
			runningByEid: make(map[int64]int),
			maxGlobal:    4,
			maxPerEid:    2,
			runner:       GenerateInsights,
		}
		p.cond = sync.NewCond(&p.mu)
		globalInsightsPool = p
		go p.scheduleLoop()
	})
	return globalInsightsPool
}

// Enqueue 将录音洞察任务投递至调度池
func (p *InsightsWorkerPool) Enqueue(eid, fileID, userID int64) bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return false
	}

	// 如果已经在队列中或正在执行，跳过重复排队
	if _, ok := p.queuedKeys[fileID]; ok {
		return false
	}
	if _, ok := p.running[fileID]; ok {
		return false
	}

	p.queue = append(p.queue, insightTask{eid: eid, fileID: fileID, userID: userID})
	p.queuedKeys[fileID] = struct{}{}
	logger.Infof(context.Background(), "【洞察-调度入队】fileID=%d eid=%d userID=%d queue_len=%d", fileID, eid, userID, len(p.queue))

	p.cond.Signal()
	return true
}

// QueueDepth 获取当前排队深度与活跃并发数
func (p *InsightsWorkerPool) QueueDepth() (queued int, active int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.queue), len(p.running)
}

// scheduleLoop 后台调度循环
func (p *InsightsWorkerPool) scheduleLoop() {
	for {
		p.mu.Lock()
		for len(p.queue) == 0 && !p.closed {
			p.cond.Wait()
		}
		if p.closed {
			p.mu.Unlock()
			return
		}

		// 寻找满足并发限制的任务
		candidateIdx := -1
		for i, task := range p.queue {
			if len(p.running) >= p.maxGlobal {
				break
			}
			if p.runningByEid[task.eid] < p.maxPerEid {
				candidateIdx = i
				break
			}
		}

		if candidateIdx == -1 {
			// 当前没有可调度的槽位（已达上限），等待完成唤醒或定时重试
			p.mu.Unlock()
			time.Sleep(500 * time.Millisecond)
			continue
		}

		// 取出候选任务
		task := p.queue[candidateIdx]
		p.queue = append(p.queue[:candidateIdx], p.queue[candidateIdx+1:]...)
		delete(p.queuedKeys, task.fileID)

		p.running[task.fileID] = struct{}{}
		p.runningByEid[task.eid]++
		currentActive := len(p.running)
		eidActive := p.runningByEid[task.eid]
		runnerFn := p.runner
		if runnerFn == nil {
			runnerFn = GenerateInsights
		}
		p.mu.Unlock()

		// 启动执行协程
		go func(t insightTask, activeTotal, activeEid int, run func(context.Context, int64, int64, int64)) {
			startTime := time.Now()
			logger.Infof(context.Background(), "【洞察-开始执行】fileID=%d eid=%d active_total=%d active_eid=%d",
				t.fileID, t.eid, activeTotal, activeEid)

			defer func() {
				if r := recover(); r != nil {
					logger.Errorf(context.Background(), "【洞察-异常捕获】fileID=%d eid=%d panic: %v", t.fileID, t.eid, r)
				}

				p.mu.Lock()
				delete(p.running, t.fileID)
				p.runningByEid[t.eid]--
				if p.runningByEid[t.eid] <= 0 {
					delete(p.runningByEid, t.eid)
				}
				p.mu.Unlock()
				p.cond.Signal()

				logger.Infof(context.Background(), "【洞察-执行完毕】fileID=%d eid=%d elapsed=%v",
					t.fileID, t.eid, time.Since(startTime))
			}()

			// 执行具体的洞察生成逻辑，使用 recordingPipelineCtx 关联优雅停止，给予 10 分钟独立超时
			execCtx, execCancel := context.WithTimeout(recordingPipelineCtx, 10*time.Minute)
			defer execCancel()

			run(execCtx, t.eid, t.fileID, t.userID)
		}(task, currentActive, eidActive, runnerFn)
	}
}

// EnqueueRecordingInsights 外部调用的便捷入口
func EnqueueRecordingInsights(eid, fileID, userID int64) bool {
	return GetInsightsWorkerPool().Enqueue(eid, fileID, userID)
}
