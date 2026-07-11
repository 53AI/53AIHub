package coze

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
)

type CozeApi struct {
	BaseUrl string
}

const (
	CozeCnUrl  = "https://api.coze.cn"
	CozeComUrl = "https://api.coze.com"
)

type CozeApiTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

func (c *CozeApi) doRequest(method, url string, payload interface{}, headers map[string]string) ([]byte, error) {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(method, url, bytes.NewBuffer(payloadBytes))
	if err != nil {
		return nil, err
	}

	for key, value := range headers {
		req.Header.Set(key, value)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("request failed with status %d: %s", resp.StatusCode, string(body))
	}

	return body, nil
}

func (c *CozeApi) GetOAuthToken(clientID, clientSecret, code, redirectURI string) (*CozeApiTokenResponse, error) {
	url := c.BaseUrl + "/api/permission/oauth2/token"
	payload := map[string]string{
		"grant_type":   "authorization_code",
		"code":         code,
		"client_id":    clientID,
		"redirect_uri": redirectURI,
	}

	headers := map[string]string{
		"Content-Type":  "application/json",
		"Authorization": "Bearer " + clientSecret,
	}

	resp, err := c.doRequest("POST", url, payload, headers)
	if err != nil {
		return nil, err
	}

	var result CozeApiTokenResponse
	err = json.Unmarshal(resp, &result)
	if err != nil {
		return nil, err
	}

	if result.AccessToken == "" || result.RefreshToken == "" || result.ExpiresIn == 0 {
		return nil, fmt.Errorf("invalid token response: %s", string(resp))
	}
	return &result, nil
}

func (c *CozeApi) RefreshOAuthToken(clientID, clientSecret, refreshToken string) (*CozeApiTokenResponse, error) {
	url := c.BaseUrl + "/api/permission/oauth2/token"
	payload := map[string]string{
		"grant_type":    "refresh_token",
		"refresh_token": refreshToken,
		"client_id":     clientID,
	}

	headers := map[string]string{
		"Content-Type":  "application/json",
		"Authorization": "Bearer " + clientSecret,
	}

	resp, err := c.doRequest("POST", url, payload, headers)
	if err != nil {
		return nil, err
	}

	var result CozeApiTokenResponse
	err = json.Unmarshal(resp, &result)
	if err != nil {
		return nil, err
	}

	if result.AccessToken == "" || result.RefreshToken == "" || result.ExpiresIn == 0 {
		return nil, fmt.Errorf("invalid token response: %s", string(resp))
	}
	return &result, nil
}

type Workspace struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	IconURL       string `json:"icon_url"`
	RoleType      string `json:"role_type"`
	WorkspaceType string `json:"workspace_type"`
}

type WorkspacesResponse struct {
	TotalCount int         `json:"total_count"`
	Workspaces []Workspace `json:"workspaces"`
}

type Bot struct {
	BotID       string `json:"bot_id"`
	BotName     string `json:"bot_name"`
	Description string `json:"description"`
	IconURL     string `json:"icon_url"`
	PublishTime string `json:"publish_time"`
}

type PublishedBotsResponse struct {
	SpaceBots []Bot `json:"space_bots"`
	Total     int   `json:"total"`
}

// GetTokenExpiryUnix returns the absolute expiry timestamp (seconds) for a provider's token.
// Coze CN API returns expires_in as an absolute Unix timestamp (e.g. 1780132193),
// while standard OAuth2 returns it as a duration in seconds (e.g. 7200).
// This function detects which format is used and returns the correct expiry time.
func GetTokenExpiryUnix(provider *model.Provider) int64 {
	if provider.ExpiresIn > 1e9 {
		return provider.ExpiresIn
	}
	return provider.AuthedTime/1000 + provider.ExpiresIn
}

// IsTokenExpired checks if token is expired (with 5 minutes buffer time)
func IsTokenExpired(provider *model.Provider) bool {
	return time.Now().Unix()+300 >= GetTokenExpiryUnix(provider)
}

// GetWorkspaces retrieves list of workspaces
func (c *CozeApi) GetWorkspaces(provider *model.Provider, pageNum int, pageSize int) (*WorkspacesResponse, error) {
	url := c.BaseUrl + "/v1/workspaces"
	query := fmt.Sprintf("?page_num=%d&page_size=%d", pageNum, pageSize)
	url = url + query

	// Log request details
	fmt.Printf("GetWorkspaces: Provider ID %d, URL: %s\n", provider.ProviderID, url)
	fmt.Printf("GetWorkspaces: AccessToken: %s...\n", provider.AccessToken[:min(len(provider.AccessToken), 20)])

	headers := map[string]string{
		"Content-Type":  "application/json",
		"Authorization": "Bearer " + provider.AccessToken,
	}

	resp, err := c.doRequest("GET", url, nil, headers)
	if err != nil {
		fmt.Printf("GetWorkspaces: Request failed for provider %d: %v\n", provider.ProviderID, err)
		return nil, err
	}

	fmt.Printf("GetWorkspaces: Raw response for provider %d: %s\n", provider.ProviderID, string(resp))

	var result struct {
		Data WorkspacesResponse `json:"data"`
		Code int                `json:"code"`
		Msg  string             `json:"msg"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, err
	}

	if result.Code != 0 {
		return nil, fmt.Errorf("request failed with code %d: %s", result.Code, result.Msg)
	}

	fmt.Printf("GetWorkspaces: Found %d workspaces for provider %d\n", len(result.Data.Workspaces), provider.ProviderID)
	return &result.Data, nil
}

// GetPublishedBots retrieves list of published bots
func (c *CozeApi) GetPublishedBots(provider *model.Provider, spaceID string, pageIndex int, pageSize int) (*PublishedBotsResponse, error) {
	if decoded, err := hashids.TryParseID(spaceID); err == nil {
		spaceID = strconv.FormatInt(decoded, 10)
	}

	url := c.BaseUrl + "/v1/space/published_bots_list"
	query := fmt.Sprintf("?space_id=%s&page_size=%d&page_index=%d", spaceID, pageSize, pageIndex)
	url = url + query

	headers := map[string]string{
		"Content-Type":  "application/json",
		"Authorization": "Bearer " + provider.AccessToken,
	}

	resp, err := c.doRequest("GET", url, nil, headers)
	if err != nil {
		return nil, err
	}

	var result struct {
		Data PublishedBotsResponse `json:"data"`
		Code int                   `json:"code"`
		Msg  string                `json:"msg"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, err
	}

	if result.Code != 0 {
		return nil, fmt.Errorf("request failed with code %d: %s", result.Code, result.Msg)
	}

	return &result.Data, nil
}
