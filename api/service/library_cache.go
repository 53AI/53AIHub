package service

import (
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

const librarySnapshotCacheTTLSeconds int64 = 24 * 60 * 60

var librarySnapshotCacheInvalidatorOnce sync.Once

// InitLibraryCacheInvalidator wires the model-level library cache invalidation hook.
func InitLibraryCacheInvalidator() {
	librarySnapshotCacheInvalidatorOnce.Do(func() {
		model.SetLibraryCacheInvalidator(invalidateLibrarySnapshotCache)
		model.SetLibraryCacheLoader(loadLibrariesSnapshotWithCache)
	})
}

func loadLibrariesSnapshotWithCache(eid int64) ([]model.Library, error) {
	if eid <= 0 {
		return []model.Library{}, nil
	}
	if !common.RedisEnabled || common.RDB == nil {
		return model.GetLibrariesByEidFromDB(eid)
	}

	libraries, ok, err := readLibrariesSnapshotFromCache(eid)
	if err != nil {
		if !errors.Is(err, common.ErrRedisNotEnabled) {
			logger.SysWarnf("【知识库】读取知识库快照缓存失败，回退DB: eid=%d, err=%v", eid, err)
		}
	} else if ok {
		return libraries, nil
	}

	libraries, err = model.GetLibrariesByEidFromDB(eid)
	if err != nil {
		return nil, err
	}
	if cacheErr := storeLibrariesSnapshotInCache(eid, libraries); cacheErr != nil &&
		!errors.Is(cacheErr, common.ErrRedisNotEnabled) {
		logger.SysWarnf("【知识库】写入知识库快照缓存失败: eid=%d, count=%d, err=%v", eid, len(libraries), cacheErr)
	}
	return libraries, nil
}

func invalidateLibrarySnapshotCache(eid int64) {
	if eid <= 0 || !common.RedisEnabled {
		return
	}

	versionKey := common.GetLibraryCacheVersionKey(eid)
	version := time.Now().UTC().UnixNano()
	if err := common.RedisSetInt64(versionKey, version, librarySnapshotCacheTTLSeconds); err != nil &&
		!errors.Is(err, common.ErrRedisNotEnabled) {
		logger.SysWarnf("【知识库】刷新快照版本失败: eid=%d, err=%v", eid, err)
	}
}

func invalidateLibraryCache(eid int64) {
	invalidateLibrarySnapshotCache(eid)
}

func readLibrariesSnapshotFromCache(eid int64) ([]model.Library, bool, error) {
	versionKey := common.GetLibraryCacheVersionKey(eid)
	version, err := common.RedisGetInt64(versionKey)
	if err != nil {
		if errors.Is(err, common.ErrRedisNil) {
			return nil, false, nil
		}
		return nil, false, err
	}
	if version <= 0 {
		return nil, false, nil
	}

	snapshotKey := common.GetLibrarySnapshotCacheKey(eid, version)
	payload, err := common.RedisGet(snapshotKey)
	if err != nil {
		if errors.Is(err, common.ErrRedisNil) {
			return nil, false, nil
		}
		return nil, false, err
	}
	if payload == "" {
		return nil, false, nil
	}

	var libraries []model.Library
	if err := json.Unmarshal([]byte(payload), &libraries); err != nil {
		return nil, false, err
	}
	return libraries, true, nil
}

func storeLibrariesSnapshotInCache(eid int64, libraries []model.Library) error {
	if !common.RedisEnabled || common.RDB == nil {
		return common.ErrRedisNotEnabled
	}

	version := time.Now().UTC().UnixNano()
	payload, err := json.Marshal(libraries)
	if err != nil {
		return err
	}
	if err := common.RedisSet(common.GetLibrarySnapshotCacheKey(eid, version), string(payload), time.Duration(librarySnapshotCacheTTLSeconds)*time.Second); err != nil {
		return err
	}
	return common.RedisSetInt64(common.GetLibraryCacheVersionKey(eid), version, librarySnapshotCacheTTLSeconds)
}
