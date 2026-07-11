package mcp

import (
	"context"
	"errors"

	"github.com/53AI/53AIHub/model"
	core "github.com/53AI/53AIHub/service"
)

type SpaceService struct{}

func NewSpaceService() *SpaceService {
	return &SpaceService{}
}

func (s *SpaceService) ListVisibleSpaces(ctx context.Context, eid, userID int64, status int, name string, offset, limit int, view string, admin bool) (int64, []model.Space, error) {
	count, spaces, err := s.GetSpaces(ctx, eid, userID, status, name, offset, limit, view, admin)
	if err != nil {
		return 0, nil, err
	}
	return count, spaces, nil
}

func (s *SpaceService) GetVisibleSpaceDetail(ctx context.Context, eid, userID int64, spaceID int64, admin bool) (*model.Space, error) {
	space, err := s.GetSpace(ctx, eid, userID, spaceID, admin)
	if err != nil {
		return nil, err
	}
	space.LoadOwnerInfo(eid)
	space.LoadLibraryCount(eid)
	return space, nil
}

func (s *SpaceService) CreateSpace(ctx context.Context, eid, userID int64, name, description, icon string, visibility int, permissions []*model.PermissionData) (*model.Space, error) {
	if visibility != model.SPACE_VISIBILITY_PRIVATE {
		visibility = model.SPACE_VISIBILITY_PUBLIC
	}

	space := &model.Space{
		Eid:         eid,
		Name:        name,
		Description: description,
		Icon:        icon,
		OwnerID:     userID,
		Status:      model.SPACE_STATUS_ACTIVE,
		Visibility:  visibility,
		Sort:        0,
	}
	if err := space.Save(); err != nil {
		return nil, err
	}

	spacePermissionService := core.NewSpacePermissionService(eid)
	_ = spacePermissionService.AddSpaceCreatorPermission(space.ID, userID, permissions)
	_ = spacePermissionService.CreateSpaceDefaultPermissions(space)

	return space, nil
}

func (s *SpaceService) GetSpaces(ctx context.Context, eid, userID int64, status int, name string, offset, limit int, view string, admin bool) (int64, []model.Space, error) {
	spacePermissionService := core.NewSpacePermissionService(eid)
	if view == "user" {
		return spacePermissionService.GetUserSpaces(userID, status, name, offset, limit)
	}
	if !admin {
		return 0, nil, errors.New("无权限查看后台空间列表")
	}
	return spacePermissionService.GetAdminSpaces(userID, status, name, offset, limit)
}

func (s *SpaceService) GetSpace(ctx context.Context, eid, userID int64, spaceID int64, admin bool) (*model.Space, error) {
	space, err := model.GetSpaceByID(eid, spaceID)
	if err != nil {
		return nil, err
	}
	if space == nil {
		return nil, errors.New("空间不存在")
	}

	if !admin {
		spacePermissionService := core.NewSpacePermissionService(eid)
		canView, permErr := spacePermissionService.CheckSpacePermission(userID, spaceID, model.PERMISSION_PUBLIC_ONLY)
		if permErr != nil {
			return nil, permErr
		}
		if !canView {
			return nil, errors.New("无权限访问此空间")
		}
		permission, err := core.GetUserPermission(eid, model.RESOURCE_TYPE_SPACE, spaceID, userID)
		if err != nil {
			return nil, err
		}
		space.Permission = permission
	} else {
		space.Permission = model.PERMISSION_MANAGE
	}

	return space, nil
}

func (s *SpaceService) UpdateSpace(ctx context.Context, eid, userID int64, spaceID int64, name, description, icon string, visibility int, permissions []*model.PermissionData, admin bool) (*model.Space, error) {
	space, err := model.GetSpaceByID(eid, spaceID)
	if err != nil {
		return nil, err
	}
	if space == nil {
		return nil, errors.New("空间不存在")
	}

	if !admin {
		spacePermissionService := core.NewSpacePermissionService(eid)
		canEdit, permErr := spacePermissionService.CheckSpacePermission(userID, spaceID, model.PERMISSION_MANAGE)
		if permErr != nil {
			return nil, permErr
		}
		if !canEdit {
			return nil, errors.New("无权限修改此空间")
		}
	}

	oldVisibility := space.Visibility
	space.Name = name
	space.Description = description
	space.Icon = icon
	space.Visibility = visibility

	spacePermissionService := core.NewSpacePermissionService(eid)
	if len(permissions) > 0 {
		if err := spacePermissionService.UpdateSpacePermissions(spaceID, userID, permissions); err != nil {
			return nil, err
		}
	}
	if err := spacePermissionService.UpdateSpaceVisibilityPermission(space, visibility); err != nil {
		return nil, err
	}

	if err := space.Update(); err != nil {
		return nil, err
	}

	if oldVisibility != space.Visibility {
		// Keep the returned entity aligned with persisted state.
	}
	return space, nil
}

func (s *SpaceService) DeleteSpace(ctx context.Context, eid, userID int64, spaceID int64, admin bool) error {
	if !admin {
		spacePermissionService := core.NewSpacePermissionService(eid)
		canDelete, permErr := spacePermissionService.CheckSpacePermission(userID, spaceID, model.PERMISSION_MANAGE)
		if permErr != nil {
			return permErr
		}
		if !canDelete {
			return errors.New("无权限删除此空间")
		}
	}
	return model.DeleteSpace(eid, spaceID)
}

func (s *SpaceService) BatchUpdateSort(ctx context.Context, eid int64, sortList []struct {
	ID   int64 `json:"id" binding:"required"`
	Sort int64 `json:"sort" binding:"required"`
}) error {
	return model.BatchUpdateSpaceSort(eid, sortList)
}
