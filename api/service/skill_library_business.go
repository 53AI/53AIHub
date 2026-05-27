package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/skill"
	"gorm.io/gorm"
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
)

type SkillExploreItem struct {
	*model.SkillLibrary
	BindingID     int64  `json:"binding_id"`
	Added         bool   `json:"added"`
	BindingStatus string `json:"binding_status"`
}

type SkillExploreListResult struct {
	Count int64               `json:"count"`
	Items []*SkillExploreItem `json:"items"`
}

type SkillDetailResult struct {
	*model.SkillLibrary
	BindingID     int64  `json:"binding_id"`
	Added         bool   `json:"added"`
	BindingStatus string `json:"binding_status"`
}

type SkillMyListResult struct {
	Count int64                              `json:"count"`
	Items []*model.UserSkillBindingWithSkill `json:"items"`
}

type UpdateSkillMetaRequest struct {
	Sort               *int64
	DisplayName        *string
	Description        *string
	UsageGuide         *string
	Version            *string
	AdminStatus        *string
	PermissionGroupIDs []int64
}

func (s *SkillLibraryService) GetUserRunnableSkillPathSet(ctx context.Context, eid, userID int64) (map[string]struct{}, error) {
	paths, err := model.ListRunnableSkillInstallPathsForUser(eid, userID)
	if err != nil {
		return nil, err
	}
	result := make(map[string]struct{}, len(paths))
	for _, p := range paths {
		cp := filepath.Clean(strings.TrimSpace(p))
		if cp == "" || cp == "." {
			continue
		}
		if runnablePath, ok := resolveRunnableSkillInstallPath(cp); ok {
			result[runnablePath] = struct{}{}
			continue
		}
		logger.Debugf(ctx, "【技能运行】跳过不可运行技能路径: eid=%d user_id=%d path=%s", eid, userID, cp)
	}
	return result, nil
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

	skillIDs := make([]int64, 0, len(skills))
	for _, item := range skills {
		if item != nil {
			skillIDs = append(skillIDs, item.ID)
		}
	}
	bindingInfoMap, err := model.ListUserSkillBindingInfoMap(eid, userID, skillIDs)
	if err != nil {
		return nil, err
	}

	items := make([]*SkillExploreItem, 0, len(skills))
	for _, item := range skills {
		if item == nil {
			continue
		}
		exploreItem := &SkillExploreItem{SkillLibrary: item}
		if bindingInfo, ok := bindingInfoMap[item.ID]; ok {
			exploreItem.BindingID = bindingInfo.BindingID
			exploreItem.Added = true
			exploreItem.BindingStatus = bindingInfo.Status
		}
		items = append(items, exploreItem)
	}

	return &SkillExploreListResult{Count: count, Items: items}, nil
}

func (s *SkillLibraryService) resolveVisibleSkillGroupIDs(userID int64) ([]int64, error) {
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
	bindingInfoMap, err := model.ListUserSkillBindingInfoMap(eid, userID, []int64{skillID})
	if err != nil {
		return nil, err
	}
	if bindingInfo, ok := bindingInfoMap[skillID]; ok {
		result.BindingID = bindingInfo.BindingID
		result.Added = true
		result.BindingStatus = bindingInfo.Status
	}
	return result, nil
}

func (s *SkillLibraryService) AddSkillToMy(ctx context.Context, eid, userID, userGroupID, skillID int64) error {
	skillInfo, err := s.canUserSeeSkill(ctx, eid, userID, userGroupID, skillID)
	if err != nil {
		return err
	}
	if skillInfo.PublishStatus != model.SkillPublishStatusPublished {
		return ErrSkillNotPublished
	}
	if skillInfo.AdminStatus != model.SkillAdminStatusEnabled {
		return ErrSkillDisabled
	}
	return model.AddUserSkillBinding(eid, userID, skillID)
}

func (s *SkillLibraryService) ListMySkills(ctx context.Context, eid, userID int64, offset, limit int) (*SkillMyListResult, error) {
	_ = ctx
	items, count, err := model.ListUserSkillBindingsWithSkills(eid, userID, offset, limit)
	if err != nil {
		return nil, err
	}
	return &SkillMyListResult{Count: count, Items: items}, nil
}

func (s *SkillLibraryService) UpdateMySkillStatus(ctx context.Context, eid, userID, bindingID int64, status string) error {
	_ = ctx
	if status != model.UserSkillBindingStatusEnabled && status != model.UserSkillBindingStatusDisabled {
		return ErrSkillStatusInvalid
	}
	return model.UpdateUserSkillBindingStatus(eid, userID, bindingID, status)
}

func (s *SkillLibraryService) DeleteMySkill(ctx context.Context, eid, userID, bindingID int64) error {
	_ = ctx
	return model.DeleteUserSkillBinding(eid, userID, bindingID)
}

func (s *SkillLibraryService) GetSkillDownloadInfoForUser(ctx context.Context, eid, userID, userGroupID, skillID int64) (*model.SkillLibrary, error) {
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
	skillInfo, err := s.GetSkillDownloadInfoForUser(ctx, eid, userID, userGroupID, skillID)
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

func (s *SkillLibraryService) UpdateSkillPermissions(ctx context.Context, tx *gorm.DB, skillID int64, permissionGroupIDs []int64) error {
	_ = ctx
	groupIDs := normalizePermissionGroupIDs(permissionGroupIDs)
	return UpdateResourcePermissions(nil, tx, skillID, model.ResourceTypeSkillLibrary, groupIDs)
}

func (s *SkillLibraryService) ListAdminSkills(ctx context.Context, eid int64, keyword string, publishStatus, adminStatus string, offset, limit int) ([]*model.SkillLibrary, int64, error) {
	_ = ctx
	return model.ListAdminSkillLibraries(eid, keyword, publishStatus, adminStatus, offset, limit)
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
			if err := s.UpdateSkillPermissions(ctx, tx, skillID, resolvedPermissionGroupIDs); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *SkillLibraryService) PublishSkill(ctx context.Context, eid, skillID int64) error {
	_ = ctx
	skillInfo, err := getSkillLibraryByIDAndEIDWithDB(model.DB, eid, skillID)
	if err != nil {
		return ErrSkillPublishPrecheckFailed
	}
	if skillInfo.PublishStatus == model.SkillPublishStatusRejected {
		return ErrSkillPublishPrecheckFailed
	}
	latestJob, err := model.GetLatestSkillScanJobBySkillLibraryID(eid, skillID)
	if err != nil {
		return ErrSkillPublishPrecheckFailed
	}
	if latestJob.Status != model.SkillScanJobStatusSuccess {
		return ErrSkillPublishPrecheckFailed
	}
	if latestJob.RiskLevel != model.SkillRiskLevelLow && latestJob.RiskLevel != model.SkillRiskLevelMedium {
		return ErrSkillPublishPrecheckFailed
	}
	updates := map[string]interface{}{
		"publish_status": model.SkillPublishStatusPublished,
	}
	if s.nowFunc != nil {
		updates["updated_time"] = s.nowFunc().UTC().UnixMilli()
	} else {
		updates["updated_time"] = time.Now().UTC().UnixMilli()
	}
	return model.UpdateSkillLibraryByIDAndEID(eid, skillID, updates)
}

func (s *SkillLibraryService) UpdateSkillAdminStatus(ctx context.Context, eid, skillID int64, adminStatus string) error {
	_ = ctx
	if adminStatus != model.SkillAdminStatusEnabled && adminStatus != model.SkillAdminStatusDisabled {
		return ErrSkillStatusInvalid
	}

	return model.DB.Transaction(func(tx *gorm.DB) error {
		skillInfo, err := getSkillLibraryByIDAndEIDWithDB(tx, eid, skillID)
		if err != nil {
			return err
		}
		if skillInfo.Eid == 0 {
			return ErrSkillPlatformReadonly
		}
		if skillInfo.PublishStatus != model.SkillPublishStatusPublished && adminStatus == model.SkillAdminStatusEnabled {
			return ErrSkillStatusInvalid
		}
		nowFunc := s.nowFunc
		if nowFunc == nil {
			nowFunc = time.Now
		}
		updates := map[string]interface{}{
			"admin_status": adminStatus,
			"updated_time": nowFunc().UTC().UnixMilli(),
		}
		if err := tx.Model(&model.SkillLibrary{}).Where("id = ? AND eid = ?", skillID, eid).
			Updates(updates).Error; err != nil {
			return err
		}
		if adminStatus == model.SkillAdminStatusDisabled {
			if err := model.BatchDisableUserSkillBindingsBySkillLibraryID(tx, eid, skillID); err != nil {
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

		if err := model.BatchDeleteUserSkillBindingsBySkillLibraryID(tx, eid, skillID); err != nil {
			return err
		}
		if err := tx.Where("resource_id = ? AND resource_type = ?", skillID, model.ResourceTypeSkillLibrary).
			Delete(&model.ResourcePermission{}).Error; err != nil {
			return err
		}
		if err := model.DeleteSkillScanJobsBySkillLibraryID(tx, eid, skillID); err != nil {
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

func (s *SkillLibraryService) ImportSkillAndStartScan(ctx context.Context, req *SkillImportRequest, permissionGroupIDs []int64) (*SkillImportResult, error) {
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
	return s.ImportSkillAndStartScan(ctx, req, permissionGroupIDs)
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
	if adminStatus == model.SkillAdminStatusDisabled {
		if err := model.BatchDisableUserSkillBindingsBySkillLibraryID(nil, eid, skillID); err != nil {
			return fmt.Errorf("disable user bindings failed: %w", err)
		}
	}
	return nil
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
