package model

import "fmt"

const (
	LockOrganizationKeyPre        = "lock_enterprise_organization_sync"
	LockPersonalSpaceInitKeyPre   = "lock_enterprise_personal_space_init"
	LockPersonalLibraryInitKeyPre = "lock_enterprise_personal_library_init"
)

func PersonalSpaceInitLockKey(eid int64) string {
	return LockPersonalSpaceInitKeyPre + ":" + fmt.Sprint(eid)
}

func PersonalLibraryInitLockKey(eid int64, userID int64) string {
	return LockPersonalLibraryInitKeyPre + ":" + fmt.Sprint(eid) + ":" + fmt.Sprint(userID)
}
