package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

const (
	// 一次取回的待切片行数：只是元数据，不占内存；留足余量，避免别人正在切的行把批次占满导致新任务饿死
	speakerBaselineClipPendingBatch = 50
	// 每个 tick 真正切几条：整段音频要下载，并发太高会吃满带宽与内存
	speakerBaselineClipPerTick = 2
	// 切片失败后的冷却，避免坏文件每 10 秒重试一次
	speakerBaselineClipRetryDelay = 2 * time.Minute
	// 快速重试用尽后的降频间隔：机器修好后仍在当晚自愈
	speakerBaselineClipParkDelay = 30 * time.Minute
	// 已尝试次数小于它时用 2 分钟档，达到它改用 30 分钟档
	speakerBaselineClipQuickAttempts = 3
	// 瞬时类失败（超时/存储不可用/ffmpeg 缺失）的尝试上限
	speakerBaselineClipMaxAttempts = 20
	// 永久类失败（无原音频/解码失败）的尝试上限：坏音频两次就够，别让用户等 8 小时
	speakerBaselineClipPermanentAttempts = 2
	// 用户不再等待，超时放宽到 5 分钟，覆盖大文件整段下载
	speakerBaselineClipRunTimeout = 5 * time.Minute
	// 切片租约：超过该时长还没写完，就当执行方已经挂了，允许其他实例/重启后的自己接管
	speakerBaselineClipLease = speakerBaselineClipRunTimeout + 2*time.Minute
	// 切片逻辑版本：改动切片算法、参数或产物格式时 +1，便于识别旧版本产物并按版本重切
	speakerBaselineSliceVersion = 1
)

var speakerBaselineClipNotify = make(chan struct{}, 1)

// NotifySpeakerBaselineClipWorker 绑定落库后立即通知 Worker 处理（非阻塞）。
func NotifySpeakerBaselineClipWorker() {
	select {
	case speakerBaselineClipNotify <- struct{}{}:
	default:
	}
}

// StartSpeakerBaselineClipWorker 启动基准片段后台切片 Worker：
// 待切片行就是 storage_key 为空的行，进程重启后照常扫到，任务不会丢。
func StartSpeakerBaselineClipWorker(ctx context.Context) {
	if speakerBaselineInstanceTag() == "default" {
		logger.SysWarnf("【基准片段】未配置 RECORDING_INSTANCE_ID：多实例会共用 default 租约并互相续切，请为每个实例配置独立实例名")
	}
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-speakerBaselineClipNotify:
			case <-ticker.C:
			}
			if err := processPendingSpeakerBaselineClips(ctx); err != nil {
				logger.SysErrorf("【基准片段】后台切片处理失败：%v", err)
			}
		}
	}()
}

// processPendingSpeakerBaselineClips 取未完成切片逐条补切；数量受限，避免把内存和带宽打满。
func processPendingSpeakerBaselineClips(ctx context.Context) error {
	var baselines []model.RecordingSpeakerBaseline
	staleBefore := speakerBaselineClipStaleBefore()
	ownClaim := speakerBaselineOwnClaimPrefix()
	// 只取待切片、正在切片（租约）与待重试的行；新任务排在重试行之前，避免未到期的重试把批次占满
	if err := model.DB.WithContext(ctx).
		Where("is_deleted = ? AND (storage_key = ? OR storage_key LIKE ? OR storage_key LIKE ?)",
			false, "", model.SpeakerBaselinePendingPrefix+"%", model.SpeakerBaselineRetryPrefix+"%").
		Order("CASE WHEN storage_key = '' THEN 0 ELSE 1 END, updated_time ASC").
		Limit(speakerBaselineClipPendingBatch).
		Find(&baselines).Error; err != nil {
		return err
	}

	var errs []error
	sliced := 0
	for i := range baselines {
		if sliced >= speakerBaselineClipPerTick {
			break
		}
		baseline := baselines[i]
		if !speakerBaselineClipDue(baseline.StorageKey, baseline.UpdatedTime) {
			continue
		}
		// 别人刚认领且没过期，跳过，连下载都不做（待切片与待重试行不受此限）
		if strings.HasPrefix(baseline.StorageKey, model.SpeakerBaselinePendingPrefix) &&
			!strings.HasPrefix(baseline.StorageKey, ownClaim) &&
			baseline.UpdatedTime >= staleBefore {
			continue
		}
		attempt := model.SpeakerBaselineClipAttempt(baseline.StorageKey) + 1
		if attempt > speakerBaselineClipMaxAttempts {
			// 已经试到上限（含租约过期但没留下原因的），不再切片，直接记终态
			if err := finalizeSpeakerBaselineClip(ctx, &baseline); err != nil {
				errs = append(errs, err)
			}
			continue
		}
		claim := speakerBaselineClaimKey(attempt)
		claimed, err := claimSpeakerBaselineClip(ctx, &baseline, claim)
		if err != nil {
			errs = append(errs, fmt.Errorf("基准%d（录音%d，人员%d）抢占失败: %w", baseline.ID, baseline.FileID, baseline.ContactID, err))
			continue
		}
		if !claimed {
			continue
		}
		sliced++
		if err := slicePendingSpeakerBaseline(ctx, &baseline); err != nil {
			if rerr := recordSpeakerBaselineClipFailure(ctx, &baseline, attempt, err); rerr != nil {
				errs = append(errs, rerr)
			}
		}
	}
	return errors.Join(errs...)
}

// speakerBaselineClaimKey 生成本实例第 attempt 次尝试的租约标记：切片逻辑版本 + 实例名 + 次数。
func speakerBaselineClaimKey(attempt int) string {
	return fmt.Sprintf("%sv%d@%s#%d", model.SpeakerBaselinePendingPrefix, speakerBaselineSliceVersion, speakerBaselineInstanceTag(), attempt)
}

// speakerBaselineOwnClaimPrefix 本实例租约标记的前缀（不含次数），用于识别"自己名下"的租约。
func speakerBaselineOwnClaimPrefix() string {
	return fmt.Sprintf("%sv%d@%s#", model.SpeakerBaselinePendingPrefix, speakerBaselineSliceVersion, speakerBaselineInstanceTag())
}

// speakerBaselineClipRetryKey 生成第 attempt 次失败后的待重试标记。
func speakerBaselineClipRetryKey(attempt int, code string) string {
	return fmt.Sprintf("%sv%d@%d@%s", model.SpeakerBaselineRetryPrefix, speakerBaselineSliceVersion, attempt, code)
}

// speakerBaselineFailedKey 生成放弃切片的终态标记，保留失败原因。
func speakerBaselineFailedKey(code string) string {
	return fmt.Sprintf("%sv%d@%s", model.SpeakerBaselineFailedPrefix, speakerBaselineSliceVersion, code)
}

// speakerBaselineClipStaleBefore 返回租约过期的时间点（毫秒），updated_time 早于它的认领视为已失效。
func speakerBaselineClipStaleBefore() int64 {
	return time.Now().Add(-speakerBaselineClipLease).UTC().UnixMilli()
}

// speakerBaselineInstanceTag 实例名做 key 安全化并截断，避免主机名里的怪字符污染存储路径。
func speakerBaselineInstanceTag() string {
	tag := config.GetRecordingInstanceID()
	tag = strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
			return r
		default:
			return '-'
		}
	}, tag)
	if tag == "" {
		tag = "default"
	}
	if len(tag) > 40 {
		tag = tag[:40]
	}
	return tag
}

// speakerBaselineSliceOwnerLabel 把状态标记或产物 key 转成人读的中文说明，日志里用。
func speakerBaselineSliceOwnerLabel(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "空闲"
	}
	if rest, ok := strings.CutPrefix(value, model.SpeakerBaselineRetryPrefix); ok {
		return "待重试（" + rest + "）"
	}
	if rest, ok := strings.CutPrefix(value, model.SpeakerBaselineFailedPrefix); ok {
		return "已放弃（" + rest + "）"
	}
	rest, ok := strings.CutPrefix(value, model.SpeakerBaselinePendingPrefix)
	if !ok {
		return "已完成（" + value + "）"
	}
	version, instance, found := strings.Cut(rest, "@")
	if !found {
		return "实例" + rest
	}
	instance, _, _ = strings.Cut(instance, "#")
	return fmt.Sprintf("实例%s（切片逻辑%s）", instance, version)
}

// claimSpeakerBaselineClip 抢租约：以读到的 storage_key 做 CAS，多实例并发只有一个能改成自己的标记。
// 自己实例名下未过期的标记也算可续：本进程重启后不必干等 7 分钟（实例名相同即同一执行方）。
func claimSpeakerBaselineClip(ctx context.Context, baseline *model.RecordingSpeakerBaseline, claim string) (bool, error) {
	observed := baseline.StorageKey
	res := model.DB.WithContext(ctx).Model(&model.RecordingSpeakerBaseline{}).
		Where("id = ? AND is_deleted = ? AND storage_key = ?", baseline.ID, false, observed).
		Updates(map[string]any{"storage_key": claim, "updated_time": time.Now().UTC().UnixMilli()})
	if res.Error != nil {
		return false, res.Error
	}
	if res.RowsAffected == 0 {
		return false, nil
	}
	if strings.HasPrefix(observed, model.SpeakerBaselinePendingPrefix) &&
		!strings.HasPrefix(observed, speakerBaselineOwnClaimPrefix()) {
		logger.Infof(ctx, "【基准片段】待切片基准%d：接管（原持有者%s 租约已过期）", baseline.ID, speakerBaselineSliceOwnerLabel(observed))
	}
	baseline.StorageKey = claim
	return true, nil
}

// speakerBaselineClipDue 判断该行此刻是否可以切片：
// 待切片行总是可以；租约行是否过期由租约判断；待重试行按已尝试次数等待冷却。
func speakerBaselineClipDue(key string, updatedMs int64) bool {
	switch {
	case key == "":
		return true
	case strings.HasPrefix(key, model.SpeakerBaselinePendingPrefix):
		return true
	}
	wait := speakerBaselineClipRetryDelay
	if model.SpeakerBaselineClipAttempt(key) >= speakerBaselineClipQuickAttempts {
		wait = speakerBaselineClipParkDelay
	}
	return time.Now().UnixMilli()-updatedMs >= wait.Milliseconds()
}

// speakerBaselineClipRetryDelayLabel 退避间隔的中文说明，日志里用。
func speakerBaselineClipRetryDelayLabel(attempt int) string {
	if attempt >= speakerBaselineClipQuickAttempts {
		return "30 分钟后重试"
	}
	return "2 分钟后重试"
}

// classifySpeakerBaselineClipFailure 把切片错误归成原因代码，并判定是否值得长期重试。
func classifySpeakerBaselineClipFailure(err error) (code string, permanent bool) {
	switch {
	case errors.Is(err, ErrSpeakerBaselineAudioMissing):
		return "noaudio", true
	case errors.Is(err, ErrFFmpegNotAvailable):
		return "ffmpeg", false
	case errors.Is(err, ErrSpeakerBaselineTimeout), errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		return "timeout", false
	case errors.Is(err, ErrSpeakerBaselineStorageUnavailable):
		return "storage", false
	default:
		return "decode", true
	}
}

// recordSpeakerBaselineClipFailure 记录失败：未到上限写待重试（保留原因），到上限写终态。
func recordSpeakerBaselineClipFailure(ctx context.Context, baseline *model.RecordingSpeakerBaseline, attempt int, sliceErr error) error {
	code, permanent := classifySpeakerBaselineClipFailure(sliceErr)
	giveUp := attempt >= speakerBaselineClipMaxAttempts
	if permanent {
		giveUp = attempt >= speakerBaselineClipPermanentAttempts
	}
	target := speakerBaselineClipRetryKey(attempt, code)
	if giveUp {
		target = speakerBaselineFailedKey(code)
	}
	res := model.DB.WithContext(ctx).Model(&model.RecordingSpeakerBaseline{}).
		Where("id = ? AND is_deleted = ? AND storage_key = ?", baseline.ID, false, baseline.StorageKey).
		Updates(map[string]any{"storage_key": target, "updated_time": time.Now().UTC().UnixMilli()})
	if res.Error != nil {
		return fmt.Errorf("基准%d（录音%d，人员%d）记录切片失败状态失败: %w", baseline.ID, baseline.FileID, baseline.ContactID, res.Error)
	}
	if res.RowsAffected == 0 {
		return nil
	}
	if giveUp {
		logger.Warnf(ctx, "【基准片段】录音%d的人员%d基准片段：已放弃切片（%s，累计%d次，原因：%s），重新绑定该区间可重试",
			baseline.FileID, baseline.ContactID, code, attempt, sanitizeSpeakerBaselineError(sliceErr))
		return nil
	}
	logger.Infof(ctx, "【基准片段】录音%d的人员%d基准片段：第%d次切片失败（%s），%s（原因：%s）",
		baseline.FileID, baseline.ContactID, attempt, code, speakerBaselineClipRetryDelayLabel(attempt), sanitizeSpeakerBaselineError(sliceErr))
	return nil
}

// finalizeSpeakerBaselineClip 把已到上限却没留下原因的行（租约过期/进程被杀）记成终态。
func finalizeSpeakerBaselineClip(ctx context.Context, baseline *model.RecordingSpeakerBaseline) error {
	code := model.SpeakerBaselineClipCode(baseline.StorageKey)
	if code == "" {
		code = "unknown"
	}
	res := model.DB.WithContext(ctx).Model(&model.RecordingSpeakerBaseline{}).
		Where("id = ? AND is_deleted = ? AND storage_key = ?", baseline.ID, false, baseline.StorageKey).
		Updates(map[string]any{"storage_key": speakerBaselineFailedKey(code), "updated_time": time.Now().UTC().UnixMilli()})
	if res.Error != nil {
		return fmt.Errorf("基准%d（录音%d，人员%d）标记放弃失败: %w", baseline.ID, baseline.FileID, baseline.ContactID, res.Error)
	}
	if res.RowsAffected == 0 {
		return nil
	}
	logger.Warnf(ctx, "【基准片段】录音%d的人员%d基准片段：已放弃切片（%s，累计%d次），重新绑定该区间可重试",
		baseline.FileID, baseline.ContactID, code, model.SpeakerBaselineClipAttempt(baseline.StorageKey))
	return nil
}

// slicePendingSpeakerBaseline 为一条待切片基准补切音频，成功后就地补全 storage_key。
func slicePendingSpeakerBaseline(ctx context.Context, baseline *model.RecordingSpeakerBaseline) error {
	// 后台任务脱离请求生命周期，独立超时，避免大文件下载被请求超时打断
	runCtx, cancel := context.WithTimeout(context.Background(), speakerBaselineClipRunTimeout)
	defer cancel()

	var file model.File
	if err := model.DB.WithContext(runCtx).
		Where("id = ? AND eid = ? AND is_deleted = ?", baseline.FileID, baseline.Eid, false).
		First(&file).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			logger.Infof(runCtx, "【基准片段】录音%d已不存在，丢弃待切片基准%d", baseline.FileID, baseline.ID)
			return speakerBaselineDiscardPending(runCtx, baseline.ID, baseline.StorageKey, "来源录音已删除")
		}
		return err
	}

	_, audioKey := resolveRecordingAudioKey(&file)
	if audioKey == "" {
		return ErrSpeakerBaselineAudioMissing
	}
	clip, err := cutSpeakerBaselineClip(runCtx, audioKey, buildSpeakerBaselineStorageKey(baseline.Eid, baseline.FileID), baseline.StartMs, baseline.EndMs)
	if err != nil {
		return err
	}

	// 条件更新：只有还捏着租约的这一方才写得进去，期间被删/被接管则视为失败，清掉自己刚上传的切片
	res := model.DB.WithContext(runCtx).Model(&model.RecordingSpeakerBaseline{}).
		Where("id = ? AND storage_key = ? AND is_deleted = ?", baseline.ID, baseline.StorageKey, false).
		Updates(map[string]any{
			"storage_key":  clip.StorageKey,
			"mime_type":    clip.MimeType,
			"size_bytes":   clip.SizeBytes,
			"updated_time": time.Now().UTC().UnixMilli(),
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		if derr := speakerBaselineDeleteFile(clip.StorageKey); derr != nil {
			logger.Warnf(runCtx, "【基准片段】清理并发重复切片失败（基准%d）：%v", baseline.ID, derr)
		}
		return nil
	}

	logger.Infof(runCtx, "【基准片段】录音%d的人员%d基准片段：生成完成（%d~%d 毫秒，%d 字节，由%s切片）",
		baseline.FileID, baseline.ContactID, baseline.StartMs, baseline.EndMs, clip.SizeBytes, speakerBaselineSliceOwnerLabel(baseline.StorageKey))
	return nil
}

// speakerBaselineDiscardPending 软删已无意义的待切片基准：它还没有切片，不需要清理音频。
func speakerBaselineDiscardPending(ctx context.Context, id int64, owner, reason string) error {
	err := model.DB.WithContext(ctx).Model(&model.RecordingSpeakerBaseline{}).
		Where("id = ? AND storage_key = ?", id, owner).
		Updates(map[string]any{"is_deleted": true, "storage_key": "", "updated_time": time.Now().UTC().UnixMilli()}).Error
	if err == nil {
		logger.Infof(ctx, "【基准片段】待切片基准%d：已丢弃（%s）", id, reason)
	}
	return err
}
