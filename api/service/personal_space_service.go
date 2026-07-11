package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

const (
	personalSpaceCompanyPermission = model.PERMISSION_VIEW_ONLY
	personalSpaceInitLockTTL       = 5 * time.Minute
)

var ErrPersonalWorkspaceInitializing = errors.New("personal workspace is initializing, please retry later")

var personalWorkspaceFallbackLocker = common.NewLocalLock()

type PersonalSpaceService struct {
	Eid int64
}

func NewPersonalSpaceService(eid int64) *PersonalSpaceService {
	return &PersonalSpaceService{Eid: eid}
}

func (s *PersonalSpaceService) EnsurePersonalWorkspace(ctx context.Context, userID int64) (*model.Space, *model.Library, error) {
	var space *model.Space
	var library *model.Library

	if err := s.withPersonalSpaceInitLock(ctx, func() error {
		enterpriseOwner, err := model.GetEnterpriseCreatorUser(s.Eid)
		if err != nil {
			return err
		}

		tx := model.DB.Begin()
		if tx.Error != nil {
			return tx.Error
		}
		defer func() {
			if r := recover(); r != nil {
				tx.Rollback()
			}
		}()

		space, err = s.ensurePersonalSpaceInTx(ctx, tx, enterpriseOwner)
		if err != nil {
			tx.Rollback()
			return err
		}

		if err := s.withPersonalLibraryInitLock(ctx, userID, func() error {
			var innerErr error
			library, innerErr = s.ensurePersonalLibraryInTx(ctx, tx, userID, space.ID)
			if innerErr != nil {
				return innerErr
			}
			if err := tx.Commit().Error; err != nil {
				return err
			}
			invalidateLibraryCache(s.Eid)
			return nil
		}); err != nil {
			tx.Rollback()
			return err
		}

		logger.Infof(ctx, "【个人空间】创建/更新企业个人空间成功: eid=%d owner_id=%d space_id=%d", s.Eid, enterpriseOwner.UserID, space.ID)
		logger.Infof(ctx, "【个人空间】创建/更新个人知识库成功: eid=%d creator_id=%d library_id=%d", s.Eid, userID, library.ID)
		return nil
	}); err != nil {
		return nil, nil, err
	}

	return space, library, nil
}

func (s *PersonalSpaceService) EnsurePersonalSpace(ctx context.Context) (*model.Space, error) {
	var space *model.Space
	if err := s.withPersonalSpaceInitLock(ctx, func() error {
		enterpriseOwner, err := model.GetEnterpriseCreatorUser(s.Eid)
		if err != nil {
			return err
		}

		tx := model.DB.Begin()
		if tx.Error != nil {
			return tx.Error
		}
		defer func() {
			if r := recover(); r != nil {
				tx.Rollback()
			}
		}()

		space, err = s.ensurePersonalSpaceInTx(ctx, tx, enterpriseOwner)
		if err != nil {
			tx.Rollback()
			return err
		}

		if err := tx.Commit().Error; err != nil {
			return err
		}
		invalidateLibraryCache(s.Eid)

		logger.Infof(ctx, "【个人空间】创建/更新企业个人空间成功: eid=%d owner_id=%d space_id=%d", s.Eid, enterpriseOwner.UserID, space.ID)
		return nil
	}); err != nil {
		return nil, err
	}
	return space, nil
}

func (s *PersonalSpaceService) EnsurePersonalLibrary(ctx context.Context, creatorID int64, spaceID int64) (*model.Library, error) {
	if creatorID <= 0 {
		return nil, fmt.Errorf("creator id is required")
	}
	if spaceID <= 0 {
		return nil, fmt.Errorf("space id is required")
	}

	var library *model.Library
	err := s.withPersonalLibraryInitLock(ctx, creatorID, func() error {
		tx := model.DB.Begin()
		if tx.Error != nil {
			return tx.Error
		}
		defer func() {
			if r := recover(); r != nil {
				tx.Rollback()
			}
		}()

		var innerErr error
		library, innerErr = s.ensurePersonalLibraryInTx(ctx, tx, creatorID, spaceID)
		if innerErr != nil {
			tx.Rollback()
			return innerErr
		}

		if err := tx.Commit().Error; err != nil {
			return err
		}
		invalidateLibraryCache(s.Eid)

		logger.Infof(ctx, "【个人空间】创建/更新个人知识库成功: eid=%d creator_id=%d library_id=%d", s.Eid, creatorID, library.ID)
		return nil
	})
	if err != nil {
		return nil, err
	}

	return library, nil
}

func (s *PersonalSpaceService) GetExistingPersonalLibrary(ctx context.Context, userID int64) (*model.Library, error) {
	library, err := model.GetPersonalLibraryByEidAndCreator(s.Eid, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return library, nil
}

func (s *PersonalSpaceService) withPersonalSpaceInitLock(ctx context.Context, fn func() error) error {
	lockName := model.PersonalSpaceInitLockKey(s.Eid)
	locker := s.getInitLocker()
	if locker == nil {
		return fn()
	}
	if !locker.TryLock(lockName, personalSpaceInitLockTTL) {
		return ErrPersonalWorkspaceInitializing
	}
	defer locker.Unlock(lockName)
	return fn()
}

func (s *PersonalSpaceService) withPersonalLibraryInitLock(ctx context.Context, creatorID int64, fn func() error) error {
	lockName := model.PersonalLibraryInitLockKey(s.Eid, creatorID)
	locker := s.getInitLocker()
	if locker == nil {
		return fn()
	}
	if !locker.TryLock(lockName, personalSpaceInitLockTTL) {
		return ErrPersonalWorkspaceInitializing
	}
	defer locker.Unlock(lockName)
	return fn()
}

func (s *PersonalSpaceService) getInitLocker() common.Locker {
	if common.LOCKER != nil {
		return common.LOCKER
	}
	return personalWorkspaceFallbackLocker
}

func (s *PersonalSpaceService) ensurePersonalSpaceInTx(ctx context.Context, tx *gorm.DB, enterpriseOwner *model.User) (*model.Space, error) {
	var space model.Space
	if err := tx.Where("eid = ? AND space_kind = ?", s.Eid, model.SPACE_KIND_PERSONAL_COMPANY).First(&space).Error; err == nil {
		if space.OwnerID != enterpriseOwner.UserID {
			if err := tx.Model(&model.Space{}).Where("eid = ? AND id = ?", s.Eid, space.ID).Update("owner_id", enterpriseOwner.UserID).Error; err != nil {
				return nil, err
			}
			space.OwnerID = enterpriseOwner.UserID
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	if space.ID == 0 {
		space = model.Space{
			Eid:         s.Eid,
			Name:        fmt.Sprintf(model.PersonalSpaceNamePattern, s.Eid),
			Description: "系统创建的企业个人空间",
			OwnerID:     enterpriseOwner.UserID,
			SpaceKind:   model.SPACE_KIND_PERSONAL_COMPANY,
			Status:      model.SPACE_STATUS_ACTIVE,
			Sort:        0,
			Visibility:  model.SPACE_VISIBILITY_PRIVATE,
		}
		if err := space.SaveWithTx(tx); err != nil {
			return nil, err
		}
	}

	if err := s.ensureSpacePermissionInTx(tx, space.ID, model.SUBJECT_TYPE_USER, enterpriseOwner.UserID, model.PERMISSION_MANAGE); err != nil {
		return nil, err
	}
	if err := s.ensureSpacePermissionInTx(tx, space.ID, model.SUBJECT_TYPE_COMPANY_ALL, 0, personalSpaceCompanyPermission); err != nil {
		return nil, err
	}

	return &space, nil
}

func (s *PersonalSpaceService) ensurePersonalLibraryInTx(ctx context.Context, tx *gorm.DB, creatorID int64, spaceID int64) (*model.Library, error) {
	var library model.Library
	if err := tx.Where("eid = ? AND creator_id = ? AND library_kind = ?", s.Eid, creatorID, model.LIBRARY_KIND_PERSONAL_USER).First(&library).Error; err == nil {
		if library.SpaceID != spaceID {
			if err := tx.Model(&model.Library{}).Where("eid = ? AND id = ?", s.Eid, library.ID).Update("space_id", spaceID).Error; err != nil {
				return nil, err
			}
			library.SpaceID = spaceID
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	if library.ID == 0 {
		library = model.Library{
			Eid:         s.Eid,
			SpaceID:     spaceID,
			CreatorID:   creatorID,
			Name:        fmt.Sprintf(model.PersonalLibraryNamePattern, creatorID),
			Description: "系统创建的个人知识库",
			LibraryKind: model.LIBRARY_KIND_PERSONAL_USER,
			Status:      model.LIBRARY_STATUS_ACTIVE,
			Visibility:  model.LIBRARY_VISIBILITY_PRIVATE,
			Sort:        0,
		}
		if err := library.SaveWithTx(tx); err != nil {
			return nil, err
		}
	}

	if err := s.ensureLibraryPermissionInTx(tx, library.ID, creatorID, model.PERMISSION_MANAGE); err != nil {
		return nil, err
	}

	return &library, nil
}

func (s *PersonalSpaceService) ensureSpacePermissionInTx(tx *gorm.DB, resourceID int64, subjectType int, subjectID int64, permission int) error {
	var existing model.Permission
	err := tx.Where("eid = ? AND resource_type = ? AND resource_id = ? AND subject_type = ? AND subject_id = ?",
		s.Eid, model.RESOURCE_TYPE_SPACE, resourceID, subjectType, subjectID).First(&existing).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		return tx.Create(&model.Permission{
			Eid:          s.Eid,
			ResourceType: model.RESOURCE_TYPE_SPACE,
			ResourceID:   resourceID,
			SubjectType:  subjectType,
			SubjectID:    subjectID,
			Permission:   permission,
		}).Error
	}
	if existing.Permission != permission {
		return tx.Model(&model.Permission{}).Where("id = ?", existing.ID).Update("permission", permission).Error
	}
	return nil
}

func (s *PersonalSpaceService) ensureLibraryPermissionInTx(tx *gorm.DB, resourceID int64, subjectID int64, permission int) error {
	var existing model.Permission
	err := tx.Where("eid = ? AND resource_type = ? AND resource_id = ? AND subject_type = ? AND subject_id = ?",
		s.Eid, model.RESOURCE_TYPE_LIBRARY, resourceID, model.SUBJECT_TYPE_USER, subjectID).First(&existing).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		return tx.Create(&model.Permission{
			Eid:          s.Eid,
			ResourceType: model.RESOURCE_TYPE_LIBRARY,
			ResourceID:   resourceID,
			SubjectType:  model.SUBJECT_TYPE_USER,
			SubjectID:    subjectID,
			Permission:   permission,
		}).Error
	}
	if existing.Permission != permission {
		return tx.Model(&model.Permission{}).Where("id = ?", existing.ID).Update("permission", permission).Error
	}
	return nil
}
