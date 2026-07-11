package mcp

import (
	"context"
	"errors"

	"github.com/53AI/53AIHub/model"
	core "github.com/53AI/53AIHub/service"
)

type LibraryService struct{}

func NewLibraryService() *LibraryService {
	return &LibraryService{}
}

func (s *LibraryService) ListVisibleLibraries(ctx context.Context, eid, userID int64, name string, status *int, spaceID *int64, offset, limit int, withFileCount bool) (int64, []model.Library, error) {
	lps := core.NewLibraryPermissionService(eid)
	return lps.GetUserLibraries(userID, name, status, spaceID, offset, limit, withFileCount)
}

func (s *LibraryService) GetVisibleLibraryDetail(ctx context.Context, eid, userID int64, libraryID int64) (*model.Library, error) {
	library, err := model.GetLibraryByID(eid, libraryID)
	if err != nil {
		return nil, err
	}
	if library == nil {
		return nil, errors.New("知识库不存在")
	}

	permission, err := core.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, library.ID, userID)
	if err != nil {
		return nil, err
	}
	library.Permission = permission
	if isFav, err := model.IsFavorited(userID, model.RESOURCE_TYPE_LIBRARY, library.ID); err == nil {
		library.IsFavorite = isFav
	}
	return library, nil
}

func (s *LibraryService) CreateLibrary(ctx context.Context, eid, userID int64, name, description, icon string, spaceID int64, visibility *int, permissions []*model.PermissionData) (*model.Library, error) {
	permission, err := core.GetUserPermission(eid, model.RESOURCE_TYPE_SPACE, spaceID, userID)
	if err != nil || permission < model.PERMISSION_EDIT_KNOWLEDGE {
		if err != nil {
			return nil, err
		}
		return nil, errors.New("没有在该空间创建知识库的权限")
	}

	libraryVisibility := model.LIBRARY_VISIBILITY_INHERIT
	if visibility != nil {
		if *visibility < model.LIBRARY_VISIBILITY_INHERIT || *visibility > model.LIBRARY_VISIBILITY_PRIVATE {
			return nil, errors.New("无效的可见性设置")
		}
		libraryVisibility = *visibility
	}

	library := &model.Library{
		Name:        name,
		Description: description,
		Icon:        icon,
		SpaceID:     spaceID,
		Eid:         eid,
		CreatorID:   userID,
		Status:      model.LIBRARY_STATUS_ACTIVE,
		Sort:        0,
		Visibility:  libraryVisibility,
	}
	if err := library.Save(); err != nil {
		return nil, err
	}

	libraryPermissionService := core.NewLibraryPermissionService(eid)
	_ = libraryPermissionService.AddLibraryCreatorPermission(library.ID, userID, permissions)

	return library, nil
}

func (s *LibraryService) UpdateLibrary(ctx context.Context, eid, userID int64, libraryID int64, name, description, icon string, visibility *int) (*model.Library, error) {
	permission, err := core.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, libraryID, userID)
	if err != nil || permission < model.PERMISSION_EDIT_KNOWLEDGE {
		if err != nil {
			return nil, err
		}
		return nil, errors.New("没有权限修改此知识库")
	}

	library, err := model.GetLibraryByID(eid, libraryID)
	if err != nil {
		return nil, err
	}
	if library == nil {
		return nil, errors.New("知识库不存在")
	}

	library.Name = name
	library.Description = description
	library.Icon = icon
	if visibility != nil {
		if *visibility < model.LIBRARY_VISIBILITY_INHERIT || *visibility > model.LIBRARY_VISIBILITY_PRIVATE {
			return nil, errors.New("无效的可见性设置")
		}
		library.Visibility = *visibility
	}

	if err := library.Update(); err != nil {
		return nil, err
	}

	return library, nil
}

func (s *LibraryService) DeleteLibrary(ctx context.Context, eid, userID int64, libraryID int64) error {
	permission, err := core.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, libraryID, userID)
	if err != nil || permission < model.PERMISSION_MANAGE {
		if err != nil {
			return err
		}
		return errors.New("没有权限删除此知识库")
	}
	return model.DeleteLibrary(eid, libraryID)
}

func (s *LibraryService) BatchUpdateSort(ctx context.Context, eid int64, sortList []struct {
	ID   int64 `json:"id" binding:"required"`
	Sort int64 `json:"sort" binding:"required"`
}) error {
	return model.BatchUpdateLibrarySort(eid, sortList)
}
