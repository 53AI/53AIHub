package document

import (
	"fmt"
	"strings"

	htmltomarkdown "github.com/JohannesKaufmann/html-to-markdown/v2"
)

// ConverterService HTML转Markdown服务
type ConverterService struct{}

// NewConverterService 创建新的转换服务
func NewConverterService() *ConverterService {
	return &ConverterService{}
}

// ConvertHTMLToMarkdown 将HTML转换为Markdown
func (cs *ConverterService) ConvertHTMLToMarkdown(html string) (string, error) {
	if strings.TrimSpace(html) == "" {
		return "", fmt.Errorf("HTML内容不能为空")
	}
	
	// 直接使用包提供的ConvertString函数
	markdown, err := htmltomarkdown.ConvertString(html)
	if err != nil {
		return "", fmt.Errorf("转换失败: %w", err)
	}
	return markdown, nil
}

// ConvertTextToMarkdown 将纯文本转换为Markdown
func (cs *ConverterService) ConvertTextToMarkdown(text string) (string, error) {
	if strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("文本内容不能为空")
	}
	
	// 简单的文本到Markdown转换
	// 保留换行，但不做其他特殊处理
	// 可以根据需要增加更复杂的转换逻辑
	markdown := text
	
	return markdown, nil
}

// ValidateHTML 验证HTML内容
func (cs *ConverterService) ValidateHTML(html string) error {
	if strings.TrimSpace(html) == "" {
		return fmt.Errorf("HTML内容不能为空")
	}
	return nil
}