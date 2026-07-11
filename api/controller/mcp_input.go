package controller

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/53AI/53AIHub/common/utils/hashids"
)

type MCPHashID string

func (id *MCPHashID) UnmarshalJSON(data []byte) error {
	parsed, err := parseMCPHashIDJSON(data)
	if err != nil {
		return err
	}
	*id = MCPHashID(parsed)
	return nil
}

func (id MCPHashID) Int64() int64 {
	decoded, err := hashids.Decode(string(id))
	if err != nil {
		return 0
	}
	return decoded
}

func (id MCPHashID) String() string {
	return string(id)
}

func (id MCPHashID) Ptr() *string {
	value := string(id)
	return &value
}

func parseMCPHashIDJSON(data []byte) (string, error) {
	data = bytes.TrimSpace(data)
	if len(data) == 0 || bytes.Equal(data, []byte("null")) {
		return "", fmt.Errorf("ID 不能为空")
	}

	var raw string
	if err := json.Unmarshal(data, &raw); err != nil {
		return "", fmt.Errorf("ID 必须使用 HashID")
	}
	if raw == "" {
		return "", fmt.Errorf("ID 不能为空")
	}
	if _, err := hashids.Decode(raw); err != nil {
		return "", err
	}
	return raw, nil
}

func MCPHashIDsToInt64(ids []MCPHashID) []int64 {
	if len(ids) == 0 {
		return []int64{}
	}

	result := make([]int64, len(ids))
	for i, id := range ids {
		result[i] = id.Int64()
	}
	return result
}
