package rag

import (
	"os"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

const (
	// EnvDocumentVectorCollectionMode 文档向量 collection 模式
	EnvDocumentVectorCollectionMode = "RAG_DOCUMENT_VECTOR_COLLECTION_MODE"
	// EnvDualReadCompare 双读对比开关（仅 dual 模式下生效）
	EnvDualReadCompare = "RAG_DOCUMENT_VECTOR_DUAL_READ_COMPARE"
	// EnvEnterpriseReadFallback 企业级读路径 fallback
	EnvEnterpriseReadFallback = "RAG_DOCUMENT_VECTOR_ENTERPRISE_READ_FALLBACK"
)

var (
	enterpriseReadModeCache     = make(map[int64]cachedReadMode)
	enterpriseReadModeCacheLock sync.RWMutex
)

type cachedReadMode struct {
	mode      string
	expiresAt time.Time
}

const enterpriseReadModeCacheTTL = 30 * time.Second

// GetVectorCollectionMode 获取当前文档向量 collection 模式。
// 企业级集合是唯一线上模式；保留环境变量读取仅用于兼容旧部署配置，
// 不再允许 library/dual 影响线上读写路径。
func GetVectorCollectionMode() string {
	mode := os.Getenv(EnvDocumentVectorCollectionMode)
	logger.SysLogf("【诊断-向量集合模式】读取环境变量 RAG_DOCUMENT_VECTOR_COLLECTION_MODE=%q", mode)
	return VectorCollectionModeEnterprise
}

// GetEnterpriseVectorReadMode 获取企业级向量读模式
// 全局模式为 dual 时，允许企业通过 enterprise_config 覆盖读模式为 enterprise
// 全局模式本身就是 enterprise 时，直接返回 enterprise
// 其他情况返回空字符串
func GetEnterpriseVectorReadMode(eid int64) string {
	global := GetVectorCollectionMode()
	logger.SysLogf("【诊断-企业级读模式】eid=%d, global_mode=%s", eid, global)

	if global == VectorCollectionModeEnterprise {
		logger.SysLogf("【诊断-企业级读模式】eid=%d, 全局模式=enterprise, 直接返回enterprise", eid)
		return VectorCollectionModeEnterprise
	}
	if global != VectorCollectionModeEnterprise {
		return VectorCollectionModeEnterprise
	}

	enterpriseReadModeCacheLock.RLock()
	if cached, ok := enterpriseReadModeCache[eid]; ok && time.Now().Before(cached.expiresAt) {
		logger.SysLogf("【诊断-企业级读模式】eid=%d, 命中缓存, mode=%s, expires_in=%v", eid, cached.mode, time.Until(cached.expiresAt))
		enterpriseReadModeCacheLock.RUnlock()
		return cached.mode
	}
	enterpriseReadModeCacheLock.RUnlock()

	var cfg model.EnterpriseConfig
	err := model.DB.Where("eid = ? AND type = ?", eid, model.EnterpriseConfigTypeVectorReadMode).First(&cfg).Error
	logger.SysLogf("【诊断-企业级读模式】eid=%d, 查询DB: err=%v, enabled=%v, content=%q, id=%d", eid, err, cfg.Enabled, cfg.Content, cfg.ID)

	mode := VectorCollectionModeLibrary
	if err == nil && cfg.Content != "" {
		trimmed := strings.TrimSpace(cfg.Content)
		logger.SysLogf("【诊断-企业级读模式】eid=%d, content_trimmed=%q, expected=%q", eid, trimmed, VectorCollectionModeEnterprise)
		if trimmed == VectorCollectionModeEnterprise {
			mode = VectorCollectionModeEnterprise
		}
	} else {
		logger.SysLogf("【诊断-企业级读模式】eid=%d, 跳过: err!=nil=%v, content_empty=%v", eid, err != nil, cfg.Content == "")
	}

	enterpriseReadModeCacheLock.Lock()
	enterpriseReadModeCache[eid] = cachedReadMode{mode: mode, expiresAt: time.Now().Add(enterpriseReadModeCacheTTL)}
	enterpriseReadModeCacheLock.Unlock()

	logger.SysLogf("【诊断-企业级读模式】eid=%d, 最终返回 mode=%s, 缓存TTL=%v", eid, mode, enterpriseReadModeCacheTTL)
	return mode
}

// GetDualReadCompare 是否启用双读对比
func GetDualReadCompare() bool {
	return os.Getenv(EnvDualReadCompare) == "true"
}

// GetEnterpriseReadFallback 企业级读路径是否回退到旧模式
// 默认 true（安全优先：企业级 collection 读取失败时回退到 library 模式）
func GetEnterpriseReadFallback() bool {
	return os.Getenv(EnvEnterpriseReadFallback) != "false"
}
