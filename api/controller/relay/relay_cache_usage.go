package relay

import (
	"bytes"
	"io"
	"strings"

	chatdebug "github.com/53AI/53AIHub/service/chat_debug"
)

type cacheUsageCaptureReader struct {
	io.ReadCloser
	pending      []byte
	usage        *chatdebug.CacheUsage
	usagePayload string
	bytesRead    int
	dataLines    int
}

func (r *cacheUsageCaptureReader) Read(buffer []byte) (int, error) {
	n, err := r.ReadCloser.Read(buffer)
	if n > 0 {
		r.bytesRead += n
		r.pending = append(r.pending, buffer[:n]...)
		r.readLines(false)
	}
	if err == io.EOF {
		r.readLines(true)
	}
	return n, err
}

func (r *cacheUsageCaptureReader) readLines(final bool) {
	for {
		index := bytes.IndexByte(r.pending, '\n')
		if index < 0 {
			if final && len(r.pending) > 0 {
				r.readLine(r.pending)
				r.pending = nil
			}
			return
		}
		r.readLine(r.pending[:index])
		r.pending = r.pending[index+1:]
	}
}

func (r *cacheUsageCaptureReader) readLine(line []byte) {
	line = bytes.TrimSpace(line)
	if !bytes.HasPrefix(line, []byte("data:")) {
		return
	}
	r.dataLines++
	response := []byte(strings.TrimSpace(string(line[len("data:"):])))
	rawUsage := chatdebug.ExtractCacheUsagePayload(response)
	if rawUsage != "" {
		r.usagePayload = rawUsage
	}
	usage := chatdebug.ParseCacheUsage(response)
	if usage != nil {
		r.usage = usage
	}
}

func (r *cacheUsageCaptureReader) Usage() *chatdebug.CacheUsage {
	return r.usage
}

func (r *cacheUsageCaptureReader) UsagePayload() string {
	return r.usagePayload
}

func (r *cacheUsageCaptureReader) ReadStats() (int, int) {
	return r.bytesRead, r.dataLines
}
