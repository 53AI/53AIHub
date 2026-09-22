package actionruntime

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/53AI/53AIHub/service/actionsystem"
)

var (
	// ErrArtifactFormatUnsupported：请求的格式不在 V1.1 支持范围内。
	ErrArtifactFormatUnsupported = errors.New("artifact format is not supported")
	// ErrArtifactFormatMismatch：文件真实格式与约定格式不一致。
	ErrArtifactFormatMismatch = errors.New("artifact format does not match its extension")
)

// OOXML 三种格式本质都是 ZIP 包：只看扩展名会把 txt 改名的假文件当成业务成果，
// 因此 Host 用 archive/zip 做最低成本结构校验（§13）。
var ooxmlRequiredParts = map[actionsystem.DeliverableFormat][]string{
	actionsystem.FormatDOCX: {"word/document.xml"},
	actionsystem.FormatXLSX: {"xl/workbook.xml"},
	actionsystem.FormatPPTX: {"ppt/presentation.xml"},
}

// VerifyOOXMLArtifact 校验 path 是 format 的真实格式：扩展名一致、非空、ZIP 可
// 打开、[Content_Types].xml 与 format 专属部件存在，并写入 Host 的正式 MIME。
func VerifyOOXMLArtifact(ctx context.Context, root, path string, format actionsystem.DeliverableFormat, maxSize int64) (ActionArtifact, error) {
	required, ok := ooxmlRequiredParts[format]
	if !ok {
		return ActionArtifact{}, ErrArtifactFormatUnsupported
	}
	if !strings.EqualFold(filepath.Ext(path), format.Extension()) {
		return ActionArtifact{}, fmt.Errorf("%w: extension does not match %s", ErrArtifactFormatMismatch, format)
	}
	artifact, err := VerifyArtifact(ctx, root, path, maxSize)
	if err != nil {
		return ActionArtifact{}, err
	}
	if artifact.Size <= 0 {
		return ActionArtifact{}, fmt.Errorf("%w: artifact is empty", ErrArtifactFormatMismatch)
	}
	reader, err := zip.OpenReader(path)
	if err != nil {
		return ActionArtifact{}, fmt.Errorf("%w: open zip: %v", ErrArtifactFormatMismatch, err)
	}
	defer reader.Close()
	hasContentTypes := false
	parts := make(map[string]bool, len(required))
	for _, file := range reader.File {
		if err := contextError(ctx); err != nil {
			return ActionArtifact{}, err
		}
		if file.Name == "[Content_Types].xml" {
			hasContentTypes = true
			continue
		}
		if !strings.HasSuffix(file.Name, "/") {
			parts[file.Name] = true
		}
	}
	if !hasContentTypes {
		return ActionArtifact{}, fmt.Errorf("%w: missing [Content_Types].xml", ErrArtifactFormatMismatch)
	}
	for _, part := range required {
		if !parts[part] {
			return ActionArtifact{}, fmt.Errorf("%w: missing %s", ErrArtifactFormatMismatch, part)
		}
	}
	artifact.MimeType = format.MimeType()
	return artifact, nil
}

// VerifyArtifactInWorkspace 是 Host 的默认 artifact 校验：按扩展名选择强度，
// 受支持的 OOXML 格式做结构校验，其他类型只做基础校验（存在/在 workspace 内/大小）。
func VerifyArtifactInWorkspace(ctx context.Context, root, path string, maxSize int64) (ActionArtifact, error) {
	if format, ok := actionsystem.FormatForExtension(filepath.Ext(path)); ok {
		return VerifyOOXMLArtifact(ctx, root, path, format, maxSize)
	}
	return VerifyArtifact(ctx, root, path, maxSize)
}
