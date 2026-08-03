package logviewer

import (
	"io"
	"os"
	"strings"
)

const reverseBufSize = 8 * 1024

// ReverseLineReader 从文件末尾向前逐行读取，返回的行按文件中的逆序排列。
// 适用于需要从最新日志开始匹配的场景，避免扫描整文件。
type ReverseLineReader struct {
	f            *os.File
	pos          int64
	buf          []byte
	remain       string
	MaxBytes     int64 // lazy: 最大扫描字节数，0=无限制；超100MB日志且未匹配到关键字时防止长时间阻塞
	scannedBytes int64
}

// NewReverseLineReader 创建一个从文件末尾向前读取的 reader。
func NewReverseLineReader(f *os.File) *ReverseLineReader {
	info, _ := f.Stat()
	return &ReverseLineReader{
		f:   f,
		pos: info.Size(),
		buf: make([]byte, reverseBufSize),
	}
}

// ReadLine 返回文件中的上一行（从末尾向开头遍历）。
// 返回 io.EOF 表示已读完所有行。
func (r *ReverseLineReader) ReadLine() (string, error) {
	for {
		// 从 remain 缓冲区中从右向左提取行
		line := r.extractLine()
		if line != "" {
			return line, nil
		}

		// 没有更多数据可读
		if r.pos <= 0 {
			if r.remain != "" {
				line := r.remain
				r.remain = ""
				return line, nil
			}
			return "", io.EOF
		}

		// 从文件末尾方向读取下一块
		readSize := len(r.buf)
		if r.pos < int64(readSize) {
			readSize = int(r.pos)
		}
		newPos := r.pos - int64(readSize)

		if _, err := r.f.Seek(newPos, io.SeekStart); err != nil {
			return "", err
		}
		n, err := r.f.Read(r.buf[:readSize])
		if n > 0 {
			r.pos = newPos
			r.scannedBytes += int64(n)
			r.remain = string(r.buf[:n]) + r.remain
		}
		if err != nil && err != io.EOF {
			return "", err
		}
		if r.MaxBytes > 0 && r.scannedBytes >= r.MaxBytes {
			// 到达扫描上限时提取一行，设置 pos=0 防止后续继续读文件
			line := r.extractLine()
			r.pos = 0
			if line != "" {
				return line, nil
			}
			if r.remain != "" {
				line := r.remain
				r.remain = ""
				return line, nil
			}
			return "", io.EOF
		}
	}
}

// extractLine 从 remain 缓冲区中提取最右边的一行。跳过空行。
func (r *ReverseLineReader) extractLine() string {
	for {
		idx := strings.LastIndex(r.remain, "\n")
		if idx < 0 {
			return ""
		}
		line := r.remain[idx+1:]
		r.remain = r.remain[:idx]
		if line != "" {
			return line
		}
		// 空行（连续换行或末尾换行），继续向左寻找
	}
}
