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

// FFmpegToolchainResult 统一 FFmpeg 工具链探测结果。
type FFmpegToolchainResult struct {
	Path         string
	Available    bool
	Version      string
	HasAAC       bool
	HasLibOpus   bool
	HasWebMDemux bool
	Error        string
}

type ffmpegToolchainCommandRunner interface {
	CombinedOutput(ctx context.Context, name string, args ...string) ([]byte, error)
}

type osFFmpegToolchainCommandRunner struct{}

func (osFFmpegToolchainCommandRunner) CombinedOutput(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	return cmd.CombinedOutput()
}

var (
	ffmpegToolchainExecutablePath                              = os.Executable
	ffmpegToolchainLookPath                                    = exec.LookPath
	ffmpegToolchainStat                                        = os.Stat
	ffmpegToolchainRunner         ffmpegToolchainCommandRunner = osFFmpegToolchainCommandRunner{}
)

// ResolveFFmpegToolchainPath 按项目优先级解析 ffmpeg 可执行文件路径。
func ResolveFFmpegToolchainPath() (string, error) {
	// 优先级1: 环境变量 FFMPEG_PATH
	if path := strings.TrimSpace(os.Getenv("FFMPEG_PATH")); path != "" {
		resolved, err := resolveFFmpegExecutableCandidate(path)
		if err == nil && resolved != "" {
			return resolved, nil
		}
	}

	// 优先级2: 当前工作目录下的相对路径（适用于开发调试）
	if wd, err := os.Getwd(); err == nil {
		candidates := []string{
			filepath.Join(wd, "bin", "ffmpeg", "ffmpeg"),
			filepath.Join(wd, "bin", "ffmpeg"),
			filepath.Join(wd, "ffmpeg", "ffmpeg"),
			filepath.Join(wd, "ffmpeg"),
		}
		for _, candidate := range candidates {
			if resolved, err := resolveFFmpegExecutableCandidate(candidate); err == nil {
				return resolved, nil
			}
		}
	}

	// 优先级3: 基于可执行文件目录的相对路径（适用于部署环境）
	if execPath, err := ffmpegToolchainExecutablePath(); err == nil {
		appDir := filepath.Dir(execPath)
		candidates := []string{
			filepath.Join(appDir, "bin", "ffmpeg", "ffmpeg"),
			filepath.Join(appDir, "bin", "ffmpeg"),
			filepath.Join(appDir, "ffmpeg", "ffmpeg"),
			filepath.Join(appDir, "ffmpeg"),
		}
		for _, candidate := range candidates {
			if resolved, err := resolveFFmpegExecutableCandidate(candidate); err == nil {
				return resolved, nil
			}
		}
	}

	// 优先级4: 系统 PATH
	if path, err := ffmpegToolchainLookPath("ffmpeg"); err == nil {
		if resolved, err := resolveFFmpegExecutableCandidate(path); err == nil {
			return resolved, nil
		}
	}

	return "", errors.New("未找到可用的 ffmpeg 可执行文件")
}

// CheckFFmpegToolchainCapabilitiesWithPath 使用指定路径探测 FFmpeg 能力。
func CheckFFmpegToolchainCapabilitiesWithPath(ctx context.Context, path string, runner ffmpegToolchainCommandRunner) FFmpegToolchainResult {
	result := FFmpegToolchainResult{Path: strings.TrimSpace(path)}
	if ctx == nil {
		ctx = context.Background()
	}
	if runner == nil {
		runner = ffmpegToolchainRunner
	}

	if result.Path == "" {
		result.Error = "FFmpeg 路径为空"
		return result
	}

	versionOutput, err := runner.CombinedOutput(ctx, result.Path, "-version")
	if err != nil {
		result.Error = fmt.Sprintf("FFmpeg 执行失败: %v", err)
		return result
	}

	lines := strings.Split(string(versionOutput), "\n")
	if len(lines) > 0 {
		fields := strings.Fields(lines[0])
		if len(fields) >= 3 && fields[1] == "version" {
			result.Version = fields[2]
		}
	}

	encoderOutput, err := runner.CombinedOutput(ctx, result.Path, "-encoders", "-hide_banner")
	if err != nil {
		result.Error = fmt.Sprintf("获取 FFmpeg 编码器列表失败: %v", err)
		return result
	}
	decoderOutput, err := runner.CombinedOutput(ctx, result.Path, "-decoders", "-hide_banner")
	if err != nil {
		result.Error = fmt.Sprintf("获取 FFmpeg 解码器列表失败: %v", err)
		return result
	}
	formatOutput, err := runner.CombinedOutput(ctx, result.Path, "-formats", "-hide_banner")
	if err != nil {
		result.Error = fmt.Sprintf("获取 FFmpeg 格式列表失败: %v", err)
		return result
	}

	encoderList := string(encoderOutput)
	decoderList := string(decoderOutput)
	formatList := string(formatOutput)

	result.HasAAC = strings.Contains(encoderList, "libaac") ||
		strings.Contains(encoderList, " aac ") ||
		strings.Contains(encoderList, "LIBAAC")
	result.HasLibOpus = strings.Contains(decoderList, "libopus") ||
		strings.Contains(decoderList, "opus")
	result.HasWebMDemux = strings.Contains(decoderList, "opus")

	hasWebMInput := strings.Contains(formatList, "webm")
	hasMP4Output := strings.Contains(formatList, "mp4") || strings.Contains(formatList, "ipod")

	result.Available = result.HasAAC && hasWebMInput && hasMP4Output
	if !result.Available {
		var missing []string
		if !result.HasAAC {
			missing = append(missing, "AAC编码器(需要 libfdk-aac 或内置 aac)")
		}
		if !hasWebMInput {
			missing = append(missing, "WebM 解封装支持")
		}
		if !hasMP4Output {
			missing = append(missing, "MP4/M4A 封装支持")
		}
		result.Error = fmt.Sprintf("FFmpeg 功能不完整，缺少: %s。请安装完整版 FFmpeg", strings.Join(missing, ", "))
	}

	return result
}

// CheckFFmpegToolchainCapabilities 先解析路径，再探测能力。
func CheckFFmpegToolchainCapabilities() FFmpegToolchainResult {
	path, err := ResolveFFmpegToolchainPath()
	if err != nil {
		return FFmpegToolchainResult{
			Error: err.Error(),
		}
	}
	result := CheckFFmpegToolchainCapabilitiesWithPath(context.Background(), path, nil)
	result.Path = path
	return result
}

func resolveFFmpegExecutableCandidate(candidate string) (string, error) {
	candidate = filepath.Clean(strings.TrimSpace(candidate))
	if candidate == "" {
		return "", errors.New("empty candidate")
	}

	info, err := ffmpegToolchainStat(candidate)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		nested := filepath.Join(candidate, filepath.Base(candidate))
		nestedInfo, nestedErr := ffmpegToolchainStat(nested)
		if nestedErr != nil {
			return "", nestedErr
		}
		if nestedInfo.Mode().IsRegular() && nestedInfo.Mode().Perm()&0o111 != 0 {
			return nested, nil
		}
		return "", fmt.Errorf("%s is a directory without executable binary", candidate)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("%s is not a regular file", candidate)
	}
	if info.Mode().Perm()&0o111 == 0 {
		return "", fmt.Errorf("%s is not executable", candidate)
	}
	return candidate, nil
}

// resolveExecutableCandidate 保留给同包旧测试使用。
func resolveExecutableCandidate(candidate string) string {
	resolved, err := resolveFFmpegExecutableCandidate(candidate)
	if err != nil {
		return ""
	}
	return resolved
}
