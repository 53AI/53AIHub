package middleware

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/model"
    "github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/service/twoceoauth"
	"github.com/modelcontextprotocol/go-sdk/auth"
)

const twoCEOReadScope = "2ceo:read"

type twoCEOOAuthConfig struct {
	Resource         string
	Issuer           string
	IntrospectionURL string
	ClientID         string
	ClientSecret     string
}

func load2CEOOAuthConfig() (twoCEOOAuthConfig, bool) {
	c := twoCEOOAuthConfig{
		Resource:         strings.TrimSpace(os.Getenv("TWO_CEO_OAUTH_RESOURCE")),
		Issuer:           strings.TrimSpace(os.Getenv("TWO_CEO_OAUTH_ISSUER")),
		IntrospectionURL: strings.TrimSpace(os.Getenv("TWO_CEO_OAUTH_INTROSPECTION_URL")),
		ClientID:         strings.TrimSpace(os.Getenv("TWO_CEO_OAUTH_CLIENT_ID")),
		ClientSecret:     strings.TrimSpace(os.Getenv("TWO_CEO_OAUTH_CLIENT_SECRET")),
	}
	if c.Resource == "" || c.Issuer == "" || c.IntrospectionURL == "" || c.ClientID == "" || c.ClientSecret == "" {
		return twoCEOOAuthConfig{}, false
	}
	resource, err1 := url.Parse(c.Resource)
	issuer, err2 := url.Parse(c.Issuer)
	endpoint, err3 := url.Parse(c.IntrospectionURL)
	if err1 != nil || err2 != nil || err3 != nil || resource.Scheme != "https" ||
		issuer.Scheme != "https" || endpoint.Scheme != "https" ||
		resource.Host == "" || issuer.Host == "" || endpoint.Host == "" || resource.User != nil {
		return twoCEOOAuthConfig{}, false
	}
	return c, true
}

// MCP2CEOAuth keeps the existing km-* path for internal integration, while
// allowing OAuth tokens issued by a separately configured authorization server.
// The resource server does NOT mint tokens or impersonate 53AI users.
func MCP2CEOAuth(next http.Handler) http.Handler {
	existingKeyAuth := MCPAuth(next)
	oauthHandler := auth.RequireBearerToken(func(ctx context.Context, token string, req *http.Request) (*auth.TokenInfo, error) {
		if _, embedded := twoceoauth.TwoCEOOAuthSettingsFromEnv(); embedded {
			eid, uid, exp, valid := twoceoauth.InspectTwoCEOOAuthAccess(ctx, token)
			if !valid {
                logger.SysWarn("[2ceo-oauth] mcp stage=token_invalid status=401")
				return nil, auth.ErrInvalidToken
			}
			user, err := model.GetUserByID(uid)
            if err!=nil || user==nil || user.Eid!=eid || user.Status!=model.UserStatusJoined ||
              user.Role<model.RoleCommonUser || (user.ExpiredTime>0 && user.ExpiredTime<time.Now().Unix()){
                logger.SysWarn("[2ceo-oauth] mcp stage=user_inactive_or_mismatch status=401")
                return nil,auth.ErrInvalidToken
            }
            tenant,tenantErr:=model.GetEnterpriseByID(eid)
            if tenantErr!=nil || tenant==nil || tenant.Status!=1{
                logger.SysWarn("[2ceo-oauth] mcp stage=tenant_inactive status=401")
                return nil,auth.ErrInvalidToken
            }
			return &auth.TokenInfo{
				UserID: strconv.FormatInt(uid, 10), Expiration: exp,
				Scopes: []string{twoCEOReadScope},
				Extra:  map[string]any{"user_eid": eid, "user_role": user.Role},
			}, nil
		}
		c, ok := load2CEOOAuthConfig()
		if !ok {
			return nil, auth.ErrInvalidToken
		}
		return introspect2CEOToken(ctx, c, token)
	}, nil)(next)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Never allow internal km-* API keys over the OAuth-enabled public MCP
        // endpoint. Internal key debugging remains available in deployments
        // without OAuth, so existing isolated local smoke tests still work.
        _, embedded := twoceoauth.TwoCEOOAuthSettingsFromEnv()
        if strings.HasPrefix(r.Header.Get("Authorization"), "Bearer "+model.APIKeyPrefix) {
            if embedded {
                w.Header().Set("Cache-Control","no-store")
                http.Error(w,"OAuth access token required",http.StatusUnauthorized)
                return
            }
            existingKeyAuth.ServeHTTP(w,r)
            return
        }
		if embedded {
			cfg, _ := twoceoauth.TwoCEOOAuthSettingsFromEnv()
			resourceURL, _ := url.Parse(cfg.Resource)
			metadataHost := resourceURL.Scheme + "://" + resourceURL.Host
			url := metadataHost + "/.well-known/oauth-protected-resource/mcp/2ceo"
			w.Header().Set("WWW-Authenticate", `Bearer resource_metadata="`+url+`", scope="`+twoCEOReadScope+`"`)
			oauthHandler.ServeHTTP(w, r)
			return
		}
		c, ok := load2CEOOAuthConfig()
		if !ok {
			existingKeyAuth.ServeHTTP(w, r)
			return
		}
		w.Header().Set("WWW-Authenticate", `Bearer resource_metadata="`+c.ResourceMetadataURL()+`", scope="`+twoCEOReadScope+`"`)
		oauthHandler.ServeHTTP(w, r)
	})
}

func (c twoCEOOAuthConfig) ResourceMetadataURL() string {
	// Registered at the same external host as the MCP resource.
	u, _ := url.Parse(c.Resource)
	return u.Scheme + "://" + u.Host + "/.well-known/oauth-protected-resource/mcp/2ceo"
}

func TwoCEOProtectedResourceMetadata(w http.ResponseWriter, r *http.Request) {
	if cfg, embedded := twoceoauth.TwoCEOOAuthSettingsFromEnv(); embedded {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"resource":              cfg.Resource,
			"authorization_servers": []string{cfg.Issuer},
			"scopes_supported":      []string{twoCEOReadScope},
		})
		return
	}
	c, ok := load2CEOOAuthConfig()
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"resource":              c.Resource,
		"authorization_servers": []string{c.Issuer},
		"scopes_supported":      []string{twoCEOReadScope},
	})
}

type twoCEOIntrospection struct {
	Active   bool            `json:"active"`
	Exp      int64           `json:"exp"`
	Scope    string          `json:"scope"`
	Audience json.RawMessage `json:"aud"`
	EID      int64           `json:"53ai_eid"`
	UserID   int64           `json:"53ai_user_id"`
}

var twoCEOHTTPClient = &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

func twoCEOAudienceMatches(raw json.RawMessage, audience string) bool {
	var singular string
	if json.Unmarshal(raw, &singular) == nil {
		return singular == audience
	}
	var multiple []string
	if json.Unmarshal(raw, &multiple) != nil {
		return false
	}
	for _, candidate := range multiple {
		if candidate == audience {
			return true
		}
	}
	return false
}

func introspect2CEOToken(ctx context.Context, c twoCEOOAuthConfig, token string) (*auth.TokenInfo, error) {
	if token == "" {
		return nil, auth.ErrInvalidToken
	}
	form := url.Values{"token": {token}, "token_type_hint": {"access_token"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.IntrospectionURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, auth.ErrInvalidToken
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(c.ClientID, c.ClientSecret)
	response, err := twoCEOHTTPClient.Do(req)
	if err != nil {
		return nil, auth.ErrInvalidToken
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, auth.ErrInvalidToken
	}
	var data twoCEOIntrospection
	if err := json.NewDecoder(io.LimitReader(response.Body, 8193)).Decode(&data); err != nil {
		return nil, auth.ErrInvalidToken
	}
	now := time.Now()
	if !data.Active || data.Exp <= now.Unix() || data.EID <= 0 || data.UserID <= 0 ||
		!twoCEOAudienceMatches(data.Audience, c.Resource) {
		return nil, auth.ErrInvalidToken
	}
	hasScope := false
	for _, scope := range strings.Fields(data.Scope) {
		if scope == twoCEOReadScope {
			hasScope = true
			break
		}
	}
	if !hasScope {
		return nil, auth.ErrInvalidToken
	}

	user, err := model.GetUserByID(data.UserID)
	if err != nil || user.Eid != data.EID || user.Status != model.UserStatusJoined || user.Role < model.RoleCommonUser {
		return nil, auth.ErrInvalidToken
	}
	if user.ExpiredTime > 0 && user.ExpiredTime < now.Unix() {
		return nil, auth.ErrInvalidToken
	}
	return &auth.TokenInfo{
		UserID:     strconv.FormatInt(user.UserID, 10),
		Expiration: time.Unix(data.Exp, 0),
		Extra: map[string]any{
			"user_eid":  user.Eid,
			"user_role": user.Role,
		},
	}, nil
}
