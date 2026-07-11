package controller

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

// UploadOpenClawArtifact godoc
// @Summary 上传 OpenClaw 生成工件
// @Description OpenClaw/QClaw 插件将本轮生成文件上传到 53AIHub，并返回服务器侧预览/下载地址。
// @Tags OpenClaw
// @Accept multipart/form-data
// @Produce json
// @Param file formData file true "文件"
// @Param agent_id formData string true "智能体ID"
// @Param user_id formData string false "53AIHub 用户标识"
// @Param conversation_id formData string false "OpenClaw 会话ID"
// @Param turn_id formData string false "Canonical turn ID"
// @Param active_request_id formData string false "Active request ID"
// @Param logical_path formData string false "逻辑文件路径"
// @Success 200 {object} model.CommonResponse
// @Router /api/v1/openclaw/artifacts [post]
func UploadOpenClawArtifact(c *gin.Context) {
	agentIDValue, secret := readOpenClawPluginCredentials(c)
	if agentIDValue == "" {
		agentIDValue = strings.TrimSpace(c.PostForm("agent_id"))
	}
	agent, svcErr := service.AuthenticateOpenClawPlugin(agentIDValue, secret)
	if svcErr != nil {
		respondOpenClawServiceError(c, svcErr)
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	userKey := firstOpenClawFormValue(c, "user_id", "user", "chat_id", "chatId")
	data, svcErr := service.NewOpenClawService().UploadArtifact(c.Request.Context(), service.OpenClawArtifactUploadRequest{
		AgentID:         agent.AgentID,
		UserKey:         userKey,
		ConversationID:  firstOpenClawFormValue(c, "conversation_id", "session_id"),
		TurnID:          c.PostForm("turn_id"),
		ActiveRequestID: c.PostForm("active_request_id"),
		PartID:          c.PostForm("part_id"),
		LogicalPath:     c.PostForm("logical_path"),
		APIBaseURL:      resolveOpenClawRequestAPIBaseURL(c),
		FileHeader:      fileHeader,
	})
	if svcErr != nil {
		respondOpenClawServiceError(c, svcErr)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// PreviewOpenClawArtifact godoc
// @Summary 预览 OpenClaw 工件
// @Description 由 53AIHub 校验企业、用户、智能体访问权限后预览指定工件。
// @Tags OpenClaw
// @Accept json
// @Produce octet-stream
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Param artifact_id path int true "工件ID"
// @Success 200 {file} binary
// @Router /api/openclaw/agents/{agent_id}/artifacts/{artifact_id}/preview [get]
func PreviewOpenClawArtifact(c *gin.Context) {
	req, ok := buildOpenClawRequestContext(c)
	if !ok {
		return
	}
	artifactID, err := hashids.TryParseID(c.Param("artifact_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	artifact, uploadFile, svcErr := service.NewOpenClawService().GetArtifactForUser(req, artifactID)
	if svcErr != nil {
		respondOpenClawServiceError(c, svcErr)
		return
	}
	ext := strings.ToLower(filepath.Ext(uploadFile.FileName))
	if ext == "" {
		ext = strings.ToLower(filepath.Ext(artifact.LogicalPath))
	}
	if err := serveUploadFilePreview(c, artifact.ID, uploadFile, ext); err != nil {
		return
	}
}

// DownloadOpenClawArtifact godoc
// @Summary 下载 OpenClaw 工件
// @Description 由 53AIHub 校验企业、用户、智能体访问权限后下载指定工件。
// @Tags OpenClaw
// @Accept json
// @Produce octet-stream
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Param artifact_id path int true "工件ID"
// @Success 200 {file} binary
// @Router /api/openclaw/agents/{agent_id}/artifacts/{artifact_id}/download [get]
func DownloadOpenClawArtifact(c *gin.Context) {
	req, ok := buildOpenClawRequestContext(c)
	if !ok {
		return
	}
	artifactID, err := hashids.TryParseID(c.Param("artifact_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	_, uploadFile, svcErr := service.NewOpenClawService().GetArtifactForUser(req, artifactID)
	if svcErr != nil {
		respondOpenClawServiceError(c, svcErr)
		return
	}
	serveUploadFile(c, uploadFile)
}

// EnsureOpenClawSkill godoc
// @Summary 确保 OpenClaw/QClaw 已安装指定技能
// @Description 校验 53AIHub skill 权限后，通过插件 RPC 幂等安装并启用技能。
// @Tags OpenClaw
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Param skill_id path string true "技能ID或skill_name"
// @Success 200 {object} model.CommonResponse
// @Router /api/openclaw/agents/{agent_id}/skills/{skill_id}/ensure [post]
func EnsureOpenClawSkill(c *gin.Context) {
	req, ok := buildOpenClawRequestContext(c)
	if !ok {
		return
	}
	skillID, err := service.ResolveOpenClawSkillIdentifier(c.Request.Context(), req.EID, c.Param("skill_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	data, svcErr := service.NewOpenClawService().EnsureSkill(c.Request.Context(), req, skillID)
	if svcErr != nil {
		respondOpenClawServiceError(c, svcErr)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// DownloadOpenClawSkillPackage godoc
// @Summary 插件下载 OpenClaw skill 安装包
// @Description 仅允许通过 OpenClaw/QClaw 插件鉴权下载 skill zip 包。
// @Tags OpenClaw
// @Accept json
// @Produce octet-stream
// @Param skill_id path int true "技能ID"
// @Success 200 {file} binary
// @Router /api/v1/openclaw/skills/{skill_id}/package [get]
func DownloadOpenClawSkillPackage(c *gin.Context) {
	agentIDValue, secret := readOpenClawPluginCredentials(c)
	if agentIDValue == "" {
		agentIDValue = strings.TrimSpace(c.Query("agent_id"))
	}
	agent, svcErr := service.AuthenticateOpenClawPlugin(agentIDValue, secret)
	if svcErr != nil {
		respondOpenClawServiceError(c, svcErr)
		return
	}
	skillID, err := hashids.TryParseID(c.Param("skill_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	fileName, content, svcErr := service.DownloadOpenClawSkillPackage(c.Request.Context(), agent, skillID)
	if svcErr != nil {
		respondOpenClawServiceError(c, svcErr)
		return
	}
	if strings.TrimSpace(fileName) == "" {
		fileName = "skill.zip"
	}
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", fileName))
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Length", fmt.Sprintf("%d", len(content)))
	c.Data(http.StatusOK, "application/zip", content)
}

func readOpenClawPluginCredentials(c *gin.Context) (string, string) {
	agentIDValue := strings.TrimSpace(c.GetHeader("X-Bot-Id"))
	if agentIDValue == "" {
		agentIDValue = strings.TrimSpace(c.GetHeader("X-Agent-Id"))
	}
	if agentIDValue == "" {
		agentIDValue = strings.TrimSpace(c.Query("botId"))
	}
	if agentIDValue == "" {
		agentIDValue = strings.TrimSpace(c.Query("agent_id"))
	}

	secret := strings.TrimSpace(c.GetHeader("X-Api-Key"))
	if secret == "" {
		authHeader := strings.TrimSpace(c.GetHeader("Authorization"))
		if strings.HasPrefix(authHeader, "Bearer ") {
			secret = strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
		}
	}
	if secret == "" {
		secret = strings.TrimSpace(c.GetHeader("X-Agent-Secret"))
	}
	if secret == "" {
		secret = strings.TrimSpace(c.Query("secret"))
	}
	return agentIDValue, secret
}

func firstOpenClawFormValue(c *gin.Context, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(c.PostForm(key)); value != "" {
			return value
		}
	}
	return ""
}
