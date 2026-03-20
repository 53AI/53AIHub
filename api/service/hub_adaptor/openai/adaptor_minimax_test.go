package openai

import (
	"testing"

	"github.com/songquanpeng/one-api/relay/channeltype"
	"github.com/songquanpeng/one-api/relay/meta"
)

func TestGetRequestURL_Minimax(t *testing.T) {
	adaptor := &Adaptor{}

	tests := []struct {
		name        string
		baseURL     string
		requestPath string
		model       string
		expected    string
	}{
		{
			name:        "M2.7 model with standard base URL",
			baseURL:     "https://api.minimax.io/v1",
			requestPath: "/v1/chat/completions",
			model:       "MiniMax-M2.7",
			expected:    "https://api.minimax.io/v1/v1/chat/completions",
		},
		{
			name:        "M2.7-highspeed with standard base URL",
			baseURL:     "https://api.minimax.io",
			requestPath: "/v1/chat/completions",
			model:       "MiniMax-M2.7-highspeed",
			expected:    "https://api.minimax.io/v1/chat/completions",
		},
		{
			name:        "Legacy abab model with standard base URL",
			baseURL:     "https://api.minimax.io",
			requestPath: "/v1/chat/completions",
			model:       "abab6.5-chat",
			expected:    "https://api.minimax.io/v1/chat/completions",
		},
		{
			name:        "China base URL",
			baseURL:     "https://api.minimaxi.com",
			requestPath: "/v1/chat/completions",
			model:       "MiniMax-M2.7",
			expected:    "https://api.minimaxi.com/v1/chat/completions",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := &meta.Meta{
				ChannelType:    channeltype.Minimax,
				BaseURL:        tt.baseURL,
				RequestURLPath: tt.requestPath,
				ActualModelName: tt.model,
			}
			adaptor.Init(m)

			url, err := adaptor.GetRequestURL(m)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if url != tt.expected {
				t.Errorf("expected URL %q, got %q", tt.expected, url)
			}
		})
	}
}

func TestGetRequestURL_MinimaxUsesOpenAICompatFormat(t *testing.T) {
	// Verify MiniMax no longer uses the deprecated /v1/text/chatcompletion_v2 endpoint
	adaptor := &Adaptor{}
	m := &meta.Meta{
		ChannelType:    channeltype.Minimax,
		BaseURL:        "https://api.minimax.io",
		RequestURLPath: "/v1/chat/completions",
		ActualModelName: "MiniMax-M2.7",
	}
	adaptor.Init(m)

	url, err := adaptor.GetRequestURL(m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should NOT contain the deprecated endpoint
	if url == "https://api.minimax.io/v1/text/chatcompletion_v2" {
		t.Error("MiniMax should use OpenAI-compatible /v1/chat/completions, not deprecated /v1/text/chatcompletion_v2")
	}

	// Should contain the standard OpenAI path
	expected := "https://api.minimax.io/v1/chat/completions"
	if url != expected {
		t.Errorf("expected %q, got %q", expected, url)
	}
}
