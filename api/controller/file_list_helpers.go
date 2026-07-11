package controller

import (
	"errors"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/model"
)

func parseFileTypeFilter(raw string) (*int, error) {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	if normalized == "" {
		return nil, errors.New("type不能为空")
	}

	switch normalized {
	case "dir", "folder":
		v := model.FILE_TYPE_DIR
		return &v, nil
	case "file":
		v := model.FILE_TYPE_FILE
		return &v, nil
	default:
		parsed, err := strconv.Atoi(normalized)
		if err != nil {
			return nil, errors.New("无效的type参数")
		}
		if parsed != model.FILE_TYPE_DIR && parsed != model.FILE_TYPE_FILE {
			return nil, errors.New("无效的type参数")
		}
		return &parsed, nil
	}
}
