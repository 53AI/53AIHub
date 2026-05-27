package service

import (
	"context"
	"errors"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

type ListOptions struct {
	Type          string
	IsRead        *bool
	SenderUserID  *int64
	StartTime     *time.Time
	EndTime       *time.Time
	Offset        int
	Limit         int
	HandledFilter *string // 处理状态筛选（仅对pending类型有效）："pending"|"processed"
}

// createNotificationsBatch 批量新增通知的通用工具方法（不依赖请求对象）
// - eid: 多租户企业ID，必填
// - senderUserID: 发送人ID，必须>=0
// - receiverUserIDs: 接收人ID列表，内部会去重并过滤<=0
// - typ: 通知类型，必须在 model.NotificationTypes 内
// - content: 通知内容，非空
// - batchSize: 批量大小，<=0时回退到500
func createNotificationsBatch(ctx context.Context, db *gorm.DB, eid int64, senderUserID int64, receiverUserIDs []int64, typ model.NotificationType, content string, batchSize int) (int, error) {
	if eid <= 0 || senderUserID < 0 || typ == "" || content == "" || len(receiverUserIDs) == 0 {
		return 0, errors.New("invalid args")
	}
	if _, ok := model.NotificationTypes[string(typ)]; !ok {
		return 0, errors.New("invalid type")
	}

	// 去重与过滤
	seen := make(map[int64]struct{}, len(receiverUserIDs))
	uniq := make([]int64, 0, len(receiverUserIDs))
	for _, rid := range receiverUserIDs {
		if rid <= 0 {
			continue
		}
		if _, ok := seen[rid]; ok {
			continue
		}
		seen[rid] = struct{}{}
		uniq = append(uniq, rid)
	}
	if len(uniq) == 0 {
		return 0, errors.New("no valid receivers")
	}

	now := time.Now().UTC().UnixMilli()
	records := make([]model.Notification, 0, len(uniq))
	for _, rid := range uniq {
		records = append(records, model.Notification{
			Eid:            eid,
			SenderUserID:   senderUserID,
			ReceiverUserID: rid,
			Type:           typ,
			IsRead:         false,
			Content:        content,
			BaseModel: model.BaseModel{
				CreatedTime: now,
				UpdatedTime: now,
			},
		})
	}

	if batchSize <= 0 {
		batchSize = 500
	}
	if err := db.WithContext(ctx).CreateInBatches(&records, batchSize).Error; err != nil {
		logger.Errorf(ctx, "createNotificationsBatch error: %v", err)
		return 0, err
	}
	return len(records), nil
}

type AddBatchRequest struct {
	Eid             int64
	SenderUserID    int64
	Type            string
	Content         string
	ReceiverUserIDs []int64
}

type NotificationService interface {
	List(ctx context.Context, eid int64, userID int64, opts ListOptions) (items []model.Notification, total int64, err error)
	Stats(ctx context.Context, eid int64, userID int64, scope string) (map[string]int64, error)
	MarkAllRead(ctx context.Context, eid int64, userID int64) (affected int64, err error)
	MarkOneRead(ctx context.Context, eid int64, userID int64, id int64) (affected int64, err error)
	AddBatch(ctx context.Context, req AddBatchRequest) (created int, err error)

	// AddBatchRaw: 对外公开的原子参数批量新增（不依赖请求对象）
	AddBatchRaw(ctx context.Context, eid int64, senderUserID int64, receiverUserIDs []int64, typ model.NotificationType, content string) (int, error)
	// AddBatchItems: 对外公开的差异化条目批量新增（每条可不同 sender/type/content/receiver）
	AddBatchItems(ctx context.Context, eid int64, items []NotificationSeed, batchSize int) (int, error)
}

type notificationService struct {
	db *gorm.DB
}

// NotificationSeed 差异化条目种子
type NotificationSeed struct {
	SenderUserID   int64
	ReceiverUserID int64
	Type           model.NotificationType
	Content        string
}

func NewNotificationService(db *gorm.DB) NotificationService {
	return &notificationService{db: db}
}

func (s *notificationService) List(ctx context.Context, eid int64, userID int64, opts ListOptions) (items []model.Notification, total int64, err error) {
	if eid <= 0 || userID <= 0 {
		return nil, 0, errors.New("invalid args")
	}
	q := s.db.WithContext(ctx).Model(&model.Notification{}).Where("notifications.eid = ? AND notifications.receiver_user_id = ?", eid, userID)

	if opts.Type != "" {
		q = q.Where("notifications.type = ?", opts.Type)

		// 如果是pending类型且有处理状态筛选，则添加关联查询
		if opts.Type == string(model.NotificationTypePending) && opts.HandledFilter != nil {
			switch *opts.HandledFilter {
			case "pending":
				// 筛选待处理的：审批状态为待审批
				q = q.Joins("LEFT JOIN approvals ON notifications.approval_id = approvals.id").
					Where("approvals.status = ?", model.ApprovalStatusPending)
			case "processed":
				// 筛选已处理的：审批状态为已同意或已拒绝
				q = q.Joins("LEFT JOIN approvals ON notifications.approval_id = approvals.id").
					Where("approvals.status IN ?", []int{model.ApprovalStatusApproved, model.ApprovalStatusRejected})
			}
		}
	}
	if opts.IsRead != nil {
		q = q.Where("notifications.is_read = ?", *opts.IsRead)
	}
	if opts.SenderUserID != nil && *opts.SenderUserID > 0 {
		q = q.Where("notifications.sender_user_id = ?", *opts.SenderUserID)
	}
	// time range
	if opts.StartTime != nil {
		q = q.Where("notifications.created_time >= ?", opts.StartTime)
	}
	if opts.EndTime != nil {
		q = q.Where("notifications.created_time <= ?", opts.EndTime)
	}

	// count
	if err = q.Count(&total).Error; err != nil {
		logger.Errorf(ctx, "notification.List count error: %v", err)
		return nil, 0, err
	}

	// data
	if opts.Offset < 0 {
		opts.Offset = 0
	}
	if opts.Limit <= 0 {
		opts.Limit = 20
	}
	if opts.Limit > 100 {
		opts.Limit = 100
	}
	items = make([]model.Notification, 0, opts.Limit)
	if err = q.Order("notifications.id DESC").Offset(opts.Offset).Limit(opts.Limit).Find(&items).Error; err != nil {
		logger.Errorf(ctx, "notification.List query error: %v", err)
		return nil, 0, err
	}
	return items, total, nil
}

func (s *notificationService) Stats(ctx context.Context, eid int64, userID int64, scope string) (map[string]int64, error) {
	if eid <= 0 || userID <= 0 {
		return nil, errors.New("invalid args")
	}
	type row struct {
		Type  string
		Count int64
	}
	var rows []row
	q := s.db.WithContext(ctx).Model(&model.Notification{}).Select("type, COUNT(*) as count").Where("eid = ? AND receiver_user_id = ?", eid, userID)
	if scope == "unread" {
		q = q.Where("is_read = ?", false)
	}
	if err := q.Group("type").Scan(&rows).Error; err != nil {
		logger.Errorf(ctx, "notification.Stats error: %v", err)
		return nil, err
	}
	res := map[string]int64{
		string(model.NotificationTypePending):        0,
		string(model.NotificationTypeMentionComment): 0,
		string(model.NotificationTypeSystem):         0,
	}
	for _, r := range rows {
		res[r.Type] += r.Count
	}
	return res, nil
}

func (s *notificationService) MarkAllRead(ctx context.Context, eid int64, userID int64) (affected int64, err error) {
	if eid <= 0 || userID <= 0 {
		return 0, errors.New("invalid args")
	}
	tx := s.db.WithContext(ctx).Model(&model.Notification{}).Where("eid = ? AND receiver_user_id = ? AND is_read = 0", eid, userID).Updates(map[string]interface{}{
		"is_read":      true,
		"updated_time": time.Now().UTC().UnixMilli(),
	})
	if tx.Error != nil {
		logger.Errorf(ctx, "notification.MarkAllRead error: %v", tx.Error)
		return 0, tx.Error
	}
	return tx.RowsAffected, nil
}

func (s *notificationService) MarkOneRead(ctx context.Context, eid int64, userID int64, id int64) (affected int64, err error) {
	if eid <= 0 || userID <= 0 || id <= 0 {
		return 0, errors.New("invalid args")
	}
	tx := s.db.WithContext(ctx).Model(&model.Notification{}).
		Where("eid = ? AND id = ? AND receiver_user_id = ? AND is_read = 0", eid, id, userID).
		Updates(map[string]interface{}{
			"is_read":      true,
			"updated_time": time.Now().UTC().UnixMilli(),
		})
	if tx.Error != nil {
		logger.Errorf(ctx, "notification.MarkOneRead error: %v", tx.Error)
		return 0, tx.Error
	}
	return tx.RowsAffected, nil
}

func (s *notificationService) AddBatch(ctx context.Context, req AddBatchRequest) (created int, err error) {
	// 复用通用工具方法（不依赖请求对象），保持原有行为
	return createNotificationsBatch(ctx, s.db, req.Eid, req.SenderUserID, req.ReceiverUserIDs, model.NotificationType(req.Type), req.Content, 500)
}

// AddBatchRaw 对外公开：原子参数批量新增
func (s *notificationService) AddBatchRaw(ctx context.Context, eid int64, senderUserID int64, receiverUserIDs []int64, typ model.NotificationType, content string) (int, error) {
	return createNotificationsBatch(ctx, s.db, eid, senderUserID, receiverUserIDs, typ, content, 500)
}

// AddBatchItems 对外公开：差异化条目批量新增
func (s *notificationService) AddBatchItems(ctx context.Context, eid int64, items []NotificationSeed, batchSize int) (int, error) {
	if len(items) == 0 {
		return 0, errors.New("empty items")
	}
	// 过滤非法项、构建记录
	now := time.Now().UTC().UnixMilli()
	records := make([]model.Notification, 0, len(items))
	for _, it := range items {
		if it.SenderUserID <= 0 || it.ReceiverUserID <= 0 || it.Type == "" || it.Content == "" {
			continue
		}
		if _, ok := model.NotificationTypes[string(it.Type)]; !ok {
			continue
		}
		records = append(records, model.Notification{
			Eid:            eid,
			SenderUserID:   it.SenderUserID,
			ReceiverUserID: it.ReceiverUserID,
			Type:           it.Type,
			IsRead:         false,
			Content:        it.Content,
			BaseModel: model.BaseModel{
				CreatedTime: now,
				UpdatedTime: now,
			},
		})
	}
	if len(records) == 0 {
		return 0, errors.New("no valid items")
	}
	if batchSize <= 0 {
		batchSize = 500
	}
	if err := s.db.WithContext(ctx).CreateInBatches(&records, batchSize).Error; err != nil {
		logger.Errorf(ctx, "notification.AddBatchItems error: %v", err)
		return 0, err
	}
	return len(records), nil
}
