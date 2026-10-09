package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/model"
)

var ErrInsightPerspectiveForbidden = errors.New("无权修改该文件的洞察视角")
var ErrInvalidInsightPerspective = errors.New("不支持的洞察视角")

// SetFileInsightPerspective 设置文件后续生成决策洞察时采用的视角。
// 视角只改变洞察分析方式，不会自动触发重新生成。
func SetFileInsightPerspective(ctx context.Context, eid, userID, fileID int64, rawPerspective string) (model.InsightPerspective, error) {
	perspective, _, _, err := SetFileSceneAndMode(ctx, eid, userID, fileID, rawPerspective, "")
	return perspective, err
}

// SetFileSceneAndMode 分别修改文件的生效场景与会议模式。
// rawScene 为空表示不修改场景；rawScene=auto 表示清空场景、恢复自动识别；rawMode 为空表示不修改模式。
func SetFileSceneAndMode(ctx context.Context, eid, userID, fileID int64, rawScene, rawMode string) (model.InsightPerspective, string, string, error) {
	sceneRaw := strings.TrimSpace(rawScene)
	modeRaw := strings.ToLower(strings.TrimSpace(rawMode))
	if sceneRaw == "" && modeRaw == "" {
		return "", "", "", fmt.Errorf("%w: scene 与 mode 至少提供一个", ErrInvalidInsightPerspective)
	}
	if sceneRaw != "" && !model.IsValidInsightPerspective(sceneRaw) {
		return "", "", "", fmt.Errorf("%w: %s", ErrInvalidInsightPerspective, sceneRaw)
	}
	if modeRaw != "" && !model.IsValidSceneMode(model.SceneMode(modeRaw)) {
		return "", "", "", fmt.Errorf("%w: %s", ErrInvalidInsightPerspective, modeRaw)
	}

	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return "", "", "", err
	}
	if file.UserID != userID {
		return "", "", "", ErrInsightPerspectiveForbidden
	}
	permission, err := GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, file.LibraryID, userID)
	if err != nil {
		return "", "", "", err
	}
	if permission < model.PERMISSION_EDIT_KNOWLEDGE {
		return "", "", "", ErrInsightPerspectiveForbidden
	}

	var background InsightBackground
	if strings.TrimSpace(string(file.InsightContext)) != "" {
		_ = json.Unmarshal([]byte(file.InsightContext), &background)
	}
	updates := map[string]interface{}{}
	perspective := model.NormalizeInsightPerspective(file.InsightPerspective)
	sceneOut, modeOut := background.Scene, background.SceneMode

	if sceneRaw != "" {
		perspective = model.NormalizeInsightPerspective(sceneRaw)
		if string(perspective) == string(model.InsightPerspectiveAuto) {
			updates["scene"] = ""
			background.Scene = ""
			background.SceneMode = ""
			background.SceneSource = ""
			background.SceneModeSource = ""
			background.SceneConfidence = 0
			background.SceneAbstained = false
			background.SceneReason = ""
			sceneOut, modeOut = "", ""
		} else {
			sceneCode := model.ResolveSceneFromCode(string(perspective))
			if !model.IsCanonicalScene(sceneCode) {
				return "", "", "", fmt.Errorf("%w: %s", ErrInvalidInsightPerspective, sceneRaw)
			}
			updates["scene"] = string(sceneCode)
			background.Scene = string(sceneCode)
			background.SceneSource = "user"
			background.SceneConfidence = 0
			background.SceneAbstained = false
			background.SceneReason = ""
			sceneOut = string(sceneCode)
			if modeRaw == "" && background.SceneModeSource != "user" {
				background.SceneMode = ""
				background.SceneModeSource = ""
				modeOut = ""
			}
		}
		updates["insight_perspective"] = string(perspective)
	}
	if modeRaw != "" {
		background.SceneMode = modeRaw
		background.SceneModeSource = "user"
		modeOut = modeRaw
	}
	data, err := json.Marshal(background)
	if err != nil {
		return "", "", "", err
	}
	updates["insight_context"] = string(data)
	if err := model.DB.WithContext(ctx).Model(&model.File{}).
		Where("id = ? AND eid = ? AND user_id = ?", fileID, eid, userID).
		Updates(updates).Error; err != nil {
		return "", "", "", err
	}
	return perspective, sceneOut, modeOut, nil
}
