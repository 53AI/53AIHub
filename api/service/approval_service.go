package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ApprovalService interface {
	CreateApproval(ctx context.Context, eid int64, applicantUserID int64, req CreateApprovalRequest) (int64, []int64, string, error)
	Approve(ctx context.Context, eid int64, approverUserID int64, approvalID int64, finalPermission int) error
	Reject(ctx context.Context, eid int64, approverUserID int64, approvalID int64) error
	AlreadyApplied(ctx context.Context, eid int64, userID int64, resourceType int, resourceID int64) (bool, error)
	GetDetail(ctx context.Context, eid int64, userID int64, resourceType int, resourceID int64) (*model.Approval, error)
	IsLatestPending(ctx context.Context, eid int64, userID int64, resourceType int, resourceID int64) (bool, error)
}

type approvalService struct {
	db *gorm.DB
}

func NewApprovalService() ApprovalService {
	return &approvalService{db: model.DB}
}

// isUniqueErr 判断是否为唯一索引冲突（适配多种数据库错误信息）
func isUniqueErr(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "Duplicate entry") || // MySQL
		strings.Contains(s, "duplicate key value violates unique constraint") || // Postgres
		strings.Contains(s, "UNIQUE constraint failed") || // SQLite
		strings.Contains(s, "unique constraint") // 兜底
}

type CreateApprovalRequest struct {
	// 1 知识库; 2 文件/文档
	ResourceType int `json:"resource_type" binding:"required"`
	// 2 仅查看; 3 可查看/导出; 4 仅编辑知识; 5 可编辑知识/语料; 6 可管理
	Permission int                    `json:"permission" binding:"required"`
	Reason     string                 `json:"reason"`
	ResourceID int64                  `json:"resource_id" binding:"required"`
	Resource   map[string]interface{} `json:"resource"` // 任意对象，用于通知展示
}

type approvalContent struct {
	Reason       string                 `json:"reason"`
	Permission   int                    `json:"permission"`
	ResourceType int                    `json:"resource_type"`
	ResourceID   int64                  `json:"resource_id"`
	Resource     map[string]interface{} `json:"resource"`
}

// CreateApproval 创建申请，并向管理人发送 pending 通知
func (s *approvalService) CreateApproval(ctx context.Context, eid int64, applicantUserID int64, req CreateApprovalRequest) (int64, []int64, string, error) {
	var approvalID int64
	var managerIDs []int64
	var contentJSON string

	// 0) 重复申请校验（仅检查待审批）
	exists, err := model.IsApprovalApplied(s.db, eid, applicantUserID, req.ResourceType, req.ResourceID)
	if err != nil {
		return 0, nil, "", err
	}
	if exists {
		return 0, nil, "", ErrApprovalAlreadyApplied
	}

	// 查找管理人（层级继承：资源 → 知识库 → 空间）
	managerIDs, err = s.resolveResourceManagerIDs(ctx, eid, req.ResourceType, req.ResourceID)
	if err != nil {
		return 0, nil, "", err
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 1) 创建审批记录
		ap := &model.Approval{
			Eid:          eid,
			UserID:       applicantUserID,
			ResourceType: req.ResourceType,
			ResourceID:   req.ResourceID,
			Permission:   req.Permission,
			Status:       model.ApprovalStatusPending,
			Reason:       req.Reason,
		}
		if err := tx.Create(ap).Error; err != nil {
			if isUniqueErr(err) {
				return ErrApprovalAlreadyApplied
			}
			return err
		}
		approvalID = ap.ID

		// 2) 构建通知内容
		ac := approvalContent{
			Reason:       req.Reason,
			Permission:   req.Permission,
			ResourceType: req.ResourceType,
			ResourceID:   req.ResourceID,
			Resource:     req.Resource,
		}
		bs, _ := json.Marshal(ac)
		contentJSON = string(bs)

		// 3) 给每个管理人发送 pending 通知
		if len(managerIDs) > 0 {
			rows := make([]model.Notification, 0, len(managerIDs))
			for _, mid := range managerIDs {
				rows = append(rows, model.Notification{
					Eid:            eid,
					SenderUserID:   applicantUserID,
					ReceiverUserID: mid,
					Type:           model.NotificationTypePending,
					IsRead:         false,
					ApprovalID:     approvalID,
					Content:        contentJSON,
				})
			}
			if err := tx.CreateInBatches(rows, 100).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		logger.Errorf(ctx, "ApprovalService.CreateApproval error: %v", err)
		return 0, nil, "", err
	}
	return approvalID, managerIDs, contentJSON, nil
}

func (s *approvalService) Approve(ctx context.Context, eid int64, approverUserID int64, approvalID int64, finalPermission int) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 1) 锁定申请
		var ap model.Approval
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("eid = ? AND id = ?", eid, approvalID).First(&ap).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			return err
		}
		if ap.Status != model.ApprovalStatusPending {
			return ErrApprovalAlreadyProcessed
		}

		// 2) 校验 approver 是否管理人（层级继承）
		managerIDs, err := s.resolveResourceManagerIDs(ctx, eid, ap.ResourceType, ap.ResourceID)
		if err != nil {
			return err
		}
		ok := false
		for _, mid := range managerIDs {
			if mid == approverUserID {
				ok = true
				break
			}
		}
		if !ok {
			return ErrForbiddenNotManager
		}

		// 3) 授权 UpsertPermission 给申请人
		if err := UpsertPermission(eid, ap.ResourceType, ap.ResourceID, model.SUBJECT_TYPE_USER, ap.UserID, finalPermission); err != nil {
			return err
		}

		// 4) 更新所有该审批的 pending 通知中的 content.permission
		var notifs []model.Notification
		if err := tx.Where("eid = ? AND approval_id = ? AND type = ?", eid, approvalID, model.NotificationTypePending).
			Find(&notifs).Error; err != nil {
			return err
		}
		for _, n := range notifs {
			var ac approvalContent
			if err := json.Unmarshal([]byte(n.Content), &ac); err != nil {
				// 容错：若解析失败，跳过更新内容
				continue
			}
			ac.Permission = finalPermission
			bs, _ := json.Marshal(ac)
			if err := tx.Model(&model.Notification{}).
				Where("id = ? AND eid = ?", n.ID, eid).
				Update("content", string(bs)).Error; err != nil {
				return err
			}
		}

		// 5) 发送系统通知给申请人（内容为更新后的通知内容）
		// 使用第一条 pending 通知的内容模板（若不存在 pending 通知，则按默认结构组装）
		var ac approvalContent
		if len(notifs) > 0 {
			_ = json.Unmarshal([]byte(notifs[0].Content), &ac)
		} else {
			// 构造兜底内容
			ac = approvalContent{
				Reason:       ap.Reason,
				Permission:   finalPermission,
				ResourceType: ap.ResourceType,
				ResourceID:   ap.ResourceID,
				Resource:     map[string]interface{}{"id": ap.ResourceID},
			}
		}
		ac.Permission = finalPermission
		bs, _ := json.Marshal(ac)
		systemNotif := model.Notification{
			Eid:            eid,
			SenderUserID:   approverUserID,
			ReceiverUserID: ap.UserID,
			Type:           model.NotificationTypeSystem,
			IsRead:         false,
			ApprovalID:     approvalID,
			Content:        string(bs),
		}
		if err := tx.Create(&systemNotif).Error; err != nil {
			return err
		}

		// 6) 更新申请状态为同意，并记录审批人
		if err := tx.Model(&model.Approval{}).
			Where("id = ? AND eid = ?", approvalID, eid).
			Updates(map[string]interface{}{
				"status":           model.ApprovalStatusApproved,
				"approver_user_id": approverUserID,
			}).Error; err != nil {
			return err
		}

		return nil
	})
}

// GetDetail 按 (eid, userID, resourceType, resourceID) 获取最新一条审批记录
func (s *approvalService) GetDetail(ctx context.Context, eid int64, userID int64, resourceType int, resourceID int64) (*model.Approval, error) {
	var ap model.Approval
	err := s.db.WithContext(ctx).
		Where("eid = ? AND user_id = ? AND resource_type = ? AND resource_id = ?", eid, userID, resourceType, resourceID).
		Order("id DESC").
		First(&ap).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &ap, nil
}

// IsLatestPending 判断最新一条审批是否处于待审批状态
func (s *approvalService) IsLatestPending(ctx context.Context, eid int64, userID int64, resourceType int, resourceID int64) (bool, error) {
	ap, err := s.GetDetail(ctx, eid, userID, resourceType, resourceID)
	if err != nil {
		return false, err
	}
	if ap == nil {
		return false, nil
	}
	return ap.Status == model.ApprovalStatusPending, nil
}

// AlreadyApplied 查询 (eid, userID, resourceType, resourceID) 是否存在待审批记录
func (s *approvalService) AlreadyApplied(ctx context.Context, eid int64, userID int64, resourceType int, resourceID int64) (bool, error) {
	return model.IsApprovalApplied(s.db, eid, userID, resourceType, resourceID)
}

func (s *approvalService) Reject(ctx context.Context, eid int64, approverUserID int64, approvalID int64) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 1) 锁定申请
		var ap model.Approval
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("eid = ? AND id = ?", eid, approvalID).First(&ap).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			return err
		}
		if ap.Status != model.ApprovalStatusPending {
			return ErrApprovalAlreadyProcessed
		}

		// 2) 校验 approver 是否管理人（层级继承）
		managerIDs, err := s.resolveResourceManagerIDs(ctx, eid, ap.ResourceType, ap.ResourceID)
		if err != nil {
			return err
		}
		ok := false
		for _, mid := range managerIDs {
			if mid == approverUserID {
				ok = true
				break
			}
		}
		if !ok {
			return ErrForbiddenNotManager
		}

		// 3) 找到一条 pending 通知，作为内容来源；若没有则构造
		var n model.Notification
		err = tx.Where("eid = ? AND approval_id = ? AND type = ?", eid, approvalID, model.NotificationTypePending).
			First(&n).Error
		var ac approvalContent
		if err == nil {
			_ = json.Unmarshal([]byte(n.Content), &ac)
		} else {
			ac = approvalContent{
				Reason:       ap.Reason,
				Permission:   ap.Permission,
				ResourceType: ap.ResourceType,
				ResourceID:   ap.ResourceID,
				Resource:     map[string]interface{}{"id": ap.ResourceID},
			}
		}
		bs, _ := json.Marshal(ac)

		// 4) 更新申请状态为拒绝，并记录审批人
		if err := tx.Model(&model.Approval{}).
			Where("id = ? AND eid = ?", approvalID, eid).
			Updates(map[string]interface{}{
				"status":           model.ApprovalStatusRejected,
				"approver_user_id": approverUserID,
			}).Error; err != nil {
			return err
		}

		// 5) 发送系统通知给申请人（内容为上述内容）
		systemNotif := model.Notification{
			Eid:            eid,
			SenderUserID:   approverUserID,
			ReceiverUserID: ap.UserID,
			Type:           model.NotificationTypeSystem,
			IsRead:         false,
			ApprovalID:     approvalID,
			Content:        string(bs),
		}
		if err := tx.Create(&systemNotif).Error; err != nil {
			return err
		}

		return nil
	})
}

// resolveResourceManagerIDs 查找指定资源的管理人（层级继承：资源 → 知识库 → 空间）
// 返回去重的用户ID列表
func (s *approvalService) resolveResourceManagerIDs(ctx context.Context, eid int64, resourceType int, resourceID int64) ([]int64, error) {
	seen := map[int64]struct{}{}
	var ids []int64

	addIDs := func(idList ...int64) {
		for _, id := range idList {
			if id <= 0 {
				continue
			}
			if _, ok := seen[id]; !ok {
				seen[id] = struct{}{}
				ids = append(ids, id)
			}
		}
	}

	collect := func(rt int, rid int64) error {
		if rid <= 0 {
			return nil
		}
		perms, err := model.GetPermissionsByFilter(eid, &rt, &rid, nil, nil, nil)
		if err != nil {
			return err
		}
		for _, p := range perms {
			if p.Permission < model.PERMISSION_MANAGE {
				continue
			}
			switch p.SubjectType {
			case model.SUBJECT_TYPE_USER:
				if p.SubjectID > 0 {
					addIDs(p.SubjectID)
				}
			case model.SUBJECT_TYPE_GROUP:
				if p.SubjectID > 0 {
					userIDs := expandGroupMemberIDs(p.SubjectID)
					addIDs(userIDs...)
				}
			}
		}
		return nil
	}

	// 1) 当前资源
	if err := collect(resourceType, resourceID); err != nil {
		return nil, err
	}

	// 2) 向上查找父级资源的管理人
	switch resourceType {
	case model.RESOURCE_TYPE_WIKI_PAGE:
		var page model.WikiPage
		if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", eid, resourceID).First(&page).Error; err == nil {
			if page.LibraryID > 0 {
				_ = collect(model.RESOURCE_TYPE_LIBRARY, page.LibraryID)
			}
			if page.SpaceID > 0 {
				_ = collect(model.RESOURCE_TYPE_SPACE, page.SpaceID)
			}
		}
	case model.RESOURCE_TYPE_LIBRARY:
		var lib model.Library
		if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", eid, resourceID).First(&lib).Error; err == nil {
			if lib.SpaceID > 0 {
				_ = collect(model.RESOURCE_TYPE_SPACE, lib.SpaceID)
			}
		}
	case model.RESOURCE_TYPE_FILE:
		var file model.File
		if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", eid, resourceID).First(&file).Error; err == nil {
			if file.LibraryID > 0 {
				_ = collect(model.RESOURCE_TYPE_LIBRARY, file.LibraryID)
			}
		}
	}

	return ids, nil
}

// expandGroupMemberIDs 展开分组中的所有用户ID
func expandGroupMemberIDs(groupID int64) []int64 {
	seen := map[int64]struct{}{}
	var ids []int64

	add := func(id int64) {
		if id <= 0 {
			return
		}
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
	}

	var users []model.User
	if err := model.DB.Model(&model.User{}).Where("group_id = ?", groupID).Find(&users).Error; err == nil {
		for _, u := range users {
			add(u.UserID)
		}
	}

	var rpIDs []int64
	if err := model.DB.Model(&model.ResourcePermission{}).
		Where("group_id = ? AND resource_type = ?", groupID, model.ResourceTypeUser).
		Pluck("resource_id", &rpIDs).Error; err == nil {
		for _, id := range rpIDs {
			add(id)
		}
	}

	return ids
}
