package sonicnote

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/elasticsearch"
	"gorm.io/gorm"
)

// DeviceTypeSonicNote 支持的设备类型：SonicNote（妙记）。
const DeviceTypeSonicNote = "sonicnote"

// SonicNoteProvider 同步源 provider 标识。
const SonicNoteProvider = "sonicnote"

// ErrSyncSkipped 表示 syncOne 因去重跳过该录音，不是失败。
var ErrSyncSkipped = errors.New("skipped")

// permanentSyncError 确定性失败（重试必然再次失败）的包装类型。
// 用于区分"瞬时网络错误（值得重试）"与"业务/参数性失败（重试无意义）"：
// 缺少音频 URL、audioId 非法、未找到个人库等属于后者，重试只会多一次无效往返。
type permanentSyncError struct {
	err error
}

func (e *permanentSyncError) Error() string { return e.err.Error() }
func (e *permanentSyncError) Unwrap() error { return e.err }

// permanentErr 构造确定性失败错误（同步单条时标记，重试逻辑据此跳过重试）。
func permanentErr(format string, args ...interface{}) error {
	return &permanentSyncError{err: fmt.Errorf(format, args...)}
}

// isPermanentSyncError 判断错误是否为确定性失败（不重试）。
func isPermanentSyncError(err error) bool {
	var pe *permanentSyncError
	return errors.As(err, &pe)
}

// transcriptionNotTriggeredError 标记"文件已导入但转写任务未创建"（如 RAG 引擎未就绪）。
// 与失败不同：文件本身导入成功，只是转写管线没安排上；由 runSync 识别后不计入 failed，
// 而是在同步任务的 failed_details 中追加一条"转写未触发"提示，供前端/运维感知与后续补触发。
type transcriptionNotTriggeredError struct {
	fileID int64
	title  string
}

func (e *transcriptionNotTriggeredError) Error() string {
	return fmt.Sprintf("转写任务未创建（引擎未就绪？）file_id=%d title=%s", e.fileID, e.title)
}

func isTranscriptionNotTriggeredError(err error) bool {
	var te *transcriptionNotTriggeredError
	return errors.As(err, &te)
}

// ErrSyncInProgress 表示已有同步任务进行中。
var ErrSyncInProgress = errors.New("同步任务进行中，请稍后再试")

// SyncResult 汇总一次同步的结果。
type SyncResult struct {
	Discovered int
	Completed  int
	Failed     int
	Skipped    int
}

// SyncService 负责从 SonicNote 拉取录音音频并落库。
// 同步只拿音频，不从设备抓取转写；转写统一由本系统本地转写管线完成（同步即转写）。
// 配置为用户级：每个用户通过 RecordingDeviceConfig 设置自己的 SonicNote Key。
// mu 防止同一实例并发同步（短时间多次点击触发）。
type SyncService struct {
	client *Client
	mu     sync.Mutex
	// createJobsFn 创建 RAG 解析任务。重导/复用场景无条件触发；字段可替换便于测试断言管线触发。
	createJobsFn func(ctx context.Context, eid, fileID int64, paramsJSON string) ([]*model.RagJob, error)
	// esSyncFn 将新导入文件同步进 ES 索引（keyword 搜索依赖）；字段可替换便于测试断言。
	// 默认 elasticsearch.SyncFileToES（异步队列，带重试）。
	esSyncFn func(file *model.File, operation string)
}

// NewSyncService 创建 SyncService，client 为 nil 时使用默认 baseURL。
func NewSyncService(client *Client) *SyncService {
	if client == nil {
		client = NewClient(DefaultBaseURL)
	}
	return &SyncService{client: client, createJobsFn: service.CreateRagJobsForRecordingFile, esSyncFn: elasticsearch.SyncFileToES}
}

// defaultSyncService 包级单例：所有请求共享同一实例，sync.Mutex 防重入才能生效。
// controller 若每次 NewSyncService 新建实例，锁不共享，防重入完全失效。
var defaultSyncService = NewSyncService(nil)

// GetSyncService 返回包级单例 SyncService。
func GetSyncService() *SyncService {
	return defaultSyncService
}

// resolveConfigs 解析同步目标配置：deviceID>0 取指定配置；否则取该 deviceType 全部启用配置（多 key）。
func (s *SyncService) resolveConfigs(eid, userID int64, deviceType string, deviceID int64) ([]model.RecordingDeviceConfig, error) {
	if deviceID > 0 {
		cfg, err := model.GetRecordingDeviceConfigByID(eid, userID, deviceID)
		if err != nil {
			return nil, fmt.Errorf("设备配置不存在或无权访问: id=%d", deviceID)
		}
		if !cfg.Enabled || strings.TrimSpace(cfg.ApiKey) == "" {
			return nil, fmt.Errorf("设备未启用或未填写 Key: id=%d", deviceID)
		}
		return []model.RecordingDeviceConfig{*cfg}, nil
	}
	return model.ListEnabledRecordingDeviceConfigs(eid, userID, deviceType)
}

// finishJob 写 job 终态（多配置合并结果）。所有配置均无可处理项（login/列表失败）时 job 置 failed。
func finishJob(jobID int64, result *SyncResult, failedDetails []map[string]interface{}, firstErr error) {
	status := "completed"
	errMsg := ""
	if firstErr != nil && result.Discovered == 0 {
		status = "failed"
		errMsg = firstErr.Error()
	}
	detailsJSON := ""
	if len(failedDetails) > 0 {
		b, _ := json.Marshal(failedDetails)
		detailsJSON = string(b)
	}
	_ = model.UpdateRecordingSyncJob(jobID, map[string]interface{}{
		"status": status, "error": errMsg, "failed_details": detailsJSON,
		"discovered": result.Discovered, "completed": result.Completed,
		"failed": result.Failed, "skipped": result.Skipped,
		"finished_at": time.Now().UnixMilli(),
	})
}

// StartSync 异步触发一次同步：立即返回 job_id，后台 goroutine 逐条处理。
// 防重入：已有同步进行中时返回 ErrSyncInProgress。
// 幂等补缺：已同步且文件有效跳过、已同步但文件被删重导、未同步导入。
// deviceID>0 同步指定配置；deviceID=0 同步该 deviceType 全部启用配置（多 key 串行，单 job 合并计数）。
// force 参数已弃用（保留兼容，行为与普通同步一致）。
// limit>0 时最多处理 limit 条远端录音（调试用，0=不限）。
// 前端通过 GET /sync-status 轮询 job 进度。
func (s *SyncService) StartSync(ctx context.Context, eid, userID int64, deviceType string, deviceID int64, force bool, limit int) (int64, error) {
	if !s.mu.TryLock() {
		return 0, ErrSyncInProgress
	}

	// 多实例防重入：进程内 mutex 只防同实例；DB 层再查一次 running 任务，
	// 避免另一实例正在同步同一设备时本实例并发拉取（多实例部署场景）。
	// 该检查优先于配置查询：另一实例在跑时无需先做配置/登录。
	if running, rerr := model.HasRunningRecordingSyncJob(eid, userID, deviceType); rerr == nil && running {
		s.mu.Unlock()
		return 0, ErrSyncInProgress
	} else if rerr != nil {
		logger.Warnf(ctx, "【SonicNote】查询进行中的同步任务失败（放行，交给去重兜底）: %v", rerr)
	}

	cfgs, err := s.resolveConfigs(eid, userID, deviceType, deviceID)
	if err != nil {
		s.mu.Unlock()
		return 0, err
	}
	if len(cfgs) == 0 {
		s.mu.Unlock()
		return 0, fmt.Errorf("SonicNote 未配置或未启用，请先在前端绑定设备并填写 Key")
	}

	// 创建同步任务记录（provider 来自请求 deviceType；owner_instance 多实例隔离）
	job := &model.RecordingSyncJob{
		Eid:           eid,
		UserID:        userID,
		Provider:      deviceType,
		Status:        "running",
		OwnerInstance: model.GetRecordingInstanceID(),
		StartedAt:     time.Now().UnixMilli(),
	}
	if err := model.CreateRecordingSyncJob(job); err != nil {
		s.mu.Unlock()
		return 0, fmt.Errorf("创建同步任务记录失败: %w", err)
	}

	// 后台执行：goroutine 用独立 context（请求结束不能取消后台任务）
	go func() {
		defer s.mu.Unlock()
		// 防御：任何 panic 不能崩掉整个进程，记录并标记 job 失败后继续
		defer func() {
			if rec := recover(); rec != nil {
				logger.Errorf(context.Background(), "【%s】后台同步 panic 已捕获: %v", deviceType, rec)
				_ = model.UpdateRecordingSyncJob(job.ID, map[string]interface{}{
					"status": "failed", "error": fmt.Sprintf("panic: %v", rec), "finished_at": time.Now().UnixMilli(),
				})
			}
		}()
		bgCtx := context.Background()
		result := &SyncResult{}
		var failedDetails []map[string]interface{}
		var firstErr error
		onProgress := func(r *SyncResult) {
			_ = model.UpdateRecordingSyncJob(job.ID, map[string]interface{}{
				"discovered": r.Discovered, "completed": r.Completed,
				"failed": r.Failed, "skipped": r.Skipped,
			})
		}
		for _, cfg := range cfgs {
			r, details, rErr := s.runSync(bgCtx, eid, userID, job.ID, cfg.DeviceType, cfg.ApiKey, force, limit, onProgress)
			if r != nil { // runSync 失败时（如登录/列表失败）返回 nil result，需防空指针
				result.Discovered += r.Discovered
				result.Completed += r.Completed
				result.Failed += r.Failed
				result.Skipped += r.Skipped
			}
			failedDetails = append(failedDetails, details...)
			if rErr != nil {
				// 配置级失败（登录/列表失败）：即使其他 key 成功也要可见，不能静默吞掉
				failedDetails = append(failedDetails, map[string]interface{}{
					"device_type": cfg.DeviceType,
					"title":       "设备配置级失败",
					"reason":      rErr.Error(),
				})
				if firstErr == nil {
					firstErr = rErr
				}
			}
		}
		finishJob(job.ID, result, failedDetails, firstErr)
		logger.Infof(bgCtx, "【%s】后台同步完成 job_id=%d result=%+v", deviceType, job.ID, *result)
	}()

	return job.ID, nil
}

// Sync 同步执行一次同步（同步入口，供测试/调用方等待结果）。
// 语义同 StartSync（deviceID 指定单配置 / 缺省该 type 全部配置串行）。
// 返回合并结果；所有配置均失败（无任何处理）时返回 error。
func (s *SyncService) Sync(ctx context.Context, eid, userID int64, deviceType string, deviceID int64, force bool, limit int) (*SyncResult, error) {
	if !s.mu.TryLock() {
		return nil, ErrSyncInProgress
	}
	defer s.mu.Unlock()

	// 多实例防重入：DB 层查 running，避免跨实例并发同步同一设备（优先于配置查询）。
	if running, rerr := model.HasRunningRecordingSyncJob(eid, userID, deviceType); rerr == nil && running {
		return nil, ErrSyncInProgress
	} else if rerr != nil {
		logger.Warnf(ctx, "【SonicNote】查询进行中的同步任务失败（放行，交给去重兜底）: %v", rerr)
	}

	cfgs, err := s.resolveConfigs(eid, userID, deviceType, deviceID)
	if err != nil {
		return nil, err
	}
	if len(cfgs) == 0 {
		return nil, fmt.Errorf("SonicNote 未配置或未启用，请先在前端绑定设备并填写 Key")
	}

	// 创建同步任务记录（provider 来自请求 deviceType；owner_instance 多实例隔离）
	job := &model.RecordingSyncJob{
		Eid:           eid,
		UserID:        userID,
		Provider:      deviceType,
		Status:        "running",
		OwnerInstance: model.GetRecordingInstanceID(),
		StartedAt:     time.Now().UnixMilli(),
	}
	if err := model.CreateRecordingSyncJob(job); err != nil {
		return nil, fmt.Errorf("创建同步任务记录失败: %w", err)
	}

	result := &SyncResult{}
	var failedDetails []map[string]interface{}
	var firstErr error
	for _, cfg := range cfgs {
		r, details, rErr := s.runSync(ctx, eid, userID, job.ID, cfg.DeviceType, cfg.ApiKey, force, limit, nil)
		if r != nil { // runSync 失败时（如登录/列表失败）返回 nil result，需防空指针
			result.Discovered += r.Discovered
			result.Completed += r.Completed
			result.Failed += r.Failed
			result.Skipped += r.Skipped
		}
		failedDetails = append(failedDetails, details...)
		if rErr != nil {
			// 配置级失败（登录/列表失败）：即使其他 key 成功也要可见，不能静默吞掉
			failedDetails = append(failedDetails, map[string]interface{}{
				"device_type": cfg.DeviceType,
				"title":       "设备配置级失败",
				"reason":      rErr.Error(),
			})
			if firstErr == nil {
				firstErr = rErr
			}
		}
	}
	finishJob(job.ID, result, failedDetails, firstErr)
	if firstErr != nil && result.Discovered == 0 {
		return nil, firstErr
	}
	return result, nil
}

// downloadConcurrency 每页并发处理条数（下载/存储 IO 密集；流式写临时文件，内存占用小）。
const downloadConcurrency = 4

// remoteConcurrency 同一批同步中打设备服务器（detail/下载）的最大并发数。
// 批量同步时若并发打远端过多，易触发设备侧限流（429）导致本可成功的录音失败；
// 本地存储/DB 仍按 downloadConcurrency 并发，不受此限制。
const remoteConcurrency = 2

// getExistingSyncSourceStates 包级函数变量（测试可替换以注入去重查询失败）。
var getExistingSyncSourceStates = model.GetExistingSyncSourceStates

// runSync 核心同步执行：Login → 分页拉列表 → 并发去重/下载/落库。
// 幂等补缺：已同步且文件有效跳过；已同步但文件被删（软删）重导；未同步导入。
// force 参数已弃用（保留兼容，行为与普通同步一致）。
// 同步执行，调用方负责防重入锁；job 状态与进度在此更新。
// provider 来自设备配置（cfg.DeviceType），保证多设备去重/溯源按设备隔离。
// limit>0 时最多处理 limit 条远端录音（0=不限，调试用截断）。
// runSync 核心同步执行：Login → 分页拉列表 → 并发去重/下载/落库。
// 幂等补缺：已同步且文件有效跳过；已同步但文件被删（软删）重导；未同步导入。
// 单配置同步（一个 key）；多 key 场景由 StartSync/Sync 串行调用并合并结果。
// onProgress 每完成一条回调（调用层更新 job 进度），可 nil。
// 返回 (result, failedDetails, err)；err 为致命错误（login/列表失败）。
func (s *SyncService) runSync(ctx context.Context, eid, userID, jobID int64, provider, apiKey string, force bool, limit int, onProgress func(*SyncResult)) (*SyncResult, []map[string]interface{}, error) {
	token, err := s.client.Login(ctx, apiKey)
	if err != nil {
		return nil, nil, err
	}

	result := &SyncResult{}
	var failedDetails []map[string]interface{} // 逐条失败明细，sync 完成后写入 job
	var resultMu sync.Mutex                    // 并发下保护 result 计数与 failedDetails
	page := 1
	for {
		items, total, err := s.client.ListRecordings(ctx, token, page, 50)
		if err != nil {
			return result, failedDetails, err
		}

		// 批量查去重（join files 判文件有效：已同步+文件在→跳过，软删→重导）
		existing, err := getExistingSyncSourceStates(ctx, eid, userID, provider, remoteIDsOf(items))
		if err != nil {
			// 去重查询失败：整页跳过（宁可不处理，也不误判未同步撞唯一键全失败），告警后继续下一页
			logger.Warnf(ctx, "【SonicNote】批量去重查询失败，整页跳过 page=%d: %v", page, err)
			for range items {
				if limit > 0 && result.Discovered >= limit {
					break
				}
				result.Discovered++
				result.Skipped++
			}
			if onProgress != nil {
				onProgress(result)
			}
			if len(items) == 0 || page*50 >= total || (limit > 0 && result.Discovered >= limit) {
				break
			}
			page++
			continue
		}

		// 并发处理本页（detail → 流式下载 → 存储 → DB 事务）
		var wg sync.WaitGroup
		sem := make(chan struct{}, downloadConcurrency)
		// 打设备服务器的限流槽：detail + 下载共用，避免批量同步触发远端限流。
		remoteSem := make(chan struct{}, remoteConcurrency)
		for _, item := range items {
			// limit>0：最多处理 limit 条（discovered 在派发循环单线程递增，截断精确）
			if limit > 0 && result.Discovered >= limit {
				break
			}
			result.Discovered++
			sem <- struct{}{}
			wg.Add(1)
			go func(item map[string]interface{}) {
				defer wg.Done()
				defer func() { <-sem }()
				defer func() {
					if rec := recover(); rec != nil {
						logger.Errorf(ctx, "【SonicNote】同步单条 panic 已捕获: %v", rec)
						resultMu.Lock()
						result.Failed++
						resultMu.Unlock()
					}
				}()
				err := s.syncOne(ctx, eid, userID, jobID, token, provider, item, existing, remoteSem)
				if err != nil {
					if errors.Is(err, ErrSyncSkipped) {
						resultMu.Lock()
						result.Skipped++
						resultMu.Unlock()
						return
					}
					// 转写未触发（文件导入成功，仅转写管线未安排）：不计 failed、不重试，
					// 在 failed_details 留痕供前端/运维感知，后续可通过补转写接口触发。
					if isTranscriptionNotTriggeredError(err) {
						logger.Warnf(ctx, "【SonicNote】转写未触发（文件已导入）: %v", err)
						resultMu.Lock()
						result.Completed++
						aid, _ := item["audioId"].(string)
						ttl, _ := item["recordNickName"].(string)
						if ttl == "" {
							ttl, _ = item["recordName"].(string)
						}
						failedDetails = append(failedDetails, map[string]interface{}{
							"audio_id": aid,
							"title":    ttl,
							"type":     "transcription_not_triggered",
							"reason":   err.Error(),
						})
						resultMu.Unlock()
						return
					}
					// 瞬时网络错误重试 1 次（detail/下载等可恢复的失败）；确定性失败（缺少 URL、
					// audioId 非法等）重试必然失败，直接计 failed，避免无效往返翻倍延迟。
					if isPermanentSyncError(err) {
						logger.Warnf(ctx, "【SonicNote】同步单条确定性失败（不重试）: %v", err)
						resultMu.Lock()
						result.Failed++
						aid, _ := item["audioId"].(string)
						ttl, _ := item["recordNickName"].(string)
						if ttl == "" {
							ttl, _ = item["recordName"].(string)
						}
						failedDetails = append(failedDetails, map[string]interface{}{
							"audio_id": aid,
							"title":    ttl,
							"reason":   err.Error(),
						})
						resultMu.Unlock()
						return
					}
					logger.Warnf(ctx, "【SonicNote】同步单条失败，重试1次: %v", err)
					if retryErr := s.syncOne(ctx, eid, userID, jobID, token, provider, item, existing, remoteSem); retryErr != nil {
						resultMu.Lock()
						if errors.Is(retryErr, ErrSyncSkipped) {
							result.Skipped++
						} else if isTranscriptionNotTriggeredError(retryErr) {
							result.Completed++
							aid, _ := item["audioId"].(string)
							ttl, _ := item["recordNickName"].(string)
							if ttl == "" {
								ttl, _ = item["recordName"].(string)
							}
							failedDetails = append(failedDetails, map[string]interface{}{
								"audio_id": aid,
								"title":    ttl,
								"type":     "transcription_not_triggered",
								"reason":   retryErr.Error(),
							})
						} else {
							logger.Errorf(ctx, "【SonicNote】同步单条重试仍失败: %v", retryErr)
							result.Failed++
							// 收集失败明细（含音频 ID、标题、原因）
							aid, _ := item["audioId"].(string)
							ttl, _ := item["recordNickName"].(string)
							if ttl == "" {
								ttl, _ = item["recordName"].(string)
							}
							failedDetails = append(failedDetails, map[string]interface{}{
								"audio_id": aid,
								"title":    ttl,
								"reason":   retryErr.Error(),
							})
						}
						resultMu.Unlock()
					} else {
						resultMu.Lock()
						result.Completed++
						resultMu.Unlock()
					}
				} else {
					resultMu.Lock()
					result.Completed++
					resultMu.Unlock()
				}
			}(item)
		}
		wg.Wait() // 页内全部完成再查下一页（避免 MySQL 可重复读漏看未提交插入导致跨页重复）

		// 同步中更新 job 进度
		if onProgress != nil {
			onProgress(result)
		}
		if len(items) == 0 || page*50 >= total || (limit > 0 && result.Discovered >= limit) {
			break
		}
		page++
	}
	logger.Infof(ctx, "【SonicNote】同步完成 eid=%d result=%+v", eid, *result)
	return result, failedDetails, nil
}

// remoteIDsOf 提取页内条目的 audioId 列表（去重查询入参）。
func remoteIDsOf(items []map[string]interface{}) []string {
	var ids []string
	for _, item := range items {
		if id, _ := item["audioId"].(string); id != "" {
			ids = append(ids, id)
		}
	}
	return ids
}

// syncOne 处理单条远端录音：幂等去重 → detail → 流式下载 → 存储 → 事务落库。
// 同步只拿音频，不从设备抓取转写；转写统一由本系统本地转写管线完成（无条件，同步即转写）。
// remoteSem 为打设备服务器的限流槽（detail+下载共用）；nil 表示不限流（单测可传 nil 保持原行为）。
func (s *SyncService) syncOne(ctx context.Context, eid, userID, jobID int64, token, provider string, item map[string]interface{}, existing map[string]model.SyncSourceState, remoteSem chan struct{}) error {
	audioID, _ := item["audioId"].(string)
	if audioID == "" {
		return permanentErr("远端录音缺少 audioId")
	}
	// audioId 白名单（防拼入存储 key 的路径操控）
	if !sonicNoteAudioIDPattern.MatchString(audioID) {
		return permanentErr("远端录音 audioId 非法: %q", audioID)
	}
	title, _ := item["recordNickName"].(string)
	if title == "" {
		title, _ = item["recordName"].(string)
	}

	state := existing[audioID]
	// 幂等去重：已同步且文件有效 → 跳过（不删文件、不重新处理）
	if state.HasSource && state.FileActive {
		logger.Infof(ctx, "【%s】已同步过，跳过 audio_id=%s", provider, audioID)
		return ErrSyncSkipped
	}
	// state.HasSource && !state.FileActive：已同步但文件被软删 → 重导（把音频同步回来）
	// !state.HasSource：正常导入

	// 复用路径（换 key 场景）：当前用户无自己的 sync source，但同企业其他用户已同步过同一
	// audioId（File 有效）→ 不下载/不存储，新 File 直接指向源的 upload_file；
	// 转写/纪要由管线按同 hash/同 upload_file 复用（document_parsing/GenerateMeetingMinutes），
	// 洞察按当前用户重新生成。无条件触发管线（同步即转写）。
	if !state.HasSource {
		if reuse, rerr := model.GetReuseSyncSource(ctx, eid, userID, provider, audioID); rerr == nil && reuse != nil && reuse.FileID > 0 {
			if srcFile, ferr := model.GetFileByID(eid, reuse.FileID); ferr == nil && srcFile != nil && !srcFile.IsDeleted && srcFile.UploadFileID > 0 {
				return s.syncOneReuse(ctx, eid, userID, jobID, provider, item, audioID, title, srcFile)
			}
		}
	}

	// 打设备服务器限流：detail + 下载整段持有 1 个槽位，保证同一批同步同时打远端的请求数 ≤ remoteConcurrency。
	if remoteSem != nil {
		remoteSem <- struct{}{}
	}
	releaseRemoteSlot := func() {
		if remoteSem != nil {
			<-remoteSem
		}
	}

	// detail 接口需要 Authorization token（无 token 返回 HTTP 200 + body code=401）
	detail, err := s.client.GetRecordingDetail(ctx, token, audioID)
	if err != nil {
		releaseRemoteSlot()
		return err
	}
	audioURL, _ := detail["audioUrl"].(string)
	if audioURL == "" {
		audioURL, _ = item["audioUrl"].(string)
	}
	if audioURL == "" {
		releaseRemoteSlot()
		return permanentErr("录音 %s (%s) 缺少音频 URL", audioID, title)
	}

	// 从 audioUrl 解析真实扩展名（远端 mp3/wav/m4a 等），避免固定 .m4a 导致播放器无法识别。
	// 先取 URL 的 Path 再取扩展名：签名 URL 带 query（如 ?auth=xxx）时 path.Ext 会污染扩展名。
	audioURLPath := audioURL
	if u, parseErr := url.Parse(audioURL); parseErr == nil && u.Path != "" {
		audioURLPath = u.Path
	}
	ext := strings.ToLower(path.Ext(audioURLPath))
	if ext == "" {
		ext = ".m4a" // 兜底
	}
	mimeType := "audio/mpeg"
	switch ext {
	case ".m4a", ".mp4":
		mimeType = "audio/mp4"
	case ".wav":
		mimeType = "audio/wav"
	case ".mp3":
		mimeType = "audio/mpeg"
	}

	// 流式下载到临时文件（固定小缓冲，不占内存）；defer 无论成败清理。
	// hash：边写边算 sha256，写入 UploadFile.Hash 供同内容转写/纪要复用匹配（与导入 finalize 同算法）。
	tmpPath, size, audioHash, err := s.client.DownloadAudioToFile(ctx, audioURL, maxAudioDownloadBytes)
	releaseRemoteSlot()
	if err != nil {
		return err
	}
	defer os.Remove(tmpPath)

	// 命名规则（与录音导入一致）：
	// 1. title 去自带扩展名（远端名可能带 .mp3），保留基名
	// 2. 基名 + 真实音频扩展名（音频没带扩展名时用真实 ext）
	// 3. File.Path 按导入规则追加 .md（shouldAppendMarkdownSuffix 恒 true）
	baseTitle := strings.TrimSuffix(title, path.Ext(title)) // Note-1.mp3 → Note-1
	if strings.TrimSpace(baseTitle) == "" {
		baseTitle = fmt.Sprintf("录音_%s", audioID) // 远端无标题兜底
	}
	fileName := baseTitle + ext        // Note-1.mp3（UploadFile 存真实文件名）
	filePath := "/" + fileName + ".md" // /Note-1.mp3.md（File.Path，与导入一致）

	// 当前用户自己的个人库（不能取企业第一个库：多用户环境下会写进他人库导致列表不可见）
	library, err := model.GetPersonalLibraryByEidAndCreator(eid, userID)
	if err != nil {
		return permanentErr("用户 %d 未找到个人知识库: %w", userID, err)
	}
	libraryID := library.ID

	// 路径去重：同库同标题录音避免路径冲突（PrepareForCreate 不再检查路径唯一）
	if filePath, err = model.ResolveUniqueFilePath(eid, libraryID, filePath); err != nil {
		return fmt.Errorf("生成唯一文件路径失败: %w", err)
	}

	// 1. 存储音频（流式：临时文件 → OSS/本地存储）
	storageKey := fmt.Sprintf("%d/%d/sonicnote/%s%s", eid, userID, audioID, ext)
	if err := storage.StorageInstance.SaveFile(tmpPath, storageKey); err != nil {
		return fmt.Errorf("存储音频失败: %w", err)
	}

	// 2. 原子事务写入 UploadFile + File + RecordingSyncSource
	uploadFile := &model.UploadFile{
		Eid:        eid,
		UserID:     userID,
		FileName:   fileName,
		Key:        storageKey,
		Size:       size,
		Hash:       audioHash,
		Extension:  ext,
		MimeType:   mimeType,
		SourceType: model.UploadFileSourceUserUpload,
	}
	file := &model.File{
		Eid:       eid,
		UserID:    userID,
		LibraryID: libraryID,
		Path:      filePath,
		Type:      model.FILE_TYPE_FILE,
	}
	file.SetRecordingImportedOrigin(0)
	if err := file.PrepareForCreate(); err != nil {
		return permanentErr("文件预处理失败: %w", err)
	}
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		if state.HasSource {
			// B：已同步但文件被软删 → 事务内先删旧 sync source（避免唯一键冲突），与新数据原子写入。
			// 旧 File 已软删，无需再删文件。
			if err := tx.Delete(&model.RecordingSyncSource{}, state.ID).Error; err != nil {
				return fmt.Errorf("删除旧同步源记录失败: %w", err)
			}
		}
		if err := tx.Create(uploadFile).Error; err != nil {
			return fmt.Errorf("创建 UploadFile 失败: %w", err)
		}
		file.UploadFileID = uploadFile.ID
		if err := tx.Create(file).Error; err != nil {
			return fmt.Errorf("创建 File 失败: %w", err)
		}
		syncSource := &model.RecordingSyncSource{
			Eid:      eid,
			UserID:   userID,
			Provider: provider,
			RemoteID: audioID,
			FileID:   file.ID,
			JobID:    jobID,
		}
		if err := tx.Create(syncSource).Error; err != nil {
			return fmt.Errorf("记录同步源失败: %w", err)
		}
		return nil
	}); err != nil {
		// 事务失败：仅纯新导入（!state.HasSource）且确认无其他持有者时才清理存储对象，
		// 避免 B 重导（旧软删文件共享同一 key）与并发撞唯一键场景误删已提交文件的存储对象。
		if !state.HasSource {
			if st, qerr := getExistingSyncSourceStates(ctx, eid, userID, provider, []string{audioID}); qerr == nil && !st[audioID].HasSource {
				if delErr := storage.StorageInstance.Delete(storageKey); delErr != nil {
					logger.Warnf(ctx, "【SonicNote】清理孤儿存储对象失败 key=%s: %v", storageKey, delErr)
				}
			}
		}
		return err
	}

	// 3. 同步进 ES 索引（keyword 搜索依赖；与 recording_audio/personal_upload 等保持一致）。
	//    设备导入文件若不索引 ES，keyword 搜索（走 ES）会漏掉它们——必须与新导入文件同步。
	s.esSyncFn(file, "create")

	// 4. duration_ms：列表元数据（音频时长，与转写解耦；免探测，string/float 兼容）
	if durMs := extractDurationMs(item); durMs > 0 {
		if err := model.DB.Model(&model.File{}).Where("id = ?", file.ID).
			Update("duration_ms", durMs).Error; err != nil {
			logger.Warnf(ctx, "【SonicNote】写 duration_ms 失败 file_id=%d: %v", file.ID, err)
		}
	}

	// 5. 触发转写管线（本系统本地转写，无条件）：同步即转写。
	//    重导场景（state.HasSource：已同步但文件软删）同样触发，对齐 syncOneReuse 复用路径的
	//    恢复语义——否则软删重导后文件永远只有音频，转写/纪要无法经 document_parsing 复用恢复。
	params := map[string]interface{}{
		"eid":           eid,
		"file_id":       file.ID,
		"user_id":       userID,
		"library_id":    libraryID,
		"origin_status": model.FileConversionStatusPending,
	}
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return fmt.Errorf("序列化 RAG 参数失败: %w", err)
	}
	jobs, err := s.createJobsFn(ctx, eid, file.ID, string(paramsJSON))
	if err != nil {
		return fmt.Errorf("创建解析任务失败: %w", err)
	}

	// 有解析任务才置 pending；引擎未创建任务（如 factory 未初始化）时保持现状并告警，
	// 避免文件被标记 pending 却永远无人消费（对齐 enqueueRagJobsForUploadedFile 语义）。
	if len(jobs) > 0 {
		if err := model.UpdateFileConversionStatus(file.ID, model.FileConversionStatusPending); err != nil {
			return fmt.Errorf("更新文件转换状态失败: %w", err)
		}
	} else {
		// 引擎未创建任务（factory 未初始化/未匹配到策略）→ 文件已导入但转写未安排。
		// 返回可区分错误：runSync 不计 failed（导入成功），但写入 failed_details 留痕，
		// 避免再次出现"录音无声无息没有转写"（如 user 207 的 4 条历史数据）。
		logger.Warnf(ctx, "【SonicNote】解析任务未创建（引擎未就绪？）file_id=%d，文件状态保持原样", file.ID)
		return &transcriptionNotTriggeredError{fileID: file.ID, title: title}
	}

	logger.Infof(ctx, "【SonicNote】已导入 file_id=%d title=%s size=%d", file.ID, title, size)
	return nil
}

// syncOneReuse 复用路径（换 key 场景）：不下载/不存储，新 File 指向源 upload_file，
// 写自己的 sync source，无条件触发管线——转写/纪要由管线按同 hash/同 upload_file 从源文件
// 拷贝（document_parsing/GenerateMeetingMinutes 复用），源无/pending/failed 则各自生成，洞察按当前用户生成。
func (s *SyncService) syncOneReuse(ctx context.Context, eid, userID, jobID int64, provider string, item map[string]interface{}, audioID, title string, srcFile *model.File) error {
	// 源 upload_file：取真实扩展名
	srcUF, err := model.GetUploadFileByID(srcFile.UploadFileID)
	if err != nil || srcUF == nil {
		return fmt.Errorf("复用源 upload_file 不存在 file_id=%d: %v", srcFile.UploadFileID, err)
	}
	ext := strings.ToLower(strings.TrimSpace(srcUF.Extension))
	if ext == "" {
		ext = strings.ToLower(path.Ext(srcUF.FileName))
	}
	if ext == "" {
		ext = ".m4a"
	}

	// 命名（与正常路径一致）：title 去扩展名 + 真实音频扩展名，File.Path 追加 .md
	baseTitle := strings.TrimSuffix(title, path.Ext(title))
	if strings.TrimSpace(baseTitle) == "" {
		baseTitle = fmt.Sprintf("录音_%s", audioID)
	}
	fileName := baseTitle + ext
	filePath := "/" + fileName + ".md"

	library, err := model.GetPersonalLibraryByEidAndCreator(eid, userID)
	if err != nil {
		return permanentErr("用户 %d 未找到个人知识库: %w", userID, err)
	}

	// 路径去重：同库同标题录音避免路径冲突（PrepareForCreate 不再检查路径唯一）
	if filePath, err = model.ResolveUniqueFilePath(eid, library.ID, filePath); err != nil {
		return fmt.Errorf("生成唯一文件路径失败: %w", err)
	}

	file := &model.File{
		Eid:          eid,
		UserID:       userID,
		LibraryID:    library.ID,
		Path:         filePath,
		Type:         model.FILE_TYPE_FILE,
		UploadFileID: srcFile.UploadFileID, // 共享源存储对象（与秒传跨用户复用同模式）
	}
	file.SetRecordingImportedOrigin(0)
	if err := file.PrepareForCreate(); err != nil {
		return permanentErr("文件预处理失败: %w", err)
	}
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(file).Error; err != nil {
			return fmt.Errorf("创建 File 失败: %w", err)
		}
		syncSource := &model.RecordingSyncSource{
			Eid:      eid,
			UserID:   userID,
			Provider: provider,
			RemoteID: audioID,
			FileID:   file.ID,
			JobID:    jobID,
		}
		if err := tx.Create(syncSource).Error; err != nil {
			return fmt.Errorf("记录同步源失败: %w", err)
		}
		return nil
	}); err != nil {
		return err
	}

	// 同步进 ES 索引（keyword 搜索依赖）：复用路径同样会创建新 File（recording_imported），
	// 若不索引 ES，keyword 搜索走 ES 会漏掉换 key 复用导入的文件（与主路径 syncOne 一致）。
	s.esSyncFn(file, "create")

	// duration_ms：列表元数据（音频时长，独立写入）
	if durMs := extractDurationMs(item); durMs > 0 {
		if err := model.DB.Model(&model.File{}).Where("id = ?", file.ID).
			Update("duration_ms", durMs).Error; err != nil {
			logger.Warnf(ctx, "【SonicNote】写 duration_ms 失败 file_id=%d: %v", file.ID, err)
		}
	}

	// 无条件触发管线（同步即转写）：转写/纪要复用由管线完成（document_parsing/GenerateMeetingMinutes）
	params := map[string]interface{}{
		"eid":           eid,
		"file_id":       file.ID,
		"user_id":       userID,
		"library_id":    library.ID,
		"origin_status": model.FileConversionStatusPending,
	}
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return fmt.Errorf("序列化 RAG 参数失败: %w", err)
	}
	if _, err := service.CreateRagJobsForRecordingFile(ctx, eid, file.ID, string(paramsJSON)); err != nil {
		return fmt.Errorf("创建解析任务失败: %w", err)
	}

	logger.Infof(ctx, "【SonicNote】复用导入 file_id=%d title=%s src_file_id=%d（共享 upload_file=%d）", file.ID, title, srcFile.ID, srcUF.ID)
	return nil
}

// extractDurationMs 从列表元数据提取录音时长（秒→毫秒，支持 string/float）。
func extractDurationMs(item map[string]interface{}) int64 {
	if dur, ok := item["duration"].(float64); ok && dur > 0 {
		return int64(dur * 1000)
	}
	if ds, ok := item["duration"].(string); ok {
		if d, err := strconv.ParseFloat(ds, 64); err == nil && d > 0 {
			return int64(d * 1000)
		}
	}
	return 0
}
