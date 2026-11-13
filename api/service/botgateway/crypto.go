package botgateway

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"strings"

	"github.com/53AI/53AIHub/config"
)

// bot_token 加密格式：v1:<base64(nonce+ciphertext)>；密钥由 config.GetEncryptionKey 经 sha256 派生（兼容任意长度 key）。
const botTokenPrefix = "v1:"

func botTokenAESKey() []byte {
	sum := sha256.Sum256([]byte(config.GetEncryptionKey()))
	return sum[:]
}

// EncryptBotToken AES-256-GCM 加密绑定 bot_token
func EncryptBotToken(plain string) (string, error) {
	block, err := aes.NewCipher(botTokenAESKey())
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nil, nonce, []byte(plain), nil)
	return botTokenPrefix + base64.StdEncoding.EncodeToString(append(nonce, ciphertext...)), nil
}

// DecryptBotToken 解密绑定 bot_token
func DecryptBotToken(encoded string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(encoded, botTokenPrefix))
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(botTokenAESKey())
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("密文长度不足")
	}
	nonce, ciphertext := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}
