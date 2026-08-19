package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/53AI/53AIHub/model"
)

var ErrInsightPerspectiveForbidden = errors.New("无权修改该文件的洞察视角")
var ErrInvalidInsightPerspective = errors.New("不支持的洞察视角")

// SetFileInsightPerspective 设置文件后续生成决策洞察时采用的视角。
// 视角只改变洞察分析方式，不会自动触发重新生成。
func SetFileInsightPerspective(ctx context.Context, eid, userID, fileID int64, rawPerspective string) (model.InsightPerspective, error) {
	if !model.IsValidInsightPerspective(rawPerspective) {
		return "", fmt.Errorf("%w: %s", ErrInvalidInsightPerspective, rawPerspective)
	}

	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return "", err
	}
	if file.UserID != userID {
		return "", ErrInsightPerspectiveForbidden
	}

	permission, err := GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, file.LibraryID, userID)
	if err != nil {
		return "", err
	}
	if permission < model.PERMISSION_EDIT_KNOWLEDGE {
		return "", ErrInsightPerspectiveForbidden
	}

	perspective := model.NormalizeInsightPerspective(rawPerspective)
	if err := model.DB.WithContext(ctx).Model(&model.File{}).
		Where("id = ? AND eid = ? AND user_id = ?", fileID, eid, userID).
		Update("insight_perspective", string(perspective)).Error; err != nil {
		return "", err
	}
	return perspective, nil
}
