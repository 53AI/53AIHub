package mcp

import (
	"context"
	"errors"
	"fmt"

	core "github.com/53AI/53AIHub/service"

	"github.com/53AI/53AIHub/model"
)

type APIKeyService struct{}

func NewAPIKeyService() *APIKeyService {
	return &APIKeyService{}
}

func (s *APIKeyService) CreateOwnedAPIKey(ctx context.Context, eid, userID int64, name, description string) (*model.APIKey, string, error) {
	keyValue := model.GenerateAPIKey(eid, userID)
	apiKey := &model.APIKey{
		Key:         keyValue,
		Name:        name,
		Description: description,
		Eid:         eid,
		CreatorID:   userID,
		Status:      model.APIKeyStatusActive,
	}
	if err := apiKey.Save(); err != nil {
		return nil, "", err
	}
	return apiKey, keyValue, nil
}

func (s *APIKeyService) ListOwnedAPIKeys(ctx context.Context, eid, userID int64) ([]model.APIKey, error) {
	return model.GetAPIKeysByEidAndCreatorID(eid, userID)
}

func (s *APIKeyService) GetOwnedAPIKey(ctx context.Context, eid, userID, keyID int64) (*model.APIKey, error) {
	return model.GetAPIKeyByIDAndCreatorID(eid, userID, keyID)
}

func (s *APIKeyService) DisableOwnedAPIKey(ctx context.Context, eid, userID, keyID int64) error {
	return model.DisableAPIKeyByCreatorID(eid, userID, keyID)
}

func (s *APIKeyService) DeleteOwnedAPIKey(ctx context.Context, eid, userID, keyID int64) error {
	return model.DeleteAPIKeyByCreatorID(eid, userID, keyID)
}

func (s *APIKeyService) CreateAPIKey(ctx context.Context, eid, userID int64, role int64, name, description string, libraryID *int64) (*model.APIKey, string, error) {
	spaceID, err := s.resolveAPIKeyScope(eid, userID, role, libraryID)
	if err != nil {
		return nil, "", err
	}

	keyValue := model.GenerateAPIKey(eid, userID)
	apiKey := &model.APIKey{
		Key:         keyValue,
		Name:        name,
		Description: description,
		Eid:         eid,
		CreatorID:   userID,
		LibraryID:   libraryID,
		SpaceID:     spaceID,
		Status:      model.APIKeyStatusActive,
	}

	if err := apiKey.Save(); err != nil {
		return nil, "", err
	}

	return apiKey, keyValue, nil
}

func (s *APIKeyService) ListAPIKeys(ctx context.Context, eid, userID int64, role int64, keyType string, libraryID *int64) ([]model.APIKey, error) {
	if libraryID != nil {
		if _, err := s.resolveAPIKeyScope(eid, userID, role, libraryID); err != nil {
			return nil, err
		}
		return model.GetAPIKeysByEidAndLibraryID(eid, *libraryID)
	}

	if role < model.RoleAdminUser {
		return []model.APIKey{}, nil
	}

	switch keyType {
	case "", "library":
		return model.GetAPIKeysByEidWithLibrary(eid)
	case "personal":
		return model.GetAPIKeysByEidAndCreatorIDWithoutLibrary(eid, userID)
	default:
		return nil, errors.New("无效的API密钥类型参数")
	}
}

func (s *APIKeyService) DeleteAPIKey(ctx context.Context, eid, userID int64, role int64, keyID int64, libraryID *int64) error {
	apiKey, err := model.GetAPIKeyByID(keyID)
	if err != nil {
		return err
	}
	if apiKey == nil {
		return errors.New("API密钥不存在")
	}

	if libraryID != nil {
		if apiKey.LibraryID == nil {
			return errors.New("该API密钥未关联任何知识库，无法通过知识库路径访问")
		}
		if *apiKey.LibraryID != *libraryID {
			return errors.New("路径中的知识库ID与API密钥关联的知识库ID不匹配")
		}
	}

	if err := s.ensureAPIKeyManagePermission(eid, userID, role, apiKey); err != nil {
		return err
	}

	return model.DeleteAPIKey(keyID)
}

func (s *APIKeyService) SetAPIKeyStatus(ctx context.Context, eid, userID int64, role int64, keyID int64, libraryID *int64, enabled bool) error {
	apiKey, err := model.GetAPIKeyByID(keyID)
	if err != nil {
		return err
	}
	if apiKey == nil {
		return errors.New("API密钥不存在")
	}

	if libraryID != nil {
		if apiKey.LibraryID == nil {
			return errors.New("该API密钥未关联任何知识库，无法通过知识库路径访问")
		}
		if *apiKey.LibraryID != *libraryID {
			return errors.New("路径中的知识库ID与API密钥关联的知识库ID不匹配")
		}
	}

	if err := s.ensureAPIKeyManagePermission(eid, userID, role, apiKey); err != nil {
		return err
	}

	if enabled {
		return model.EnableAPIKey(keyID)
	}
	return model.DisableAPIKey(keyID)
}

func (s *APIKeyService) resolveAPIKeyScope(eid, userID int64, role int64, libraryID *int64) (*int64, error) {
	if libraryID == nil {
		if role < model.RoleAdminUser {
			return nil, errors.New("您没有权限创建全局API密钥，请指定知识库ID")
		}
		return nil, nil
	}

	hasPerm, err := s.hasLibraryManagementPermission(eid, userID, *libraryID)
	if err != nil {
		return nil, err
	}
	if !hasPerm {
		return nil, errors.New("您没有权限为此知识库创建API密钥")
	}

	library, err := model.GetLibraryByID(eid, *libraryID)
	if err != nil {
		return nil, fmt.Errorf("获取知识库信息失败: %w", err)
	}
	if library == nil {
		return nil, errors.New("知识库不存在")
	}

	spaceID := library.SpaceID
	return &spaceID, nil
}

func (s *APIKeyService) ensureAPIKeyManagePermission(eid, userID int64, role int64, apiKey *model.APIKey) error {
	if apiKey == nil {
		return errors.New("API密钥不存在")
	}

	if apiKey.LibraryID != nil {
		hasPerm, err := s.hasLibraryManagementPermission(eid, userID, *apiKey.LibraryID)
		if err != nil {
			return err
		}
		if !hasPerm {
			return errors.New("您没有权限管理此API密钥")
		}
		return nil
	}

	if role < model.RoleAdminUser {
		return errors.New("您没有权限管理全局API密钥")
	}
	return nil
}

func (s *APIKeyService) hasLibraryManagementPermission(eid, userID, libraryID int64) (bool, error) {
	permission, err := core.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, libraryID, userID)
	if err != nil {
		return false, err
	}
	return permission >= model.PERMISSION_MANAGE, nil
}
