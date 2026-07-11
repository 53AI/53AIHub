package steps

import (
	"encoding/json"

	"github.com/53AI/53AIHub/model"
)

// extractEidAndFileID 从 job.StartParameters 安全提取 eid 和 fileID
// 当 StartParameters 为空或格式错误时返回 (0, 0)，调用方的断点检查会判定为"未完成"并触发重做
func extractEidAndFileID(job *model.RagJob) (int64, int64) {
	var params map[string]interface{}
	json.Unmarshal([]byte(job.StartParameters), &params)

	eid := safeToInt64(params["eid"])
	fileID := safeToInt64(params["file_id"])
	return eid, fileID
}

// safeToInt64 安全地将 interface{} 转换为 int64，支持 float64/int64/int/json.Number 类型
func safeToInt64(v interface{}) int64 {
	if v == nil {
		return 0
	}
	switch val := v.(type) {
	case float64:
		return int64(val)
	case int64:
		return val
	case int:
		return int64(val)
	case json.Number:
		n, _ := val.Int64()
		return n
	default:
		return 0
	}
}
