package model

// RecordingShare 录音分享记录。参考 model/share_record.go（聊天分享）模式：
// 无有效期、share_id 随机串、(eid, share_id) 联合唯一、匿名可访问。
type RecordingShare struct {
	ID      int64  `json:"id" gorm:"column:id;primaryKey;autoIncrement"`
	ShareID string `json:"share_id" gorm:"column:share_id;type:varchar(64);not null;index:uniq_eid_share_id,unique"`
	Eid     int64  `json:"eid" gorm:"column:eid;not null;index:uniq_eid_share_id,unique"`
	FileID  int64  `json:"file_id" gorm:"column:file_id;not null;index"`
	ShareBy int64  `json:"share_by" gorm:"column:share_by;not null"`
	BaseModel
}

func (RecordingShare) TableName() string {
	return "recording_shares"
}
