package model

import (
	"fmt"
	"reflect"
	"strings"
	"time"
)

// SystemLog 系统日志模型
// @Description 对应数据库system_logs表，记录系统操作日志
type SystemLog struct {
	ID         int64  `json:"id" gorm:"primaryKey;autoIncrement;comment:流水ID"`
	Eid        int64  `json:"eid" gorm:"not null;comment:站点ID"`
	UserID     int64  `json:"user_id" gorm:"not null;comment:操作成员ID"`
	Nickname   string `json:"nickname" gorm:"size:255;not null;comment:成员名称"`
	Module     uint8  `json:"module" gorm:"not null;comment:模块。1系统；2智能体；3提示词；4AI工具；5订单数据；6注册用户；7内部用户；8订阅设置；9管理员；10模板风格；11Banner图；12导航管理；13站点信息；14平台接入；15支付配置；16站点域名；17三方统计"`
	Action     uint8  `json:"action" gorm:"not null;comment:动作。1新建；2编辑；3删除；4启用/停用；5登录/退出"`
	Content    string `json:"content" gorm:"type:text;not null;comment:日志内容"`
	IP         string `json:"ip" gorm:"size:20;not null;comment:ip"`
	ActionTime int64  `json:"action_time" gorm:"comment:创建时间（毫秒值）"`
}

// Module 模块常量定义
const (
	SystemLogModuleSystem       uint8 = 1  // 系统
	SystemLogModuleAgent        uint8 = 2  // 智能体
	SystemLogModulePrompt       uint8 = 3  // 提示词
	SystemLogModuleAITool       uint8 = 4  // AI工具
	SystemLogModuleOrder        uint8 = 5  // 订单数据
	SystemLogModuleRegistered   uint8 = 6  // 注册用户
	SystemLogModuleInternalUser uint8 = 7  // 内部用户
	SystemLogModuleSubscription uint8 = 8  // 订阅设置
	SystemLogModuleAdmin        uint8 = 9  // 管理员
	SystemLogModuleTemplate     uint8 = 10 // 模板风格
	SystemLogModuleBanner       uint8 = 11 // Banner图
	SystemLogModuleNavigation   uint8 = 12 // 导航管理
	SystemLogModuleSiteInfo     uint8 = 13 // 站点信息
	SystemLogModulePlatform     uint8 = 14 // 平台接入
	SystemLogModulePayment      uint8 = 15 // 支付配置
	SystemLogModuleDomain       uint8 = 16 // 站点域名
	SystemLogModuleStatistics   uint8 = 17 // 三方统计
	SystemLogModuleSpace        uint8 = 18 // 空间管理
	SystemLogModuleLibrary      uint8 = 19 // 知识库管理
	SystemLogModuleFile         uint8 = 20
)

// GetModuleByGroupType 根据分组类型获取对应的系统日志模块
func GetModuleByGroupType(groupType int64) uint8 {
	// 示例映射关系，可根据实际业务调整
	switch groupType {
	case AI_LINKS_TYPE:
		return SystemLogModuleAITool
	case AGENT_TYPE:
		return SystemLogModuleAgent
	case SYSTEM_PROMPT_TYPE, PERSONAL_PROMPT_TYPE:
		return SystemLogModulePrompt
	case USER_GROUP_TYPE:
		return SystemLogModuleRegistered
	case INTERNAL_USER_GROUP_TYPE:
		return SystemLogModuleInternalUser
	default:
		return SystemLogModuleSystem
	}
}

// Action 动作常量定义
const (
	SystemLogActionCreate   uint8 = 1 // 新建
	SystemLogActionUpdate   uint8 = 2 // 编辑
	SystemLogActionDelete   uint8 = 3 // 删除
	SystemLogActionToggle   uint8 = 4 // 启用/停用
	SystemLogActionLoginOut uint8 = 5 // 登录/退出
	SystemLogActionRestore  uint8 = 6 // 恢复
)

// TableName 指定表名
func (SystemLog) TableName() string {
	return "system_logs"
}

// GetSystemLogsByConditions 按条件分页查询系统日志
func GetSystemLogsByConditions(eid, module, action, userID, startTime, endTime int64, offset, limit int) ([]*SystemLog, int64, error) {
	query := DB.Model(&SystemLog{}).Where("eid = ?", eid)

	if module > 0 {
		query = query.Where("module = ?", module)
	}
	if action > 0 {
		query = query.Where("action = ?", action)
	}
	if userID > 0 {
		query = query.Where("user_id = ?", userID)
	}
	if startTime > 0 {
		query = query.Where("action_time >= ?", startTime)
	}
	if endTime > 0 {
		query = query.Where("action_time <= ?", endTime)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	logs := make([]*SystemLog, 0)
	if err := query.Offset(offset).Limit(limit).Order("id DESC").Find(&logs).Error; err != nil {
		return nil, 0, err
	}

	return logs, total, nil
}

// CreateSystemLog 创建系统日志记录
func CreateSystemLog(log *SystemLog) {
	go func() {
		log.ActionTime = time.Now().UnixMilli()
		if err := DB.Create(log).Error; err != nil {
			// 记录日志失败时输出错误日志
			fmt.Printf("创建系统日志失败: %v\n", err)
		}
	}()
}

// LogEntityChange 记录实体变更日志
// entityType: 实体类型(用户/分组等), action: 操作类型(创建/更新/删除), eid: 企业ID, userId: 操作用户ID, nickname: 操作用户昵称,
// module: 模块类型, oldEntity: 旧实体, newEntity: 新实体, ip: 操作IP, fieldMap: 字段映射关系
func LogEntityChange(entityType string, action uint8, eid, userId int64, nickname string, module uint8, oldEntity, newEntity interface{}, ip string, fieldMap map[string]string) {
	// 使用反射比较实体差异
	content := generateChangeContent(entityType, action, oldEntity, newEntity, fieldMap)
	if content == "" {
		return
	}

	log := &SystemLog{
		Eid:      eid,
		UserID:   userId,
		Nickname: nickname,
		Module:   module,
		Action:   action,
		Content:  content,
		IP:       ip,
	}

	CreateSystemLog(log)
}

// generateChangeContent 生成变更内容描述
func generateChangeContent(entityType string, action uint8, oldEntity, newEntity interface{}, fieldMap map[string]string) string {
	var content string

	switch action {
	case SystemLogActionCreate:
		content = fmt.Sprintf("新增%s", entityType)
	case SystemLogActionDelete:
		content = fmt.Sprintf("删除%s", entityType)
	case SystemLogActionRestore:
		content = fmt.Sprintf("恢复%s", entityType)
	case SystemLogActionUpdate:
		// 比较新旧实体差异
		changes := compareEntities(oldEntity, newEntity, fieldMap, entityType)
		if len(changes) == 0 {
			return ""
		}
		content = fmt.Sprintf("编辑%s: %s", entityType, strings.Join(changes, "; "))
	}

	return content
}

// compareEntities 比较两个实体的差异
func compareEntities(oldEntity, newEntity interface{}, fieldMap map[string]string, entityType string) []string {
	var changes []string

	oldVal := reflect.ValueOf(oldEntity)
	newVal := reflect.ValueOf(newEntity)

	// 如果是指针，获取其指向的值
	if oldVal.Kind() == reflect.Ptr {
		oldVal = oldVal.Elem()
	}
	if newVal.Kind() == reflect.Ptr {
		newVal = newVal.Elem()
	}

	// 确保是结构体
	if oldVal.Kind() != reflect.Struct || newVal.Kind() != reflect.Struct {
		return changes
	}

	oldType := oldVal.Type()

	// 遍历结构体字段
	for i := 0; i < oldVal.NumField(); i++ {
		field := oldType.Field(i)
		fieldName := field.Name

		// 检查是否在字段映射中
		if displayName, ok := fieldMap[fieldName]; ok {
			oldFieldVal := oldVal.Field(i).Interface()
			newFieldVal := newVal.Field(i).Interface()

			// 比较字段值
			if !reflect.DeepEqual(oldFieldVal, newFieldVal) {
				// 处理密码特殊情况
				if fieldName == "Password" && newFieldVal != "" {
					changes = append(changes, fmt.Sprintf("%s: ******", displayName))
				} else if fieldName == "ExpiredTime" {
					oldTime := time.UnixMilli(oldFieldVal.(int64))
					newTime := time.UnixMilli(newFieldVal.(int64))
					oldTimeStr := oldTime.Format("2006-01-02")
					newTimeStr := newTime.Format("2006-01-02")
					changes = append(changes, fmt.Sprintf("%s: %s→%s", displayName, oldTimeStr, newTimeStr))
				} else if fieldName == "Type" {
					if entityType == "entityType" {
						changes = append(changes, fmt.Sprintf("%s: %v→%v", displayName, GetEnterpriseTypeDescription(oldFieldVal.(string)), GetEnterpriseTypeDescription(newFieldVal.(string))))
					}
				} else {
					fieldChangeMap := map[string]string{
						"GroupId": "修改了分组",
						"Avatar":  "修改了头像",
					}
					if desc, ok := fieldChangeMap[fieldName]; ok {
						changes = append(changes, desc)
					} else {
						changes = append(changes, fmt.Sprintf("%s: %v→%v", displayName, oldFieldVal, newFieldVal))
					}
				}
			}
		}
	}

	return changes
}

// ModuleItem 模块常量项
type ModuleItem struct {
	Value uint8  `json:"value"`
	Text  string `json:"text"`
}

// moduleTextMap 模块常量到文本的映射
var moduleTextMap = map[uint8]string{
	SystemLogModuleSystem:       "系统",
	SystemLogModuleAgent:        "智能体",
	SystemLogModulePrompt:       "提示词",
	SystemLogModuleAITool:       "AI工具",
	SystemLogModuleOrder:        "订单数据",
	SystemLogModuleRegistered:   "注册用户",
	SystemLogModuleInternalUser: "内部用户",
	SystemLogModuleSubscription: "订阅设置",
	SystemLogModuleAdmin:        "管理员",
	SystemLogModuleTemplate:     "模板风格",
	SystemLogModuleBanner:       "Banner图",
	SystemLogModuleNavigation:   "导航管理",
	SystemLogModuleSiteInfo:     "站点信息",
	SystemLogModulePlatform:     "平台接入",
	SystemLogModulePayment:      "支付配置",
	SystemLogModuleDomain:       "站点域名",
	SystemLogModuleStatistics:   "三方统计",
	SystemLogModuleSpace:        "空间管理",
	SystemLogModuleLibrary:      "知识库管理",
	SystemLogModuleFile:         "文档",
}

// GetAllModules 获取所有模块定义
func GetAllModules() []ModuleItem {
	modules := make([]ModuleItem, 0, len(moduleTextMap))
	for value, text := range moduleTextMap {
		modules = append(modules, ModuleItem{Value: value, Text: text})
	}
	return modules
}

// GetModuleText 通过常量获取模块文本
func GetModuleText(value uint8) string {
	return moduleTextMap[value]
}

// ActionItem 动作常量项
type ActionItem struct {
	Value uint8  `json:"value"`
	Text  string `json:"text"`
}

// GetAllActions 获取所有动作定义
// actionTextMap 操作常量到文本的映射
var actionTextMap = map[uint8]string{
	SystemLogActionCreate:   "新建",
	SystemLogActionUpdate:   "编辑",
	SystemLogActionDelete:   "删除",
	SystemLogActionToggle:   "启用/停用",
	SystemLogActionLoginOut: "登录/退出",
	SystemLogActionRestore:  "恢复",
}

// GetAllActions 获取所有操作定义
func GetAllActions() []ActionItem {
	actions := make([]ActionItem, 0, len(actionTextMap))
	for value, text := range actionTextMap {
		actions = append(actions, ActionItem{Value: value, Text: text})
	}
	return actions
}

// GetActionText 通过常量获取操作文本
func GetActionText(value uint8) string {
	return actionTextMap[value]
}
