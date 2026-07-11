package rag

import "github.com/53AI/53AIHub/model"

func vectorEmbeddingChanged(oldCfg, newCfg *model.ModelConfigData) bool {
	if oldCfg == nil || newCfg == nil {
		return false
	}

	oldEmbedding := oldCfg.VectorEmbedding
	newEmbedding := newCfg.VectorEmbedding

	if !int64PtrEqual(oldEmbedding.ChannelID, newEmbedding.ChannelID) {
		return true
	}
	if !stringPtrEqual(oldEmbedding.ModelName, newEmbedding.ModelName) {
		return true
	}

	return false
}

// VectorEmbeddingChanged 导出的包装，供 controller 层复用
func VectorEmbeddingChanged(oldCfg, newCfg *model.ModelConfigData) bool {
	return vectorEmbeddingChanged(oldCfg, newCfg)
}

func int64PtrEqual(a, b *int64) bool {
	switch {
	case a == nil && b == nil:
		return true
	case a == nil || b == nil:
		return false
	default:
		return *a == *b
	}
}

func stringPtrEqual(a, b *string) bool {
	switch {
	case a == nil && b == nil:
		return true
	case a == nil || b == nil:
		return false
	default:
		return *a == *b
	}
}
