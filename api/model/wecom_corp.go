package model

import (
	"encoding/json"
	"errors"

	"gorm.io/gorm"
)

type WecomCorp struct {
	CorpID                string `json:"corp_id" gorm:"primaryKey;type:varchar(64)"`
	SuiteID               string `json:"suite_id" gorm:"type:varchar(32);index;not null"`
	Name                  string `json:"name" gorm:"type:varchar(255);not null"`
	Type                  string `json:"type" gorm:"type:varchar(50)"`
	AccessToken           string `json:"access_token" gorm:"type:varchar(255)"`
	ExpiresIn             int    `json:"expires_in" gorm:"type:int"`
	TokenUpdateTime       int64  `json:"token_update_time" gorm:"type:bigint"`
	PermanentCode         string `json:"permanent_code" gorm:"type:varchar(255)"`
	RoundLogoURL          string `json:"round_logo_url" gorm:"type:varchar(1000)"`
	SquareLogoURL         string `json:"square_logo_url" gorm:"type:varchar(1000)"`
	UserMax               int    `json:"user_max" gorm:"type:int"`
	AgentMax              int    `json:"agent_max" gorm:"type:int"`
	Agents                string `json:"agents" gorm:"type:text"`
	Departments           string `json:"departments" gorm:"type:text"`
	Status                int    `json:"status" gorm:"type:int;default:0"`
	WxQrcode              string `json:"wx_qrcode" gorm:"type:varchar(1000)"`
	SyncAgents            string `json:"sync_agents" gorm:"type:varchar(1000)"`
	Author                string `json:"author" gorm:"type:text"`
	CorpInfo              string `json:"corp_info" gorm:"type:text"`
	AppID                 string `json:"appid" gorm:"type:varchar(255)"`
	CorpTicket            string `json:"corp_ticket" gorm:"type:varchar(255)"`
	CorpTicketUpdateTime  int64  `json:"corp_ticket_update_time" gorm:"type:bigint"`
	AgentTicket           string `json:"agent_ticket" gorm:"type:varchar(255)"`
	AgentTicketUpdateTime int64  `json:"agent_ticket_update_time" gorm:"type:bigint"`
	CorpTicketExpiresIn   int    `json:"corp_ticket_expires_in" gorm:"type:int"`
	AgentTicketExpiresIn  int    `json:"agent_ticket_expires_in" gorm:"type:int"`
	IsSetChatMenu         int    `json:"is_set_chat_menu" gorm:"type:int;default:0"`
	BaseModel
}

type AuthCorpInfo struct {
	CorpID            string `json:"corpid"`
	CorpName          string `json:"corp_name"`
	CorpType          string `json:"corp_type"`
	CorpSquareLogoURL string `json:"corp_square_logo_url"`
	CorpUserMax       int    `json:"corp_user_max"`
}

type AuthUserInfo struct {
	UserID     string `json:"userid"`
	OpenUserID string `json:"open_userid"`
	Name       string `json:"name"`
	Avatar     string `json:"avatar"`
}

type AgentItem struct {
	AgentID         int       `json:"agentid"`
	AuthMode        int       `json:"auth_mode"`
	IsCustomizedApp bool      `json:"is_customized_app"`
	Name            string    `json:"name"`
	Privilege       Privilege `json:"privilege"`
	SquareLogoURL   string    `json:"square_logo_url"`
}

type Privilege struct {
	AllowParty []int    `json:"allow_party"` // 修改为int类型
	AllowTag   []int    `json:"allow_tag"`
	AllowUser  []string `json:"allow_user"`
	ExtraParty []int    `json:"extra_party"` // 修改为int类型
	ExtraTag   []int    `json:"extra_tag"`
	ExtraUser  []string `json:"extra_user"`
	Level      int      `json:"level"`
}

func GetWecomCorp(suiteID string, corpID string) (*WecomCorp, error) {
	if corpID == "" {
		return nil, errors.New("corp_id is empty")
	}
	model := &WecomCorp{}
	err := DB.Where("suite_id = ? AND corp_id = ?", suiteID, corpID).First(model).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return model, nil
}

func CreateWecomCorp(corp *WecomCorp) error {
	err := DB.Create(corp).Error
	if err != nil {
		return err
	}
	return nil
}

func UpdateWecomCorp(corp *WecomCorp) error {
	err := DB.Save(corp).Error
	if err != nil {
		return err
	}
	return nil
}

func (w *WecomCorp) GetWecomAuthUserInfo() *AuthUserInfo {
	var authInfo AuthUserInfo
	if err := json.Unmarshal([]byte(w.Author), &authInfo); err != nil {
		return nil
	}
	return &authInfo
}

func (w *WecomCorp) Delete() error {
	return DB.Delete(w).Error
}

func (w *WecomCorp) GetAgents() []AgentItem {
	var agents []AgentItem
	if err := json.Unmarshal([]byte(w.Agents), &agents); err != nil {
		return nil
	}
	return agents
}

func (w *WecomCorp) GetAgentID() int {
	agents := w.GetAgents()
	if len(agents) > 0 {
		return agents[0].AgentID
	}
	return 0
}

func (w *WecomCorp) GetAuthCorpInfo() *AuthCorpInfo {
	var authCorpInfo AuthCorpInfo
	if err := json.Unmarshal([]byte(w.CorpInfo), &authCorpInfo); err != nil {
		return nil
	}
	return &authCorpInfo
}
