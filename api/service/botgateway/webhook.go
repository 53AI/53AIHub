package botgateway

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"strings"
)

// VerifySignature 校验 HMAC-SHA256(botToken, body) 十六进制签名（与 bot-gateway X-Webhook-Signature 一致）。
func VerifySignature(botToken string, body []byte, signature string) bool {
	if signature == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(botToken))
	mac.Write(body)
	want := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(want), []byte(signature))
}

// NormalizeSession 将网关会话（S:xxx / R:xxx）归一化为 AgentHub visitor_id（≤64 字符）。
func NormalizeSession(botID, session string) string {
	raw := "bot_" + botID + "_" + strings.TrimSpace(session)
	if len(raw) <= 64 {
		return raw
	}
	sum := sha512.Sum512_256([]byte(raw))
	return raw[:40] + hex.EncodeToString(sum[:12])
}
