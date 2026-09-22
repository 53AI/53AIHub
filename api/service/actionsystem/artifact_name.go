package actionsystem

import (
	"errors"
	"path"
	"strings"
	"unicode"
)

// 主交付物契约错误：这些名字是 Plan validation 对外可见的失败原因，命名与格式
// 冲突必须让用户改方案，而不是静默改名。
var (
	ErrDeliverableMissing             = errors.New("primary_artifact_missing")
	ErrDeliverableAmbiguous           = errors.New("multiple_primary_artifacts")
	ErrDeliverableFormatUnsupported   = errors.New("unsupported_artifact_format")
	ErrDeliverableTitleInvalid        = errors.New("invalid_primary_artifact_title")
	ErrDeliverableTitleFormatConflict = errors.New("artifact_title_format_conflict")
)

// maxArtifactBasenameRunes 是 canonical basename 的上限（Unicode 字符数）。
const maxArtifactBasenameRunes = 80

var windowsReservedBasenames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true,
	"COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true,
	"LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

// CanonicalArtifactFilename 是业务文件名的唯一权威：
// title 只提供 basename，扩展名只由 format 决定；两者冲突时报错，不静默改名。
func CanonicalArtifactFilename(title string, format DeliverableFormat) (string, error) {
	basename, err := canonicalArtifactBasename(title, format)
	if err != nil {
		return "", err
	}
	return basename + format.Extension(), nil
}

func canonicalArtifactBasename(title string, format DeliverableFormat) (string, error) {
	if format.Extension() == "" {
		return "", ErrDeliverableFormatUnsupported
	}
	basename := strings.TrimSpace(title)
	if extension := path.Ext(basename); extension != "" {
		if titleFormat, ok := FormatForExtension(extension); ok {
			if titleFormat != format {
				return "", ErrDeliverableTitleFormatConflict
			}
			basename = basename[:len(basename)-len(extension)]
		}
	}
	var builder strings.Builder
	builder.Grow(len(basename))
	previousSpace := false
	for _, char := range basename {
		switch {
		case char == '/' || char == '\\' || char == ':' || char == '*' || char == '?' ||
			char == '"' || char == '<' || char == '>' || char == '|':
			builder.WriteRune('-')
			previousSpace = false
		case char == ' ' || char == '\t' || char == '\n' || char == '\r' || char == '\u3000':
			// 空白与换行统一压成一个半角空格。
			if !previousSpace {
				builder.WriteRune(' ')
			}
			previousSpace = true
		case unicode.IsControl(char):
			// 其余控制字符直接丢弃，不进文件名。
		default:
			builder.WriteRune(char)
			previousSpace = false
		}
	}
	basename = strings.Trim(builder.String(), " .-")
	if runes := []rune(basename); len(runes) > maxArtifactBasenameRunes {
		basename = strings.Trim(string(runes[:maxArtifactBasenameRunes]), " .-")
	}
	if windowsReservedBasenames[strings.ToUpper(basename)] {
		basename = "_" + basename
	}
	if basename == "" {
		return "", ErrDeliverableTitleInvalid
	}
	return basename, nil
}
