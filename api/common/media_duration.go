package common

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
)

var mediaExtensions = map[string]bool{
	".mp3": true, ".wav": true, ".aac": true, ".ogg": true, ".flac": true,
	".wma": true, ".m4a": true, ".amr": true, ".opus": true, ".webm": true,
	".mp4": true, ".avi": true, ".mkv": true, ".mov": true, ".wmv": true,
	".flv": true, ".m4v": true, ".3gp": true, ".ts": true,
}

func IsMediaFile(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	return mediaExtensions[ext]
}

type ffprobeFormat struct {
	Duration string `json:"duration"`
}

type ffprobeOutput struct {
	Format ffprobeFormat `json:"format"`
}

func ProbeDurationMs(ctx context.Context, filePath string) int64 {
	ffprobePath, err := resolveFFprobePath()
	if err != nil {
		logger.Debugf(ctx, "【媒体时长】ffprobe 不可用: %v", err)
		return 0
	}

	probePath := filePath
	var tmpFile string
	if strings.HasPrefix(filePath, "http://") || strings.HasPrefix(filePath, "https://") {
		tmpFile, err = downloadToTempFile(ctx, filePath)
		if err != nil {
			logger.Warnf(ctx, "【媒体时长】下载文件失败: path=%s err=%v", filePath, err)
			return 0
		}
		probePath = tmpFile
		defer os.Remove(tmpFile)
	}

	cmd := exec.CommandContext(ctx, ffprobePath,
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		probePath,
	)

	output, err := cmd.Output()
	if err != nil {
		logger.Warnf(ctx, "【媒体时长】ffprobe 执行失败: path=%s err=%v", filePath, err)
		return 0
	}

	var probe ffprobeOutput
	if err := json.Unmarshal(output, &probe); err != nil {
		logger.Warnf(ctx, "【媒体时长】ffprobe 输出解析失败: path=%s err=%v", filePath, err)
		return 0
	}

	var durationSec float64
	if _, err := fmt.Sscanf(probe.Format.Duration, "%f", &durationSec); err != nil {
		logger.Warnf(ctx, "【媒体时长】时长解析失败: path=%s duration_str=%s err=%v", filePath, probe.Format.Duration, err)
		return 0
	}

	durationMs := int64(durationSec * 1000)
	logger.Infof(ctx, "【媒体时长】ffprobe 探测成功: path=%s duration_ms=%d", filePath, durationMs)
	return durationMs
}

func downloadToTempFile(ctx context.Context, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	tmp, err := os.CreateTemp("", "ffprobe_*.tmp")
	if err != nil {
		return "", err
	}
	defer tmp.Close()

	if _, err := io.Copy(tmp, resp.Body); err != nil {
		os.Remove(tmp.Name())
		return "", err
	}

	return tmp.Name(), nil
}

// resolveFFprobePath 与 ResolveFFmpegToolchainPath 保持一致的 4 级优先级解析
func resolveFFprobePath() (string, error) {
	// 优先级1: 环境变量 FFPROBE_PATH
	if path := strings.TrimSpace(os.Getenv("FFPROBE_PATH")); path != "" {
		if resolved, err := resolveProbeExecutableCandidate(path); err == nil {
			return resolved, nil
		}
	}

	// 优先级2: 当前工作目录下的相对路径（适用于开发调试）
	if wd, err := os.Getwd(); err == nil {
		candidates := []string{
			filepath.Join(wd, "bin", "ffmpeg", "ffprobe"),
			filepath.Join(wd, "bin", "ffprobe"),
			filepath.Join(wd, "ffmpeg", "ffprobe"),
			filepath.Join(wd, "ffmpeg", "ffprobe.exe"),
			filepath.Join(wd, "ffprobe"),
		}
		for _, candidate := range candidates {
			if resolved, err := resolveProbeExecutableCandidate(candidate); err == nil {
				return resolved, nil
			}
		}
	}

	// 优先级3: 基于可执行文件目录的相对路径（适用于部署环境）
	if execPath, err := os.Executable(); err == nil {
		appDir := filepath.Dir(execPath)
		candidates := []string{
			filepath.Join(appDir, "bin", "ffmpeg", "ffprobe"),
			filepath.Join(appDir, "bin", "ffprobe"),
			filepath.Join(appDir, "ffmpeg", "ffprobe"),
			filepath.Join(appDir, "ffmpeg", "ffprobe.exe"),
			filepath.Join(appDir, "ffprobe"),
		}
		for _, candidate := range candidates {
			if resolved, err := resolveProbeExecutableCandidate(candidate); err == nil {
				return resolved, nil
			}
		}
	}

	// 优先级4: 系统 PATH
	if path, err := exec.LookPath("ffprobe"); err == nil {
		if resolved, err := resolveProbeExecutableCandidate(path); err == nil {
			return resolved, nil
		}
	}

	return "", fmt.Errorf("ffprobe 未找到，可通过 FFPROBE_PATH 环境变量指定路径")
}

func resolveProbeExecutableCandidate(candidate string) (string, error) {
	candidate = filepath.Clean(strings.TrimSpace(candidate))
	if candidate == "" {
		return "", fmt.Errorf("empty path")
	}

	info, err := os.Stat(candidate)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		nested := filepath.Join(candidate, filepath.Base(candidate))
		nestedInfo, nestedErr := os.Stat(nested)
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
