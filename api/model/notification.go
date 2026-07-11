package model

// Type 字段应取 NotificationType 常量之一（如 NotificationTypePending、NotificationTypeMentionComment、NotificationTypeSystem）。
// IsRead 与 NotificationStatus 常量对应（0 未读，1 已读），数据库中存储为 int8。

// NotificationType 表示通知类型的枚举（以字符串编码存储）。
type NotificationType string

// NotificationReadStatus 表示通知的已读状态：0 未读，1 已读。
type NotificationReadStatus int

const (
	// NotificationTypePending：待处理
	NotificationTypePending NotificationType = "pending"
	// NotificationTypeMentionComment：被评论@提及
	NotificationTypeMentionComment NotificationType = "mention_comment"
	// NotificationTypeSystem：系统通知
	NotificationTypeSystem NotificationType = "system"
)

var NotificationTypes = map[string]struct{}{
	string(NotificationTypePending):        {},
	string(NotificationTypeMentionComment): {},
	string(NotificationTypeSystem):         {},
}

type Notification struct {
	ID             int64 `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	Eid            int64 `gorm:"column:eid;not null;index:idx_receiver_type_read"                      json:"eid"`
	SenderUserID   int64 `gorm:"column:sender_user_id;not null"                                        json:"sender_user_id"`
	ReceiverUserID int64 `gorm:"column:receiver_user_id;not null;index:idx_receiver_type_read"         json:"receiver_user_id"`
	// 通知类型，参见：pending、mention_comment、system
	Type       NotificationType `gorm:"column:type;size:32;not null;index:idx_receiver_type_read" json:"type"`
	IsRead     bool             `gorm:"column:is_read;not null;default:0;index:idx_receiver_type_read" json:"is_read"`
	ApprovalID int64            `gorm:"column:approval_id;not null;default:0;index"                   json:"approval_id"`
	Content    string           `gorm:"column:content;type:text;not null"                              json:"content"`
	BaseModel
}

const (
	// NotificationStatusUnread：未读
	NotificationStatusUnread NotificationReadStatus = iota
	// NotificationStatusRead：已读
	NotificationStatusRead
)

func (Notification) TableName() string { return "notifications" }
