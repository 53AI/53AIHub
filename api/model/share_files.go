package model

// ShareFile represents a file sharing record.
// DB migration not included per requirement; ensure the table is created accordingly.
// Indexes:
//   - UNIQUE: uk_share_id (share_id)
//   - INDEX: idx_eid_fileid_shareby (eid, file_id, share_by)
type ShareFile struct {
	ID         int64  `json:"id" gorm:"primaryKey"`
	EID        int64  `json:"eid" gorm:"column:eid;index:idx_eid_fileid_shareby"`
	FileID     int64  `json:"file_id" gorm:"column:file_id;index:idx_eid_fileid_shareby"`
	ShareBy    int64  `json:"share_by" gorm:"column:share_by;index:idx_eid_fileid_shareby"`
	ShareID    string `json:"share_id" gorm:"column:share_id;size:30;uniqueIndex:uk_share_id"`
	ExpireTime int64  `json:"expire_time" gorm:"column:expire_time;not null"`
	BaseModel
}

// TableName customizes the table name if needed.
func (ShareFile) TableName() string {
	return "share_files"
}
