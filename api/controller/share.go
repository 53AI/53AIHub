package controller

import (
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

type CreateShareRequest struct {
	ConversationID int64   `json:"conversation_id" binding:"required"`
	MessageIDs     []int64 `json:"message_ids"`
	SelectAll      bool    `json:"select_all"`
}

type CreateShareResponse struct {
	ShareID string `json:"share_id"`
}

// @Summary Create a share for selected messages
// @Description Create a share record under a conversation with a set of message IDs (dedup+sorted, idempotent). Returns a UUID share_id.
// @Tags Share
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param share body CreateShareRequest true "Share create payload"
// @Success 200 {object} model.CommonResponse{data=CreateShareResponse} "Success"
// @Failure 400 {object} model.CommonResponse "Param error"
// @Failure 500 {object} model.CommonResponse "DB error"
// @Router /api/shares [post]
// POST /api/shares
func CreateShare(c *gin.Context) {
	var req CreateShareRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if req.ConversationID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("invalid conversation_id"))
		return
	}

	eid := config.GetEID(c)

	// 构造用于分享的消息ID集合（支持全选）
	var idsForShare []int64
	if req.SelectAll {
		ids, err := model.ListMessageIDsByConversation(eid, req.ConversationID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
		if len(ids) == 0 {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("no messages to share"))
			return
		}
		idsForShare = ids
	} else {
		if len(req.MessageIDs) == 0 {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("empty message_ids"))
			return
		}
		idsForShare = req.MessageIDs
	}
	// 生成 normalized_key（内部已去重+升序）
	nkey, normalizedIDs := model.NormalizeMessageIDs(idsForShare)
	if nkey == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("normalized_key empty after dedup"))
		return
	}

	// 校验所有消息属于同一 eid+conversation_id
	if err := model.ValidateMessagesBelongToConversation(eid, req.ConversationID, normalizedIDs); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	shareID, _, err := model.CreateShareRecord(eid, req.ConversationID, nkey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&CreateShareResponse{ShareID: shareID}))
}

// GET /api/shares/:share_id
type GetShareResponse struct {
	Conversation struct {
		ID          int64  `json:"id"`
		Title       string `json:"title"`
		CreatedTime int64  `json:"created_time"`
	} `json:"conversation"`
	User struct {
		Nickname string `json:"nickname"`
		Avatar   string `json:"avatar"`
	} `json:"user"`
	Agent struct {
		AgentId     int64  `json:"agent_id"`
		Name        string `json:"name"`
		Logo        string `json:"logo"`
		Model       string `json:"model"`
		Description string `json:"description"`
	} `json:"agent"`
	Messages []*EnhancedMessage `json:"messages"`
}

// @Summary Get share content (public)
// @Description Get shared conversation details and messages by share_id. Anonymous access allowed.
// @Tags Share
// @Produce json
// @Param share_id path string true "Share ID (UUID)"
// @Success 200 {object} model.CommonResponse{data=GetShareResponse} "Success"
// @Failure 404 {object} model.CommonResponse "Not found"
// @Failure 400 {object} model.CommonResponse "Param error"
// @Failure 500 {object} model.CommonResponse "DB error"
// @Router /api/shares/{share_id} [get]
func GetShare(c *gin.Context) {
	shareID := c.Param("share_id")
	shareID = strings.TrimSpace(shareID)
	if shareID == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("empty share_id"))
		return
	}

	rec, err := model.GetShareRecordByShareID(shareID)
	if err != nil {
		c.JSON(http.StatusOK, model.NotFound.ToNewErrorResponse("分享不存在"))
		return
	}

	// 加载会话
	conv, err := model.AdminGetConversationByID(rec.Eid, rec.ConversationID)
	if err != nil {
		c.JSON(http.StatusOK, model.NotFound.ToNewErrorResponse("分享不存在"))
		return
	}
	// 加载用户与智能体
	if err := conv.LoadUser(); err != nil {
		c.JSON(http.StatusOK, model.NotFound.ToNewErrorResponse("分享不存在"))
		return
	}
	if err := conv.LoadAgent(); err != nil {
		c.JSON(http.StatusOK, model.NotFound.ToNewErrorResponse("分享不存在"))
		return
	}

	if !conv.Agent.Enable {
		c.JSON(http.StatusOK, model.NotFound.ToNewErrorResponse("分享不存在"))
	}

	// 解析 normalized_key 为 ids
	ids, err := model.ParseMessageIDsToIDs(rec.MessageIDs)
	if err != nil {
		c.JSON(http.StatusOK, model.ParamError.ToResponse(err))
		return
	}

	// 读取消息并升序排序
	msgs, err := model.GetMessagesByIDsOrderedAsc(rec.Eid, ids)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	resp := &GetShareResponse{}
	resp.Conversation.ID = conv.ConversationID
	resp.Conversation.Title = conv.Title
	resp.Conversation.CreatedTime = conv.CreatedTime
	resp.User.Nickname = conv.User.Nickname
	resp.User.Avatar = conv.User.Avatar
	resp.Agent.AgentId = conv.Agent.AgentID
	resp.Agent.Name = conv.Agent.Name
	resp.Agent.Logo = conv.Agent.Logo
	resp.Agent.Model = conv.Agent.Model
	resp.Agent.Description = conv.Agent.Description

	// 批量获取文件名，避免 N+1 查询
	fileMap := make(map[int64]string)
	var targetFileIDs []int64
	for _, msg := range msgs {
		if msg.FileID > 0 {
			targetFileIDs = append(targetFileIDs, msg.FileID)
		}
	}
	if len(targetFileIDs) > 0 {
		var files []model.File
		if err := model.DB.Select("id, path").Where("id IN ?", targetFileIDs).Find(&files).Error; err == nil {
			for _, f := range files {
				fileMap[f.ID] = model.ExtractSimpleFileName(f.Path)
			}
		}
	}

	resp.Messages = convertToEnhancedMessages(msgs, fileMap)

	c.JSON(http.StatusOK, model.Success.ToResponse(resp))
}
