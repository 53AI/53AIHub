package rag

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	v2engines "github.com/53AI/53AIHub/rag-pipeline-v2/engines"
	v2model "github.com/53AI/53AIHub/rag-pipeline-v2/model"
	"github.com/53AI/53AIHub/service/vectorstore"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	siteEmbeddingReindexDefaultPageSize = 100
	vectorIndexingJobType               = "vector_indexing"
)

var ErrStaleEmbeddingReindexRun = errors.New("stale embedding reindex run")

type SiteEmbeddingReindexService struct {
	db *gorm.DB
}

type SiteEmbeddingReindexStartRequest struct {
	Eid             int64
	OldChannelID    int64
	OldModelName    string
	NewChannelID    int64
	NewModelName    string
	ActualVectorDim int // 实际 API 返回的向量维度，0 表示使用 catalog 维度
}

type siteEmbeddingReindexHooks struct {
	enqueueJob        func(ctx context.Context, job *model.RagJob) error
	rebuildCollection func(ctx context.Context, eid, libraryID int64, newDimension int) error
}

var siteEmbeddingReindexRuntimeHooks = siteEmbeddingReindexHooks{
	enqueueJob:        enqueueSiteEmbeddingReindexJob,
	rebuildCollection: rebuildSiteEmbeddingReindexCollection,
}

func NewSiteEmbeddingReindexService(db *gorm.DB) *SiteEmbeddingReindexService {
	if db == nil {
		db = model.DB
	}
	return &SiteEmbeddingReindexService{db: db}
}

func StartSiteEmbeddingReindexCoordinator(ctx context.Context, db *gorm.DB, interval time.Duration) {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	service := NewSiteEmbeddingReindexService(db)
	common.SafeGo(ctx, func() {
		runRecover := func() {
			if err := service.RecoverActiveRuns(ctx); err != nil {
				logger.Warnf(ctx, "[SiteReindex] 站点向量模型重建恢复扫描失败: %v", err)
			}
		}

		runRecover()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runRecover()
			}
		}
	})
}

func (s *SiteEmbeddingReindexService) Start(ctx context.Context, req SiteEmbeddingReindexStartRequest) (*model.EmbeddingReindexRun, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("db is nil")
	}
	if req.Eid <= 0 {
		return nil, errors.New("eid is required")
	}
	if req.NewChannelID <= 0 {
		return nil, errors.New("new embedding channel_id is required")
	}
	if req.NewModelName == "" {
		return nil, errors.New("new embedding model_name is required")
	}

	// 旧模型维度不可解析时（如模型已从 catalog 移除），保守假设维度已变
	oldDimension, _ := resolveEmbeddingModelDimension(req.OldModelName)
	var newDimension int
	var err error
	if req.ActualVectorDim > 0 {
		newDimension = req.ActualVectorDim
	} else {
		newDimension, err = resolveEmbeddingModelDimension(req.NewModelName)
		if err != nil {
			return nil, err
		}
	}
	dimensionChanged := newDimension > 0 && (oldDimension == 0 || oldDimension != newDimension)

	var run *model.EmbeddingReindexRun
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := model.CancelActiveEmbeddingReindexRuns(tx, req.Eid, "new site embedding model selected"); err != nil {
			return err
		}

		var totalFiles int64
		if err := tx.Model(&model.File{}).
			Where("eid = ? AND type = ? AND is_deleted = ?", req.Eid, model.FILE_TYPE_FILE, false).
			Count(&totalFiles).Error; err != nil {
			return err
		}

		run = &model.EmbeddingReindexRun{
			Eid:              req.Eid,
			RunID:            uuid.New().String(),
			Status:           model.EmbeddingReindexStatusPending,
			OldChannelID:     req.OldChannelID,
			OldModelName:     req.OldModelName,
			NewChannelID:     req.NewChannelID,
			NewModelName:     req.NewModelName,
			OldDimension:     oldDimension,
			NewDimension:     newDimension,
			DimensionChanged: dimensionChanged,
			TotalFiles:       totalFiles,
			StartedTime:      time.Now().UTC().UnixMilli(),
		}
		return model.CreateEmbeddingReindexRun(tx, run)
	})
	if err != nil {
		return nil, err
	}
	return run, nil
}

// findNextLibrary 返回 > currentLibID 的下一个有文件的库ID。
// 如果没有更多库，返回 (0, nil)。
func (s *SiteEmbeddingReindexService) findNextLibrary(ctx context.Context, eid, currentLibID int64) (int64, error) {
	var libID int64
	err := s.db.WithContext(ctx).
		Model(&model.File{}).
		Where("eid = ? AND type = ? AND is_deleted = ? AND library_id > ?",
			eid, model.FILE_TYPE_FILE, false, currentLibID).
		Order("library_id ASC").
		Limit(1).
		Pluck("library_id", &libID).Error
	if err != nil {
		return 0, err
	}
	return libID, nil
}

func (s *SiteEmbeddingReindexService) ProcessNextPage(ctx context.Context, runID string, limit int) error {
	if s == nil || s.db == nil {
		return errors.New("db is nil")
	}
	if runID == "" {
		return errors.New("run_id is required")
	}
	if limit <= 0 {
		limit = siteEmbeddingReindexDefaultPageSize
	}

	run, err := s.getActiveRunByRunID(ctx, runID)
	if err != nil {
		return err
	}

	// 如果当前没有选中的库，找到第一个有向量化文件的库
	if run.CursorLibraryID == 0 {
		nextLibID, err := s.findNextLibrary(ctx, run.Eid, 0)
		if err != nil {
			return err
		}
		if nextLibID == 0 {
			// 没有任何库有向量化文件 → 直接标记成功
			outstanding, err := s.countPendingReindexJobs(ctx, run)
			if err != nil {
				return err
			}
			if outstanding > 0 {
				logger.Infof(ctx, "[SiteReindex] 无更多库，等待 %d 个向量化 job 完成: run_id=%s", outstanding, run.RunID)
				return nil
			}
			return model.UpdateEmbeddingReindexRunProgress(s.db.WithContext(ctx), run.RunID, map[string]interface{}{
				"status":     model.EmbeddingReindexStatusSuccess,
				"ended_time": time.Now().UTC().UnixMilli(),
			})
		}
		run.CursorLibraryID = nextLibID
		run.CursorFileID = 0
		if err := model.UpdateEmbeddingReindexRunProgress(s.db.WithContext(ctx), run.RunID, map[string]interface{}{
			"cursor_library_id": run.CursorLibraryID,
			"cursor_file_id":    0,
		}); err != nil {
			return err
		}
		logger.Infof(ctx, "[SiteReindex] 开始处理库 %d: run_id=%s", run.CursorLibraryID, run.RunID)
	}

	if run.Status == model.EmbeddingReindexStatusPending {
		if err := model.UpdateEmbeddingReindexRunProgress(s.db.WithContext(ctx), run.RunID, map[string]interface{}{
			"status": model.EmbeddingReindexStatusProcessing,
		}); err != nil {
			return err
		}
	}

	// 查询当前库的文件
	var files []model.File
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND type = ? AND is_deleted = ? AND library_id = ? AND id > ?",
			run.Eid, model.FILE_TYPE_FILE, false, run.CursorLibraryID, run.CursorFileID).
		Order("id ASC").
		Limit(limit).
		Find(&files).Error; err != nil {
		return err
	}

	// 循环处理：当前库无文件时自动前进到下一库，直到有文件可处理或所有库完成
	maxLibIter := siteEmbeddingReindexDefaultPageSize // 防止无限循环
	for maxLibIter > 0 {
		maxLibIter--

		if len(files) > 0 {
			break // 有文件可处理，退出库循环
		}

		// 当前库已无文件，前进到下一个库
		nextLibID, err := s.findNextLibrary(ctx, run.Eid, run.CursorLibraryID)
		if err != nil {
			return err
		}
		if nextLibID == 0 {
			// 所有库都已处理完，检查是否有未完成的向量化 job
			outstanding, err := s.countPendingReindexJobs(ctx, run)
			if err != nil {
				return err
			}
			if outstanding > 0 {
				logger.Infof(ctx, "[SiteReindex] 所有库扫描完成，等待 %d 个向量化 job 完成: run_id=%s", outstanding, run.RunID)
				return nil
			}
			return model.UpdateEmbeddingReindexRunProgress(s.db.WithContext(ctx), run.RunID, map[string]interface{}{
				"status":     model.EmbeddingReindexStatusSuccess,
				"ended_time": time.Now().UTC().UnixMilli(),
			})
		}
		// 前进到下一个库
		prevLibID := run.CursorLibraryID
		run.CursorLibraryID = nextLibID
		run.CursorFileID = 0
		if err := model.UpdateEmbeddingReindexRunProgress(s.db.WithContext(ctx), run.RunID, map[string]interface{}{
			"cursor_library_id": run.CursorLibraryID,
			"cursor_file_id":    0,
		}); err != nil {
			return err
		}
		logger.Infof(ctx, "[SiteReindex] 库 %d 处理完成，前进到库 %d: run_id=%s", prevLibID, nextLibID, run.RunID)

		// 立即查询下一库的文件（同一调用内继续处理）
		if err := s.db.WithContext(ctx).
			Where("eid = ? AND type = ? AND is_deleted = ? AND library_id = ? AND id > ?",
				run.Eid, model.FILE_TYPE_FILE, false, run.CursorLibraryID, run.CursorFileID).
			Order("id ASC").
			Limit(limit).
			Find(&files).Error; err != nil {
			return err
		}
	}

	processed := int64(0)
	skipped := int64(0)
	lastFileID := run.CursorFileID
	for i := range files {
		file := files[i]
		lastFileID = file.ID

		// 跳过没有流水线信息的文件（从未经过 pipeline 或 cleaning_rule_info 为空）
		if !fileHasPipelineInfo(&file) {
			skipped++
			logger.Infof(ctx, "[SiteReindex] 跳过无流水线文件: file_id=%d", file.ID)
			continue
		}

		// 跳过 pipeline 向量索引步骤处于 paused（手动模式未执行）的文件
		// 这些文件可能被 auto-embedder 自动填充了 vector_id，但 pipeline 的
		// vector_indexing 步骤从未被用户手动触发过
		if s.isVectorIndexingStepPaused(ctx, run.Eid, &file) {
			skipped++
			logger.Infof(ctx, "[SiteReindex] 跳过 pipeline 向量索引未执行的文件: file_id=%d", file.ID)
			continue
		}

		if run.DimensionChanged {
			mode := GetVectorCollectionMode()
			isEnterpriseMode := mode == VectorCollectionModeEnterprise || mode == VectorCollectionModeDual
			logger.SysLogf("【诊断-重建集合触发】eid=%d, file_id=%d, library_id=%d, new_dimension=%d, mode=%s, rebuilt_library_ids=%s", run.Eid, file.ID, file.LibraryID, run.NewDimension, mode, run.RebuiltLibraryIDs)
			if isEnterpriseMode {
				if !run.IsEnterpriseRebuilt() {
					logger.SysLogf("【诊断-重建集合执行-enterprise】eid=%d, library_id=%d", run.Eid, file.LibraryID)
					if err := siteEmbeddingReindexRuntimeHooks.rebuildCollection(ctx, run.Eid, file.LibraryID, run.NewDimension); err != nil {
						logger.SysLogf("【诊断-重建集合失败】eid=%d, library_id=%d, err=%v", run.Eid, file.LibraryID, err)
						return err
					}
					logger.SysLogf("【诊断-重建集合成功-enterprise】eid=%d, library_id=%d", run.Eid, file.LibraryID)
					run.MarkEnterpriseRebuilt()
					if err := model.UpdateEmbeddingReindexRunProgress(s.db.WithContext(ctx), run.RunID, map[string]interface{}{
						"rebuilt_library_ids": run.RebuiltLibraryIDs,
					}); err != nil {
						return err
					}
				} else {
					logger.SysLogf("【诊断-重建集合跳过-enterprise】eid=%d, library_id=%d, enterprise集合已重建", run.Eid, file.LibraryID)
				}
			} else {
				if !run.IsLibraryRebuilt(file.LibraryID) {
					logger.SysLogf("【诊断-重建集合执行】eid=%d, library_id=%d", run.Eid, file.LibraryID)
					if err := siteEmbeddingReindexRuntimeHooks.rebuildCollection(ctx, run.Eid, file.LibraryID, run.NewDimension); err != nil {
						logger.SysLogf("【诊断-重建集合失败】eid=%d, library_id=%d, err=%v", run.Eid, file.LibraryID, err)
						return err
					}
					logger.SysLogf("【诊断-重建集合成功】eid=%d, library_id=%d", run.Eid, file.LibraryID)
					run.MarkLibraryRebuilt(file.LibraryID)
					if err := model.UpdateEmbeddingReindexRunProgress(s.db.WithContext(ctx), run.RunID, map[string]interface{}{
						"rebuilt_library_ids": run.RebuiltLibraryIDs,
					}); err != nil {
						return err
					}
				} else {
					logger.SysLogf("【诊断-重建集合跳过】eid=%d, library_id=%d 已被重建", run.Eid, file.LibraryID)
				}
			}
		} else {
			logger.SysLogf("【诊断-重建集合未触发】eid=%d, file_id=%d, library_id=%d, dimension_changed=false, old_dimension=%d, new_dimension=%d", run.Eid, file.ID, file.LibraryID, run.OldDimension, run.NewDimension)
		}

		if err := s.resetFileVectorState(ctx, run, &file); err != nil {
			return err
		}
		// 复用原始流水线的 run_id，让 API 按 run_id 查找时能同时返回所有步骤
		originalRunID := extractOriginalRunID(&file)
		if err := s.ensureVectorIndexingJob(ctx, run, &file, originalRunID); err != nil {
			return err
		}
		processed++
	}

	logger.Infof(ctx, "[SiteReindex] 本页处理完成: processed=%d, skipped=%d, cursor=(lib=%d,file=%d)", processed, skipped, run.CursorLibraryID, lastFileID)

	return model.UpdateEmbeddingReindexRunProgress(s.db.WithContext(ctx), run.RunID, map[string]interface{}{
		"status":         model.EmbeddingReindexStatusProcessing,
		"queued_files":   gorm.Expr("queued_files + ?", processed),
		"cursor_file_id": lastFileID,
	})
}

func (s *SiteEmbeddingReindexService) RecoverActiveRuns(ctx context.Context) error {
	if s == nil || s.db == nil {
		return errors.New("db is nil")
	}
	var runs []model.EmbeddingReindexRun
	if err := s.db.WithContext(ctx).
		Where("status IN ?", []string{model.EmbeddingReindexStatusPending, model.EmbeddingReindexStatusProcessing}).
		Order("id ASC").
		Find(&runs).Error; err != nil {
		return err
	}
	for _, run := range runs {
		if err := s.ProcessNextPage(ctx, run.RunID, siteEmbeddingReindexDefaultPageSize); err != nil {
			logger.Warnf(ctx, "[SiteReindex] 恢复批次失败: eid=%d, run_id=%s, err=%v", run.Eid, run.RunID, err)
		}
	}
	return nil
}

func (s *SiteEmbeddingReindexService) IsActiveRun(ctx context.Context, eid int64, runID string) (bool, error) {
	if s == nil || s.db == nil {
		return false, errors.New("db is nil")
	}
	if eid <= 0 || runID == "" {
		return false, nil
	}
	var count int64
	if err := s.db.WithContext(ctx).Model(&model.EmbeddingReindexRun{}).
		Where("eid = ? AND run_id = ? AND status IN ?", eid, runID, []string{model.EmbeddingReindexStatusPending, model.EmbeddingReindexStatusProcessing}).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *SiteEmbeddingReindexService) getActiveRunByRunID(ctx context.Context, runID string) (*model.EmbeddingReindexRun, error) {
	var run model.EmbeddingReindexRun
	if err := s.db.WithContext(ctx).Where("run_id = ?", runID).First(&run).Error; err != nil {
		return nil, err
	}
	if run.Status != model.EmbeddingReindexStatusPending && run.Status != model.EmbeddingReindexStatusProcessing {
		return nil, ErrStaleEmbeddingReindexRun
	}
	return &run, nil
}

func (s *SiteEmbeddingReindexService) resetFileVectorState(ctx context.Context, run *model.EmbeddingReindexRun, file *model.File) error {
	// 读取现有的 cleaning_rule_info，保留流水线信息
	info := model.FileCleaningRuleInfo{}
	if file.CleaningRuleInfo != "" {
		_ = json.Unmarshal([]byte(file.CleaningRuleInfo), &info)
	}
	// 如果没有流水线信息（从未经过 pipeline），跳过该文件
	if info.PipelineID == "" {
		logger.Infof(ctx, "[SiteReindex] 文件无流水线信息，跳过: file_id=%d", file.ID)
		return nil
	}

	// 保留 pipeline/strategy/run_id 等原始信息，只覆盖步骤运行状态
	// 注意：保留原始 TotalSteps，供 UpdateFileCleaningRuleInfoHelper 正确计算 run_status
	info.Status = "pending"
	info.Progress = 0
	info.StartTime = run.StartedTime
	info.EndTime = 0
	info.CurrentJobType = vectorIndexingJobType
	info.StepKey = vectorIndexingJobType
	info.StepName = "向量化索引"
	info.StepMode = string(v2model.RunModeAuto)

	infoBytes, err := json.Marshal(info)
	if err != nil {
		return err
	}

	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 更新 cleaning_rule_info 和 run_status，不碰 parsing_status
		if err := tx.Model(&model.File{}).
			Where("eid = ? AND id = ?", run.Eid, file.ID).
			Updates(map[string]interface{}{
				"cleaning_rule_info": string(infoBytes),
				"run_status":         "pending",
			}).Error; err != nil {
			return err
		}

		if err := tx.Model(&model.RetrievalChunk{}).
			Where("eid = ? AND file_id = ?", run.Eid, file.ID).
			Updates(map[string]interface{}{
				"embedding_status": model.RetrievalChunkEmbeddingStatusPending,
				"vector_id":        "",
				"error_reason":     "",
			}).Error; err != nil {
			return err
		}

		return tx.Model(&model.DocumentChunk{}).
			Where("eid = ? AND file_id = ?", run.Eid, file.ID).
			Updates(map[string]interface{}{
				"embedding_status": model.DocumentChunkEmbeddingStatusPending,
				"vector_id":        "",
			}).Error
	}); err != nil {
		return err
	}

	// 事务成功后清理 Redis dedup key，防止旧切换的 dedup 阻塞新入队
	// 格式需与 embedding_queue.go dedupKey() 保持一致
	if common.RDB != nil {
		var chunkIDs []int64
		if err := s.db.WithContext(ctx).Model(&model.RetrievalChunk{}).
			Where("eid = ? AND file_id = ?", run.Eid, file.ID).
			Pluck("id", &chunkIDs).Error; err != nil {
			logger.Warnf(ctx, "【SiteReindex】查询 chunk IDs 失败: %v", err)
			return nil
		}
		if len(chunkIDs) > 0 {
			pipe := common.RDB.Pipeline()
			for _, cid := range chunkIDs {
				pipe.Del(ctx, DedupKey(run.Eid, cid))
			}
			if _, err := pipe.Exec(ctx); err != nil {
				logger.Warnf(ctx, "【SiteReindex】清理 dedup key 失败: %v", err)
			}
		}
	}

	return nil
}

func (s *SiteEmbeddingReindexService) ensureVectorIndexingJob(ctx context.Context, run *model.EmbeddingReindexRun, file *model.File, originalRunID string) error {
	if originalRunID == "" {
		logger.Infof(ctx, "[SiteReindex] 无原始流水线 run_id，跳过: file_id=%d", file.ID)
		return nil
	}

	// 查找该文件在原始流水线下的 vector_indexing job
	var existingJob model.RagJob
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND related_id = ? AND type = ? AND run_id = ?",
			run.Eid, file.ID, vectorIndexingJobType, originalRunID).
		Order("created_time DESC").
		First(&existingJob).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			logger.Infof(ctx, "[SiteReindex] 原始流水线无 vector_indexing 步骤，跳过: file_id=%d", file.ID)
			return nil
		}
		return err
	}

	// 构建 reindex 参数
	params := map[string]interface{}{
		"eid":                              run.Eid,
		"file_id":                          file.ID,
		"user_id":                          int64(0),
		"__profile_step_index":             0,
		"embedding_reindex_run_id":         run.ID,
		"embedding_reindex_batch_run_id":   run.RunID,
		"embedding_reindex_new_model":      run.NewModelName,
		"embedding_reindex_new_channel_id": run.NewChannelID,
	}
	paramsBytes, err := json.Marshal(params)
	if err != nil {
		return err
	}

	// 原子条件更新：job 尚未包含本批次号时才能重置
	// 场景覆盖：
	// - success → 正常重置为新批次 ✅
	// - pending(旧批次覆盖) → 允许新批次覆盖 ✅
	// - failed → 允许新批次重试 ✅
	// - processing → 强制重置（旧 handler 继续运行，但最终 status 会被覆盖）✅
	// - 同一批次重复调用 → params 已含本批次号 → NOT LIKE 不匹配 → 跳过 ✅
	currentBatchPattern := fmt.Sprintf("%%embedding_reindex_batch_run_id%%%s%%", run.RunID)
	result := s.db.WithContext(ctx).Model(&model.RagJob{}).
		Where("job_id = ? AND (start_parameters NOT LIKE ? OR start_parameters IS NULL)",
			existingJob.JobID,
			currentBatchPattern,
		).
		Updates(map[string]interface{}{
			"status":           model.RagJobStatusPending,
			"failure_reason":   "",
			"start_parameters": string(paramsBytes),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		logger.Infof(ctx, "[SiteReindex] vector_indexing job 已被本批次覆盖，跳过: file_id=%d, job_id=%d", file.ID, existingJob.JobID)
		// resetFileVectorState 已重置 chunk 状态，但 job 不一定重新执行（例如 handler 已卡死）
		// 补入队 chunk embedding 任务，让可能卡住的 waitForEmbeddingCompletion 有机会完成
		if model.DB != nil {
			if err := EnqueueRetrievalChunksByFile(run.Eid, file.ID, file.LibraryID); err != nil {
				logger.Warnf(ctx, "[SiteReindex] 补入队 chunk embedding 失败: file_id=%d, err=%v", file.ID, err)
			}
		}
		return nil
	}

	// 更新内存对象状态后入队
	existingJob.Status = model.RagJobStatusPending
	existingJob.StartParameters = string(paramsBytes)
	return siteEmbeddingReindexRuntimeHooks.enqueueJob(ctx, &existingJob)
}

func (s *SiteEmbeddingReindexService) hasExistingVectorIndexingJob(ctx context.Context, run *model.EmbeddingReindexRun, fileID int64) (bool, error) {
	var count int64
	pattern := fmt.Sprintf("%%embedding_reindex_batch_run_id%%%s%%", run.RunID)
	if err := s.db.WithContext(ctx).Model(&model.RagJob{}).
		Where("eid = ? AND related_id = ? AND type = ? AND status IN ? AND start_parameters LIKE ?",
			run.Eid,
			fileID,
			vectorIndexingJobType,
			[]string{model.RagJobStatusPending, model.RagJobStatusProcessing, model.RagJobStatusSuccess},
			pattern,
		).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func resolveEmbeddingModelDimension(modelName string) (int, error) {
	if modelName == "" {
		return 0, nil
	}
	meta, err := common.GetModelCatalogLoader().GetEmbeddingModelMeta(modelName)
	if err != nil {
		return 0, err
	}
	return meta.Dimensions, nil
}

func enqueueSiteEmbeddingReindexJob(ctx context.Context, job *model.RagJob) error {
	if job == nil {
		return errors.New("job is nil")
	}
	if !common.IsRedisEnabled() || common.RDB == nil {
		return common.ErrRedisNotEnabled
	}
	wrapper := v2engines.JobWrapper{
		JobID:      job.JobID,
		Eid:        job.Eid,
		Type:       job.Type,
		EnqueuedAt: time.Now(),
		Retries:    0,
	}
	wrapperBytes, err := json.Marshal(wrapper)
	if err != nil {
		return err
	}
	return common.RDB.LPush(ctx, "rag:job:queue:vector_indexing", wrapperBytes).Err()
}

func rebuildSiteEmbeddingReindexCollection(ctx context.Context, eid, libraryID int64, newDimension int) error {
	cfg := vectorstore.LoadFromEnv()
	store, err := vectorstore.NewVectorStore(cfg)
	if err != nil {
		return err
	}
	if err := store.Connect(ctx); err != nil {
		return err
	}
	defer store.Disconnect(ctx)

	mode := GetVectorCollectionMode()
	// 对于 enterprise-level 集合：维度变化时整个集合必须重建（Qdrant 集合维度固定不可变）
	if mode == VectorCollectionModeEnterprise || mode == VectorCollectionModeDual {
		entCollection := model.GetDocumentVectorCollectionName(eid)
		logger.SysLogf("【诊断-重建删除集合-enterprise】eid=%d, library_id=%d, dimension=%d, collection=%s", eid, libraryID, newDimension, entCollection)
		if err := store.DeleteCollection(ctx, entCollection); err != nil {
			if !vectorstore.IsNotFoundError(err) {
				return fmt.Errorf("删除企业级集合 %s 失败: %v", entCollection, err)
			}
			logger.SysLogf("【诊断-重建删除集合-enterprise】企业级集合不存在跳过: %s", entCollection)
		} else {
			logger.SysLogf("【诊断-重建删除集合-enterprise】已删除企业级集合: %s", entCollection)
		}

		// 重建集合（用实际 API 维度，而非 catalog 维度）
		if newDimension > 0 {
			logger.SysLogf("【诊断-重建集合-enterprise】创建新集合: %s, dimension=%d", entCollection, newDimension)
			if err := store.CreateCollection(ctx, vectorstore.CollectionConfig{
				Name:      entCollection,
				Dimension: newDimension,
				Metric:    cfg.DistanceMetric,
			}); err != nil {
				return fmt.Errorf("重建企业级集合 %s 失败: %v", entCollection, err)
			}
			logger.SysLogf("【诊断-重建集合-enterprise】新集合创建成功: %s, dimension=%d", entCollection, newDimension)
		}
	}

	logger.SysLogf("【诊断-重建删除集合完成】eid=%d, library_id=%d, mode=%s, new_dimension=%d", eid, libraryID, mode, newDimension)

	return nil
}

// fileHasPipelineInfo 检查文件是否有完整的流水线上下文
// 用于 ProcessNextPage 中跳过从未经过 pipeline 的文件
// countPendingReindexJobs 统计该 reindex run 入队后尚未完成的向量化 job 数量
// 用于防止 run 在 job 被 worker 消费前就标记为 success，导致 guard 拒绝执行
func (s *SiteEmbeddingReindexService) countPendingReindexJobs(ctx context.Context, run *model.EmbeddingReindexRun) (int64, error) {
	pattern := fmt.Sprintf("%%embedding_reindex_batch_run_id%%%s%%", run.RunID)
	var count int64
	if err := s.db.WithContext(ctx).Model(&model.RagJob{}).
		Where("eid = ? AND type = ? AND status IN ? AND start_parameters LIKE ?",
			run.Eid, vectorIndexingJobType,
			[]string{model.RagJobStatusPending, model.RagJobStatusProcessing},
			pattern,
		).Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

// isVectorIndexingStepPaused 检查文件当前 pipeline 的 vector_indexing step
// 是否处于 paused（手动模式）且从未被执行过。
// 区分场景：
//   - paused → pipeline 步骤为 manual，用户未手动触发 → 应跳过
//   - pending/processing/success → pipeline 步骤为 auto 或已被执行 → 不应跳过
func (s *SiteEmbeddingReindexService) isVectorIndexingStepPaused(ctx context.Context, eid int64, file *model.File) bool {
	runID := extractOriginalRunID(file)
	if runID == "" {
		return true
	}
	var job model.RagJob
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND related_id = ? AND type = ? AND run_id = ?",
			eid, file.ID, vectorIndexingJobType, runID).
		First(&job).Error; err != nil {
		// 找不到 job 说明无 vector_indexing 步骤，跳过
		return true
	}
	return job.Status == model.RagJobStatusPaused
}

func fileHasPipelineInfo(file *model.File) bool {
	if file.CleaningRuleInfo == "" {
		return false
	}
	var info model.FileCleaningRuleInfo
	if err := json.Unmarshal([]byte(file.CleaningRuleInfo), &info); err != nil {
		return false
	}
	return info.PipelineID != ""
}

// extractOriginalRunID 从文件的 cleaning_rule_info 中提取原始流水线的 run_id
func extractOriginalRunID(file *model.File) string {
	if file.CleaningRuleInfo == "" {
		return ""
	}
	var info model.FileCleaningRuleInfo
	if err := json.Unmarshal([]byte(file.CleaningRuleInfo), &info); err != nil {
		return ""
	}
	return info.RunID
}
