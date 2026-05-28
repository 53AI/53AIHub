package model

import (
	"encoding/json"
	"fmt"
)

const openClawAppSecretKey = "openclaw_app_secret"

// MergeOpenClawCustomConfig merges OpenClawWS custom_config values while preserving
// the OpenClawWS secret semantics used by create/update/reset flows.
//
// Rules:
// - existingConfig is treated as the stored config before the update.
// - incomingConfig is treated as the config submitted by the caller.
// - incoming fields override existing fields.
// - openclaw_app_secret is preserved from incoming first, then existing.
// - when generateIfMissing is true and no secret is present, a new secret is generated.
func MergeOpenClawCustomConfig(existingConfig, incomingConfig string, generateIfMissing bool) (string, error) {
	merged := make(map[string]interface{})

	existingMap, err := parseOpenClawCustomConfig(existingConfig)
	if err != nil {
		return "", fmt.Errorf("parse existing custom_config: %w", err)
	}
	for key, value := range existingMap {
		merged[key] = value
	}

	incomingMap, err := parseOpenClawCustomConfig(incomingConfig)
	if err != nil {
		return "", fmt.Errorf("parse incoming custom_config: %w", err)
	}
	for key, value := range incomingMap {
		merged[key] = value
	}

	if secret, ok := openClawSecretFromMap(incomingMap); ok {
		merged[openClawAppSecretKey] = secret
	} else if secret, ok := openClawSecretFromMap(existingMap); ok {
		merged[openClawAppSecretKey] = secret
	} else if generateIfMissing {
		merged[openClawAppSecretKey] = GenerateOpenClawAppSecret()
	}

	if len(merged) == 0 {
		return "{}", nil
	}

	bytes, err := json.Marshal(merged)
	if err != nil {
		return "", fmt.Errorf("marshal merged custom_config: %w", err)
	}
	return string(bytes), nil
}

func parseOpenClawCustomConfig(config string) (map[string]interface{}, error) {
	if config == "" {
		return map[string]interface{}{}, nil
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(config), &parsed); err != nil {
		return nil, err
	}
	if parsed == nil {
		parsed = make(map[string]interface{})
	}
	return parsed, nil
}

func openClawSecretFromMap(config map[string]interface{}) (interface{}, bool) {
	if config == nil {
		return nil, false
	}

	secret, ok := config[openClawAppSecretKey]
	if !ok || secret == nil {
		return nil, false
	}

	if secretStr, ok := secret.(string); ok && secretStr == "" {
		return nil, false
	}

	return secret, true
}
