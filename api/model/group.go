package model

// Group represents a group entity with optional agent associations
type Group struct {
	GroupId   int64  `json:"group_id" gorm:"primaryKey;autoIncrement"`
	Eid       int64  `json:"eid" gorm:"not null;index" example:"1"`
	CreatedBy int64  `json:"created_by" gorm:"not null" example:"1"`
	GroupName string `json:"group_name" gorm:"not null" example:"group_name"`
	GroupType int64  `json:"group_type" gorm:"not null;default:0" example:"1"`
	Sort      int64  `json:"sort" gorm:"not null; default:0" example:"0"`
	// Define the relationship between Group and Agent through resource_permissions table
	Agents []*Agent `json:"agents" gorm:"-"` // Ignore this field in normal GORM operations
	BaseModel
}

const (
	USER_FREE_GROUP_NAME = "免费版"
)

// GetGroupWithAgents retrieves a group with its associated agents through resource permissions
func GetGroupWithAgents(groupId int64, enable bool) (*Group, error) {
	var group Group

	// First get the group
	if err := DB.Where("group_id = ?", groupId).First(&group).Error; err != nil {
		return nil, err
	}

	// Then get associated agents through resource permissions
	// Only get enterprise agents (owner_id = 0)
	var agents []*Agent
	err := DB.Model(&Agent{}).
		Distinct("agents.*").
		Joins("JOIN resource_permissions ON resource_permissions.resource_id = agents.agent_id").
		Where("resource_permissions.group_id = ? AND resource_permissions.resource_type = ? AND agents.enable = ? AND agents.owner_id = ?",
			groupId, ResourceTypeAgent, enable, AgentOwnerEnterprise).
		Order("sort DESC").
		Order("agent_id DESC").
		Find(&agents).Error

	if err != nil {
		return nil, err
	}

	group.Agents = agents
	return &group, nil
}

// GetGroupsWithAgents retrieves groups with their associated agents with pagination support
func GetGroupsWithAgents(eid int64, groupType int64, offset, limit int) ([]Group, int64, error) {
	var groups []Group
	var count int64

	// Get total count first
	if err := DB.Model(&Group{}).
		Where("eid = ? AND group_type = ?", eid, groupType).
		Count(&count).Error; err != nil {
		return nil, 0, err
	}

	// Query paginated groups
	query := DB.Where("eid = ? AND group_type = ?", eid, groupType).
		Order("sort DESC")

	if limit > 0 {
		query = query.Offset(offset).Limit(limit)
	}

	if err := query.Find(&groups).Error; err != nil {
		return nil, 0, err
	}

	// Query associated agents for each group
	for i := range groups {
		var agents []*Agent
		err := DB.Model(&Agent{}).
			Distinct("agents.*").
			Joins("JOIN resource_permissions ON resource_permissions.resource_id = agents.agent_id").
			Where("resource_permissions.group_id = ? AND resource_permissions.resource_type = ? AND agents.enable = ?",
				groups[i].GroupId, ResourceTypeAgent, true).
			Order("sort DESC").
			Order("agent_id DESC").
			Find(&agents).Error

		if err != nil {
			return nil, 0, err
		}

		groups[i].Agents = agents
	}

	return groups, count, nil
}

const (
	USER_GROUP_TYPE            = 1
	AI_LINKS_TYPE              = 2
	AGENT_TYPE                 = 3
	INTERNAL_USER_GROUP_TYPE   = 4
	SYSTEM_PROMPT_TYPE         = 5
	PERSONAL_PROMPT_TYPE       = 6
	GROUP_TYPE_SKILL           = 7
	KM_FILE_CHAT_QUICK_COMMAND = 101 // KM AI搜索组
	KM_FILE_CHAT_SLIDE_COMMAND = 102 // KM 文件聊天组
)

func CreateGroup(group *Group) error {
	return DB.Create(group).Error
}

func DeleteGroupByID(groupID int64) error {
	return DB.Where("group_id = ?", groupID).Delete(&Group{}).Error
}

func UpdateGroup(group *Group) error {
	return DB.Model(group).
		Select("group_name", "group_type", "sort", "updated_at").
		Updates(group).Error
}

func GetGroupByID(groupID int64) (*Group, error) {
	var group Group
	// 执行查询操作
	result := DB.Where("group_id = ?", groupID).First(&group)
	if result.Error != nil {
		return nil, result.Error
	}
	return &group, nil
}

// BatchSubmitGroups batch submits group information of a specified type, and decides to create, update, or delete based on the ID.
func BatchSubmitGroups(groupType int64, eid int64, groups []Group) error {
	// Query only existing groups of the specified type and eid
	var existingGroups []Group
	if err := DB.Where("group_type = ? AND eid = ?", groupType, eid).Find(&existingGroups).Error; err != nil {
		return err
	}
	existingGroupIDs := make(map[int64]bool)
	for _, group := range existingGroups {
		existingGroupIDs[group.GroupId] = true
	}

	// Process only incoming groups of the specified type and valid eid
	for _, group := range groups {
		if group.GroupType != groupType || group.Eid != eid {
			continue
		}
		if group.GroupId == 0 {
			if err := CreateGroup(&group); err != nil {
				return err
			}
		} else {
			if err := UpdateGroup(&group); err != nil {
				return err
			}
			existingGroupIDs[group.GroupId] = false
		}
	}

	// Delete groups of the specified type and eid that exist in the database but not in the incoming data
	for groupID, shouldDelete := range existingGroupIDs {
		if shouldDelete {
			if err := DeleteGroupByID(groupID); err != nil {
				return err
			}
		}
	}

	return nil
}

func GetGroupsByEid(eid int64, groupType int64) ([]Group, error) {
	var groups []Group
	if err := DB.Where("eid =? AND group_type =?", eid, groupType).Order("sort DESC").Find(&groups).Error; err != nil {
		return nil, err
	}

	if len(groups) == 0 {
		defaultGroup := Group{
			Eid:       eid,
			GroupType: groupType,
			GroupName: "默认",
			Sort:      0,
		}
		if err := DB.Create(&defaultGroup).Error; err != nil {
			return nil, err
		}
		groups = append(groups, defaultGroup)
	}

	return groups, nil
}

func GetFirstGroupByEid(eid int64, groupType int64) (Group, error) {
	var group Group
	if err := DB.Where("eid =? AND group_type =?", eid, groupType).Order("sort DESC").First(&group).Error; err != nil {
		return Group{}, err
	}
	return group, nil
}

func ExistsGroupByIDAndType(Eid int64, groupId int64, groupType int64) (bool, error) {
	var group Group
	err := DB.Where("group_id =? AND group_type =? AND eid =?", groupId, groupType, Eid).First(&group).Error
	if err != nil {
		return false, err
	}
	return true, nil
}

// AILinkInfo 定义AI链接信息结构体
type AILinkInfo struct {
	Name        string `json:"name"`
	Logo        string `json:"logo"`
	URL         string `json:"url"`
	Description string `json:"description"`
	Sort        int64  `json:"sort"`
}

// GroupInfo 定义分组信息结构体，包含子链接
type GroupInfo struct {
	GroupName string       `json:"group_name"`
	GroupType int64        `json:"group_type"`
	Sort      int64        `json:"sort"`
	Links     []AILinkInfo `json:"links"`
}

// GetDefaultGroupData 返回组合后的默认分组及链接数据
func GetDefaultGroupData() []GroupInfo {
	defaultGroups := []GroupInfo{
		{GroupName: "AI搜索", GroupType: 2, Sort: 6, Links: []AILinkInfo{
			{Name: "百度AI+", Logo: "https://hubapi.53ai.com/api/preview/b5970a3697479df6b00d73ab827dabb2.png", URL: "https://chat.baidu.com", Description: "百度官方ai搜索", Sort: 0},
			{Name: "天工AI", Logo: "https://hubapi.53ai.com/api/preview/432dfdbb2ade2e941a331fdc25ee29f5.png", URL: "https://www.tiangong.cn/", Description: "国内首个对标 ChatGPT 的双千亿级大语言模型，也是一个对话式AI助手", Sort: 0},
			{Name: "同花顺问财", Logo: "https://hubapi.53ai.com/api/preview/c65e9d65c42a1bdabfd7e09635dec05a.png", URL: "https://www.iwencai.com", Description: "同花顺旗下专业的智能选股平台", Sort: 0},
			{Name: "秘塔搜索", Logo: "https://hubapi.53ai.com/api/preview/710cd2a90fc7a38d8e78798af1fc597a.png", URL: "https://metaso.cn", Description: "没有广告，直达结果", Sort: 0},
			{Name: "Perplexity AI", Logo: "https://hubapi.53ai.com/api/preview/b2d85e0aa413297b2dccd0837fba6f28.png", URL: "https://perplexity.ai", Description: "知识的起点", Sort: 0},
			{Name: "知乎直答", Logo: "https://hubapi.53ai.com/api/preview/8698388b9dfc34d995a6238b120365d8.png", URL: "https://zhida.zhihu.com", Description: "用提问发现世界", Sort: 0},
		}},
		{GroupName: "智能对话", GroupType: 2, Sort: 5, Links: []AILinkInfo{
			{Name: "360智脑", Logo: "https://hubapi.53ai.com/api/preview/4a83fd5e7a31d0dd816d4f57237f13c5.png", URL: "https://i.360.com/", Description: "360搜索最新推出的AI对话聊天大模型", Sort: 0},
			{Name: "百度AI伙伴", Logo: "https://hubapi.53ai.com/api/preview/afbc2525ffca738ba39989d486e97223.png", URL: "https://chat.baidu.com/", Description: "百度最新上线的AI搜索对话工具", Sort: 0},
			{Name: "智谱清言", Logo: "https://hubapi.53ai.com/api/preview/b0072ad41d46626043cf1b2e3b2ce374.png", URL: "https://chatglm.cn/", Description: "Chatglm,千亿参数对话模型,支持多轮对话", Sort: 0},
			{Name: "豆包", Logo: "https://hubapi.53ai.com/api/preview/d98b75d99fba38975312841a3c85aa72.png", URL: "https://www.doubao.com/", Description: "抖音旗下AI工具，你的智能助手", Sort: 0},
			{Name: "ChatGPT", Logo: "https://hubapi.53ai.com/api/preview/bcade7d1cebca9273da445ffc8671711.png", URL: "https://chat.openai.com", Description: "Chatgpt.com", Sort: 0},
			{Name: "千问", Logo: "https://hubapi.53ai.com/api/preview/ea1ad076efc73a30c8eaf1e86fc193cc.png", URL: "https://tongyi.aliyun.com", Description: "阿里巴巴旗下的一款智能体机器人，它利用自然语言处理技术，为用户提供智能化的语音交互服务", Sort: 0},
			{Name: "零一万知", Logo: "https://hubapi.53ai.com/api/preview/f03bced2dfe845dec2d897cffcb3ce1b.png", URL: "https://www.wanzhi.com/", Description: "集AI对话聊天、文档阅读和PPT创作于一体的一站式AI工作平台", Sort: 0},
			{Name: "讯飞星火", Logo: "https://hubapi.53ai.com/api/preview/4417ab5f7607452ccd8a3174616d7f56.png", URL: "https://xinghuo.xfyun.cn", Description: "懂你的AI助手", Sort: 0},
			{Name: "文心一言", Logo: "https://hubapi.53ai.com/api/preview/eee853619f4fcbd7f15622198101630c.png", URL: "https://yiyan.baidu.com/", Description: "文心一言是百度研发的知识增强大语言模型，能够与人对话互动，回答问题，协助创作", Sort: 0},
			{Name: "腾讯元宝", Logo: "https://hubapi.53ai.com/api/preview/433b8834406d66420558b6f093f0fed1.png", URL: "https://yuanbao.tencent.com", Description: "腾讯元宝是一款基于腾讯混元大模型的AI产品，为用户提供多元化的AI能力", Sort: 0},
			{Name: "Kimi", Logo: "https://hubapi.53ai.com/api/preview/3df2f0d2e59edf80f4a1c93ce2d22035.png", URL: "https://www.kimi.com/", Description: "Kimi 是一款AI智能助手，由 Moonshot 自研的大语言模型驱动，支持在线搜索、深度思考、多模态推理和超长文本对话", Sort: 0},
			{Name: "DeepSeek", Logo: "https://hubapi.53ai.com/api/preview/30a0967845beb701a184764e62a60e7f.png", URL: "https://chat.deepseek.com/", Description: "深度求索人工智能AI对话大模型，带你探索未至之境", Sort: 0},
		}},
		{GroupName: "办公提效", GroupType: 2, Sort: 4, Links: []AILinkInfo{
			{Name: "秒出PPT", Logo: "https://hubapi.53ai.com/api/preview/e3d748b2fc4a7f108090552e0b0dfc18.png", URL: "https://10sppt.com/", Description: "10S快速生成PPT", Sort: 0},
			{Name: "AIPPT", Logo: "https://hubapi.53ai.com/api/preview/872850cdbb1fec8bc54581982572d4aa.png", URL: "https://www.aippt.cn/", Description: "AI一键生成PPT", Sort: 0},
			{Name: "笔尖写作", Logo: "https://hubapi.53ai.com/api/preview/23addd994bc064fd2d48d8b0adbad6bd.png", URL: "https://www.bijianxiezuo.com/", Description: "高质量Ai写作利器", Sort: 0},
			{Name: "ChatPPT", Logo: "https://hubapi.53ai.com/api/preview/f95c1d7469c53aff1c2d896677ce504b.png", URL: "https://chat-ppt.com/", Description: "对话式创作演示文稿，1400+类指令支持", Sort: 0},
			{Name: "百度橙篇", Logo: "https://hubapi.53ai.com/api/preview/d6121e6ed2e190ad67ef05fc2897fc84.png", URL: "https://cp.baidu.com", Description: "写长文神器", Sort: 0},
			{Name: "歌者PPT", Logo: "https://hubapi.53ai.com/api/preview/5379914644c44119e771865e00a1a565.png", URL: "https://gezhe.com/", Description: "永久免费的 PPT 智能生成工具", Sort: 0},
			{Name: "万彩AI", Logo: "https://hubapi.53ai.com/api/preview/dd71cc93f0324a7d985e51ea931f8396.png", URL: "https://ai.kezhan365.com/", Description: "万彩AI，让创意轻松落地", Sort: 0},
			{Name: "标智客", Logo: "https://hubapi.53ai.com/api/preview/b55f51c783bd473d3f9a1b3d1ebcf147.png", URL: "https://www.logomaker.com.cn/", Description: "智能LOGO设计生成", Sort: 0},
			{Name: "Wegic", Logo: "https://hubapi.53ai.com/api/preview/de7b13cb2c80afc5cc010b2a6615d69a.png", URL: "https://wegic.ai/", Description: "即时设计团队推出的 AI 网页生成工具", Sort: 0},
			{Name: "有道写作", Logo: "https://hubapi.53ai.com/api/preview/a5a84f10db33b8d49f5c242ba52b3a47.png", URL: "https://write.youdao.com", Description: "网易有道出品的智能英文写作修改和润色工具", Sort: 0},
		}},
		{GroupName: "图片处理", GroupType: 2, Sort: 3, Links: []AILinkInfo{
			{Name: "美图抠图", Logo: "https://hubapi.53ai.com/api/preview/b9f3a740af7c87e18af40d8ed8e50a8c.png", URL: "https://cutout.designkit.com/", Description: "美图秀秀推出的AI智能抠图工具，一键移除背景", Sort: 0},
			{Name: "美图设计室", Logo: "https://hubapi.53ai.com/api/preview/179d3e00e9ebddf92da34330ad6e2097.png", URL: "https://www.designkit.com/", Description: "一款功能强大、易于使用的图像处理和照片编辑软件，提供了丰富功能", Sort: 0},
			{Name: "一键抠图", Logo: "https://hubapi.53ai.com/api/preview/17a1c172c241b5ac79a5e9eb9ab58561.png", URL: "https://www.yijiankoutu.com/", Description: "在线一键抠图换背景", Sort: 0},
		}},
		{GroupName: "视频制作", GroupType: 2, Sort: 2, Links: []AILinkInfo{
			{Name: "百度度加", Logo: "https://hubapi.53ai.com/api/preview/919eb97d2b02114f475046c68fe3e70b.png", URL: "https://aigc.baidu.com/", Description: "度加剪辑是百度官方出品的口播自媒体必备剪辑工具，简洁好用", Sort: 0},
			{Name: "鬼手剪辑", Logo: "https://hubapi.53ai.com/api/preview/8244602231503e7ebb429ffd393ccab7.png", URL: "https://cn.jollytoday.com", Description: "视频AI翻译、硬字幕翻译和视频去字幕的专业视频剪辑工具", Sort: 0},
			{Name: "快手可灵", Logo: "https://hubapi.53ai.com/api/preview/52193bfb4d03a28fccfd827bbb450e04.png", URL: "https://app.klingai.com/", Description: "快手旗下图片生成和视频生成大模型工具", Sort: 0},
			{Name: "抖音即创", Logo: "https://hubapi.53ai.com/api/preview/707620ea6742afae608c9c109b51a33d.png", URL: "https://aic.oceanengine.com", Description: "专注于智能创意生产与管理分析", Sort: 0},
			{Name: "pika", Logo: "https://hubapi.53ai.com/api/preview/7f2201d2f291251a64c626dffa5d9d2d.png", URL: "https://pika.art", Description: "文本生成电影工具", Sort: 0},
			{Name: "腾讯智影", Logo: "https://hubapi.53ai.com/api/preview/2bf37ee21997235dea73084e21795987.png", URL: "https://zenvideo.qq.com", Description: "腾讯智影AI绘画，只需简单的描述就可为您生成独一无二的创意画作", Sort: 0},
		}},
		{GroupName: "AI学习", GroupType: 2, Sort: 1, Links: []AILinkInfo{
			{Name: "LangGPT", Logo: "https://hubapi.53ai.com/api/preview/41193ab845ca040c9ea34b0a7fa1bb80.png", URL: "https://langgptai.feishu.cn/", Description: "人人都能写出高质量提示词", Sort: 0},
			{Name: "通往AGI之路", Logo: "https://hubapi.53ai.com/api/preview/30f58543638b8e9eab9a242f2c1594ed.png", URL: "https://waytoagi.feishu.cn/", Description: "一个全面系统的AI学习路径", Sort: 0},
		}},
	}
	return defaultGroups
}

func GetUserFreeGroup(eid int64) (*Group, error) {
	var group Group
	if err := DB.Where("eid =? AND group_type =? AND group_name =?", eid, USER_GROUP_TYPE, USER_FREE_GROUP_NAME).First(&group).Error; err != nil {
		return nil, err
	}

	return &group, nil
}
