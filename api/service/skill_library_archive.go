package service

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
)

type skillArchiveInspection struct {
	SkillMarkdown string
	Entries       []string
}

// decodeZipEntryName 解码 ZIP 文件条目名称，处理非 UTF-8 编码的情况
// 根据 ZIP 规范，如果 NonUTF8 标志为 true 或名称不是有效 UTF-8，
// 尝试从 GBK/GB18030 转换为 UTF-8（常见于 Windows 中文环境创建的 ZIP）
func decodeZipEntryName(file *zip.File) string {
	name := file.Name

	// 如果已经是有效 UTF-8 且 NonUTF8 标志为 false，直接返回
	if !file.NonUTF8 && utf8.ValidString(name) {
		return name
	}

	// NonUTF8 标志为 true 或名称不是有效 UTF-8，尝试从 GBK 解码
	decoded, err := simplifiedchinese.GBK.NewDecoder().String(name)
	if err == nil && utf8.ValidString(decoded) {
		return decoded
	}

	// GBK 解码失败，尝试 GB18030（GBK 的超集）
	decoded, err = simplifiedchinese.GB18030.NewDecoder().String(name)
	if err == nil && utf8.ValidString(decoded) {
		return decoded
	}

	// 所有解码尝试失败，返回原始名称（可能乱码，但保持兼容性）
	return name
}

func inspectSkillArchive(zipContent []byte, skillPath string) (*skillArchiveInspection, error) {
	if len(zipContent) == 0 {
		return nil, fmt.Errorf("empty zip content")
	}

	reader, err := zip.NewReader(bytes.NewReader(zipContent), int64(len(zipContent)))
	if err != nil {
		return nil, err
	}

	inspection := &skillArchiveInspection{}
	seenEntries := make(map[string]struct{})
	targetPrefix := normalizeSkillArchiveTargetPrefix(skillPath)

	for _, file := range reader.File {
		if file == nil || file.FileInfo() != nil && file.FileInfo().IsDir() {
			continue
		}

		entryName := decodeZipEntryName(file)
		rel, ok, err := normalizeSkillArchiveRelativePath(entryName, targetPrefix)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}

		if _, exists := seenEntries[rel]; !exists {
			seenEntries[rel] = struct{}{}
			inspection.Entries = append(inspection.Entries, rel)
		}

		if rel == "SKILL.md" && strings.EqualFold(path.Base(rel), "SKILL.md") && strings.TrimSpace(inspection.SkillMarkdown) == "" {
			rc, err := file.Open()
			if err != nil {
				return nil, err
			}
			data, readErr := io.ReadAll(rc)
			rc.Close()
			if readErr != nil {
				return nil, readErr
			}
			if strings.TrimSpace(string(data)) == "" {
				return nil, ErrSkillScanMissingSkillMD
			}
			inspection.SkillMarkdown = string(data)
		}
	}

	if strings.TrimSpace(inspection.SkillMarkdown) == "" {
		return nil, ErrSkillScanMissingSkillMD
	}

	return inspection, nil
}

func standardizeGithubSkillZipWithInspection(archiveZip []byte, skillPath string) (*skillArchiveInspection, []byte, error) {
	if len(archiveZip) == 0 {
		return nil, nil, fmt.Errorf("empty zip content")
	}

	reader, err := zip.NewReader(bytes.NewReader(archiveZip), int64(len(archiveZip)))
	if err != nil {
		return nil, nil, err
	}

	targetPrefix := normalizeSkillArchiveTargetPrefix(skillPath)
	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	defer zw.Close()

	inspection := &skillArchiveInspection{}
	seenEntries := make(map[string]struct{})

	for _, file := range reader.File {
		if file == nil || file.FileInfo() != nil && file.FileInfo().IsDir() {
			continue
		}

		entryName := decodeZipEntryName(file)
		rel, ok, err := normalizeSkillArchiveRelativePath(entryName, targetPrefix)
		if err != nil {
			return nil, nil, err
		}
		if !ok {
			continue
		}

		if _, exists := seenEntries[rel]; !exists {
			seenEntries[rel] = struct{}{}
			inspection.Entries = append(inspection.Entries, rel)
		}

		rc, err := file.Open()
		if err != nil {
			return nil, nil, err
		}
		data, readErr := io.ReadAll(rc)
		rc.Close()
		if readErr != nil {
			return nil, nil, readErr
		}
		if rel == "SKILL.md" && strings.EqualFold(path.Base(rel), "SKILL.md") && strings.TrimSpace(inspection.SkillMarkdown) == "" {
			if strings.TrimSpace(string(data)) == "" {
				return nil, nil, ErrSkillScanMissingSkillMD
			}
			inspection.SkillMarkdown = string(data)
		}

		fw, err := zw.Create(rel)
		if err != nil {
			return nil, nil, err
		}
		if _, err := fw.Write(data); err != nil {
			return nil, nil, err
		}
	}

	if strings.TrimSpace(inspection.SkillMarkdown) == "" {
		return nil, nil, ErrSkillScanMissingSkillMD
	}

	if err := zw.Close(); err != nil {
		return nil, nil, err
	}
	return inspection, out.Bytes(), nil
}

func extractSkillArchiveToPath(zipContent []byte, skillPath, installPath string) (*skillArchiveInspection, error) {
	if len(zipContent) == 0 {
		return nil, fmt.Errorf("empty zip content")
	}

	reader, err := zip.NewReader(bytes.NewReader(zipContent), int64(len(zipContent)))
	if err != nil {
		return nil, err
	}

	installPath = filepath.Clean(strings.TrimSpace(installPath))
	if installPath == "" || installPath == "." {
		return nil, fmt.Errorf("invalid install path")
	}
	if err := os.MkdirAll(installPath, 0o755); err != nil {
		return nil, err
	}

	inspection := &skillArchiveInspection{}
	seenEntries := make(map[string]struct{})
	targetPrefix := normalizeSkillArchiveTargetPrefix(skillPath)
	stripTopFolder := detectSingleTopFolder(reader.File)

	for _, file := range reader.File {
		if file == nil || file.FileInfo() != nil && file.FileInfo().IsDir() {
			continue
		}

		entryName := decodeZipEntryName(file)
		rel, ok, err := normalizeSkillArchiveRelativePath(entryName, targetPrefix)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}

		if stripTopFolder != "" && strings.HasPrefix(rel, stripTopFolder+"/") {
			rel = strings.TrimPrefix(rel, stripTopFolder+"/")
		}
		rel = strings.TrimSpace(rel)
		if rel == "" || rel == "." {
			continue
		}
		rel = path.Clean(rel)
		if rel == ".." || strings.HasPrefix(rel, "../") || path.IsAbs(rel) {
			return nil, ErrSkillScanZipPathTraversal
		}

		if _, exists := seenEntries[rel]; !exists {
			seenEntries[rel] = struct{}{}
			inspection.Entries = append(inspection.Entries, rel)
		}

		outPath := filepath.Join(installPath, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
			return nil, err
		}

		rc, err := file.Open()
		if err != nil {
			return nil, err
		}
		data, readErr := io.ReadAll(rc)
		rc.Close()
		if readErr != nil {
			return nil, readErr
		}
		if rel == "SKILL.md" && strings.EqualFold(path.Base(rel), "SKILL.md") && strings.TrimSpace(inspection.SkillMarkdown) == "" {
			if strings.TrimSpace(string(data)) == "" {
				return nil, ErrSkillScanMissingSkillMD
			}
			inspection.SkillMarkdown = string(data)
		}
		if err := os.WriteFile(outPath, data, 0o644); err != nil {
			return nil, err
		}
	}

	if strings.TrimSpace(inspection.SkillMarkdown) == "" {
		return nil, ErrSkillScanMissingSkillMD
	}

	return inspection, nil
}

func normalizeSkillArchiveTargetPrefix(skillPath string) string {
	targetPrefix := strings.Trim(strings.ReplaceAll(strings.TrimSpace(skillPath), "\\", "/"), "/")
	if targetPrefix != "" {
		targetPrefix += "/"
	}
	return targetPrefix
}

func normalizeSkillArchiveRelativePath(rawName, targetPrefix string) (string, bool, error) {
	entryName := strings.ReplaceAll(strings.TrimSpace(rawName), "\\", "/")
	if hasPathTraversalSegment(entryName) {
		return "", false, ErrSkillScanZipPathTraversal
	}
	cleanName := path.Clean(entryName)
	if cleanName == "." || cleanName == "" {
		return "", false, nil
	}
	if hasPathTraversalSegment(cleanName) {
		return "", false, ErrSkillScanZipPathTraversal
	}

	parts := strings.Split(cleanName, "/")
	if len(parts) < 2 {
		if strings.TrimSpace(targetPrefix) == "" {
			return cleanName, true, nil
		}
		return "", false, nil
	}
	rel := strings.Join(parts[1:], "/")
	if targetPrefix != "" && !strings.HasPrefix(rel, targetPrefix) {
		return "", false, nil
	}
	rel = strings.TrimPrefix(rel, targetPrefix)
	if rel == "" || rel == "." {
		return "", false, nil
	}
	rel = path.Clean(rel)
	if rel == ".." || strings.HasPrefix(rel, "../") || path.IsAbs(rel) {
		return "", false, ErrSkillScanZipPathTraversal
	}
	return rel, true, nil
}
