package decision

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/model"
)

const (
	DefaultBaseURL   = "https://api.typesafe.ai"
	DefaultModel     = "jev-latest"
	maxResponseBytes = 1 << 20
)

type Question struct {
	Type         string      `json:"type"`
	Instructions string      `json:"instructions"`
	Criteria     interface{} `json:"criteria,omitempty"`
}

type Answer struct {
	Type          string             `json:"type"`
	Choice        string             `json:"choice,omitempty"`
	Confidence    *float64           `json:"confidence,omitempty"`
	Probabilities map[string]float64 `json:"probabilities,omitempty"`
	Noul          *float64           `json:"noul,omitempty"`
	Score         *float64           `json:"score,omitempty"`
}

type Response struct {
	Model   string            `json:"model"`
	Answers map[string]Answer `json:"answers"`
	Usage   struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
}

// IsBailianDecisionModel accepts both string and numeric model type values
// produced by existing channel configuration editors.
func IsBailianDecisionModel(raw, modelName string) bool {
	var entries map[string]json.RawMessage
	if json.Unmarshal([]byte(raw), &entries) != nil {
		return false
	}
	var text string
	if json.Unmarshal(entries[modelName], &text) == nil {
		return text == "5"
	}
	var number int
	return json.Unmarshal(entries[modelName], &number) == nil && number == 5
}

type Client struct{ HTTPClient *http.Client }

// HTTP errors, malformed answers and timeouts are candidates for the caller's
// existing reasoning-model fallback. No alternate model is called in this adapter.
func (client *Client) Evaluate(ctx context.Context, channel *model.Channel, modelName string, state interface{}, questions map[string]Question) (*Response, error) {
	if channel == nil || (channel.Type != model.ChannelApiTypeTypeSafeDecision && channel.Type != 17) || channel.Status != model.ChannelStatusEnabled {
		return nil, errors.New("decision channel is unavailable")
	}
	if strings.TrimSpace(channel.Key) == "" {
		return nil, errors.New("decision channel API key is missing")
	}
	if strings.TrimSpace(modelName) == "" || len(questions) == 0 {
		return nil, errors.New("decision model or questions missing")
	}

	baseURL := strings.TrimSpace(channel.GetBaseURL())
	if channel.Type == 17 {
		var config struct {
			DecisionModelEndpoints map[string]string `json:"decision_model_endpoints"`
		}
		if strings.TrimSpace(channel.CustomConfig) != "" {
			if err := json.Unmarshal([]byte(channel.CustomConfig), &config); err != nil {
				return nil, fmt.Errorf("invalid decision endpoint config: %w", err)
			}
		}
		if endpoint := strings.TrimSpace(config.DecisionModelEndpoints[modelName]); endpoint != "" {
			baseURL = endpoint
		}
		if baseURL == "" {
			return nil, errors.New("Bailian decision endpoint is missing")
		}
	}
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("decision base URL must be an HTTPS origin")
	}
	path := strings.TrimRight(parsed.Path, "/")
	if channel.Type == 17 {
		if strings.HasSuffix(path, "/compatible-mode/v1") {
			path += "/systemone"
		}
		if !strings.HasSuffix(path, "/compatible-mode/v1/systemone") {
			return nil, errors.New("invalid Bailian SystemOne endpoint path")
		}
		if !strings.HasSuffix(strings.ToLower(parsed.Hostname()), ".maas.aliyuncs.com") {
			return nil, errors.New("Bailian endpoint must use a maas.aliyuncs.com host")
		}
		parsed.Path = path
	} else {
		if path != "" && path != "/v1" {
			return nil, errors.New("decision base URL only supports origin or /v1")
		}
		parsed.Path = "/v1/systemone"
	}

	body, err := json.Marshal(map[string]interface{}{"model": modelName, "state": state, "questions": questions})
	if err != nil {
		return nil, fmt.Errorf("encode decision request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, parsed.String(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+channel.Key)
	req.Header.Set("Content-Type", "application/json")
	httpClient := client.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 8 * time.Second}
	}
	if channel.Type == 17 {
		// Never forward a Bailian API key to a redirected URL.
		withoutRedirects := *httpClient
		withoutRedirects.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		httpClient = &withoutRedirects
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("decision request failed: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read decision response: %w", err)
	}
	if len(raw) > maxResponseBytes {
		return nil, errors.New("decision response too large")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Never include provider response text (which can echo user data or credentials).
		return nil, fmt.Errorf("decision API returned HTTP %d", resp.StatusCode)
	}
	var result Response
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("decode decision response: %w", err)
	}
	if len(result.Answers) == 0 {
		return nil, errors.New("decision API returned no answers")
	}
	for id, question := range questions {
		answer, ok := result.Answers[id]
		if !ok || answer.Type != question.Type {
			return nil, fmt.Errorf("invalid decision answer for %q", id)
		}
		if question.Type == "choice" {
			criteria, ok := question.Criteria.(map[string]string)
			if !ok {
				return nil, fmt.Errorf("invalid criteria for %q", id)
			}
			if _, ok := criteria[answer.Choice]; !ok || answer.Confidence == nil || *answer.Confidence < 0 || *answer.Confidence > 1 {
				return nil, fmt.Errorf("invalid choice or confidence for %q", id)
			}
		}
	}
	return &result, nil
}

// A small process-local circuit breaker prevents repeated timeout penalties.
// It is keyed by channel ID; it does not alter the channel's persisted status.
type breakerState struct {
	failures int
	until    time.Time
}

var breakers = struct {
	sync.Mutex
	states map[int64]breakerState
}{states: make(map[int64]breakerState)}

func IsAvailable(channelID int64) bool {
	breakers.Lock()
	defer breakers.Unlock()
	state := breakers.states[channelID]
	return !time.Now().Before(state.until)
}

func RecordResult(channelID int64, err error) {
	breakers.Lock()
	defer breakers.Unlock()
	if err == nil {
		delete(breakers.states, channelID)
		return
	}
	state := breakers.states[channelID]
	state.failures++
	if state.failures >= 3 {
		state.until = time.Now().Add(45 * time.Second)
		state.failures = 0
	}
	breakers.states[channelID] = state
}
