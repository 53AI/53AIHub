package model

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
)

const (
	KmKnowledgeMapStatFieldGenerateCount = "generate_count" // 知识地图生成次数
	KmKnowledgeMapStatFieldQueryCount    = "query_count"    // 知识地图查询次数
)

type KmKnowledgeMapStats struct {
	ID            int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid           int64 `json:"eid" gorm:"not null;index;uniqueIndex:uniq_km_knowledge_map_stats"`
	StatDate      int64 `json:"stat_date" gorm:"not null;index;uniqueIndex:uniq_km_knowledge_map_stats"`
	GenerateCount int64 `json:"generate_count" gorm:"type:bigint;not null;default:0"`
	QueryCount    int64 `json:"query_count" gorm:"type:bigint;not null;default:0"`
	BaseModel
}

func IncrementKmKnowledgeMapField(eid int64, fieldName string, increment int64) error {
	if increment == 0 {
		return nil
	}

	switch fieldName {
	case KmKnowledgeMapStatFieldGenerateCount, KmKnowledgeMapStatFieldQueryCount:
	default:
		return errors.New("无效的统计字段")
	}

	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()

	return DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&KmKnowledgeMapStats{}).
			Where("eid = ? AND stat_date = ?", eid, today).
			Updates(map[string]interface{}{
				fieldName:      gorm.Expr(fieldName+" + ?", increment),
				"updated_time": time.Now().UTC().UnixMilli(),
			})
		if result.Error != nil {
			return result.Error
		}

		if result.RowsAffected == 0 {
			stats := &KmKnowledgeMapStats{
				Eid:      eid,
				StatDate: today,
			}
			switch fieldName {
			case KmKnowledgeMapStatFieldGenerateCount:
				stats.GenerateCount = increment
			case KmKnowledgeMapStatFieldQueryCount:
				stats.QueryCount = increment
			}

			err := tx.Create(stats).Error
			if err != nil {
				if strings.Contains(err.Error(), "UNIQUE") || strings.Contains(err.Error(), "duplicate") {
					return tx.Model(&KmKnowledgeMapStats{}).
						Where("eid = ? AND stat_date = ?", eid, today).
						Updates(map[string]interface{}{
							fieldName:      gorm.Expr(fieldName+" + ?", increment),
							"updated_time": time.Now().UTC().UnixMilli(),
						}).Error
				}
				return err
			}
		}

		return nil
	})
}

func GetKmKnowledgeMapStatsByDateRange(eid int64, startDate, endDate time.Time) ([]*KmKnowledgeMapStats, error) {
	start := time.Date(startDate.Year(), startDate.Month(), startDate.Day(), 0, 0, 0, 0, startDate.Location()).Unix()
	end := time.Date(endDate.Year(), endDate.Month(), endDate.Day(), 23, 59, 59, 999999999, endDate.Location()).Unix()

	var stats []*KmKnowledgeMapStats
	err := DB.Where("eid = ? AND stat_date >= ? AND stat_date <= ?", eid, start, end).
		Order("stat_date ASC").
		Find(&stats).Error
	if err != nil {
		return nil, err
	}
	return stats, nil
}

func SumKmKnowledgeMapStatsByDateRange(eid int64, startDate, endDate time.Time) (*KmKnowledgeMapStats, error) {
	start := time.Date(startDate.Year(), startDate.Month(), startDate.Day(), 0, 0, 0, 0, startDate.Location()).Unix()
	end := time.Date(endDate.Year(), endDate.Month(), endDate.Day(), 23, 59, 59, 999999999, endDate.Location()).Unix()

	var stats KmKnowledgeMapStats
	err := DB.Select("SUM(generate_count) as generate_count, SUM(query_count) as query_count").
		Where("eid = ? AND stat_date >= ? AND stat_date <= ?", eid, start, end).
		Find(&stats).Error
	if err != nil {
		return nil, err
	}
	stats.Eid = eid
	return &stats, nil
}
