package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// ErrFFmpegNotAvailable 表示 FFmpeg 未安装或不可用
var ErrFFmpegNotAvailable = errors.New("FFmpeg 未安装，录音转码功能不可用。请安装 FFmpeg: apt-get install ffmpeg 或 yum install ffmpeg")

// ffmpegAvailable 缓存 FFmpeg 可用性检查结果
var ffmpegAvailable bool

// RecordingTranscoder 录音转码器接口
type RecordingTranscoder interface {
	Transcode(ctx context.Context, segments [][]byte, targetFormat string) ([]byte, error)
	TranscodeFromFile(ctx context.Context, inputPath string, targetFormat string) ([]byte, error)
}

type commandRunner interface {
	Run(ctx context.Context, name string, args ...string) error
}

type osCommandRunner struct{}

func (r osCommandRunner) Run(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		if len(output) > 0 {
			return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(output)))
		}
		return err
	}
	return nil
}

type ffmpegRecordingTranscoder struct {
	runner commandRunner
}

// FFmpegCheckResult FFmpeg 检查结果
type FFmpegCheckResult struct {
	Path         string
	Available    bool
	Version      string
	HasAAC       bool // 是否支持 AAC 编码
	HasLibOpus   bool // 是否支持 Opus 解码
	HasWebMDemux bool // 是否支持 WebM 解封装
	Error        string
}

// CheckFFmpegAvailable 检查 FFmpeg 是否可用（基础检查）
func CheckFFmpegAvailable() bool {
	if ffmpegAvailable {
		return true
	}
	result := CheckFFmpegCapabilities()
	ffmpegAvailable = result.Available
	return result.Available
}

// CheckFFmpegCapabilities 深度检查 FFmpeg 能力
func CheckFFmpegCapabilities() FFmpegCheckResult {
	toolchainResult := CheckFFmpegToolchainCapabilities()
	return FFmpegCheckResult{
		Path:         toolchainResult.Path,
		Available:    toolchainResult.Available,
		Version:      toolchainResult.Version,
		HasAAC:       toolchainResult.HasAAC,
		HasLibOpus:   toolchainResult.HasLibOpus,
		HasWebMDemux: toolchainResult.HasWebMDemux,
		Error:        toolchainResult.Error,
	}
}

// IsFFmpegAvailable 返回 FFmpeg 可用性（不触发检查）
func IsFFmpegAvailable() bool {
	return ffmpegAvailable
}

func SetFFmpegAvailableForTest(available bool) {
	ffmpegAvailable = available
}

func newRecordingTranscoder() RecordingTranscoder {
	if !CheckFFmpegAvailable() {
		return &passthroughRecordingTranscoder{}
	}
	return &ffmpegRecordingTranscoder{runner: osCommandRunner{}}
}

func newFFmpegRecordingTranscoderWithRunner(runner commandRunner) RecordingTranscoder {
	if runner == nil {
		runner = osCommandRunner{}
	}
	return &ffmpegRecordingTranscoder{runner: runner}
}

type passthroughRecordingTranscoder struct{}

func (t *passthroughRecordingTranscoder) Transcode(ctx context.Context, segments [][]byte, targetFormat string) ([]byte, error) {
	return nil, ErrFFmpegNotAvailable
}

func (t *passthroughRecordingTranscoder) TranscodeFromFile(ctx context.Context, inputPath string, targetFormat string) ([]byte, error) {
	return nil, ErrFFmpegNotAvailable
}

const (
	defaultTranscodeTimeout       = 5 * 60
	maxTotalSegmentsSize    int64 = 3 << 30
)

func (t *ffmpegRecordingTranscoder) Transcode(ctx context.Context, segments [][]byte, targetFormat string) ([]byte, error) {
	if len(segments) == 0 {
		return nil, errors.New("录音分段为空")
	}
	if len(segments) != 1 {
		return nil, fmt.Errorf("录音转码仅支持单个分段: %d", len(segments))
	}

	var totalSize int64
	for _, seg := range segments {
		totalSize += int64(len(seg))
	}
	if totalSize > maxTotalSegmentsSize {
		return nil, fmt.Errorf("录音总大小超限: %d > %d bytes", totalSize, maxTotalSegmentsSize)
	}

	normalizedFormat := normalizeRecordingTargetFormat(targetFormat)
	encoder, err := encoderForRecordingTargetFormat(normalizedFormat)
	if err != nil {
		return nil, err
	}
	ffmpegPath, err := ResolveFFmpegToolchainPath()
	if err != nil {
		return nil, err
	}

	workDir, err := os.MkdirTemp("", "recording-transcode-*")
	if err != nil {
		return nil, fmt.Errorf("创建临时目录失败: %w", err)
	}
	defer os.RemoveAll(workDir)

	inputPath := filepath.Join(workDir, "input.webm")
	if err := writeSegmentsToFile(inputPath, segments); err != nil {
		return nil, err
	}
	outputPath := filepath.Join(workDir, "output."+normalizedFormat)
	if err := ensureRecordingWritableFile(outputPath, recordingLocalArtifactMode); err != nil {
		return nil, err
	}
	args := []string{
		"-y",
		"-i", inputPath,
		"-vn",
		"-c:a", encoder,
		outputPath,
	}
	if err := t.runner.Run(ctx, ffmpegPath, args...); err != nil {
		return nil, fmt.Errorf("转码录音失败: %w", err)
	}
	if err := ensureRecordingFileMode(outputPath, recordingLocalArtifactMode); err != nil {
		return nil, err
	}
	result, err := os.ReadFile(outputPath)
	if err != nil {
		return nil, fmt.Errorf("读取最终输出失败: %w", err)
	}
	return result, nil
}

func (t *ffmpegRecordingTranscoder) TranscodeFromFile(ctx context.Context, inputPath string, targetFormat string) ([]byte, error) {
	if strings.TrimSpace(inputPath) == "" {
		return nil, errors.New("输入文件路径为空")
	}

	normalizedFormat := normalizeRecordingTargetFormat(targetFormat)
	encoder, err := encoderForRecordingTargetFormat(normalizedFormat)
	if err != nil {
		return nil, err
	}
	ffmpegPath, err := ResolveFFmpegToolchainPath()
	if err != nil {
		return nil, err
	}

	workDir, err := os.MkdirTemp("", "recording-transcode-*")
	if err != nil {
		return nil, fmt.Errorf("创建临时目录失败: %w", err)
	}
	defer os.RemoveAll(workDir)

	outputPath := filepath.Join(workDir, "output."+normalizedFormat)
	if err := ensureRecordingWritableFile(outputPath, recordingLocalArtifactMode); err != nil {
		return nil, err
	}
	args := []string{
		"-y",
		"-i", inputPath,
		"-vn",
		"-c:a", encoder,
		outputPath,
	}
	if err := t.runner.Run(ctx, ffmpegPath, args...); err != nil {
		return nil, fmt.Errorf("转码录音失败: %w", err)
	}
	if err := ensureRecordingFileMode(outputPath, recordingLocalArtifactMode); err != nil {
		return nil, err
	}
	result, err := os.ReadFile(outputPath)
	if err != nil {
		return nil, fmt.Errorf("读取最终输出失败: %w", err)
	}
	return result, nil
}

func writeSegmentsToFile(outputPath string, segments [][]byte) error {
	if len(segments) == 0 {
		return errors.New("录音分段为空")
	}
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		return fmt.Errorf("创建输入目录失败: %w", err)
	}
	if err := ensureRecordingWritableFile(outputPath, recordingLocalArtifactMode); err != nil {
		return err
	}
	f, err := os.OpenFile(outputPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("创建输入文件失败: %w", err)
	}
	defer f.Close()
	for i, segment := range segments {
		if len(segment) == 0 {
			continue
		}
		if _, err := f.Write(segment); err != nil {
			return fmt.Errorf("写入分段 %d 失败: %w", i, err)
		}
	}
	return ensureRecordingFileMode(outputPath, recordingLocalArtifactMode)
}

func normalizeRecordingTargetFormat(targetFormat string) string {
	targetFormat = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(targetFormat, ".")))
	if targetFormat == "" {
		return "m4a"
	}
	return targetFormat
}

func encoderForRecordingTargetFormat(targetFormat string) (string, error) {
	switch normalizeRecordingTargetFormat(targetFormat) {
	case "m4a", "mp4", "aac":
		return "aac", nil
	case "mp3":
		return "libmp3lame", nil
	case "wav":
		return "pcm_s16le", nil
	case "ogg":
		return "libvorbis", nil
	case "webm":
		return "libopus", nil
	default:
		return "", fmt.Errorf("不支持的录音目标格式: %s", targetFormat)
	}
}
