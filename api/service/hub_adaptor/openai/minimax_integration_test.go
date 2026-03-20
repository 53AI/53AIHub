package openai

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"testing"
)

// TestMiniMaxAPIIntegration verifies that MiniMax's OpenAI-compatible API
// works correctly with the M2.7 model. This test requires MINIMAX_API_KEY
// to be set and is skipped otherwise.
func TestMiniMaxAPIIntegration(t *testing.T) {
	apiKey := os.Getenv("MINIMAX_API_KEY")
	if apiKey == "" {
		t.Skip("MINIMAX_API_KEY not set, skipping integration test")
	}

	baseURL := os.Getenv("MINIMAX_BASE_URL")
	if baseURL == "" {
		baseURL = "https://api.minimax.io"
	}

	// Build a standard OpenAI-compatible chat completion request
	reqBody := map[string]interface{}{
		"model": "MiniMax-M2.7",
		"messages": []map[string]string{
			{"role": "user", "content": "Say 'test passed' and nothing else."},
		},
		"max_tokens": 20,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		t.Fatalf("failed to marshal request: %v", err)
	}

	req, err := http.NewRequest("POST", baseURL+"/v1/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		t.Fatalf("failed to create request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", resp.StatusCode, string(respBody))
	}

	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	// Verify we got choices with content
	choices, ok := result["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		t.Fatalf("expected non-empty choices, got: %v", result)
	}

	choice := choices[0].(map[string]interface{})
	message := choice["message"].(map[string]interface{})
	content := message["content"].(string)
	if content == "" {
		t.Error("expected non-empty content in response")
	}

	t.Logf("MiniMax M2.7 response: %s", content)
}

// TestMiniMaxAPIStreamingIntegration verifies streaming works with the
// OpenAI-compatible endpoint.
func TestMiniMaxAPIStreamingIntegration(t *testing.T) {
	apiKey := os.Getenv("MINIMAX_API_KEY")
	if apiKey == "" {
		t.Skip("MINIMAX_API_KEY not set, skipping integration test")
	}

	baseURL := os.Getenv("MINIMAX_BASE_URL")
	if baseURL == "" {
		baseURL = "https://api.minimax.io"
	}

	reqBody := map[string]interface{}{
		"model": "MiniMax-M2.7",
		"messages": []map[string]string{
			{"role": "user", "content": "Count from 1 to 3."},
		},
		"max_tokens": 50,
		"stream":     true,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		t.Fatalf("failed to marshal request: %v", err)
	}

	req, err := http.NewRequest("POST", baseURL+"/v1/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		t.Fatalf("failed to create request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected status 200, got %d: %s", resp.StatusCode, string(body))
	}

	// Read the streaming response and count SSE data lines
	body, _ := io.ReadAll(resp.Body)
	lines := bytes.Split(body, []byte("\n"))
	dataLines := 0
	for _, line := range lines {
		if bytes.HasPrefix(line, []byte("data:")) {
			dataLines++
		}
	}

	if dataLines < 2 {
		t.Errorf("expected multiple streaming data lines, got %d", dataLines)
	}

	t.Logf("MiniMax M2.7 streaming: received %d data lines", dataLines)
}
