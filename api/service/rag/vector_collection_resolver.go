package rag

import "github.com/53AI/53AIHub/model"

const (
	// VectorCollectionModeLibrary 旧模式：读写 library_{uuid}
	VectorCollectionModeLibrary = "library"
	// VectorCollectionModeEnterprise 新模式：读写 doc_eid_{eid}
	VectorCollectionModeEnterprise = "enterprise"
	// VectorCollectionModeDual 按企业配置选择模式：已配置 enterprise 的企业只写 doc_eid_{eid}，未配置的写 library_{uuid}
	VectorCollectionModeDual = "dual"
)

// VectorCollectionResolver 向量集合解析器，封装 collection 名称解析和模式选择
type VectorCollectionResolver struct {
	Mode string
}

func (r VectorCollectionResolver) normalizedMode() string {
	return VectorCollectionModeEnterprise
}

// ResolveDocumentReadCollections 解析读路径的文档向量集合名称列表
// 企业级模式下返回单元素列表 [doc_eid_{eid}]
// library 模式下返回每个 library.UUID 对应的 library_{uuid} 列表
func (r VectorCollectionResolver) ResolveDocumentReadCollections(eid int64, libraries []model.Library) []string {
	if r.normalizedMode() == VectorCollectionModeEnterprise {
		return []string{model.GetDocumentVectorCollectionName(eid)}
	}
	collections := make([]string, 0, len(libraries))
	for _, library := range libraries {
		if library.UUID == "" {
			continue
		}
		collections = append(collections, model.GetVectorCollectionName(library.UUID))
	}
	return collections
}

// ResolveDocumentWriteCollections 解析写路径的文档向量集合名称列表
// enterprise：写入 doc_eid_{eid}
// dual：按企业配置分别决定，已配置 enterprise 的企业只写 doc_eid_{eid}，未配置的写 library_{uuid}
// library：写入 library_{uuid}
func (r VectorCollectionResolver) ResolveDocumentWriteCollections(eid int64, library model.Library) []string {
	switch r.normalizedMode() {
	case VectorCollectionModeEnterprise:
		return []string{model.GetDocumentVectorCollectionName(eid)}
	case VectorCollectionModeDual:
		if GetEnterpriseVectorReadMode(eid) == VectorCollectionModeEnterprise {
			return []string{model.GetDocumentVectorCollectionName(eid)}
		}
		return []string{model.GetVectorCollectionName(library.UUID)}
	default:
		return []string{model.GetVectorCollectionName(library.UUID)}
	}
}
