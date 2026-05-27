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
