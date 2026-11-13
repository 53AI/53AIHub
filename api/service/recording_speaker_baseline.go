package service

import (
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 基准片段约束：太短切不出有效样本，长度不设上限（由音频总时长兜住）
const (
	SpeakerBaselineMinDurationMs int64 = 1000

	speakerBaselineClipFormat = "mp3"
	speakerBaselineClipMime   = "audio/mpeg"

	// 直读地址在某些 ffmpeg 构建上不可用（例如静态构建的 getaddrinfo 缺陷），
	// 失败后短期改用下载整段，避免每次请求都白试一次。
	speakerBaselineDirectReadBackoff = 10 * time.Minute
	// ffmpeg 的 stderr 会带整段构建信息，日志只保留一行摘要。
	speakerBaselineErrorMaxRunes = 200
	// 同一录音常被连续绑定多个片段，缓存源音频，避免每次都整段下载（大文件一次 5 秒级）。
	speakerBaselineSourceCacheTTL  = time.Hour
	speakerBaselineSourceCacheSize = int64(2) << 30
)

// speakerBaselineSourceCacheDir 源音频缓存目录，仅本进程使用，权限收到最紧。
var speakerBaselineSourceCacheDir = filepath.Join(os.TempDir(), "53aihub-speaker-baseline-cache")

var (
	ErrSpeakerBaselineRangeInvalid = errors.New("基准片段区间不合法：须显式给出起止时间，时长不少于 1 秒且不超出音频总时长")
	ErrSpeakerBaselineNotFound     = errors.New("基准片段不存在")
	ErrSpeakerBaselineAudioMissing = errors.New("原音频不可用，无法生成基准片段")
	ErrSpeakerBaselineTimeout      = errors.New("音频切片超时，请稍后重试")
	// ErrSpeakerBaselineStorageUnavailable 对象存储读写失败（下载源音频、上传产物）：多为抖动，值得等等再试。
	ErrSpeakerBaselineStorageUnavailable = errors.New("对象存储暂不可用，稍后重试")
	ErrTranscriptChanged                 = errors.New("转写已变更，请刷新后重选")
)

// 外部依赖注入点：单测不启动 ffmpeg、不落真实对象存储。
var (
	speakerBaselineFFmpegPath               = ResolveFFmpegToolchainPath
	speakerBaselineRunner     commandRunner = osCommandRunner{}
	speakerBaselineSaveFile                 = func(key string, data []byte) error { return storage.StorageInstance.Save(data, key) }
	speakerBaselineDeleteFile               = func(key string) error { return storage.StorageInstance.Delete(key) }
	speakerBaselineLoadFile                 = func(key string) ([]byte, error) { return storage.StorageInstance.Load(key) }
	speakerBaselineSignedURL                = func(key string) (string, bool) {
		store, ok := storage.StorageInstance.(*storage.AliyunOSSStorage)
		if !ok {
			return "", false
		}
		url, err := store.SignedURL(key, time.Hour)
		if err != nil {
			return "", false
		}
		return url, true
	}
	// 直读失败后按文件退避的截止时间：单文件读不了，不该让其它文件改走下载。
	speakerBaselineDirectReadBlockMu    sync.Mutex
	speakerBaselineDirectReadBlockedIds = map[string]time.Time{}
)

// TranscriptSegment 转写中的一个段落（Markdown 每一段 = 一句发言），Index 从 1 开始。
// Time 取自段落行首时间戳；无时间戳段落（纯文本行）Time 为空。
type TranscriptSegment struct {
	Index      int
	Line       int // Markdown 中的 0 基行号
	Time       string
	StartMs    int64
	RawSpeaker string
	Speaker    string // 清洗后的说话人名称（已剥头像与隐藏注释）
	Text       string // 台词正文（已剥头像与隐藏注释）
}

// SpeakerSegmentRef 前端选中的段落（Index 为 1 基段号，Time 用于校验转写未变更）。
type SpeakerSegmentRef struct {
	Index int    `json:"index"`
	Time  string `json:"time"`
}

// ParseTranscriptSegments 把转写 Markdown 解析为有序段落，段号与页面渲染的段落一一对应。
func ParseTranscriptSegments(md string) []TranscriptSegment {
	if strings.TrimSpace(md) == "" {
		return nil
	}
	var segments []TranscriptSegment
	for i, rawLine := range strings.Split(md, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		seg := TranscriptSegment{Line: i}
		switch m := transcriptLineWithTimeRE.FindStringSubmatch(rawLine); {
		case m != nil:
			seg.Time = m[1]
			seg.RawSpeaker = firstNonEmpty(strings.TrimSpace(m[2]), strings.TrimSpace(m[3]))
			seg.Text = strings.TrimSpace(m[4])
		default:
			if m := transcriptLineNoTimeRE.FindStringSubmatch(rawLine); m != nil {
				seg.RawSpeaker = firstNonEmpty(strings.TrimSpace(m[1]), strings.TrimSpace(m[2]))
				seg.Text = strings.TrimSpace(m[3])
			} else {
				seg.Text = line
			}
			// URL 防护：https://... 的 "https:" 不是说话人
			if isTranscriptProtocolName(seg.RawSpeaker) && strings.HasPrefix(seg.Text, "//") {
				seg.RawSpeaker = ""
				seg.Text = line
			}
		}
		seg.Speaker = cleanSpeakerName(seg.RawSpeaker)
		seg.StartMs = parseTranscriptClockMs(seg.Time)
		seg.Index = len(segments) + 1
		segments = append(segments, seg)
	}
	return segments
}

// ResolveSpeakerSegments 校验并解析前端选中的段落；段号越界或时间戳不符即判定转写已变更。
func ResolveSpeakerSegments(segments []TranscriptSegment, refs []SpeakerSegmentRef) ([]TranscriptSegment, error) {
	if len(refs) == 0 {
		return nil, nil
	}
	resolved := make([]TranscriptSegment, 0, len(refs))
	seen := make(map[int]struct{}, len(refs))
	for _, ref := range refs {
		if ref.Index < 1 || ref.Index > len(segments) {
			return nil, ErrTranscriptChanged
		}
		seg := segments[ref.Index-1]
		if expect := strings.TrimSpace(ref.Time); expect != "" && expect != seg.Time {
			return nil, ErrTranscriptChanged
		}
		if _, dup := seen[seg.Index]; dup {
			continue
		}
		seen[seg.Index] = struct{}{}
		resolved = append(resolved, seg)
	}
	return resolved, nil
}

// SpeakerSegmentEndMs 取段落结束时间：后续第一个更晚的段落起始；末段回退音频时长。
func SpeakerSegmentEndMs(segments []TranscriptSegment, seg TranscriptSegment, fileDurationMs int64) int64 {
	for _, next := range segments[seg.Index:] {
		if next.StartMs > seg.StartMs {
			return next.StartMs
		}
	}
	if fileDurationMs > seg.StartMs {
		return fileDurationMs
	}
	return 0
}

// ValidateSpeakerBaselineRange 校验基准片段区间是否合法。
func ValidateSpeakerBaselineRange(startMs, endMs, fileDurationMs int64) error {
	if startMs < 0 || endMs <= startMs {
		return ErrSpeakerBaselineRangeInvalid
	}
	duration := endMs - startMs
	if duration < SpeakerBaselineMinDurationMs {
		return ErrSpeakerBaselineRangeInvalid
	}
	if fileDurationMs > 0 && endMs > fileDurationMs {
		return ErrSpeakerBaselineRangeInvalid
	}
	return nil
}

// transcriptTextInRange 取基准区间覆盖的转写台词，作为"当时那段声音说的是这句话"的快照。
func transcriptTextInRange(segments []TranscriptSegment, startMs, endMs, fileDurationMs int64) string {
	texts := make([]string, 0, 4)
	for _, seg := range segments {
		if SpeakerSegmentEndMs(segments, seg, fileDurationMs) > startMs && seg.StartMs < endMs {
			texts = append(texts, seg.Text)
		}
	}
	return strings.Join(texts, " ")
}

// parseTranscriptClockMs 解析转写时间戳 HH:MM:SS 为毫秒，非法格式返回 0。
func parseTranscriptClockMs(clock string) int64 {
	parts := strings.Split(strings.TrimSpace(clock), ":")
	if len(parts) != 3 {
		return 0
	}
	hours, errH := strconv.Atoi(parts[0])
	minutes, errM := strconv.Atoi(parts[1])
	seconds, errS := strconv.Atoi(parts[2])
	if errH != nil || errM != nil || errS != nil {
		return 0
	}
	return (int64(hours)*3600 + int64(minutes)*60 + int64(seconds)) * 1000
}

// SpeakerBaselineItem 基准片段对外结构；对外 ID 一律 Hashid 编码。
type SpeakerBaselineItem struct {
	BaselineID     string `json:"baseline_id"`
	ContactID      string `json:"contact_id"`
	ContactName    string `json:"contact_name,omitempty"`
	SpeakerLabel   string `json:"speaker_label"`
	StartMs        int64  `json:"start_ms"`
	EndMs          int64  `json:"end_ms"`
	DurationMs     int64  `json:"duration_ms"`
	TranscriptText string `json:"transcript_text"`
	FileID         string `json:"file_id"`
	FileName       string `json:"file_name,omitempty"`
	CreatedTime    int64  `json:"created_time"`
}

func toSpeakerBaselineItem(baseline *model.RecordingSpeakerBaseline, file *model.File, contactName string) SpeakerBaselineItem {
	item := SpeakerBaselineItem{
		BaselineID:     encodeHashID(baseline.ID),
		ContactID:      encodeHashID(baseline.ContactID),
		ContactName:    contactName,
		SpeakerLabel:   baseline.SpeakerLabel,
		StartMs:        baseline.StartMs,
		EndMs:          baseline.EndMs,
		DurationMs:     baseline.DurationMs,
		TranscriptText: strings.TrimSpace(string(baseline.TranscriptText)),
		FileID:         encodeHashID(baseline.FileID),
		CreatedTime:    baseline.CreatedTime,
	}
	if file != nil {
		item.FileName = strings.TrimSpace(file.GetAccurateFileName())
	}
	return item
}

// ListSpeakerBaselines 按人员列基准；按录音库权限过滤不可见的来源录音。
func ListSpeakerBaselines(ctx context.Context, eid, userID, contactID int64, limit, offset int) ([]SpeakerBaselineItem, int64, error) {
	if contactID <= 0 {
		return nil, 0, ErrRecordingContactNotFound
	}
	var contactName string
	var contact model.RecordingMemoryEntity
	if err := model.DB.WithContext(ctx).
		Where("id = ? AND eid = ? AND is_deleted = ? AND entity_type = 'person'", contactID, eid, false).
		First(&contact).Error; err == nil {
		contactName = strings.TrimSpace(contact.CanonicalName)
	}

	// 一人基准数量有限，先全量取回再做权限过滤与分页，避免 N+1 权限查询
	baselines, _, err := model.ListSpeakerBaselinesByContact(ctx, eid, contactID, 0, 0)
	if err != nil {
		return nil, 0, err
	}
	if len(baselines) == 0 {
		return []SpeakerBaselineItem{}, 0, nil
	}

	fileIDs := make([]int64, 0, len(baselines))
	for _, baseline := range baselines {
		fileIDs = append(fileIDs, baseline.FileID)
	}
	files, err := model.GetFilesByIDs(eid, fileIDs)
	if err != nil {
		return nil, 0, err
	}
	fileByID := make(map[int64]*model.File, len(files))
	for i := range files {
		fileByID[files[i].ID] = &files[i]
	}

	visible := make([]SpeakerBaselineItem, 0, len(baselines))
	permissions := make(map[int64]int)
	for i := range baselines {
		file := fileByID[baselines[i].FileID]
		if file == nil {
			continue
		}
		permission, ok := permissions[file.LibraryID]
		if !ok {
			permission, _ = GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, file.LibraryID, userID)
			permissions[file.LibraryID] = permission
		}
		if permission < model.PERMISSION_VIEW_ONLY {
			continue
		}
		visible = append(visible, toSpeakerBaselineItem(&baselines[i], file, contactName))
	}

	total := int64(len(visible))
	return paginateSpeakerBaselines(visible, limit, offset), total, nil
}

func paginateSpeakerBaselines(items []SpeakerBaselineItem, limit, offset int) []SpeakerBaselineItem {
	if offset < 0 {
		offset = 0
	}
	if offset >= len(items) {
		return []SpeakerBaselineItem{}
	}
	items = items[offset:]
	if limit > 0 && limit < len(items) {
		items = items[:limit]
	}
	return items
}

// DeleteSpeakerBaseline 软删基准并清理切片文件。
func DeleteSpeakerBaseline(ctx context.Context, eid, userID, baselineID int64) error {
	baseline, err := model.GetSpeakerBaselineByID(ctx, eid, baselineID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrSpeakerBaselineNotFound
		}
		return err
	}
	if _, err := GetViewableRecordingFile(ctx, eid, userID, baseline.FileID); err != nil {
		return err
	}
	if _, err := model.SoftDeleteSpeakerBaseline(ctx, eid, baselineID); err != nil {
		return err
	}
	if key := strings.TrimSpace(baseline.StorageKey); model.IsSpeakerBaselineFinished(key) {
		if derr := speakerBaselineDeleteFile(key); derr != nil {
			logger.Warnf(ctx, "【基准片段】清理切片文件失败: baselineID=%d err=%v", baselineID, derr)
		}
	}
	return nil
}

// OpenSpeakerBaselineAudio 返回基准切片音频字节与 MIME，供接口流式播放。
func OpenSpeakerBaselineAudio(ctx context.Context, eid, userID, baselineID int64) ([]byte, string, error) {
	baseline, err := model.GetSpeakerBaselineByID(ctx, eid, baselineID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, "", ErrSpeakerBaselineNotFound
		}
		return nil, "", err
	}
	if _, err := GetViewableRecordingFile(ctx, eid, userID, baseline.FileID); err != nil {
		return nil, "", err
	}
	if !model.IsSpeakerBaselineFinished(strings.TrimSpace(baseline.StorageKey)) {
		return nil, "", ErrSpeakerBaselineNotFound
	}
	data, err := speakerBaselineLoadFile(baseline.StorageKey)
	if err != nil || len(data) == 0 {
		return nil, "", fmt.Errorf("%w: %v", ErrSpeakerBaselineAudioMissing, err)
	}
	mime := baseline.MimeType
	if mime == "" {
		mime = speakerBaselineClipMime
	}
	return data, mime, nil
}

// speakerBaselineClip 切片产物
type speakerBaselineClip struct {
	StorageKey string
	MimeType   string
	SizeBytes  int64
}

// cutSpeakerBaselineClip 从原音频截取 [startMs, endMs) 并存入对象存储。
// 优先让 ffmpeg 直读原音频地址（HTTP Range 按需读取），失败再回落为下载整段音频。
func cutSpeakerBaselineClip(ctx context.Context, audioKey, storageKey string, startMs, endMs int64) (*speakerBaselineClip, error) {
	ffmpegPath, err := speakerBaselineFFmpegPath()
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrFFmpegNotAvailable, err)
	}
	encoder, err := encoderForRecordingTargetFormat(speakerBaselineClipFormat)
	if err != nil {
		return nil, err
	}

	started := time.Now()
	data, via, err := sliceSpeakerBaselineClip(ctx, ffmpegPath, encoder, audioKey, startMs, endMs)
	if err != nil {
		return nil, err
	}
	if err := speakerBaselineSaveFile(storageKey, data); err != nil {
		return nil, fmt.Errorf("%w: 保存基准片段失败: %v", ErrSpeakerBaselineStorageUnavailable, err)
	}
	logger.Infof(ctx, "【基准片段】原音频 %s 的 %d~%d 毫秒片段：切片完成（来源：%s，耗时 %d 毫秒，产物 %d 字节）",
		audioKey, startMs, endMs, via, time.Since(started).Milliseconds(), len(data))
	return &speakerBaselineClip{StorageKey: storageKey, MimeType: speakerBaselineClipMime, SizeBytes: int64(len(data))}, nil
}

// sliceSpeakerBaselineClip 先直读远程地址，失败回落为下载整段音频后切片。
func sliceSpeakerBaselineClip(ctx context.Context, ffmpegPath, encoder, audioKey string, startMs, endMs int64) ([]byte, string, error) {
	if !speakerBaselineDirectReadBlocked(audioKey) {
		if rawURL, ok := speakerBaselineSignedURL(strings.TrimSpace(audioKey)); ok {
			data, err := runSpeakerBaselineFFmpeg(ctx, ffmpegPath, encoder, rawURL, startMs, endMs)
			if err == nil {
				return data, "直读原音频地址", nil
			}
			if ctx.Err() != nil {
				return nil, "", fmt.Errorf("%w: %v", ErrSpeakerBaselineTimeout, ctx.Err())
			}
			blockSpeakerBaselineDirectRead(audioKey)
			logger.SysErrorf("【基准片段】原音频 %s 直读失败：接下来 %v 改为下载整段后切片（%s）",
				audioKey, speakerBaselineDirectReadBackoff, sanitizeSpeakerBaselineError(err))
		}
	}

	inputPath, cleanupInput, err := materializeSpeakerBaselineInput(audioKey)
	if err != nil {
		return nil, "", err
	}
	defer cleanupInput()

	data, err := runSpeakerBaselineFFmpeg(ctx, ffmpegPath, encoder, inputPath, startMs, endMs)
	if err != nil {
		if ctx.Err() != nil {
			return nil, "", fmt.Errorf("%w: %v", ErrSpeakerBaselineTimeout, ctx.Err())
		}
		return nil, "", err
	}
	return data, "缓存或下载整段", nil
}

// speakerBaselineDirectReadBlocked 判断该文件的直读是否仍在退避期内。
func speakerBaselineDirectReadBlocked(audioKey string) bool {
	speakerBaselineDirectReadBlockMu.Lock()
	defer speakerBaselineDirectReadBlockMu.Unlock()
	until, ok := speakerBaselineDirectReadBlockedIds[audioKey]
	if !ok {
		return false
	}
	if time.Now().After(until) {
		delete(speakerBaselineDirectReadBlockedIds, audioKey)
		return false
	}
	return true
}

// blockSpeakerBaselineDirectRead 记录该文件直读失败，退避期内直接走下载整段。
func blockSpeakerBaselineDirectRead(audioKey string) {
	speakerBaselineDirectReadBlockMu.Lock()
	defer speakerBaselineDirectReadBlockMu.Unlock()
	speakerBaselineDirectReadBlockedIds[audioKey] = time.Now().Add(speakerBaselineDirectReadBackoff)
}

// speakerBaselineURLInError 匹配 ffmpeg 报错里可能出现的地址，含签名参数，不能原样进日志。
var speakerBaselineURLInError = regexp.MustCompile("(?:https?|oss)://[^\\s\"']+")

// sanitizeSpeakerBaselineError 去掉错误文本中的地址，避免签名地址随日志外泄。
func sanitizeSpeakerBaselineError(err error) string {
	if err == nil {
		return ""
	}
	message := strings.Join(strings.Fields(speakerBaselineURLInError.ReplaceAllString(err.Error(), "<已隐藏的音频地址>")), " ")
	if runes := []rune(message); len(runes) > speakerBaselineErrorMaxRunes {
		message = string(runes[:speakerBaselineErrorMaxRunes]) + "…"
	}
	return message
}

// runSpeakerBaselineFFmpeg 执行一次切片并读回产物；超时统一转成 ErrSpeakerBaselineTimeout。
func runSpeakerBaselineFFmpeg(ctx context.Context, ffmpegPath, encoder, input string, startMs, endMs int64) ([]byte, error) {
	workDir, err := os.MkdirTemp("", "speaker-baseline-*")
	if err != nil {
		return nil, fmt.Errorf("创建基准片段临时目录失败: %w", err)
	}
	defer os.RemoveAll(workDir)

	outputPath := filepath.Join(workDir, "clip."+speakerBaselineClipFormat)
	args := []string{
		"-y",
		"-ss", strconv.FormatFloat(float64(startMs)/1000, 'f', 3, 64),
		"-t", strconv.FormatFloat(float64(endMs-startMs)/1000, 'f', 3, 64),
	}
	args = append(args,
		"-i", input,
		"-vn", "-ac", "1", "-ar", "16000",
		"-c:a", encoder,
		outputPath,
	)
	if err := speakerBaselineRunner.Run(ctx, ffmpegPath, args...); err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("%w: %v", ErrSpeakerBaselineTimeout, ctx.Err())
		}
		return nil, fmt.Errorf("截取基准片段失败: %w", err)
	}

	data, err := os.ReadFile(outputPath)
	if err != nil {
		return nil, fmt.Errorf("读取基准片段失败: %w", err)
	}
	if len(data) == 0 {
		return nil, errors.New("读取基准片段失败：切片输出为空")
	}
	return data, nil
}

// materializeSpeakerBaselineInput 优先用本地磁盘路径（避免整段音频读进内存），否则落临时文件。
func materializeSpeakerBaselineInput(audioKey string) (string, func(), error) {
	key := strings.TrimSpace(audioKey)
	if key == "" {
		return "", func() {}, ErrSpeakerBaselineAudioMissing
	}
	if diskPath, ok := recordingArtifactDiskPath(key); ok {
		if info, statErr := os.Stat(diskPath); statErr == nil && !info.IsDir() {
			return diskPath, func() {}, nil
		}
	}
	path, err := loadSpeakerBaselineSource(key)
	if err != nil {
		return "", func() {}, err
	}
	return path, func() {}, nil
}

// loadSpeakerBaselineSource 复用本地缓存的源音频，未命中或过期才下载一次。
func loadSpeakerBaselineSource(audioKey string) (string, error) {
	cachePath := speakerBaselineCachedSourcePath(audioKey)
	if info, err := os.Stat(cachePath); err == nil && time.Since(info.ModTime()) < speakerBaselineSourceCacheTTL {
		_ = os.Chtimes(cachePath, time.Now(), time.Now())
		return cachePath, nil
	}
	data, err := speakerBaselineLoadFile(audioKey)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrSpeakerBaselineStorageUnavailable, err)
	}
	if len(data) == 0 {
		return "", ErrSpeakerBaselineStorageUnavailable
	}
	if err := os.MkdirAll(speakerBaselineSourceCacheDir, 0o700); err != nil {
		return "", fmt.Errorf("创建原音频缓存目录失败: %w", err)
	}
	if err := os.WriteFile(cachePath, data, 0o600); err != nil {
		return "", fmt.Errorf("写入原音频缓存失败: %w", err)
	}
	evictSpeakerBaselineSourceCache()
	return cachePath, nil
}

// speakerBaselineCachedSourcePath 按存储 key 生成缓存文件名；key 本身含路径分隔符，用摘要压平。
func speakerBaselineCachedSourcePath(audioKey string) string {
	sum := sha1.Sum([]byte(strings.TrimSpace(audioKey)))
	return filepath.Join(speakerBaselineSourceCacheDir, hex.EncodeToString(sum[:])+".source")
}

// evictSpeakerBaselineSourceCache 超过容量上限时按最久未用淘汰。
func evictSpeakerBaselineSourceCache() {
	entries, err := os.ReadDir(speakerBaselineSourceCacheDir)
	if err != nil {
		return
	}
	type cachedSource struct {
		path string
		size int64
		used time.Time
	}
	sources := make([]cachedSource, 0, len(entries))
	var total int64
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil || info.IsDir() {
			continue
		}
		sources = append(sources, cachedSource{filepath.Join(speakerBaselineSourceCacheDir, entry.Name()), info.Size(), info.ModTime()})
		total += info.Size()
	}
	if total <= speakerBaselineSourceCacheSize {
		return
	}
	sort.Slice(sources, func(i, j int) bool { return sources[i].used.Before(sources[j].used) })
	for _, source := range sources {
		if total <= speakerBaselineSourceCacheSize {
			return
		}
		if os.Remove(source.path) == nil {
			total -= source.size
		}
	}
}

// lockRecordingFileForBind 用行锁把同一录音的绑定串行化，避免并发重复提交插出两条基准。
// SQLite 无 FOR UPDATE 语法，单写事务本身已串行，跳过即可。
func lockRecordingFileForBind(tx *gorm.DB, eid, fileID int64) error {
	query := tx
	if tx.Dialector.Name() != "sqlite" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	return query.Select("id").Where("id = ? AND eid = ?", fileID, eid).First(&model.File{}).Error
}

// buildSpeakerBaselineStorageKey 生成切片存储 key。
func buildSpeakerBaselineStorageKey(eid, fileID int64) string {
	var buf [8]byte
	_, _ = rand.Read(buf[:])
	// 产物名带上切片逻辑版本与实例名：storage_key 就是产地凭据，换机器/换算法一眼可辨
	return fmt.Sprintf("recordings/speaker_baselines/%d/%d/v%d-%s-%s.%s",
		eid, fileID, speakerBaselineSliceVersion, speakerBaselineInstanceTag(), hex.EncodeToString(buf[:]), speakerBaselineClipFormat)
}

// resolveRecordingAudioKey 取录音原音频的存储 key（upload_files.key）与 upload_file_id。
func resolveRecordingAudioKey(file *model.File) (int64, string) {
	if file == nil || file.UploadFileID <= 0 {
		return 0, ""
	}
	uploadFile, err := model.GetUploadFileByID(file.UploadFileID)
	if err != nil || uploadFile == nil {
		return 0, ""
	}
	return uploadFile.ID, strings.TrimSpace(uploadFile.Key)
}

func encodeHashID(id int64) string {
	if id <= 0 {
		return ""
	}
	hashID, err := hashids.Encode(id)
	if err != nil {
		return ""
	}
	return hashID
}
