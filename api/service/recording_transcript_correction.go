package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

// transcriptCorrectionPrompt is product-controlled: never accept tenant-authored prompts.
const transcriptCorrectionPrompt = `你是会议ASR转写校正助手，任务是尽可能准确地恢复说话人的真实表达，而不是尽可能保留ASR原始文字。
结合当前发言、相邻上下文和企业词汇参考，修正同音错字、专有名词、数字误识别、口语重复与标点断句，改善阅读流畅度。
当上下文证据充分时，金额、时间、否定、承诺等重要内容也允许修正；不要为了使内容更合理而推测或编造事实。不确定时保留原文。
保留发言的原意、语气和重要信息，不总结、不补写、不重新推断说话人。
只返回需要修改的句子，输出JSON：{"edits":[{"segment_id":"s0001","corrected_text":"修正后的原句"}]}。
不得返回speaker_id或时间戳，不得新增、删除或跨句合并发言。相邻只读上下文仅供理解，不在修改范围内。`

type transcriptTextEdit struct {
	SegmentID     string `json:"segment_id"`
	CorrectedText string `json:"corrected_text"`
}

type transcriptCorrectionResponse struct {
	Edits []transcriptTextEdit `json:"edits"`
}

type transcriptCorrectionInput struct {
	SegmentID string `json:"segment_id"`
	SpeakerID int    `json:"speaker_id"`
	BeginTime int64  `json:"begin_time"`
	Text      string `json:"text"`
}

// 文本内容由 LLM 依据上下文判断；程序只拒绝空改写，不再用正则否定语义校正。
func safeTranscriptEdit(before, after string) bool {
	return strings.TrimSpace(after) != "" && before != strings.TrimSpace(after)
}

// applyTranscriptTextEdits modifies sentence text only, preserving vendor metadata and timing.
// Unknown, duplicated or unsafe edits are ignored individually.
func applyTranscriptTextEdits(raw string, edits []transcriptTextEdit) (string, int, error) {
	if len(edits) == 0 {
		return raw, 0, nil
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &root); err != nil {
		return raw, 0, err
	}
	var blocks []map[string]json.RawMessage
	if err := json.Unmarshal(root["transcripts"], &blocks); err != nil {
		return raw, 0, err
	}

	candidates := make(map[string]string, len(edits))
	repeated := make(map[string]bool)
	for _, edit := range edits {
		if _, ok := candidates[edit.SegmentID]; ok {
			repeated[edit.SegmentID] = true
		}
		candidates[edit.SegmentID] = edit.CorrectedText
	}

	applied, sentenceIndex := 0, 0
	for blockIndex, block := range blocks {
		var sentences []map[string]json.RawMessage
		if err := json.Unmarshal(block["sentences"], &sentences); err != nil {
			continue
		}
		changed := false
		for sentenceIndexInBlock, sentence := range sentences {
			sentenceIndex++
			id := fmt.Sprintf("s%04d", sentenceIndex)
			candidate, exists := candidates[id]
			if !exists || repeated[id] {
				continue
			}
			var before string
			if err := json.Unmarshal(sentence["text"], &before); err != nil {
				continue
			}
			if !safeTranscriptEdit(before, candidate) {
				continue
			}
			nextText, _ := json.Marshal(strings.TrimSpace(candidate))
			sentence["text"] = nextText
			sentences[sentenceIndexInBlock] = sentence
			applied++
			changed = true
		}
		if !changed {
			continue
		}
		encoded, err := json.Marshal(sentences)
		if err != nil {
			return raw, 0, err
		}
		block["sentences"] = encoded
		if _, ok := block["text"]; ok {
			parts := make([]string, 0, len(sentences))
			for _, sentence := range sentences {
				var text string
				_ = json.Unmarshal(sentence["text"], &text)
				parts = append(parts, text)
			}
			block["text"], _ = json.Marshal(strings.Join(parts, ""))
		}
		blocks[blockIndex] = block
	}
	if applied == 0 {
		return raw, 0, nil
	}
	root["transcripts"], _ = json.Marshal(blocks)
	corrected, err := json.Marshal(root)
	if err != nil {
		return raw, 0, err
	}
	return string(corrected), applied, nil
}

// recordingCorrectionVocabulary reuses configured ASR hotwords and recording-owner person names.
// This is advisory vocabulary, not an instruction to force replacements.
func recordingCorrectionVocabulary(eid, fileID int64, cfg *model.RecordingConfig) []string {
	const limit = 120
	words := make([]string, 0, limit)
	seen := map[string]bool{}
	add := func(name string) {
		name = strings.TrimSpace(name)
		if name == "" || seen[name] || len(words) >= limit {
			return
		}
		seen[name] = true
		words = append(words, name)
	}
	if cfg.VoiceModelID > 0 && cfg.VoiceModelName != "" {
		if ch, err := model.GetChannelByID(cfg.VoiceModelID); err == nil && ch.Eid == eid {
			if custom, err := model.ParseChannelCustomConfig(ch.CustomConfig); err == nil {
				if voiceModels, ok := custom["voice_models"].(map[string]interface{}); ok {
					if voiceModel, ok := voiceModels[cfg.VoiceModelName].(map[string]interface{}); ok {
						if hotwords, ok := voiceModel["hotwords"].([]interface{}); ok {
							for _, word := range hotwords {
								if text, ok := word.(string); ok {
									add(text)
								}
							}
						}
					}
				}
			}
		}
	}
	ownerID := int64(0)
	if file, err := model.GetFileByID(eid, fileID); err == nil {
		ownerID = file.UserID
	}
	if ownerID > 0 {
		if names, err := model.ListActiveRecordingMemoryPersonNames(eid, ownerID, limit); err == nil {
			for _, name := range names {
				add(name)
			}
		}
	}
	return words
}

// CorrectRecordingTranscript operates on Qwen-Audio filetrans JSON and returns a formal
// transcript. Failure always degrades to the original ASR output.
func CorrectRecordingTranscript(ctx context.Context, eid, fileID int64, raw string) (string, error) {
	cfg, err := model.ValidateOrCreateRecordingConfig(eid)
	if err != nil || cfg.TranscriptCorrection == nil || !cfg.TranscriptCorrection.Enabled {
		return raw, nil
	}
	var input dashScopeTranscriptJSON
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		return raw, nil
	}

	var segments []transcriptCorrectionInput
	for _, block := range input.Transcripts {
		for _, sentence := range block.Sentences {
			segments = append(segments, transcriptCorrectionInput{
				SegmentID: fmt.Sprintf("s%04d", len(segments)+1),
				SpeakerID: sentence.SpeakerID,
				BeginTime: sentence.BeginTime,
				Text:      sentence.Text,
			})
		}
	}
	if len(segments) == 0 {
		return raw, nil
	}

	inference := *cfg
	selected := cfg.TranscriptCorrection
	if selected.ModelChannelID > 0 {
		inference.InferenceModelID = selected.ModelChannelID
		inference.InferenceModelName = selected.ModelName
	}
	if inference.InferenceModelID <= 0 || inference.InferenceModelName == "" {
		return raw, fmt.Errorf("没有可用的转写校正模型")
	}
	// Saved config may outlive the channel permission; verify at execution time as well.
	if channel, err := model.GetChannelByID(inference.InferenceModelID); err != nil || channel.Eid != eid || !model.IsModelInChannelModels(inference.InferenceModelName, channel.Models) {
		return raw, fmt.Errorf("转写校正模型不属于当前企业或模型已不可用")
	}
	vocabulary := recordingCorrectionVocabulary(eid, fileID, cfg)

	var allEdits []transcriptTextEdit
	succeeded := 0
	// 3-minute windows, bounded by 55 sentences / 5000 runes. Neighbor
	// segments are context only, never permitted as edits.
	for begin := 0; begin < len(segments); {
		end, charCount := begin, 0
		for end < len(segments) {
			if end > begin && (segments[end].BeginTime-segments[begin].BeginTime > 180000 ||
				end-begin >= 55 || charCount+utf8.RuneCountInString(segments[end].Text) > 5000) {
				break
			}
			charCount += utf8.RuneCountInString(segments[end].Text)
			end++
		}
		contextStart, contextEnd := begin-3, end+3
		if contextStart < 0 {
			contextStart = 0
		}
		if contextEnd > len(segments) {
			contextEnd = len(segments)
		}
		payload, _ := json.Marshal(map[string]interface{}{
			"editable":       segments[begin:end],
			"context_before": segments[contextStart:begin],
			"context_after":  segments[end:contextEnd],
			"vocabulary":     vocabulary,
		})
		req := func() *relaymodel.GeneralOpenAIRequest {
			return &relaymodel.GeneralOpenAIRequest{
				Model: inference.InferenceModelName,
				Messages: []relaymodel.Message{
					{Role: "system", Content: transcriptCorrectionPrompt},
					{Role: "user", Content: string(payload)},
				},
			}
		}
		text, callErr := callLLMWithRetry(ctx, &inference, req)
		if callErr != nil {
			logger.Warnf(ctx, "【转写校正】窗口校正失败，保留原文：fileID=%d 起始句=%d err=%v", fileID, begin, callErr)
		} else {
			var reply transcriptCorrectionResponse
			if parseErr := common.ParseLLMJSONInto(ctx, text, &reply); parseErr != nil {
				logger.Warnf(ctx, "【转写校正】返回格式不正确，保留原文：fileID=%d 起始句=%d err=%v", fileID, begin, parseErr)
			} else {
				allowed := make(map[string]bool, end-begin)
				for _, seg := range segments[begin:end] {
					allowed[seg.SegmentID] = true
				}
				for _, edit := range reply.Edits {
					if allowed[edit.SegmentID] {
						allEdits = append(allEdits, edit)
					}
				}
				succeeded++
			}
		}
		begin = end
	}
	corrected, applied, err := applyTranscriptTextEdits(raw, allEdits)
	if err != nil {
		return raw, err
	}
	if succeeded > 0 {
		var formal map[string]json.RawMessage
		if err := json.Unmarshal([]byte(corrected), &formal); err == nil {
			formal["_transcript_correction_version"], _ = json.Marshal("v1")
			if encoded, err := json.Marshal(formal); err == nil {
				corrected = string(encoded)
			}
		}
	}
	logger.Infof(ctx, "【转写校正】完成：fileID=%d 总句数=%d 成功窗口=%d 采纳修改=%d", fileID, len(segments), succeeded, applied)
	return corrected, nil
}
