package service

import (
	"context"
	"fmt"
	"sync"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
)

// ReprocessRetrievalResult 检索块重拆结果
type ReprocessRetrievalResult struct {
	Total   int `json:"total"`   // 范围内文件总数
	Success int `json:"success"` // 重拆成功数
	Failed  int `json:"failed"`  // 重拆失败数
	Skipped int `json:"skipped"` // 跳过数（无知识块的文件）
}

// ReprocessRetrievalChunks 对指定范围（文档/知识库/空间）内已有知识块的文件，重新生成检索块并异步向量化。
// - document_chunks（知识块）保持不变，仅重建 retrieval_chunks；
// - indexMaxLength > 0 时覆盖检索块长度（如 256），否则沿用当前匹配到的企业/文档配置；
// - batch 控制后台并发文件数，默认 1（串行执行）。
func (sm *ServiceManager) ReprocessRetrievalChunks(ctx context.Context, eid, spaceID, libraryID, fileID int64, indexMaxLength, batch int) (ReprocessRetrievalResult, error) {
	var result ReprocessRetrievalResult

	fileIDs, err := sm.resolveReprocessFileIDs(eid, spaceID, libraryID, fileID)
	if err != nil {
		return result, err
	}
	if len(fileIDs) == 0 {
		logger.SysLogf("重拆检索块无目标文件: eid=%d space_id=%d library_id=%d file_id=%d", eid, spaceID, libraryID, fileID)
		return result, nil
	}
	if batch <= 0 {
		batch = 1
	}

	result.Total = len(fileIDs)
	var mu sync.Mutex
	var wg sync.WaitGroup
	workCh := make(chan int64)

	worker := func() {
		defer wg.Done()
		for fid := range workCh {
			if !sm.fileHasKnowledgeChunks(eid, fid) {
				mu.Lock()
				result.Skipped++
				mu.Unlock()
				logger.SysLogf("重拆检索块跳过无知识块文件: eid=%d file_id=%d", eid, fid)
				continue
			}
			if err := sm.reprocessRetrievalChunk(eid, fid, indexMaxLength); err != nil {
				mu.Lock()
				result.Failed++
				mu.Unlock()
				logger.Errorf(ctx, "重拆检索块失败: eid=%d file_id=%d err=%v", eid, fid, err)
				continue
			}
			mu.Lock()
			result.Success++
			mu.Unlock()
		}
	}

	for i := 0; i < batch; i++ {
		wg.Add(1)
		go worker()
	}
	for _, fid := range fileIDs {
		workCh <- fid
	}
	close(workCh)
	wg.Wait()

	logger.SysLogf("重拆检索块完成: eid=%d total=%d success=%d failed=%d skipped=%d", eid, result.Total, result.Success, result.Failed, result.Skipped)
	return result, nil
}

// resolveReprocessFileIDs 按范围解析目标文件ID列表（优先级：文档 > 知识库 > 空间）
func (sm *ServiceManager) resolveReprocessFileIDs(eid, spaceID, libraryID, fileID int64) ([]int64, error) {
	var ids []int64
	switch {
	case fileID > 0:
		f, err := model.GetFileByID(eid, fileID)
		if err != nil {
			return nil, fmt.Errorf("获取文件失败: %v", err)
		}
		if f.IsDeleted {
			return nil, fmt.Errorf("文件已删除: file_id=%d", fileID)
		}
		return []int64{f.ID}, nil
	case libraryID > 0:
		lib, err := model.GetLibraryByID(eid, libraryID)
		if err != nil {
			return nil, fmt.Errorf("获取知识库失败: %v", err)
		}
		return sm.collectLibraryFileIDs(eid, lib.ID)
	case spaceID > 0:
		sp, err := model.GetSpaceByID(eid, spaceID)
		if err != nil {
			return nil, fmt.Errorf("获取空间失败: %v", err)
		}
		libs, err := model.GetLibrariesBySpaceID(eid, sp.ID)
		if err != nil {
			return nil, fmt.Errorf("获取空间知识库失败: %v", err)
		}
		for _, lib := range libs {
			libIDs, err := sm.collectLibraryFileIDs(eid, lib.ID)
			if err != nil {
				return nil, err
			}
			ids = append(ids, libIDs...)
		}
		return ids, nil
	default:
		return nil, fmt.Errorf("必须指定一个范围：file_id / library_id / space_id")
	}
}

// collectLibraryFileIDs 获取知识库下未删除的文件ID列表
func (sm *ServiceManager) collectLibraryFileIDs(eid, libraryID int64) ([]int64, error) {
	files, err := model.GetFilesByLibraryID(eid, libraryID)
	if err != nil {
		return nil, fmt.Errorf("获取知识库文件失败: %v", err)
	}
	var ids []int64
	for _, f := range files {
		if !f.IsDeleted {
			ids = append(ids, f.ID)
		}
	}
	return ids, nil
}

// fileHasKnowledgeChunks 判断文件是否存在知识块（document_chunks, chunk_type=knowledge）
func (sm *ServiceManager) fileHasKnowledgeChunks(eid, fileID int64) bool {
	var count int64
	sm.db.Model(&model.DocumentChunk{}).
		Where("eid = ? AND file_id = ? AND chunk_type = ?", eid, fileID, "knowledge").
		Count(&count)
	return count > 0
}

// reprocessRetrievalChunk 对单个文件重建检索块
func (sm *ServiceManager) reprocessRetrievalChunk(eid, fileID int64, indexMaxLength int) error {
	f, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return fmt.Errorf("获取文件信息失败: %v", err)
	}

	var cfg *rag.ChunkConfig
	if indexMaxLength > 0 {
		cfg, err = sm.configService.GetConfigWithFileID(eid, &f.LibraryID, &fileID)
		if err != nil {
			return fmt.Errorf("获取分块配置失败: %v", err)
		}
		cfg.IndexChunk.MaxLength = indexMaxLength
		cfg.IndexMaxLength = indexMaxLength
	}

	return sm.chunkerService.ReindexDocumentWithConfig(eid, fileID, cfg)
}
