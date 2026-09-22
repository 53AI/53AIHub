package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// 录音转写/纪要统一复用基础层。
//
// 语义（录音生成 / 导入 / SonicNote 同步三场景共用）：
//   - 仅录音文件参与复用（File.IsRecordingOriginType，origin_type ∈ recording_audio/recording_folder/recording_imported）
//   - 复用源按同内容判定：upload_files.hash 为主键、upload_file_id 兜底（同步复用路径的 File 与源共享 upload_file）
//   - 只拷贝 completed 的转写/纪要；源无/pending/failed → 调用方各自走管线生成（不等待、不轮询）
//   - 洞察（InsightSummary）永不拷贝（个人化产物，由 GenerateInsights 按当前用户重新生成）
//   - 空 hash 不参与匹配（防同步文件间空值互配）；历史同步文件 hash 为空仅失去复用收益

// findReuseSourceCandidates 查询复用源候选（updated DESC）。
// 条件：同 eid、未软删、录音来源（origin_type ∈ recording_audio/recording_folder/recording_imported）、
// 排除目标自身；(hash 非空时命中同 hash 的 upload_files) OR (upload_file_id 命中)。
func findReuseSourceCandidates(ctx context.Context, eid int64, hash string, uploadFileID, excludeFileID int64) ([]*model.File, error) {
	hash = strings.TrimSpace(hash)
	if hash == "" && uploadFileID <= 0 {
		return nil, nil
	}

	q := model.DB.WithContext(ctx).Model(&model.File{}).
		Where("eid = ? AND is_deleted = ? AND id != ?", eid, false, excludeFileID).
		Where("origin_type IN ?", []string{
			model.FileOriginTypeRecordingAudio,
			model.FileOriginTypeRecordingFolder,
			model.FileOriginTypeRecordingImported,
		})

	switch {
	case hash != "" && uploadFileID > 0:
		q = q.Where("(upload_file_id = ? OR upload_file_id IN (SELECT id FROM upload_files WHERE eid = ? AND hash = ?))", uploadFileID, eid, hash)
	case hash != "":
		q = q.Where("upload_file_id IN (SELECT id FROM upload_files WHERE eid = ? AND hash = ?)", eid, hash)
	default:
		q = q.Where("upload_file_id = ?", uploadFileID)
	}

	var files []*model.File
	if err := q.Order("updated_time DESC").Find(&files).Error; err != nil {
		return nil, err
	}
	return files, nil
}

// parseCleaningRuleInfo 解析 File.CleaningRuleInfo JSON。
func parseCleaningRuleInfo(raw string) model.FileCleaningRuleInfo {
	var info model.FileCleaningRuleInfo
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &info)
	}
	return info
}

// fileTranscriptionStatus 读取文件转写状态。
func fileTranscriptionStatus(file *model.File) string {
	return parseCleaningRuleInfo(file.CleaningRuleInfo).TranscriptionStatus
}

// fileMeetingMinutesStatus 读取文件纪要状态。
func fileMeetingMinutesStatus(file *model.File) string {
	return parseCleaningRuleInfo(file.CleaningRuleInfo).MeetingMinutesStatus
}

// ReuseSourceHasTranscript 源文件是否已有 completed 转写（且内容可读）。
func ReuseSourceHasTranscript(ctx context.Context, eid, srcFileID int64) (bool, error) {
	file, err := model.GetFileByID(eid, srcFileID)
	if err != nil {
		return false, err
	}
	if fileTranscriptionStatus(file) != "completed" {
		return false, nil
	}
	// 双保险：completed 状态 + 转写内容可读（Summary(-1) 或 FileBody 双模式）
	if _, err := loadTranscriptTextRaw(ctx, eid, srcFileID); err != nil {
		return false, nil // 状态 completed 但内容缺失，视为不可复用
	}
	return true, nil
}

// ReuseSourceHasMinutes 源文件是否已有 completed 纪要（且内容可读）。
func ReuseSourceHasMinutes(ctx context.Context, eid, srcFileID int64) (bool, error) {
	file, err := model.GetFileByID(eid, srcFileID)
	if err != nil {
		return false, err
	}
	if fileMeetingMinutesStatus(file) != "completed" {
		return false, nil
	}
	// 新布局纪要存 Summary(0)、转写原文存 Summary(-1)，缺任一则不可复用
	if _, err := model.GetSummaryByTemplateID(srcFileID, 0); err != nil {
		return false, nil
	}
	if _, err := model.GetSummaryByTemplateID(srcFileID, -1); err != nil {
		return false, nil
	}
	return true, nil
}

// ReuseTranscriptForFile 将源文件转写拷贝到目标，置转写状态 completed，继承 parse_type。
// 新布局：目标 FileBody=转写 Markdown、目标 Summary(-1)=转写原文（原始 JSON）。
func ReuseTranscriptForFile(ctx context.Context, eid, srcFileID, dstFileID, userID int64) error {
	transcriptRaw, err := loadTranscriptTextRaw(ctx, eid, srcFileID) // 双模式：Summary(-1) → FileBody
	if err != nil {
		return fmt.Errorf("读源转写失败: %w", err)
	}
	srcFile, err := model.GetFileByID(eid, srcFileID)
	if err != nil {
		return err
	}
	dstFile, err := model.GetFileByID(eid, dstFileID)
	if err != nil {
		return err
	}
	title := strings.TrimSpace(dstFile.GetAccurateFileName())
	if title == "" {
		title = strings.TrimSpace(srcFile.GetAccurateFileName())
	}
	md, err := RenderTranscriptMarkdown(transcriptRaw, title)
	if err != nil {
		return fmt.Errorf("渲染转写 Markdown 失败: %w", err)
	}
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("eid = ? AND file_id = ?", eid, dstFileID).Delete(&model.FileBody{}).Error; err != nil {
			return err
		}
		fb := &model.FileBody{Eid: eid, FileID: dstFileID, LibraryID: dstFile.LibraryID, Content: md, UserID: userID}
		if err := fb.ProcessContentStorage(); err != nil {
			return err
		}
		if err := tx.Create(fb).Error; err != nil {
			return err
		}
		// 转写原文（原始 JSON）写入 Summary(-1)
		if err := tx.Where("file_id = ? AND template_id = -1", dstFileID).Delete(&model.RecordingFileSummary{}).Error; err != nil {
			return err
		}
		ts := &model.RecordingFileSummary{
			FileID:           dstFileID,
			TemplateID:       -1,
			TemplateName:     "转写原文",
			InferenceModelID: 0,
			SummaryContent:   model.LongText(transcriptRaw),
		}
		return tx.Create(ts).Error
	}); err != nil {
		return fmt.Errorf("拷贝转写 FileBody 失败: %w", err)
	}
	if err := model.SetFileTranscriptionStatus(dstFileID, "completed"); err != nil {
		return err
	}
	// parse_type 继承源（前端据此区分转写来源）
	if srcFile.ParseType != "" && srcFile.ParseType != dstFile.ParseType {
		if err := model.DB.Model(&model.File{}).Where("id = ? AND eid = ?", dstFileID, eid).
			Update("parse_type", srcFile.ParseType).Error; err != nil {
			return fmt.Errorf("继承 parse_type 失败: %w", err)
		}
	}
	return nil
}

// ReuseMinutesForFile 将源文件纪要拷贝到目标（新布局）：
//   - 目标 FileBody = 转写 Markdown（源 FileBody 已是 Markdown 时直接拷贝，否则用源转写渲染）
//   - 目标 Summary(template_id=-1) = 源转写原文
//   - 目标 Summary(template_id=0) = 源纪要
//   - template_id>0 自定义总结不拷贝（用户决策：不跨文件复制自定义总结）
//
// 置纪要状态 completed。三种内容必须一起拷，缺任一则下游读取缺数据。
func ReuseMinutesForFile(ctx context.Context, eid, srcFileID, dstFileID, userID int64) error {
	srcMinutes, err := model.GetSummaryByTemplateID(srcFileID, 0) // 新布局：纪要存 Summary(0)
	if err != nil {
		return fmt.Errorf("读源纪要 Summary(0) 失败: %w", err)
	}
	srcTranscript, err := model.GetSummaryByTemplateID(srcFileID, -1) // 新布局：转写原文存 Summary(-1)
	if err != nil {
		return fmt.Errorf("读源转写 Summary(-1) 失败: %w", err)
	}
	dstFile, err := model.GetFileByID(eid, dstFileID)
	if err != nil {
		return err
	}
	// 目标 FileBody = 转写 Markdown；源 FileBody 不是 Markdown（历史布局）时用源转写原文渲染
	fileBodyMD := ""
	if srcBody, berr := model.GetLastFileBodyByFileID(eid, srcFileID); berr == nil && srcBody != nil {
		if content, gerr := srcBody.GetContent(); gerr == nil && classifyRecordingContent(content) == recordingContentTranscriptMD {
			fileBodyMD = content
		}
	}
	if fileBodyMD == "" {
		title := strings.TrimSpace(dstFile.GetAccurateFileName())
		md, mdErr := RenderTranscriptMarkdown(string(srcTranscript.SummaryContent), title)
		if mdErr != nil {
			return fmt.Errorf("渲染转写 Markdown 失败: %w", mdErr)
		}
		fileBodyMD = md
	}
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		// 目标 FileBody = 转写 Markdown
		if err := tx.Where("eid = ? AND file_id = ?", eid, dstFileID).Delete(&model.FileBody{}).Error; err != nil {
			return err
		}
		fb := &model.FileBody{Eid: eid, FileID: dstFileID, LibraryID: dstFile.LibraryID, Content: fileBodyMD, UserID: userID}
		if err := fb.ProcessContentStorage(); err != nil {
			return err
		}
		if err := tx.Create(fb).Error; err != nil {
			return err
		}
		// 目标 Summary(-1) = 源转写原文
		if err := tx.Where("file_id = ? AND template_id = -1", dstFileID).Delete(&model.RecordingFileSummary{}).Error; err != nil {
			return err
		}
		ts := &model.RecordingFileSummary{
			FileID:           dstFileID,
			TemplateID:       -1,
			TemplateName:     "转写原文",
			InferenceModelID: 0,
			SummaryContent:   srcTranscript.SummaryContent,
		}
		if err := tx.Create(ts).Error; err != nil {
			return err
		}
		// 目标 Summary(0) = 源纪要
		if err := tx.Where("file_id = ? AND template_id = 0", dstFileID).Delete(&model.RecordingFileSummary{}).Error; err != nil {
			return err
		}
		ms := &model.RecordingFileSummary{
			FileID:           dstFileID,
			TemplateID:       0,
			TemplateName:     "纪要",
			InferenceModelID: srcMinutes.InferenceModelID,
			SummaryContent:   srcMinutes.SummaryContent,
			Status:           "completed",
		}
		return tx.Create(ms).Error
	}); err != nil {
		return fmt.Errorf("拷贝纪要失败: %w", err)
	}
	return model.SetMeetingMinutesStatus(dstFileID, "completed", "", "")
}

// reuseTranscriptForFile 是 v2steps.ReuseTranscriptFn 的注册实现：
// 查找同内容源文件（同 hash 或同 upload_file_id）中第一个转写 completed 的，拷贝到目标并返回源 parse_type。
func reuseTranscriptForFile(ctx context.Context, eid, dstFileID, userID int64, hash string, uploadFileID int64) (bool, string, error) {
	cands, err := findReuseSourceCandidates(ctx, eid, hash, uploadFileID, dstFileID)
	if err != nil {
		return false, "", err
	}
	for _, cand := range cands {
		ok, err := ReuseSourceHasTranscript(ctx, eid, cand.ID)
		if err != nil {
			return false, "", err
		}
		if !ok {
			continue // pending/无转写：跳过，找下一个候选
		}
		if err := ReuseTranscriptForFile(ctx, eid, cand.ID, dstFileID, userID); err != nil {
			return false, "", err
		}
		return true, cand.ParseType, nil
	}
	return false, "", nil
}
