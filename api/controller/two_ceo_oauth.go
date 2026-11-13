package controller

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"html/template"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/model"
    "github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/service/twoceoauth"
	"github.com/gin-gonic/gin"
)

const twoCEOCookie = "two_ceo_oauth_csrf"

// Login and consent happen together over the issuer's HTTPS origin. No JWT,
// username, password or OAuth code is ever copied into a redirect query.
var twoCEOTemplate = template.Must(template.New("2ceo").Parse(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>2CEO 授权登录</title><style>body{font:15px/1.65 system-ui;background:#f6f7fa;color:#222}main{max-width:440px;background:white;border:1px solid #e3e7ee;border-radius:12px;margin:8vh auto;padding:28px}h1{font-size:24px;margin:0}label{display:block;margin:16px 0 5px}input{box-sizing:border-box;width:100%;padding:10px;border:1px solid #c7cbd1;border-radius:7px}input[type=hidden]{display:none}button{margin-top:20px;padding:12px;width:100%;color:white;background:#285c88;border:0;border-radius:7px;font:inherit}.error{color:#a21d32}.fine{font-size:13px;color:#747b89}</style></head><body><main><h1>2CEO · AI经营参谋</h1><p>ChatGPT 希望读取当前账号有权访问的会议洞察与经营行动。</p><p class="fine">授权范围：2ceo:read（只读）。不会自动修改数据或执行行动。</p>{{if .Error}}<p class="error">{{.Error}}</p>{{end}}<form method="post" action="/oauth/2ceo/authorize">{{range $key,$vals:=.Fields}}{{range $vals}}<input type="hidden" name="{{$key}}" value="{{.}}">{{end}}{{end}}{{if .MultiTenant}}<label>53AI 企业编号</label><input name="enterprise_id" type="number" min="1" inputmode="numeric" value="{{.SelectedEID}}" required><p class="fine">请选择已获得 ChatGPT 授权测试资格的企业编号。</p>{{else}}<input type="hidden" name="enterprise_id" value="{{.PinnedEID}}">{{end}}<label>53AI 手机号或邮箱</label><input name="username" type="text" autocomplete="username" required maxlength="160"><label>密码</label><input name="password" type="password" autocomplete="current-password" required><button name="consent" value="approve">登录并授权 ChatGPT</button></form><p class="fine">只在你自己的 53AI HTTPS 域名上输入密码。</p></main></body></html>`))

func twoCEOBad(c *gin.Context, reason string) {
	c.Header("Cache-Control", "no-store")
	c.JSON(400, gin.H{"error": "invalid_request", "error_description": reason})
}
func twoCEOValidOAuthRequest(c *gin.Context, cfg twoceoauth.TwoCEOOAuthSettings) bool {
	if c.Request.FormValue("client_id") != cfg.ClientID ||
		c.Request.FormValue("redirect_uri") != cfg.RedirectURI ||
		c.Request.FormValue("resource") != cfg.Resource ||
		c.Request.FormValue("response_type") != "code" ||
		c.Request.FormValue("scope") != twoceoauth.TwoCEOReadScope ||
		c.Request.FormValue("code_challenge_method") != "S256" ||
		len(c.Request.FormValue("code_challenge")) < 43 ||
		c.Request.FormValue("state") == "" {
		twoCEOBad(c, "invalid client, redirect, scope, resource, state or PKCE")
		return false
	}
	return true
}
func twoCEORandomCSRF() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// twoCEOOAuthConsentCSP allows a POST to the same-origin consent handler and
// the subsequent OAuth 302 to the exact registered callback ORIGIN. Chromium
// enforces form-action on redirects; a 'self'-only policy blocks ChatGPT's
// cross-origin OAuth callback even when code/state were issued correctly.
// The callback *URL* is separately bound to the configured redirect URI in
// twoCEOValidOAuthRequest and the go-oauth2 manager.
func twoCEOOAuthConsentCSP(cfg twoceoauth.TwoCEOOAuthSettings) string {
	formAction := "form-action 'self'"
	callback, err := url.Parse(cfg.RedirectURI)
	if err == nil && callback.Scheme == "https" && callback.Host != "" &&
		callback.User == nil && callback.Opaque == "" {
		formAction += " https://" + callback.Host
	}
	return "default-src 'none'; style-src 'unsafe-inline'; " +
		formAction + "; frame-ancestors 'none'; base-uri 'none'"
}

func twoCEORender(c *gin.Context, msg string) {
	csrf, err := twoCEORandomCSRF()
	if err != nil {
		c.Status(500)
		return
	}
	http.SetCookie(c.Writer, &http.Cookie{Name: twoCEOCookie, Value: csrf, Path: "/oauth/2ceo/authorize", HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode, MaxAge: 600})
	fields := make(url.Values)
	for _, key := range []string{"client_id", "redirect_uri", "resource", "response_type", "scope", "state", "code_challenge", "code_challenge_method"} {
		fields.Set(key, c.Request.FormValue(key))
	}
	fields.Set("csrf", csrf)
	c.Header("Cache-Control", "no-store")
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.Header("X-Frame-Options", "DENY")
	settings, _ := twoceoauth.TwoCEOOAuthSettingsFromEnv()
	c.Header("Content-Security-Policy", twoCEOOAuthConsentCSP(settings))
	if msg != "" {
		c.Status(http.StatusUnauthorized)
	}
	selected := strings.TrimSpace(c.Request.FormValue("enterprise_id"))
	if selected == "" && settings.EID > 0 {
		selected = strconv.FormatInt(settings.EID, 10)
	}
	_ = twoCEOTemplate.Execute(c.Writer, struct {
		Fields      url.Values
		Error       string
		MultiTenant bool
		PinnedEID   int64
		SelectedEID string
	}{fields, msg, settings.EID == 0, settings.EID, selected})
}
func twoCEOCSRFValid(c *gin.Context, issuer string) bool {
	cookie, err := c.Request.Cookie(twoCEOCookie)
	if err != nil {
		return false
	}
	v := c.PostForm("csrf")
	if len(v) != 64 || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(v)) != 1 {
		return false
	}
	if origin := c.GetHeader("Origin"); origin != "" && origin != issuer {
		return false
	}
	return true
}
func twoCEOLogin(c *gin.Context) (int64, int64, error) {
	account := strings.TrimSpace(c.PostForm("username"))
	password := c.PostForm("password")
	if account == "" || len(account) > 160 || password == "" || len(password) > 1024 {
		return 0, 0, errors.New("无效的账号或密码")
	}
	settings, valid := twoceoauth.TwoCEOOAuthSettingsFromEnv()
	if !valid {
		return 0, 0, errors.New("OAuth 未配置")
	}
	eid, parseErr := strconv.ParseInt(strings.TrimSpace(c.PostForm("enterprise_id")), 10, 64)
	if parseErr != nil || !settings.AllowsEID(eid) {
		return 0, 0, errors.New("企业或账号密码不正确")
	}
	enterprise, tenantErr := model.GetEnterpriseByID(eid)
	if tenantErr != nil || enterprise == nil || enterprise.Status != 1 {
		return 0, 0, errors.New("企业或账号密码不正确")
	}
	policy, _ := model.GetPasswordSecurityPolicySetting(eid)
	if locked, _ := checkLoginLock(eid, account, policy); locked {
		return 0, 0, errors.New("登录尝试过多，请稍后再试")
	}
	var user model.User
	var err error
	if helper.IsValidEmail(account) {
		user, err = model.GetUserByEmail(eid, account)
	} else if helper.IsValidPhone(account) {
		user, err = model.GetUserByMobile(eid, account)
	} else {
		err = errors.New("invalid username")
	}
	if err == nil {
		err = user.VerifyPassword(password)
	}
	if err != nil {
		recordLoginFailure(eid, account, policy)
		return 0, 0, errors.New("账号或密码错误")
	}
	if user.Eid != eid || user.UserID <= 0 || user.Status != model.UserStatusJoined || user.Role < model.RoleCommonUser || (user.ExpiredTime > 0 && user.ExpiredTime < time.Now().Unix()) {
		return 0, 0, errors.New("账号暂不可授权")
	}
	if policy.FirstLoginChangeRequired && user.LastLoginTime == 0 {
		return 0, 0, errors.New("请先在 53AI 修改初始密码")
	}
	if policy.ForceChangeOnExpired && policy.ExpireEnabled {
		base := user.GetPasswordBaseTime()
		if base > 0 && time.Since(time.UnixMilli(base)) > time.Duration(policy.GetEffectiveExpireDays())*24*time.Hour {
			return 0, 0, errors.New("请先在 53AI 更新过期密码")
		}
	}
	clearLoginFailure(eid, account, policy)
	return eid, user.UserID, nil
}
func TwoCEOOAuthAuthorize(c *gin.Context) {
	runtime, err := twoceoauth.GetTwoCEOOAuthRuntime()
	if err != nil {
		c.JSON(503, gin.H{"error": "oauth_not_configured"})
		return
	}
	if !twoCEOValidOAuthRequest(c, runtime.Config) {
		return
	}
	if c.Request.Method == "GET" {
		twoCEORender(c, "")
		return
	}
	if c.Request.Method != "POST" {
		c.Status(405)
		return
	}
	if !twoCEOCSRFValid(c, runtime.Config.Issuer) {
		twoCEOBad(c, "invalid CSRF")
		return
	}
	if c.PostForm("consent") != "approve" {
		twoCEOBad(c, "consent required")
		return
	}
	eid, uid, err := twoCEOLogin(c)
	if err != nil {
		twoCEORender(c, err.Error())
		return
	}
	req := c.Request.WithContext(twoceoauth.WithTwoCEOOAuthIdentity(c.Request.Context(), eid, uid))
	c.Header("Cache-Control", "no-store")
	if err := runtime.Server.HandleAuthorizeRequest(c.Writer, req); err != nil {
		twoCEOBad(c, "authorization failed")
	}
}
// twoCEOOAuthTokenPrecheck returns a safe internal diagnostic category only.
// Never log raw authorization codes, PKCE verifiers, tokens, passwords, client
// secrets, state, redirect URLs or request bodies.
func twoCEOOAuthTokenPrecheck(r *http.Request, cfg twoceoauth.TwoCEOOAuthSettings) string {
    if r.Method != http.MethodPost {return "method"}
    if r.FormValue("grant_type")!="authorization_code" {return "grant_type"}
    if r.FormValue("client_id")!=cfg.ClientID {return "client_id"}
    if r.FormValue("redirect_uri")!=cfg.RedirectURI {return "redirect_uri"}
    if r.FormValue("resource")!=cfg.Resource {return "resource"}
    if r.FormValue("code_verifier")=="" {return "code_verifier"}
    return ""
}

func TwoCEOOAuthToken(c *gin.Context) {
    c.Header("Cache-Control","no-store")
    runtime, err:=twoceoauth.GetTwoCEOOAuthRuntime()
    if err!=nil {
        logger.SysWarn("[2ceo-oauth] token stage=runtime_unavailable status=503")
        c.JSON(http.StatusServiceUnavailable,gin.H{"error":"temporarily_unavailable"})
        return
    }
    if category:=twoCEOOAuthTokenPrecheck(c.Request,runtime.Config);category!="" {
        logger.SysWarnf("[2ceo-oauth] token stage=precheck category=%s status=400 has_basic_auth=%t",
            category,strings.HasPrefix(c.GetHeader("Authorization"),"Basic "))
        twoCEOBad(c,"invalid OAuth token request")
        return
    }
    // go-oauth2 owns the response, including RFC6749 errors. Never append
    // another JSON body after it has already sent a response.
    if err:=runtime.Server.HandleTokenRequest(c.Writer,c.Request);err!=nil {
        logger.SysWarnf("[2ceo-oauth] token stage=library_error status=%d",c.Writer.Status())
        if !c.Writer.Written(){c.JSON(http.StatusBadRequest,gin.H{"error":"invalid_grant"})}
        return
    }
    status:=c.Writer.Status()
    if status>=200 && status<300 {
        logger.SysLogf("[2ceo-oauth] token stage=issued status=%d",status)
    }else{
        logger.SysWarnf("[2ceo-oauth] token stage=library_rejected status=%d",status)
    }
}
func TwoCEOOAuthMetadata(c *gin.Context) {
	runtime, err := twoceoauth.GetTwoCEOOAuthRuntime()
	if err != nil {
		c.Status(404)
		return
	}
	issuer := runtime.Config.Issuer
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{
		"issuer": issuer, "authorization_endpoint": issuer + "/oauth/2ceo/authorize",
		"token_endpoint":                        issuer + "/oauth/2ceo/token",
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code"},
		"token_endpoint_auth_methods_supported": []string{"none"},
		"code_challenge_methods_supported":      []string{"S256"},
		"scopes_supported":                      []string{twoceoauth.TwoCEOReadScope},
	})
}
