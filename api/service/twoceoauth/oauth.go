package twoceoauth

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/model"
	oauth2 "github.com/go-oauth2/oauth2/v4"
	"github.com/go-oauth2/oauth2/v4/manage"
	"github.com/go-oauth2/oauth2/v4/models"
	oauthserver "github.com/go-oauth2/oauth2/v4/server"
	"github.com/go-oauth2/oauth2/v4/store"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const TwoCEOReadScope = "2ceo:read"

// OAuth is optional and strictly disabled unless all four public configuration
// values are provided. In contrast to the legacy external introspection adapter,
// this mode is one Go process and uses the existing 53AIHub database.
type TwoCEOOAuthSettings struct {
	Issuer      string
	Resource    string
	ClientID    string
	RedirectURI string
	EID         int64 // legacy single-tenant pin; zero when a multiple-tenant allowlist is active
	AllowedEIDs []int64
}

// AllowsEID is the tenant boundary for both login and every access-token use.
func (c TwoCEOOAuthSettings) AllowsEID(eid int64) bool {
	if eid <= 0 {
		return false
	}
	for _, candidate := range c.AllowedEIDs {
		if candidate == eid {
			return true
		}
	}
	return false
}
func parseTwoCEOTenantAllowlist(single, multiple string) ([]int64, bool) {
	single = strings.TrimSpace(single)
	multiple = strings.TrimSpace(multiple)
	if single != "" && multiple != "" {
		return nil, false
	}
	if single == "" && multiple == "" {
		return nil, false
	}
	raw := single
	if multiple != "" {
		raw = multiple
	}
	set := map[int64]struct{}{}
	for _, part := range strings.Split(raw, ",") {
		trimmed := strings.TrimSpace(part)
		id, err := strconv.ParseInt(trimmed, 10, 64)
		if err != nil || id <= 0 {
			return nil, false
		}
		if _, exists := set[id]; exists {
			return nil, false
		}
		set[id] = struct{}{}
	}
	if len(set) == 0 || len(set) > 100 {
		return nil, false
	}
	values := make([]int64, 0, len(set))
	for id := range set {
		values = append(values, id)
	}
	// Stable ordering in rendered forms, regardless of Go map iteration.
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	return values, true
}

func TwoCEOOAuthSettingsFromEnv() (TwoCEOOAuthSettings, bool) {
	cfg := TwoCEOOAuthSettings{
		Issuer:      strings.TrimSuffix(strings.TrimSpace(os.Getenv("TWO_CEO_OAUTH_ISSUER")), "/"),
		Resource:    strings.TrimSpace(os.Getenv("TWO_CEO_OAUTH_RESOURCE")),
		ClientID:    strings.TrimSpace(os.Getenv("TWO_CEO_OAUTH_PUBLIC_CLIENT_ID")),
		RedirectURI: strings.TrimSpace(os.Getenv("TWO_CEO_OAUTH_REDIRECT_URI")),
	}
	single := strings.TrimSpace(os.Getenv("TWO_CEO_OAUTH_EID"))
	multi := strings.TrimSpace(os.Getenv("TWO_CEO_OAUTH_ALLOWED_EIDS"))
	allowed, ok := parseTwoCEOTenantAllowlist(single, multi)
	if !ok {
		return cfg, false
	}
	cfg.AllowedEIDs = allowed
	if single != "" {
		cfg.EID = allowed[0]
	}
	key, err := hex.DecodeString(strings.TrimSpace(os.Getenv("TWO_CEO_OAUTH_STORAGE_KEY")))
	if err != nil || len(key) != 32 {
		return cfg, false
	}
	if cfg.Issuer == "" || cfg.Resource == "" || cfg.ClientID == "" || cfg.RedirectURI == "" {
		return cfg, false
	}
	issuer, e1 := url.Parse(cfg.Issuer)
	resource, e2 := url.Parse(cfg.Resource)
	redirect, e3 := url.Parse(cfg.RedirectURI)
	if e1 != nil || e2 != nil || e3 != nil ||
		issuer.Scheme != "https" || resource.Scheme != "https" || redirect.Scheme != "https" ||
		issuer.Host == "" || resource.Host == "" || redirect.Host == "" ||
		issuer.User != nil || resource.User != nil || redirect.User != nil ||
		issuer.RawQuery != "" || issuer.Fragment != "" ||
		resource.RawQuery != "" || resource.Fragment != "" ||
		redirect.Fragment != "" {
		return cfg, false
	}
	// The issuer is the origin used to serve /.well-known/oauth-authorization-server.
	if issuer.Path != "" && issuer.Path != "/" {
		return cfg, false
	}
	return cfg, true
}

type twoCEOOAuthRow struct {
	Key       string `gorm:"primaryKey;size:80"`
	Payload   string `gorm:"type:text;not null"`
	ExpiresAt int64  `gorm:"index;not null"`
}

func (twoCEOOAuthRow) TableName() string { return "two_ceo_oauth_tokens" }

type twoCEOSQLTokenStore struct{ database *gorm.DB }

func (store *twoCEOSQLTokenStore) db() *gorm.DB {
	if store.database != nil {
		return store.database
	}
	return model.DB
}

// OAuth tokens are encrypted at rest; never persist raw bearer credentials in
// the shared application database. A 32-byte random key is mandatory.
func twoCEOOAuthCipher() (cipher.AEAD, error) {
	key, err := hex.DecodeString(strings.TrimSpace(os.Getenv("TWO_CEO_OAUTH_STORAGE_KEY")))
	if err != nil || len(key) != 32 {
		return nil, errors.New("2CEO OAuth storage key must be 32 random bytes (64 hex characters)")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
func twoCEOOAuthSeal(plain []byte) (string, error) {
	aead, err := twoCEOOAuthCipher()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	encrypted := aead.Seal(nil, nonce, plain, nil)
	return base64.RawStdEncoding.EncodeToString(append(nonce, encrypted...)), nil
}
func twoCEOOAuthOpen(encoded string) ([]byte, error) {
	aead, err := twoCEOOAuthCipher()
	if err != nil {
		return nil, err
	}
	b, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, err
	}
	if len(b) < aead.NonceSize() {
		return nil, errors.New("invalid encrypted OAuth token")
	}
	return aead.Open(nil, b[:aead.NonceSize()], b[aead.NonceSize():], nil)
}

// Use typed GORM expressions instead of SQL string fragments. GORM's
// Dialector quotes reserved identifiers correctly for MySQL, PostgreSQL
// and SQLite (KEY is reserved in MySQL).
func twoCEOTokenKeyClause(prefix, raw string) clause.Eq {
	return clause.Eq{Column: clause.Column{Name: "key"}, Value: twoCEOTokenKey(prefix, raw)}
}
func twoCEOTokenNotExpiredClause(now time.Time) clause.Gt {
	return clause.Gt{Column: clause.Column{Name: "expires_at"}, Value: now.Unix()}
}

func twoCEOTokenKey(prefix, raw string) string {
	hash := sha256.Sum256([]byte(raw))
	return prefix + ":" + hex.EncodeToString(hash[:])
}
func (store *twoCEOSQLTokenStore) Create(ctx context.Context, info oauth2.TokenInfo) error {
	var key string
	var expiration time.Time
	if info.GetCode() != "" {
		key = twoCEOTokenKey("code", info.GetCode())
		expiration = info.GetCodeCreateAt().Add(info.GetCodeExpiresIn())
	} else if info.GetAccess() != "" {
		key = twoCEOTokenKey("access", info.GetAccess())
		expiration = info.GetAccessCreateAt().Add(info.GetAccessExpiresIn())
	} else {
		return errors.New("cannot store empty OAuth token")
	}
	bytes, err := json.Marshal(info)
	if err != nil {
		return err
	}
	sealed, err := twoCEOOAuthSeal(bytes)
	if err != nil {
		return err
	}
	row := twoCEOOAuthRow{Key: key, Payload: sealed, ExpiresAt: expiration.Unix()}
	return store.db().WithContext(ctx).Create(&row).Error
}
func (s *twoCEOSQLTokenStore) load(ctx context.Context, kind, raw string) (oauth2.TokenInfo, error) {
	if raw == "" {
		return nil, nil
	}
	var row twoCEOOAuthRow
	err := s.db().WithContext(ctx).
		Where(twoCEOTokenKeyClause(kind, raw)).
		Where(twoCEOTokenNotExpiredClause(time.Now())).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var token models.Token
	plain, err := twoCEOOAuthOpen(row.Payload)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(plain, &token); err != nil {
		return nil, err
	}
	return &token, nil
}
func (s *twoCEOSQLTokenStore) GetByCode(ctx context.Context, code string) (oauth2.TokenInfo, error) {
	return s.load(ctx, "code", code)
}
func (s *twoCEOSQLTokenStore) GetByAccess(ctx context.Context, access string) (oauth2.TokenInfo, error) {
	return s.load(ctx, "access", access)
}
func (s *twoCEOSQLTokenStore) GetByRefresh(ctx context.Context, refresh string) (oauth2.TokenInfo, error) {
	return nil, nil // refresh tokens are not issued by this read-only V1 server
}
func (store *twoCEOSQLTokenStore) RemoveByCode(ctx context.Context, code string) error {
	// Atomic one-time authorization code consumption; concurrent token exchanges
	// cannot redeem the same code once it has been removed.
	tx := store.db().WithContext(ctx).
		Where(twoCEOTokenKeyClause("code", code)).
		Delete(&twoCEOOAuthRow{})
	if tx.Error != nil {
		return tx.Error
	}
	if tx.RowsAffected != 1 {
		return errors.New("authorization code already redeemed")
	}
	return nil
}
func (store *twoCEOSQLTokenStore) RemoveByAccess(ctx context.Context, access string) error {
	return store.db().WithContext(ctx).
		Where(twoCEOTokenKeyClause("access", access)).
		Delete(&twoCEOOAuthRow{}).Error
}
func (*twoCEOSQLTokenStore) RemoveByRefresh(ctx context.Context, refresh string) error {
	return nil
}

type TwoCEOOAuthRuntime struct {
	Config  TwoCEOOAuthSettings
	Server  *oauthserver.Server
	Manager *manage.Manager
}

var twoCEOOAuthRuntimeOnce sync.Once
var twoCEOOAuthRuntime *TwoCEOOAuthRuntime
var twoCEOOAuthInitError error

func GetTwoCEOOAuthRuntime() (*TwoCEOOAuthRuntime, error) {
	cfg, enabled := TwoCEOOAuthSettingsFromEnv()
	if !enabled {
		return nil, errors.New("2CEO OAuth public client is not configured")
	}
	twoCEOOAuthRuntimeOnce.Do(func() {
		if model.DB == nil {
			twoCEOOAuthInitError = errors.New("database is not initialized")
			return
		}
		// Public OAuth must not silently modify shared schemas when 53AIHub's
		// ordinary DB migrations are disabled. Explicitly opt-in to create
		// the OAuth table in the isolated development environment only.
		if os.Getenv("TWO_CEO_OAUTH_AUTO_MIGRATE") == "true" {
			if err := model.DB.AutoMigrate(&twoCEOOAuthRow{}); err != nil {
				twoCEOOAuthInitError = err
				return
			}
		} else if !model.DB.Migrator().HasTable(&twoCEOOAuthRow{}) {
			twoCEOOAuthInitError = errors.New("2CEO OAuth token table missing; apply the reviewed migration first")
			return
		}
		manager := manage.NewDefaultManager()
		manager.SetAuthorizeCodeExp(5 * time.Minute)
		manager.SetAuthorizeCodeTokenCfg(&manage.Config{AccessTokenExp: 45 * time.Minute, IsGenerateRefresh: false})
		manager.SetValidateURIHandler(func(base, redirect string) error {
			if base != redirect || redirect != cfg.RedirectURI {
				return errors.New("OAuth redirect URI must match the registered URI exactly")
			}
			return nil
		})
		manager.SetExtractExtensionHandler(func(req *oauth2.TokenGenerateRequest, token oauth2.ExtendableTokenInfo) {
			values := token.GetExtension()
			if values == nil {
				values = make(url.Values)
			}
			// Authorization codes carry the resource/audience as an extension
			// into the access token. Reject any token exchange attempting a
			// different resource before invoking the OAuth library.
			values.Set("aud", cfg.Resource)
			token.SetExtension(values)
		})
		manager.MapTokenStorage(&twoCEOSQLTokenStore{})
		clients := store.NewClientStore()
		if err := clients.Set(cfg.ClientID, &models.Client{ID: cfg.ClientID, Domain: cfg.RedirectURI, Public: true}); err != nil {
			twoCEOOAuthInitError = err
			return
		}
		manager.MapClientStorage(clients)
		scfg := oauthserver.NewConfig()
		scfg.AllowedResponseTypes = []oauth2.ResponseType{oauth2.Code}
		scfg.AllowedGrantTypes = []oauth2.GrantType{oauth2.AuthorizationCode}
		scfg.AllowedCodeChallengeMethods = []oauth2.CodeChallengeMethod{oauth2.CodeChallengeS256}
		scfg.ForcePKCE = true
		server := oauthserver.NewServer(scfg, manager)
		server.UserAuthorizationHandler = func(w http.ResponseWriter, r *http.Request) (string, error) {
			identity, _ := r.Context().Value(twoCEOOAuthIdentityKey{}).(string)
			if identity == "" {
				return "", errors.New("2CEO OAuth user consent required")
			}
			return identity, nil
		}
		server.ClientInfoHandler = func(r *http.Request) (string, string, error) {
			// Public client authenticated by exact registered ID + redirect +
			// authorization-code PKCE, never by a copied shared secret.
			id := r.FormValue("client_id")
			if id != cfg.ClientID {
				return "", "", errors.New("invalid OAuth client ID")
			}
			return id, "", nil
		}
		server.ClientAuthorizedHandler = func(id string, grant oauth2.GrantType) (bool, error) {
			return id == cfg.ClientID && grant == oauth2.AuthorizationCode, nil
		}
		server.ClientScopeHandler = func(req *oauth2.TokenGenerateRequest) (bool, error) {
			return req.Scope == TwoCEOReadScope, nil
		}
		twoCEOOAuthRuntime = &TwoCEOOAuthRuntime{Config: cfg, Server: server, Manager: manager}
	})
	if twoCEOOAuthInitError != nil {
		return nil, twoCEOOAuthInitError
	}
	if twoCEOOAuthRuntime == nil {
		return nil, errors.New("2CEO OAuth initialization incomplete")
	}
	return twoCEOOAuthRuntime, nil
}

// Token introspection is implemented in-process: the same database stores the
// opaque access tokens, so an additional HTTP introspection round trip is not
// needed. The returned identity is checked again against the live user table
// by the MCP middleware before any tool is executed.
func InspectTwoCEOOAuthAccess(ctx context.Context, raw string) (int64, int64, time.Time, bool) {
	runtime, err := GetTwoCEOOAuthRuntime()
	if err != nil {
		return 0, 0, time.Time{}, false
	}
	info, err := runtime.Manager.LoadAccessToken(ctx, raw)
	if err != nil || info == nil || info.GetAccess() != raw || info.GetScope() != TwoCEOReadScope {
		return 0, 0, time.Time{}, false
	}
	ext, ok := info.(oauth2.ExtendableTokenInfo)
	if !ok || ext.GetExtension().Get("aud") != runtime.Config.Resource {
		return 0, 0, time.Time{}, false
	}
	exp := info.GetAccessCreateAt().Add(info.GetAccessExpiresIn())
	if !exp.After(time.Now()) {
		return 0, 0, time.Time{}, false
	}
	parts := strings.Split(info.GetUserID(), ":")
	if len(parts) != 2 {
		return 0, 0, time.Time{}, false
	}
	eid, e1 := strconv.ParseInt(parts[0], 10, 64)
	uid, e2 := strconv.ParseInt(parts[1], 10, 64)
	if e1 != nil || e2 != nil || eid <= 0 || uid <= 0 {
		return 0, 0, time.Time{}, false
	}
	if !runtime.Config.AllowsEID(eid) {
		return 0, 0, time.Time{}, false
	}
	return eid, uid, exp, true
}

func TwoCEOOAuthIdentity(eid, userID int64) string { return fmt.Sprintf("%d:%d", eid, userID) }

// WithTwoCEOOAuthIdentity binds the already authenticated and consenting 53AI
// user to this one authorization request; no global mutable session is used.
type twoCEOOAuthIdentityKey struct{}

func WithTwoCEOOAuthIdentity(ctx context.Context, eid, userID int64) context.Context {
	return context.WithValue(ctx, twoCEOOAuthIdentityKey{}, TwoCEOOAuthIdentity(eid, userID))
}
