package service

import (
	"encoding/binary"
	"io"
	"os"
)

// recordingWAVChunk 解析后的 WAV 结构信息。
type recordingWAVChunk struct {
	formatBlock []byte // 首个 "fmt " 子块（含 id + size + payload），用于重建头部
	dataPayload []byte // "data" 子块的数据区
}

// parseRecordingWAVChunk 解析一段 WAV 字节。
// 合法判定：以 "RIFF"/"WAVE" 开头且同时含 "fmt " 与 "data" 子块。
func parseRecordingWAVChunk(b []byte) (recordingWAVChunk, bool) {
	if len(b) < 12 || string(b[0:4]) != "RIFF" || string(b[8:12]) != "WAVE" {
		return recordingWAVChunk{}, false
	}
	riffSize := int(binary.LittleEndian.Uint32(b[4:8]))
	limit := 8 + riffSize
	if limit > len(b) {
		limit = len(b)
	}
	var (
		formatBlock []byte
		dataPayload []byte
	)
	off := 12
	for off+8 <= limit {
		chunkID := string(b[off : off+4])
		chunkSize := int(binary.LittleEndian.Uint32(b[off+4 : off+8]))
		payloadStart := off + 8
		payloadEnd := payloadStart + chunkSize
		if payloadEnd > limit {
			payloadEnd = limit
		}
		switch chunkID {
		case "fmt ":
			formatBlock = b[off:payloadEnd]
		case "data":
			dataPayload = b[payloadStart:payloadEnd]
		}
		off = payloadStart + chunkSize + (chunkSize & 1)
	}
	if formatBlock == nil || dataPayload == nil {
		return recordingWAVChunk{}, false
	}
	return recordingWAVChunk{formatBlock: formatBlock, dataPayload: dataPayload}, true
}

// mergeRecordingAudioParts 将多段音频字节合并为单段：
// 全部为合法 WAV 时做 WAV 感知合并（保留首段 fmt 块、拼接全部 data、重写大小字段），
// 否则退回裸字节拼接（保持历史行为）。单段时原样返回。
func mergeRecordingAudioParts(parts ...[]byte) []byte {
	nonEmpty := make([][]byte, 0, len(parts))
	for _, p := range parts {
		if len(p) > 0 {
			nonEmpty = append(nonEmpty, p)
		}
	}
	if len(nonEmpty) == 0 {
		return nil
	}
	if len(nonEmpty) == 1 {
		return nonEmpty[0]
	}
	parsed := make([]recordingWAVChunk, 0, len(nonEmpty))
	for _, p := range nonEmpty {
		wc, ok := parseRecordingWAVChunk(p)
		if !ok {
			return concatRecordingAudioPartsRaw(nonEmpty)
		}
		parsed = append(parsed, wc)
	}
	return buildRecordingMergedWAV(parsed)
}

func concatRecordingAudioPartsRaw(parts [][]byte) []byte {
	var total int
	for _, p := range parts {
		total += len(p)
	}
	out := make([]byte, 0, total)
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

// buildRecordingMergedWAV 由多段解析后的 WAV 重建单个合法 WAV。
func buildRecordingMergedWAV(parsed []recordingWAVChunk) []byte {
	var dataSize int
	for _, wc := range parsed {
		dataSize += len(wc.dataPayload)
	}
	header := parsed[0].formatBlock
	total := 12 + len(header) + 8 + dataSize
	out := make([]byte, 0, total)
	out = append(out, []byte("RIFF")...)
	out = append(out, u32leBytes(uint32(total-8))...)
	out = append(out, []byte("WAVE")...)
	out = append(out, header...)
	out = append(out, []byte("data")...)
	out = append(out, u32leBytes(uint32(dataSize))...)
	for _, wc := range parsed {
		out = append(out, wc.dataPayload...)
	}
	return out
}

func u32leBytes(v uint32) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, v)
	return b
}

// readRecordingWAVFileInfo 从打开的音频文件读取 WAV 结构定位信息。
// 返回 data 子块头的文件偏移与 data 数据区大小。
func readRecordingWAVFileInfo(f *os.File) (dataChunkOffset int64, dataSize uint32, ok bool) {
	var head [12]byte
	if _, err := f.ReadAt(head[:], 0); err != nil {
		return 0, 0, false
	}
	if string(head[0:4]) != "RIFF" || string(head[8:12]) != "WAVE" {
		return 0, 0, false
	}
	limit := int64(8) + int64(binary.LittleEndian.Uint32(head[4:8]))
	if info, err := f.Stat(); err == nil && limit > info.Size() {
		limit = info.Size()
	}
	off := int64(12)
	for off+8 <= limit {
		var chunkHead [8]byte
		if _, err := f.ReadAt(chunkHead[:], off); err != nil {
			return 0, 0, false
		}
		chunkSize := int64(binary.LittleEndian.Uint32(chunkHead[4:8]))
		payloadStart := off + 8
		if payloadStart+chunkSize > limit {
			return 0, 0, false
		}
		if string(chunkHead[0:4]) == "data" {
			return off, uint32(chunkSize), true
		}
		off = payloadStart + chunkSize + (chunkSize & 1)
	}
	return 0, 0, false
}

// appendRecordingWAVFile 把 content 以 WAV 感知方式追加到缓冲文件：
// 文件头与 content 均为合法 WAV 时，只拼接 data 数据并修正 data/RIFF 大小字段；
// 否则退回裸追加。返回是否发生了 WAV 感知合并。
func appendRecordingWAVFile(f *os.File, content []byte) (bool, error) {
	wc, ok := parseRecordingWAVChunk(content)
	if !ok {
		return false, nil
	}
	dataOff, dataSize, ok := readRecordingWAVFileInfo(f)
	if !ok {
		return false, nil
	}
	if info, err := f.Stat(); err != nil {
		return false, err
	} else if info.Size() > dataOff+8+int64(dataSize)+(int64(dataSize)&1) {
		// data 不是最后一个子块（混合格式/尾部有垃圾），原地合并不安全，退回裸追加
		return false, nil
	}
	newDataSize := dataSize + uint32(len(wc.dataPayload))
	if _, err := f.Seek(0, io.SeekEnd); err != nil {
		return false, err
	}
	if _, err := f.Write(wc.dataPayload); err != nil {
		return false, err
	}
	// 修正 data 块大小字段（data 子块头偏移 + 4）
	if _, err := f.WriteAt(u32leBytes(newDataSize), dataOff+4); err != nil {
		return false, err
	}
	// 修正 RIFF 大小字段（offset 4）：新 RIFF 大小 = data 子块头偏移 + 新 data 大小
	if _, err := f.WriteAt(u32leBytes(uint32(dataOff)+newDataSize), 4); err != nil {
		return false, err
	}
	return true, nil
}
