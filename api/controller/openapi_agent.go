package controller

import (
	"errors"
	"io"
	"net/http"
	"path"
	"strings"

	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/controller/relay"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func GetOpenAPIConversations(c *gin.Context) {
	eid, userID, ok := resolveOpenAPIUser(c)
	if !ok {
		return
	}

	agentID := c.GetInt64(session.SESSION_AGENT_ID)
	visitorID := session.GetVisitorID(c)

	offset, limit, pErr := parsePagination(c.Query("offset"), c.Query("limit"))
	if pErr != nil {
		offset, limit = 0, 50
	}

	conversations, total, err := model.GetConversationsByUserIDAndTypeWithVisitorPaged(eid, userID, agentID, -1, visitorID, offset, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToOpenAIErrorResponeWithType(err, "server_error"))
		return
	}

	if conversations == nil {
		conversations = []*model.Conversation{}
	}

	type conversationItem struct {
		ID     int64  `json:"id"`
		Title  string `json:"title"`
		Source string `json:"source"`
	}
	items := make([]conversationItem, len(conversations))
	for i, conv := range conversations {
		items[i] = conversationItem{ID: conv.ConversationID, Title: conv.Title, Source: conv.Source}
	}

	c.JSON(http.StatusOK, gin.H{
		"count":         total,
		"conversations": items,
	})
}

func GetOpenAPIConversationDetail(c *gin.Context) {
	eid, userID, ok := resolveOpenAPIUser(c)
	if !ok {
		return
	}

	visitorID := session.GetVisitorID(c)

	offset, limit, pErr := parsePagination(c.Query("offset"), c.Query("limit"))
	if pErr != nil {
		offset, limit = 0, 50
	}

	conversationID, err := middleware.ParseIDParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType(err, "invalid_request_error"))
		return
	}

	conversation, err := model.GetConversationByIDWithVisitor(eid, userID, conversationID, visitorID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorResponeWithType("Conversation not found", "not_found"))
			return
		}
		c.JSON(http.StatusInternalServerError, model.SystemError.ToOpenAIErrorResponeWithType(err, "server_error"))
		return
	}

	count, messages, err := model.GetMessagesByConversationIDWithDirectionWithVisitor(eid, conversationID, userID, "", visitorID, limit, offset, "asc")
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToOpenAIErrorResponeWithType(err, "server_error"))
		return
	}

	if messages == nil {
		messages = []*model.Message{}
	}

	// Build fileMap for fileName resolution (same pattern as controller/message.go)
	fileMap := make(map[int64]string)
	var targetFileIDs []int64
	for _, msg := range messages {
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

	enhancedMessages := convertToEnhancedMessages(messages, fileMap, nil)

	c.JSON(http.StatusOK, gin.H{
		"id":       conversation.ConversationID,
		"title":    conversation.Title,
		"source":   conversation.Source,
		"count":    count,
		"messages": enhancedMessages,
	})
}

func UploadOpenAPIFile(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType(err, "invalid_request_error"))
		return
	}
	if fileHeader.Size > config.MAX_UPLOAD_FILE_SIZE {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType(
			errors.New("The maximum allowed size for file uploads is "+config.MAX_UPLOAD_FILE_SIZE_STRING+"."),
			"invalid_request_error",
		))
		return
	}

	eid, userID, ok := resolveOpenAPIUserFromForm(c)
	if !ok {
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, model.FileError.ToOpenAIErrorResponeWithType(err, "invalid_request_error"))
		return
	}
	defer file.Close()

	fileContent, err := io.ReadAll(file)
	if err != nil && err != io.EOF {
		c.JSON(http.StatusBadRequest, model.FileError.ToOpenAIErrorResponeWithType(err, "invalid_request_error"))
		return
	}

	if _, err := file.Seek(0, 0); err != nil {
		c.JSON(http.StatusBadRequest, model.FileError.ToOpenAIErrorResponeWithType(err, "invalid_request_error"))
		return
	}
	hashStr, err := storage.GetFileHash(file)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.FileError.ToOpenAIErrorResponeWithType(err, "invalid_request_error"))
		return
	}

	extension := path.Ext(fileHeader.Filename)
	previewKey, err := model.GetPreviewKey(hashStr, extension, eid)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.FileError.ToOpenAIErrorResponeWithType(err, "invalid_request_error"))
		return
	}

	key := model.GetFileKey(previewKey, eid, userID)
	err = storage.StorageInstance.Save(fileContent, key)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.FileError.ToOpenAIErrorResponeWithType(err, "invalid_request_error"))
		return
	}

	uploadFile := &model.UploadFile{
		FileName:   fileHeader.Filename,
		Key:        key,
		Eid:        eid,
		UserID:     userID,
		Size:       fileHeader.Size,
		Extension:  extension,
		MimeType:   fileHeader.Header.Get("Content-Type"),
		Hash:       hashStr,
		PreviewKey: previewKey,
	}

	err = uploadFile.Save()
	if err != nil {
		c.JSON(http.StatusBadRequest, model.FileError.ToOpenAIErrorResponeWithType(err, "invalid_request_error"))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":           uploadFile.ID,
		"file_name":    uploadFile.FileName,
		"size":         uploadFile.Size,
		"extension":    uploadFile.Extension,
		"mime_type":    uploadFile.MimeType,
		"created_time": uploadFile.CreatedTime,
	})
}

func GetOpenAPIFileInfo(c *gin.Context) {
	eid, userID, ok := resolveOpenAPIUser(c)
	if !ok {
		return
	}

	fileID, err := middleware.ParseIDParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType(err, "invalid_request_error"))
		return
	}

	uploadFile, err := model.GetUploadFileByIDAndEid(fileID, eid)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorResponeWithType("File not found", "not_found"))
			return
		}
		c.JSON(http.StatusInternalServerError, model.SystemError.ToOpenAIErrorResponeWithType(err, "server_error"))
		return
	}

	if uploadFile.UserID != userID {
		c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorResponeWithType("File not found", "not_found"))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":           uploadFile.ID,
		"file_name":    uploadFile.FileName,
		"size":         uploadFile.Size,
		"extension":    uploadFile.Extension,
		"mime_type":    uploadFile.MimeType,
		"status":       uploadFile.Status,
		"created_time": uploadFile.CreatedTime,
	})
}

// UpdateOpenAPIConversationRequest is the request body for renaming a conversation.
type UpdateOpenAPIConversationRequest struct {
	Title string `json:"title" binding:"required,max=500"`
}

// RateOpenAPIMessageRequest is the request body for message rating.
type RateOpenAPIMessageRequest struct {
	Rating string `json:"rating" binding:"required"` // "like" or "dislike"
}

// DeleteOpenAPIConversation deletes a conversation by ID.
func DeleteOpenAPIConversation(c *gin.Context) {
	eid, userID, ok := resolveOpenAPIUser(c)
	if !ok {
		return
	}

	visitorID := session.GetVisitorID(c)

	conversationID, err := middleware.ParseIDParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType(err, "invalid_request_error"))
		return
	}

	if _, err := model.GetConversationByIDWithVisitor(eid, userID, conversationID, visitorID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorResponeWithType("Conversation not found", "not_found"))
			return
		}
		c.JSON(http.StatusInternalServerError, model.SystemError.ToOpenAIErrorResponeWithType(err, "server_error"))
		return
	}

	if err := model.DeleteConversationByUser(eid, userID, conversationID); err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToOpenAIErrorResponeWithType(err, "server_error"))
		return
	}

	c.JSON(http.StatusOK, gin.H{})
}

// UpdateOpenAPIConversation renames a conversation (PATCH).
func UpdateOpenAPIConversation(c *gin.Context) {
	eid, userID, ok := resolveOpenAPIUser(c)
	if !ok {
		return
	}

	visitorID := session.GetVisitorID(c)

	conversationID, err := middleware.ParseIDParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType(err, "invalid_request_error"))
		return
	}

	conversation, err := model.GetConversationByIDWithVisitor(eid, userID, conversationID, visitorID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorResponeWithType("Conversation not found", "not_found"))
			return
		}
		c.JSON(http.StatusInternalServerError, model.SystemError.ToOpenAIErrorResponeWithType(err, "server_error"))
		return
	}

	var req UpdateOpenAPIConversationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType(err, "invalid_request_error"))
		return
	}

	conversation.Title = normalizeConversationTitle(req.Title)

	if err := model.UpdateConversation(conversation); err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToOpenAIErrorResponeWithType(err, "server_error"))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":    conversation.ConversationID,
		"title": conversation.Title,
	})
}

// GetOpenAPIAgentInfo returns the current agent's information.
func GetOpenAPIAgentInfo(c *gin.Context) {
	agentVal, exists := c.Get(session.SESSION_AGENT)
	if !exists {
		c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorResponeWithType("Agent not found", "not_found"))
		return
	}

	agent, ok := agentVal.(*model.Agent)
	if !ok || agent == nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorResponeWithType("Agent not found", "not_found"))
		return
	}

	agent.FillBotID()

	c.JSON(http.StatusOK, gin.H{
		"id":          agent.BotID,
		"agent_id":    agent.AgentID,
		"bot_id":      agent.BotID,
		"name":        agent.Name,
		"description": agent.Description,
		"model":       agent.Model,
	})
}

type CreateOpenAPIConversationRequest struct {
	Title        string `json:"title" example:"New conversation"`
	FileID       int64  `json:"file_id" example:"0"`
	DocumentType string `json:"document_type" example:"wiki" enums:"file,wiki"`
	DocumentID   int64  `json:"document_id" example:"0"`
}

// CreateOpenAPIConversation creates a new conversation for the authenticated agent.
// @Summary Create a conversation
// @Description Creates a conversation and optionally binds it to one File or Wiki document.
// @Tags OpenAPI
// @Accept json
// @Produce json
// @Param conversation body CreateOpenAPIConversationRequest false "Conversation parameters"
// @Success 200 {object} map[string]interface{}
// @Router /v1/conversations [post]
func CreateOpenAPIConversation(c *gin.Context) {
	eid, userID, ok := resolveOpenAPIUser(c)
	if !ok {
		return
	}

	agentVal, exists := c.Get(session.SESSION_AGENT)
	if !exists {
		c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorResponeWithType("Agent not found", "not_found"))
		return
	}
	agent, ok := agentVal.(*model.Agent)
	if !ok || agent == nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorResponeWithType("Agent not found", "not_found"))
		return
	}

	if !agent.Enable {
		c.JSON(http.StatusForbidden, model.ForbiddenError.ToOpenAIErrorResponeWithType("Agent is disabled", "permission_error"))
		return
	}

	var req CreateOpenAPIConversationRequest
	if c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType(err, "invalid_request_error"))
			return
		}
	}
	documentType, documentID, err := resolveConversationDocumentReference(req.DocumentType, req.DocumentID, req.FileID)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType("invalid document reference", "invalid_request_error"))
		return
	}

	conversation := &model.Conversation{
		Eid:     eid,
		UserID:  userID,
		AgentID: agent.AgentID,
		Title:   req.Title,
		Status:  model.ConversationStatusActive,
		Model:   agent.Model,
		Source:  model.MessageRequestSourceAPI,
		FileID: func() int64 {
			if documentType == model.DocumentTypeFile {
				return documentID
			}
			return 0
		}(),
		DocumentType: documentType,
		DocumentID:   documentID,
	}
	if conversation.Title == "" {
		conversation.Title = "New conversation"
	}
	relay.ApplyVisitorIdentityToConversation(c, conversation)

	if err := model.CreateConversation(conversation); err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToOpenAIErrorResponeWithType(err, "server_error"))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":    conversation.ConversationID,
		"title": conversation.Title,
	})
}

// RateOpenAPIMessage likes or dislikes a message (toggle).
func RateOpenAPIMessage(c *gin.Context) {
	eid, userID, ok := resolveOpenAPIUser(c)
	if !ok {
		return
	}

	messageID, err := middleware.ParseIDParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType(err, "invalid_request_error"))
		return
	}

	var req RateOpenAPIMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType(err, "invalid_request_error"))
		return
	}

	var feedbackType string
	switch req.Rating {
	case "like":
		feedbackType = model.FeedbackTypeSatisfied
	case "dislike":
		feedbackType = model.FeedbackTypeUnsatisfied
	default:
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType("rating must be 'like' or 'dislike'", "invalid_request_error"))
		return
	}

	message, err := model.GetMessageByID(eid, messageID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorResponeWithType("Message not found", "not_found"))
			return
		}
		c.JSON(http.StatusInternalServerError, model.SystemError.ToOpenAIErrorResponeWithType(err, "server_error"))
		return
	}
	if message.UserID != userID || message.VisitorID != session.GetVisitorID(c) {
		c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorResponeWithType("Message not found", "not_found"))
		return
	}

	existingFeedback, lookupErr := model.GetFeedbackByMessageAndUser(eid, messageID, userID)
	if lookupErr == nil && existingFeedback != nil {
		if existingFeedback.FeedbackType == feedbackType {
			if err := model.DeleteFeedback(existingFeedback.ID); err != nil {
				c.JSON(http.StatusInternalServerError, model.SystemError.ToOpenAIErrorResponeWithType(err, "server_error"))
				return
			}
			c.JSON(http.StatusOK, gin.H{"rating": nil})
			return
		}
		existingFeedback.FeedbackType = feedbackType
		if err := model.UpdateFeedback(existingFeedback); err != nil {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToOpenAIErrorResponeWithType(err, "server_error"))
			return
		}
		c.JSON(http.StatusOK, gin.H{"rating": req.Rating})
		return
	}

	if _, err := service.CreateFeedback(eid, messageID, userID, feedbackType, "", "", ""); err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToOpenAIErrorResponeWithType(err, "server_error"))
		return
	}

	c.JSON(http.StatusOK, gin.H{"rating": req.Rating})
}

// CancelOpenAPIChatCompletion cancels an active streaming chat completion run.
func CancelOpenAPIChatCompletion(c *gin.Context) {
	eid, userID, ok := resolveOpenAPIUser(c)
	if !ok {
		return
	}

	runID := c.Param("run_id")
	if runID == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType("run_id is required", "invalid_request_error"))
		return
	}

	agentRunService := service.NewAgentRunService()
	run, err := agentRunService.RequestCancelRun(c.Request.Context(), eid, userID, config.GetUserRole(c), runID)
	if err != nil {
		if errors.Is(err, service.ErrAgentRunNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorResponeWithType("Run not found", "not_found"))
			return
		}
		c.JSON(http.StatusInternalServerError, model.SystemError.ToOpenAIErrorResponeWithType(err, "server_error"))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"run_id": run.RunID,
		"status": run.Status,
	})
}

func resolveOpenAPIUser(c *gin.Context) (eid, userID int64, ok bool) {
	eid = config.GetEID(c)
	if eid == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType(nil, "invalid_request_error"))
		return 0, 0, false
	}

	userParam := c.Query("user")
	if strings.TrimSpace(userParam) == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType("user query parameter is required", "invalid_request_error"))
		return 0, 0, false
	}

	if err := relay.ResolveAPIUserFromIdentifier(c, userParam); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType(err.Error(), "invalid_request_error"))
		return 0, 0, false
	}

	userID = config.GetUserId(c)
	if userID == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType(nil, "invalid_request_error"))
		return 0, 0, false
	}

	return eid, userID, true
}

func resolveOpenAPIUserFromForm(c *gin.Context) (eid, userID int64, ok bool) {
	eid = config.GetEID(c)
	if eid == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType(nil, "invalid_request_error"))
		return 0, 0, false
	}

	userParam := strings.TrimSpace(c.PostForm("user"))
	if userParam == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType("user form field is required", "invalid_request_error"))
		return 0, 0, false
	}

	if err := relay.ResolveAPIUserFromIdentifier(c, userParam); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType(err.Error(), "invalid_request_error"))
		return 0, 0, false
	}

	userID = config.GetUserId(c)
	if userID == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType(nil, "invalid_request_error"))
		return 0, 0, false
	}

	return eid, userID, true
}

// GetOpenAPIAgentSkills returns the skill list bound to the current API Key's agent.
func GetOpenAPIAgentSkills(c *gin.Context) {
	agentVal, exists := c.Get(session.SESSION_AGENT)
	if !exists {
		c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorResponeWithType("Agent not found", "not_found"))
		return
	}
	agent, ok := agentVal.(*model.Agent)
	if !ok || agent == nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorResponeWithType("Agent not found", "not_found"))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	if eid == 0 || userID == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType(nil, "invalid_request_error"))
		return
	}

	items, err := model.ListAgentSkillBindingsWithSkills(eid, agent.AgentID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToOpenAIErrorResponeWithType(err, "server_error"))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"agent_id": agent.AgentID,
		"skills":   items,
	})
}
