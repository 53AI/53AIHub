package common

import "fmt"

// GetPermissionCacheKey 生成权限缓存 Key
// Key 格式: Cache:permission:user:{userID}:resource:{eid}:{resourceType}:{resourceID}
func GetPermissionCacheKey(eid int64, resourceType int, resourceID int64, userID int64) string {
	return fmt.Sprintf("Cache:permission:user:%d:resource:%d:%d:%d", userID, eid, resourceType, resourceID)
}

// GetProductCacheKey 生成产品缓存键
// 参数:
//
//	productVersion - 产品版本号
//
// 返回值:
//
//	string - 格式化后的缓存键字符串 "Cache:product:version:{productVersion}"
func GetProductCacheKey(productVersion int) string {
	return fmt.Sprintf("Cache:product:version:%d", productVersion)
}

// GetProductCacheKeyForEid 生成基于eid的产品版本缓存键
// 参数:
//
//	eid: 企业ID，用于构建企业的缓存键
//
// 返回值:
//
//	string: 格式化的缓存键字符串 "Cache:product:eid:{eid}:version"
func GetProductCacheKeyForEid(eid int64) string {
	return fmt.Sprintf("Cache:product:eid:%d:version", eid)
}

// GetFeatureOverridesCacheKey 生成特征覆盖缓存的键名
// 该函数根据企业ID生成唯一的缓存键，用于存储和检索特征覆盖配置
//
// 参数:
//
//	eid - 企业ID，用于区分不同企业的特征覆盖配置
//
// 返回值:
//
//	string - 格式化的缓存键字符串 "Cache:feature:overrides:eid:{eid}"
func GetFeatureOverridesCacheKey(eid int64) string {
	return fmt.Sprintf("Cache:feature:overrides:eid:%d", eid)
}

func GetSaasDomainToEidCacheKey(host string) string {
	return fmt.Sprintf("Cache:53AIHub:Saas:DomainToEid:%s", host)
}

// GetLibraryFileCountCacheKey 生成知识库未删除文件数缓存 Key
// Key 格式: Cache:library:file_count:eid:{eid}:library:{libraryID}
func GetLibraryFileCountCacheKey(eid int64, libraryID int64) string {
	return fmt.Sprintf("Cache:library:file_count:eid:%d:library:%d", eid, libraryID)
}

// GetLibraryCacheVersionKey 生成知识库快照版本缓存 Key
// Key 格式: Cache:library:eid:{eid}:version
func GetLibraryCacheVersionKey(eid int64) string {
	return fmt.Sprintf("Cache:library:eid:%d:version", eid)
}

// GetLibrarySnapshotCacheKey 生成知识库快照缓存 Key
// Key 格式: Cache:library:eid:{eid}:snapshot:v{version}
func GetLibrarySnapshotCacheKey(eid int64, version int64) string {
	return fmt.Sprintf("Cache:library:eid:%d:snapshot:v%d", eid, version)
}

// GetDocumentChunkEnrichmentCacheKey 生成文档分块 AI 增强缓存键。
// Key 格式: Cache:rag:document_chunk:enrichment:eid:{eid}:file:{fileID}:hash:{contentHash}:config:{configVersion}:prompt:{promptVersion}
func GetDocumentChunkEnrichmentCacheKey(eid int64, fileID int64, contentHash string, configVersion string, promptVersion string) string {
	return fmt.Sprintf("Cache:rag:document_chunk:enrichment:eid:%d:file:%d:hash:%s:config:%s:prompt:%s",
		eid, fileID, contentHash, configVersion, promptVersion)
}

// GetInternalUserListCacheKey 生成内部用户列表缓存 Key
// Key 格式: Cache:user:internal:list:eid:{eid}:keyword:{keyword}:status:{status}:offset:{offset}:limit:{limit}:did:{did}:from:{from}:not_bind:{notBind}
func GetInternalUserListCacheKey(eid int64, keyword string, status, offset, limit int, did int64, from int, notBind int) string {
	return fmt.Sprintf("Cache:user:internal:list:eid:%d:keyword:%s:status:%d:offset:%d:limit:%d:did:%d:from:%d:not_bind:%d",
		eid, keyword, status, offset, limit, did, from, notBind)
}

// GetInternalUserListCachePattern returns the wildcard pattern for internal user list cache invalidation.
func GetInternalUserListCachePattern(eid int64) string {
	return fmt.Sprintf("Cache:user:internal:list:eid:%d:*", eid)
}

// GetUserMemoryCacheKey 生成用户记忆缓存 Key
// Key 格式: Cache:user:memory:eid:{eid}:user:{userID}
func GetUserMemoryCacheKey(eid, userID int64) string {
	return fmt.Sprintf("Cache:user:memory:eid:%d:user:%d", eid, userID)
}

// GetUserMemoryCachePattern 生成用户记忆缓存批量失效模式
// Pattern 格式: Cache:user:memory:eid:{eid}:*
func GetUserMemoryCachePattern(eid int64) string {
	return fmt.Sprintf("Cache:user:memory:eid:%d:*", eid)
}

// GetOpenClawProjectionMutexKey 生成 OpenClaw 投影写入分布式锁 Key。
// Key 格式: Lock:openclaw:projection:mu:eid:{eid}:conv:{conversationID}
func GetOpenClawProjectionMutexKey(eid int64, conversationID string) string {
	return fmt.Sprintf("Lock:openclaw:projection:mu:eid:%d:conv:%s", eid, conversationID)
}

// GetOpenClawProjectionSyncedCacheKey 生成 OpenClaw 投影已同步缓存 Key。
// 用于防止在 TTL 内重复写入同一投影记录。
// Key 格式: Cache:openclaw:projection:synced:eid:{eid}:agent:{agentID}:user:{userID}:conv:{conversationID}:key:{projectionKey}
func GetOpenClawProjectionSyncedCacheKey(eid int64, agentID int64, userID int64, conversationID string, projectionKey string) string {
	return fmt.Sprintf("Cache:openclaw:projection:synced:eid:%d:agent:%d:user:%d:conv:%s:key:%s",
		eid, agentID, userID, conversationID, projectionKey)
}

// GetParserHealthCacheKey 生成企业解析器健康检查缓存 Key。
// Key 格式: Cache:docconv:health:eid:{eid}:fp:{fingerprint}
// fingerprint 为配置内容的 SHA-256 摘要，不包含明文凭证。
func GetParserHealthCacheKey(eid int64, fingerprint string) string {
	return fmt.Sprintf("Cache:docconv:health:eid:%d:fp:%s", eid, fingerprint)
}
