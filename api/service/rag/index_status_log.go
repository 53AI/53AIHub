package rag

import (
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
)

func CheckEmbeddingStepStatusSave(eid int64, fileID int64, logStr string) {
	key := fmt.Sprintf("rag:index:status:%d:%d", eid, fileID)
	// 将状态转换为 JSON 字符串
	// 存储到 redis 中，设置过期时间为 24 小时
	if common.RedisEnabled {
		str, _ := common.RedisGet(key)
		if str == "" {
			str = logStr
		} else {
			str += "\n" + logStr
		}
		_ = common.RedisSet(key, str, 24*time.Hour)
	}
}

func DeleteEmbeddingStepStatus(eid int64, fileId int64) {
	key := fmt.Sprintf("rag:index:status:%d:%d", eid, fileId)
	if common.RedisEnabled {
		_ = common.RedisDel(key)
	}
}
