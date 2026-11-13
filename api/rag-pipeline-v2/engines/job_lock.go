package engines

import (
	"context"
	"fmt"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
)

const jobLockTTL = 10 * time.Second

var releaseJobLockScript = redis.NewScript(`
if redis.call('GET', KEYS[1]) == ARGV[1] then
	return redis.call('DEL', KEYS[1])
end
return 0
`)

var enqueueJobScript = redis.NewScript(`
local function contains_job(key, job_id)
	local items = redis.call('LRANGE', key, 0, -1)
	for _, item in ipairs(items) do
		local ok, wrapper = pcall(cjson.decode, item)
		if ok and tonumber(wrapper.job_id) == tonumber(job_id) then return true end
	end
	return false
end
if contains_job(KEYS[1], ARGV[1]) or contains_job(KEYS[2], ARGV[1]) then return 0 end
redis.call('LPUSH', KEYS[1], ARGV[2])
return 1
`)

var restoreProcessingJobScript = redis.NewScript(`
local function job_id(item)
	local ok, wrapper = pcall(cjson.decode, item)
	if ok then return tonumber(wrapper.job_id) end
	return nil
end
local payload = nil
for _, item in ipairs(redis.call('LRANGE', KEYS[2], 0, -1)) do
	if job_id(item) == tonumber(ARGV[1]) then payload = item; break end
end
if not payload then return 0 end
for _, key in ipairs(KEYS) do
	for _, item in ipairs(redis.call('LRANGE', key, 0, -1)) do
		if job_id(item) == tonumber(ARGV[1]) then redis.call('LREM', key, 0, item) end
	end
end
redis.call('LPUSH', KEYS[1], payload)
return 1
`)

// JobLockKey is the shared lock key used by retries and V2 workers.
func JobLockKey(jobID int64) string { return fmt.Sprintf("rag:job:lock:%d", jobID) }

// AcquireJobLock acquires a short job claim lock and returns its ownership token.
func AcquireJobLock(ctx context.Context, rdb redis.Cmdable, jobID int64) (string, bool, error) {
	token := uuid.NewString()
	locked, err := rdb.SetNX(ctx, JobLockKey(jobID), token, jobLockTTL).Result()
	return token, locked, err
}

// ReleaseJobLock only releases the lock if it still belongs to token.
func ReleaseJobLock(ctx context.Context, rdb redis.Cmdable, jobID int64, token string) error {
	return releaseJobLockScript.Run(ctx, rdb, []string{JobLockKey(jobID)}, token).Err()
}

// EnqueueJobIdempotent queues one wrapper if neither the target queue nor its
// processing list already contains the job.
func EnqueueJobIdempotent(ctx context.Context, rdb redis.Cmdable, queue, processing, jobID, payload string) error {
	return enqueueJobScript.Run(ctx, rdb, []string{queue, processing}, jobID, payload).Err()
}

// RestoreProcessingJob returns a pending job wrapper from processing to its
// queue, removing duplicate wrappers from both lists atomically.
func RestoreProcessingJob(ctx context.Context, rdb redis.Cmdable, queue, processing string, jobID int64) (bool, error) {
	n, err := restoreProcessingJobScript.Run(ctx, rdb, []string{queue, processing}, jobID).Int()
	return n == 1, err
}
