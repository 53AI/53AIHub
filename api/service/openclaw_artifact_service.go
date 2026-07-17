package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

type OpenClawArtifactUploadRequest struct {
	AgentID         int64
	UserKey         string
	ConversationID  string
	TurnID          string
	ActiveRequestID string
	PartID          string
	LogicalPath     string
	APIBaseURL      string
	FileHeader      *multipart.FileHeader
}

type OpenClawArtifactResponse struct {
	ArtifactID        string `json:"artifact_id"`
	UploadFileID      string `json:"upload_file_id"`
	ID                string `json:"id"`
	FileName          string `json:"file_name"`
	MimeType          string `json:"mime_type"`
	Size              int64  `json:"size"`
	Hash              string `json:"sha256"`
	PreviewKey        string `json:"preview_key"`
	PreviewURL        string `json:"preview_url"`
	URL               string `json:"url"`
	DownloadURL       string `json:"download_url"`
	SignedDownloadURL string `json:"signed_download_url"`
	SourceKind        string `json:"source_kind"`
	ConversationID    string `json:"conversation_id,omitempty"`
	TurnID            string `json:"turn_id,omitempty"`
	ActiveRequestID   string `json:"active_request_id,omitempty"`
	LogicalPath       string `json:"logical_path,omitempty"`
}

type OpenClawSkillEnsureResponse struct {
	Status      string      `json:"status"`
	SkillID     string      `json:"skill_id"`
	SkillName   string      `json:"skill_name"`
	DisplayName string      `json:"display_name"`
	Version     string      `json:"version"`
	SHA256      string      `json:"sha256"`
	Runtime     interface{} `json:"runtime,omitempty"`
	Error       string      `json:"error,omitempty"`
}

type openClawRuntimeSkillEnsureResult struct {
	OK     *bool  `json:"ok"`
	Status string `json:"status"`
	Error  string `json:"error"`
}

func ResolveOpenClawSkillIdentifier(ctx context.Context, eid int64, identifier string) (int64, error) {
	trimmed := strings.TrimSpace(identifier)
	if trimmed == "" {
		return 0, fmt.Errorf("skill identifier is required")
	}
	if skillID, err := hashids.TryParseID(trimmed); err == nil && skillID > 0 {
		return skillID, nil
	}

	skillInfo, err := model.GetSkillLibraryByNameAndEID(eid, trimmed)
	if err != nil {
		return 0, err
	}
	if skillInfo == nil || skillInfo.ID <= 0 {
		return 0, gorm.ErrRecordNotFound
	}
	return skillInfo.ID, nil
}

func AuthenticateOpenClawPlugin(agentIDValue string, secret string) (*model.Agent, *OpenClawServiceError) {
	agentID, err := hashids.TryParseID(strings.TrimSpace(agentIDValue))
	if err != nil {
		return nil, newOpenClawServiceError(http.StatusUnauthorized, model.UnauthorizedError, "Invalid agent ID format", err)
	}
	agent, err := getOpenClawAgentByAgentID(agentID)
	if err != nil {
		return nil, newOpenClawServiceError(http.StatusUnauthorized, model.UnauthorizedError, "Agent not found", err)
	}
	if !agent.IsOpenClawWSCompatible() {
		return nil, newOpenClawServiceError(http.StatusForbidden, model.ForbiddenError, "Agent is not a WebSocket OpenClaw agent", nil)
	}
	if storedSecret := agent.GetOpenClawAppSecret(); storedSecret == "" || storedSecret != secret {
		return nil, newOpenClawServiceError(http.StatusUnauthorized, model.UnauthorizedError, "Invalid secret", nil)
	}
	return agent, nil
}

func (s *OpenClawService) UploadArtifact(ctx context.Context, req OpenClawArtifactUploadRequest) (*OpenClawArtifactResponse, *OpenClawServiceError) {
	if req.AgentID <= 0 {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "agent_id is required", nil)
	}
	if req.FileHeader == nil {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "file is required", nil)
	}

	agent, err := getOpenClawAgentByAgentID(req.AgentID)
	if err != nil {
		return nil, newOpenClawServiceError(http.StatusNotFound, model.NotFound, "OpenClaw 智能体不存在", err)
	}
	if !agent.IsOpenClawWSCompatible() {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "目标智能体不是 OpenClawWS 类型", nil)
	}

	userID := parseOpenClawHubUserID(req.UserKey)
	file, err := req.FileHeader.Open()
	if err != nil {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "无法读取上传文件", err)
	}
	defer file.Close()

	hashValue, err := storage.GetFileHash(file)
	if err != nil {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "无法计算文件哈希", err)
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "无法重置上传文件读取位置", err)
	}

	fileName := sanitizeOpenClawArtifactFileName(req.FileHeader.Filename, req.LogicalPath)
	mimeType := normalizeOpenClawArtifactMimeType(req.FileHeader.Header.Get("Content-Type"), fileName, req.LogicalPath)

	uploadFile, getErr := model.GetUploadFileByEidUserHashAndSourceType(agent.Eid, userID, hashValue, model.UploadFileSourceAIGenerated)
	if getErr != nil {
		if !errors.Is(getErr, gorm.ErrRecordNotFound) {
			return nil, newOpenClawServiceError(http.StatusInternalServerError, model.DBError, "查询文件去重记录失败", getErr)
		}
		uploadFile = nil
	}

	if uploadFile == nil {
		storageKey := buildOpenClawArtifactStorageKey(fileName, agent.Eid, req.AgentID, userID, hashValue)
		if err := storage.StorageInstance.SaveFromReader(file, storageKey); err != nil {
			return nil, newOpenClawServiceError(http.StatusInternalServerError, model.FileError, "保存 OpenClaw 工件失败", err)
		}
		previewKey, _ := model.GetPreviewKey(hashValue, strings.ToLower(filepath.Ext(fileName)), agent.Eid)
		uploadFile = &model.UploadFile{
			MessageID:         0,
			SourceType:        model.UploadFileSourceAIGenerated,
			FileName:          fileName,
			Key:               storageKey,
			Eid:               agent.Eid,
			UserID:            userID,
			Size:              req.FileHeader.Size,
			Extension:         strings.ToLower(filepath.Ext(fileName)),
			MimeType:          mimeType,
			Hash:              hashValue,
			PreviewKey:        previewKey,
			Status:            model.UploadStatusCompleted,
			ProcessedTime:     time.Now().UTC().UnixMilli(),
			BaseModel:         model.BaseModel{},
			DownloadURL:       "",
			SignedDownloadURL: "",
		}
		if err := model.CreateAIUploadFile(uploadFile); err != nil {
			return nil, newOpenClawServiceError(http.StatusInternalServerError, model.DBError, "创建 OpenClaw 工件文件记录失败", err)
		}
	}

	artifact, findErr := model.FindOpenClawArtifactByScope(
		agent.Eid,
		req.AgentID,
		uploadFile.ID,
		strings.TrimSpace(req.ConversationID),
		strings.TrimSpace(req.TurnID),
		strings.TrimSpace(req.LogicalPath),
	)
	if findErr != nil && !model.IsOpenClawArtifactNotFound(findErr) {
		return nil, newOpenClawServiceError(http.StatusInternalServerError, model.DBError, "查询 OpenClaw 工件映射失败", findErr)
	}
	if artifact == nil {
		artifact = &model.OpenClawArtifact{
			Eid:             agent.Eid,
			AgentID:         req.AgentID,
			UserID:          userID,
			ConversationID:  strings.TrimSpace(req.ConversationID),
			TurnID:          strings.TrimSpace(req.TurnID),
			ActiveRequestID: strings.TrimSpace(req.ActiveRequestID),
			PartID:          strings.TrimSpace(req.PartID),
			LogicalPath:     strings.TrimSpace(req.LogicalPath),
			UploadFileID:    uploadFile.ID,
			Hash:            hashValue,
			MimeType:        uploadFile.MimeType,
			Size:            uploadFile.Size,
		}
		if err := model.CreateOpenClawArtifact(artifact); err != nil {
			return nil, newOpenClawServiceError(http.StatusInternalServerError, model.DBError, "创建 OpenClaw 工件映射失败", err)
		}
	}
	artifact.UploadFile = uploadFile

	logger.Infof(ctx, "[openclaw-artifact] uploaded agent_id=%d artifact_id=%d upload_file_id=%d size=%d", req.AgentID, artifact.ID, uploadFile.ID, uploadFile.Size)
	return buildOpenClawArtifactResponse(artifact, uploadFile, req.APIBaseURL), nil
}

func (s *OpenClawService) GetArtifactForUser(req OpenClawRequestContext, artifactID int64) (*model.OpenClawArtifact, *model.UploadFile, *OpenClawServiceError) {
	if artifactID <= 0 {
		return nil, nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "artifact_id is required", nil)
	}
	if _, svcErr := s.loadAgent(req); svcErr != nil {
		return nil, nil, svcErr
	}
	artifact, err := model.GetOpenClawArtifactByIDAndScope(req.EID, req.AgentID, artifactID)
	if err != nil {
		return nil, nil, newOpenClawServiceError(http.StatusNotFound, model.NotFound, "OpenClaw 工件不存在", err)
	}
	uploadFile, err := model.GetAIUploadFileByEidAndID(req.EID, artifact.UploadFileID)
	if err != nil {
		return nil, nil, newOpenClawServiceError(http.StatusNotFound, model.NotFound, "OpenClaw 工件文件不存在", err)
	}
	artifact.UploadFile = uploadFile
	return artifact, uploadFile, nil
}

func (s *OpenClawService) EnsureSkill(ctx context.Context, req OpenClawRequestContext, skillID int64) (*OpenClawSkillEnsureResponse, *OpenClawServiceError) {
	if skillID <= 0 {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "skill_id is required", nil)
	}
	if _, svcErr := s.loadAgent(req); svcErr != nil {
		return nil, svcErr
	}

	skillSvc := NewSkillLibraryService()
	detail, err := skillSvc.GetSkillDetailForUser(ctx, req.EID, req.UserID, req.GroupID, skillID)
	if err != nil {
		return nil, newOpenClawServiceError(http.StatusNotFound, model.NotFound, "技能不存在或不可见", err)
	}
	if detail.PublishStatus != model.SkillPublishStatusPublished {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "技能尚未发布", nil)
	}
	if detail.AdminStatus != model.SkillAdminStatusEnabled {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "技能已被禁用", nil)
	}
	if strings.TrimSpace(detail.OriginZipKey) == "" {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "技能缺少可安装包", nil)
	}
	if len(detail.EnvVars) > 0 {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "当前 OpenClaw 自动安装暂不支持需要环境变量的技能", nil)
	}

	skillHashID := encodeOpenClawID(skillID)
	agentHashID := encodeOpenClawID(req.AgentID)
	packageURL := buildOpenClawPublicURL(req.APIBaseURL, "api/v1/openclaw/skills/"+skillHashID+"/package?agent_id="+agentHashID)
	payload := map[string]interface{}{
		"skill_id":     skillHashID,
		"skill_name":   detail.SkillName,
		"display_name": detail.DisplayName,
		"version":      detail.Version,
		"package_url":  packageURL,
		"sha256":       detail.OriginZipSHA256,
		"zip_name":     detail.OriginZipName,
	}

	data, svcErr := s.call(ctx, req, "runtime.skills.ensure", payload)
	response := &OpenClawSkillEnsureResponse{
		Status:      "failed",
		SkillID:     skillHashID,
		SkillName:   detail.SkillName,
		DisplayName: detail.DisplayName,
		Version:     detail.Version,
		SHA256:      detail.OriginZipSHA256,
	}
	if svcErr != nil {
		response.Error = svcErr.Error()
		return response, svcErr
	}
	response.Status = "installed"
	response.Runtime = data
	status := extractOpenClawRuntimeStatus(data)
	if status != "" {
		response.Status = status
	}
	runtimeResult := parseOpenClawRuntimeSkillEnsureResult(data)
	if runtimeResult.Error != "" {
		response.Error = runtimeResult.Error
	}
	if response.Status == "failed" || (runtimeResult.OK != nil && !*runtimeResult.OK) {
		errorMessage := strings.TrimSpace(response.Error)
		if errorMessage == "" {
			errorMessage = "OpenClaw 技能安装失败"
		}
		logger.Warnf(ctx, "[openclaw-skill] ensure failed agent_id=%d skill_id=%d skill_name=%s status=%s err=%s", req.AgentID, skillID, detail.SkillName, response.Status, errorMessage)
		return response, newOpenClawServiceError(http.StatusBadGateway, model.NetworkError, errorMessage, nil)
	}
	logger.Infof(ctx, "[openclaw-skill] ensure ok agent_id=%d skill_id=%d skill_name=%s status=%s", req.AgentID, skillID, detail.SkillName, response.Status)
	return response, nil
}

func DownloadOpenClawSkillPackage(ctx context.Context, agent *model.Agent, skillID int64) (string, []byte, *OpenClawServiceError) {
	if agent == nil {
		return "", nil, newOpenClawServiceError(http.StatusUnauthorized, model.UnauthorizedError, "Agent not found", nil)
	}
	if skillID <= 0 {
		return "", nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "skill_id is required", nil)
	}
	skillInfo, err := model.GetSkillLibraryByIDForTenant(agent.Eid, skillID)
	if err != nil {
		return "", nil, newOpenClawServiceError(http.StatusNotFound, model.NotFound, "技能不存在", err)
	}
	if skillInfo.PublishStatus != model.SkillPublishStatusPublished || skillInfo.AdminStatus != model.SkillAdminStatusEnabled {
		return "", nil, newOpenClawServiceError(http.StatusForbidden, model.ForbiddenError, "技能不可安装", nil)
	}
	if strings.TrimSpace(skillInfo.OriginZipKey) == "" {
		return "", nil, newOpenClawServiceError(http.StatusNotFound, model.NotFound, "技能缺少可安装包", nil)
	}
	content, err := storage.StorageInstance.Load(skillInfo.OriginZipKey)
	if err != nil {
		return "", nil, newOpenClawServiceError(http.StatusInternalServerError, model.FileError, "读取技能包失败", err)
	}
	fileName := strings.TrimSpace(skillInfo.OriginZipName)
	if fileName == "" {
		fileName = skillInfo.SkillName + ".zip"
	}
	logger.Infof(ctx, "[openclaw-skill] package download agent_id=%d skill_id=%d bytes=%d", agent.AgentID, skillID, len(content))
	return fileName, content, nil
}

func getOpenClawAgentByAgentID(agentID int64) (*model.Agent, error) {
	var agent model.Agent
	if err := model.DB.Where("agent_id = ?", agentID).First(&agent).Error; err != nil {
		return nil, err
	}
	return &agent, nil
}

func parseOpenClawHubUserID(value string) int64 {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0
	}
	trimmed = strings.TrimPrefix(trimmed, "agenthub_u")
	if id, err := hashids.TryParseID(trimmed); err == nil {
		return id
	}
	if id, err := strconv.ParseInt(trimmed, 10, 64); err == nil && id > 0 {
		return id
	}
	return 0
}

func sanitizeOpenClawArtifactFileName(fileName string, logicalPath string) string {
	for _, candidate := range []string{fileName, logicalPath, "openclaw-artifact"} {
		trimmed := strings.TrimSpace(candidate)
		if trimmed == "" {
			continue
		}
		cleaned := strings.TrimSpace(path.Base(strings.ReplaceAll(trimmed, "\\", "/")))
		if cleaned != "" && cleaned != "." && cleaned != "/" {
			return cleaned
		}
	}
	return "openclaw-artifact"
}

func normalizeOpenClawArtifactMimeType(contentType string, fileName string, logicalPath string) string {
	ext := strings.ToLower(filepath.Ext(fileName))
	if ext == "" {
		ext = strings.ToLower(filepath.Ext(logicalPath))
	}
	baseType := strings.TrimSpace(strings.Split(strings.TrimSpace(contentType), ";")[0])
	if baseType == "" || strings.EqualFold(baseType, "application/octet-stream") {
		baseType = strings.TrimSpace(mime.TypeByExtension(ext))
		baseType = strings.TrimSpace(strings.Split(baseType, ";")[0])
	}
	switch ext {
	case ".md", ".markdown":
		return "text/markdown; charset=utf-8"
	case ".txt", ".log", ".csv":
		return "text/plain; charset=utf-8"
	case ".html", ".htm":
		return "text/html; charset=utf-8"
	case ".json":
		return "application/json; charset=utf-8"
	case ".yaml", ".yml":
		return "text/yaml; charset=utf-8"
	case ".py":
		return "text/x-python; charset=utf-8"
	case ".js":
		return "application/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	}
	if baseType == "" {
		return "application/octet-stream"
	}
	return baseType
}

func buildOpenClawArtifactStorageKey(fileName string, eid, agentID, userID int64, hashValue string) string {
	prefix := hashValue
	if len(prefix) > 16 {
		prefix = prefix[:16]
	}
	return storage.StorageInstance.GetBasePath() + "/" + path.Join(
		"openclaw_artifacts",
		strconv.FormatInt(eid, 10),
		strconv.FormatInt(agentID, 10),
		strconv.FormatInt(userID, 10),
		prefix+"_"+sanitizeOpenClawArtifactFileName(fileName, ""),
	)
}

func buildOpenClawArtifactResponse(artifact *model.OpenClawArtifact, uploadFile *model.UploadFile, apiBaseURL string) *OpenClawArtifactResponse {
	if artifact == nil || uploadFile == nil {
		return nil
	}
	_ = apiBaseURL
	artifactID := encodeOpenClawID(artifact.ID)
	uploadFileID := encodeOpenClawID(uploadFile.ID)
	agentID := encodeOpenClawID(artifact.AgentID)
	previewURL := buildOpenClawPreviewURL(uploadFile.PreviewKey)
	downloadURL := buildOpenClawRelativeURL("api/openclaw/agents/" + agentID + "/artifacts/" + artifactID + "/download")
	return &OpenClawArtifactResponse{
		ArtifactID:        artifactID,
		UploadFileID:      uploadFileID,
		ID:                artifactID,
		FileName:          uploadFile.FileName,
		MimeType:          uploadFile.MimeType,
		Size:              uploadFile.Size,
		Hash:              uploadFile.Hash,
		PreviewKey:        uploadFile.PreviewKey,
		PreviewURL:        previewURL,
		URL:               previewURL,
		DownloadURL:       downloadURL,
		SignedDownloadURL: uploadFile.GetAISignedDownloadURL(168 * time.Hour),
		SourceKind:        "openclaw_artifact",
		ConversationID:    artifact.ConversationID,
		TurnID:            artifact.TurnID,
		ActiveRequestID:   artifact.ActiveRequestID,
		LogicalPath:       artifact.LogicalPath,
	}
}

func buildOpenClawPreviewURL(previewKey string) string {
	previewKey = strings.TrimLeft(strings.TrimSpace(previewKey), "/")
	if previewKey == "" {
		return ""
	}
	return buildOpenClawRelativeURL("api/preview/" + previewKey)
}

func buildOpenClawRelativeURL(pathValue string) string {
	return "/" + strings.TrimLeft(pathValue, "/")
}

func buildOpenClawPublicURL(apiBaseURL string, pathValue string) string {
	baseURL := strings.TrimSpace(apiBaseURL)
	if baseURL == "" {
		baseURL = config.GetApiHost()
	}
	return strings.TrimRight(baseURL, "/") + "/" + strings.TrimLeft(pathValue, "/")
}

func encodeOpenClawID(id int64) string {
	if encoded, err := hashids.Encode(id); err == nil && encoded != "" {
		return encoded
	}
	return strconv.FormatInt(id, 10)
}

func extractOpenClawRuntimeStatus(data []byte) string {
	raw := strings.TrimSpace(string(data))
	if raw == "" {
		return ""
	}
	for _, status := range []string{"up_to_date", "installed", "failed"} {
		if strings.Contains(raw, fmt.Sprintf(`"status":"%s"`, status)) {
			return status
		}
	}
	return ""
}

func parseOpenClawRuntimeSkillEnsureResult(data []byte) openClawRuntimeSkillEnsureResult {
	var result openClawRuntimeSkillEnsureResult
	if len(data) == 0 {
		return result
	}
	_ = json.Unmarshal(data, &result)
	return result
}
