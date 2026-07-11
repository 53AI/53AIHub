package logviewer

import (
  "io"
  "os"
  "path/filepath"
  "strings"
 )

// ArchiveResult 归档操作结果
type ArchiveResult struct {
	ArchivedFiles []ArchivedFile `json:"archived_files"`
	TotalSize     int64          `json:"total_size"`
	ArchivedSize  int64          `json:"archived_size"`
}

// ArchivedFile 单个归档文件信息
type ArchivedFile struct {
	Name           string `json:"name"`
	Size           int64  `json:"size"`
	CompressedSize int64  `json:"compressed_size"`
}

// ArchiveOldLogs 归档日志目录中的所有日志文件。
// 每个文件会被复制到 archive/ 子目录，然后清空原文件（保留 inode，
// 不影响正在写入的日志句柄）。
func ArchiveOldLogs(logDir string) (*ArchiveResult, error) {
	result := &ArchiveResult{
		ArchivedFiles: make([]ArchivedFile, 0),
	}

	// 查找所有日志文件（跳过已有的 archive 目录）
	allFiles, err := collectLogFiles(logDir, true)
	if err != nil {
		return nil, err
	}

	// 创建 archive 目录
	archiveDir := filepath.Join(logDir, "archive")
	if err := os.MkdirAll(archiveDir, 0755); err != nil {
		return nil, err
	}

	for _, fpath := range allFiles {
	  base := filepath.Base(fpath)

	  // 跳过 slow.log（独立慢日志文件，不应被归档清空）
	  if strings.HasPrefix(base, "slow") {
	   continue
	  }

	  // 打开原文件
		src, err := os.Open(fpath)
		if err != nil {
			continue
		}

		// 复制到 archive/<name>（保留为纯文本，不压缩）
		archivePath := filepath.Join(archiveDir, base)
		dst, err := os.Create(archivePath)
		if err != nil {
			src.Close()
			continue
		}

		copied, err := io.Copy(dst, src)
		src.Close()

		// 关闭目标文件，确保数据完全刷入磁盘；失败时归档不完整，跳过截断
		if closeErr := dst.Close(); closeErr != nil {
			os.Remove(archivePath)
			continue
		}
		if err != nil {
			os.Remove(archivePath)
			continue
		}

		// 清空原文件（保留 inode，不影响仍在写入的日志句柄）
		if err := os.Truncate(fpath, 0); err != nil {
			os.Remove(archivePath)
			continue
		}

		archiveStat, _ := os.Stat(archivePath)
		var archiveSize int64
		if archiveStat != nil {
			archiveSize = archiveStat.Size()
		}

		result.TotalSize += copied
		result.ArchivedSize += archiveSize
		result.ArchivedFiles = append(result.ArchivedFiles, ArchivedFile{
			Name:           base,
			Size:           copied,
			CompressedSize: archiveSize,
		})
	}

	return result, nil
}
