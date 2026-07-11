package service

import (
	"errors"

	enterprise_init "github.com/53AI/53AIHub/service/enterpriseinit"

	"github.com/53AI/53AIHub/model"
)

// EnsureEnterprisePostInit runs the shared enterprise post-initialization flow in a transaction.
func EnsureEnterprisePostInit(eid int64, adminUser *model.User) error {
	if adminUser == nil {
		return errors.New("admin user is nil")
	}

	enterprise, err := model.GetEnterpriseByID(eid)
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

	if err := enterprise_init.EnsureEnterprisePostInit(tx, enterprise, adminUser); err != nil {
		tx.Rollback()
		return err
	}

	if err := tx.Commit().Error; err != nil {
		return err
	}
	invalidateLibraryCache(eid)
	return nil
}
