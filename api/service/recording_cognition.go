package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

const (
	RecordingCognitionTypePrinciple  = "principle"  // 原则
	RecordingCognitionTypePriority   = "priority"   // 价值排序
	RecordingCognitionTypeCriterion  = "criterion"  // 判断标准
	RecordingCognitionTypePreference = "preference" // 偏好
	RecordingCognitionTypeBoundary   = "boundary"   // 边界
	RecordingCognitionTypeAssumption = "assumption" // 前提
	RecordingCognitionTypeTrigger    = "trigger"    // 触发条件

	// 兼容包内小写
	recordingCognitionTypePrinciple  = RecordingCognitionTypePrinciple
	recordingCognitionTypePriority   = RecordingCognitionTypePriority
	recordingCognitionTypeCriterion  = RecordingCognitionTypeCriterion
	recordingCognitionTypePreference = RecordingCognitionTypePreference
	recordingCognitionTypeBoundary   = RecordingCognitionTypeBoundary
	recordingCognitionTypeAssumption = RecordingCognitionTypeAssumption
	recordingCognitionTypeTrigger    = RecordingCognitionTypeTrigger

	recordingCognitionLayerCore        = "core"
	recordingCognitionLayerSituational = "situational"

	recordingCognitionStatusCandidate  = "candidate"
	recordingCognitionStatusConfirmed  = "confirmed"
	recordingCognitionStatusConflicted = "conflicted"
	recordingCognitionStatusExpired    = "expired"
	recordingCognitionStatusRejected   = "rejected"

	recordingCognitionCandidateStatusPending   = "candidate"
	recordingCognitionCandidateStatusConfirmed = "confirmed"
	recordingCognitionCandidateStatusRejected  = "rejected"
	recordingCognitionCandidateStatusIgnored   = "ignored"

	recordingCognitionSourceBossAuthored   = "boss_authored"
	recordingCognitionSourceBossConfirmed  = "boss_confirmed"
	recordingCognitionSourceAutoConfirmed  = "auto_confirmed"
	recordingCognitionSourceExplicit       = "explicit_statement"
	recordingCognitionSourceBehavior       = "behavior_observation"
	recordingCognitionSourceAIInference    = "ai_inference"
	recordingCognitionSourceExternalImport = "external_import"
)

var (
	ErrRecordingCognitionForbidden = errors.New("recording cognition is not accessible")
	ErrRecordingCognitionNotFound  = errors.New("recording cognition is not found")
	ErrRecordingCognitionInvalid   = errors.New("recording cognition input is invalid")
	ErrRecordingCognitionCandidate = errors.New("recording cognition candidate is not reviewable")
	// ErrRecordingCognitionLayerDomain 核心认知（core）跨赛道通用，不得归属业务领域
	ErrRecordingCognitionLayerDomain = errors.New("recording cognition core layer must not carry domain")
	// ErrRecordingCognitionDomainUnavailable 废止认知复活时原分类已不可用（已删除或被屏蔽），不允许重新生效
	ErrRecordingCognitionDomainUnavailable = errors.New("recording cognition domain is unavailable")
	// ErrRecordingCognitionDomainRequired 领域认知（situational）必须归属一个已存在的业务领域，不允许未分类的正式认知
	ErrRecordingCognitionDomainRequired = errors.New("recording cognition situational layer requires domain")
)

type RecordingCognitionService struct {
	eid int64
}

type RecordingCognitionEvidenceRef struct {
	SourceFileID     int64    `json:"source_file_id"`
	SourceFileName   string   `json:"source_file_name,omitempty"`
	SourceFileTime   int64    `json:"source_file_time,omitempty"`
	SourceSegmentIDs []string `json:"source_segment_ids"`
	SourceType       string   `json:"source_type,omitempty"`
	ExternalSource   string   `json:"external_source,omitempty"`
	ExternalRef      string   `json:"external_ref,omitempty"`
	ObservedAt       int64    `json:"observed_at,omitempty"`
}

type RecordingCognitionView struct {
	ID              int64                           `json:"id"`
	Eid             int64                           `json:"eid"`
	OwnerID         int64                           `json:"owner_id"`
	Title           string                          `json:"title"`
	Statement       string                          `json:"statement"`
	CognitionType   string                          `json:"cognition_type"`
	Layer           string                          `json:"layer"`
	DomainID        int64                           `json:"domain_id"`
	DomainName      string                          `json:"domain_name"`
	DomainCode      string                          `json:"domain_code,omitempty"`
	RetrievalReason string                          `json:"retrieval_reason,omitempty"`
	Scope           []string                        `json:"scope"`
	Status          string                          `json:"status"`
	SourceType      string                          `json:"source_type"`
	Confidence      float64                         `json:"confidence"`
	SourceFileID    int64                           `json:"source_file_id,omitempty"`
	SourceFileName  string                          `json:"source_file_name,omitempty"`
	SourceFileTime  int64                           `json:"source_file_time,omitempty"`
	ValidFrom       int64                           `json:"valid_from"`
	ValidUntil      int64                           `json:"valid_until"`
	CurrentVersion  int                             `json:"current_version"`
	EvidenceRefs    []RecordingCognitionEvidenceRef `json:"evidence_refs"`
	ConflictRefs    []string                        `json:"conflict_refs"`
	ConfirmedBy     int64                           `json:"confirmed_by"`
	ConfirmedAt     int64                           `json:"confirmed_at"`
	CreatedTime     int64                           `json:"created_time"`
	UpdatedTime     int64                           `json:"updated_time"`
}

type RecordingCognitionVersionView struct {
	ID               int64                           `json:"id"`
	CognitionID      int64                           `json:"cognition_id"`
	Version          int                             `json:"version"`
	Title            string                          `json:"title"`
	Statement        string                          `json:"statement"`
	CognitionType    string                          `json:"cognition_type"`
	Layer            string                          `json:"layer"`
	DomainID         int64                           `json:"domain_id"`
	DomainName       string                          `json:"domain_name"`
	Scope            []string                        `json:"scope"`
	ChangeType       string                          `json:"change_type"`
	SourceType       string                          `json:"source_type"`
	SourceFileID     int64                           `json:"source_file_id,omitempty"`
	SourceFileName   string                          `json:"source_file_name,omitempty"`
	SourceFileTime   int64                           `json:"source_file_time,omitempty"`
	SourceSegmentIDs []string                        `json:"source_segment_ids"`
	EvidenceRefs     []RecordingCognitionEvidenceRef `json:"evidence_refs"`
	ActorID          int64                           `json:"actor_id"`
	CreatedAtUnix    int64                           `json:"created_at_unix"`
}

type RecordingCognitionDetail struct {
	RecordingCognitionView
	Versions []RecordingCognitionVersionView `json:"versions"`
}

type RecordingCognitionList struct {
	Items []RecordingCognitionView `json:"items"`
	Total int64                    `json:"total"`
}

type RecordingCognitionCandidateView struct {
	ID                int64                           `json:"id"`
	Eid               int64                           `json:"eid"`
	OwnerID           int64                           `json:"owner_id"`
	FileID            int64                           `json:"file_id"`
	Title             string                          `json:"title"`
	Statement         string                          `json:"statement"`
	CognitionType     string                          `json:"cognition_type"`
	Layer             string                          `json:"layer"`
	DomainID          int64                           `json:"domain_id,omitempty"`
	DomainName        string                          `json:"domain_name,omitempty"`
	Scope             []string                        `json:"scope"`
	SourceType        string                          `json:"source_type"`
	Confidence        float64                         `json:"confidence"`
	SourceFileID      int64                           `json:"source_file_id"`
	SourceFileName    string                          `json:"source_file_name,omitempty"`
	SourceFileTime    int64                           `json:"source_file_time,omitempty"`
	SourceSegmentIDs  []string                        `json:"source_segment_ids"`
	Status            string                          `json:"status"`
	ReviewReason      string                          `json:"review_reason,omitempty"`
	TargetCognitionID int64                           `json:"target_cognition_id,omitempty"`
	ReviewedBy        int64                           `json:"reviewed_by,omitempty"`
	ReviewedAt        int64                           `json:"reviewed_at,omitempty"`
	EvidenceRefs      []RecordingCognitionEvidenceRef `json:"evidence_refs,omitempty"`
	ExternalSource    string                          `json:"external_source,omitempty"`
	ExternalRef       string                          `json:"external_ref,omitempty"`
	ObservedAt        int64                           `json:"observed_at,omitempty"`
	// ImportResult 仅外部导入接口返回：created=本次新建候选，refreshed=同来源重复导入仅刷新内容
	ImportResult string `json:"import_result,omitempty"`
	CreatedTime  int64  `json:"created_time"`
	UpdatedTime  int64  `json:"updated_time"`
}

type RecordingCognitionCandidateList struct {
	Items []RecordingCognitionCandidateView `json:"items"`
	Total int64                             `json:"total"`
}

// RecordingCognitionOverview 认知总览统计。
// situational_count 只统计已归属业务领域的领域认知（domain_id > 0），未分类不计入；
// 因此 core_count + situational_count 不等于正式表已确认总数（差额为未分类的领域认知）。
// pending_count 包含正式表 status=candidate 与候选表待审阅数量。
type RecordingCognitionOverview struct {
	CoreCount        int64 `json:"core_count"`        // 核心认知总数 (layer='core' AND status='confirmed')
	SituationalCount int64 `json:"situational_count"` // 已归属领域的领域认知总数 (layer='situational' AND status='confirmed' AND domain_id>0)
	PendingCount     int64 `json:"pending_count"`     // 待确认总数
	CoreTypeCount    int   `json:"core_type_count"`   // 核心认知类型数（固定 7 类）
	DomainCount      int   `json:"domain_count"`      // 当前用户可见领域数
}

type CreateRecordingCognitionInput struct {
	Title            string
	Statement        string
	CognitionType    string
	Layer            string
	DomainID         int64
	Scope            []string
	SourceType       string
	Confidence       float64
	SourceFileID     int64
	SourceSegmentIDs []string
	EvidenceRefs     []RecordingCognitionEvidenceRef
}

type ImportRecordingCognitionItemInput struct {
	Title          string
	Statement      string
	CognitionType  string
	DomainID       int64
	Layer          string
	Scope          []string
	Confidence     float64
	ExternalSource string
	ExternalRef    string
	ObservedAt     int64
	EvidenceRefs   []RecordingCognitionEvidenceRef
}

type UpdateRecordingCognitionInput struct {
	Title            *string
	Statement        *string
	CognitionType    *string
	Layer            *string
	DomainID         *int64
	Scope            *[]string
	Status           *string
	Confidence       *float64
	ValidUntil       *int64
	SourceFileID     int64
	SourceSegmentIDs []string
	EvidenceRefs     []RecordingCognitionEvidenceRef
}

type ReviewRecordingCognitionCandidateInput struct {
	Statement     string
	Title         string
	Scope         []string
	CognitionType string
	DomainID      int64
	Layer         string
	Reason        string
}

// UpdateRecordingCognitionCandidateInput 是待确认认知候选的编辑入参，仅传入需要修改的字段。
type UpdateRecordingCognitionCandidateInput struct {
	Title         *string
	Statement     *string
	CognitionType *string
	Layer         *string
	DomainID      *int64
	Scope         *[]string
}

type RecordingCognitionContextItem struct {
	ID              int64                           `json:"id"`
	Title           string                          `json:"title"`
	Statement       string                          `json:"statement"`
	CognitionType   string                          `json:"cognition_type"`
	Layer           string                          `json:"layer"`
	DomainID        int64                           `json:"domain_id,omitempty"`
	DomainName      string                          `json:"domain_name,omitempty"`
	RetrievalReason string                          `json:"retrieval_reason,omitempty"`
	Scope           []string                        `json:"scope"`
	Confidence      float64                         `json:"confidence"`
	SourceType      string                          `json:"source_type"`
	EvidenceRefs    []RecordingCognitionEvidenceRef `json:"evidence_refs"`
}

type RecordingCognitionContextPackage struct {
	Core             []RecordingCognitionContextItem `json:"core"`
	Situational      []RecordingCognitionContextItem `json:"situational"`
	Conflicts        []RecordingCognitionContextItem `json:"conflicts"`
	RetrievalReasons []string                        `json:"retrieval_reasons,omitempty"`
	OmittedReasons   []string                        `json:"omitted_reasons,omitempty"`
}

func NewRecordingCognitionService(eid int64) *RecordingCognitionService {
	return &RecordingCognitionService{eid: eid}
}

// resolvePersonalLibraryAccess 解析当前用户个人知识库的访问权限。
// 返回 (nil, nil) 表示个人知识库未初始化（统计等读取路径应返回空视图而非 403）；
// 知识库存在但权限不足返回 ErrRecordingCognitionForbidden。
func (s *RecordingCognitionService) resolvePersonalLibraryAccess(ctx context.Context, userID int64, requireEdit bool) (*model.Library, error) {
	library, err := NewPersonalSpaceService(s.eid).GetExistingPersonalLibrary(ctx, userID)
	if err != nil {
		return nil, err
	}
	if library == nil {
		return nil, nil
	}
	permission, err := GetUserPermission(s.eid, model.RESOURCE_TYPE_LIBRARY, library.ID, userID)
	if err != nil {
		return nil, err
	}
	if (requireEdit && permission < model.PERMISSION_EDIT_KNOWLEDGE) || (!requireEdit && permission < model.PERMISSION_VIEW_ONLY) {
		return nil, ErrRecordingCognitionForbidden
	}
	return library, nil
}

// ensureOwnerAccess 个人知识库未初始化（nil）时放行：认知数据按 owner_id 自我隔离，
// 用户仍可查看/维护自己的数据；统计接口在无库时自行返回空视图。
func (s *RecordingCognitionService) ensureOwnerAccess(ctx context.Context, userID int64, requireEdit bool) error {
	_, err := s.resolvePersonalLibraryAccess(ctx, userID, requireEdit)
	return err
}

func (s *RecordingCognitionService) List(ctx context.Context, userID int64, status, layer, cognitionType string, domainID int64, sourceTypes []string, keyword string, limit, offset int) (*RecordingCognitionList, error) {
	if err := s.ensureOwnerAccess(ctx, userID, false); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	query := model.DB.WithContext(ctx).Model(&model.RecordingCognition{}).
		Where("eid = ? AND owner_id = ?", s.eid, userID)
	if status = strings.TrimSpace(status); status != "" {
		if !validRecordingCognitionStatus(status) {
			return nil, ErrRecordingCognitionInvalid
		}
		query = query.Where("status = ?", status)
	}
	if layer = strings.TrimSpace(layer); layer != "" {
		if !validRecordingCognitionLayer(layer) {
			return nil, ErrRecordingCognitionInvalid
		}
		query = query.Where("layer = ?", layer)
	}
	if cognitionType = strings.TrimSpace(cognitionType); cognitionType != "" {
		if !validRecordingCognitionType(cognitionType) {
			return nil, ErrRecordingCognitionInvalid
		}
		query = query.Where("cognition_type = ?", cognitionType)
	}
	if domainID > 0 {
		query = query.Where("domain_id = ?", domainID)
	}
	if len(sourceTypes) > 0 {
		for _, st := range sourceTypes {
			if !validRecordingCognitionSourceType(strings.TrimSpace(st)) {
				return nil, ErrRecordingCognitionInvalid
			}
		}
		query = query.Where("source_type IN ?", sourceTypes)
	}
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		like := "%" + escapeRecordingCognitionLikeKeyword(keyword) + "%"
		query = query.Where("(title LIKE ? ESCAPE '!' OR statement LIKE ? ESCAPE '!')", like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	var rows []model.RecordingCognition
	if err := query.Order("status asc, updated_time desc, id desc").Offset(offset).Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}

	domainNames := s.resolveDomainNames(ctx, userID, rows)
	fileInfos := s.recordingCognitionSourceFileInfos(ctx, userID, cognitionSourceFileIDs(rows))
	items := make([]RecordingCognitionView, 0, len(rows))
	for _, row := range rows {
		view := recordingCognitionViewWithFileInfos(row, fileInfos)
		view.DomainName = domainNames[row.DomainID]
		items = append(items, view)
	}
	return &RecordingCognitionList{Items: items, Total: total}, nil
}

// recordingCognitionOverviewCacheTTL 看板统计缓存有效期；认知/候选/领域写路径均显式失效，TTL 仅作兜底
const recordingCognitionOverviewCacheTTL = 60 * time.Second

func recordingCognitionOverviewCacheKey(eid, userID int64) string {
	return fmt.Sprintf("recording:cognition:overview:%d:%d", eid, userID)
}

// invalidateRecordingCognitionOverviewCache 认知/候选/领域写路径后失效该用户看板统计缓存。
func invalidateRecordingCognitionOverviewCache(eid, userID int64) {
	_ = common.RedisDel(recordingCognitionOverviewCacheKey(eid, userID))
}

// recordingCognitionOverviewCachePattern 看板统计缓存的 key 前缀，供离线任务批量清理。
const recordingCognitionOverviewCachePattern = "recording:cognition:overview:*"

// PurgeRecordingCognitionOverviewCache 清理全部看板统计缓存。
// 供离线迁移/修复任务在直接写库后调用（这些写入绕过应用层失效逻辑，TTL 兜底仅 60 秒）。
func PurgeRecordingCognitionOverviewCache() (int64, error) {
	return common.RedisDelByPattern(recordingCognitionOverviewCachePattern)
}

func (s *RecordingCognitionService) Overview(ctx context.Context, userID int64) (*RecordingCognitionOverview, error) {
	library, err := s.resolvePersonalLibraryAccess(ctx, userID, false)
	if err != nil {
		return nil, err
	}
	if library == nil {
		// 个人知识库未初始化：统计直接返回空（全 0），不触发初始化、不 403。
		return &RecordingCognitionOverview{}, nil
	}
	cacheKey := recordingCognitionOverviewCacheKey(s.eid, userID)
	if raw, err := common.RedisGet(cacheKey); err == nil {
		var cached RecordingCognitionOverview
		if jsonErr := json.Unmarshal([]byte(raw), &cached); jsonErr == nil {
			return &cached, nil
		}
	}
	scope := func(db *gorm.DB) *gorm.DB {
		return db.Where("eid = ? AND owner_id = ?", s.eid, userID)
	}
	// 正式表计数合并为 1 条 GROUP BY（status, layer, 是否归属领域），避免同范围多次 COUNT 扫描。
	// CASE 而非布尔表达式：保证 MySQL/PostgreSQL/SQLite 三方言都能扫成整数。
	// situational_count 只统计已归属业务领域的领域认知（domain_id > 0）：未分类不属于任何领域，也不计入该指标。
	var coreCount, situationalCount, formalPendingCount int64
	var counts []struct {
		Status    string
		Layer     string
		HasDomain int64
		Cnt       int64
	}
	if err := scope(model.DB.WithContext(ctx).Model(&model.RecordingCognition{})).
		Select("status, layer, CASE WHEN domain_id > 0 THEN 1 ELSE 0 END AS has_domain, count(*) as cnt").
		Group("status, layer, CASE WHEN domain_id > 0 THEN 1 ELSE 0 END").
		Scan(&counts).Error; err != nil {
		return nil, err
	}
	for _, c := range counts {
		switch {
		case c.Status == recordingCognitionStatusConfirmed && c.Layer == recordingCognitionLayerCore:
			coreCount += c.Cnt
		case c.Status == recordingCognitionStatusConfirmed && c.Layer == recordingCognitionLayerSituational && c.HasDomain > 0:
			situationalCount += c.Cnt
		case c.Status == recordingCognitionStatusCandidate:
			formalPendingCount += c.Cnt
		}
	}
	var candidatePendingCount int64
	if err := scope(model.DB.WithContext(ctx).Model(&model.RecordingCognitionCandidate{})).Where("status = ?", recordingCognitionCandidateStatusPending).Count(&candidatePendingCount).Error; err != nil {
		return nil, err
	}

	domains, _ := NewRecordingCognitionDomainService(s.eid, userID).List(ctx)

	overview := &RecordingCognitionOverview{
		CoreCount:        coreCount,
		SituationalCount: situationalCount,
		PendingCount:     formalPendingCount + candidatePendingCount,
		CoreTypeCount:    len(recordingCognitionTypes()),
		DomainCount:      len(domains),
	}
	if raw, err := json.Marshal(overview); err == nil {
		_ = common.RedisSet(cacheKey, string(raw), recordingCognitionOverviewCacheTTL)
	}
	return overview, nil
}

// CoreStats 统计当前用户已确认核心认知（layer='core' AND status='confirmed'）在 7 类规范下的数量分布。
type RecordingCognitionCoreStats struct {
	Principle  int64 `json:"principle"`  // 原则
	Priority   int64 `json:"priority"`   // 价值排序
	Criterion  int64 `json:"criterion"`  // 判断标准
	Preference int64 `json:"preference"` // 偏好
	Boundary   int64 `json:"boundary"`   // 边界
	Assumption int64 `json:"assumption"` // 前提
	Trigger    int64 `json:"trigger"`    // 触发条件
	Total      int64 `json:"total"`      // 核心认知总数
}

func (s *RecordingCognitionService) CoreStats(ctx context.Context, userID int64) (*RecordingCognitionCoreStats, error) {
	library, err := s.resolvePersonalLibraryAccess(ctx, userID, false)
	if err != nil {
		return nil, err
	}
	if library == nil {
		// 个人知识库未初始化：统计直接返回空（全 0），不触发初始化、不 403。
		return &RecordingCognitionCoreStats{}, nil
	}
	stats := &RecordingCognitionCoreStats{}
	rows := make([]struct {
		CognitionType string
		Cnt           int64
	}, 0)
	err = model.DB.WithContext(ctx).Model(&model.RecordingCognition{}).
		Select("cognition_type, count(*) as cnt").
		Where("eid = ? AND owner_id = ? AND status = ? AND layer = ?", s.eid, userID, recordingCognitionStatusConfirmed, recordingCognitionLayerCore).
		Group("cognition_type").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		switch row.CognitionType {
		case RecordingCognitionTypePrinciple:
			stats.Principle = row.Cnt
		case RecordingCognitionTypePriority:
			stats.Priority = row.Cnt
		case RecordingCognitionTypeCriterion:
			stats.Criterion = row.Cnt
		case RecordingCognitionTypePreference:
			stats.Preference = row.Cnt
		case RecordingCognitionTypeBoundary:
			stats.Boundary = row.Cnt
		case RecordingCognitionTypeAssumption:
			stats.Assumption = row.Cnt
		case RecordingCognitionTypeTrigger:
			stats.Trigger = row.Cnt
		}
	}
	// Total 必须是该范围内的真实行数，而不是 7 类分桶之和：类型为空或非规范值的存量行
	// 只出现在 COUNT 里，分桶会静默丢弃，导致看板 core_count 与分布 total 对不上。
	var total int64
	if err := model.DB.WithContext(ctx).Model(&model.RecordingCognition{}).
		Where("eid = ? AND owner_id = ? AND status = ? AND layer = ?", s.eid, userID, recordingCognitionStatusConfirmed, recordingCognitionLayerCore).
		Count(&total).Error; err != nil {
		return nil, err
	}
	stats.Total = total
	if unclassified := total - stats.Principle - stats.Priority - stats.Criterion - stats.Preference - stats.Boundary - stats.Assumption - stats.Trigger; unclassified > 0 {
		logger.SysErrorf("【老板认知】核心认知存在未归类类型: eid=%d owner_id=%d 未归类=%d，请检查 cognition_type 是否规范值", s.eid, userID, unclassified)
	}
	return stats, nil
}

func (s *RecordingCognitionService) Detail(ctx context.Context, userID, cognitionID int64) (*RecordingCognitionDetail, error) {
	if err := s.ensureOwnerAccess(ctx, userID, false); err != nil {
		return nil, err
	}
	var row model.RecordingCognition
	if err := model.DB.WithContext(ctx).Where("id = ? AND eid = ? AND owner_id = ?", cognitionID, s.eid, userID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRecordingCognitionNotFound
		}
		return nil, err
	}
	var versions []model.RecordingCognitionVersion
	if err := model.DB.WithContext(ctx).Where("cognition_id = ? AND eid = ? AND owner_id = ?", cognitionID, s.eid, userID).Order("version desc, id desc").Find(&versions).Error; err != nil {
		return nil, err
	}
	fileIDs := cognitionSourceFileIDs([]model.RecordingCognition{row})
	for _, version := range versions {
		fileIDs = appendCognitionSourceFileID(fileIDs, version.SourceFileID)
		fileIDs = appendCognitionSourceFileIDs(fileIDs, unmarshalEvidenceRefs(version.EvidenceRefsJSON))
	}
	fileInfos := s.recordingCognitionSourceFileInfos(ctx, userID, fileIDs)
	domainSvc := NewRecordingCognitionDomainService(s.eid, userID)
	domainName := domainSvc.ResolveDomainName(ctx, row.DomainID)

	view := recordingCognitionViewWithFileInfos(row, fileInfos)
	view.DomainID = row.DomainID
	view.DomainName = domainName

	detail := &RecordingCognitionDetail{
		RecordingCognitionView: view,
		Versions:               make([]RecordingCognitionVersionView, 0, len(versions)),
	}
	for _, version := range versions {
		vView := recordingCognitionVersionViewWithFileInfos(version, fileInfos)
		vView.DomainID = version.DomainID
		vView.DomainName = domainSvc.ResolveDomainName(ctx, version.DomainID)
		detail.Versions = append(detail.Versions, vView)
	}
	return detail, nil
}

func (s *RecordingCognitionService) Create(ctx context.Context, userID int64, input CreateRecordingCognitionInput) (*RecordingCognitionDetail, error) {
	if err := s.ensureOwnerAccess(ctx, userID, true); err != nil {
		return nil, err
	}
	input.Title = strings.TrimSpace(input.Title)
	input.Statement = strings.TrimSpace(input.Statement)
	input.CognitionType = strings.TrimSpace(input.CognitionType)
	if err := validateRecordingCognitionInput(input.Title, input.Statement, input.CognitionType, input.Layer); err != nil {
		return nil, err
	}
	if err := validateRecordingCognitionLayerDomain(input.Layer, input.DomainID); err != nil {
		return nil, err
	}
	if err := validateRecordingCognitionFormalDomain(input.Layer, input.DomainID); err != nil {
		return nil, err
	}
	if input.SourceType == "" {
		input.SourceType = recordingCognitionSourceBossAuthored
	}
	if !validRecordingCognitionSourceType(input.SourceType) || input.SourceType != recordingCognitionSourceBossAuthored {
		return nil, ErrRecordingCognitionInvalid
	}
	domainCode := ""
	if input.DomainID > 0 {
		var err error
		if domainCode, err = s.domainCodeFor(ctx, userID, input.DomainID); err != nil {
			return nil, err
		}
	}
	if err := s.validateEvidenceRefs(ctx, userID, input.EvidenceRefs); err != nil {
		return nil, err
	}
	if input.SourceFileID == 0 && len(input.SourceSegmentIDs) > 0 {
		return nil, ErrRecordingCognitionInvalid
	}
	if input.SourceFileID > 0 {
		if _, err := GetAccessibleRecordingFile(ctx, s.eid, userID, input.SourceFileID, false); err != nil {
			return nil, err
		}
		if len(input.SourceSegmentIDs) > 0 {
			if err := s.validateEvidenceRefs(ctx, userID, []RecordingCognitionEvidenceRef{{SourceFileID: input.SourceFileID, SourceSegmentIDs: input.SourceSegmentIDs, SourceType: input.SourceType}}); err != nil {
				return nil, err
			}
		}
	}
	now := time.Now().UnixMilli()
	row := &model.RecordingCognition{
		Eid: s.eid, OwnerID: userID, Title: input.Title, Statement: model.LongText(input.Statement),
		CognitionType: input.CognitionType, Layer: input.Layer, DomainID: input.DomainID, DomainCode: domainCode,
		ScopeJSON: marshalStringSlice(input.Scope),
		Status:    recordingCognitionStatusConfirmed, SourceType: input.SourceType, Confidence: clampConfidence(input.Confidence),
		ValidFrom: now, CurrentVersion: 1, EvidenceRefsJSON: marshalEvidenceRefs(input.EvidenceRefs),
		CreatedBy: userID, ConfirmedBy: userID, ConfirmedAt: now,
	}
	version := cognitionVersionFromInput(s.eid, userID, row, 1, "authored", input.SourceFileID, input.SourceSegmentIDs, input.EvidenceRefs, userID, now)
	if err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(row).Error; err != nil {
			return err
		}
		// 并发兜底：写入期间领域可能被删除/屏蔽，落库后复核可见性，不可见则回滚
		if row.DomainID > 0 && !recordingCognitionDomainVisibleIn(tx, s.eid, userID, row.DomainID) {
			return ErrRecordingCognitionDomainUnavailable
		}
		version.CognitionID = row.ID
		return tx.Create(&version).Error
	}); err != nil {
		return nil, err
	}
	invalidateRecordingCognitionOverviewCache(s.eid, userID)
	return s.Detail(ctx, userID, row.ID)
}

func (s *RecordingCognitionService) ImportCognitions(ctx context.Context, userID int64, inputs []ImportRecordingCognitionItemInput) (*RecordingCognitionCandidateList, error) {
	if err := s.ensureOwnerAccess(ctx, userID, true); err != nil {
		return nil, err
	}
	if len(inputs) == 0 || len(inputs) > 100 {
		return nil, ErrRecordingCognitionInvalid
	}

	rows := make([]model.RecordingCognitionCandidate, 0, len(inputs))
	importResults := make([]string, 0, len(inputs))
	err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, input := range inputs {
			input.Title = strings.TrimSpace(input.Title)
			input.Statement = strings.TrimSpace(input.Statement)
			input.CognitionType = strings.TrimSpace(input.CognitionType)
			input.ExternalSource = strings.TrimSpace(input.ExternalSource)
			input.ExternalRef = strings.TrimSpace(input.ExternalRef)
			if err := validateRecordingCognitionInput(input.Title, input.Statement, input.CognitionType, input.Layer); err != nil {
				return err
			}
			if input.ExternalSource == "" || input.ExternalRef == "" || len(input.ExternalSource) > 64 || len(input.ExternalRef) > 255 {
				return ErrRecordingCognitionInvalid
			}
			if err := validateRecordingCognitionLayerDomain(input.Layer, input.DomainID); err != nil {
				return err
			}
			domainCode := ""
			if input.DomainID > 0 {
				var err error
				if domainCode, err = s.domainCodeFor(ctx, userID, input.DomainID); err != nil {
					return err
				}
				// 并发兜底：导入期间领域可能被删除/屏蔽，整批原子失败而不是留下悬挂引用
				if !recordingCognitionDomainVisibleIn(tx, s.eid, userID, input.DomainID) {
					return ErrRecordingCognitionDomainUnavailable
				}
			}
			if err := s.validateEvidenceRefs(ctx, userID, input.EvidenceRefs); err != nil {
				return err
			}
			observedAt := input.ObservedAt
			if observedAt <= 0 {
				observedAt = time.Now().UnixMilli()
			}
			payload, err := json.Marshal(struct {
				Title          string
				Statement      string
				CognitionType  string
				Layer          string
				DomainID       int64
				Scope          model.LongText
				Confidence     float64
				ExternalSource string
				ExternalRef    string
				EvidenceRefs   []RecordingCognitionEvidenceRef
			}{
				Title: input.Title, Statement: input.Statement, CognitionType: input.CognitionType, Layer: input.Layer,
				DomainID: input.DomainID, Scope: marshalStringSlice(input.Scope), Confidence: clampConfidence(input.Confidence),
				ExternalSource: input.ExternalSource, ExternalRef: input.ExternalRef, EvidenceRefs: input.EvidenceRefs,
			})
			if err != nil {
				return err
			}
			payloadHash := hashRecordingCognitionCandidateSourceKey(s.eid, userID, 0, input.ExternalSource, input.ExternalRef, string(payload))
			sourceKeyHash := hashRecordingCognitionCandidateSourceKey(s.eid, userID, 0, input.ExternalSource, input.ExternalRef, "")
			candidate := model.RecordingCognitionCandidate{
				Eid: s.eid, OwnerID: userID, FileID: 0,
				MinutesHash:   payloadHash,
				SourceKeyHash: sourceKeyHash,
				Title:         input.Title,
				Statement:     model.LongText(input.Statement),
				CognitionType: input.CognitionType,
				Layer:         input.Layer,
				DomainID:      input.DomainID,
				DomainCode:    domainCode,
				ScopeJSON:     marshalStringSlice(input.Scope),
				SourceType:    recordingCognitionSourceExternalImport,
				Confidence:    clampConfidence(input.Confidence),
				Status:        recordingCognitionCandidateStatusPending,
			}
			importResult := "refreshed"
			var existing model.RecordingCognitionCandidate
			findErr := tx.Where("eid = ? AND owner_id = ? AND file_id = 0 AND source_key_hash = ?", s.eid, userID, sourceKeyHash).First(&existing).Error
			if findErr == nil {
				// 同一外部来源重复导入只刷新内容，保留审核结论（status/target_cognition_id/留痕），
				// 避免已转正候选被重置为待校准、进而重复转正出重复正式认知
				if err := tx.Model(&model.RecordingCognitionCandidate{}).Where("id = ?", existing.ID).Updates(map[string]interface{}{
					"minutes_hash": candidate.MinutesHash, "title": candidate.Title, "statement": candidate.Statement,
					"cognition_type": candidate.CognitionType, "layer": candidate.Layer,
					"domain_id": candidate.DomainID, "domain_code": candidate.DomainCode,
					"scope_json": candidate.ScopeJSON, "confidence": candidate.Confidence,
					"updated_time": time.Now().UTC().UnixMilli(),
				}).Error; err != nil {
					return err
				}
				// 重新读取以返回真实状态（内容已刷新、审核结论保留）
				if err := tx.Where("id = ?", existing.ID).First(&candidate).Error; err != nil {
					return err
				}
			} else if errors.Is(findErr, gorm.ErrRecordNotFound) {
				if err := tx.Create(&candidate).Error; err != nil {
					return err
				}
				importResult = "created"
			} else {
				return findErr
			}
			evidence := model.RecordingCognitionExternalEvidence{
				Eid:              s.eid,
				OwnerID:          userID,
				CandidateID:      candidate.ID,
				ExternalSource:   input.ExternalSource,
				ExternalRef:      input.ExternalRef,
				ObservedAt:       observedAt,
				EvidenceRefsJSON: marshalEvidenceRefs(input.EvidenceRefs),
				PayloadHash:      payloadHash,
			}
			var existingEvidence model.RecordingCognitionExternalEvidence
			evErr := tx.Where("candidate_id = ?", candidate.ID).First(&existingEvidence).Error
			if evErr == nil {
				evidence.ID = existingEvidence.ID
				if err := tx.Save(&evidence).Error; err != nil {
					return err
				}
			} else if errors.Is(evErr, gorm.ErrRecordNotFound) {
				if err := tx.Create(&evidence).Error; err != nil {
					return err
				}
			} else {
				return evErr
			}
			rows = append(rows, candidate)
			importResults = append(importResults, importResult)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	invalidateRecordingCognitionOverviewCache(s.eid, userID)
	externalEvidence, err := s.loadExternalEvidence(ctx, userID, rows)
	if err != nil {
		return nil, err
	}
	fileInfos := s.recordingCognitionSourceFileInfos(ctx, userID, candidateSourceFileIDs(rows))
	domainSvc := NewRecordingCognitionDomainService(s.eid, userID)
	items := make([]RecordingCognitionCandidateView, 0, len(rows))
	for i, row := range rows {
		item := recordingCognitionCandidateViewWithFileInfos(row, fileInfos)
		if i < len(importResults) {
			item.ImportResult = importResults[i]
		}
		if row.DomainID > 0 {
			item.DomainName = domainSvc.ResolveDomainName(ctx, row.DomainID)
		}
		if ev, ok := externalEvidence[row.ID]; ok {
			item.ExternalSource = ev.ExternalSource
			item.ExternalRef = ev.ExternalRef
			item.ObservedAt = ev.ObservedAt
			item.EvidenceRefs = unmarshalEvidenceRefs(ev.EvidenceRefsJSON)
		}
		items = append(items, item)
	}
	return &RecordingCognitionCandidateList{Items: items, Total: int64(len(items))}, nil
}

func (s *RecordingCognitionService) Update(ctx context.Context, userID, cognitionID int64, input UpdateRecordingCognitionInput) (*RecordingCognitionDetail, error) {
	if err := s.ensureOwnerAccess(ctx, userID, true); err != nil {
		return nil, err
	}
	var row model.RecordingCognition
	if err := model.DB.WithContext(ctx).Where("id = ? AND eid = ? AND owner_id = ?", cognitionID, s.eid, userID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRecordingCognitionNotFound
		}
		return nil, err
	}
	if input.Title != nil {
		row.Title = strings.TrimSpace(*input.Title)
	}
	if input.Statement != nil {
		row.Statement = model.LongText(strings.TrimSpace(*input.Statement))
	}
	if input.CognitionType != nil {
		row.CognitionType = strings.TrimSpace(*input.CognitionType)
	}
	if input.Layer != nil {
		row.Layer = strings.TrimSpace(*input.Layer)
	}
	if input.DomainID != nil {
		domainCode := ""
		if *input.DomainID > 0 {
			var err error
			if domainCode, err = s.domainCodeFor(ctx, userID, *input.DomainID); err != nil {
				return nil, err
			}
		}
		row.DomainID = *input.DomainID
		row.DomainCode = domainCode
	}
	if input.Scope != nil {
		row.ScopeJSON = marshalStringSlice(*input.Scope)
	}
	previousStatus := row.Status
	if input.Status != nil {
		row.Status = strings.TrimSpace(*input.Status)
	}
	if input.Confidence != nil {
		row.Confidence = clampConfidence(*input.Confidence)
	}
	if input.ValidUntil != nil {
		row.ValidUntil = *input.ValidUntil
	}
	if err := validateRecordingCognitionInput(row.Title, string(row.Statement), row.CognitionType, row.Layer); err != nil {
		return nil, err
	}
	if !validRecordingCognitionStatus(row.Status) {
		return nil, ErrRecordingCognitionInvalid
	}
	if err := validateRecordingCognitionLayerDomain(row.Layer, row.DomainID); err != nil {
		return nil, err
	}
	if err := validateRecordingCognitionFormalDomain(row.Layer, row.DomainID); err != nil {
		return nil, err
	}
	// 废止认知复活（expired -> confirmed）必须校验原分类仍可用：分类已删除或被屏蔽时不允许复活，
	// 否则会在已失效的分类下重新产出生效认知（前端列表按可见领域查询，看不到却计入统计）。
	if input.Status != nil && previousStatus == recordingCognitionStatusExpired &&
		row.Status == recordingCognitionStatusConfirmed && row.DomainID > 0 {
		if _, err := s.domainCodeFor(ctx, userID, row.DomainID); err != nil {
			if errors.Is(err, ErrRecordingCognitionInvalid) {
				return nil, ErrRecordingCognitionDomainUnavailable
			}
			return nil, err
		}
	}
	if len(input.EvidenceRefs) > 0 {
		if err := s.validateEvidenceRefs(ctx, userID, input.EvidenceRefs); err != nil {
			return nil, err
		}
	}
	if input.SourceFileID == 0 && len(input.SourceSegmentIDs) > 0 {
		return nil, ErrRecordingCognitionInvalid
	}
	if input.SourceFileID > 0 && len(input.SourceSegmentIDs) > 0 {
		if err := s.validateEvidenceRefs(ctx, userID, []RecordingCognitionEvidenceRef{{SourceFileID: input.SourceFileID, SourceSegmentIDs: input.SourceSegmentIDs, SourceType: recordingCognitionSourceBossConfirmed}}); err != nil {
			return nil, err
		}
	}
	// 编辑认知时 source_type 不被修改（来源血统固定，个人使用无需反复确认）
	now := time.Now().UnixMilli()
	changeType := "modified"
	if input.Status != nil && input.Statement == nil && input.Title == nil && input.Scope == nil {
		changeType = "status_changed"
	}
	version := cognitionVersionFromInput(s.eid, userID, &row, row.CurrentVersion+1, changeType, input.SourceFileID, input.SourceSegmentIDs, input.EvidenceRefs, userID, now)
	version.CognitionID = row.ID
	row.CurrentVersion++
	if row.Status == recordingCognitionStatusConfirmed {
		row.ConfirmedBy = userID
		row.ConfirmedAt = now
	}
	if len(input.EvidenceRefs) > 0 {
		row.EvidenceRefsJSON = marshalEvidenceRefs(input.EvidenceRefs)
	}
	if err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&row).Error; err != nil {
			return err
		}
		// 并发兜底：保存期间领域可能被删除/屏蔽，落库后复核可见性，不可见则回滚
		if row.DomainID > 0 && !recordingCognitionDomainVisibleIn(tx, s.eid, userID, row.DomainID) {
			return ErrRecordingCognitionDomainUnavailable
		}
		return tx.Create(&version).Error
	}); err != nil {
		return nil, err
	}
	invalidateRecordingCognitionOverviewCache(s.eid, userID)
	return s.Detail(ctx, userID, row.ID)
}

// Expire 废止认知：将认知状态流转为 expired（已失效），保留版本审计链，并退出洞察召回池。
// 与原有状态机保持一致：正式认知的废弃态为 expired，不物理删除，也不使用候选专属的 rejected。
func (s *RecordingCognitionService) Expire(ctx context.Context, userID, cognitionID int64) error {
	if err := s.ensureOwnerAccess(ctx, userID, true); err != nil {
		return err
	}
	var row model.RecordingCognition
	if err := model.DB.WithContext(ctx).Where("id = ? AND eid = ? AND owner_id = ?", cognitionID, s.eid, userID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrRecordingCognitionNotFound
		}
		return err
	}
	if row.Status == recordingCognitionStatusExpired {
		return nil // 已失效，幂等
	}
	now := time.Now().UnixMilli()
	row.Status = recordingCognitionStatusExpired
	version := cognitionVersionFromInput(s.eid, userID, &row, row.CurrentVersion+1, "expired", 0, nil, nil, userID, now)
	version.CognitionID = row.ID
	row.CurrentVersion++
	if err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&row).Error; err != nil {
			return err
		}
		return tx.Create(&version).Error
	}); err != nil {
		return err
	}
	invalidateRecordingCognitionOverviewCache(s.eid, userID)
	return nil
}

func (s *RecordingCognitionService) ListCandidates(ctx context.Context, userID, fileID int64, status, layer, cognitionType string, domainID int64, sourceTypes []string, keyword string, limit, offset int) (*RecordingCognitionCandidateList, error) {
	if fileID == -1 {
		// 全局待确认候选列表：查询该用户全部候选（会议提炼 + 外部导入）
		if err := s.ensureOwnerAccess(ctx, userID, false); err != nil {
			return nil, err
		}
	} else if fileID > 0 {
		if _, err := GetAccessibleRecordingFile(ctx, s.eid, userID, fileID, false); err != nil {
			return nil, err
		}
	} else if fileID == 0 {
		if err := s.ensureOwnerAccess(ctx, userID, false); err != nil {
			return nil, err
		}
	} else {
		return nil, ErrRecordingCognitionInvalid
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	query := model.DB.WithContext(ctx).Model(&model.RecordingCognitionCandidate{}).Where("eid = ? AND owner_id = ?", s.eid, userID)
	if fileID != -1 {
		query = query.Where("file_id = ?", fileID)
	}
	if status = strings.TrimSpace(status); status != "" {
		if !validRecordingCognitionCandidateStatus(status) {
			return nil, ErrRecordingCognitionInvalid
		}
		query = query.Where("status = ?", status)
	}
	if layer = strings.TrimSpace(layer); layer != "" {
		if !validRecordingCognitionLayer(layer) {
			return nil, ErrRecordingCognitionInvalid
		}
		query = query.Where("layer = ?", layer)
	}
	if cognitionType = strings.TrimSpace(cognitionType); cognitionType != "" {
		if !validRecordingCognitionType(cognitionType) {
			return nil, ErrRecordingCognitionInvalid
		}
		query = query.Where("cognition_type = ?", cognitionType)
	}
	if domainID > 0 {
		query = query.Where("domain_id = ?", domainID)
	}
	if len(sourceTypes) > 0 {
		for _, st := range sourceTypes {
			if !validRecordingCognitionCandidateSourceType(strings.TrimSpace(st)) {
				return nil, ErrRecordingCognitionInvalid
			}
		}
		query = query.Where("source_type IN ?", sourceTypes)
	}
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		like := "%" + escapeRecordingCognitionLikeKeyword(keyword) + "%"
		query = query.Where("(title LIKE ? ESCAPE '!' OR statement LIKE ? ESCAPE '!')", like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	var rows []model.RecordingCognitionCandidate
	if err := query.Order("id desc").Offset(offset).Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	externalEvidence, err := s.loadExternalEvidence(ctx, userID, rows)
	if err != nil {
		return nil, err
	}
	fileInfos := s.recordingCognitionSourceFileInfos(ctx, userID, candidateSourceFileIDs(rows))
	domainSvc := NewRecordingCognitionDomainService(s.eid, userID)
	items := make([]RecordingCognitionCandidateView, 0, len(rows))
	for _, row := range rows {
		item := recordingCognitionCandidateViewWithFileInfos(row, fileInfos)
		if row.DomainID > 0 {
			item.DomainName = domainSvc.ResolveDomainName(ctx, row.DomainID)
		}
		if ev, ok := externalEvidence[row.ID]; ok {
			item.ExternalSource = ev.ExternalSource
			item.ExternalRef = ev.ExternalRef
			item.ObservedAt = ev.ObservedAt
			item.EvidenceRefs = unmarshalEvidenceRefs(ev.EvidenceRefsJSON)
		}
		items = append(items, item)
	}
	return &RecordingCognitionCandidateList{Items: items, Total: total}, nil
}

func (s *RecordingCognitionService) ReviewCandidate(ctx context.Context, userID, fileID, candidateID int64, action string, input ReviewRecordingCognitionCandidateInput) (*RecordingCognitionDetail, error) {
	candidate, err := s.loadPendingCandidate(ctx, userID, candidateID, fileID)
	if err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	switch strings.TrimSpace(action) {
	case "reject", "ignore":
		status := recordingCognitionCandidateStatusRejected
		if action == "ignore" {
			status = recordingCognitionCandidateStatusIgnored
		}
		// 带 status 条件的部分更新：并发审核（转正/驳回）已推进状态时不再覆盖其结果
		result := model.DB.WithContext(ctx).Model(&model.RecordingCognitionCandidate{}).
			Where("id = ? AND status = ?", candidate.ID, recordingCognitionCandidateStatusPending).
			Updates(map[string]interface{}{
				"status":        status,
				"review_reason": model.LongText(strings.TrimSpace(input.Reason)),
				"reviewed_by":   userID,
				"reviewed_at":   now,
				"updated_time":  now,
			})
		if result.Error != nil {
			return nil, result.Error
		}
		if result.RowsAffected == 0 {
			return nil, ErrRecordingCognitionCandidate
		}
		invalidateRecordingCognitionOverviewCache(s.eid, userID)
		return nil, nil
	case "confirm", "conflict":
		statement := strings.TrimSpace(input.Statement)
		if statement == "" {
			statement = strings.TrimSpace(string(candidate.Statement))
		}
		title := strings.TrimSpace(input.Title)
		if title == "" {
			title = candidate.Title
		}
		cognitionType := strings.TrimSpace(input.CognitionType)
		if cognitionType == "" {
			cognitionType = candidate.CognitionType
		}
		layer := strings.TrimSpace(input.Layer)
		if layer == "" {
			layer = candidate.Layer
		}
		domainID := input.DomainID
		if domainID == 0 {
			domainID = candidate.DomainID
		}
		scope := input.Scope
		if len(scope) == 0 {
			scope = unmarshalStringSlice(candidate.ScopeJSON)
		}
		if err := validateRecordingCognitionInput(title, statement, cognitionType, layer); err != nil {
			return nil, err
		}
		if err := validateRecordingCognitionLayerDomain(layer, domainID); err != nil {
			return nil, err
		}
		if err := validateRecordingCognitionFormalDomain(layer, domainID); err != nil {
			return nil, err
		}
		domainCode := ""
		if domainID > 0 {
			var err error
			if domainCode, err = s.domainCodeFor(ctx, userID, domainID); err != nil {
				return nil, err
			}
		}
		evidenceRefs := []RecordingCognitionEvidenceRef{}
		if candidate.FileID > 0 {
			evidenceRefs = append(evidenceRefs, RecordingCognitionEvidenceRef{SourceFileID: candidate.SourceFileID, SourceSegmentIDs: unmarshalStringSlice(candidate.SourceSegmentIDs), SourceType: candidate.SourceType})
		}
		if candidate.FileID == 0 {
			externalEvidence, err := s.loadExternalEvidence(ctx, userID, []model.RecordingCognitionCandidate{*candidate})
			if err != nil {
				return nil, err
			}
			if item, ok := externalEvidence[candidate.ID]; ok {
				evidenceRefs = unmarshalEvidenceRefs(item.EvidenceRefsJSON)
				if item.ExternalSource != "" && item.ExternalRef != "" {
					evidenceRefs = append(evidenceRefs, RecordingCognitionEvidenceRef{
						SourceType: recordingCognitionSourceExternalImport, ExternalSource: item.ExternalSource,
						ExternalRef: item.ExternalRef, ObservedAt: item.ObservedAt,
					})
				}
			}
		}
		status := recordingCognitionStatusConfirmed
		changeType := "confirmed"
		if action == "conflict" {
			status = recordingCognitionStatusConflicted
			changeType = "marked_conflicted"
		}
		row := &model.RecordingCognition{
			Eid: s.eid, OwnerID: userID, Title: title, Statement: model.LongText(statement),
			CognitionType: cognitionType, Layer: layer, DomainID: domainID, DomainCode: domainCode, ScopeJSON: marshalStringSlice(scope),
			Status: status, SourceType: recordingCognitionSourceBossConfirmed,
			Confidence: clampConfidence(maxFloat(candidate.Confidence, 0.7)), ValidFrom: now, CurrentVersion: 1,
			EvidenceRefsJSON: marshalEvidenceRefs(evidenceRefs),
			CreatedBy:        userID, ConfirmedBy: userID, ConfirmedAt: now,
		}
		if err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			return saveConfirmedCandidateTx(tx, candidate, row, changeType, input.Reason, userID, now)
		}); err != nil {
			return nil, err
		}
		invalidateRecordingCognitionOverviewCache(s.eid, userID)
		return s.Detail(ctx, userID, row.ID)
	default:
		return nil, ErrRecordingCognitionInvalid
	}
}

// ensureCandidateAccess 按候选真实归属校验编辑权限：有录音走录音文件权限，外部导入候选走个人空间权限。
func (s *RecordingCognitionService) ensureCandidateAccess(ctx context.Context, userID, fileID int64, requireEdit bool) error {
	if fileID > 0 {
		_, err := GetAccessibleRecordingFile(ctx, s.eid, userID, fileID, requireEdit)
		return err
	}
	if fileID == 0 {
		return s.ensureOwnerAccess(ctx, userID, requireEdit)
	}
	return ErrRecordingCognitionInvalid
}

// loadPendingCandidate 加载候选并校验会议归属（fileID=-1 表示全局，不校验）、编辑权限与待校准状态。
func (s *RecordingCognitionService) loadPendingCandidate(ctx context.Context, userID, candidateID, fileID int64) (*model.RecordingCognitionCandidate, error) {
	var candidate model.RecordingCognitionCandidate
	if err := model.DB.WithContext(ctx).Where("id = ? AND eid = ? AND owner_id = ?", candidateID, s.eid, userID).First(&candidate).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRecordingCognitionNotFound
		}
		return nil, err
	}
	if fileID != -1 && candidate.FileID != fileID {
		return nil, ErrRecordingCognitionNotFound
	}
	if err := s.ensureCandidateAccess(ctx, userID, candidate.FileID, true); err != nil {
		return nil, err
	}
	if candidate.Status != recordingCognitionCandidateStatusPending {
		return nil, ErrRecordingCognitionCandidate
	}
	return &candidate, nil
}

// candidateView 组装单条候选视图（含领域名、关联录音信息与外部导入来源）。
func (s *RecordingCognitionService) candidateView(ctx context.Context, userID int64, candidate model.RecordingCognitionCandidate) RecordingCognitionCandidateView {
	fileInfos := s.recordingCognitionSourceFileInfos(ctx, userID, candidateSourceFileIDs([]model.RecordingCognitionCandidate{candidate}))
	item := recordingCognitionCandidateViewWithFileInfos(candidate, fileInfos)
	if candidate.DomainID > 0 {
		item.DomainName = NewRecordingCognitionDomainService(s.eid, userID).ResolveDomainName(ctx, candidate.DomainID)
	}
	if candidate.FileID == 0 {
		if externalEvidence, err := s.loadExternalEvidence(ctx, userID, []model.RecordingCognitionCandidate{candidate}); err == nil {
			if ev, ok := externalEvidence[candidate.ID]; ok {
				item.ExternalSource = ev.ExternalSource
				item.ExternalRef = ev.ExternalRef
				item.ObservedAt = ev.ObservedAt
				item.EvidenceRefs = unmarshalEvidenceRefs(ev.EvidenceRefsJSON)
			}
		}
	}
	return item
}

// UpdateCandidate 编辑待校准候选；已转正或已审核的候选不在此修改，避免正式认知与候选留痕不一致。
// 只写回本次传入的字段，并带 status 条件，避免覆盖并发审核（转正/驳回）的结果。
func (s *RecordingCognitionService) UpdateCandidate(ctx context.Context, userID, candidateID int64, input UpdateRecordingCognitionCandidateInput) (*RecordingCognitionCandidateView, error) {
	candidate, err := s.loadPendingCandidate(ctx, userID, candidateID, -1)
	if err != nil {
		return nil, err
	}

	// 未传的字段沿用原值，仅用于整体校验
	title, statement := candidate.Title, string(candidate.Statement)
	if input.Title != nil {
		title = strings.TrimSpace(*input.Title)
	}
	if input.Statement != nil {
		statement = strings.TrimSpace(*input.Statement)
	}
	cognitionType, layer := candidate.CognitionType, candidate.Layer
	if input.CognitionType != nil {
		cognitionType = strings.TrimSpace(*input.CognitionType)
	}
	if input.Layer != nil {
		layer = strings.TrimSpace(*input.Layer)
	}
	if err := validateRecordingCognitionInput(title, statement, cognitionType, layer); err != nil {
		return nil, err
	}
	domainID := candidate.DomainID
	if input.DomainID != nil {
		domainID = *input.DomainID
	}
	if err := validateRecordingCognitionLayerDomain(layer, domainID); err != nil {
		return nil, err
	}

	updates := make(map[string]interface{}, 7)
	if input.Title != nil {
		updates["title"] = title
	}
	if input.Statement != nil {
		updates["statement"] = model.LongText(statement)
	}
	if input.CognitionType != nil {
		updates["cognition_type"] = cognitionType
	}
	if input.Layer != nil {
		updates["layer"] = layer
	}
	if input.Scope != nil {
		updates["scope_json"] = marshalStringSlice(*input.Scope)
	}
	if input.DomainID != nil {
		domainCode := ""
		if *input.DomainID > 0 {
			if domainCode, err = s.domainCodeFor(ctx, userID, *input.DomainID); err != nil {
				return nil, err
			}
		}
		updates["domain_id"] = *input.DomainID
		updates["domain_code"] = domainCode
	}
	if len(updates) == 0 {
		view := s.candidateView(ctx, userID, *candidate)
		return &view, nil
	}
	updates["updated_time"] = time.Now().UTC().UnixMilli()
	result := model.DB.WithContext(ctx).Model(&model.RecordingCognitionCandidate{}).
		Where("id = ? AND status = ?", candidate.ID, recordingCognitionCandidateStatusPending).
		Updates(updates)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, ErrRecordingCognitionCandidate
	}
	if err := model.DB.WithContext(ctx).Where("id = ?", candidate.ID).First(candidate).Error; err != nil {
		return nil, err
	}
	view := s.candidateView(ctx, userID, *candidate)
	return &view, nil
}

func (s *RecordingCognitionService) validateDomainID(ctx context.Context, userID, domainID int64) error {
	if domainID <= 0 {
		return nil
	}
	_, err := s.domainCodeFor(ctx, userID, domainID)
	return err
}

// domainCodeFor 校验领域在当前用户可见范围内，并返回其 code（自建领域无 code 时为空串）。
func (s *RecordingCognitionService) domainCodeFor(ctx context.Context, userID, domainID int64) (string, error) {
	views, err := NewRecordingCognitionDomainService(s.eid, userID).List(ctx)
	if err != nil {
		return "", err
	}
	for _, v := range views {
		if v.ID == domainID {
			return v.Code, nil
		}
	}
	return "", ErrRecordingCognitionInvalid
}

// normalizeRecordingCognitionDomainKey 归一领域匹配键（去空白 + 小写；中文名称不受影响）。
func normalizeRecordingCognitionDomainKey(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

// resolveRecordingCognitionDomain 兼容大模型输出的裸 code、中文名称以及 "名称(code)" / "code(名称)" 复合写法，
// 返回命中领域的 ID 与其规范 code（自建领域无 code 时为空串）；未命中返回 0 与空串。
func resolveRecordingCognitionDomain(domainMap map[string]*RecordingCognitionDomainView, raw string) (int64, string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, ""
	}
	keys := []string{raw}
	if idx := strings.IndexAny(raw, "(（"); idx > 0 {
		keys = append(keys, strings.TrimSpace(raw[:idx]), strings.Trim(strings.TrimSpace(raw[idx+1:]), ")）"))
	}
	for _, key := range keys {
		if key = normalizeRecordingCognitionDomainKey(key); key == "" {
			continue
		}
		if domain, exists := domainMap[key]; exists {
			return domain.ID, domain.Code
		}
	}
	return 0, ""
}

func (s *RecordingCognitionService) resolveDomainNames(ctx context.Context, userID int64, rows []model.RecordingCognition) map[int64]string {
	result := make(map[int64]string)
	domainSvc := NewRecordingCognitionDomainService(s.eid, userID)
	for _, row := range rows {
		if row.DomainID > 0 {
			if _, exists := result[row.DomainID]; !exists {
				result[row.DomainID] = domainSvc.ResolveDomainName(ctx, row.DomainID)
			}
		}
	}
	return result
}

// CompileRecordingCognitionCandidates 将 Prompt 2 中的候选认知幂等编译为待校准对象。
// 置信度不低于自动确认阈值的候选直接转为正式认知（source_type=auto_confirmed），
// 低于丢弃阈值的候选不落库，其余进入待校准对象等待老板确认；全过程不额外调用 LLM。
func CompileRecordingCognitionCandidates(ctx context.Context, eid, fileID, ownerID int64) (int, error) {
	raw, err := loadMeetingMinutesJSON(eid, fileID)
	if err != nil {
		return 0, err
	}
	minutes, err := parseRecordingMemoryMinutes(raw)
	if err != nil {
		return 0, err
	}
	rows := interfaceSlice(minutes["cognition_candidates"])
	if len(rows) == 0 {
		return 0, nil
	}
	knownSegments := recordingMemoryKnownSegmentIDs(minutes)
	hash := sha256.Sum256([]byte(raw))
	minutesHash := hex.EncodeToString(hash[:])
	count := 0
	seen := make(map[string]int)

	// 查出当前用户所有有效领域映射表（排除已删除领域，包含自建与重写领域，支持 code 与 name 双向匹配）
	domainMap := make(map[string]*RecordingCognitionDomainView)
	domainSvc := NewRecordingCognitionDomainService(eid, ownerID)
	if userDomains, dErr := domainSvc.List(ctx); dErr == nil {
		for _, d := range userDomains {
			if d.Code != "" {
				domainMap[normalizeRecordingCognitionDomainKey(d.Code)] = d
			}
			if d.Name != "" {
				domainMap[normalizeRecordingCognitionDomainKey(d.Name)] = d
			}
		}
	}

	// 置信度阈值：企业配置缺省时回落默认值（0.9 自动确认 / 0.6 丢弃）
	autoConfirmThreshold, discardThreshold := model.DefaultCognitionAutoConfirmThreshold, model.DefaultCognitionDiscardThreshold
	if recordingConfig, cfgErr := model.ValidateOrCreateRecordingConfig(eid); cfgErr == nil && recordingConfig != nil {
		autoConfirmThreshold, discardThreshold = recordingConfig.CognitionConfidence.Effective()
	}
	now := time.Now().UnixMilli()
	dropped := 0
	domainDropped := 0

	err = model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, rawCandidate := range rows {
			candidate, ok := rawCandidate.(map[string]interface{})
			if !ok {
				continue
			}
			title := strings.TrimSpace(stringValue(candidate["title"]))
			statement := strings.TrimSpace(stringValue(candidate["statement"]))
			cognitionType := strings.TrimSpace(stringValue(candidate["cognition_type"]))
			if !validRecordingCognitionType(cognitionType) {
				cognitionType = RecordingCognitionTypePrinciple
			}
			layer := strings.TrimSpace(stringValue(candidate["layer"]))
			if !validRecordingCognitionLayer(layer) {
				// 与 Prompt「不确定时使用 situational」保持一致：兜底回落领域认知并保留领域归属，
				// 避免静默归 core 清空领域（core 不受领域召回，误归全局化）
				layer = recordingCognitionLayerSituational
			}
			segments := memorySourceSegmentIDs(candidate["source_segment_ids"])
			if title == "" || statement == "" || len(segments) == 0 || !allStringsInSet(segments, knownSegments) {
				continue
			}
			domainRaw := strings.TrimSpace(stringValue(candidate["domain_code"]))
			domainID, domainCode := resolveRecordingCognitionDomain(domainMap, domainRaw)
			if layer == recordingCognitionLayerCore {
				// 核心认知跨赛道通用，不归属业务领域
				domainID, domainCode, domainRaw = 0, "", ""
			}
			if layer == recordingCognitionLayerSituational && domainID == 0 {
				// 领域认知必须归属清单内已存在的领域：模型没给领域或给了清单外编码，一律不产出候选。
				// 原文仍保留在会议纪要 JSON 中，老板新建对应领域后重跑编译即可落库。
				domainDropped++
				if domainRaw == "" {
					logger.Infof(ctx, "【老板认知】领域认知未给领域已丢弃 fileID=%d title=%s", fileID, title)
				} else {
					logger.Infof(ctx, "【老板认知】候选领域未匹配已丢弃 fileID=%d raw=%s title=%s", fileID, domainRaw, title)
				}
				continue
			}
			confidence := normalizeCognitionConfidence(candidate["confidence"])
			if confidence < discardThreshold {
				dropped++
				continue
			}
			scope := stringSliceValue(candidate["scope"])
			// 候选表 source_type 只允许 4 个证据来源值；模型给出其他值（含正式表专用的 boss_*/auto_confirmed）一律按 AI 推论处理
			sourceType := strings.TrimSpace(stringValue(candidate["source_type"]))
			if !validRecordingCognitionCandidateSourceType(sourceType) {
				sourceType = recordingCognitionSourceAIInference
			}
			// 并发兜底：编译期间领域可能被删除/屏蔽；不可见则本候选不落库（与"领域认知必须归属已存在领域"一致）
			if domainID > 0 && !recordingCognitionDomainVisibleIn(tx, eid, ownerID, domainID) {
				domainDropped++
				logger.Infof(ctx, "【老板认知】候选领域已不可见已丢弃 fileID=%d domain_id=%d title=%s", fileID, domainID, title)
				continue
			}
			keyInput := fmt.Sprintf("%s:%s:%s:%d:%s", title, statement, cognitionType, domainID, string(marshalStringSlice(scope)))
			seen[keyInput]++
			sourceKey := sha256.Sum256([]byte(fmt.Sprintf("%s:%d", keyInput, seen[keyInput])))
			row := &model.RecordingCognitionCandidate{
				Eid: eid, OwnerID: ownerID, FileID: fileID, MinutesHash: minutesHash,
				SourceKeyHash: hex.EncodeToString(sourceKey[:]), Title: title, Statement: model.LongText(statement),
				CognitionType: cognitionType, Layer: layer, DomainID: domainID, DomainCode: domainCode,
				ScopeJSON: marshalStringSlice(scope), SourceType: sourceType,
				Confidence: confidence, SourceFileID: fileID,
				SourceSegmentIDs: marshalStringSlice(segments), Status: recordingCognitionCandidateStatusPending,
			}
			if err := tx.Where("eid = ? AND owner_id = ? AND file_id = ? AND minutes_hash = ? AND source_key_hash = ?", eid, ownerID, fileID, minutesHash, row.SourceKeyHash).FirstOrCreate(row).Error; err != nil {
				return err
			}
			count++
			// 置信度达标即自动转正；已审核过的候选保留原结论，重复编译不重复转正
			if row.Status == recordingCognitionCandidateStatusPending && confidence >= autoConfirmThreshold {
				cognition := &model.RecordingCognition{
					Eid: eid, OwnerID: ownerID, Title: title, Statement: model.LongText(statement),
					CognitionType: cognitionType, Layer: layer, DomainID: domainID, DomainCode: domainCode,
					ScopeJSON: marshalStringSlice(scope), Status: recordingCognitionStatusConfirmed,
					SourceType: recordingCognitionSourceAutoConfirmed, Confidence: confidence,
					ValidFrom: now, CurrentVersion: 1,
					EvidenceRefsJSON: marshalEvidenceRefs([]RecordingCognitionEvidenceRef{{
						SourceFileID: fileID, SourceSegmentIDs: segments, SourceType: sourceType,
					}}),
					CreatedBy: ownerID, ConfirmedAt: now,
				}
				reason := fmt.Sprintf("自动确认：置信度 %.2f 不低于 %.2f", confidence, autoConfirmThreshold)
				if err := saveConfirmedCandidateTx(tx, row, cognition, recordingCognitionSourceAutoConfirmed, reason, 0, now); err != nil {
					return err
				}
			}
		}
		return nil
	})
	invalidateRecordingCognitionOverviewCache(eid, ownerID)
	if dropped > 0 {
		logger.Infof(ctx, "【老板认知】丢弃低置信度候选 fileID=%d 丢弃=%d 阈值=%.2f", fileID, dropped, discardThreshold)
	}
	if domainDropped > 0 {
		logger.Infof(ctx, "【老板认知】丢弃无对应领域的领域认知候选 fileID=%d 丢弃=%d", fileID, domainDropped)
	}
	return count, err
}

// LoadApplicableRecordingCognition 返回当前用户可用于洞察的已确认认知。
// 核心认知默认加载，情境认知只在与当前领域/事项/实体匹配时按需激活。
func LoadApplicableRecordingCognition(ctx context.Context, eid, userID int64, current *CurrentMeetingContext) (*RecordingCognitionContextPackage, error) {
	svc := NewRecordingCognitionService(eid)
	if err := svc.ensureOwnerAccess(ctx, userID, false); err != nil {
		return nil, err
	}
	var rows []model.RecordingCognition
	if err := model.DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND status IN ? AND (valid_until = ? OR valid_until > ?)", eid, userID, []string{recordingCognitionStatusConfirmed, recordingCognitionStatusConflicted}, 0, time.Now().UnixMilli()).Order("layer asc, confidence desc, updated_time desc, id desc").Limit(100).Find(&rows).Error; err != nil {
		return nil, err
	}
	packageData := &RecordingCognitionContextPackage{Core: []RecordingCognitionContextItem{}, Situational: []RecordingCognitionContextItem{}, Conflicts: []RecordingCognitionContextItem{}, RetrievalReasons: []string{}, OmittedReasons: []string{}}
	entityNames := []string{}
	if current != nil {
		entityNames = current.RecallEntityNames()
	}

	domainNames := svc.resolveDomainNames(ctx, userID, rows)
	applicability := loadRecordingCognitionApplicability(ctx, eid, userID, rows)

	for _, row := range rows {
		if !recordingCognitionUsableInContext(row) {
			continue
		}
		item := recordingCognitionContextItem(row)
		item.DomainName = domainNames[row.DomainID]

		if row.Status == recordingCognitionStatusConflicted {
			if matched, reason := recordingCognitionMatchesContext(row, item.DomainName, applicability[row.ID], current, entityNames); matched {
				item.RetrievalReason = reason
				packageData.Conflicts = append(packageData.Conflicts, item)
				packageData.RetrievalReasons = append(packageData.RetrievalReasons, reason)
			} else {
				packageData.OmittedReasons = append(packageData.OmittedReasons, "conflicted cognition not applicable")
			}
			continue
		}

		// 核心认知：一直加载（Core Fallback）
		if row.Layer == recordingCognitionLayerCore {
			if len(packageData.Core) < 20 {
				item.RetrievalReason = "core_fallback"
				packageData.Core = append(packageData.Core, item)
				packageData.RetrievalReasons = append(packageData.RetrievalReasons, "core_fallback")
			}
			continue
		}

		// 情境/领域认知：按需动态加载
		if matched, reason := recordingCognitionMatchesContext(row, item.DomainName, applicability[row.ID], current, entityNames); matched && len(packageData.Situational) < 20 {
			item.RetrievalReason = reason
			packageData.Situational = append(packageData.Situational, item)
			packageData.RetrievalReasons = append(packageData.RetrievalReasons, reason)
		} else if !matched {
			packageData.OmittedReasons = append(packageData.OmittedReasons, "situational cognition not applicable")
		}
	}
	return packageData, nil
}

func loadRecordingCognitionApplicability(ctx context.Context, eid, userID int64, rows []model.RecordingCognition) map[int64][]model.RecordingCognitionApplicability {
	result := make(map[int64][]model.RecordingCognitionApplicability)
	if len(rows) == 0 || !model.DB.Migrator().HasTable(&model.RecordingCognitionApplicability{}) {
		return result
	}
	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	var rules []model.RecordingCognitionApplicability
	if err := model.DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND cognition_id IN ? AND (valid_until = ? OR valid_until > ?)", eid, userID, ids, 0, time.Now().UnixMilli()).Find(&rules).Error; err != nil {
		return result
	}
	for _, rule := range rules {
		result[rule.CognitionID] = append(result[rule.CognitionID], rule)
	}
	return result
}

func recordingCognitionMatchesContext(row model.RecordingCognition, domainName string, rules []model.RecordingCognitionApplicability, current *CurrentMeetingContext, entityNames []string) (bool, string) {
	// 如果显式配置了适用规则表
	if len(rules) > 0 {
		matchedInclude := false
		for _, rule := range rules {
			if !recordingCognitionApplicabilityRuleMatches(rule, current, entityNames) {
				continue
			}
			if !rule.Include {
				return false, "applicability_exclude"
			}
			matchedInclude = true
		}
		if matchedInclude {
			return true, "applicability_include"
		}
		return false, ""
	}

	// 动态领域按需召回：如果认知属于某个领域，且当前会议讨论包含了该领域
	if current != nil && domainName != "" {
		for _, secDomain := range current.SecondaryDomains {
			if strings.EqualFold(strings.TrimSpace(secDomain), strings.TrimSpace(domainName)) {
				return true, "domain_match"
			}
		}
	}

	// 动态实体/范围召回
	if cognitionMatchesContext(row, entityNames) {
		return true, "scope_match"
	}

	return false, ""
}

func recordingCognitionApplicabilityRuleMatches(rule model.RecordingCognitionApplicability, current *CurrentMeetingContext, entityNames []string) bool {
	if current == nil {
		return false
	}
	if rule.SceneCode != "" && rule.SceneCode != current.PrimaryScene {
		return false
	}
	if rule.DomainCode != "" && !containsRecordingCognitionString(current.SecondaryDomains, rule.DomainCode) {
		return false
	}
	if rule.TopicCode != "" && !containsRecordingCognitionString(current.Topics, rule.TopicCode) {
		return false
	}
	if rule.EntityKey != "" && !containsRecordingCognitionString(entityNames, rule.EntityKey) {
		return false
	}
	return true
}

func containsRecordingCognitionString(values []string, target string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), strings.TrimSpace(target)) {
			return true
		}
	}
	return false
}

func recordingCognitionUsableInContext(row model.RecordingCognition) bool {
	if row.SourceType == recordingCognitionSourceBossAuthored {
		return true
	}
	return len(unmarshalEvidenceRefs(row.EvidenceRefsJSON)) > 0
}

func FormatRecordingCognitionContext(data *RecordingCognitionContextPackage) string {
	if data == nil || (len(data.Core) == 0 && len(data.Situational) == 0 && len(data.Conflicts) == 0) {
		return ""
	}
	encoded, err := json.Marshal(data)
	if err != nil {
		return ""
	}
	return "<confirmed_cognitions>\n" + string(encoded) + "\n</confirmed_cognitions>"
}

// validateRecordingCognitionLayerDomain 校验层级与领域归属的一致性：
// 核心认知（core）跨赛道通用，不得归属业务领域；只有领域认知（situational）才携带 domain_id（0 表示未分类）。
func validateRecordingCognitionLayerDomain(layer string, domainID int64) error {
	if layer == recordingCognitionLayerCore && domainID > 0 {
		return ErrRecordingCognitionLayerDomain
	}
	return nil
}

// escapeRecordingCognitionLikeKeyword 转义 LIKE 通配符（配合 SQL 的 ESCAPE '!'）：
// 用户输入 % / _ / ! 时按字面量匹配，避免 % 命中全部、_ 变成单字符通配。
func escapeRecordingCognitionLikeKeyword(keyword string) string {
	keyword = strings.ReplaceAll(keyword, "!", "!!")
	keyword = strings.ReplaceAll(keyword, "%", "!%")
	keyword = strings.ReplaceAll(keyword, "_", "!_")
	return keyword
}

// validateRecordingCognitionFormalDomain 正式认知（注册表）的领域强约束：领域认知必须归属一个已存在的业务领域。
// 只用于正式写入（创建/修改/候选转正/自动确认）；候选池与外部导入允许 domain_id=0 作为待定草稿。
func validateRecordingCognitionFormalDomain(layer string, domainID int64) error {
	if layer == recordingCognitionLayerSituational && domainID <= 0 {
		return ErrRecordingCognitionDomainRequired
	}
	return nil
}

func validateRecordingCognitionInput(title, statement, cognitionType, layer string) error {
	if title == "" || statement == "" || !validRecordingCognitionType(cognitionType) || !validRecordingCognitionLayer(layer) {
		return ErrRecordingCognitionInvalid
	}
	return nil
}

func validRecordingCognitionType(value string) bool {
	switch value {
	case RecordingCognitionTypePrinciple,
		RecordingCognitionTypePriority,
		RecordingCognitionTypeCriterion,
		RecordingCognitionTypePreference,
		RecordingCognitionTypeBoundary,
		RecordingCognitionTypeAssumption,
		RecordingCognitionTypeTrigger:
		return true
	default:
		return false
	}
}

func recordingCognitionTypes() []string {
	return []string{
		RecordingCognitionTypePrinciple,
		RecordingCognitionTypePriority,
		RecordingCognitionTypeCriterion,
		RecordingCognitionTypePreference,
		RecordingCognitionTypeBoundary,
		RecordingCognitionTypeAssumption,
		RecordingCognitionTypeTrigger,
	}
}

func validRecordingCognitionLayer(value string) bool {
	return value == recordingCognitionLayerCore || value == recordingCognitionLayerSituational
}

// validRecordingCognitionStatus 正式认知只允许 confirmed（生效）/ conflicted（冲突）/ expired（废止）三种状态。
// candidate 与 rejected 只属于候选池表（见 Expire 注释）：候选的待确认态由 recording_cognition_candidates 承载，
// 一旦转正即为 confirmed，不允许再退回正式表的 candidate/rejected。
func validRecordingCognitionStatus(value string) bool {
	switch value {
	case recordingCognitionStatusConfirmed, recordingCognitionStatusConflicted, recordingCognitionStatusExpired:
		return true
	default:
		return false
	}
}

// validRecordingCognitionCandidateStatus 候选池状态：candidate（待校准）/ confirmed（已转正）/ rejected（已驳回）/ ignored（已忽略）。
// 与正式表状态机隔离，避免把正式表的 confirmed/conflicted/expired 混进候选筛选。
func validRecordingCognitionCandidateStatus(value string) bool {
	switch value {
	case recordingCognitionCandidateStatusPending, recordingCognitionCandidateStatusConfirmed,
		recordingCognitionCandidateStatusRejected, recordingCognitionCandidateStatusIgnored:
		return true
	default:
		return false
	}
}

// validRecordingCognitionCandidateSourceType 候选表 source_type 的语义是"证据来源"，只有 4 个值：
// explicit_statement（老板显式陈述）/ behavior_observation（行为观察）/ ai_inference（AI 推论，无显式证据）/ external_import（外部导入）。
// boss_authored / boss_confirmed / auto_confirmed 属于正式表的"来源 + 确认方式"，候选表不使用。
func validRecordingCognitionCandidateSourceType(value string) bool {
	switch value {
	case recordingCognitionSourceExplicit, recordingCognitionSourceBehavior,
		recordingCognitionSourceAIInference, recordingCognitionSourceExternalImport:
		return true
	default:
		return false
	}
}

func validRecordingCognitionSourceType(value string) bool {
	switch value {
	case recordingCognitionSourceBossAuthored, recordingCognitionSourceBossConfirmed, recordingCognitionSourceAutoConfirmed,
		recordingCognitionSourceExplicit, recordingCognitionSourceBehavior, recordingCognitionSourceAIInference,
		recordingCognitionSourceExternalImport:
		return true
	default:
		return false
	}
}

func clampConfidence(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}

// normalizeCognitionConfidence 归一模型给出的置信度：0 到 1 直接采用，大于 1 且不超过 100 视为百分数换算。
// 缺失、非数字或越界一律返回 0，由调用方按低于丢弃阈值处理。
func normalizeCognitionConfidence(value interface{}) float64 {
	raw, ok := value.(float64)
	if !ok || raw <= 0 || raw > 100 {
		return 0
	}
	if raw > 1 {
		raw /= 100
	}
	return clampConfidence(raw)
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

// saveConfirmedCandidateTx 在事务内把候选转正：写入正式认知与首个版本，并将候选置为已确认。
// 人工确认（ReviewCandidate）与阈值自动确认（CompileRecordingCognitionCandidates）共用这段写入。
func saveConfirmedCandidateTx(tx *gorm.DB, candidate *model.RecordingCognitionCandidate, row *model.RecordingCognition, changeType, reason string, actorID, now int64) error {
	if err := tx.Create(row).Error; err != nil {
		return err
	}
	// 并发兜底：转正期间领域可能被删除/屏蔽，落库后复核可见性，不可见则整体回滚
	if row.DomainID > 0 && !recordingCognitionDomainVisibleIn(tx, row.Eid, row.OwnerID, row.DomainID) {
		return ErrRecordingCognitionDomainUnavailable
	}
	// 版本证据沿用 row.EvidenceRefsJSON，不重复构造
	version := cognitionVersionFromInput(row.Eid, row.OwnerID, row, 1, changeType, candidate.SourceFileID, unmarshalStringSlice(candidate.SourceSegmentIDs), nil, actorID, now)
	version.CognitionID = row.ID
	if err := tx.Create(&version).Error; err != nil {
		return err
	}
	// 带 status 条件的部分更新：并发审核已推进状态时整体回滚，避免重复转正出重复正式认知
	result := tx.Model(&model.RecordingCognitionCandidate{}).
		Where("id = ? AND status = ?", candidate.ID, recordingCognitionCandidateStatusPending).
		Updates(map[string]interface{}{
			"status": recordingCognitionCandidateStatusConfirmed, "target_cognition_id": row.ID,
			"review_reason": model.LongText(strings.TrimSpace(reason)),
			"reviewed_by":   actorID, "reviewed_at": now, "updated_time": now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrRecordingCognitionCandidate
	}
	return nil
}

func cognitionVersionFromInput(eid, ownerID int64, row *model.RecordingCognition, version int, changeType string, sourceFileID int64, sourceSegmentIDs []string, evidenceRefs []RecordingCognitionEvidenceRef, actorID, now int64) model.RecordingCognitionVersion {
	evidenceJSON := marshalEvidenceRefs(evidenceRefs)
	if len(evidenceRefs) == 0 && row != nil {
		evidenceJSON = row.EvidenceRefsJSON
	}
	return model.RecordingCognitionVersion{
		Eid:              eid,
		OwnerID:          ownerID,
		CognitionID:      0,
		Version:          version,
		Title:            row.Title,
		Statement:        row.Statement,
		CognitionType:    row.CognitionType,
		Layer:            row.Layer,
		DomainID:         row.DomainID,
		DomainCode:       row.DomainCode,
		ScopeJSON:        row.ScopeJSON,
		ChangeType:       changeType,
		SourceType:       row.SourceType,
		SourceFileID:     sourceFileID,
		SourceSegmentIDs: marshalStringSlice(sourceSegmentIDs),
		EvidenceRefsJSON: evidenceJSON,
		ActorID:          actorID,
		CreatedAtUnix:    now,
	}
}

func recordingCognitionView(row model.RecordingCognition) RecordingCognitionView {
	return recordingCognitionViewWithFileInfos(row, nil)
}

func recordingCognitionViewWithFileNames(row model.RecordingCognition, fileNames map[int64]string) RecordingCognitionView {
	fileInfos := make(map[int64]RecordingSourceFileInfo, len(fileNames))
	for id, name := range fileNames {
		fileInfos[id] = RecordingSourceFileInfo{Name: name}
	}
	return recordingCognitionViewWithFileInfos(row, fileInfos)
}

func recordingCognitionViewWithFileInfos(row model.RecordingCognition, fileInfos map[int64]RecordingSourceFileInfo) RecordingCognitionView {
	refs := withSourceFileInfos(unmarshalEvidenceRefs(row.EvidenceRefsJSON), fileInfos)
	var sourceFileID int64
	var sourceFileName string
	var sourceFileTime int64
	for _, ref := range refs {
		if ref.SourceFileID > 0 {
			sourceFileID = ref.SourceFileID
			sourceFileName = ref.SourceFileName
			sourceFileTime = ref.SourceFileTime
			break
		}
	}
	return RecordingCognitionView{
		ID:             row.ID,
		Eid:            row.Eid,
		OwnerID:        row.OwnerID,
		Title:          row.Title,
		Statement:      string(row.Statement),
		CognitionType:  row.CognitionType,
		Layer:          row.Layer,
		DomainID:       row.DomainID,
		DomainCode:     row.DomainCode,
		Scope:          unmarshalStringSlice(row.ScopeJSON),
		Status:         row.Status,
		SourceType:     row.SourceType,
		Confidence:     row.Confidence,
		SourceFileID:   sourceFileID,
		SourceFileName: sourceFileName,
		SourceFileTime: sourceFileTime,
		ValidFrom:      row.ValidFrom,
		ValidUntil:     row.ValidUntil,
		CurrentVersion: row.CurrentVersion,
		EvidenceRefs:   refs,
		ConflictRefs:   unmarshalStringSlice(row.ConflictRefsJSON),
		ConfirmedBy:    row.ConfirmedBy,
		ConfirmedAt:    row.ConfirmedAt,
		CreatedTime:    row.CreatedTime,
		UpdatedTime:    row.UpdatedTime,
	}
}

func recordingCognitionVersionView(row model.RecordingCognitionVersion) RecordingCognitionVersionView {
	return recordingCognitionVersionViewWithFileInfos(row, nil)
}

func recordingCognitionVersionViewWithFileNames(row model.RecordingCognitionVersion, fileNames map[int64]string) RecordingCognitionVersionView {
	fileInfos := make(map[int64]RecordingSourceFileInfo, len(fileNames))
	for id, name := range fileNames {
		fileInfos[id] = RecordingSourceFileInfo{Name: name}
	}
	return recordingCognitionVersionViewWithFileInfos(row, fileInfos)
}

func recordingCognitionVersionViewWithFileInfos(row model.RecordingCognitionVersion, fileInfos map[int64]RecordingSourceFileInfo) RecordingCognitionVersionView {
	var sourceFileName string
	var sourceFileTime int64
	if info, ok := fileInfos[row.SourceFileID]; ok {
		sourceFileName = info.Name
		sourceFileTime = info.CreatedTime
	}
	return RecordingCognitionVersionView{
		ID:               row.ID,
		CognitionID:      row.CognitionID,
		Version:          row.Version,
		Title:            row.Title,
		Statement:        string(row.Statement),
		CognitionType:    row.CognitionType,
		Layer:            row.Layer,
		DomainID:         row.DomainID,
		Scope:            unmarshalStringSlice(row.ScopeJSON),
		ChangeType:       row.ChangeType,
		SourceType:       row.SourceType,
		SourceFileID:     row.SourceFileID,
		SourceFileName:   sourceFileName,
		SourceFileTime:   sourceFileTime,
		SourceSegmentIDs: unmarshalStringSlice(row.SourceSegmentIDs),
		EvidenceRefs:     withSourceFileInfos(unmarshalEvidenceRefs(row.EvidenceRefsJSON), fileInfos),
		ActorID:          row.ActorID,
		CreatedAtUnix:    row.CreatedAtUnix,
	}
}

func recordingCognitionCandidateView(row model.RecordingCognitionCandidate) RecordingCognitionCandidateView {
	return recordingCognitionCandidateViewWithFileInfos(row, nil)
}

func recordingCognitionCandidateViewWithFileInfos(row model.RecordingCognitionCandidate, fileInfos map[int64]RecordingSourceFileInfo) RecordingCognitionCandidateView {
	return RecordingCognitionCandidateView{
		ID:                row.ID,
		Eid:               row.Eid,
		OwnerID:           row.OwnerID,
		FileID:            row.FileID,
		Title:             row.Title,
		Statement:         string(row.Statement),
		CognitionType:     row.CognitionType,
		Layer:             row.Layer,
		DomainID:          row.DomainID,
		Scope:             unmarshalStringSlice(row.ScopeJSON),
		SourceType:        row.SourceType,
		Confidence:        row.Confidence,
		SourceFileID:      row.SourceFileID,
		SourceFileName:    fileInfos[row.SourceFileID].Name,
		SourceFileTime:    fileInfos[row.SourceFileID].CreatedTime,
		SourceSegmentIDs:  unmarshalStringSlice(row.SourceSegmentIDs),
		Status:            row.Status,
		ReviewReason:      string(row.ReviewReason),
		TargetCognitionID: row.TargetCognitionID,
		ReviewedBy:        row.ReviewedBy,
		ReviewedAt:        row.ReviewedAt,
		CreatedTime:       row.CreatedTime,
		UpdatedTime:       row.UpdatedTime,
	}
}

func recordingCognitionContextItem(row model.RecordingCognition) RecordingCognitionContextItem {
	return RecordingCognitionContextItem{
		ID:            row.ID,
		Title:         row.Title,
		Statement:     string(row.Statement),
		CognitionType: row.CognitionType,
		Layer:         row.Layer,
		DomainID:      row.DomainID,
		Scope:         unmarshalStringSlice(row.ScopeJSON),
		Confidence:    row.Confidence,
		SourceType:    row.SourceType,
		EvidenceRefs:  unmarshalEvidenceRefs(row.EvidenceRefsJSON),
	}
}

func (s *RecordingCognitionService) validateEvidenceRefs(ctx context.Context, userID int64, refs []RecordingCognitionEvidenceRef) error {
	if len(refs) == 0 {
		return nil
	}
	for _, ref := range refs {
		if ref.SourceFileID > 0 {
			if _, err := GetAccessibleRecordingFile(ctx, s.eid, userID, ref.SourceFileID, false); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *RecordingCognitionService) loadExternalEvidence(ctx context.Context, userID int64, rows []model.RecordingCognitionCandidate) (map[int64]model.RecordingCognitionExternalEvidence, error) {
	result := make(map[int64]model.RecordingCognitionExternalEvidence)
	if len(rows) == 0 {
		return result, nil
	}
	candidateIDs := make([]int64, 0, len(rows))
	for _, row := range rows {
		if row.FileID == 0 {
			candidateIDs = append(candidateIDs, row.ID)
		}
	}
	if len(candidateIDs) == 0 {
		return result, nil
	}
	var evidenceRows []model.RecordingCognitionExternalEvidence
	if err := model.DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND candidate_id IN ?", s.eid, userID, candidateIDs).Find(&evidenceRows).Error; err != nil {
		return nil, err
	}
	for _, row := range evidenceRows {
		result[row.CandidateID] = row
	}
	return result, nil
}

type RecordingSourceFileInfo struct {
	Name        string
	CreatedTime int64
}

func (s *RecordingCognitionService) recordingCognitionSourceFileInfos(ctx context.Context, userID int64, fileIDs []int64) map[int64]RecordingSourceFileInfo {
	result := make(map[int64]RecordingSourceFileInfo)
	if len(fileIDs) == 0 {
		return result
	}
	uniqueIDs := make([]int64, 0, len(fileIDs))
	seen := make(map[int64]struct{}, len(fileIDs))
	for _, id := range fileIDs {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		uniqueIDs = append(uniqueIDs, id)
	}
	if len(uniqueIDs) == 0 {
		return result
	}
	var files []model.File
	query := model.DB.WithContext(ctx).Where("id IN ?", uniqueIDs)
	if s.eid > 0 {
		query = query.Where("eid = ?", s.eid)
	}
	if err := query.Find(&files).Error; err != nil {
		return result
	}
	for _, file := range files {
		name := model.ExtractSimpleFileName(strings.TrimPrefix(file.Path, "/"))
		result[file.ID] = RecordingSourceFileInfo{
			Name:        name,
			CreatedTime: file.CreatedTime,
		}
	}
	return result
}

func withSourceFileInfos(refs []RecordingCognitionEvidenceRef, fileInfos map[int64]RecordingSourceFileInfo) []RecordingCognitionEvidenceRef {
	if len(refs) == 0 {
		return []RecordingCognitionEvidenceRef{}
	}
	result := make([]RecordingCognitionEvidenceRef, len(refs))
	for i, ref := range refs {
		result[i] = ref
		if info, ok := fileInfos[ref.SourceFileID]; ok {
			if info.Name != "" {
				result[i].SourceFileName = info.Name
			}
			if info.CreatedTime > 0 {
				result[i].SourceFileTime = info.CreatedTime
				if result[i].ObservedAt == 0 {
					result[i].ObservedAt = info.CreatedTime
				}
			}
		}
	}
	return result
}

func withSourceFileNames(refs []RecordingCognitionEvidenceRef, fileNames map[int64]string) []RecordingCognitionEvidenceRef {
	fileInfos := make(map[int64]RecordingSourceFileInfo, len(fileNames))
	for id, name := range fileNames {
		fileInfos[id] = RecordingSourceFileInfo{Name: name}
	}
	return withSourceFileInfos(refs, fileInfos)
}

func cognitionSourceFileIDs(rows []model.RecordingCognition) []int64 {
	var ids []int64
	for _, row := range rows {
		ids = appendCognitionSourceFileIDs(ids, unmarshalEvidenceRefs(row.EvidenceRefsJSON))
	}
	return ids
}

func candidateSourceFileIDs(rows []model.RecordingCognitionCandidate) []int64 {
	var ids []int64
	for _, row := range rows {
		ids = appendCognitionSourceFileID(ids, row.SourceFileID)
	}
	return ids
}

func appendCognitionSourceFileID(ids []int64, id int64) []int64 {
	if id <= 0 {
		return ids
	}
	for _, existing := range ids {
		if existing == id {
			return ids
		}
	}
	return append(ids, id)
}

func appendCognitionSourceFileIDs(ids []int64, refs []RecordingCognitionEvidenceRef) []int64 {
	for _, ref := range refs {
		ids = appendCognitionSourceFileID(ids, ref.SourceFileID)
	}
	return ids
}

func hashRecordingCognitionCandidateSourceKey(eid, ownerID, fileID int64, externalSource, externalRef, payload string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d:%d:%d:%s:%s:%s", eid, ownerID, fileID, externalSource, externalRef, payload)))
	return hex.EncodeToString(sum[:])
}

func cognitionMatchesContext(row model.RecordingCognition, entityNames []string) bool {
	if len(entityNames) == 0 {
		return false
	}
	scopes := unmarshalStringSlice(row.ScopeJSON)
	for _, scope := range scopes {
		scope = strings.TrimSpace(scope)
		if scope == "" {
			continue
		}
		for _, name := range entityNames {
			if strings.EqualFold(scope, strings.TrimSpace(name)) {
				return true
			}
		}
	}
	return false
}

func marshalStringSlice(values []string) model.LongText {
	clean := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			clean = append(clean, value)
		}
	}
	if len(clean) == 0 {
		return model.LongText("[]")
	}
	encoded, _ := json.Marshal(clean)
	return model.LongText(encoded)
}

func unmarshalStringSlice(raw model.LongText) []string {
	var values []string
	if len(raw) == 0 {
		return []string{}
	}
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return []string{}
	}
	return values
}

func marshalEvidenceRefs(refs []RecordingCognitionEvidenceRef) model.LongText {
	if len(refs) == 0 {
		return model.LongText("[]")
	}
	stored := make([]RecordingCognitionEvidenceRef, len(refs))
	for i, ref := range refs {
		stored[i] = ref
		stored[i].SourceFileName = ""
		stored[i].SourceFileTime = 0
	}
	encoded, _ := json.Marshal(stored)
	return model.LongText(encoded)
}

func unmarshalEvidenceRefs(raw model.LongText) []RecordingCognitionEvidenceRef {
	var refs []RecordingCognitionEvidenceRef
	if len(raw) == 0 {
		return []RecordingCognitionEvidenceRef{}
	}
	if err := json.Unmarshal([]byte(raw), &refs); err != nil {
		return []RecordingCognitionEvidenceRef{}
	}
	return refs
}
