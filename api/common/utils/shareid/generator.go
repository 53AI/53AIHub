package shareid

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
)

// Generate returns a URL-safe, no-padding Base64 string of length 16,
// generated from 12 bytes (96-bit) of cryptographically secure randomness.
// Charset: [A-Za-z0-9-_]
func Generate() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("shareid: rand read: %w", err)
	}
	// base64.RawURLEncoding uses '-' and '_' and no padding, 12 bytes -> 16 chars
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

// IsValid performs a light check on share id format and length (16 chars).
// It does not verify existence or DB uniqueness.
func IsValid(id string) bool {
	if len(id) != 16 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		// 'A'-'Z' 'a'-'z' '0'-'9' '-' '_'
		if (c >= 'A' && c <= 'Z') ||
			(c >= 'a' && c <= 'z') ||
			(c >= '0' && c <= '9') ||
			c == '-' || c == '_' {
			continue
		}
		return false
	}
	return true
}
