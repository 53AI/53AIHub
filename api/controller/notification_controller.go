package controller

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
)

type NotificationController struct {
	Svc service.NotificationService
	// UserSvc 提示：
	// 后续如需批量查询用户信息以填充 sender，可在此引入真实的 user service 接口，例如：
	// type UserService interface {
	//     GetUsersByIDs(ctx context.Context, ids []int64) (map[int64]struct{
	//         UserID int64
	//         Nickname string
	//         Avatar string
	//     }, error)
	// }
	// 并在控制器构造函数中接收该依赖（可新增 NewNotificationControllerWithUser 接口）。
	UserSvc interface{} // 当前未接入外部用户服务；列表使用本地批量查询（fetchUserBasics）填充 sender。若后续提供批量接口（如 GetUsersByIDs），可将其替换为 UserSvc 调用，并将该字段类型改为明确的 UserService 接口。
}

type ListQueryRequest struct {
	Type         string `form:"type"`
	IsRead       string `form:"is_read"`                                // "", "read", "unread"
	SenderUserID string `form:"sender_user_id"`                         // int64
	StartTime    string `form:"start_time" binding:"omitempty,numeric"` // 毫秒时间戳
	EndTime      string `form:"end_time"   binding:"omitempty,numeric"` // 毫秒时间戳
	Offset       string `form:"offset" binding:"omitempty,numeric"`
	Limit        string `form:"limit"  binding:"omitempty,numeric"`
	Handled      string `form:"handled"` // 仅对pending类型有效：pending|processed
}

type AddBatchBodyRequest struct {
	SenderUserID *int64 `json:"sender_user_id"`
	// pending, mention_comment, system
	Type            string  `json:"type" binding:"required"`
	Content         string  `json:"content" binding:"required"`
	ReceiverUserIDs []int64 `json:"receiver_user_ids" binding:"required"`
}

func parseIsReadFlag(v string) (*bool, error) {
	if v == "" {
		return nil, nil
	}
	switch v {
	case "read":
		t := true
		return &t, nil
	case "unread":
		f := false
		return &f, nil
	default:
		return nil, errors.New("invalid is_read, expect read|unread")
	}
}

func parseInt64Opt(s string) (*int64, error) {
	if s == "" {
		return nil, nil
	}
	x, err := strconv.ParseInt(s, 10, 64)
	if err != nil || x <= 0 {
		return nil, errors.New("invalid integer value")
	}
	return &x, nil
}

func parseTimeRangeMillis(qs ListQueryRequest) (*time.Time, *time.Time, error) {
	var st, et *time.Time
	if qs.StartTime != "" {
		v, err := strconv.ParseInt(qs.StartTime, 10, 64)
		if err != nil || v < 0 {
			return nil, nil, errors.New("invalid start_time (millis)")
		}
		t := time.UnixMilli(v)
		st = &t
	}
	if qs.EndTime != "" {
		v, err := strconv.ParseInt(qs.EndTime, 10, 64)
		if err != nil || v < 0 {
			return nil, nil, errors.New("invalid end_time (millis)")
		}
		t := time.UnixMilli(v)
		et = &t
	}
	if st != nil && et != nil && et.Before(*st) {
		return nil, nil, errors.New("end before start")
	}
	return st, et, nil
}

func parsePagination(offsetS, limitS string) (int, int, error) {
	offset := 0
	limit := 20
	var err error
	if offsetS != "" {
		if offset, err = strconv.Atoi(offsetS); err != nil || offset < 0 {
			return 0, 0, errors.New("invalid offset")
		}
	}
	if limitS != "" {
		if limit, err = strconv.Atoi(limitS); err != nil || limit <= 0 {
			return 0, 0, errors.New("invalid limit")
		}
	}
	if limit > 200 {
		limit = 200
	}
	return offset, limit, nil
}

func NewNotificationController(svc service.NotificationService) *NotificationController {
	return &NotificationController{Svc: svc}
}

func validateAddBatchBody(req AddBatchBodyRequest) error {
	if req.Type == "" || req.Content == "" || len(req.ReceiverUserIDs) == 0 {
		return errors.New("missing required fields")
	}
	if _, ok := model.NotificationTypes[req.Type]; !ok {
		return errors.New("invalid type")
	}
	// 基本校验接收者
	okCnt := 0
	seen := make(map[int64]struct{}, len(req.ReceiverUserIDs))
	for _, rid := range req.ReceiverUserIDs {
		if rid <= 0 {
			continue
		}
		if _, ok := seen[rid]; ok {
			continue
		}
		seen[rid] = struct{}{}
		okCnt++
	}
	if okCnt == 0 {
		return errors.New("invalid receiver_user_ids")
	}
	return nil
}

func fetchUserBasics(c *gin.Context, ids map[int64]struct{}) map[int64]struct {
	UserID   int64
	Nickname string
	Avatar   string
} {
	out := make(map[int64]struct {
		UserID   int64
		Nickname string
		Avatar   string
	}, len(ids))
	if len(ids) == 0 {
		return out
	}
	// 转为切片
	slice := make([]int64, 0, len(ids))
	for id := range ids {
		if id > 0 {
			slice = append(slice, id)
		}
	}
	if len(slice) == 0 {
		return out
	}

	// 仅查询所需字段
	type row struct {
		UserID   int64  `gorm:"column:user_id"`
		Nickname string `gorm:"column:nickname"`
		Avatar   string `gorm:"column:avatar"`
	}
	var rows []row
	if err := model.DB.WithContext(c).Model(&model.User{}).
		Select("user_id, nickname, avatar").
		Where("user_id IN ?", slice).
		Find(&rows).Error; err != nil {
		logger.Errorf(c, "fetchUserBasics query error: %v", err)
		return out
	}
	for _, r := range rows {
		out[r.UserID] = struct {
			UserID   int64
			Nickname string
			Avatar   string
		}{
			UserID:   r.UserID,
			Nickname: r.Nickname,
			Avatar:   r.Avatar,
		}
	}
	return out
}

// Helper: unified response
func respOK(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "ok", "data": data})
}

func respErr(c *gin.Context, status int, msg string) {
	if status == http.StatusBadRequest {
		c.JSON(status, model.ParamError.ToResponse(errors.New(msg)))
		return
	}
	c.JSON(status, gin.H{"code": status, "msg": msg})
}

// List 通知列表
// @Summary      List notifications
/**
获取通知列表，支持按类型、是否已读、时间范围、发送人过滤；
时间范围仅支持毫秒时间戳 start_time/end_time
*/
// @Tags         notifications
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        type           query     string  false  "通知类型：pending|mention_comment|system"
// @Param        is_read        query     string  false  "是否已读：read|unread"
// @Param        sender_user_id query     int64   false  "发送人ID"
// @Param        start_time     query     int64   false  "开始时间 毫秒"
// @Param        end_time       query     int64   false  "结束时间 毫秒"
// @Param        offset         query     int     false  "偏移量，默认0"
// @Param        limit          query     int     false  "每页数量，默认20，最大200"
// @Param        handled        query     string  false  "处理状态（仅pending类型有效）：pending|processed"
// @Success      200            {object}  map[string]interface{} "code=0, data={list,total,offset,limit}"
// @Failure      400            {object}  map[string]interface{} "参数错误"
// @Failure      401            {object}  map[string]interface{} "未授权"
// @Failure      500            {object}  map[string]interface{} "服务错误"
// @Router       /api/notifications [get]
func (nc *NotificationController) List(c *gin.Context) {
	userID := config.GetUserId(c)
	if userID == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	eid := config.GetEID(c)
	if eid == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	var qs ListQueryRequest
	if err := c.ShouldBindQuery(&qs); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("invalid query params")))
		return
	}
	// type 校验
	if qs.Type != "" {
		if _, ok := model.NotificationTypes[qs.Type]; !ok {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("invalid type")))
			return
		}
	}
	// is_read 解析
	isReadPtr, err := parseIsReadFlag(qs.IsRead)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	// sender_user_id
	senderIDPtr, err := parseInt64Opt(qs.SenderUserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("invalid sender_user_id")))
		return
	}
	// 时间范围
	startPtr, endPtr, err := parseTimeRangeMillis(qs)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	// 分页
	offset, limit, err := parsePagination(qs.Offset, qs.Limit)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 处理状态筛选（仅对pending类型有效）
	var handledFilter *string
	if qs.Type == string(model.NotificationTypePending) {
		handled := qs.Handled
		if handled == "" {
			handled = "pending" // 默认为pending
		}
		if handled != "pending" && handled != "processed" {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("invalid handled value, expect pending|processed")))
			return
		}
		handledFilter = &handled
	}

	opts := service.ListOptions{
		Type:          qs.Type,
		IsRead:        isReadPtr,
		SenderUserID:  senderIDPtr,
		StartTime:     startPtr,
		EndTime:       endPtr,
		Offset:        offset,
		Limit:         limit,
		HandledFilter: handledFilter, // 添加处理状态筛选参数
	}
	items, total, err := nc.Svc.List(c, eid, userID, opts)
	if err != nil {
		logger.Errorf(c, "notifications.List error: %v", err)
		respErr(c, http.StatusInternalServerError, "internal error")
		return
	}

	senderIDs := make(map[int64]struct{}, len(items))
	for _, it := range items {
		senderIDs[it.SenderUserID] = struct{}{}
	}
	// 已通过本地批量查询 fetchUserBasics 实现 sender 信息聚合；后续如提供正式 user_service 批量接口，可在此替换为 UserSvc.GetUsersByIDs
	// 对接步骤建议：
	//   1) 将 senderIDs 的 key 转为切片 ids
	//   2) 使用 UserSvc 批量查询：GetUsersByIDs(ctx, ids)
	//   3) 将结果映射填充到 userMap 中，缺省时置零值
	//   4) 注意 UserSvc 失败时记录日志并继续返回基本通知信息
	type SenderDTO struct {
		UserID   int64  `json:"user_id"`
		Nickname string `json:"nickname"`
		Avatar   string `json:"avatar"`
	}
	userMap := map[int64]SenderDTO{}
	// 使用本地批量查询，后续可替换为 UserSvc.GetUsersByIDs
	if basics := fetchUserBasics(c, senderIDs); len(basics) > 0 {
		for uid, b := range basics {
			userMap[uid] = SenderDTO{
				UserID:   b.UserID,
				Nickname: b.Nickname,
				Avatar:   b.Avatar,
			}
		}
	}

	type NotificationDTO struct {
		ID             int64                  `json:"id"`
		Sender         SenderDTO              `json:"sender"`
		Type           string                 `json:"type"`
		Content        string                 `json:"content"`
		ContentParsed  map[string]interface{} `json:"content_parsed,omitempty"`
		ApprovalID     int64                  `json:"approval_id,omitempty"`
		Approval       model.Approval         `json:"approval,omitempty"`
		IsRead         bool                   `json:"is_read"`
		CreatedTime    int64                  `json:"created_time"` // 毫秒时间戳
		UpdatedTime    int64                  `json:"updated_time"` // 毫秒时间戳
		ReceiverUserID int64                  `json:"receiver_user_id"`
	}

	out := make([]NotificationDTO, 0, len(items))
	// 预解析 content、收集 approval_id
	approvalIDs := make([]int64, 0, len(items))
	for _, it := range items {
		sd := userMap[it.SenderUserID]
		dto := NotificationDTO{
			ID:             it.ID,
			Sender:         sd,
			Type:           string(it.Type),
			Content:        it.Content,
			IsRead:         it.IsRead,
			CreatedTime:    it.CreatedTime,
			UpdatedTime:    it.UpdatedTime,
			ReceiverUserID: it.ReceiverUserID,
		}
		// 如果模型层已含 ApprovalID 字段，直接读取；若服务层返回的 item 未暴露该字段，这里尝试通过 JSON 内容解析兜底
		// 解析 content -> ContentParsed
		if it.Content != "" {
			var m map[string]interface{}
			if err := json.Unmarshal([]byte(it.Content), &m); err == nil {
				dto.ContentParsed = m
			}
		}
		// 通过反射式访问或直接字段，当前假设 service 返回的项包含 ApprovalID 字段（与 model.Notification 一致）
		dto.ApprovalID = it.ApprovalID
		if dto.ApprovalID > 0 {
			approvalIDs = append(approvalIDs, dto.ApprovalID)
		}
		out = append(out, dto)
	}
	// pending 类型联查 approvals
	if len(approvalIDs) > 0 {
		// 去重
		seen := map[int64]struct{}{}
		uniq := make([]int64, 0, len(approvalIDs))
		for _, id := range approvalIDs {
			if id <= 0 {
				continue
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			uniq = append(uniq, id)
		}
		if len(uniq) > 0 {
			var rows []model.Approval
			if err := model.DB.WithContext(c).
				Model(&model.Approval{}).
				Select("id,user_id,resource_type,resource_id,permission,status,reason,approver_user_id,created_time,updated_time").
				Where("eid = ? AND id IN ?", eid, uniq).
				Find(&rows).Error; err != nil {
				logger.Errorf(c, "notifications.List approvals batch query error: %v", err)
			} else if len(rows) > 0 {
				// 加载审批人的基础展示信息
				aps := make([]*model.Approval, 0, len(rows))
				for i := range rows {
					aps = append(aps, &rows[i])
				}
				model.LoadApproverBasics(model.DB, aps)

				amap := make(map[int64]model.Approval, len(rows))
				for _, r := range rows {
					amap[r.ID] = r
				}
				for i := range out {
					if out[i].ApprovalID > 0 {
						if ar, ok := amap[out[i].ApprovalID]; ok {
							out[i].Approval = ar
						}
					}
				}
			}
		}
	}

	respOK(c, gin.H{
		"list":   out,
		"total":  total,
		"offset": offset,
		"limit":  limit,
	})
}

// Stats 未读统计
// @Summary      Notification stats
// @Description  通知统计，默认统计未读；scope=unread|all
// @Tags         notifications
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        scope  query     string  false  "统计范围：unread|all，默认unread"
// @Success      200    {object}  map[string]interface{} "code=0, data={counts,total}"
// @Failure      401    {object}  map[string]interface{} "未授权"
// @Failure      400    {object}  map[string]interface{} "参数错误"
// @Failure      500    {object}  map[string]interface{} "服务错误"
// @Router       /api/notifications/stats [get]
func (nc *NotificationController) Stats(c *gin.Context) {
	userID := config.GetUserId(c)
	if userID == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	eid := config.GetEID(c)
	if eid == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	scope := c.DefaultQuery("scope", "unread")
	if scope != "unread" && scope != "all" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("invalid scope")))
		return
	}
	counts, err := nc.Svc.Stats(c, eid, userID, scope)
	if err != nil {
		logger.Errorf(c, "notifications.Stats error: %v", err)
		respErr(c, http.StatusInternalServerError, "internal error")
		return
	}
	// ensure all keys exist
	for _, k := range []string{string(model.NotificationTypePending), string(model.NotificationTypeMentionComment), string(model.NotificationTypeSystem)} {
		if _, ok := counts[k]; !ok {
			counts[k] = 0
		}
	}
	var total int64
	for _, k := range []string{string(model.NotificationTypePending), string(model.NotificationTypeMentionComment), string(model.NotificationTypeSystem)} {
		total += counts[k]
	}
	respOK(c, gin.H{"counts": counts, "total": total})
}

// MarkAllRead 批量已读
// @Summary      Mark all notifications as read
// @Description  将当前用户的所有未读通知标记为已读
// @Tags         notifications
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Success      200    {object}  map[string]interface{} "code=0, data={affected}"
// @Failure      401    {object}  map[string]interface{} "未授权"
// @Failure      500    {object}  map[string]interface{} "服务错误"
// @Router       /api/notifications/read-all [put]
func (nc *NotificationController) MarkAllRead(c *gin.Context) {
	userID := config.GetUserId(c)
	if userID == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	eid := config.GetEID(c)
	if eid == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	affected, err := nc.Svc.MarkAllRead(c, eid, userID)
	if err != nil {
		logger.Errorf(c, "notifications.MarkAllRead error: %v", err)
		respErr(c, http.StatusInternalServerError, "internal error")
		return
	}
	respOK(c, gin.H{"affected": affected})
}

// MarkOneRead 单条已读
// @Summary      Mark one notification as read
// @Description  将指定通知标记为已读（仅能操作属于当前用户的通知）
// @Tags         notifications
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        id   path      int64   true   "通知ID"
// @Success      200  {object}  map[string]interface{} "code=0, data={affected}"
// @Router       /api/notifications/{id}/read [put]
func (nc *NotificationController) MarkOneRead(c *gin.Context) {
	userID := config.GetUserId(c)
	if userID == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	eid := config.GetEID(c)
	if eid == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("invalid id")))
		return
	}
	affected, err := nc.Svc.MarkOneRead(c, eid, userID, id)
	if err != nil {
		logger.Errorf(c, "notifications.MarkOneRead error: %v", err)
		respErr(c, http.StatusInternalServerError, "internal error")
		return
	}
	respOK(c, gin.H{"affected": affected})
}

// AddBatch 批量新增通知
// @Summary      Add notifications in batch
// @Description  批量新增通知（模板+多接收者）
// @Tags         notifications
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        request  body      AddBatchBodyRequest  true  "批量新增请求"
// @Success      200      {object}  map[string]interface{} "code=0, data={created}"
// @Router       /api/notifications/batch [post]
func (nc *NotificationController) AddBatch(c *gin.Context) {
	userID := config.GetUserId(c)
	if userID == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	eid := config.GetEID(c)
	if eid == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req AddBatchBodyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("invalid json body")))
		return
	}
	if err := validateAddBatchBody(req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if req.SenderUserID == nil || *req.SenderUserID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("missing required fields")))
		return
	}
	var senderID int64
	if req.SenderUserID != nil && *req.SenderUserID > 0 {
		// 默认允许覆盖为系统或他人；若需限制，请在此加入策略校验
		senderID = *req.SenderUserID
	}
	// 去重接收者
	seen := make(map[int64]struct{}, len(req.ReceiverUserIDs))
	uniq := make([]int64, 0, len(req.ReceiverUserIDs))
	for _, rid := range req.ReceiverUserIDs {
		if rid <= 0 {
			continue
		}
		if _, ok := seen[rid]; !ok {
			seen[rid] = struct{}{}
			uniq = append(uniq, rid)
		}
	}
	if len(uniq) == 0 {
		respErr(c, http.StatusBadRequest, "receiver_user_ids is empty after dedup")
		return
	}

	created, err := nc.Svc.AddBatch(c, service.AddBatchRequest{
		Eid:             eid,
		SenderUserID:    senderID,
		Type:            req.Type,
		Content:         req.Content,
		ReceiverUserIDs: uniq,
	})
	if err != nil {
		logger.Errorf(c, "notifications.AddBatch error: %v", err)
		respErr(c, http.StatusInternalServerError, "internal error")
		return
	}
	respOK(c, gin.H{"created": created})
}
