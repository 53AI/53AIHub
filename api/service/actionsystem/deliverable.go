package actionsystem

import (
	"path"
	"strings"
)

// V1.1 只承诺一个主业务交付物，但格式不再固定 DOCX：DOCX / XLSX / PPTX 都由
// executor 直接生成真实 OOXML 文件。机会发现（LLM）可能提出 CSV、ZIP 成果包或
// 多文件交付，这些仍然不受支持，不得进入用户可见的方案承诺。
var unsupportedDeliverableKeywords = []string{
	"csv", "压缩包", "多个文件", "多份文件", "附件包", "多文件", "zip", "markdown", "html",
}

// 显式格式词优先于业务关键词：出现 docx/xlsx/pptx 等词时直接决定格式。
var explicitFormatKeywords = []struct {
	keyword string
	format  DeliverableFormat
}{
	{"pptx", FormatPPTX}, {"ppt", FormatPPTX}, {"slides", FormatPPTX}, {"deck", FormatPPTX},
	{"xlsx", FormatXLSX}, {"xls", FormatXLSX}, {"excel", FormatXLSX}, {"sheet", FormatXLSX},
	{"docx", FormatDOCX}, {"word", FormatDOCX}, {"doc", FormatDOCX},
}

// 业务关键词的默认映射（§6 default_mapping）；无法判断时回落到 DOCX。
var deliverableFormatKeywords = []struct {
	keywords []string
	format   DeliverableFormat
}{
	{[]string{"方案", "sop", "分析报告", "调研报告", "制度", "文档"}, FormatDOCX},
	{[]string{"数据表", "台账", "跟踪表", "测算表", "分析表", "统计表", "明细表", "数据整理", "清单", "表格"}, FormatXLSX},
	{[]string{"汇报", "演示", "路演", "课件"}, FormatPPTX},
}

// trailingFormatTokens 是可以从业务标题尾部剥掉的纯格式词，剥掉后文件名才是
// 用户语言里的交付物名字（"经营汇报 PPTX" → "经营汇报"）。
var trailingFormatTokens = []string{"pptx", "ppt", "xlsx", "xls", "excel", "docx", "word", "doc", "演示文稿", "数据表", "表格文件"}

// DefaultDeliverableFormat 兼容没有显式 format 的旧 Plan（V1.1 之前只有 DOCX）。
const DefaultDeliverableFormat = FormatDOCX

// SupportedDeliverableFormats 是 Host 能校验、归档并预览的格式集合。
func SupportedDeliverableFormats() []DeliverableFormat {
	return []DeliverableFormat{FormatDOCX, FormatXLSX, FormatPPTX}
}

// ParseDeliverableFormat 解析持久化值或请求里的格式字符串。空值按旧契约回落到
// DOCX；其余未知值返回 false，由 Plan validation 报 unsupported_artifact_format。
func ParseDeliverableFormat(value string) (DeliverableFormat, bool) {
	format := DeliverableFormat(strings.ToLower(strings.TrimSpace(value)))
	switch format {
	case "":
		return DefaultDeliverableFormat, true
	case FormatDOCX, FormatXLSX, FormatPPTX:
		return format, true
	default:
		return "", false
	}
}

// FormatForExtension 按扩展名分辨受支持的 OOXML 格式（含点号，大小写不敏感）。
func FormatForExtension(extension string) (DeliverableFormat, bool) {
	lower := strings.ToLower(strings.TrimSpace(extension))
	for _, format := range SupportedDeliverableFormats() {
		if lower == format.Extension() {
			return format, true
		}
	}
	return "", false
}

// Extension 是 format 唯一决定的文件名扩展名。
func (f DeliverableFormat) Extension() string {
	switch f {
	case FormatDOCX, FormatXLSX, FormatPPTX:
		return "." + string(f)
	default:
		return ""
	}
}

// MimeType 是 Host 写入 Artifact 的正式 MIME，不采用 executor 的声明。
func (f DeliverableFormat) MimeType() string {
	switch f {
	case FormatXLSX:
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case FormatPPTX:
		return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	case FormatDOCX:
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	default:
		return "application/octet-stream"
	}
}

// PrimaryDeliverable 选出唯一主交付物：显式 is_primary 优先，旧方案（没有
// is_primary）按数组顺序回落到第一个 deliverable。
func PrimaryDeliverable(deliverables []Deliverable) (Deliverable, error) {
	var primary Deliverable
	found := false
	for _, item := range deliverables {
		if !item.IsPrimary {
			continue
		}
		if found {
			return Deliverable{}, ErrDeliverableAmbiguous
		}
		primary, found = item, true
	}
	if !found {
		for _, item := range deliverables {
			if strings.TrimSpace(item.Title) == "" {
				continue
			}
			primary, found = item, true
			break
		}
	}
	if !found {
		return Deliverable{}, ErrDeliverableMissing
	}
	primary.IsPrimary = true
	primary.Title = strings.TrimSpace(primary.Title)
	format, ok := ParseDeliverableFormat(string(primary.Format))
	if !ok {
		return Deliverable{}, ErrDeliverableFormatUnsupported
	}
	primary.Format = format
	return primary, nil
}

func deliverableSupported(title string) bool {
	lower := strings.ToLower(strings.TrimSpace(title))
	if lower == "" {
		return false
	}
	for _, keyword := range unsupportedDeliverableKeywords {
		if strings.Contains(lower, keyword) {
			return false
		}
	}
	return true
}

// deliverableFormatFor 按标题选择格式（§6 default_mapping）。它不从文件名后缀
// 反推：扩展名由 format 决定，而不是反过来。
func deliverableFormatFor(title string) DeliverableFormat {
	lower := strings.ToLower(strings.TrimSpace(title))
	for _, item := range explicitFormatKeywords {
		if strings.Contains(lower, item.keyword) {
			return item.format
		}
	}
	for _, item := range deliverableFormatKeywords {
		for _, keyword := range item.keywords {
			if strings.Contains(lower, keyword) {
				return item.format
			}
		}
	}
	return DefaultDeliverableFormat
}

// deliverableTitleWithoutFormatWords 把标题尾部的格式词剥掉，避免出现
// "经营汇报 PPTX.pptx" 这种把格式说两遍的文件名。
func deliverableTitleWithoutFormatWords(title string) string {
	cleaned := strings.TrimSpace(title)
	for {
		trimmed := stripTrailingFormatWords(cleaned)
		if trimmed == "" || trimmed == cleaned {
			return cleaned
		}
		cleaned = trimmed
	}
}

func stripTrailingFormatWords(title string) string {
	trimmed := strings.TrimSpace(title)
	for {
		lower := strings.ToLower(trimmed)
		stripped := ""
		if extension := path.Ext(trimmed); extension != "" {
			if _, ok := FormatForExtension(extension); ok {
				stripped = strings.TrimSpace(trimmed[:len(trimmed)-len(extension)])
			}
		}
		if stripped == "" {
			for _, token := range trailingFormatTokens {
				if strings.HasSuffix(lower, token) {
					stripped = strings.TrimSpace(trimmed[:len(trimmed)-len(token)])
					break
				}
			}
		}
		if stripped == "" || stripped == trimmed {
			return trimmed
		}
		trimmed = stripped
	}
}

// primaryDeliverable 把机会提出的交付物收敛成 V1.1 真正产出的那一个主交付物：
// 标题与格式一起确定，多文件/CSV 之类的承诺仍然不进入用户可见方案。
func primaryDeliverable(opportunity ActionOpportunity) []Deliverable {
	for _, item := range opportunity.Deliverables {
		title := strings.TrimSpace(item.Title)
		if !deliverableSupported(title) {
			continue
		}
		return []Deliverable{newPrimaryDeliverable(title)}
	}
	title := strings.TrimSpace(opportunity.Objective)
	if title == "" {
		title = "行动成果文档"
	}
	return []Deliverable{newPrimaryDeliverable(title)}
}

func newPrimaryDeliverable(title string) Deliverable {
	cleaned := deliverableTitleWithoutFormatWords(title)
	if cleaned == "" {
		cleaned = strings.TrimSpace(title)
	}
	return Deliverable{
		Type:      CapabilityDocumentGeneration,
		Title:     cleaned,
		Format:    deliverableFormatFor(title),
		IsPrimary: true,
	}
}
