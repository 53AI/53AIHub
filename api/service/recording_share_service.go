package service

import (
	"context"
	"errors"
	"fmt"
	"path"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/shareid"
	"github.com/53AI/53AIHub/model"

	"gorm.io/gorm"
)

var ErrRecordingShareNotFound = errors.New("录音分享不存在")

// CreateRecordingShare 创建录音分享，返回 shareID。参考 /api/shares 模式：无有效期。
func CreateRecordingShare(ctx context.Context, eid, fileID, shareBy int64) (string, error) {
	const maxRetry = 3
	for i := 0; i < maxRetry; i++ {
		id, err := shareid.Generate()
		if err != nil {
			return "", fmt.Errorf("生成 share_id 失败: %w", err)
		}
		rec := &model.RecordingShare{
			Eid:     eid,
			FileID:  fileID,
			ShareID: id,
			ShareBy: shareBy,
		}
		if err := model.DB.WithContext(ctx).Create(rec).Error; err != nil {
			if isUniqueConflictErr(err) {
				continue
			}
			return "", err
		}
		logger.Infof(ctx, "CreateRecordingShare success eid=%d fileID=%d shareID=%s", eid, fileID, id)
		return id, nil
	}
	return "", errors.New("create recording share failed after retries")
}

// GetRecordingShare 按 shareID 查询分享记录。
func GetRecordingShare(ctx context.Context, shareID string) (*model.RecordingShare, error) {
	var rec model.RecordingShare
	if err := model.DB.WithContext(ctx).Where("share_id = ?", shareID).First(&rec).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRecordingShareNotFound
		}
		return nil, err
	}
	return &rec, nil
}

// TODO: 与 service/sharefiles/share_service.go 中的 isUniqueConflict 重复，后续提取到 common 层复用。
// isUniqueConflictErr 判断是否为唯一键冲突错误。
func isUniqueConflictErr(err error) bool {
	msg := err.Error()
	if strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "UNIQUE constraint failed") ||
		strings.Contains(msg, "Duplicate entry") ||
		strings.Contains(msg, "unique constraint") {
		return true
	}
	return false
}

// GetSharedRecordingContent 组装分享的录音内容（转写/纪要/洞察/洞察页/文件元信息）。
// 分享链接匿名访问用；数据组装集中在 service 层，便于复用与测试。
func GetSharedRecordingContent(ctx context.Context, shareID string) (map[string]interface{}, error) {
	rec, err := GetRecordingShare(ctx, shareID)
	if err != nil {
		return nil, err
	}

	data := map[string]interface{}{
		"file_id": rec.FileID,
	}

	// 文件元信息（title 供转写 markdown 渲染使用）
	file, err := model.GetFileByID(rec.Eid, rec.FileID)
	title := ""
	if err == nil {
		title = filePathBase(file.Path)
		data["title"] = title
		data["duration_ms"] = file.DurationMs
		data["created_time"] = file.CreatedTime
		// 语音文件字段（与录音列表一致：File.UploadFile 序列化）
		file.LoadUploadFile()
		if file.UploadFile != nil {
			data["upload_file"] = file.UploadFile
		}
	}

	// 转写（统一 Markdown 输出：SonicNote 数组 / DashScope 对象 / 非 JSON 格式感知，
	// 复用导出渲染逻辑 RenderTranscriptMarkdown，前端无需区分转写来源二次处理）
	if text, err := LoadTranscriptText(rec.Eid, rec.FileID); err == nil {
		if md, mdErr := RenderTranscriptMarkdown(text, title); mdErr == nil {
			data["transcription"] = md
		} else {
			data["transcription"] = text // 渲染失败降级返回原文
		}
	}

	// 纪要放回 summaries（复用 ListFileSummaries 组装：过滤转写原文 -1/-2、
	// template_id=0 渲染 Markdown、反转后从 FileBody 合成虚拟纪要），与文件 summaries 接口一致
	svc := NewRecordingAdminService(rec.Eid)
	if summaries, err := svc.ListFileSummaries(ctx, rec.FileID); err == nil {
		data["summaries"] = summaries
	}

	// 分享人信息（昵称/头像）
	var sharer model.User
	if err := model.DB.WithContext(ctx).Where("user_id = ?", rec.ShareBy).First(&sharer).Error; err == nil {
		data["nickname"] = sharer.Nickname
		data["avatar"] = sharer.Avatar
	} else {
		data["nickname"] = ""
		data["avatar"] = ""
	}

	// 洞察页面
	if page, err := model.GetRecordingFileInsightPageByFileID(rec.FileID); err == nil && page != nil {
		data["insight_page"] = page.PageJSON
	}

	return data, nil
}

// filePathBase 返回路径最后一段（file.path 前端展示用）。
func filePathBase(p string) string {
	p = strings.TrimSpace(p)
	if p == "" || p == "/" {
		return p
	}
	name := path.Base(p)
	if name == "." || name == "/" {
		return p
	}
	return name
}
