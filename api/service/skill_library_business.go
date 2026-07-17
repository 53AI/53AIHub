package service

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/skill"
	"golang.org/x/sync/errgroup"
	"gorm.io/gorm"
)

const (
	skillEnvVarCachePrefix     = "Cache:skill_env_vars:"
	skillEnvVarCacheTTL        = 5 * time.Minute
	skillUserEnvVarCachePrefix = "Cache:skill_user_env_vars:"
)

var (
	ErrSkillNotVisible              = errors.New("skill is not visible for current user")
	ErrSkillNotPublished            = errors.New("skill is not published")
	ErrSkillDisabled                = errors.New("skill is disabled")
	ErrSkillStatusInvalid           = errors.New("invalid skill status combination")
	ErrSkillPublishPrecheckFailed   = errors.New("skill publish precheck failed")
	ErrSkillPlatformReadonly        = errors.New("platform skill is read-only")
	ErrSkillGroupInvalid            = errors.New("invalid skill group")
	ErrSkillPermissionGroupsInvalid = errors.New("invalid skill permission groups")
	ErrSkillNameInvalid             = errors.New("invalid skill name")
	ErrSkillNameDuplicated          = errors.New("skill name already exists")
	ErrAgentSkillAccessDenied       = errors.New("access denied to agent or skill")
	ErrSkillPermissionDenied        = errors.New("user has no permission for this skill")
	ErrSkillAlreadyBuiltin          = errors.New("skill already exists as builtin in this agent")
)

type SkillExploreItem struct {
	*model.SkillLibrary
}

type SkillExploreListResult struct {
	Count int64               `json:"count"`
	Items []*SkillExploreItem `json:"items"`
}

type SkillDetailResult struct {
	*model.SkillLibrary
	EnvVars []model.SkillEnvVarRecord `json:"env_vars"`
}

// UpdateSkillMetaRequest 更新技能元数据请求参数
type UpdateSkillMetaRequest struct {
	Sort               *int64  // 排序权重
	DisplayName        *string // 技能显示名称
	Description        *string // 技能描述
	UsageGuide         *string // 使用指南
	Version            *string // 版本号
	AdminStatus        *string // 管理状态：enabled/disabled
	Logo               *string // 技能 logo URL
	PermissionGroupIDs []int64 // 权限分组ID列表
}

func resolveRunnableSkillInstallPath(installPath string) (string, bool) {
	installPath = filepath.Clean(strings.TrimSpace(installPath))
	if installPath == "" || installPath == "." {
		return "", false
	}
	if skillMDExists(filepath.Join(installPath, "SKILL.md")) {
		return installPath, true
	}

	globalPath, ok := deriveGlobalSkillInstallPath(installPath)
	if !ok {
		return "", false
	}
	if !skillMDExists(filepath.Join(globalPath, "SKILL.md")) {
		return "", false
	}
	return globalPath, true
}

func deriveGlobalSkillInstallPath(installPath string) (string, bool) {
	installPath = filepath.Clean(strings.TrimSpace(installPath))
	if installPath == "" || installPath == "." {
		return "", false
	}

	parts := strings.Split(installPath, string(filepath.Separator))
	tenantIdx := -1
	for i, part := range parts {
		if part == "tenants" {
			tenantIdx = i
			break
		}
	}
	if tenantIdx < 0 || tenantIdx+2 >= len(parts) {
		return "", false
	}

	tenantRoot := parts[:tenantIdx]
	skillName := parts[tenantIdx+2]
	if skillName == "" {
		return "", false
	}

	if filepath.IsAbs(installPath) {
		if len(tenantRoot) == 0 {
			return "", false
		}
		globalParts := append([]string{string(filepath.Separator)}, append(tenantRoot[1:], "global", skillName)...)
		return filepath.Join(globalParts...), true
	}

	globalParts := append(append([]string{}, tenantRoot...), "global", skillName)
	return filepath.Join(globalParts...), true
}

func skillMDExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func (s *SkillLibraryService) canUserSeeSkill(ctx context.Context, eid, userID, userGroupID, skillID int64) (*model.SkillLibrary, error) {
	_ = ctx
	_ = userID
	_ = userGroupID
	skillInfo, err := model.GetSkillLibraryByIDForTenant(eid, skillID)
	if err != nil {
		return nil, err
	}
	return skillInfo, nil
}

func (s *SkillLibraryService) ListExploreSkills(ctx context.Context, eid, userID int64, keyword string, groupIDs []int64, offset, limit int) (*SkillExploreListResult, error) {
	visibleGroupIDs, err := s.resolveVisibleSkillGroupIDs(userID)
	if err != nil {
		return nil, err
	}

	skillGroupIDs, err := resolveSkillGroupResourceIDs(groupIDs)
	if err != nil {
		return nil, err
	}
	if len(groupIDs) > 0 && len(skillGroupIDs) == 0 {
		return &SkillExploreListResult{Count: 0, Items: []*SkillExploreItem{}}, nil
	}

	skills, count, err := model.ListExploreSkillLibrariesWithFilter(eid, model.SkillLibraryExploreFilter{
		VisibleGroupIDs: visibleGroupIDs,
		SkillIDs:        skillGroupIDs,
		Keyword:         keyword,
		PublishStatuses: []string{model.SkillPublishStatusPublished},
		AdminStatuses:   []string{model.SkillAdminStatusEnabled},
		Offset:          offset,
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}

	items := make([]*SkillExploreItem, 0, len(skills))
	for _, item := range skills {
		if item == nil {
			continue
		}
		_ = item.LoadSkillGroups() // 加载技能所属分组
		items = append(items, &SkillExploreItem{SkillLibrary: item})
	}

	return &SkillExploreListResult{Count: count, Items: items}, nil
}

func (s *SkillLibraryService) resolveVisibleSkillGroupIDs(userID int64) ([]int64, error) {
	if userID <= 0 {
		return []int64{}, nil
	}
	groupIDs, err := GetUserGroupIDs(userID)
	if err != nil {
		return nil, err
	}
	if len(groupIDs) == 0 {
		return []int64{}, nil
	}
	seen := make(map[int64]struct{}, len(groupIDs))
	visible := make([]int64, 0, len(groupIDs))
	for _, groupID := range groupIDs {
		if groupID <= 0 {
			continue
		}
		if _, ok := seen[groupID]; ok {
			continue
		}
		seen[groupID] = struct{}{}
		visible = append(visible, groupID)
	}
	return visible, nil
}

func resolveSkillGroupResourceIDs(groupIDs []int64) ([]int64, error) {
	if len(groupIDs) == 0 {
		return []int64{}, nil
	}
	resourceIDs, err := model.GetDistinctResourceIDsByGroupsAndType(groupIDs, model.ResourceTypeSkillLibrary)
	if err != nil {
		return nil, err
	}
	if resourceIDs == nil {
		resourceIDs = []int64{}
	}
	seen := make(map[int64]struct{}, len(resourceIDs))
	filtered := make([]int64, 0, len(resourceIDs))
	for _, resourceID := range resourceIDs {
		if resourceID <= 0 {
			continue
		}
		if _, ok := seen[resourceID]; ok {
			continue
		}
		seen[resourceID] = struct{}{}
		filtered = append(filtered, resourceID)
	}
	return filtered, nil
}

func (s *SkillLibraryService) GetSkillDetailForUser(ctx context.Context, eid, userID, userGroupID, skillID int64) (*SkillDetailResult, error) {
	skillInfo, err := s.canUserSeeSkill(ctx, eid, userID, userGroupID, skillID)
	if err != nil {
		return nil, err
	}

	result := &SkillDetailResult{SkillLibrary: skillInfo}
	_ = skillInfo.LoadSkillGroups() // 加载技能所属分组

	envVars, err := model.GetSkillEnvVarsBySkillID(eid, skillID)
	if err != nil {
		return nil, err
	}
	result.EnvVars = envVars

	return result, nil
}

func (s *SkillLibraryService) getSkillDownloadInfoForUser(ctx context.Context, eid, userID, userGroupID, skillID int64) (*model.SkillLibrary, error) {
	skillInfo, err := s.canUserSeeSkill(ctx, eid, userID, userGroupID, skillID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(skillInfo.OriginZipKey) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	return skillInfo, nil
}

func (s *SkillLibraryService) DownloadSkillZipForUser(ctx context.Context, eid, userID, userGroupID, skillID int64) (string, []byte, error) {
	skillInfo, err := s.getSkillDownloadInfoForUser(ctx, eid, userID, userGroupID, skillID)
	if err != nil {
		return "", nil, err
	}
	content, loadErr := s.storage.Load(skillInfo.OriginZipKey)
	if loadErr != nil {
		return "", nil, loadErr
	}
	fileName := strings.TrimSpace(skillInfo.OriginZipName)
	if fileName == "" {
		fileName = skillInfo.SkillName + ".zip"
	}
	return fileName, content, nil
}

func (s *SkillLibraryService) GetSkillMDForUser(ctx context.Context, eid, userID, userGroupID, skillID int64) (string, error) {
	skillInfo, err := s.canUserSeeSkill(ctx, eid, userID, userGroupID, skillID)
	if err != nil {
		return "", err
	}
	skillMDPath := filepath.Join(skillInfo.InstallPath, "SKILL.md")
	content, readErr := os.ReadFile(skillMDPath)
	if readErr != nil {
		return "", readErr
	}
	return string(content), nil
}

func normalizePermissionGroupIDs(groupIDs []int64) []int64 {
	if len(groupIDs) == 0 {
		return []int64{}
	}
	seen := make(map[int64]struct{}, len(groupIDs))
	normalized := make([]int64, 0, len(groupIDs))
	for _, groupID := range groupIDs {
		if groupID <= 0 {
			continue
		}
		if _, ok := seen[groupID]; ok {
			continue
		}
		seen[groupID] = struct{}{}
		normalized = append(normalized, groupID)
	}
	return normalized
}

func (s *SkillLibraryService) ensureSkillNameUnique(tx *gorm.DB, eid int64, sourceType, skillName string, excludeID int64) error {
	_ = s
	skillName = strings.TrimSpace(skillName)
	if skillName == "" {
		return ErrSkillNameInvalid
	}
	if tx == nil {
		tx = model.DB
	}

	query := tx.Model(&model.SkillLibrary{}).Where("skill_name = ?", skillName)
	if excludeID > 0 {
		query = query.Where("id <> ?", excludeID)
	}
	if sourceType == model.SkillSourceTypePlatform {
		query = query.Where("eid = ?", 0)
	} else {
		query = query.Where("eid = ?", eid)
	}

	var existing model.SkillLibrary
	if err := query.First(&existing).Error; err == nil {
		return ErrSkillNameDuplicated
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return nil
}

func (s *SkillLibraryService) updateSkillPermissions(ctx context.Context, tx *gorm.DB, skillID int64, permissionGroupIDs []int64) error {
	_ = ctx
	groupIDs := normalizePermissionGroupIDs(permissionGroupIDs)
	return UpdateResourcePermissions(nil, tx, skillID, model.ResourceTypeSkillLibrary, groupIDs)
}

func (s *SkillLibraryService) ListAdminSkillsWithFilter(ctx context.Context, eid int64, keyword, publishStatus, adminStatus string, filterSkillIDs []int64, offset, limit int) ([]*model.SkillLibrary, int64, error) {
	_ = ctx
	items, count, err := model.ListAdminSkillLibrariesWithFilter(eid, keyword, publishStatus, adminStatus, filterSkillIDs, offset, limit)
	if err != nil {
		return nil, 0, err
	}
	for _, item := range items {
		if item == nil {
			continue
		}
		if err := item.LoadSkillGroups(); err != nil {
			return nil, 0, err
		}
	}
	return items, count, nil
}

// UpdateSkillMeta 更新技能元数据信息，包括基础信息、排序、状态和环境变量
func (s *SkillLibraryService) UpdateSkillMeta(ctx context.Context, eid, skillID int64, req *UpdateSkillMetaRequest) error {
	if req == nil {
		return ErrSkillImportRequestInvalid
	}

	var resolvedPermissionGroupIDs []int64
	var err error
	if req.PermissionGroupIDs != nil {
		resolvedPermissionGroupIDs, err = s.resolveSkillPermissionGroupIDs(eid, req.PermissionGroupIDs)
		if err != nil {
			return err
		}
	}

	return model.DB.Transaction(func(tx *gorm.DB) error {
		skillInfo, err := getSkillLibraryByIDAndEIDWithDB(tx, eid, skillID)
		if err != nil {
			return err
		}
		if skillInfo.Eid == 0 {
			return ErrSkillPlatformReadonly
		}
		if err := s.ensureSkillNameUnique(tx, skillInfo.Eid, skillInfo.SourceType, skillInfo.SkillName, skillInfo.ID); err != nil {
			return err
		}

		targetPublishStatus := skillInfo.PublishStatus
		if targetPublishStatus != model.SkillPublishStatusRejected {
			targetPublishStatus = model.SkillPublishStatusPublished
		}
		targetAdminStatus := skillInfo.AdminStatus
		if req.AdminStatus != nil {
			targetAdminStatus = strings.TrimSpace(*req.AdminStatus)
		}
		if err := s.ValidateSkillStatusCombination(targetPublishStatus, targetAdminStatus); err != nil {
			return err
		}

		nowFunc := s.nowFunc
		if nowFunc == nil {
			nowFunc = time.Now
		}

		updates := make(map[string]interface{})
		updates["updated_time"] = nowFunc().UTC().UnixMilli()
		if req.Sort != nil {
			updates["sort"] = *req.Sort
		}
		if req.DisplayName != nil {
			updates["display_name"] = strings.TrimSpace(*req.DisplayName)
		}
		if req.Description != nil {
			updates["description"] = strings.TrimSpace(*req.Description)
		}
		if req.Logo != nil {
			updates["logo"] = strings.TrimSpace(*req.Logo)
		}
		if req.UsageGuide != nil {
			updates["usage_guide"] = strings.TrimSpace(*req.UsageGuide)
		}
		if req.Version != nil {
			updates["version"] = normalizeSkillVersion(*req.Version)
		}
		updates["publish_status"] = targetPublishStatus
		if req.AdminStatus != nil {
			updates["admin_status"] = targetAdminStatus
		}
		if len(updates) > 0 {
			if err := tx.Model(&model.SkillLibrary{}).Where("id = ? AND eid = ?", skillID, eid).Updates(updates).Error; err != nil {
				return err
			}
		}

		if req.PermissionGroupIDs != nil {
			if err := s.updateSkillPermissions(ctx, tx, skillID, resolvedPermissionGroupIDs); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *SkillLibraryService) DeleteSkill(ctx context.Context, eid, skillID int64) error {
	var (
		originZipKey string
		installPath  string
	)

	err := model.DB.Transaction(func(tx *gorm.DB) error {
		skillInfo, getErr := getSkillLibraryByIDAndEIDWithDB(tx, eid, skillID)
		if getErr != nil {
			return getErr
		}
		if skillInfo.Eid == 0 {
			return ErrSkillPlatformReadonly
		}
		originZipKey = skillInfo.OriginZipKey
		installPath = skillInfo.InstallPath

		if err := tx.Where("resource_id = ? AND resource_type = ?", skillID, model.ResourceTypeSkillLibrary).
			Delete(&model.ResourcePermission{}).Error; err != nil {
			return err
		}
		if err := model.DeleteSkillScanJobsBySkillLibraryID(tx, eid, skillID); err != nil {
			return err
		}
		if err := model.DeleteSkillEnvVarsBySkillID(tx, eid, skillID); err != nil {
			return err
		}
		if err := model.DeleteSkillLibraryByIDAndEID(tx, eid, skillID); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return err
	}

	if strings.TrimSpace(originZipKey) != "" {
		if delErr := s.storage.Delete(originZipKey); delErr != nil {
			logger.Warnf(ctx, "【技能运行】删除技能原始zip失败: skill_id=%d err=%v", skillID, delErr)
		}
	}
	if strings.TrimSpace(installPath) != "" {
		if rmErr := os.RemoveAll(installPath); rmErr != nil {
			logger.Warnf(ctx, "【技能运行】删除技能安装目录失败: skill_id=%d path=%s err=%v", skillID, installPath, rmErr)
		}
	}
	s.reloadSkillManagerAsync(ctx, "delete", skillID)
	return nil
}

func (s *SkillLibraryService) ReloadSkillManager(ctx context.Context) error {
	_ = ctx
	return skill.GetManager().Reload()
}

func (s *SkillLibraryService) reloadSkillManagerAsync(ctx context.Context, reason string, skillID int64) {
	_ = ctx
	go func() {
		if err := skill.GetManager().Reload(); err != nil {
			logger.Warnf(context.Background(), "【技能运行】后台重载技能管理器失败: reason=%s skill_id=%d err=%v", reason, skillID, err)
		}
	}()
}

func (s *SkillLibraryService) importSkillAndStartScan(ctx context.Context, req *SkillImportRequest, permissionGroupIDs []int64) (*SkillImportResult, error) {
	if req == nil {
		return nil, ErrSkillImportRequestInvalid
	}
	if err := normalizeSkillImportRequest(req); err != nil {
		return nil, err
	}

	resolvedPermissionGroupIDs := normalizePermissionGroupIDs(permissionGroupIDs)
	if len(resolvedPermissionGroupIDs) > 0 {
		var err error
		resolvedPermissionGroupIDs, err = s.resolveSkillPermissionGroupIDs(req.Eid, resolvedPermissionGroupIDs)
		if err != nil {
			return nil, err
		}
	}
	return s.submitSkillImportJob(ctx, req, resolvedPermissionGroupIDs)
}

func (s *SkillLibraryService) ImportSkillWithPermissionsAndStartScan(ctx context.Context, req *SkillImportRequest, permissionGroupIDs []int64) (*SkillImportResult, error) {
	if req == nil {
		return nil, ErrSkillImportRequestInvalid
	}
	return s.importSkillAndStartScan(ctx, req, permissionGroupIDs)
}

func normalizeSkillScanJobForView(job *model.SkillScanJob) *model.SkillScanJob {
	if job == nil {
		return nil
	}
	cloned := *job
	if cloned.Status == model.SkillScanJobStatusPending && cloned.RetryCount > 0 {
		cloned.Status = model.SkillScanJobStatusFailed
	}
	return &cloned
}

func (s *SkillLibraryService) GetSkillImportJobForAdmin(ctx context.Context, eid, jobID int64) (*model.SkillScanJob, *model.SkillLibrary, error) {
	_ = ctx
	job, err := model.GetSkillScanJobByIDAndEID(eid, jobID)
	if err != nil {
		return nil, nil, err
	}
	if job == nil {
		return nil, nil, gorm.ErrRecordNotFound
	}
	var skillInfo *model.SkillLibrary
	if job.SkillLibraryID > 0 {
		skillInfo, err = model.GetSkillLibraryByIDForTenant(eid, job.SkillLibraryID)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, err
		}
	}
	return normalizeSkillScanJobForView(job), skillInfo, nil
}

func (s *SkillLibraryService) GetSkillByIDForAdmin(ctx context.Context, eid, skillID int64) (*model.SkillLibrary, *model.SkillScanJob, error) {
	_ = ctx
	skillInfo, err := model.GetSkillLibraryByIDForTenant(eid, skillID)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, err
		}
		job, jobErr := model.GetSkillScanJobByIDAndEID(eid, skillID)
		if jobErr != nil {
			return nil, nil, jobErr
		}
		if job != nil && job.SkillLibraryID > 0 {
			skillInfo, err = model.GetSkillLibraryByIDForTenant(eid, job.SkillLibraryID)
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, nil, err
			}
		}
		return skillInfo, normalizeSkillScanJobForView(job), nil
	}
	if err := skillInfo.LoadSkillGroups(); err != nil {
		return nil, nil, err
	}
	job, _ := model.GetLatestSkillScanJobBySkillLibraryID(eid, skillID)
	return skillInfo, normalizeSkillScanJobForView(job), nil
}

func (s *SkillLibraryService) ValidateSkillStatusCombination(publishStatus, adminStatus string) error {
	switch publishStatus {
	case model.SkillPublishStatusDraft:
		if adminStatus != model.SkillAdminStatusDisabled {
			return ErrSkillStatusInvalid
		}
	case model.SkillPublishStatusPublished:
		if adminStatus != model.SkillAdminStatusEnabled && adminStatus != model.SkillAdminStatusDisabled {
			return ErrSkillStatusInvalid
		}
	case model.SkillPublishStatusRejected:
		if adminStatus != model.SkillAdminStatusDisabled {
			return ErrSkillStatusInvalid
		}
	default:
		return ErrSkillStatusInvalid
	}
	return nil
}

func (s *SkillLibraryService) resolveSkillPermissionGroupIDs(eid int64, permissionGroupIDs []int64) ([]int64, error) {
	groupIDs := normalizePermissionGroupIDs(permissionGroupIDs)
	if len(groupIDs) > 0 {
		return groupIDs, nil
	}

	groups, err := model.GetGroupsByEid(eid, model.GROUP_TYPE_SKILL)
	if err != nil {
		return nil, err
	}
	if len(groups) == 0 {
		return nil, ErrSkillGroupInvalid
	}

	return []int64{groups[0].GroupId}, nil
}

func (s *SkillLibraryService) checkSkillNameUniqueBeforeImport(eid int64, sourceType, skillName string) error {
	if model.DB == nil {
		return gorm.ErrInvalidDB
	}
	return model.DB.Transaction(func(tx *gorm.DB) error {
		return s.ensureSkillNameUnique(tx, eid, sourceType, skillName, 0)
	})
}

func (s *SkillLibraryService) UpdateSkillStatusDirect(ctx context.Context, eid, skillID int64, publishStatus, adminStatus string) error {
	if err := s.ValidateSkillStatusCombination(publishStatus, adminStatus); err != nil {
		return err
	}
	currentSkill, err := getSkillLibraryByIDAndEIDWithDB(model.DB, eid, skillID)
	if err != nil {
		return err
	}
	if currentSkill.PublishStatus == model.SkillPublishStatusRejected && publishStatus != model.SkillPublishStatusRejected {
		return ErrSkillStatusInvalid
	}
	updates := map[string]interface{}{
		"publish_status": publishStatus,
		"admin_status":   adminStatus,
	}
	if s.nowFunc != nil {
		updates["updated_time"] = s.nowFunc().UTC().UnixMilli()
	} else {
		updates["updated_time"] = time.Now().UTC().UnixMilli()
	}
	if publishStatus == model.SkillPublishStatusRejected {
		updates["scan_message"] = "当前技能危险性过高，禁止使用。"
	}
	if err := model.UpdateSkillLibraryByIDAndEID(eid, skillID, updates); err != nil {
		return err
	}
	return nil
}

func (s *SkillLibraryService) PublishSkill(ctx context.Context, eid, skillID int64) error {
	_ = ctx
	skillInfo, err := getSkillLibraryByIDAndEIDWithDB(model.DB, eid, skillID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(skillInfo.InstallPath) == "" || strings.TrimSpace(skillInfo.OriginZipKey) == "" {
		return ErrSkillPublishPrecheckFailed
	}

	job, err := model.GetLatestSkillScanJobBySkillLibraryID(eid, skillID)
	if err != nil {
		return ErrSkillPublishPrecheckFailed
	}
	if job.Status != model.SkillScanJobStatusSuccess || job.RiskLevel == model.SkillRiskLevelHigh {
		return ErrSkillPublishPrecheckFailed
	}
	return s.UpdateSkillStatusDirect(ctx, eid, skillID, model.SkillPublishStatusPublished, model.SkillAdminStatusEnabled)
}

func getSkillLibraryByIDAndEIDWithDB(db *gorm.DB, eid, id int64) (*model.SkillLibrary, error) {
	if db == nil {
		db = model.DB
	}
	var skillInfo model.SkillLibrary
	if err := db.Where("id = ? AND eid = ?", id, eid).First(&skillInfo).Error; err != nil {
		return nil, err
	}
	return &skillInfo, nil
}

// SkillFileItem represents a file or directory in skill package
type SkillFileItem struct {
	Name         string          `json:"name"`
	Path         string          `json:"path"`
	Type         string          `json:"type"` // "file" or "directory"
	Size         int64           `json:"size,omitempty"`
	ModifiedTime int64           `json:"modified_time,omitempty"`
	Children     []SkillFileItem `json:"children,omitempty"`
}

// SkillFileUpdateItem represents a file update request
type SkillFileUpdateItem struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// SkillFileUpdateResult represents the result of file update operation
type SkillFileUpdateResult struct {
	UpdatedCount int    `json:"updated_count"`
	DeletedCount int    `json:"deleted_count"`
	Repackaged   bool   `json:"repackaged"`
	NewZipKey    string `json:"new_zip_key"`
}

// GetSkillFileTree returns the file tree of a skill package
func (s *SkillLibraryService) GetSkillFileTree(ctx context.Context, eid, skillID int64) ([]SkillFileItem, error) {
	skill, err := model.GetSkillLibraryByID(skillID)
	if err != nil {
		return nil, err
	}

	// 权限校验：租户技能只有所属租户可访问，平台技能所有租户可访问
	if skill.Eid != 0 && skill.Eid != eid {
		return nil, ErrSkillNotVisible
	}

	installPath := skill.InstallPath
	if installPath == "" {
		return nil, errors.New("skill install path is empty")
	}

	return buildSkillFileTree(installPath)
}

// SkillFileInfo holds metadata for a skill file used for streaming preview
type SkillFileInfo struct {
	FullPath string
	Size     int64
	ModTime  time.Time
}

// GetSkillFileContent returns the content of a specific file in the skill package
func (s *SkillLibraryService) GetSkillFileContent(ctx context.Context, eid, skillID int64, filePath string) (string, error) {
	skill, err := model.GetSkillLibraryByID(skillID)
	if err != nil {
		return "", err
	}

	// 权限校验：租户技能只有所属租户可访问，平台技能所有租户可访问
	if skill.Eid != 0 && skill.Eid != eid {
		return "", ErrSkillNotVisible
	}

	installPath := skill.InstallPath
	if installPath == "" {
		return "", errors.New("skill install path is empty")
	}

	// 安全检查：防止路径穿越
	cleanPath := filepath.Clean(filePath)
	if strings.Contains(cleanPath, "..") {
		return "", ErrSkillScanZipPathTraversal
	}

	// 禁止绝对路径
	if filepath.IsAbs(cleanPath) {
		return "", ErrSkillScanZipPathTraversal
	}

	fullPath := filepath.Join(installPath, cleanPath)
	// 再次校验，确保最终路径在 installPath 下
	fullPath = filepath.Clean(fullPath)
	if !strings.HasPrefix(fullPath, installPath+string(filepath.Separator)) && fullPath != installPath {
		return "", ErrSkillScanZipPathTraversal
	}

	// 检查文件是否存在且是文件（不是目录）
	info, err := os.Stat(fullPath)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", errors.New("path is a directory, not a file")
	}

	// 限制文件大小（最大 10MB）
	const maxFileSize = 10 * 1024 * 1024
	if info.Size() > maxFileSize {
		return "", errors.New("file size exceeds maximum limit (10MB)")
	}

	content, err := os.ReadFile(fullPath)
	if err != nil {
		return "", err
	}

	return string(content), nil
}

// GetSkillFileInfo returns file metadata for streaming preview
func (s *SkillLibraryService) GetSkillFileInfo(ctx context.Context, eid, skillID int64, filePath string) (*SkillFileInfo, error) {
	skill, err := model.GetSkillLibraryByID(skillID)
	if err != nil {
		return nil, err
	}

	if skill.Eid != 0 && skill.Eid != eid {
		return nil, ErrSkillNotVisible
	}

	installPath := skill.InstallPath
	if installPath == "" {
		return nil, errors.New("skill install path is empty")
	}

	cleanPath := filepath.Clean(filePath)
	if strings.Contains(cleanPath, "..") {
		return nil, ErrSkillScanZipPathTraversal
	}
	if filepath.IsAbs(cleanPath) {
		return nil, ErrSkillScanZipPathTraversal
	}

	fullPath := filepath.Join(installPath, cleanPath)
	fullPath = filepath.Clean(fullPath)
	if !strings.HasPrefix(fullPath, installPath+string(filepath.Separator)) && fullPath != installPath {
		return nil, ErrSkillScanZipPathTraversal
	}

	info, err := os.Stat(fullPath)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, errors.New("path is a directory, not a file")
	}

	const maxFileSize = 10 * 1024 * 1024
	if info.Size() > maxFileSize {
		return nil, errors.New("file size exceeds maximum limit (10MB)")
	}

	return &SkillFileInfo{
		FullPath: fullPath,
		Size:     info.Size(),
		ModTime:  info.ModTime(),
	}, nil
}

// buildSkillFileTree walks the directory and builds file tree
func buildSkillFileTree(rootPath string) ([]SkillFileItem, error) {
	var flatFiles []SkillFileItem

	err := filepath.Walk(rootPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		relPath, err := filepath.Rel(rootPath, path)
		if err != nil {
			return err
		}
		if relPath == "." {
			return nil
		}

		item := SkillFileItem{
			Name:         info.Name(),
			Path:         filepath.ToSlash(relPath),
			Type:         "file",
			Size:         info.Size(),
			ModifiedTime: info.ModTime().Unix(),
		}

		if info.IsDir() {
			item.Type = "directory"
		}

		flatFiles = append(flatFiles, item)
		return nil
	})

	if err != nil {
		return nil, err
	}

	return buildTreeFromFlatList(flatFiles), nil
}

// buildTreeFromFlatList converts flat file list to tree structure
func buildTreeFromFlatList(files []SkillFileItem) []SkillFileItem {
	if len(files) == 0 {
		return []SkillFileItem{}
	}

	// 构建路径到文件项的映射
	pathMap := make(map[string]SkillFileItem)
	for _, f := range files {
		pathMap[f.Path] = f
	}

	// 找出所有根级别项目（路径中不包含 "/"）
	var root []SkillFileItem
	for _, f := range files {
		if !strings.Contains(f.Path, "/") {
			// 根级别项目
			if f.Type == "directory" {
				// 目录需要构建子节点
				children := buildChildren(f.Path, pathMap)
				f.Children = children
			}
			root = append(root, f)
		}
	}

	return root
}

// buildChildren 递归构建指定路径下的子节点
func buildChildren(parentPath string, pathMap map[string]SkillFileItem) []SkillFileItem {
	var children []SkillFileItem
	prefix := parentPath + "/"

	for path, item := range pathMap {
		// 检查是否是直接子项（路径以 parentPath/ 开头，且不再嵌套更多层级）
		if strings.HasPrefix(path, prefix) {
			remaining := strings.TrimPrefix(path, prefix)
			// 直接子项：剩余路径不包含 "/"
			if !strings.Contains(remaining, "/") {
				if item.Type == "directory" {
					// 递归构建子目录
					subChildren := buildChildren(path, pathMap)
					item.Children = subChildren
				}
				children = append(children, item)
			}
		}
	}

	return children
}

// UpdateSkillFiles updates multiple files in a skill package and repackages
func (s *SkillLibraryService) UpdateSkillFiles(ctx context.Context, eid, skillID int64, files []SkillFileUpdateItem, deletedFiles []string) (*SkillFileUpdateResult, error) {
	skill, err := model.GetSkillLibraryByID(skillID)
	if err != nil {
		return nil, err
	}

	// 权限校验：租户技能只有所属租户可编辑
	if skill.Eid != 0 && skill.Eid != eid {
		return nil, ErrSkillNotVisible
	}

	// 平台技能不允许编辑
	if skill.Eid == 0 {
		return nil, ErrSkillPlatformReadonly
	}

	installPath := skill.InstallPath
	if installPath == "" {
		return nil, errors.New("skill install path is empty")
	}

	// 1. 删除文件
	deletedCount := 0
	for _, filePath := range deletedFiles {
		if err := deleteSkillFile(installPath, filePath); err != nil {
			logger.Warnf(ctx, "删除文件失败: path=%s, err=%v", filePath, err)
			continue
		}
		deletedCount++
	}

	// 2. 并行更新文件（使用 errgroup）
	updatedCount := 0
	var updatedCountMu sync.Mutex
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(10) // 限制并发数，避免过多并发写入

	for _, file := range files {
		file := file // 捕获变量
		g.Go(func() error {
			if gctx.Err() != nil {
				return gctx.Err() // 如果其他任务失败，提前退出
			}
			if err := updateSkillFile(installPath, file.Path, file.Content); err != nil {
				logger.Warnf(ctx, "更新文件失败: path=%s, err=%v", file.Path, err)
				return nil // 单个文件失败不阻止其他文件，继续处理
			}
			updatedCountMu.Lock()
			updatedCount++
			updatedCountMu.Unlock()
			return nil
		})
	}

	_ = g.Wait() // 单个文件失败不阻止其他文件，错误已在回调中记录

	// 至少有一个操作成功
	if updatedCount == 0 && deletedCount == 0 {
		return nil, errors.New("no files updated or deleted")
	}

	// 3. 重新打包
	newZipKey, zipSHA256, err := s.repackAndUploadSkill(ctx, skill)
	if err != nil {
		return nil, err
	}

	// 4. 更新数据库
	updates := map[string]interface{}{
		"origin_zip_key":    newZipKey,
		"origin_zip_sha256": zipSHA256,
		"updated_time":      time.Now().UTC().UnixMilli(),
	}
	if err := model.UpdateSkillLibraryByIDAndEID(eid, skillID, updates); err != nil {
		return nil, err
	}

	return &SkillFileUpdateResult{
		UpdatedCount: updatedCount,
		DeletedCount: deletedCount,
		Repackaged:   true,
		NewZipKey:    newZipKey,
	}, nil
}

// deleteSkillFile removes a file or directory from the skill directory
func deleteSkillFile(installPath, filePath string) error {
	// 安全检查：防止路径穿越
	cleanPath := filepath.Clean(filePath)
	if strings.Contains(cleanPath, "..") {
		return ErrSkillScanZipPathTraversal
	}

	// 禁止绝对路径
	if filepath.IsAbs(cleanPath) {
		return ErrSkillScanZipPathTraversal
	}

	fullPath := filepath.Join(installPath, cleanPath)
	// 再次校验，确保最终路径在 installPath 下
	fullPath = filepath.Clean(fullPath)
	if !strings.HasPrefix(fullPath, installPath+string(filepath.Separator)) && fullPath != installPath {
		return ErrSkillScanZipPathTraversal
	}

	// 检查文件/目录是否存在
	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		return nil // 文件不存在，视为成功
	}

	// 删除文件或目录
	return os.RemoveAll(fullPath)
}

// updateSkillFile writes content to a file in the skill directory
func updateSkillFile(installPath, filePath, content string) error {
	// 安全检查：防止路径穿越
	cleanPath := filepath.Clean(filePath)
	if strings.Contains(cleanPath, "..") {
		return ErrSkillScanZipPathTraversal
	}

	// 禁止绝对路径
	if filepath.IsAbs(cleanPath) {
		return ErrSkillScanZipPathTraversal
	}

	fullPath := filepath.Join(installPath, cleanPath)
	// 再次校验，确保最终路径在 installPath 下
	fullPath = filepath.Clean(fullPath)
	if !strings.HasPrefix(fullPath, installPath+string(filepath.Separator)) && fullPath != installPath {
		return ErrSkillScanZipPathTraversal
	}

	// 确保目录存在
	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		return err
	}

	return os.WriteFile(fullPath, []byte(content), 0644)
}

// repackAndUploadSkill creates a new zip from the skill directory and uploads it
// Returns the new zip key and SHA256 hash, deletes the old zip after successful upload
// Uses streaming to avoid loading entire zip into memory
func (s *SkillLibraryService) repackAndUploadSkill(ctx context.Context, skill *model.SkillLibrary) (string, string, error) {
	pr, pw := io.Pipe()

	// 启动 goroutine 进行压缩
	zipErr := make(chan error, 1)
	go func() {
		err := zipSkillDirectoryToWriter(skill.InstallPath, pw)
		if err != nil {
			// 使用 CloseWithError 通知读端错误，阻止后续读取损坏数据
			pw.CloseWithError(err)
			zipErr <- err
			return
		}
		pw.Close()
		zipErr <- nil
	}()

	// 使用 TeeReader 同时计算 SHA256
	hash := sha256.New()
	tee := io.TeeReader(pr, hash)

	newZipKey := fmt.Sprintf("skills/tenants/%d/%s-%d.zip", skill.Eid, skill.SkillName, time.Now().Unix())

	// 流式上传
	if err := s.storage.SaveFromReader(tee, newZipKey); err != nil {
		// 关闭读端，goroutine 的写操作会收到 ErrClosedPipe
		pr.Close()
		// 等待 goroutine 结束，避免继续操作已关闭的 pipe
		<-zipErr // drain channel，忽略 goroutine 的错误（主流程已失败）
		return "", "", err
	}

	// 等待压缩完成并检查错误
	if err := <-zipErr; err != nil {
		return "", "", fmt.Errorf("zip creation failed: %w", err)
	}

	zipSHA256 := hex.EncodeToString(hash.Sum(nil))

	// 删除旧压缩包（上传成功后）
	oldZipKey := skill.OriginZipKey
	if oldZipKey != "" && oldZipKey != newZipKey {
		if err := s.storage.Delete(oldZipKey); err != nil {
			logger.Warnf(ctx, "删除旧压缩包失败: key=%s, err=%v", oldZipKey, err)
		}
	}

	return newZipKey, zipSHA256, nil
}

// zipSkillDirectory creates a zip file from a directory
func zipSkillDirectory(sourceDir, zipPath string) error {
	zipFile, err := os.Create(zipPath)
	if err != nil {
		return err
	}
	defer zipFile.Close()

	zw := zip.NewWriter(zipFile)
	defer zw.Close()

	return filepath.Walk(sourceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		relPath, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return err
		}
		if relPath == "." {
			return nil
		}

		// 创建 zip 条目
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		header.Name = filepath.ToSlash(relPath)

		if info.IsDir() {
			header.Name += "/"
			_, err = zw.CreateHeader(header)
			return err
		}

		// 写入文件内容
		header.Method = zip.Deflate
		writer, err := zw.CreateHeader(header)
		if err != nil {
			return err
		}

		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()
		_, copyErr := io.Copy(writer, file)
		return copyErr
	})
}

// zipSkillDirectoryToWriter creates a zip archive from sourceDir and writes to w
func zipSkillDirectoryToWriter(sourceDir string, w io.Writer) error {
	zw := zip.NewWriter(w)
	defer zw.Close()

	return filepath.Walk(sourceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		relPath, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return err
		}
		if relPath == "." {
			return nil
		}

		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		header.Name = filepath.ToSlash(relPath)

		if info.IsDir() {
			header.Name += "/"
			_, err = zw.CreateHeader(header)
			return err
		}

		header.Method = zip.Deflate
		writer, err := zw.CreateHeader(header)
		if err != nil {
			return err
		}

		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()
		_, copyErr := io.Copy(writer, file)
		return copyErr
	})
}

// ==================== 技能环境变量 Service ====================

// CreateSkillEnvVarRequest 创建技能环境变量请求
type CreateSkillEnvVarRequest struct {
	Key       string
	Value     string
	Sensitive bool
}

// UpdateSkillEnvVarRequest 更新技能环境变量请求
type UpdateSkillEnvVarRequest struct {
	Key       *string
	Value     *string
	Sensitive *bool
}

// invalidateSkillEnvVarCache 清除技能环境变量缓存
func invalidateSkillEnvVarCache(eid, skillID int64) {
	if !common.IsRedisEnabled() {
		return
	}
	cacheKey := fmt.Sprintf("%s%d:%d", skillEnvVarCachePrefix, eid, skillID)
	if err := common.RedisDel(cacheKey); err != nil {
		logger.Warnf(nil, "【缓存】删除技能环境变量缓存失败: key=%s, err=%v", cacheKey, err)
	}
}

// invalidateSkillUserEnvVarCache 清除用户级技能环境变量缓存
func invalidateSkillUserEnvVarCache(eid, userID, skillID int64) {
	if !common.IsRedisEnabled() {
		return
	}
	cacheKey := fmt.Sprintf("%s%d:%d:%d", skillUserEnvVarCachePrefix, eid, userID, skillID)
	if err := common.RedisDel(cacheKey); err != nil {
		logger.Warnf(nil, "【缓存】删除用户级技能环境变量缓存失败: key=%s, err=%v", cacheKey, err)
	}
}

// GetSkillEnvVarsMapCached 获取技能环境变量Map（带缓存）
func GetSkillEnvVarsMapCached(eid, skillID int64) (map[string]string, error) {
	cacheKey := fmt.Sprintf("%s%d:%d", skillEnvVarCachePrefix, eid, skillID)

	// 尝试从缓存获取
	if common.IsRedisEnabled() {
		if cached, err := common.RedisGet(cacheKey); err == nil && cached != "" {
			var result map[string]string
			if err := json.Unmarshal([]byte(cached), &result); err == nil {
				logger.Debugf(nil, "【缓存】命中技能环境变量: eid=%d, skillID=%d, count=%d", eid, skillID, len(result))
				return result, nil
			}
		}
	}

	// 缓存未命中，查询数据库
	records, err := model.GetSkillEnvVarsBySkillID(eid, skillID)
	if err != nil {
		return nil, err
	}
	result := make(map[string]string)
	for _, record := range records {
		result[record.Key] = record.Value
	}

	if len(result) > 0 {
		logger.Debugf(nil, "【缓存】未命中技能环境变量: eid=%d, skillID=%d, count=%d, 写入缓存", eid, skillID, len(result))
	}

	// 写入缓存（包括空结果，防止缓存穿透）
	if common.IsRedisEnabled() {
		if data, err := json.Marshal(result); err == nil {
			if err := common.RedisSet(cacheKey, string(data), skillEnvVarCacheTTL); err != nil {
				logger.Warnf(nil, "【缓存】设置技能环境变量缓存失败: key=%s, err=%v", cacheKey, err)
			}
		}
	}

	return result, nil
}

// GetSkillUserEnvVarsMapCached 获取用户级技能环境变量Map（带缓存）
func GetSkillUserEnvVarsMapCached(eid, userID, skillID int64) (map[string]string, error) {
	cacheKey := fmt.Sprintf("%s%d:%d:%d", skillUserEnvVarCachePrefix, eid, userID, skillID)

	if common.IsRedisEnabled() {
		if cached, err := common.RedisGet(cacheKey); err == nil && cached != "" {
			var result map[string]string
			if err := json.Unmarshal([]byte(cached), &result); err == nil {
				logger.Debugf(nil, "【缓存】命中用户级技能环境变量: eid=%d, userID=%d, skillID=%d, count=%d", eid, userID, skillID, len(result))
				return result, nil
			}
		}
	}

	records, err := model.GetSkillUserEnvVarsBySkillID(eid, userID, skillID)
	if err != nil {
		return nil, err
	}
	result := make(map[string]string)
	for _, record := range records {
		result[record.Key] = record.Value
	}

	if len(result) > 0 {
		logger.Debugf(nil, "【缓存】未命中用户级技能环境变量: eid=%d, userID=%d, skillID=%d, count=%d, 写入缓存", eid, userID, skillID, len(result))
	}

	// 写入缓存（包括空结果，防止缓存穿透）
	if common.IsRedisEnabled() {
		if data, err := json.Marshal(result); err == nil {
			if err := common.RedisSet(cacheKey, string(data), skillEnvVarCacheTTL); err != nil {
				logger.Warnf(nil, "【缓存】设置用户级技能环境变量缓存失败: key=%s, err=%v", cacheKey, err)
			}
		}
	}

	return result, nil
}

func cloneStringMap(src map[string]string) map[string]string {
	if len(src) == 0 {
		return map[string]string{}
	}
	dst := make(map[string]string, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

// GetEffectiveSkillEnvVarsMapCached 获取技能有效环境变量Map（技能级 + 用户级）
func GetEffectiveSkillEnvVarsMapCached(eid, userID, skillID int64) (map[string]string, error) {
	skillEnvVars, err := GetSkillEnvVarsMapCached(eid, skillID)
	if err != nil {
		return nil, err
	}
	if userID <= 0 {
		return cloneStringMap(skillEnvVars), nil
	}

	userEnvVars, err := GetSkillUserEnvVarsMapCached(eid, userID, skillID)
	if err != nil {
		return nil, err
	}

	result := make(map[string]string, len(skillEnvVars)+len(userEnvVars))
	for k, v := range skillEnvVars {
		result[k] = v
	}
	for k, v := range userEnvVars {
		result[k] = v
	}
	return result, nil
}

// WarmupSkillEnvVarCache 预热技能环境变量缓存
// 在技能加载完成后调用，预先将环境变量加载到缓存中
func WarmupSkillEnvVarCache(ctx context.Context) {
	if !common.IsRedisEnabled() {
		logger.Debugf(ctx, "【缓存预热】Redis 未启用，跳过技能环境变量缓存预热")
		return
	}

	logger.Infof(ctx, "【缓存预热】开始预热技能环境变量缓存")
	start := time.Now()

	// 获取所有技能库记录
	var skillLibs []model.SkillLibrary
	if err := model.DB.Where("publish_status = ?", "published").Find(&skillLibs).Error; err != nil {
		logger.Warnf(ctx, "【缓存预热】获取技能库列表失败: %v", err)
		return
	}

	count := 0
	for _, lib := range skillLibs {
		if _, err := GetSkillEnvVarsMapCached(lib.Eid, lib.ID); err != nil {
			continue
		}
		count++
	}

	logger.Infof(ctx, "【缓存预热】技能环境变量缓存预热完成: count=%d, cost=%v", count, time.Since(start))
}

// ListSkillEnvVars 获取技能环境变量列表
func (s *SkillLibraryService) ListSkillEnvVars(ctx context.Context, eid, skillID int64) ([]model.SkillEnvVarRecord, error) {
	// 验证技能存在
	_, err := getSkillLibraryByIDAndEIDWithDB(nil, eid, skillID)
	if err != nil {
		return nil, err
	}

	return model.GetSkillEnvVarsBySkillID(eid, skillID)
}

// CreateSkillEnvVar 创建技能环境变量
func (s *SkillLibraryService) CreateSkillEnvVar(ctx context.Context, eid, skillID int64, req *CreateSkillEnvVarRequest) (*model.SkillEnvVarRecord, error) {
	if req == nil || req.Key == "" {
		return nil, ErrSkillImportRequestInvalid
	}

	// 使用统一校验函数
	if err := model.ValidateEnvVar(req.Key, req.Value); err != nil {
		return nil, err
	}

	// 验证技能存在
	_, err := getSkillLibraryByIDAndEIDWithDB(nil, eid, skillID)
	if err != nil {
		return nil, err
	}

	// 检查环境变量名称是否已存在
	existingRecords, err := model.GetSkillEnvVarsBySkillID(eid, skillID)
	if err != nil {
		return nil, err
	}
	for _, record := range existingRecords {
		if record.Key == req.Key {
			return nil, fmt.Errorf("environment variable key '%s' already exists", req.Key)
		}
	}

	record := &model.SkillEnvVarRecord{
		Eid:       eid,
		SkillID:   skillID,
		Key:       req.Key,
		Value:     req.Value,
		Sensitive: req.Sensitive,
	}

	if err := model.CreateSkillEnvVar(nil, record); err != nil {
		return nil, err
	}

	// 清除缓存
	invalidateSkillEnvVarCache(eid, skillID)

	return record, nil
}

// UpdateSkillEnvVar 更新技能环境变量
func (s *SkillLibraryService) UpdateSkillEnvVar(ctx context.Context, eid, skillID, envVarID int64, req *UpdateSkillEnvVarRequest) (*model.SkillEnvVarRecord, error) {
	if req == nil {
		return nil, ErrSkillImportRequestInvalid
	}

	// 验证技能存在
	_, err := getSkillLibraryByIDAndEIDWithDB(nil, eid, skillID)
	if err != nil {
		return nil, err
	}

	updates := make(map[string]interface{})
	if req.Key != nil {
		if err := model.ValidateEnvVar(*req.Key, ""); err != nil {
			return nil, err
		}
		existingRecords, err := model.GetSkillEnvVarsBySkillID(eid, skillID)
		if err != nil {
			return nil, err
		}
		for _, record := range existingRecords {
			if record.ID != envVarID && record.Key == *req.Key {
				return nil, fmt.Errorf("environment variable key '%s' already exists", *req.Key)
			}
		}
		updates["key"] = *req.Key
	}
	if req.Value != nil {
		updates["value"] = *req.Value
	}
	if req.Sensitive != nil {
		updates["sensitive"] = *req.Sensitive
	}

	if len(updates) > 0 {
		if err := model.UpdateSkillEnvVar(nil, eid, skillID, envVarID, updates); err != nil {
			return nil, err
		}
		invalidateSkillEnvVarCache(eid, skillID)
	}

	// 获取更新后的记录
	records, err := model.GetSkillEnvVarsBySkillID(eid, skillID)
	if err != nil {
		return nil, err
	}
	for _, record := range records {
		if record.ID == envVarID {
			return &record, nil
		}
	}

	return nil, gorm.ErrRecordNotFound
}

// DeleteSkillEnvVar 删除技能环境变量
func (s *SkillLibraryService) DeleteSkillEnvVar(ctx context.Context, eid, skillID, envVarID int64) error {
	// 验证技能存在
	_, err := getSkillLibraryByIDAndEIDWithDB(nil, eid, skillID)
	if err != nil {
		return err
	}

	if err := model.DeleteSkillEnvVar(nil, eid, skillID, envVarID); err != nil {
		return err
	}

	// 清除缓存
	invalidateSkillEnvVarCache(eid, skillID)

	return nil
}

// BatchUpdateSkillEnvVars 批量更新技能环境变量（先删后建）
func (s *SkillLibraryService) BatchUpdateSkillEnvVars(ctx context.Context, eid, skillID int64, envVars []model.SkillEnvVar) ([]model.SkillEnvVarRecord, error) {
	// 验证技能存在
	_, err := getSkillLibraryByIDAndEIDWithDB(nil, eid, skillID)
	if err != nil {
		return nil, err
	}

	// 使用统一校验函数
	if err := model.ValidateEnvVars(envVars); err != nil {
		return nil, err
	}

	// 替换环境变量
	if err := model.ReplaceSkillEnvVars(nil, eid, skillID, envVars); err != nil {
		return nil, err
	}

	// 清除缓存
	invalidateSkillEnvVarCache(eid, skillID)

	// 返回更新后的列表
	return model.GetSkillEnvVarsBySkillID(eid, skillID)
}

// CreateSkillUserEnvVarRequest 创建用户级技能环境变量请求
type CreateSkillUserEnvVarRequest struct {
	Key       string
	Value     string
	Sensitive bool
}

// UpdateSkillUserEnvVarRequest 更新用户级技能环境变量请求
type UpdateSkillUserEnvVarRequest struct {
	Key       *string
	Value     *string
	Sensitive *bool
}

// ListSkillUserEnvVars 获取用户级技能环境变量列表
func (s *SkillLibraryService) ListSkillUserEnvVars(ctx context.Context, eid, userID, skillID int64) ([]model.SkillUserEnvVarRecord, error) {
	_, err := getSkillLibraryByIDAndEIDWithDB(nil, eid, skillID)
	if err != nil {
		return nil, err
	}
	if userID <= 0 {
		return []model.SkillUserEnvVarRecord{}, nil
	}
	return model.GetSkillUserEnvVarsBySkillID(eid, userID, skillID)
}

// CreateSkillUserEnvVar 创建用户级技能环境变量
func (s *SkillLibraryService) CreateSkillUserEnvVar(ctx context.Context, eid, userID, skillID int64, req *CreateSkillUserEnvVarRequest) (*model.SkillUserEnvVarRecord, error) {
	if req == nil || req.Key == "" {
		return nil, ErrSkillImportRequestInvalid
	}
	if userID <= 0 {
		return nil, ErrSkillImportRequestInvalid
	}

	if err := model.ValidateEnvVar(req.Key, req.Value); err != nil {
		return nil, err
	}

	_, err := getSkillLibraryByIDAndEIDWithDB(nil, eid, skillID)
	if err != nil {
		return nil, err
	}

	existingRecords, err := model.GetSkillUserEnvVarsBySkillID(eid, userID, skillID)
	if err != nil {
		return nil, err
	}
	for _, record := range existingRecords {
		if record.Key == req.Key {
			return nil, fmt.Errorf("environment variable key '%s' already exists", req.Key)
		}
	}

	record := &model.SkillUserEnvVarRecord{
		Eid:       eid,
		UserID:    userID,
		SkillID:   skillID,
		Key:       req.Key,
		Value:     req.Value,
		Sensitive: req.Sensitive,
	}
	if err := model.CreateSkillUserEnvVar(nil, record); err != nil {
		return nil, err
	}

	invalidateSkillUserEnvVarCache(eid, userID, skillID)
	return record, nil
}

// UpdateSkillUserEnvVar 更新用户级技能环境变量
func (s *SkillLibraryService) UpdateSkillUserEnvVar(ctx context.Context, eid, userID, skillID, envVarID int64, req *UpdateSkillUserEnvVarRequest) (*model.SkillUserEnvVarRecord, error) {
	if req == nil {
		return nil, ErrSkillImportRequestInvalid
	}
	if userID <= 0 {
		return nil, ErrSkillImportRequestInvalid
	}

	_, err := getSkillLibraryByIDAndEIDWithDB(nil, eid, skillID)
	if err != nil {
		return nil, err
	}

	updates := make(map[string]interface{})
	if req.Key != nil {
		if err := model.ValidateEnvVar(*req.Key, ""); err != nil {
			return nil, err
		}
		existingRecords, err := model.GetSkillUserEnvVarsBySkillID(eid, userID, skillID)
		if err != nil {
			return nil, err
		}
		for _, record := range existingRecords {
			if record.ID != envVarID && record.Key == *req.Key {
				return nil, fmt.Errorf("environment variable key '%s' already exists", *req.Key)
			}
		}
		updates["key"] = *req.Key
	}
	if req.Value != nil {
		updates["value"] = *req.Value
	}
	if req.Sensitive != nil {
		updates["sensitive"] = *req.Sensitive
	}

	if len(updates) > 0 {
		if err := model.UpdateSkillUserEnvVar(nil, eid, userID, skillID, envVarID, updates); err != nil {
			return nil, err
		}
		invalidateSkillUserEnvVarCache(eid, userID, skillID)
	}

	records, err := model.GetSkillUserEnvVarsBySkillID(eid, userID, skillID)
	if err != nil {
		return nil, err
	}
	for _, record := range records {
		if record.ID == envVarID {
			return &record, nil
		}
	}

	return nil, gorm.ErrRecordNotFound
}

// DeleteSkillUserEnvVar 删除用户级技能环境变量
func (s *SkillLibraryService) DeleteSkillUserEnvVar(ctx context.Context, eid, userID, skillID, envVarID int64) error {
	_, err := getSkillLibraryByIDAndEIDWithDB(nil, eid, skillID)
	if err != nil {
		return err
	}
	if userID <= 0 {
		return ErrSkillImportRequestInvalid
	}

	if err := model.DeleteSkillUserEnvVar(nil, eid, userID, skillID, envVarID); err != nil {
		return err
	}

	invalidateSkillUserEnvVarCache(eid, userID, skillID)
	return nil
}

// BatchUpdateSkillUserEnvVars 批量更新用户级技能环境变量（先删后建）
func (s *SkillLibraryService) BatchUpdateSkillUserEnvVars(ctx context.Context, eid, userID, skillID int64, envVars []model.SkillEnvVar) ([]model.SkillUserEnvVarRecord, error) {
	_, err := getSkillLibraryByIDAndEIDWithDB(nil, eid, skillID)
	if err != nil {
		return nil, err
	}
	if userID <= 0 {
		return nil, ErrSkillImportRequestInvalid
	}

	if err := model.ValidateEnvVars(envVars); err != nil {
		return nil, err
	}

	if err := model.ReplaceSkillUserEnvVars(nil, eid, userID, skillID, envVars); err != nil {
		return nil, err
	}

	invalidateSkillUserEnvVarCache(eid, userID, skillID)
	return model.GetSkillUserEnvVarsBySkillID(eid, userID, skillID)
}

func (s *SkillLibraryService) checkUserSkillPermission(userID, skillLibraryID int64) (bool, error) {
	userGroupIDs, err := s.resolveVisibleSkillGroupIDs(userID)
	if err != nil {
		return false, err
	}
	if len(userGroupIDs) == 0 {
		return false, nil
	}
	skillGroupIDs, err := model.GetResourcePermissionGroupIDs(skillLibraryID, model.ResourceTypeSkillLibrary)
	if err != nil {
		return false, err
	}
	skillGroupSet := make(map[int64]struct{}, len(skillGroupIDs))
	for _, gid := range skillGroupIDs {
		skillGroupSet[gid] = struct{}{}
	}
	for _, ugid := range userGroupIDs {
		if _, ok := skillGroupSet[ugid]; ok {
			return true, nil
		}
	}
	return false, nil
}

func (s *SkillLibraryService) ListAgentSkills(ctx context.Context, eid, agentID, userID int64) ([]*model.AgentSkillBindingWithSkill, error) {
	if _, _, err := model.CanUserAccessAgent(eid, userID, agentID); err != nil {
		return nil, ErrAgentSkillAccessDenied
	}

	items, err := model.ListAgentSkillBindingsWithSkills(eid, agentID, userID)
	if err != nil {
		return nil, err
	}

	for _, item := range items {
		if item == nil || item.BindType != model.AgentSkillBindTypeUser {
			continue
		}
		if item.Status != model.AgentSkillBindingStatusEnabled {
			continue
		}
		hasPermission, err := s.checkUserSkillPermission(userID, item.SkillLibraryID)
		if err != nil {
			return nil, err
		}
		if !hasPermission {
			item.Status = model.AgentSkillBindingStatusDisabled
		}
	}

	return items, nil
}

func (s *SkillLibraryService) AddAgentSkill(ctx context.Context, eid, agentID, userID, skillLibraryID int64) error {
	if _, _, err := model.CanUserAccessAgent(eid, userID, agentID); err != nil {
		return ErrAgentSkillAccessDenied
	}

	skillInfo, err := model.GetSkillLibraryByIDForTenant(eid, skillLibraryID)
	if err != nil {
		return err
	}
	if skillInfo.PublishStatus != model.SkillPublishStatusPublished {
		return ErrSkillNotPublished
	}
	if skillInfo.AdminStatus != model.SkillAdminStatusEnabled {
		return ErrSkillDisabled
	}

	isBuiltin, err := model.HasAgentBuiltinSkillBinding(eid, agentID, skillLibraryID)
	if err != nil {
		return err
	}
	if isBuiltin {
		return ErrSkillAlreadyBuiltin
	}

	hasPermission, err := s.checkUserSkillPermission(userID, skillLibraryID)
	if err != nil {
		return err
	}
	if !hasPermission {
		return ErrSkillPermissionDenied
	}

	return model.AddAgentSkillBinding(eid, agentID, skillLibraryID, model.AgentSkillBindTypeUser, userID)
}

func (s *SkillLibraryService) DeleteAgentSkill(ctx context.Context, eid, agentID, userID, bindingID int64) error {
	if _, _, err := model.CanUserAccessAgent(eid, userID, agentID); err != nil {
		return ErrAgentSkillAccessDenied
	}

	return model.DeleteAgentSkillBinding(eid, agentID, bindingID, model.AgentSkillBindTypeUser, userID)
}

func (s *SkillLibraryService) ListAgentBuiltinSkills(ctx context.Context, eid, agentID int64) ([]*model.AgentSkillBindingWithSkill, error) {
	return model.ListAgentSkillBuiltinBindings(eid, agentID)
}

func (s *SkillLibraryService) AddAgentBuiltinSkill(ctx context.Context, eid, agentID, skillLibraryID int64) error {
	skillInfo, err := model.GetSkillLibraryByIDForTenant(eid, skillLibraryID)
	if err != nil {
		return err
	}
	if skillInfo.PublishStatus != model.SkillPublishStatusPublished {
		return ErrSkillNotPublished
	}
	if skillInfo.AdminStatus != model.SkillAdminStatusEnabled {
		return ErrSkillDisabled
	}

	if err := model.DeleteAgentSkillUserBindingsBySkill(eid, agentID, skillLibraryID); err != nil {
		return err
	}

	return model.AddAgentSkillBinding(eid, agentID, skillLibraryID, model.AgentSkillBindTypeBuiltin, 0)
}

func (s *SkillLibraryService) DeleteAgentBuiltinSkill(ctx context.Context, eid, agentID, bindingID int64) error {
	return model.DeleteAgentSkillBinding(eid, agentID, bindingID, model.AgentSkillBindTypeBuiltin, 0)
}

func (s *SkillLibraryService) GetAgentRunnableSkillPathSet(ctx context.Context, eid, agentID, userID int64) (map[string]struct{}, error) {
	builtinPaths, err := model.ListAgentSkillBuiltinInstallPaths(eid, agentID)
	if err != nil {
		return nil, err
	}

	userSkillIDs, err := model.ListAgentSkillUserLibraryIDs(eid, agentID, userID)
	if err != nil {
		return nil, err
	}

	userGroupIDs, err := s.resolveVisibleSkillGroupIDs(userID)
	if err != nil {
		return nil, err
	}

	permittedSkillIDs := make([]int64, 0, len(userSkillIDs))
	if len(userSkillIDs) > 0 {
		for _, skillID := range userSkillIDs {
			if len(userGroupIDs) == 0 {
				continue
			}
			skillGroupIDs, gErr := model.GetResourcePermissionGroupIDs(skillID, model.ResourceTypeSkillLibrary)
			if gErr != nil {
				continue
			}
			skillSet := make(map[int64]struct{}, len(skillGroupIDs))
			for _, gid := range skillGroupIDs {
				skillSet[gid] = struct{}{}
			}
			for _, ugid := range userGroupIDs {
				if _, ok := skillSet[ugid]; ok {
					permittedSkillIDs = append(permittedSkillIDs, skillID)
					break
				}
			}
		}
	}

	allPaths := builtinPaths
	if len(permittedSkillIDs) > 0 {
		for _, skillID := range permittedSkillIDs {
			skillInfo, sErr := model.GetSkillLibraryByID(skillID)
			if sErr != nil || skillInfo == nil {
				continue
			}
			if skillInfo.PublishStatus != model.SkillPublishStatusPublished || skillInfo.AdminStatus != model.SkillAdminStatusEnabled {
				continue
			}
			allPaths = append(allPaths, skillInfo.InstallPath)
		}
	}

	result := make(map[string]struct{}, len(allPaths))
	for _, p := range allPaths {
		cp := filepath.Clean(strings.TrimSpace(p))
		if cp == "" || cp == "." {
			continue
		}
		if runnablePath, ok := resolveRunnableSkillInstallPath(cp); ok {
			result[runnablePath] = struct{}{}
			continue
		}
		logger.Debugf(ctx, "【技能运行】跳过不可运行Agent技能路径: eid=%d agent_id=%d user_id=%d path=%s", eid, agentID, userID, cp)
	}
	return result, nil
}
