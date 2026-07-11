package model

import "gorm.io/gorm"

type OpenClawArtifact struct {
	ID              int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid             int64  `json:"eid" gorm:"not null;index:idx_openclaw_artifacts_scope,priority:1"`
	AgentID         int64  `json:"agent_id" gorm:"not null;index:idx_openclaw_artifacts_scope,priority:2"`
	UserID          int64  `json:"user_id" gorm:"not null;index:idx_openclaw_artifacts_scope,priority:3"`
	ConversationID  string `json:"conversation_id" gorm:"not null;size:255;default:'';index:idx_openclaw_artifacts_conversation,priority:1"`
	TurnID          string `json:"turn_id" gorm:"not null;size:255;default:'';index:idx_openclaw_artifacts_conversation,priority:2"`
	ActiveRequestID string `json:"active_request_id" gorm:"not null;size:255;default:'';index"`
	PartID          string `json:"part_id" gorm:"not null;size:255;default:''"`
	LogicalPath     string `json:"logical_path" gorm:"not null;size:512;default:''"`
	UploadFileID    int64  `json:"upload_file_id" gorm:"not null;index"`
	Hash            string `json:"hash" gorm:"not null;size:128;default:'';index"`
	MimeType        string `json:"mime_type" gorm:"not null;size:512;default:''"`
	Size            int64  `json:"size" gorm:"not null;default:0"`

	BaseModel
	UploadFile *UploadFile `json:"upload_file,omitempty" gorm:"-"`
}

func CreateOpenClawArtifact(artifact *OpenClawArtifact) error {
	if artifact == nil {
		return nil
	}
	return DB.Create(artifact).Error
}

func GetOpenClawArtifactByID(id int64) (*OpenClawArtifact, error) {
	var artifact OpenClawArtifact
	if err := DB.Where("id = ?", id).First(&artifact).Error; err != nil {
		return nil, err
	}
	return &artifact, nil
}

func GetOpenClawArtifactByIDAndScope(eid, agentID, artifactID int64) (*OpenClawArtifact, error) {
	var artifact OpenClawArtifact
	if err := DB.Where("id = ? AND eid = ? AND agent_id = ?", artifactID, eid, agentID).First(&artifact).Error; err != nil {
		return nil, err
	}
	return &artifact, nil
}

func FindOpenClawArtifactByScope(eid, agentID, uploadFileID int64, conversationID, turnID, logicalPath string) (*OpenClawArtifact, error) {
	var artifact OpenClawArtifact
	err := DB.Where(
		"eid = ? AND agent_id = ? AND upload_file_id = ? AND conversation_id = ? AND turn_id = ? AND logical_path = ?",
		eid,
		agentID,
		uploadFileID,
		conversationID,
		turnID,
		logicalPath,
	).First(&artifact).Error
	if err != nil {
		return nil, err
	}
	return &artifact, nil
}

func IsOpenClawArtifactNotFound(err error) bool {
	return err == gorm.ErrRecordNotFound
}
