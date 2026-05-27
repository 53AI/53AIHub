package common

import (
	"errors"
	"fmt"
	"strconv"
	"time"
)

func SetFileStop(fileID int64) error {
	return RedisSet("rag-pipeline:signal:file:"+strconv.FormatInt(fileID, 10), "stop", 86400*time.Second)
}

func DeleteFileStopCache(fileID int64) error {
	return RedisDel("rag-pipeline:signal:file:" + strconv.FormatInt(fileID, 10))
}

func SetLibraryStop(libraryID int64) error {
	return RedisSet("rag-pipeline:signal:library:"+strconv.FormatInt(libraryID, 10), "stop", 86400*time.Second)
}

func CheckFileStop(fileID int64) (bool, error) {
	val, err := RedisGet("rag-pipeline:signal:file:" + strconv.FormatInt(fileID, 10))
	if err != nil {
		// 如果 key 不存在（redis.Nil），这是正常情况，表示没有停止信号
		if errors.Is(err, ErrRedisNil) {
			return false, nil
		}
		// 其他错误（如连接失败）需要传播
		return false, err
	}
	return val == "stop", nil
}
func CheckLibraryStop(libraryID int64) (bool, error) {
	val, err := RedisGet("rag-pipeline:signal:library:" + strconv.FormatInt(libraryID, 10))
	if err != nil {
		// 如果 key 不存在（redis.Nil），这是正常情况，表示没有停止信号
		if errors.Is(err, ErrRedisNil) {
			return false, nil
		}
		// 其他错误（如连接失败）需要传播
		return false, err
	}
	return val == "stop", nil
}

// CheckRagTaskStop 检查知识库或文件是否发出停止信号
func CheckRagTaskStop(libraryID int64, fileID int64) error {
	if libraryID > 0 {
		stop, err := CheckLibraryStop(libraryID)
		if err != nil {
			return err
		}
		if stop {
			return fmt.Errorf("知识库 %d 已被删除，任务自动取消", libraryID)
		}
	}

	if fileID > 0 {
		stop, err := CheckFileStop(fileID)
		if err != nil {
			return err
		}
		if stop {
			return fmt.Errorf("文件 %d 删除，任务自动取消", fileID)
		}
	}
	return nil
}
