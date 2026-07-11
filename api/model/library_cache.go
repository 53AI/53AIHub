package model

var libraryCacheInvalidator func(eid int64)
var libraryCacheLoader func(eid int64) ([]Library, error)

// SetLibraryCacheInvalidator sets the callback used to invalidate the eid-level library snapshot cache.
func SetLibraryCacheInvalidator(invalidator func(eid int64)) {
	libraryCacheInvalidator = invalidator
}

// SetLibraryCacheLoader sets the callback used to load eid-level library snapshots.
func SetLibraryCacheLoader(loader func(eid int64) ([]Library, error)) {
	libraryCacheLoader = loader
}

func invalidateLibraryCache(eid int64) {
	if eid <= 0 || libraryCacheInvalidator == nil {
		return
	}
	libraryCacheInvalidator(eid)
}

// GetLibrariesByEidCached returns all libraries for the eid, using a shared loader when available.
func GetLibrariesByEidCached(eid int64) ([]Library, error) {
	if eid <= 0 {
		return []Library{}, nil
	}
	if libraryCacheLoader != nil {
		return libraryCacheLoader(eid)
	}
	return GetLibrariesByEidFromDB(eid)
}

// GetLibrariesByEidFromDB loads all libraries for the eid directly from the database.
func GetLibrariesByEidFromDB(eid int64) ([]Library, error) {
	var libraries []Library
	if err := DB.Where("eid = ?", eid).
		Order("sort asc, created_time desc").
		Find(&libraries).Error; err != nil {
		return nil, err
	}
	return libraries, nil
}

// GetLibrariesByEidSnapshotForCache is retained for callers that need a cache loader-friendly DB snapshot.
// It is intentionally identical to GetLibrariesByEidFromDB.
func GetLibrariesByEidSnapshotForCache(eid int64) ([]Library, error) {
	return GetLibrariesByEidFromDB(eid)
}
