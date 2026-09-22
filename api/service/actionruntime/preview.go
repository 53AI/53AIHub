package actionruntime

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/53AI/53AIHub/service/actionsystem"
)

var (
	ErrPreviewUnavailable = errors.New("artifact preview renderer is unavailable")
	ErrInvalidPDFPreview  = errors.New("invalid pdf preview")
)

// Preview 是 Host 预览能力的产品安全结论，客户端只看这三个值加下面的 error code：
//   - available：preview_url 指向一份真实的 PDF；
//   - unavailable：这台 Host 现在给不了这种格式的预览（缺转换模块/格式不支持），
//     原始文件仍然可下载；
//   - failed：转换真的跑过但失败了（超时/转换错误），重试有意义。
const (
	PreviewStatusAvailable   = "available"
	PreviewStatusUnavailable = "unavailable"
	PreviewStatusFailed      = "failed"
)

// 预览失败的安全分类：只暴露「为什么没有 preview」，不把 LibreOffice stderr、
// 命令行或宿主机路径交给客户端（那些只写服务端日志）。
const (
	ErrorCodePreviewConverterUnavailable ErrorCode = "converter_unavailable"
	ErrorCodePreviewUnsupportedFormat    ErrorCode = "unsupported_format"
	ErrorCodePreviewConversionTimeout    ErrorCode = "conversion_timeout"
	ErrorCodePreviewConversionFailed     ErrorCode = "conversion_failed"
)

// libreOfficePreviewModule 是每种交付格式做 PDF 转换所必需的 LibreOffice 模块。
// soffice 主程序永远存在，模块是独立安装包（缺 libreoffice-calc 时 XLSX 就转不了），
// 所以不能只靠 LookPath 判断转换能力。
var libreOfficePreviewModule = map[actionsystem.DeliverableFormat]string{
	actionsystem.FormatDOCX: "writer",
	actionsystem.FormatXLSX: "calc",
	actionsystem.FormatPPTX: "impress",
}

// ClassifyPreviewFailure 把任意预览失败收敛成 (preview_status, preview_error_code)：
// 先把「这台 Host 现在给不了」和「转换真的失败了」分开，客户端才能给出不同文案。
func ClassifyPreviewFailure(err error) (status, code string) {
	switch RuntimeErrorCode(err) {
	case ErrorCodePreviewConverterUnavailable, ErrorCodePreviewUnsupportedFormat:
		return PreviewStatusUnavailable, string(RuntimeErrorCode(err))
	case ErrorCodePreviewConversionTimeout, ErrorCodePreviewConversionFailed:
		return PreviewStatusFailed, string(RuntimeErrorCode(err))
	}
	switch {
	case errors.Is(err, ErrPreviewUnavailable):
		return PreviewStatusUnavailable, string(ErrorCodePreviewConverterUnavailable)
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		return PreviewStatusFailed, string(ErrorCodePreviewConversionTimeout)
	default:
		return PreviewStatusFailed, string(ErrorCodePreviewConversionFailed)
	}
}

// previewModuleUnavailable 判断 LibreOffice 是否缺该格式的转换模块。
// 注册表目录不存在（未知安装布局）时返回 false，让调用方按真实转换结果分类，
// 而不是把「不认识的安装方式」误报成「模块缺失」。
func previewModuleUnavailable(binary string, format actionsystem.DeliverableFormat) bool {
	module, ok := libreOfficePreviewModule[format]
	if !ok {
		return false
	}
	resolved := binary
	if evaluated, err := filepath.EvalSymlinks(binary); err == nil {
		resolved = evaluated
	}
	registryDir := filepath.Join(filepath.Dir(filepath.Dir(resolved)), "share", "registry")
	if _, err := os.Stat(registryDir); err != nil {
		return false
	}
	_, err := os.Stat(filepath.Join(registryDir, module+".xcd"))
	return err != nil
}

// RenderArtifactPreview converts a verified primary artifact (DOCX / XLSX / PPTX)
// into a PDF in outputRoot. The renderer is deliberately a host capability; it
// does not change the source artifact or expose the renderer's working paths to
// callers, and the PDF never becomes a second business deliverable.
//
// 失败时返回带安全 error code 的 RuntimeError（见 ClassifyPreviewFailure），
// 原始诊断只留在 error 文本里给服务端日志用。
func RenderArtifactPreview(ctx context.Context, binary, workspaceRoot, sourcePath, outputRoot string, format actionsystem.DeliverableFormat) (ActionArtifact, error) {
	if binary == "" {
		binary = "libreoffice"
	}
	if _, supported := libreOfficePreviewModule[format]; !supported {
		return ActionArtifact{}, NewRuntimeError("preview", ErrorCodePreviewUnsupportedFormat, fmt.Errorf("artifact format %q has no preview conversion", format))
	}
	resolved, lookErr := exec.LookPath(binary)
	if lookErr != nil {
		return ActionArtifact{}, NewRuntimeError("preview", ErrorCodePreviewConverterUnavailable, fmt.Errorf("%w: %s: %v", ErrPreviewUnavailable, binary, lookErr))
	}
	if previewModuleUnavailable(resolved, format) {
		return ActionArtifact{}, NewRuntimeError("preview", ErrorCodePreviewConverterUnavailable, fmt.Errorf("%w: %s module is not installed for %s", ErrPreviewUnavailable, libreOfficePreviewModule[format], format))
	}
	if _, err := VerifyOOXMLArtifact(ctx, workspaceRoot, sourcePath, format, 0); err != nil {
		return ActionArtifact{}, fmt.Errorf("verify source artifact: %w", err)
	}
	outputRoot, err := filepath.Abs(outputRoot)
	if err != nil {
		return ActionArtifact{}, fmt.Errorf("resolve preview output root: %w", err)
	}
	if err := os.MkdirAll(outputRoot, 0o700); err != nil {
		return ActionArtifact{}, fmt.Errorf("create preview output root: %w", err)
	}
	profile, err := os.MkdirTemp(outputRoot, ".libreoffice-profile-")
	if err != nil {
		return ActionArtifact{}, fmt.Errorf("create preview profile: %w", err)
	}
	defer os.RemoveAll(profile)

	name := strings.TrimSuffix(filepath.Base(sourcePath), filepath.Ext(sourcePath)) + ".pdf"
	pdfPath := filepath.Join(outputRoot, name)
	_ = os.Remove(pdfPath)
	cmd := exec.CommandContext(ctx, binary,
		"-env:UserInstallation=file://"+filepath.ToSlash(profile),
		"--headless", "--convert-to", "pdf", "--outdir", outputRoot, sourcePath,
	)
	cmd.Env = mergeEnv(os.Environ(), "HOME="+profile, "XDG_CONFIG_HOME="+filepath.Join(profile, "config"), "XDG_CACHE_HOME="+filepath.Join(profile, "cache"))
	var stdout limitedBuffer
	cmd.Stdout = &stdout
	var stderr limitedBuffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return ActionArtifact{}, NewRuntimeError("preview", ErrorCodePreviewConversionTimeout, fmt.Errorf("convert artifact preview: %w", ctx.Err()))
		}
		return ActionArtifact{}, NewRuntimeError("preview", ErrorCodePreviewConversionFailed, fmt.Errorf("convert artifact preview: %w: %s", err, strings.TrimSpace(stderr.String()+stdout.String())))
	}
	// LibreOffice 缺模块时会以退出码 0 结束、只打印 "Error: source file could not be loaded"
	// 且不产出 PDF；没有产出就是转换失败，绝不能当成预览成功。
	artifact, err := VerifyArtifact(ctx, outputRoot, pdfPath, 0)
	if err != nil {
		return ActionArtifact{}, NewRuntimeError("preview", ErrorCodePreviewConversionFailed, fmt.Errorf("verify PDF preview %q: %w: %s", pdfPath, err, strings.TrimSpace(stderr.String()+stdout.String())))
	}
	file, err := os.Open(pdfPath)
	if err != nil {
		return ActionArtifact{}, NewRuntimeError("preview", ErrorCodePreviewConversionFailed, fmt.Errorf("open PDF preview: %w", err))
	}
	var header [5]byte
	_, readErr := io.ReadFull(file, header[:])
	closeErr := file.Close()
	if readErr != nil {
		return ActionArtifact{}, NewRuntimeError("preview", ErrorCodePreviewConversionFailed, fmt.Errorf("%w: read header: %v", ErrInvalidPDFPreview, readErr))
	}
	if closeErr != nil {
		return ActionArtifact{}, NewRuntimeError("preview", ErrorCodePreviewConversionFailed, fmt.Errorf("close PDF preview: %w", closeErr))
	}
	if !bytes.Equal(header[:], []byte("%PDF-")) {
		return ActionArtifact{}, NewRuntimeError("preview", ErrorCodePreviewConversionFailed, ErrInvalidPDFPreview)
	}
	artifact.MimeType = "application/pdf"
	return artifact, nil
}

type limitedBuffer struct {
	bytes.Buffer
}

func (b *limitedBuffer) Write(value []byte) (int, error) {
	const maxBytes = 64 * 1024
	originalLength := len(value)
	remaining := maxBytes - b.Len()
	if remaining > 0 {
		if len(value) > remaining {
			value = value[:remaining]
		}
		_, _ = b.Buffer.Write(value)
	}
	return originalLength, nil
}

func mergeEnv(base []string, overrides ...string) []string {
	values := make(map[string]string, len(base)+len(overrides))
	order := make([]string, 0, len(base)+len(overrides))
	for _, entry := range append(base, overrides...) {
		key, value, ok := strings.Cut(entry, "=")
		if !ok || key == "" {
			continue
		}
		if _, exists := values[key]; !exists {
			order = append(order, key)
		}
		values[key] = value
	}
	result := make([]string, 0, len(order))
	for _, key := range order {
		result = append(result, key+"="+values[key])
	}
	return result
}
