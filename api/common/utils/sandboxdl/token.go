package sandboxdl

import (
	"errors"
	"path"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/utils/env"
	common_jwt "github.com/53AI/53AIHub/common/utils/jwt"
	"github.com/golang-jwt/jwt/v5"
)

const (
	defaultTokenTTL   = 168 * time.Hour
	issuerSandboxFile = "sandbox-file-download"
)

// downloadSigningKey 读取独立下载密钥，未配置时回退到 JWT_SECRET。
// 两者都没有硬编码兜底：缺失或过短时签名/验签直接失败。
func downloadSigningKey() ([]byte, error) {
	secret := strings.TrimSpace(env.String("SANDBOX_DOWNLOAD_TOKEN_SECRET", ""))
	if secret == "" {
		return common_jwt.SecretKey()
	}
	if len(secret) < common_jwt.MinSecretLength {
		return nil, common_jwt.ErrSecretTooWeak
	}
	return []byte(secret), nil
}

type DownloadTokenClaims struct {
	FileID   int64  `json:"fid"`
	FileName string `json:"fn"`
	jwt.RegisteredClaims
}

func GenerateDownloadToken(fileID int64, fileName string, ttl time.Duration) (string, error) {
	key, err := downloadSigningKey()
	if err != nil {
		return "", err
	}
	cleanName := sanitizeFileName(fileName)
	if fileID <= 0 || cleanName == "" {
		return "", errors.New("invalid download token payload")
	}
	if ttl <= 0 {
		ttl = defaultTokenTTL
	}
	now := time.Now()
	claims := DownloadTokenClaims{
		FileID:   fileID,
		FileName: cleanName,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(now),
			Issuer:    issuerSandboxFile,
			Subject:   "sandbox-file",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(key)
}

func ValidateDownloadToken(tokenStr string, fileID int64, fileName string) error {
	key, err := downloadSigningKey()
	if err != nil {
		return err
	}
	cleanName := sanitizeFileName(fileName)
	if fileID <= 0 || cleanName == "" || strings.TrimSpace(tokenStr) == "" {
		return errors.New("invalid download token verify input")
	}
	claims := &DownloadTokenClaims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
		if token == nil || token.Method == nil || token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, jwt.ErrTokenSignatureInvalid
		}
		return key, nil
	})
	if err != nil {
		return err
	}
	if token == nil || !token.Valid {
		return jwt.ErrTokenInvalidClaims
	}
	if claims.Issuer != issuerSandboxFile {
		return errors.New("invalid token issuer")
	}
	if claims.FileID != fileID {
		return errors.New("token file id mismatch")
	}
	if sanitizeFileName(claims.FileName) != cleanName {
		return errors.New("token file name mismatch")
	}
	return nil
}

func sanitizeFileName(fileName string) string {
	name := strings.TrimSpace(fileName)
	name = path.Base(name)
	if name == "." || name == "/" {
		return ""
	}
	return name
}
