package model

// bot-gateway 支持的机器人平台标识
const (
	BotProviderWeWork = "wework"
	BotProviderWeChat = "wechat"
)

// BotBinding bot-gateway 机器人绑定：bot 账号 ↔ AgentHub Agent 映射与验签/发送身份（bot_token）。
// BotToken 为 bot-gateway 签发的绑定身份（回调 URL 携带 + HMAC 验签 + 发送 Bearer），加密落库。
// token 优先机制：建绑时 bot_id 可空（”），网关回调回填后经 webhook 同步。
type BotBinding struct {
	ID                  int64  `json:"id" gorm:"column:id;primaryKey;autoIncrement"`
	Eid                 int64  `json:"eid" gorm:"column:eid;not null;index:idx_bot_bindings_lookup,priority:1"`
	BotID               string `json:"bot_id" gorm:"column:bot_id;size:128;not null"`
	Provider            string `json:"provider" gorm:"column:provider;size:16;not null"`
	AgentID             int64  `json:"agent_id" gorm:"column:agent_id;not null"`
	PlatformCallbackURL string `json:"platform_callback_url" gorm:"column:platform_callback_url;size:255;default:''"`
	BotToken            string `json:"-" gorm:"column:bot_token;size:512;not null"`
	BotTokenHash        string `json:"-" gorm:"column:bot_token_hash;size:64;uniqueIndex"` // bot_token sha256 指纹（webhook 关联查询，唯一）
	Enabled             bool   `json:"enabled" gorm:"column:enabled;default:true"`
	BaseModel
}

func CreateBotBinding(binding *BotBinding) error {
	return DB.Create(binding).Error
}

// GetBotBindingByBotID 按平台唯一 bot 账号查询绑定（webhook 侧，bot_id 平台全局唯一）
func GetBotBindingByBotID(botID, provider string) (*BotBinding, error) {
	var binding BotBinding
	err := DB.Where("bot_id = ? AND provider = ?", botID, provider).First(&binding).Error
	return &binding, err
}

func GetBotBindingByID(eid, id int64) (*BotBinding, error) {
	var binding BotBinding
	err := DB.Where("eid = ? AND id = ?", eid, id).First(&binding).Error
	return &binding, err
}

// GetBotBindingByEidAndBotID 按企业 + 平台账号查询绑定（登录接口按 bot_id 定位接入用，避免跨企业串号）。
func GetBotBindingByEidAndBotID(eid int64, botID string) (*BotBinding, error) {
	var binding BotBinding
	err := DB.Where("eid = ? AND bot_id = ?", eid, botID).First(&binding).Error
	return &binding, err
}

// GetBotBindingByBotTokenHash 按 bot_token 的 sha256 指纹关联绑定（webhook 侧：token 优先机制下 bot_id 可能尚未回填）。
// bot_token 本体加密落库，指纹明文便于索引查询。
func GetBotBindingByBotTokenHash(hash string) (*BotBinding, error) {
	var binding BotBinding
	err := DB.Where("bot_token_hash = ?", hash).First(&binding).Error
	return &binding, err
}

func ListBotBindings(eid int64) ([]*BotBinding, error) {
	var list []*BotBinding
	err := DB.Where("eid = ?", eid).Order("created_time DESC").Find(&list).Error
	return list, err
}

// ListBotBindingsByAgent 列出某企业下绑定到指定 agent 的全部机器人。
func ListBotBindingsByAgent(eid, agentID int64) ([]*BotBinding, error) {
	var list []*BotBinding
	err := DB.Where("eid = ? AND agent_id = ?", eid, agentID).Order("created_time DESC").Find(&list).Error
	return list, err
}

func DeleteBotBinding(eid, id int64) error {
	return DB.Where("eid = ? AND id = ?", eid, id).Delete(&BotBinding{}).Error
}

// UpdateBotBindingBotID 回填/更新绑定的 bot_id（webhook 首次收到推送时同步）。
func UpdateBotBindingBotID(eid, id int64, botID string) error {
	return DB.Model(&BotBinding{}).Where("id = ? AND eid = ?", id, eid).Update("bot_id", botID).Error
}

// UpdateBotBindingLoginIfEmpty 扫码登录成功后回填 bot_id：仅原值为空时写入，避免覆盖既有身份。
func UpdateBotBindingLoginIfEmpty(eid, id int64, botID string) error {
	if botID == "" {
		return nil
	}
	return DB.Model(&BotBinding{}).
		Where("id = ? AND eid = ? AND (bot_id = '' OR bot_id IS NULL)", id, eid).
		Update("bot_id", botID).Error
}

// UpdateBotBindingEnabled 启停绑定。
func UpdateBotBindingEnabled(eid, id int64, enabled bool) error {
	return DB.Model(&BotBinding{}).Where("id = ? AND eid = ?", id, eid).Update("enabled", enabled).Error
}
