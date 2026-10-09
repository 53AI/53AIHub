package service

import (
	"context"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/google/uuid"
)

const automaticActionOpportunityDetectionTimeout = 5 * time.Minute

const (
	actionOpportunityDetectionLockTTL       = 15 * time.Minute
	actionOpportunityDetectionRetryInterval = 100 * time.Millisecond
)

type actionOpportunityDetectionLease struct {
	key      string
	token    string
	useRedis bool
}

func recordingActionOpportunityDetectionKey(eid, userID, fileID int64) string {
	return fmt.Sprintf("action:opportunity-detection:%d:%d:%d", eid, userID, fileID)
}

func acquireActionOpportunityDetectionLease(ctx context.Context, eid, userID, fileID int64) (*actionOpportunityDetectionLease, error) {
	lease := &actionOpportunityDetectionLease{
		key:      recordingActionOpportunityDetectionKey(eid, userID, fileID),
		token:    uuid.NewString(),
		useRedis: common.IsRedisEnabled() && common.RDB != nil,
	}

	for {
		var (
			acquired bool
			err      error
		)
		if lease.useRedis {
			acquired, err = common.RDB.SetNX(ctx, lease.key, lease.token, actionOpportunityDetectionLockTTL).Result()
		} else {
			acquired, err = model.TryAcquireActionOpportunityDetectionLock(
				ctx,
				lease.key,
				lease.token,
				time.Now().UTC().Add(actionOpportunityDetectionLockTTL).UnixMilli(),
			)
		}
		if err != nil {
			return nil, fmt.Errorf("获取行动建议自动发现锁失败: %w", err)
		}
		if acquired {
			return lease, nil
		}

		timer := time.NewTimer(actionOpportunityDetectionRetryInterval)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
}

func (lease *actionOpportunityDetectionLease) Release() error {
	if lease == nil {
		return nil
	}
	if !lease.useRedis {
		return model.ReleaseActionOpportunityDetectionLock(context.Background(), lease.key, lease.token)
	}
	_, err := common.RDB.Eval(
		context.Background(),
		"if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
		[]string{lease.key},
		lease.token,
	).Result()
	return err
}

// EnqueueAutomaticActionOpportunityDetection 在正式洞察页面落库后异步发现行动建议。
// 该入口只负责候选行动的发现与持久化，不创建 ActionPlan，也不执行行动。
func EnqueueAutomaticActionOpportunityDetection(eid, fileID int64) {
	if !model.IsActionOpportunityAutoDetectEnabled(eid) {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(recordingPipelineCtx, automaticActionOpportunityDetectionTimeout)
		defer cancel()

		file, err := model.GetFileByID(eid, fileID)
		if err != nil || file == nil || file.UserID <= 0 {
			logger.Warnf(ctx, "【行动建议】自动发现跳过：无法确定录音归属 fileID=%d eid=%d err=%v", fileID, eid, err)
			return
		}

		_, err = DefaultActionRuntimeService().DetectInsightActionOpportunities(ctx, eid, file.UserID, fileID)
		if err != nil {
			logger.Warnf(ctx, "【行动建议】自动发现失败：fileID=%d eid=%d err=%v", fileID, eid, err)
			return
		}
		logger.Infof(ctx, "【行动建议】自动发现完成：fileID=%d eid=%d ownerID=%d", fileID, eid, file.UserID)
	}()
}
