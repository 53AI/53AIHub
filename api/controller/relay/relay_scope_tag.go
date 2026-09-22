package relay

import (
	"context"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
)

// KnowledgeScopeSignals 本次对话开启的查询范围信号（由调用方从请求与检索结果归一化）。
// 依据原则「对话开启了什么查询范围就对应什么筛选」：
// web/wiki/知识库 以请求级有效开关为准；图谱以实际命中来源为准（图谱默认开关可能开启，
// 若按开关打标会令「知识文档」与「知识文档+知识图谱」无法区分）。
type KnowledgeScopeSignals struct {
	WebEnabled   bool // 联网搜索有效开启
	KBAll        bool // knowledge_base_ids 含 all/-1（全部知识库）
	KBSpecific   bool // 指定了具体空间/知识库/文件范围
	SoloFile     bool // 单文件模式
	WikiAll      bool // 动态知识有效开启且未指定页面
	WikiSpecific bool // 动态知识有效开启且指定了页面
	GraphHit     bool // 图谱聚合结果实际进入 sources
}

// ComputeKnowledgeScopeTag 按「对话开启的查询范围组合」判定知识类型，与消息列表筛选互斥对应。
func ComputeKnowledgeScopeTag(s KnowledgeScopeSignals) int {
	if !s.WebEnabled && !s.KBAll && !s.KBSpecific && !s.SoloFile && !s.WikiAll && !s.WikiSpecific && !s.GraphHit {
		return model.KnowledgeTypeNone
	}
	if s.SoloFile {
		return model.KnowledgeTypeSingleFile
	}
	if s.WebEnabled && !s.KBAll && !s.KBSpecific && !s.WikiAll && !s.WikiSpecific {
		return model.KnowledgeTypeWeb
	}
	switch {
	case s.KBAll && s.WikiAll && s.GraphHit && !s.WebEnabled:
		return model.KnowledgeTypeKBDynamicGraph
	case s.KBAll && s.GraphHit && !s.WikiAll && !s.WikiSpecific && !s.WebEnabled:
		return model.KnowledgeTypeKBGraph
	case s.KBAll && s.WikiAll && !s.GraphHit && !s.WebEnabled:
		return model.KnowledgeTypeKBDynamic
	case s.KBAll && !s.WikiAll && !s.WikiSpecific && !s.GraphHit && !s.WebEnabled:
		return model.KnowledgeTypeDatabase
	case s.WikiAll && !s.KBAll && !s.KBSpecific && !s.WebEnabled:
		return model.KnowledgeTypeAllWiki
	case s.WikiSpecific && !s.KBAll && !s.KBSpecific && !s.WebEnabled:
		return model.KnowledgeTypeSpecificWiki
	case s.KBSpecific && !s.WikiAll && !s.WikiSpecific && !s.GraphHit && !s.WebEnabled:
		return model.KnowledgeTypeSpecificKB
	default:
		return model.KnowledgeTypeOther
	}
}

// buildScopeSignals 从请求配置与最终检索来源归一化查询范围信号。
func buildScopeSignals(ctx context.Context, cr *ChatRequest, agent *model.Agent, sources []rag.SourceReference) KnowledgeScopeSignals {
	signals := KnowledgeScopeSignals{WebEnabled: cr.DatasetIsWebSearch(), SoloFile: cr.DatasetIsSoloFile()}
	for _, id := range cr.KnowledgeBaseIDs {
		if id == "all" || id == "-1" {
			signals.KBAll = true
			break
		}
	}
	signals.KBSpecific = (len(cr.KnowledgeBaseIDs) > 0 && !signals.KBAll) || len(cr.SpaceIDs) > 0 || len(cr.FileIDs) > 0

	if cr.DatasetIsSoloWiki() {
		signals.WikiSpecific = true
	} else if shouldRunWikiSearch(ctx, cr, agent) {
		if len(cr.WikiSearchConfig.WikiPageIDs) > 0 {
			signals.WikiSpecific = true
		} else {
			signals.WikiAll = true
		}
	}
	for _, source := range sources {
		if source.ChunkType == rag.GraphAggregateChunkType {
			signals.GraphHit = true
			break
		}
	}
	return signals
}
