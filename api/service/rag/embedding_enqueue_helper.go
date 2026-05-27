package rag

import (
	"context"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

// EnqueueRetrievalChunksByFile will enqueue all retrieval chunks of a file for embedding.
// If queue is not set, it logs and returns nil.
func EnqueueRetrievalChunksByFile(eid, fileID, libraryID int64) error {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return err
	}

	err = _enqueueRetrievalChunksByFile(eid, fileID, libraryID)
	if err != nil {
		logger.Warn(context.TODO(), fmt.Sprintf("[embEnqueueByFileError][eid=%d][fileID=%d]%v", eid, fileID, err))

		file.ParsingStatus = model.FileParsingStatusFail
		common.SetFileStop(file.ID)
		file.Update()

		model.UpdateRetrievalChunksStatusToFailedByFileID(file.Eid, file.ID, err.Error())
		model.UpdateDocumentChunksStatusToFailedByFileID(file.Eid, file.ID)
	}

	return err
}

func _enqueueRetrievalChunksByFile(eid, fileID, libraryID int64) error {
	// 未配置向量化渠道则不入队
	cfgSvc := NewChunkConfigService(model.DB)
	cfg, cfgErr := cfgSvc.GetConfig(eid, &libraryID, model.ChunkTypeDefault)
	if cfgErr != nil {
		CheckEmbeddingStepStatusSave(eid, fileID, fmt.Sprintf("time:%d; 获取向量化配置失败 Err:%v", time.Now().Unix(), cfgErr))
		logger.Warn(context.TODO(), fmt.Sprintf("[embEnqueueConfigCheckError][eid=%d][fileID=%d] %v", eid, fileID, cfgErr))
	}
	if cfg == nil || cfg.EmbeddingChannelID == nil {
		CheckEmbeddingStepStatusSave(eid, fileID, fmt.Sprintf("time:%d; 未配置向量化渠道", time.Now().Unix()))
		logger.Warn(context.TODO(), fmt.Sprintf("[embEnqueueSkipNoEmbeddingChannel][eid=%d][fileID=%d][libraryID=%d]", eid, fileID, libraryID))
		return nil
	}

	q := GetDefaultEmbeddingQueue()
	if q == nil {
		CheckEmbeddingStepStatusSave(eid, fileID, fmt.Sprintf("time:%d; 未配置向量化渠道", time.Now().Unix()))
		logger.Warn(context.TODO(), fmt.Sprintf("[embEnqueueSkipNoQueue][eid=%d][fileID=%d]", eid, fileID))
		return nil
	}

	// 检查 API
	retrievalService := NewRetrievalChunkService(model.DB)
	err := retrievalService.CheckGenerateEmbeddingForChunk(eid, &libraryID, &fileID, "TestAPI")
	if err != nil {
		CheckEmbeddingStepStatusSave(eid, fileID, fmt.Sprintf("time:%d; embedding API 不可用 Err:%v", time.Now().Unix(), err))
		return fmt.Errorf("embedding API 不可用: %v", err)
	}

	var rids []int64
	if err := model.DB.Model(&model.RetrievalChunk{}).
		Joins("JOIN files ON retrieval_chunks.file_id = files.id AND retrieval_chunks.eid = files.eid").
		Where("retrieval_chunks.eid = ? AND retrieval_chunks.file_id = ? AND files.parsing_status != ?", eid, fileID, model.FileParsingStatusDisabled).
		Pluck("retrieval_chunks.id", &rids).Error; err != nil {
		CheckEmbeddingStepStatusSave(eid, fileID, fmt.Sprintf("time:%d; 获取检索块失败 Err:%v", time.Now().Unix(), err))
		return err
	}
	CheckEmbeddingStepStatusSave(eid, fileID, fmt.Sprintf("time:%d; 获取检索块成功 count:%d", time.Now().Unix(), len(rids)))
	for _, rid := range rids {
		_, err := q.EnqueueIfNotExists(context.TODO(), EmbeddingTask{
			Eid:              eid,
			RetrievalChunkID: rid,
			FileID:           fileID,
			LibraryID:        libraryID,
			TraceID:          "",
			Retries:          0,
		})
		CheckEmbeddingStepStatusSave(eid, fileID, fmt.Sprintf("add_rid:%d", rid))
		if err != nil {
			logger.Warn(context.TODO(), fmt.Sprintf("[embEnqueueOneFail][eid=%d][fileID=%d][rid=%d]%+v", eid, fileID, rid, err))
		}
	}

	logger.Info(context.TODO(), fmt.Sprintf("[embEnqueueByFileDone][eid=%d][fileID=%d][count=%d]", eid, fileID, len(rids)))
	return nil
}

// EnqueueRetrievalChunk enqueues a single retrieval chunk id.
func EnqueueRetrievalChunk(eid, fileID, libraryID, retrievalChunkID int64) {
	q := GetDefaultEmbeddingQueue()
	if q == nil {
		logger.Warn(context.TODO(), fmt.Sprintf("[embEnqueueSkipNoQueue][eid=%d][fileID=%d][rid=%d]", eid, fileID, retrievalChunkID))
		return
	}
	_, err := q.EnqueueIfNotExists(context.TODO(), EmbeddingTask{
		Eid:              eid,
		RetrievalChunkID: retrievalChunkID,
		FileID:           fileID,
		LibraryID:        libraryID,
		TraceID:          "",
		Retries:          0,
	})
	if err != nil {
		logger.Warn(context.TODO(), fmt.Sprintf("[embEnqueueOneFail][eid=%d][fileID=%d][rid=%d]%+v", eid, fileID, retrievalChunkID, err))
	}
}
