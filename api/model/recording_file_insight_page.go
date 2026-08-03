package model

import (
	"gorm.io/gorm/clause"
)

type RecordingFileInsightPage struct {
	ID       int64    `json:"id" gorm:"primaryKey;autoIncrement"`
	FileID   int64    `json:"file_id" gorm:"uniqueIndex;not null;comment:文件ID"`
	PageJSON LongText `json:"page_json" gorm:"type:text;comment:Prompt 5 编排后的页面JSON"`
	BaseModel
}

func CreateRecordingFileInsightPage(p *RecordingFileInsightPage) error {
	return DB.Create(p).Error
}

func GetRecordingFileInsightPageByFileID(fileID int64) (*RecordingFileInsightPage, error) {
	var p RecordingFileInsightPage
	err := DB.Where("file_id = ?", fileID).First(&p).Error
	return &p, err
}

// BatchGetByFileIDs 批量查询指定文件ID列表的洞察页面编排结果。
// 返回 map[fileID]*RecordingFileInsightPage，未找到的文件不在 map 中。
func BatchGetRecordingFileInsightPagesByFileIDs(fileIDs []int64) (map[int64]*RecordingFileInsightPage, error) {
	if len(fileIDs) == 0 {
		return map[int64]*RecordingFileInsightPage{}, nil
	}
	var pages []RecordingFileInsightPage
	if err := DB.Where("file_id IN ?", fileIDs).Find(&pages).Error; err != nil {
		return nil, err
	}
	result := make(map[int64]*RecordingFileInsightPage, len(pages))
	for i := range pages {
		result[pages[i].FileID] = &pages[i]
	}
	return result, nil
}

func UpsertRecordingFileInsightPage(fileID int64, pageJSON string) error {
	// 使用 GORM 的 OnConflict 实现 UPSERT，兼容 MySQL/PostgreSQL/SQLite
	return DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "file_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"page_json", "updated_time"}),
	}).Create(&RecordingFileInsightPage{
		FileID:   fileID,
		PageJSON: LongText(pageJSON),
	}).Error
}
