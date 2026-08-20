package service

import (
	"context"
	"errors"

	"github.com/53AI/53AIHub/model"
)

var ErrRecordingFileForbidden = errors.New("recording file is not accessible")

// GetAccessibleRecordingFile 是安心录文件的统一访问边界。
// 当前产品仅支持个人库录音：文件创建者与当前用户必须一致；同时仍校验知识库权限，
// 为后续协作模型保留明确的升级位置。
func GetAccessibleRecordingFile(ctx context.Context, eid, userID, fileID int64, requireEdit bool) (*model.File, error) {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil || file == nil {
		return nil, err
	}
	if file.UserID != userID {
		return nil, ErrRecordingFileForbidden
	}
	permission, err := GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, file.LibraryID, userID)
	if err != nil {
		return nil, err
	}
	if (requireEdit && permission < model.PERMISSION_EDIT_KNOWLEDGE) || (!requireEdit && permission < model.PERMISSION_VIEW_ONLY) {
		return nil, ErrRecordingFileForbidden
	}
	return file, nil
}

// GetViewableRecordingFile 校验用户对文件所在知识库的查看权限，不要求文件创建者是当前用户。
// 供 parse-status 等"其他知识库也可用"的查询接口使用：安心录文件从仅个人库扩展到团队/共享库后，
// 只要用户对该知识库有查看权限即可读取（仍保留库权限判断，防止跨库越权探测）。
func GetViewableRecordingFile(ctx context.Context, eid, userID, fileID int64) (*model.File, error) {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil || file == nil {
		return nil, err
	}
	permission, err := GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, file.LibraryID, userID)
	if err != nil {
		return nil, err
	}
	if permission < model.PERMISSION_VIEW_ONLY {
		return nil, ErrRecordingFileForbidden
	}
	return file, nil
}
