package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

type WikiLibraryClearSnapshot struct {
	Library   model.Library
	PageIDs   []int64
	VectorIDs []string
	Pages     int64
	Versions  int64
	Chunks    int64
	Sources   int64
	Pending   int64
}

func InspectWikiLibraryClear(ctx context.Context, db *gorm.DB, eid, libraryID int64) (*WikiLibraryClearSnapshot, error) {
	if db == nil || eid <= 0 || libraryID <= 0 {
		return nil, errors.New("eid and library_id are required")
	}
	var library model.Library
	if err := db.WithContext(ctx).Where("eid = ? AND id = ?", eid, libraryID).First(&library).Error; err != nil {
		return nil, fmt.Errorf("load target library: %w", err)
	}
	snapshot := &WikiLibraryClearSnapshot{Library: library}
	pages := db.WithContext(ctx).Model(&model.WikiPage{}).Select("id").Where("eid = ? AND library_id = ?", eid, libraryID)
	if err := db.WithContext(ctx).Model(&model.WikiPage{}).Where("eid = ? AND library_id = ?", eid, libraryID).Order("id ASC").Pluck("id", &snapshot.PageIDs).Error; err != nil {
		return nil, err
	}
	if err := db.WithContext(ctx).Model(&model.WikiPage{}).Where("eid = ? AND library_id = ?", eid, libraryID).Count(&snapshot.Pages).Error; err != nil {
		return nil, err
	}
	if err := db.WithContext(ctx).Model(&model.WikiPageVersion{}).Where("eid = ? AND page_id IN (?)", eid, pages).Count(&snapshot.Versions).Error; err != nil {
		return nil, err
	}
	if err := db.WithContext(ctx).Model(&model.WikiPageChunk{}).Where("eid = ? AND wiki_page_id IN (?)", eid, pages).Count(&snapshot.Chunks).Error; err != nil {
		return nil, err
	}
	if err := db.WithContext(ctx).Model(&model.WikiPageSource{}).Where("eid = ? AND page_id IN (?)", eid, pages).Count(&snapshot.Sources).Error; err != nil {
		return nil, err
	}
	if err := db.WithContext(ctx).Model(&model.WikiPageChunk{}).Where("eid = ? AND wiki_page_id IN (?) AND vector_id <> ?", eid, pages, "").Order("id ASC").Pluck("vector_id", &snapshot.VectorIDs).Error; err != nil {
		return nil, err
	}
	fileIDs := db.WithContext(ctx).Model(&model.File{}).Select("id").Where("eid = ? AND library_id = ?", eid, libraryID)
	if err := db.WithContext(ctx).Model(&model.RagJob{}).
		Where("eid = ? AND status IN ? AND ((type = ? AND related_id IN (?)) OR (type = ? AND related_id IN (?)))", eid,
			[]string{model.RagJobStatusPending, model.RagJobStatusProcessing}, "wiki_page_generation", fileIDs, "wiki_page_vectorization", pages).
		Count(&snapshot.Pending).Error; err != nil {
		return nil, err
	}
	var pendingOps int64
	if err := db.WithContext(ctx).Model(&model.WikiPendingOp{}).
		Where("eid = ? AND page_id IN (?) AND status IN ?", eid, pages, []string{model.WikiPendingOpStatusQueued, model.WikiPendingOpStatusProcessing}).
		Count(&pendingOps).Error; err != nil {
		return nil, err
	}
	snapshot.Pending += pendingOps
	return snapshot, nil
}

func DeleteWikiLibraryDatabase(ctx context.Context, db *gorm.DB, eid, libraryID int64) error {
	if db == nil || eid <= 0 || libraryID <= 0 {
		return errors.New("eid and library_id are required")
	}
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var library model.Library
		if err := tx.Where("eid = ? AND id = ?", eid, libraryID).First(&library).Error; err != nil {
			return err
		}
		pages := tx.Model(&model.WikiPage{}).Select("id").Where("eid = ? AND library_id = ?", eid, libraryID)
		versions := tx.Model(&model.WikiPageVersion{}).Select("id").Where("eid = ? AND page_id IN (?)", eid, pages)
		if err := tx.Where("eid = ? AND wiki_page_id IN (?)", eid, pages).Delete(&model.WikiPageChunk{}).Error; err != nil {
			return err
		}
		if err := tx.Where("eid = ? AND page_id IN (?)", eid, pages).Delete(&model.WikiPageCategory{}).Error; err != nil {
			return err
		}
		if err := tx.Where("eid = ? AND page_id IN (?)", eid, pages).Delete(&model.WikiPageSource{}).Error; err != nil {
			return err
		}
		if err := tx.Where("eid = ? AND (from_page_id IN (?) OR to_page_id IN (?))", eid, pages, pages).Delete(&model.WikiPageLink{}).Error; err != nil {
			return err
		}
		if err := tx.Where("eid = ? AND page_id IN (?)", eid, pages).Delete(&model.WikiPendingOp{}).Error; err != nil {
			return err
		}
		if err := tx.Where("eid = ? AND page_id IN (?)", eid, pages).Delete(&model.WikiDeadLetter{}).Error; err != nil {
			return err
		}
		if err := tx.Where("eid = ? AND (knowledge_base_id = ? OR page_id IN (?) OR version_id IN (?))", eid, library.UUID, pages, versions).Delete(&model.WikiLogEntry{}).Error; err != nil {
			return err
		}
		if err := tx.Where("eid = ? AND resource_type = ? AND resource_id IN (?)", eid, model.RESOURCE_TYPE_WIKI_PAGE, pages).Delete(&model.Permission{}).Error; err != nil {
			return err
		}
		if err := tx.Where("resource_type = ? AND resource_id IN (?)", model.RESOURCE_TYPE_WIKI_PAGE, pages).Delete(&model.Favorite{}).Error; err != nil {
			return err
		}
		if err := tx.Where("eid = ? AND resource_type = ? AND resource_id IN (?)", eid, model.RESOURCE_TYPE_WIKI_PAGE, pages).Delete(&model.UserRecentUsed{}).Error; err != nil {
			return err
		}
		if err := tx.Where("eid = ? AND library_id = ?", eid, libraryID).Delete(&model.WikiPageRedirect{}).Error; err != nil {
			return err
		}
		if err := tx.Where("eid = ? AND page_id IN (?)", eid, pages).Delete(&model.WikiPageVersion{}).Error; err != nil {
			return err
		}
		if err := tx.Where("eid = ? AND library_id = ?", eid, libraryID).Delete(&model.WikiPage{}).Error; err != nil {
			return err
		}
		return tx.Where("eid = ? AND library_id = ?", eid, libraryID).Delete(&model.WikiFolder{}).Error
	})
	if err == nil {
		model.InvalidateCapabilityWiki(eid, libraryID)
	}
	return err
}
