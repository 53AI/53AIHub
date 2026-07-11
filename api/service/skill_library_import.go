package service

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	skillsvc "github.com/53AI/53AIHub/service/skill"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var skillNameNormalizeRegexp = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)

func buildGithubSourceRef(repoURL, ref, skillPath string) string {
	repoURL = strings.TrimSpace(repoURL)
	ref = strings.TrimSpace(ref)
	if ref == "" {
		ref = defaultGithubRef
	}
	skillPath = strings.TrimSpace(skillPath)
	if skillPath == "" {
		return fmt.Sprintf("%s@%s", repoURL, ref)
	}
	return fmt.Sprintf("%s@%s:%s", repoURL, ref, skillPath)
}

func parseGithubSourceSkillPath(sourceRef string) string {
	sourceRef = strings.TrimSpace(sourceRef)
	if sourceRef == "" {
		return ""
	}
	_, refPart, ok := strings.Cut(sourceRef, "@")
	if !ok {
		return ""
	}
	_, skillPath, hasPath := strings.Cut(refPart, ":")
	if !hasPath {
		return ""
	}
	return strings.TrimSpace(skillPath)
}

func (s *SkillLibraryService) importSkillFromUploadFile(ctx context.Context, req *SkillImportRequest) (*SkillImportResult, error) {
	return s.importSkillFromUploadFileWithPermissions(ctx, req, nil, 0)
}

func (s *SkillLibraryService) importSkillFromUploadFileWithPermissions(ctx context.Context, req *SkillImportRequest, permissionGroupIDs []int64, jobID int64) (*SkillImportResult, error) {
	uploadFileID, err := hashids.TryParseID(strings.TrimSpace(req.UploadFileID))
	if err != nil || uploadFileID <= 0 {
		return nil, fmt.Errorf("%w: upload_file_id", ErrSkillImportRequestInvalid)
	}

	uploadFile, err := model.GetUploadFileByID(uploadFileID)
	if err != nil {
		return nil, err
	}
	if uploadFile.Eid != req.Eid {
		logger.Warnf(ctx, "【技能运行】跨企业上传文件被拒绝: upload_file_id=%d file_eid=%d req_eid=%d", uploadFileID, uploadFile.Eid, req.Eid)
		return nil, ErrSkillUploadFileCrossTenant
	}

	if !isZipUpload(uploadFile) {
		return nil, fmt.Errorf("%w: upload file must be zip", ErrSkillImportRequestInvalid)
	}

	zipContent, err := s.storage.Load(uploadFile.Key)
	if err != nil {
		return nil, err
	}

	originZipKey := buildSkillOriginZipKey(req.Eid)
	return s.importSkillAtomic(ctx, req, zipContent, "", originZipKey, uploadFile.FileName, strconv.FormatInt(uploadFileID, 10), permissionGroupIDs, jobID)
}

func buildSkillOriginZipKey(eid int64) string {
	fileName := fmt.Sprintf("%s.zip", uuid.NewString())
	return path.Join("skills", "tenants", strconv.FormatInt(eid, 10), "origin", fileName)
}

func (s *SkillLibraryService) buildSkillTenantRootPath(eid int64) string {
	root := s.skillRootPath
	if strings.TrimSpace(root) == "" {
		root = filepath.Join("data", "skills")
	}
	if eid == 0 {
		return filepath.Join(root, "global")
	}
	return filepath.Join(root, "tenants", strconv.FormatInt(eid, 10))
}

func (s *SkillLibraryService) importSkillFromGithubRepo(ctx context.Context, req *SkillImportRequest) (*SkillImportResult, error) {
	return s.importSkillFromGithubRepoWithPermissions(ctx, req, nil, 0)
}

func (s *SkillLibraryService) importSkillFromGithubRepoWithPermissions(ctx context.Context, req *SkillImportRequest, permissionGroupIDs []int64, jobID int64) (*SkillImportResult, error) {
	if req == nil {
		return nil, fmt.Errorf("%w: request", ErrSkillImportRequestInvalid)
	}
	if s.githubFetcher == nil {
		s.githubFetcher = defaultGitHubArchiveFetcher()
	}

	archiveZip, err := s.githubFetcher(ctx, req.GithubURL, req.Ref)
	if err != nil {
		return nil, err
	}

	originZipKey := buildSkillOriginZipKey(req.Eid)
	return s.importSkillAtomic(ctx, req, archiveZip, req.SkillPath, originZipKey, fmt.Sprintf("%s@%s.zip", path.Base(strings.TrimSpace(req.GithubURL)), strings.TrimSpace(req.Ref)), buildGithubSourceRef(req.GithubURL, req.Ref, req.SkillPath), permissionGroupIDs, jobID)
}

func (s *SkillLibraryService) executeImportJob(ctx context.Context, job *model.SkillScanJob) error {
	if job == nil || job.ID <= 0 {
		return nil
	}

	var payload SkillImportJobPayload
	if err := json.Unmarshal([]byte(job.ScanPayload), &payload); err != nil {
		return s.finalizeScanFailure(job.ID, "", fmt.Sprintf("解析导入任务失败: %v", err), "", false)
	}

	req := &SkillImportRequest{
		Eid:           job.Eid,
		SourceType:    strings.TrimSpace(payload.SourceType),
		UploadFileID:  strings.TrimSpace(payload.UploadFileID),
		GithubURL:     strings.TrimSpace(payload.GithubURL),
		Ref:           strings.TrimSpace(payload.Ref),
		SkillPath:     strings.TrimSpace(payload.SkillPath),
		MockRiskLevel: strings.TrimSpace(payload.MockRiskLevel),
	}
	if err := normalizeSkillImportRequest(req); err != nil {
		return s.finalizeScanFailure(job.ID, "", fmt.Sprintf("导入参数无效: %v", err), "", false)
	}

	switch req.SourceType {
	case model.SkillSourceTypeZip:
		_, err := s.importSkillFromUploadFileWithPermissions(ctx, req, payload.PermissionGroupIDs, job.ID)
		if err != nil {
			return s.finalizeScanFailure(job.ID, "", fmt.Sprintf("导入失败: %v", err), "", false)
		}
		return nil
	case model.SkillSourceTypeGithub:
		_, err := s.importSkillFromGithubRepoWithPermissions(ctx, req, payload.PermissionGroupIDs, job.ID)
		if err != nil {
			return s.finalizeScanFailure(job.ID, "", fmt.Sprintf("导入失败: %v", err), "", false)
		}
		return nil
	default:
		return s.finalizeScanFailure(job.ID, "", fmt.Sprintf("不支持的导入类型: %s", req.SourceType), "", false)
	}
}

func (s *SkillLibraryService) importSkillAtomic(
	ctx context.Context,
	req *SkillImportRequest,
	zipContent []byte,
	archiveSkillPath string,
	originZipKey string,
	originZipName string,
	sourceRef string,
	permissionGroupIDs []int64,
	jobID int64,
) (result *SkillImportResult, retErr error) {
	if req == nil {
		return nil, fmt.Errorf("%w: request", ErrSkillImportRequestInvalid)
	}

	scanModel := "mock"
	var scanChannel *model.Channel
	if strings.TrimSpace(req.MockRiskLevel) == "" {
		runtime, err := s.resolveWorkAIScanRuntime(ctx, req.Eid)
		if err != nil {
			return nil, err
		}
		scanModel = runtime.Model
		scanChannel = runtime.Channel
	}

	stagingPath, err := createSkillExtractionStagingPath(s.buildSkillTenantRootPath(req.Eid))
	if err != nil {
		return nil, err
	}
	defer func() {
		if retErr != nil && strings.TrimSpace(stagingPath) != "" {
			if rmErr := os.RemoveAll(stagingPath); rmErr != nil {
				logger.Warnf(ctx, "【技能运行】回滚导入时删除临时目录失败: path=%s err=%v", stagingPath, rmErr)
			}
		}
	}()

	inspection, err := extractSkillArchiveToPath(zipContent, archiveSkillPath, stagingPath)
	if err != nil {
		return nil, err
	}

	parsedSkill, err := skillsvc.ParseSkillMetadata(inspection.SkillMarkdown)
	if err != nil {
		return nil, err
	}

	skillName := strings.TrimSpace(parsedSkill.Name)
	if !isValidSkillName(skillName) {
		return nil, ErrSkillNameInvalid
	}
	logger.Infof(ctx, "【技能运行】导入技能包: eid=%d skill_name=%s source_ref=%s", req.Eid, skillName, sourceRef)

	if err := s.checkSkillNameUniqueBeforeImport(req.Eid, req.SourceType, skillName); err != nil {
		return nil, err
	}

	installPath := s.buildSkillInstallPath(req.Eid, skillName)
	preexistingInstallPath := false
	if _, statErr := os.Stat(installPath); statErr == nil {
		preexistingInstallPath = true
	} else if !os.IsNotExist(statErr) {
		return nil, statErr
	}

	if err := s.storage.Save(zipContent, originZipKey); err != nil {
		return nil, err
	}

	zipSHA := sha256.Sum256(zipContent)
	rawDescription := strings.TrimSpace(parsedSkill.Description)

	skillRecord := &model.SkillLibrary{
		Eid:             req.Eid,
		SourceType:      req.SourceType,
		SourceRef:       sourceRef,
		SkillName:       skillName,
		DisplayName:     skillName,
		Description:     "",
		Version:         normalizeSkillVersion(parsedSkill.Version),
		OriginZipKey:    originZipKey,
		OriginZipName:   originZipName,
		OriginZipSize:   int64(len(zipContent)),
		OriginZipSHA256: hex.EncodeToString(zipSHA[:]),
		ExtractFolder:   skillName,
		InstallPath:     installPath,
		PublishStatus:   model.SkillPublishStatusDraft,
		AdminStatus:     model.SkillAdminStatusDisabled,
	}

	cleanupArtifacts := true
	var replacedInstallBackupPath string
	defer func() {
		if retErr != nil && cleanupArtifacts {
			if strings.TrimSpace(originZipKey) != "" {
				if delErr := s.storage.Delete(originZipKey); delErr != nil {
					logger.Warnf(ctx, "【技能运行】回滚导入时删除原始zip失败: skill_name=%s err=%v", skillName, delErr)
				}
			}
			if strings.TrimSpace(replacedInstallBackupPath) != "" {
				if rmErr := os.RemoveAll(installPath); rmErr != nil {
					logger.Warnf(ctx, "【技能运行】回滚导入时删除新安装目录失败: skill_name=%s path=%s err=%v", skillName, installPath, rmErr)
				}
				if rmErr := os.Rename(replacedInstallBackupPath, installPath); rmErr != nil {
					logger.Warnf(ctx, "【技能运行】回滚导入时恢复旧安装目录失败: skill_name=%s backup=%s path=%s err=%v", skillName, replacedInstallBackupPath, installPath, rmErr)
				}
			} else if strings.TrimSpace(installPath) != "" && !preexistingInstallPath {
				if rmErr := os.RemoveAll(installPath); rmErr != nil {
					logger.Warnf(ctx, "【技能运行】回滚导入时删除安装目录失败: skill_name=%s path=%s err=%v", skillName, installPath, rmErr)
				}
			}
		}
	}()

	var output *SkillScanOutput
	if req.MockRiskLevel != "" {
		output = &SkillScanOutput{
			RiskLevel: req.MockRiskLevel,
			Message:   "mock risk level for debugging",
		}
		logger.Infof(ctx, "【技能运行】使用 mock 风险等级: skill_name=%s risk_level=%s", skillName, req.MockRiskLevel)
	} else {
		output, err = s.scanner.Scan(ctx, &SkillScanInput{
			Skill:          skillRecord,
			ScanModel:      scanModel,
			ScanChannel:    scanChannel,
			LLMInvoker:     s.resolveLLMInvoker(),
			SkillMD:        inspection.SkillMarkdown,
			FileEntries:    inspection.Entries,
			SkillName:      skillName,
			RawDescription: rawDescription,
		})
		if err != nil {
			return nil, fmt.Errorf("扫描失败: %v", err)
		}
		if output == nil {
			return nil, fmt.Errorf("扫描失败: 空响应")
		}
	}
	if output.RiskLevel != model.SkillRiskLevelLow && output.RiskLevel != model.SkillRiskLevelMedium && output.RiskLevel != model.SkillRiskLevelHigh {
		output.RiskLevel = model.SkillRiskLevelMedium
	}

	description := resolvePersistedSkillDescription(rawDescription, output)
	if description != "" {
		skillRecord.Description = description
	}

	skillRecord.RiskLevel = output.RiskLevel
	skillRecord.ScoreIntegrity = clampScore(output.ScoreIntegrity)
	skillRecord.ScorePracticality = clampScore(output.ScorePracticality)
	skillRecord.ScoreSafety = clampScore(output.ScoreSafety)
	skillRecord.ScoreCodeQuality = clampScore(output.ScoreCodeQuality)
	skillRecord.ScoreDocQuality = clampScore(output.ScoreDocQuality)
	skillRecord.ScanMessage = output.Message
	skillRecord.ScanPayload = output.ScanPayload

	now := s.nowFunc().UTC().UnixMilli()
	earlyStatus := model.SkillScanJobStatusSuccess
	if output.RiskLevel == model.SkillRiskLevelHigh {
		earlyStatus = model.SkillScanJobStatusFailed
	}
	if err := s.updateSkillScanJobResult(jobID, 0, earlyStatus, scanModel, output, now); err != nil {
		return nil, err
	}

	if output.RiskLevel == model.SkillRiskLevelHigh {
		cleanupArtifacts = false
		message := strings.TrimSpace(output.Message)
		if message == "" {
			message = "当前技能危险性过高，禁止使用。"
		}
		if err := s.finalizeScanFailure(jobID, scanModel, message, output.ScanPayload, false); err != nil {
			return nil, err
		}
		if jobID > 0 {
			importPayload := &SkillImportJobPayload{
				SourceType:         req.SourceType,
				UploadFileID:       req.UploadFileID,
				GithubURL:          req.GithubURL,
				Ref:                req.Ref,
				SkillPath:          req.SkillPath,
				PermissionGroupIDs: permissionGroupIDs,
				OriginZipKey:       originZipKey,
			}
			if payloadBytes, marshalErr := json.Marshal(importPayload); marshalErr == nil {
				model.DB.Model(&model.SkillScanJob{}).Where("id = ?", jobID).Update("scan_payload", string(payloadBytes))
			}
		}
		return nil, fmt.Errorf("%w: %s", ErrSkillScanHighRisk, message)
	}

	if backupPath, err := s.promoteSkillExtractionStaging(stagingPath, installPath); err != nil {
		if updateErr := s.finalizeScanFailure(jobID, scanModel, fmt.Sprintf("导入临时目录切换失败: %v", err), output.ScanPayload, false); updateErr != nil {
			return nil, updateErr
		}
		return nil, err
	} else {
		replacedInstallBackupPath = backupPath
	}

	var createdSkillID int64
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		if err := s.ensureSkillNameUnique(tx, req.Eid, req.SourceType, skillName, 0); err != nil {
			return err
		}
		if err := tx.Create(skillRecord).Error; err != nil {
			return err
		}
		if err := s.updateSkillPermissions(ctx, tx, skillRecord.ID, permissionGroupIDs); err != nil {
			return err
		}
		createdSkillID = skillRecord.ID
		return nil
	})
	if err != nil {
		if updateErr := s.finalizeScanFailure(jobID, scanModel, fmt.Sprintf("导入失败: %v", err), output.ScanPayload, false); updateErr != nil {
			return nil, updateErr
		}
		return nil, err
	}

	if createdSkillID <= 0 {
		createdSkillID = skillRecord.ID
	}

	scanJobID := jobID
	scanJobStatus := model.SkillScanJobStatusSuccess
	if scanJobID > 0 {
		if err := s.updateSkillScanJobResult(scanJobID, createdSkillID, scanJobStatus, scanModel, output, now); err != nil {
			logger.Warnf(ctx, "【技能运行】更新导入扫描记录关联技能失败: job_id=%d skill_id=%d err=%v", scanJobID, createdSkillID, err)
		}
	} else {
		scanJob := &model.SkillScanJob{
			Eid:               req.Eid,
			SkillLibraryID:    createdSkillID,
			Status:            scanJobStatus,
			RiskLevel:         output.RiskLevel,
			ScoreIntegrity:    clampScore(output.ScoreIntegrity),
			ScorePracticality: clampScore(output.ScorePracticality),
			ScoreSafety:       clampScore(output.ScoreSafety),
			ScoreCodeQuality:  clampScore(output.ScoreCodeQuality),
			ScoreDocQuality:   clampScore(output.ScoreDocQuality),
			Message:           output.Message,
			ScanPayload:       output.ScanPayload,
			ScanModel:         scanModel,
			RetryCount:        0,
			StartedTime:       now,
			FinishedTime:      now,
		}
		if err := model.DB.Create(scanJob).Error; err != nil {
			logger.Warnf(ctx, "【技能运行】创建导入扫描记录失败: skill_name=%s err=%v", skillName, err)
			scanJobID = 0
		} else {
			scanJobID = scanJob.ID
		}
	}

	if strings.TrimSpace(replacedInstallBackupPath) != "" {
		if rmErr := os.RemoveAll(replacedInstallBackupPath); rmErr != nil {
			logger.Warnf(ctx, "【技能运行】清理旧安装目录备份失败: skill_name=%s backup=%s err=%v", skillName, replacedInstallBackupPath, rmErr)
		}
	}
	cleanupArtifacts = false
	s.reloadSkillManagerAsync(ctx, "import", createdSkillID)

	return &SkillImportResult{
		ScanJobID:  scanJobID,
		ScanStatus: scanJobStatus,
	}, nil
}

func (s *SkillLibraryService) extractSkillPackageFiles(zipContent []byte, installPath string) error {
	if len(zipContent) == 0 {
		return fmt.Errorf("empty zip content")
	}
	reader, err := zip.NewReader(bytes.NewReader(zipContent), int64(len(zipContent)))
	if err != nil {
		return err
	}
	stripTopFolder := detectSingleTopFolder(reader.File)

	for _, file := range reader.File {
		if file == nil || file.FileInfo() != nil && file.FileInfo().IsDir() {
			continue
		}
		entryName := strings.ReplaceAll(strings.TrimSpace(file.Name), "\\", "/")
		if hasPathTraversalSegment(entryName) {
			return ErrSkillScanZipPathTraversal
		}
		cleanName := path.Clean(entryName)
		if cleanName == "." || cleanName == "" {
			continue
		}
		if hasPathTraversalSegment(cleanName) {
			return ErrSkillScanZipPathTraversal
		}

		rel := cleanName
		parts := strings.Split(cleanName, "/")
		if stripTopFolder != "" && len(parts) > 1 {
			if cleanName == stripTopFolder {
				continue
			}
			if strings.HasPrefix(cleanName, stripTopFolder+"/") {
				rel = strings.TrimPrefix(cleanName, stripTopFolder+"/")
			}
		}
		if rel == "" || rel == "." {
			continue
		}
		rel = path.Clean(rel)
		if rel == ".." || strings.HasPrefix(rel, "../") || path.IsAbs(rel) {
			return ErrSkillScanZipPathTraversal
		}

		outPath := filepath.Join(installPath, rel)
		if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
			return err
		}
		rc, err := file.Open()
		if err != nil {
			return err
		}
		data, readErr := io.ReadAll(rc)
		rc.Close()
		if readErr != nil {
			return readErr
		}
		if err := os.WriteFile(outPath, data, 0o644); err != nil {
			return err
		}
	}

	return nil
}

func buildSkillExtractFolder(skillName string) string {
	base := normalizeSkillName(skillName)
	if base == "" {
		base = "skill"
	}
	if len(base) > 150 {
		base = base[:150]
	}
	return base
}

func createSkillExtractionStagingPath(tenantRoot string) (string, error) {
	tenantRoot = filepath.Clean(strings.TrimSpace(tenantRoot))
	if tenantRoot == "" || tenantRoot == "." {
		return "", fmt.Errorf("invalid tenant root path")
	}

	if err := os.MkdirAll(tenantRoot, 0o755); err != nil {
		return "", err
	}

	return os.MkdirTemp(tenantRoot, ".import-staging-*")
}

func (s *SkillLibraryService) promoteSkillExtractionStaging(stagingPath, finalInstallPath string) (string, error) {
	stagingPath = filepath.Clean(strings.TrimSpace(stagingPath))
	finalInstallPath = filepath.Clean(strings.TrimSpace(finalInstallPath))
	if stagingPath == "" || finalInstallPath == "" || stagingPath == "." || finalInstallPath == "." {
		return "", fmt.Errorf("invalid skill install path")
	}
	if stagingPath == finalInstallPath {
		return "", nil
	}
	if _, err := os.Stat(finalInstallPath); err == nil {
		backupPath := finalInstallPath + ".backup-" + strings.ReplaceAll(uuid.NewString(), "-", "")
		if err := os.Rename(finalInstallPath, backupPath); err != nil {
			return "", err
		}
		if err := os.Rename(stagingPath, finalInstallPath); err != nil {
			if rollbackErr := os.Rename(backupPath, finalInstallPath); rollbackErr != nil {
				return "", fmt.Errorf("%v (rollback failed: %v)", err, rollbackErr)
			}
			return "", err
		}
		return backupPath, nil
	} else if !os.IsNotExist(err) {
		return "", err
	}
	return "", os.Rename(stagingPath, finalInstallPath)
}

func readSkillMarkdownFromGithubArchive(zipContent []byte, skillPath string) (string, error) {
	inspection, err := inspectSkillArchive(zipContent, skillPath)
	if err != nil {
		return "", err
	}
	return inspection.SkillMarkdown, nil
}

func standardizeGithubSkillZip(archiveZip []byte, skillPath, skillName string) ([]byte, error) {
	_, standardizedZip, err := standardizeGithubSkillZipWithInspection(archiveZip, skillPath)
	return standardizedZip, err
}

func isZipUpload(uploadFile *model.UploadFile) bool {
	if uploadFile == nil {
		return false
	}
	ext := strings.ToLower(strings.TrimSpace(uploadFile.Extension))
	if ext == "" {
		ext = strings.ToLower(filepath.Ext(uploadFile.FileName))
	}
	return ext == ".zip"
}

func isValidSkillName(name string) bool {
	if name == "" {
		return false
	}
	for _, c := range name {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

func normalizeSkillName(fileBaseName string) string {
	name := strings.TrimSpace(fileBaseName)
	name = skillNameNormalizeRegexp.ReplaceAllString(name, "-")
	name = strings.Trim(name, "-_")
	name = strings.ToLower(name)
	if len(name) > 120 {
		name = name[:120]
	}
	return name
}

func normalizeSkillVersion(version string) string {
	version = strings.TrimSpace(version)
	if version == "" {
		return "v1.0.0"
	}
	return version
}

func readSkillMarkdownFromZipContent(zipContent []byte) (string, error) {
	inspection, err := inspectSkillArchive(zipContent, "")
	if err != nil {
		return "", err
	}
	return inspection.SkillMarkdown, nil
}

func (s *SkillLibraryService) ForceImportSkill(ctx context.Context, eid, jobID int64) (*SkillImportResult, error) {
	if jobID <= 0 {
		return nil, ErrSkillImportRequestInvalid
	}

	job, err := model.GetSkillScanJobByIDAndEID(eid, jobID)
	if err != nil {
		return nil, err
	}
	if job == nil {
		return nil, gorm.ErrRecordNotFound
	}
	if job.Status != model.SkillScanJobStatusFailed {
		return nil, fmt.Errorf("任务状态不是失败，无法强制导入")
	}
	if job.RiskLevel != model.SkillRiskLevelHigh {
		return nil, fmt.Errorf("任务非高风险失败，无法强制导入")
	}
	if job.SkillLibraryID > 0 {
		return nil, fmt.Errorf("任务已关联技能，无法强制导入")
	}

	var payload SkillImportJobPayload
	if err := json.Unmarshal([]byte(job.ScanPayload), &payload); err != nil {
		return nil, fmt.Errorf("解析任务数据失败: %v", err)
	}
	if payload.OriginZipKey == "" {
		return nil, fmt.Errorf("任务缺少原始文件数据，无法强制导入")
	}

	zipContent, err := s.storage.Load(payload.OriginZipKey)
	if err != nil {
		return nil, fmt.Errorf("读取原始文件失败: %v", err)
	}

	req := &SkillImportRequest{
		Eid:        eid,
		SourceType: strings.TrimSpace(payload.SourceType),
		GithubURL:  strings.TrimSpace(payload.GithubURL),
		Ref:        strings.TrimSpace(payload.Ref),
		SkillPath:  strings.TrimSpace(payload.SkillPath),
	}
	if err := normalizeSkillImportRequest(req); err != nil {
		return nil, err
	}

	archiveSkillPath := ""
	if req.SourceType == model.SkillSourceTypeGithub {
		archiveSkillPath = parseGithubSourceSkillPath(payload.Ref)
	}

	stagingPath, err := createSkillExtractionStagingPath(s.buildSkillTenantRootPath(eid))
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(stagingPath)

	inspection, err := extractSkillArchiveToPath(zipContent, archiveSkillPath, stagingPath)
	if err != nil {
		return nil, err
	}

	parsedSkill, err := skillsvc.ParseSkillMetadata(inspection.SkillMarkdown)
	if err != nil {
		return nil, err
	}

	skillName := strings.TrimSpace(parsedSkill.Name)
	if !isValidSkillName(skillName) {
		return nil, ErrSkillNameInvalid
	}

	installPath := s.buildSkillInstallPath(eid, skillName)
	preexistingInstallPath := false
	if _, statErr := os.Stat(installPath); statErr == nil {
		preexistingInstallPath = true
	} else if !os.IsNotExist(statErr) {
		return nil, statErr
	}

	if err := s.checkSkillNameUniqueBeforeImport(eid, req.SourceType, skillName); err != nil {
		return nil, err
	}

	zipSHA := sha256.Sum256(zipContent)
	skillRecord := &model.SkillLibrary{
		Eid:               eid,
		SourceType:        req.SourceType,
		SourceRef:         payload.Ref,
		SkillName:         skillName,
		DisplayName:       skillName,
		Description:       truncateByRunes(strings.TrimSpace(parsedSkill.Description), skillDescriptionMaxChars),
		Version:           normalizeSkillVersion(parsedSkill.Version),
		OriginZipKey:      payload.OriginZipKey,
		OriginZipName:     skillName + ".zip",
		OriginZipSize:     int64(len(zipContent)),
		OriginZipSHA256:   hex.EncodeToString(zipSHA[:]),
		ExtractFolder:     skillName,
		InstallPath:       installPath,
		PublishStatus:     model.SkillPublishStatusDraft,
		AdminStatus:       model.SkillAdminStatusDisabled,
		RiskLevel:         job.RiskLevel,
		ScoreIntegrity:    job.ScoreIntegrity,
		ScorePracticality: job.ScorePracticality,
		ScoreSafety:       job.ScoreSafety,
		ScoreCodeQuality:  job.ScoreCodeQuality,
		ScoreDocQuality:   job.ScoreDocQuality,
		ScanMessage:       job.Message,
	}

	if backupPath, err := s.promoteSkillExtractionStaging(stagingPath, installPath); err != nil {
		return nil, err
	} else if backupPath != "" {
		defer os.RemoveAll(backupPath)
	}

	var createdSkillID int64
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		if err := s.ensureSkillNameUnique(tx, eid, req.SourceType, skillName, 0); err != nil {
			return err
		}
		if err := tx.Create(skillRecord).Error; err != nil {
			return err
		}
		if err := s.updateSkillPermissions(ctx, tx, skillRecord.ID, payload.PermissionGroupIDs); err != nil {
			return err
		}
		createdSkillID = skillRecord.ID
		return nil
	})
	if err != nil {
		return nil, err
	}

	if !preexistingInstallPath {
		// staging was promoted, no need to clean
	}

	model.DB.Model(&model.SkillScanJob{}).Where("id = ?", jobID).Updates(map[string]interface{}{
		"skill_library_id": createdSkillID,
		"status":           model.SkillScanJobStatusSuccess,
		"updated_time":     s.nowFunc().UTC().UnixMilli(),
	})

	s.reloadSkillManagerAsync(ctx, "force_import", createdSkillID)

	logger.Infof(ctx, "【技能运行】强制导入完成: job_id=%d skill_id=%d skill_name=%s", jobID, createdSkillID, skillName)

	return &SkillImportResult{
		ScanJobID:  jobID,
		ScanStatus: model.SkillScanJobStatusSuccess,
		SkillID:    createdSkillID,
	}, nil
}
