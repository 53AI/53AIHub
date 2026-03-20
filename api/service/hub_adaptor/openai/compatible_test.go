package openai

import (
	"testing"

	"github.com/songquanpeng/one-api/relay/channeltype"
)

func TestMiniMaxModelList(t *testing.T) {
	// Verify MiniMaxModelList contains the latest M2.7 models
	expectedModels := map[string]bool{
		"MiniMax-M2.7":           false,
		"MiniMax-M2.7-highspeed": false,
	}

	for _, model := range MiniMaxModelList {
		if _, ok := expectedModels[model]; ok {
			expectedModels[model] = true
		}
	}

	for model, found := range expectedModels {
		if !found {
			t.Errorf("MiniMaxModelList missing required model: %s", model)
		}
	}
}

func TestMiniMaxModelListBackwardCompat(t *testing.T) {
	// Verify legacy abab models are still present for backward compatibility
	legacyModels := []string{"abab6.5-chat", "abab5.5-chat"}
	modelSet := make(map[string]bool)
	for _, m := range MiniMaxModelList {
		modelSet[m] = true
	}

	for _, model := range legacyModels {
		if !modelSet[model] {
			t.Errorf("MiniMaxModelList missing legacy model %s (backward compatibility)", model)
		}
	}
}

func TestGetCompatibleChannelMeta_Minimax(t *testing.T) {
	name, models := GetCompatibleChannelMeta(channeltype.Minimax)

	if name != "minimax" {
		t.Errorf("expected channel name 'minimax', got '%s'", name)
	}

	if len(models) == 0 {
		t.Error("expected non-empty model list for minimax channel")
	}

	// Verify the returned list matches our local override, not the upstream one-api list
	hasM27 := false
	for _, m := range models {
		if m == "MiniMax-M2.7" {
			hasM27 = true
			break
		}
	}
	if !hasM27 {
		t.Error("minimax channel meta should return MiniMax-M2.7 model")
	}
}

func TestGetCompatibleChannelMeta_OtherChannels(t *testing.T) {
	// Verify other channels still return correct metadata
	tests := []struct {
		channelType  int
		expectedName string
	}{
		{channeltype.Azure, "azure"},
		{channeltype.DeepSeek, "deepseek"},
		{channeltype.Groq, "groq"},
	}

	for _, tt := range tests {
		name, models := GetCompatibleChannelMeta(tt.channelType)
		if name != tt.expectedName {
			t.Errorf("channel type %d: expected name '%s', got '%s'", tt.channelType, tt.expectedName, name)
		}
		if len(models) == 0 {
			t.Errorf("channel type %d: expected non-empty model list", tt.channelType)
		}
	}
}

func TestCompatibleChannelsIncludesMinimax(t *testing.T) {
	found := false
	for _, ch := range CompatibleChannels {
		if ch == channeltype.Minimax {
			found = true
			break
		}
	}
	if !found {
		t.Error("CompatibleChannels should include channeltype.Minimax")
	}
}
