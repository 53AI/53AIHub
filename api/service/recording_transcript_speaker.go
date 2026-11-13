package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

var (
	ErrRecordingSpeakerRequired = errors.New("说话人不能为空")
	ErrRecordingContactNotFound = errors.New("人员不存在或已删除")
	ErrRecordingTranscriptEmpty = errors.New("转写内容为空")
)

// BindSpeakerBaselineInput 关联时顺带记录基准片段的区间；该对象一旦出现，起止时间必须显式给出。
// 用指针是为了区分「没传」与「显式传 0」：从录音开头算起时 start_ms 就是 0，不能当作缺省。
type BindSpeakerBaselineInput struct {
	StartMs *int64 `json:"start_ms"`
	EndMs   *int64 `json:"end_ms"`
}

type BindTranscriptSpeakerInput struct {
	Eid             int64
	FileID          int64
	UserID          int64
	SelectedSpeaker string
	ContactHashID   string
	// Segments 为空表示按说话人全文替换（兼容旧前端）；非空表示只关联选中片段。
	Segments []SpeakerSegmentRef
	// Baseline 非空表示同时把选中片段记录为该人员的基准片段（点「确定」才真正切片落库）。
	Baseline *BindSpeakerBaselineInput
}

type BindTranscriptSpeakerResult struct {
	FileID          int64  `json:"file_id"`
	SelectedSpeaker string `json:"selected_speaker"`
	ContactID       string `json:"contact_id"`
	ContactName     string `json:"contact_name"`
	ReplacedCount   int    `json:"replaced_count"`
	// BoundSegments 本次关联的段落（1 基段号），全文替换时为空。
	BoundSegments []int `json:"bound_segments,omitempty"`
	// 基准切片由后台完成，响应不返回基准信息，前端通过人员基准列表获取成品
	Markdown string `json:"markdown"`
}

// transcriptLineWithTimeRE 匹配带时间戳的发言行：
// [HH:MM:SS] 说话人(可能带注释): 台词
// 说话人首字符不允许是数字，避免把 "[00:00:02] 12:30 开始" 中的 "12" 误当说话人
var transcriptLineWithTimeRE = regexp.MustCompile(`^\[(\d{1,2}:\d{2}:\d{2})\]\s*(?:(.+?<!--contact:.*?-->)|([^#\d:：\s][^:：]*))\s*[:：]\s*(.*)$`)

// transcriptLineNoTimeRE 匹配无时间戳的发言行：
// 说话人(可能带注释): 台词
var transcriptLineNoTimeRE = regexp.MustCompile(`^(?:(.+?<!--contact:.*?-->)|([^#\d:：\s][^:：]*))\s*[:：]\s*(.*)$`)

// StripTranscriptContactComments 剥除转写文本中的全部人员隐藏注释，返回纯净文本。
// 供导出（Export）、下游实体抽取清洗等场景使用，确保对外文本干净无技术注释。
func StripTranscriptContactComments(text string) string {
	return common.StripInternalContactComments(text)
}

// buildContactComment 构造人员隐藏注释字符串。
func buildContactComment(contactID string) string {
	contactID = strings.TrimSpace(contactID)
	if contactID == "" {
		return ""
	}
	return fmt.Sprintf(`<!--contact:{"id":%q}-->`, contactID)
}

// speakerAvatarPrefixRE 匹配说话人名称前的头像 Markdown（读接口动态注入的 ![avatar](URL)）
var speakerAvatarPrefixRE = regexp.MustCompile(`^!\[[^\]]*\]\([^)]*\)\s*`)

// cleanSpeakerName 剥除说话人名称中的隐藏注释与头像前缀，并去除首尾空格。
func cleanSpeakerName(rawSpeaker string) string {
	return strings.TrimSpace(speakerAvatarPrefixRE.ReplaceAllString(StripTranscriptContactComments(rawSpeaker), ""))
}

// ReplaceTranscriptSpeakerMarkdown 行级安全替换 Markdown 转写中的说话人标签，并注入人员隐藏注释。
// 仅替换发言人前缀标签，绝对不修改发言正文台词，杜绝误伤。
// targetLines 为待关联的 0 基行号集合，nil 表示该说话人的全部行（全文替换）。
// 返回替换后的 Markdown 与替换的发言句数。
func ReplaceTranscriptSpeakerMarkdown(md, selectedSpeaker, newName, contactID string, targetLines map[int]struct{}) (string, int) {
	targetSpeaker := strings.TrimSpace(selectedSpeaker)
	replacementName := strings.TrimSpace(newName)
	if md == "" || targetSpeaker == "" || replacementName == "" {
		return md, 0
	}

	contactComment := buildContactComment(contactID)
	newSpeakerPrefix := replacementName + contactComment

	lines := strings.Split(md, "\n")
	replacedCount := 0

	for i, rawLine := range lines {
		line := rawLine
		trimmedLine := strings.TrimSpace(line)
		if trimmedLine == "" || strings.HasPrefix(trimmedLine, "#") {
			continue
		}
		if targetLines != nil {
			if _, ok := targetLines[i]; !ok {
				continue
			}
		}

		// 1. 尝试匹配带时间戳行：[HH:MM:SS] 说话人: 内容
		if m := transcriptLineWithTimeRE.FindStringSubmatch(line); m != nil {
			ts := m[1]
			speakerRaw := m[2]
			if speakerRaw == "" {
				speakerRaw = m[3]
			}
			speakerRaw = strings.TrimSpace(speakerRaw)
			text := m[4]

			// URL 防护
			if strings.HasPrefix(text, "//") && isTranscriptProtocolName(speakerRaw) {
				continue
			}

			if cleanSpeakerName(speakerRaw) == targetSpeaker {
				lines[i] = fmt.Sprintf("[%s] %s: %s", ts, newSpeakerPrefix, text)
				replacedCount++
			}
			continue
		}

		// 2. 尝试匹配无时间戳行：说话人: 内容
		if m := transcriptLineNoTimeRE.FindStringSubmatch(line); m != nil {
			speakerRaw := m[1]
			if speakerRaw == "" {
				speakerRaw = m[2]
			}
			speakerRaw = strings.TrimSpace(speakerRaw)
			text := m[3]

			// URL 防护
			if strings.HasPrefix(text, "//") && isTranscriptProtocolName(speakerRaw) {
				continue
			}

			if cleanSpeakerName(speakerRaw) == targetSpeaker {
				lines[i] = fmt.Sprintf("%s: %s", newSpeakerPrefix, text)
				replacedCount++
			}
		}
	}

	return strings.Join(lines, "\n"), replacedCount
}

// matchesTranscriptSegment 判断某句原文是否命中片段选择（时间戳 + 正文完全一致）。
// 结构化 JSON 没有「段落」概念，只能按时间戳+文本定位，避免 Markdown 段号与句序号错位。
func matchesTranscriptSegment(targets []TranscriptSegment, timeStr, textStr string) bool {
	if len(targets) == 0 {
		return true
	}
	timeStr = strings.TrimSpace(timeStr)
	textStr = strings.TrimSpace(textStr)
	for _, seg := range targets {
		if seg.Time == timeStr && seg.Text == textStr {
			return true
		}
	}
	return false
}

// ReplaceTranscriptSpeakerJSON 结构化更新转写原始 JSON 中的说话人与 contact 属性。
// 兼容 DashScope 对象 JSON、SonicNote 数组 JSON，以及非 JSON 纯文本降级。
// targets 非空时只更新命中的句子（片段级关联）；为空表示该说话人全部句子（全文替换）。
func ReplaceTranscriptSpeakerJSON(rawJSON, selectedSpeaker, newName, contactID string, targets []TranscriptSegment) (string, int, error) {
	targetSpeaker := strings.TrimSpace(selectedSpeaker)
	replacementName := strings.TrimSpace(newName)
	contactID = strings.TrimSpace(contactID)
	trimmed := strings.TrimSpace(rawJSON)
	if trimmed == "" || targetSpeaker == "" || replacementName == "" {
		return rawJSON, 0, nil
	}

	// 1. SonicNote 数组 JSON
	if strings.HasPrefix(trimmed, "[") {
		var arr []map[string]interface{}
		if err := json.Unmarshal([]byte(trimmed), &arr); err == nil {
			replacedCount := 0
			for _, item := range arr {
				spokesperson, _ := item["spokesperson"].(string)
				speaker, _ := item["speaker"].(string)

				matched := false
				if cleanSpeakerName(spokesperson) == targetSpeaker {
					matched = true
				} else if cleanSpeakerName(speaker) == targetSpeaker {
					matched = true
				} else if m := sonicSpeakerPattern.FindStringSubmatch(strings.TrimSpace(spokesperson)); m != nil {
					if n, err := strconv.Atoi(m[1]); err == nil && n >= 1 {
						if speakerLabelByIndex(n-1) == targetSpeaker {
							matched = true
						}
					}
				}

				if matched {
					timeVal, _ := item["time"].(string)
					textVal, _ := item["text"].(string)
					matched = matchesTranscriptSegment(targets, timeVal, textVal)
				}

				if matched {
					item["spokesperson"] = replacementName
					if contactID != "" {
						item["contact"] = map[string]interface{}{"id": contactID}
					} else {
						delete(item, "contact")
					}
					replacedCount++
				}
			}

			outBytes, err := json.Marshal(arr)
			if err != nil {
				return "", 0, fmt.Errorf("序列化 SonicNote JSON 失败: %w", err)
			}
			return string(outBytes), replacedCount, nil
		}
	}

	// 2. DashScope 对象 JSON
	if strings.HasPrefix(trimmed, "{") {
		var obj map[string]interface{}
		if err := json.Unmarshal([]byte(trimmed), &obj); err == nil {
			if transcripts, ok := obj["transcripts"].([]interface{}); ok {
				replacedCount := 0
				for _, tItem := range transcripts {
					tBlock, ok := tItem.(map[string]interface{})
					if !ok {
						continue
					}
					sentences, ok := tBlock["sentences"].([]interface{})
					if !ok {
						continue
					}
					for _, sItem := range sentences {
						sMap, ok := sItem.(map[string]interface{})
						if !ok {
							continue
						}

						speakerName, _ := sMap["speaker_name"].(string)
						matched := false
						if cleanSpeakerName(speakerName) == targetSpeaker {
							matched = true
						} else {
							speakerIDVal, hasSpeakerID := sMap["speaker_id"]
							if hasSpeakerID {
								speakerID := -1
								switch v := speakerIDVal.(type) {
								case float64:
									speakerID = int(v)
								case int:
									speakerID = v
								case int64:
									speakerID = int(v)
								case string:
									if n, err := strconv.Atoi(v); err == nil {
										speakerID = n
									}
								}
								if speakerID >= 0 && speakerLabelByIndex(speakerID) == targetSpeaker {
									matched = true
								}
							}
						}

						if matched {
							beginMs := int64(0)
							if v, ok := sMap["begin_time"].(float64); ok {
								beginMs = int64(v)
							}
							textVal, _ := sMap["text"].(string)
							matched = matchesTranscriptSegment(targets, formatTranscriptTime(beginMs), textVal)
						}

						if matched {
							sMap["speaker_name"] = replacementName
							if contactID != "" {
								sMap["contact"] = map[string]interface{}{"id": contactID}
							} else {
								delete(sMap, "contact")
							}
							replacedCount++
						}
					}
				}

				outBytes, err := json.Marshal(obj)
				if err != nil {
					return "", 0, fmt.Errorf("序列化 DashScope JSON 失败: %w", err)
				}
				return string(outBytes), replacedCount, nil
			}
		}
	}

	// 3. 非 JSON 降级：走 Markdown 替换
	newMD, replacedCount := ReplaceTranscriptSpeakerMarkdown(rawJSON, targetSpeaker, replacementName, contactID, nil)
	return newMD, replacedCount, nil
}

// StripTranscriptContactJSON 移除转写 JSON 节点中的 contact 隐藏元数据属性，保留替换后的展示姓名。
// 供跨账号复用转写等场景防腐使用，杜绝私有人员 ID 越权污染。
func StripTranscriptContactJSON(rawJSON string) string {
	trimmed := strings.TrimSpace(rawJSON)
	if trimmed == "" || !strings.Contains(trimmed, `"contact"`) {
		return rawJSON
	}

	if strings.HasPrefix(trimmed, "[") {
		var arr []map[string]interface{}
		if err := json.Unmarshal([]byte(trimmed), &arr); err == nil {
			for _, item := range arr {
				delete(item, "contact")
			}
			if outBytes, err := json.Marshal(arr); err == nil {
				return string(outBytes)
			}
		}
	}

	if strings.HasPrefix(trimmed, "{") {
		var obj map[string]interface{}
		if err := json.Unmarshal([]byte(trimmed), &obj); err == nil {
			if transcripts, ok := obj["transcripts"].([]interface{}); ok {
				for _, tItem := range transcripts {
					if tBlock, ok := tItem.(map[string]interface{}); ok {
						if sentences, ok := tBlock["sentences"].([]interface{}); ok {
							for _, sItem := range sentences {
								if sMap, ok := sItem.(map[string]interface{}); ok {
									delete(sMap, "contact")
								}
							}
						}
					}
				}
				if outBytes, err := json.Marshal(obj); err == nil {
					return string(outBytes)
				}
			}
		}
	}

	return StripTranscriptContactComments(rawJSON)
}

// BindTranscriptSpeakerToContact 为指定录音文件的说话人绑定人员，全文替换转写文本并原子更新 FileBody 与 Summary(-1)。
func BindTranscriptSpeakerToContact(ctx context.Context, in BindTranscriptSpeakerInput) (*BindTranscriptSpeakerResult, error) {
	targetSpeaker := strings.TrimSpace(in.SelectedSpeaker)
	if targetSpeaker == "" && len(in.Segments) == 0 {
		return nil, ErrRecordingSpeakerRequired
	}
	contactID, err := hashids.TryParseID(in.ContactHashID)
	if err != nil || contactID <= 0 {
		return nil, ErrRecordingContactNotFound
	}

	// 1. 文件与权限校验
	file, err := GetViewableRecordingFile(ctx, in.Eid, in.UserID, in.FileID)
	if err != nil || file == nil {
		return nil, err
	}

	// 2. 人员校验（企业级匹配有效且未融合的 person 实体）
	var contact model.RecordingMemoryEntity
	if err := model.DB.WithContext(ctx).
		Where("id = ? AND eid = ? AND is_deleted = ? AND merged_into_id = 0 AND entity_type = 'person'", contactID, in.Eid, false).
		First(&contact).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRecordingContactNotFound
		}
		return nil, err
	}

	// 3. 读取当前转写文本（优先读 FileBody，若为空则从 Summary(-1) 动态渲染自愈）
	var content string
	fileBody, err := model.GetLastFileBodyByFileID(in.Eid, in.FileID)
	if err == nil && fileBody != nil {
		content, _ = fileBody.GetContent()
	}

	summary, serr := model.GetSummaryByTemplateID(in.FileID, -1)
	if strings.TrimSpace(content) == "" {
		if serr == nil && summary != nil && strings.TrimSpace(string(summary.SummaryContent)) != "" {
			title := strings.TrimSpace(file.GetAccurateFileName())
			rendered, rerr := RenderTranscriptMarkdown(string(summary.SummaryContent), title)
			if rerr == nil && strings.TrimSpace(rendered) != "" {
				content = rendered
			}
		}
	}

	if strings.TrimSpace(content) == "" {
		return nil, ErrRecordingTranscriptEmpty
	}

	// 4. 解析段落并确定作用域：选中片段 → 只关联这几段；未选 → 沿用按说话人全文替换
	segments := ParseTranscriptSegments(content)
	var targetSegments []TranscriptSegment
	var targetLines map[int]struct{}
	var boundSegments []int
	if len(in.Segments) > 0 {
		targetSegments, err = ResolveSpeakerSegments(segments, in.Segments)
		if err != nil {
			return nil, err
		}
		targetLines = make(map[int]struct{}, len(targetSegments))
		for _, seg := range targetSegments {
			targetLines[seg.Line] = struct{}{}
			boundSegments = append(boundSegments, seg.Index)
		}
		// 选中片段自带说话人，以服务端解析结果为准，避免前端标签过期导致替换为 0 段
		targetSpeaker = targetSegments[0].Speaker
	}
	if targetSpeaker == "" {
		return nil, ErrRecordingSpeakerRequired
	}

	// 5. 基准片段（可选）：区间由调用方显式给出，可落在录音任意位置（与选中哪些片段无关）；
	//    只落一条待切片基准，下载与切片交给后台，避免大文件把"确定"请求拖到超时（老 ffmpeg 只能整段下载）
	var pendingBaseline *model.RecordingSpeakerBaseline
	if in.Baseline != nil {
		if in.Baseline.StartMs == nil || in.Baseline.EndMs == nil {
			return nil, ErrSpeakerBaselineRangeInvalid
		}
		startMs, endMs := *in.Baseline.StartMs, *in.Baseline.EndMs
		if rerr := ValidateSpeakerBaselineRange(startMs, endMs, file.DurationMs); rerr != nil {
			return nil, rerr
		}
		uploadFileID, audioKey := resolveRecordingAudioKey(file)
		if audioKey == "" {
			return nil, ErrSpeakerBaselineAudioMissing
		}
		pendingBaseline = &model.RecordingSpeakerBaseline{
			Eid:            in.Eid,
			UserID:         in.UserID,
			FileID:         in.FileID,
			UploadFileID:   uploadFileID,
			ContactID:      contactID,
			SpeakerLabel:   targetSpeaker,
			StartMs:        startMs,
			EndMs:          endMs,
			DurationMs:     endMs - startMs,
			TranscriptText: model.LongText(transcriptTextInRange(segments, startMs, endMs, file.DurationMs)),
		}
	}

	// 6. 执行 Markdown / 原始 JSON 替换
	newMD, replacedCount := ReplaceTranscriptSpeakerMarkdown(content, targetSpeaker, contact.CanonicalName, in.ContactHashID, targetLines)

	var newJSON string
	if serr == nil && summary != nil && strings.TrimSpace(string(summary.SummaryContent)) != "" {
		updatedJSON, _, jerr := ReplaceTranscriptSpeakerJSON(string(summary.SummaryContent), targetSpeaker, contact.CanonicalName, in.ContactHashID, targetSegments)
		if jerr == nil {
			newJSON = updatedJSON
		} else {
			newJSON = string(summary.SummaryContent)
		}
	} else {
		newJSON = newMD
	}

	// 7. 事务更新双源；待切片基准与转写同事务落地
	baselineCreated := false
	if err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 同一录音的绑定串行化：并发重复点确定时只留一条基准
		if err := lockRecordingFileForBind(tx, in.Eid, in.FileID); err != nil {
			return err
		}
		if pendingBaseline != nil {
			existing, ferr := model.FindReusableSpeakerBaselineInTx(tx, in.Eid, in.FileID, contactID, pendingBaseline.StartMs, pendingBaseline.EndMs)
			if ferr != nil {
				return ferr
			}
			if existing != nil {
				pendingBaseline = existing
				// 命中上次失败/待重试的行：重置为待切片，用户重绑相当于人工清空尝试次数
				if key := strings.TrimSpace(existing.StorageKey); strings.HasPrefix(key, model.SpeakerBaselineRetryPrefix) ||
					strings.HasPrefix(key, model.SpeakerBaselineFailedPrefix) {
					if uerr := tx.Model(&model.RecordingSpeakerBaseline{}).
						Where("id = ? AND eid = ?", existing.ID, in.Eid).
						UpdateColumn("storage_key", "").Error; uerr != nil {
						return uerr
					}
					pendingBaseline.StorageKey = ""
					baselineCreated = true
					logger.Infof(ctx, "【基准片段】待切片基准%d：用户重新绑定，重置为待切片（原状态%s）", existing.ID, key)
				}
			} else if cerr := tx.Create(pendingBaseline).Error; cerr != nil {
				return cerr
			} else {
				baselineCreated = true
			}
		}
		if fileBody == nil {
			fileBody = &model.FileBody{
				Eid:       in.Eid,
				FileID:    in.FileID,
				LibraryID: file.LibraryID,
				UserID:    in.UserID,
				Content:   newMD,
			}
			if err := fileBody.ProcessContentStorage(); err != nil {
				return err
			}
			if err := tx.Create(fileBody).Error; err != nil {
				return err
			}
		} else {
			fileBody.Content = newMD
			fileBody.ContentPath = ""
			if err := fileBody.ProcessContentStorage(); err != nil {
				return err
			}
			if err := tx.Save(fileBody).Error; err != nil {
				return err
			}
		}

		if serr == nil && summary != nil {
			summary.SummaryContent = model.LongText(newJSON)
			if err := tx.Save(summary).Error; err != nil {
				return err
			}
		} else {
			ts := &model.RecordingFileSummary{
				FileID:           in.FileID,
				TemplateID:       -1,
				TemplateName:     "转写原文",
				InferenceModelID: 0,
				SummaryContent:   model.LongText(newJSON),
			}
			if err := tx.Create(ts).Error; err != nil {
				return err
			}
		}

		return nil
	}); err != nil {
		return nil, fmt.Errorf("保存转写失败: %w", err)
	}

	if baselineCreated {
		NotifySpeakerBaselineClipWorker()
		logger.Infof(ctx, "【基准片段】用户%d（企业%d）为人员%d记录基准：已排队（录音%d，%d~%d 毫秒），后台切片",
			in.UserID, in.Eid, contactID, in.FileID, pendingBaseline.StartMs, pendingBaseline.EndMs)
	}

	// 同步沉淀发言人快照（姓名/头像/人员ID），供录音列表与详情免扫描转写直接返回
	if err := SyncFileSpeakerSnapshots(ctx, in.Eid, in.FileID, newMD); err != nil {
		logger.Warnf(ctx, "【人员绑定】保存发言人快照失败，列表参会人员将延后补齐: fileID=%d err=%v", in.FileID, err)
	}

	// 接口直接返回带最新人员信息（包含头像在名称前）的转写响应文本
	respMD := newMD
	if enriched, err := EnrichTranscriptWithLatestContacts(ctx, in.Eid, newMD, false); err == nil && enriched != "" {
		respMD = enriched
	}

	return &BindTranscriptSpeakerResult{
		FileID:          in.FileID,
		SelectedSpeaker: targetSpeaker,
		ContactID:       in.ContactHashID,
		ContactName:     contact.CanonicalName,
		ReplacedCount:   replacedCount,
		BoundSegments:   boundSegments,
		Markdown:        respMD,
	}, nil
}

// contactIDExtractPattern 提取转写文本中的人员 ID 隐藏注释
var contactIDExtractPattern = regexp.MustCompile(`<!--contact:\{"id":\s*"([^"]+)"\s*\}-->`)

type enrichedContactInfo struct {
	Name   string
	Avatar string
}

// EnrichTranscriptWithLatestContacts 在接口响应前，根据是否关联人员，动态拉取人员最新姓名和头像（头像置于名称前）。
// 解决：人员改名/更新头像后转写文本实时联动，且底层存储无需写放大刷库；
// stripComments 为 false 时保留隐藏注释（获取转写详情接口）；
// stripComments 为 true 时剥离隐藏注释（转写导出接口）。
func EnrichTranscriptWithLatestContacts(ctx context.Context, eid int64, md string, stripComments bool) (string, error) {
	if strings.TrimSpace(md) == "" {
		return md, nil
	}

	// 1. 扫描文本中出现的所有 contact_id
	matches := contactIDExtractPattern.FindAllStringSubmatch(md, -1)
	if len(matches) == 0 {
		if stripComments {
			return StripTranscriptContactComments(md), nil
		}
		return md, nil
	}

	contactHashIDSet := make(map[string]struct{})
	var numericIDs []int64
	hashToNumeric := make(map[string]int64)

	for _, m := range matches {
		if len(m) > 1 {
			cHash := strings.TrimSpace(m[1])
			if cHash != "" {
				if _, seen := contactHashIDSet[cHash]; !seen {
					contactHashIDSet[cHash] = struct{}{}
					if numID, err := hashids.TryParseID(cHash); err == nil && numID > 0 {
						numericIDs = append(numericIDs, numID)
						hashToNumeric[cHash] = numID
					}
				}
			}
		}
	}

	// 2. 批量查库获取最新人员档案
	contactMap := make(map[int64]enrichedContactInfo)
	if len(numericIDs) > 0 {
		var entities []model.RecordingMemoryEntity
		if err := model.DB.WithContext(ctx).
			Where("eid = ? AND id IN ? AND is_deleted = false AND merged_into_id = 0 AND entity_type = 'person'", eid, numericIDs).
			Find(&entities).Error; err == nil {
			for _, e := range entities {
				avatar := ""
				if strings.TrimSpace(string(e.AttributesJSON)) != "" {
					var attrs map[string]interface{}
					if jerr := json.Unmarshal([]byte(e.AttributesJSON), &attrs); jerr == nil {
						if a, ok := attrs["avatar"].(string); ok {
							avatar = strings.TrimSpace(a)
						}
					}
				}
				contactMap[e.ID] = enrichedContactInfo{
					Name:   strings.TrimSpace(e.CanonicalName),
					Avatar: avatar,
				}
			}
		}
	}

	// 3. 逐行扫描与动态渲染
	lines := strings.Split(md, "\n")
	for i, rawLine := range lines {
		line := rawLine
		trimmedLine := strings.TrimSpace(line)
		if trimmedLine == "" || strings.HasPrefix(trimmedLine, "#") {
			continue
		}

		// 检查该行是否有关联人员注释
		cm := contactIDExtractPattern.FindStringSubmatch(line)
		if len(cm) <= 1 {
			if stripComments {
				lines[i] = StripTranscriptContactComments(line)
			}
			continue
		}
		cHash := strings.TrimSpace(cm[1])
		numID := hashToNumeric[cHash]
		info, found := contactMap[numID]

		// 尝试匹配带时间戳行：[HH:MM:SS] 说话人: 内容
		if m := transcriptLineWithTimeRE.FindStringSubmatch(line); m != nil {
			ts := m[1]
			speakerRaw := m[2]
			if speakerRaw == "" {
				speakerRaw = m[3]
			}
			speakerRaw = strings.TrimSpace(speakerRaw)
			text := m[4]

			speakerName := cleanSpeakerName(speakerRaw)
			avatar := ""
			if found && info.Name != "" {
				speakerName = info.Name
				avatar = info.Avatar
			}

			// 组装新前缀：头像在名称前
			newPrefix := speakerName
			if avatar != "" {
				newPrefix = fmt.Sprintf("![avatar](%s) %s", avatar, speakerName)
			}
			if !stripComments {
				newPrefix = newPrefix + fmt.Sprintf(`<!--contact:{"id":%q}-->`, cHash)
			}

			lines[i] = fmt.Sprintf("[%s] %s: %s", ts, newPrefix, text)
			continue
		}

		// 尝试匹配无时间戳行：说话人: 内容
		if m := transcriptLineNoTimeRE.FindStringSubmatch(line); m != nil {
			speakerRaw := m[1]
			if speakerRaw == "" {
				speakerRaw = m[2]
			}
			speakerRaw = strings.TrimSpace(speakerRaw)
			text := m[3]

			speakerName := cleanSpeakerName(speakerRaw)
			avatar := ""
			if found && info.Name != "" {
				speakerName = info.Name
				avatar = info.Avatar
			}

			newPrefix := speakerName
			if avatar != "" {
				newPrefix = fmt.Sprintf("![avatar](%s) %s", avatar, speakerName)
			}
			if !stripComments {
				newPrefix = newPrefix + fmt.Sprintf(`<!--contact:{"id":%q}-->`, cHash)
			}

			lines[i] = fmt.Sprintf("%s: %s", newPrefix, text)
			continue
		}

		if stripComments {
			lines[i] = StripTranscriptContactComments(line)
		}
	}

	return strings.Join(lines, "\n"), nil
}

// TranscriptSpeakerStats 转写发言人绑定统计信息，供前端判断和展示。
type TranscriptSpeakerStats struct {
	Total       int    `json:"total"`       // 识别到的发言人总数
	Confirmed   int    `json:"confirmed"`   // 已确认/已关联人员人数
	Unconfirmed int    `json:"unconfirmed"` // 待关联人数
	Summary     string `json:"summary"`     // 格式化文案，例如 "识别到4位发言人 2人已确认·2人待关联"
}

// CalculateTranscriptSpeakerStats 统计转写中的发言人数量及人员绑定情况。
func CalculateTranscriptSpeakerStats(md string) TranscriptSpeakerStats {
	if strings.TrimSpace(md) == "" {
		return TranscriptSpeakerStats{}
	}

	speakerBoundMap := make(map[string]bool)
	lines := strings.Split(md, "\n")

	for _, rawLine := range lines {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		isBound := contactIDExtractPattern.MatchString(line)
		speakerName := ""

		if m := transcriptLineWithTimeRE.FindStringSubmatch(line); m != nil {
			speakerRaw := m[2]
			if speakerRaw == "" {
				speakerRaw = m[3]
			}
			speakerName = cleanSpeakerName(speakerRaw)
		} else if m := transcriptLineNoTimeRE.FindStringSubmatch(line); m != nil {
			speakerRaw := m[1]
			if speakerRaw == "" {
				speakerRaw = m[2]
			}
			speakerName = cleanSpeakerName(speakerRaw)
		}

		if speakerName != "" {
			if alreadyBound, exists := speakerBoundMap[speakerName]; exists {
				speakerBoundMap[speakerName] = alreadyBound || isBound
			} else {
				speakerBoundMap[speakerName] = isBound
			}
		}
	}

	total := len(speakerBoundMap)
	if total == 0 {
		return TranscriptSpeakerStats{}
	}

	confirmed := 0
	for _, bound := range speakerBoundMap {
		if bound {
			confirmed++
		}
	}
	unconfirmed := total - confirmed

	summary := ""
	switch {
	case confirmed > 0 && unconfirmed > 0:
		summary = fmt.Sprintf("识别到%d位发言人 %d人已确认·%d人待关联", total, confirmed, unconfirmed)
	case confirmed > 0 && unconfirmed == 0:
		summary = fmt.Sprintf("识别到%d位发言人 全部已确认", total)
	case confirmed == 0 && unconfirmed > 0:
		summary = fmt.Sprintf("识别到%d位发言人 %d人待关联", total, unconfirmed)
	}

	return TranscriptSpeakerStats{
		Total:       total,
		Confirmed:   confirmed,
		Unconfirmed: unconfirmed,
		Summary:     summary,
	}
}
