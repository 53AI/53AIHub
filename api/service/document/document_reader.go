package document

import (
	"io"
)

// DocumentReader 文档读取器接口
type DocumentReader interface {
	Read(reader io.Reader) ([]byte, error)
}

// DefaultDocumentReader 默认文档读取器
type DefaultDocumentReader struct{}

// Read 读取文档内容
func (dr *DefaultDocumentReader) Read(reader io.Reader) ([]byte, error) {
	return io.ReadAll(reader)
}

// NewDocumentReader 创建文档读取器
func NewDocumentReader() DocumentReader {
	return &DefaultDocumentReader{}
}
