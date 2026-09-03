package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// RecordingStorageLayoutMigrateResult 单文件存储布局迁移结果。
type RecordingStorageLayoutMigrateResult struct {
	FileID  int64
	Layout  string // 判别出的原布局/处置
	Changed bool
}

// MigrateRecordingStorageLayout 将单个录音文件的存储布局迁移到新布局：
//
//	FileBody(最新)                          = 转写 Markdown
//	recording_file_summaries(template_id=0) = 纪要 JSON
//	recording_file_summaries(template_id=-1)= 转写原文（原始 JSON）
//
// 布局判别（按 FileBody 内容类型）：
//   - 反转布局（FileBody=纪要JSON + Summary(-1)=原文）→ 写 Summary(0)=纪要，FileBody 用原文渲染为 Markdown
//   - 最老布局（FileBody=转写JSON + Summary(0)=纪要）→ 写 Summary(-1)=原JSON，FileBody 渲染为 Markdown
//   - 目标布局（FileBody=转写Markdown + Summary(-1)=原文）→ 跳过（幂等）
//
// 只搬数据，不重新分块/向量（存量分块/向量保持旧内容，手动重跑管线才更新）。每文件独立事务。
func MigrateRecordingStorageLayout(ctx context.Context, eid, fileID int64) (RecordingStorageLayoutMigrateResult, error) {
	res := RecordingStorageLayoutMigrateResult{FileID: fileID}

	body, err := model.GetLastFileBodyByFileID(eid, fileID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			res.Layout = "no_file_body"
			return res, nil
		}
		return res, fmt.Errorf("读取 FileBody 失败: %w", err)
	}
	content, err := body.GetContent()
	if err != nil {
		return res, fmt.Errorf("读取 FileBody 内容失败: %w", err)
	}
	content = strings.TrimSpace(content)
	if content == "" {
		res.Layout = "empty"
		return res, nil
	}

	switch classifyRecordingContent(content) {
	case recordingContentTranscriptMD:
		// 目标布局。缺 Summary(-1) 无法补齐原文（无源可造）→ 跳过并记录。
		if _, serr := model.GetSummaryByTemplateID(fileID, -1); serr != nil {
			res.Layout = "transcript_md_missing_raw"
			return res, nil
		}
		res.Layout = "already_target"
		return res, nil

	case recordingContentTranscriptJSON:
		// 最老布局：FileBody=转写JSON。→ Summary(-1)=原JSON + FileBody 渲染为 Markdown。
		raw := content
		md, rerr := RenderTranscriptMarkdown(raw, "")
		if rerr != nil {
			return res, fmt.Errorf("渲染转写 Markdown 失败: %w", rerr)
		}
		if strings.TrimSpace(md) == "" {
			res.Layout = "render_empty"
			return res, nil
		}
		if err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Where("file_id = ? AND template_id = -1", fileID).Delete(&model.RecordingFileSummary{}).Error; err != nil {
				return err
			}
			ts := &model.RecordingFileSummary{
				FileID:         fileID,
				TemplateID:     -1,
				TemplateName:   "转写原文",
				SummaryContent: model.LongText(raw),
			}
			if err := tx.Create(ts).Error; err != nil {
				return err
			}
			// FileBody 重写为 Markdown（清 ContentPath 让 BeforeSave 重存）
			body.ContentPath = ""
			body.Content = md
			return tx.Save(body).Error
		}); err != nil {
			return res, fmt.Errorf("迁移最老布局失败: %w", err)
		}
		res.Layout = "oldest_to_target"
		res.Changed = true
		return res, nil

	case recordingContentMinutesJSON:
		// 反转布局：FileBody=纪要JSON。→ Summary(0)=纪要 + FileBody 用 Summary(-1) 原文渲染为 Markdown。
		minutesJSON := content
		if _, serr := model.GetSummaryByTemplateID(fileID, -1); serr != nil {
			res.Layout = "minutes_json_missing_raw"
			return res, nil
		}
		// 事务外预读/预渲染（避免单连接数据库在事务内再取连接死锁）
		raw, rerr := loadTranscriptTextRaw(ctx, eid, fileID)
		if rerr != nil {
			return res, fmt.Errorf("读取转写原文失败: %w", rerr)
		}
		md, rerr := RenderTranscriptMarkdown(raw, "")
		if rerr != nil {
			return res, fmt.Errorf("渲染转写 Markdown 失败: %w", rerr)
		}
		if strings.TrimSpace(md) == "" {
			res.Layout = "render_empty"
			return res, nil
		}
		if err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			// 纪要回原表 Summary(0)
			if err := tx.Where("file_id = ? AND template_id = 0", fileID).Delete(&model.RecordingFileSummary{}).Error; err != nil {
				return err
			}
			ms := &model.RecordingFileSummary{
				FileID:           fileID,
				TemplateID:       0,
				TemplateName:     "纪要",
				SummaryContent:   model.LongText(minutesJSON),
				Status:           "completed",
			}
			if err := tx.Create(ms).Error; err != nil {
				return err
			}
			// FileBody = 转写 Markdown（已渲染，重存覆盖）
			body.ContentPath = ""
			body.Content = md
			return tx.Save(body).Error
		}); err != nil {
			return res, fmt.Errorf("迁移反转布局失败: %w", err)
		}
		res.Layout = "reversed_to_target"
		res.Changed = true
		return res, nil

	default:
		res.Layout = "unknown"
		return res, nil
	}
}
