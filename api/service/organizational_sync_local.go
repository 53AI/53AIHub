//go:build !saas

package service

import "github.com/53AI/53AIHub/model"

func runWeComSyncOrganization(e *model.Enterprise, params SyncOrganizationParams) error {
	return nil
}

func runDingtalkSyncOrganization(e *model.Enterprise, params SyncOrganizationParams) error {
	return nil
}

