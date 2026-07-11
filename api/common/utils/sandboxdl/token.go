package sandboxdl

import (
	"errors"
	"path"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/utils/env"
	"github.com/golang-jwt/jwt/v5"
)

const (
	defaultTokenTTL   = 168 * time.Hour
	issuerSandboxFile = "sandbox-file-download"
)

var signingKey = []byte(env.String("SANDBOX_DOWNLOAD_TOKEN_SECRET", env.String("JWT_SECRET", "secret")))

type DownloadTokenClaims struct {
	FileID   int64  `json:"fid"`
	FileName string `json:"fn"`
	jwt.RegisteredClaims
}

func GenerateDownloadToken(fileID int64, fileName string, ttl time.Duration) (string, error) {
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
	return token.SignedString(signingKey)
}

func ValidateDownloadToken(tokenStr string, fileID int64, fileName string) error {
	cleanName := sanitizeFileName(fileName)
	if fileID <= 0 || cleanName == "" || strings.TrimSpace(tokenStr) == "" {
		return errors.New("invalid download token verify input")
	}
	claims := &DownloadTokenClaims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
		if token == nil || token.Method == nil || token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, jwt.ErrTokenSignatureInvalid
		}
		return signingKey, nil
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
