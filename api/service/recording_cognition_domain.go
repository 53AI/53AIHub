package service

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// recordingCognitionDomainSeedMu 串行化预置领域种子写入：List 属于读路径，首次并发请求可能同时触发种子写入。
// 进程内互斥可避免同一实例写重复预置行；多实例并发仍依赖唯一约束（跟进项）。
var recordingCognitionDomainSeedMu sync.Mutex

var (
	ErrRecordingCognitionDomainNotFound      = errors.New("recording cognition domain not found")
	ErrRecordingCognitionDomainInvalid       = errors.New("recording cognition domain input is invalid")
	ErrRecordingCognitionDomainDuplicateName = errors.New("recording cognition domain duplicate name")
	// ErrRecordingCognitionDomainNotEmpty 领域下仍有已确认或待确认认知——产品要求认知删完才能删除分类。
	ErrRecordingCognitionDomainNotEmpty = errors.New("recording cognition domain still has cognitions")
)

type DefaultDomainSeed struct {
	Code        string
	Name        string
	Description string
	Logo        string
	Sort        int
}

// defaultRecordingCognitionDomainSeeds 严格按照已有系统与提示词中的 11 个既定业务领域定义。
var defaultRecordingCognitionDomainSeeds = []DefaultDomainSeed{
	{Code: "strategy", Name: "战略决策", Description: "企业愿景、战略方向与重大决策原则", Logo: "strategy", Sort: 10},
	{Code: "growth", Name: "业务增长", Description: "业务扩张路径、流量获取模式与规模化复制", Logo: "growth", Sort: 20},
	{Code: "market", Name: "市场拓展", Description: "市场定位、公域表达与获客投放", Logo: "market", Sort: 30},
	{Code: "brand", Name: "品牌声量", Description: "品牌定位、心智占位与行业影响力", Logo: "brand", Sort: 40},
	{Code: "sales", Name: "销售业务", Description: "销售策略、赢单逻辑与商务谈判准则", Logo: "sales", Sort: 50},
	{Code: "product", Name: "产品规划", Description: "产品定位、功能规划与用户体验导向", Logo: "product", Sort: 60},
	{Code: "finance", Name: "财务与资金", Description: "现金流安全、成本控制与预算审批", Logo: "finance", Sort: 70},
	{Code: "organization", Name: "组织与管理", Description: "组织阵型、授权机制与协同效率", Logo: "organization", Sort: 80},
	{Code: "talent", Name: "人才团队", Description: "人才画像、用人标准与文化契合度", Logo: "talent", Sort: 90},
	{Code: "channel", Name: "渠道合作", Description: "生态伙伴、渠道代理与分成机制", Logo: "channel", Sort: 100},
	{Code: "research_and_development", Name: "技术研发", Description: "技术选型、架构演进与研发质量", Logo: "rd", Sort: 110},
}

type RecordingCognitionDomainView struct {
	ID              int64  `json:"id"`
	Eid             int64  `json:"eid"`
	OwnerID         int64  `json:"owner_id"`
	ParentID        int64  `json:"parent_id,omitempty"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	Logo            string `json:"logo"`
	Code            string `json:"code,omitempty"`
	Sort            int    `json:"sort"`
	IsDefault       bool   `json:"is_default"`
	IsOverridden    bool   `json:"is_overridden"`
	CognitionCount  int64  `json:"cognition_count"`
	PendingCount    int64  `json:"pending_count"`
	LastUpdatedTime int64  `json:"last_updated_time"`
}

type CreateDomainInput struct {
	Name        string
	Description string
	Logo        string
	Sort        int
}

type UpdateDomainInput struct {
	Name        *string
	Description *string
	Logo        *string
	Sort        *int
}

type RecordingCognitionDomainService struct {
	eid    int64
	userID int64
}

func NewRecordingCognitionDomainService(eid, userID int64) *RecordingCognitionDomainService {
	return &RecordingCognitionDomainService{eid: eid, userID: userID}
}

// EnsureDefaultDomainSeeds 极简确保 11 个预置领域种子存在。
// 若已存在（绝大多数在线请求），执行一次 COUNT 查询（< 0.5ms）立即返回，绝不执行全表扫描与存量自愈。
func EnsureDefaultDomainSeeds(ctx context.Context, db *gorm.DB) error {
	if db == nil {
		db = model.DB
	}
	if db == nil {
		return nil
	}
	recordingCognitionDomainSeedMu.Lock()
	defer recordingCognitionDomainSeedMu.Unlock()
	var count int64
	if err := db.WithContext(ctx).Model(&model.RecordingCognitionDomain{}).
		Where("eid = 0 AND owner_id = 0 AND is_deleted = false").Count(&count).Error; err == nil && count >= int64(len(defaultRecordingCognitionDomainSeeds)) {
		return nil
	}
	for _, seed := range defaultRecordingCognitionDomainSeeds {
		item := model.RecordingCognitionDomain{
			Eid:         0,
			OwnerID:     0,
			ParentID:    0,
			Name:        seed.Name,
			Description: seed.Description,
			Logo:        seed.Logo,
			Code:        seed.Code,
			Sort:        seed.Sort,
			IsDeleted:   false,
		}
		_ = db.WithContext(ctx).Where("eid = 0 AND owner_id = 0 AND code = ?", seed.Code).FirstOrCreate(&item).Error
	}
	return nil
}

// WarnDuplicateRecordingCognitionDomainSeeds 检测预置领域（eid=0, owner_id=0）是否出现重复 code 并告警。
// 刻意不自动清理：重复行可能已被存量认知引用，需人工确认后再处理（配合部署巡检）。
func WarnDuplicateRecordingCognitionDomainSeeds(ctx context.Context, db *gorm.DB) {
	if db == nil {
		db = model.DB
	}
	if db == nil {
		return
	}
	var dups []struct {
		Code string `gorm:"column:code"`
		Cnt  int64  `gorm:"column:cnt"`
	}
	if err := db.WithContext(ctx).Model(&model.RecordingCognitionDomain{}).
		Select("code, count(*) as cnt").
		Where("eid = 0 AND owner_id = 0").
		Group("code").
		Having("count(*) > 1").
		Scan(&dups).Error; err != nil || len(dups) == 0 {
		return
	}
	for _, dup := range dups {
		logger.SysWarnf("【老板认知】预置领域出现重复种子 code=%s count=%d，请人工清理（不会自动删除，可能被存量认知引用）", dup.Code, dup.Cnt)
	}
}

// InitDefaultDomainsAndHealHistoryData 幂等初始化公共预置领域（11 个），清理历史脏种子，并自愈存量认知数据。
// 注：存量历史认知自愈是一次性数据迁移操作，已在上线期执行完成，日常 List 查询中绝不调用此函数。
func InitDefaultDomainsAndHealHistoryData(ctx context.Context, db *gorm.DB) error {
	if db == nil {
		db = model.DB
	}
	if db == nil {
		return nil
	}

	validCodes := make([]string, 0, len(defaultRecordingCognitionDomainSeeds))
	for _, s := range defaultRecordingCognitionDomainSeeds {
		validCodes = append(validCodes, s.Code)
	}

	// 1. 清理非规范的历史系统预置种子（eid=0, owner_id=0 且不在 11 个种子中）
	_ = db.WithContext(ctx).Where("eid = 0 AND owner_id = 0 AND code NOT IN ?", validCodes).
		Delete(&model.RecordingCognitionDomain{}).Error

	// 2. 初始化或对齐 11 个规范系统默认领域（eid = 0, owner_id = 0）
	var existingDefaults []model.RecordingCognitionDomain
	if err := db.WithContext(ctx).Where("eid = 0 AND owner_id = 0").Find(&existingDefaults).Error; err != nil {
		return err
	}
	existMap := make(map[string]int64, len(existingDefaults))
	for _, d := range existingDefaults {
		if d.Code != "" {
			existMap[d.Code] = d.ID
		}
	}

	for _, seed := range defaultRecordingCognitionDomainSeeds {
		if domainID, exists := existMap[seed.Code]; !exists {
			item := model.RecordingCognitionDomain{
				Eid:         0,
				OwnerID:     0,
				ParentID:    0,
				Name:        seed.Name,
				Description: seed.Description,
				Logo:        seed.Logo,
				Code:        seed.Code,
				Sort:        seed.Sort,
				IsDeleted:   false,
			}
			if err := db.WithContext(ctx).Create(&item).Error; err != nil {
				return err
			}
			existMap[seed.Code] = item.ID
		} else {
			// 对齐名称与描述
			_ = db.WithContext(ctx).Model(&model.RecordingCognitionDomain{}).
				Where("id = ?", domainID).
				Updates(map[string]interface{}{
					"name":        seed.Name,
					"description": seed.Description,
					"logo":        seed.Logo,
					"sort":        seed.Sort,
				}).Error
		}
	}

	// 3. 存量历史数据幂等回填 domain_id，并把 "名称(code)"、中文名称等历史写法归一为规范 code
	domainLookup := recordingCognitionDomainLookupFromSeeds(existMap)

	for _, table := range []interface{}{
		&model.RecordingCognition{}, &model.RecordingCognitionVersion{}, &model.RecordingCognitionCandidate{},
	} {
		if !db.Migrator().HasTable(table) {
			continue
		}
		rawValues := make([]string, 0)
		if err := db.WithContext(ctx).Model(table).
			Where("domain_code <> ''").Distinct().Pluck("domain_code", &rawValues).Error; err != nil {
			continue
		}
		for _, raw := range rawValues {
			domainID, code := resolveRecordingCognitionDomain(domainLookup, raw)
			if domainID <= 0 {
				continue
			}
			updates := map[string]interface{}{"domain_id": domainID}
			if code != "" && code != raw {
				updates["domain_code"] = code
			}
			_ = db.WithContext(ctx).Model(table).Where("domain_code = ?", raw).Updates(updates).Error
		}
	}

	// 4. 存量认知老类型平滑归一
	_ = db.WithContext(ctx).Model(&model.RecordingCognition{}).
		Where("cognition_type = ?", "red_line").
		Update("cognition_type", "boundary").Error
	_ = db.WithContext(ctx).Model(&model.RecordingCognition{}).
		Where("cognition_type IN ?", []string{"risk_preference", "decision_style"}).
		Update("cognition_type", "preference").Error

	// 5. 历史数据修复：产品要求"其下认知删完才能删除分类"，历史上"其下仍有认知却被删除/屏蔽"的分类需要恢复，
	//    否则这些认知将永久无法在分类下查看；其下无认知的历史删除保持不变。
	restored, err := restoreDeletedDomainsWithCognitions(ctx, db)
	if err != nil {
		return err
	}
	if restored > 0 {
		logger.SysLogf("【认知领域自愈】历史非法删除的分类已恢复 count=%d", restored)
	}

	return nil
}

// restoreDeletedDomainsWithCognitions 恢复"其下仍有认知却被删除/屏蔽"的历史分类。
// 系统预置领域的删除是个人遮罩/重写行，直接删除该行以恢复预置领域原貌；自建领域撤销软删。
func restoreDeletedDomainsWithCognitions(ctx context.Context, db *gorm.DB) (int, error) {
	restores, err := recordingCognitionDomainHealRestores(ctx, db)
	if err != nil {
		return 0, err
	}
	for index, item := range restores {
		if item.IsSystemPreset {
			if err := db.WithContext(ctx).Delete(&model.RecordingCognitionDomain{}, item.RowID).Error; err != nil {
				return index, err
			}
			continue
		}
		if err := db.WithContext(ctx).Model(&model.RecordingCognitionDomain{}).
			Where("id = ?", item.RowID).Update("is_deleted", false).Error; err != nil {
			return index, err
		}
	}
	return len(restores), nil
}

// recordingCognitionDomainHealRestores 列出"其下仍有已确认/待确认认知却被删除或遮罩"的历史分类（写库与预览共用）。
func recordingCognitionDomainHealRestores(ctx context.Context, db *gorm.DB) ([]RecordingCognitionDomainHealRestore, error) {
	if !db.Migrator().HasTable(&model.RecordingCognitionDomain{}) {
		return nil, nil
	}
	var deleted []model.RecordingCognitionDomain
	if err := db.WithContext(ctx).Where("is_deleted = ?", true).Order("id").Find(&deleted).Error; err != nil {
		return nil, err
	}
	restores := make([]RecordingCognitionDomainHealRestore, 0, len(deleted))
	for _, row := range deleted {
		// 个人遮罩/重写行的认知记在所属系统预置领域 ID 上，自建领域的认知记在自身 ID 上。
		domainID := row.ID
		if row.ParentID > 0 {
			domainID = row.ParentID
		}
		confirmed, pending, err := countDomainCognitions(ctx, db, row.Eid, row.OwnerID, domainID)
		if err != nil {
			return nil, err
		}
		if confirmed+pending == 0 {
			continue
		}
		restores = append(restores, RecordingCognitionDomainHealRestore{
			DomainID: domainID, RowID: row.ID, Name: row.Name, IsSystemPreset: row.ParentID > 0,
			ConfirmedCognitions: confirmed, PendingCognitions: pending,
		})
	}
	sort.Slice(restores, func(i, j int) bool { return restores[i].DomainID < restores[j].DomainID })
	return restores, nil
}

// countDomainCognitions 返回指定归属下某领域的已确认认知数与待确认认知数（正式表与候选表的 candidate 同一状态值）。
// 只统计领域认知（layer=situational）：核心认知必须 domain_id=0，这里按 layer 过滤是防御脏数据，
// 保证删除守卫与领域列表卡片（domainCognitionStats/domainCognitionPendingStats）口径完全一致。
func countDomainCognitions(ctx context.Context, db *gorm.DB, eid, ownerID, domainID int64) (int64, int64, error) {
	var confirmed int64
	if db.Migrator().HasTable(&model.RecordingCognition{}) {
		if err := db.WithContext(ctx).Model(&model.RecordingCognition{}).
			Where("eid = ? AND owner_id = ? AND domain_id = ? AND status = ? AND layer = ?", eid, ownerID, domainID, recordingCognitionStatusConfirmed, recordingCognitionLayerSituational).
			Count(&confirmed).Error; err != nil {
			return 0, 0, err
		}
	}
	var pending int64
	for _, table := range []interface{}{&model.RecordingCognition{}, &model.RecordingCognitionCandidate{}} {
		if !db.Migrator().HasTable(table) {
			continue
		}
		var cnt int64
		if err := db.WithContext(ctx).Model(table).
			Where("eid = ? AND owner_id = ? AND domain_id = ? AND status = ? AND layer = ?", eid, ownerID, domainID, recordingCognitionStatusCandidate, recordingCognitionLayerSituational).
			Count(&cnt).Error; err != nil {
			return 0, 0, err
		}
		pending += cnt
	}
	return confirmed, pending, nil
}

// recordingCognitionDomainLookupFromSeeds 按预置种子构建 "编码/名称 -> 领域" 匹配表。
// 尚未落库的种子 ID 记 0：写库路径会跳过（自愈先建种子），预览据此判断"可归一但需先建种子"。
func recordingCognitionDomainLookupFromSeeds(existMap map[string]int64) map[string]*RecordingCognitionDomainView {
	lookup := make(map[string]*RecordingCognitionDomainView, len(defaultRecordingCognitionDomainSeeds)*2)
	for _, seed := range defaultRecordingCognitionDomainSeeds {
		view := &RecordingCognitionDomainView{ID: existMap[seed.Code], Code: seed.Code, Name: seed.Name}
		lookup[normalizeRecordingCognitionDomainKey(seed.Code)] = view
		lookup[normalizeRecordingCognitionDomainKey(seed.Name)] = view
	}
	return lookup
}

// RecordingCognitionDomainHealResolution 描述一种历史领域写法将被归一到的目标领域与影响行数。
type RecordingCognitionDomainHealResolution struct {
	RawValue      string `json:"raw_value"`
	DomainID      int64  `json:"domain_id"`
	DomainCode    string `json:"domain_code"`
	CognitionRows int64  `json:"cognition_rows"`
	VersionRows   int64  `json:"version_rows"`
	CandidateRows int64  `json:"candidate_rows"`
}

// TotalRows 返回该写法在三张表中的总影响行数。
func (r RecordingCognitionDomainHealResolution) TotalRows() int64 {
	return r.CognitionRows + r.VersionRows + r.CandidateRows
}

// RecordingCognitionDomainHealPreview 是领域自愈的只读预览（dry_run），不写库。
type RecordingCognitionDomainHealPreview struct {
	LegacySeedRows   int64                                    `json:"legacy_seed_rows"`
	MissingSeedCodes []string                                 `json:"missing_seed_codes"`
	LegacyTypeRows   int64                                    `json:"legacy_type_rows"`
	Resolutions      []RecordingCognitionDomainHealResolution `json:"resolutions"`
	UnresolvedCodes  []string                                 `json:"unresolved_codes"`
	Restores         []RecordingCognitionDomainHealRestore    `json:"restores"`
}

// RecordingCognitionDomainHealRestore 描述一个"其下仍有认知却被删除/遮罩"的历史分类将如何恢复。
type RecordingCognitionDomainHealRestore struct {
	DomainID            int64  `json:"domain_id"`
	RowID               int64  `json:"row_id"`
	Name                string `json:"name"`
	IsSystemPreset      bool   `json:"is_system_preset"`
	ConfirmedCognitions int64  `json:"confirmed_cognitions"`
	PendingCognitions   int64  `json:"pending_cognitions"`
}

// PreviewRecordingCognitionDomainHeal 只读统计领域自愈的实际影响面（历史写法 -> 目标领域与行数），供 dry_run 使用。
func PreviewRecordingCognitionDomainHeal(ctx context.Context, db *gorm.DB) (*RecordingCognitionDomainHealPreview, error) {
	if db == nil {
		db = model.DB
	}
	if db == nil {
		return nil, ErrRecordingCognitionDomainInvalid
	}

	validCodes := make([]string, 0, len(defaultRecordingCognitionDomainSeeds))
	for _, seed := range defaultRecordingCognitionDomainSeeds {
		validCodes = append(validCodes, seed.Code)
	}

	preview := &RecordingCognitionDomainHealPreview{}
	if err := db.WithContext(ctx).Model(&model.RecordingCognitionDomain{}).
		Where("eid = 0 AND owner_id = 0 AND code NOT IN ?", validCodes).Count(&preview.LegacySeedRows).Error; err != nil {
		return nil, err
	}

	var existing []model.RecordingCognitionDomain
	if err := db.WithContext(ctx).Where("eid = 0 AND owner_id = 0").Find(&existing).Error; err != nil {
		return nil, err
	}
	existMap := make(map[string]int64, len(existing))
	for _, item := range existing {
		if item.Code != "" {
			existMap[item.Code] = item.ID
		}
	}
	domainLookup := recordingCognitionDomainLookupFromSeeds(existMap)
	for _, seed := range defaultRecordingCognitionDomainSeeds {
		if _, exists := existMap[seed.Code]; !exists {
			preview.MissingSeedCodes = append(preview.MissingSeedCodes, seed.Code)
		}
	}

	rawCounts := make(map[string][3]int64)
	for index, table := range []interface{}{
		&model.RecordingCognition{}, &model.RecordingCognitionVersion{}, &model.RecordingCognitionCandidate{},
	} {
		if !db.Migrator().HasTable(table) {
			continue
		}
		rows := make([]struct {
			DomainCode string
			Cnt        int64
		}, 0)
		if err := db.WithContext(ctx).Model(table).Select("domain_code, count(*) as cnt").
			Where("domain_code <> ''").Group("domain_code").Scan(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			counts := rawCounts[row.DomainCode]
			counts[index] = row.Cnt
			rawCounts[row.DomainCode] = counts
		}
	}

	for raw, counts := range rawCounts {
		domainID, code := resolveRecordingCognitionDomain(domainLookup, raw)
		if domainID <= 0 && code == "" {
			preview.UnresolvedCodes = append(preview.UnresolvedCodes, raw)
			continue
		}
		preview.Resolutions = append(preview.Resolutions, RecordingCognitionDomainHealResolution{
			RawValue: raw, DomainID: domainID, DomainCode: code,
			CognitionRows: counts[0], VersionRows: counts[1], CandidateRows: counts[2],
		})
	}
	sort.Slice(preview.Resolutions, func(i, j int) bool {
		if preview.Resolutions[i].TotalRows() != preview.Resolutions[j].TotalRows() {
			return preview.Resolutions[i].TotalRows() > preview.Resolutions[j].TotalRows()
		}
		return preview.Resolutions[i].RawValue < preview.Resolutions[j].RawValue
	})
	sort.Strings(preview.UnresolvedCodes)

	if db.Migrator().HasTable(&model.RecordingCognition{}) {
		var legacyTypeRows int64
		if err := db.WithContext(ctx).Model(&model.RecordingCognition{}).
			Where("cognition_type IN ?", []string{"red_line", "risk_preference", "decision_style"}).
			Count(&legacyTypeRows).Error; err != nil {
			return nil, err
		}
		preview.LegacyTypeRows = legacyTypeRows
	}
	restores, err := recordingCognitionDomainHealRestores(ctx, db)
	if err != nil {
		return nil, err
	}
	preview.Restores = restores
	return preview, nil
}

// domainCognitionPendingStats 统计当前用户在每个领域下的待确认认知数量（正式表与候选表的 candidate 状态）。
// 只统计领域认知（layer=situational），与 domainCognitionStats 和删除守卫同口径。
func (s *RecordingCognitionDomainService) domainCognitionPendingStats(ctx context.Context) map[int64]int64 {
	counts := make(map[int64]int64)
	type statRow struct {
		DomainID int64 `gorm:"column:domain_id"`
		Cnt      int64 `gorm:"column:cnt"`
	}
	for _, table := range []interface{}{&model.RecordingCognition{}, &model.RecordingCognitionCandidate{}} {
		var rows []statRow
		if err := model.DB.WithContext(ctx).Model(table).
			Select("domain_id, count(*) as cnt").
			Where("eid = ? AND owner_id = ? AND status = ? AND layer = ?", s.eid, s.userID, recordingCognitionStatusCandidate, recordingCognitionLayerSituational).
			Group("domain_id").Scan(&rows).Error; err != nil {
			continue
		}
		for _, row := range rows {
			if row.DomainID > 0 {
				counts[row.DomainID] += row.Cnt
			}
		}
	}
	return counts
}

// domainCognitionStats 统计当前用户在每个领域下已确认认知的数量与最后更新时间。
// 只统计领域认知（layer=situational）：核心认知不计入任何领域，按 layer 过滤可防脏数据导致卡片虚高。
func (s *RecordingCognitionDomainService) domainCognitionStats(ctx context.Context) (map[int64]int64, map[int64]int64) {
	counts := make(map[int64]int64)
	lastUpdates := make(map[int64]int64)
	type statRow struct {
		DomainID        int64 `gorm:"column:domain_id"`
		Cnt             int64 `gorm:"column:cnt"`
		LastUpdatedTime int64 `gorm:"column:last_updated_time"`
	}
	var rows []statRow
	if err := model.DB.WithContext(ctx).Model(&model.RecordingCognition{}).
		Select("domain_id, count(*) as cnt, max(updated_time) as last_updated_time").
		Where("eid = ? AND owner_id = ? AND status = ? AND layer = ?", s.eid, s.userID, recordingCognitionStatusConfirmed, recordingCognitionLayerSituational).
		Group("domain_id").
		Scan(&rows).Error; err != nil {
		return counts, lastUpdates
	}
	for _, row := range rows {
		if row.DomainID <= 0 {
			continue
		}
		counts[row.DomainID] = row.Cnt
		lastUpdates[row.DomainID] = row.LastUpdatedTime
	}
	return counts, lastUpdates
}

// List 返回当前用户的领域列表（系统预置 + 个人重写 + 个人自建，过滤被个人屏蔽的项），
// 并附带每个领域下的已确认认知数量（cognition_count）与最后更新时间（last_updated_time）。
func (s *RecordingCognitionDomainService) List(ctx context.Context) ([]*RecordingCognitionDomainView, error) {
	_ = EnsureDefaultDomainSeeds(ctx, model.DB)

	var allRows []model.RecordingCognitionDomain
	if err := model.DB.WithContext(ctx).
		Where("eid = ? AND owner_id = ?", s.eid, s.userID).
		Or("eid = ? AND owner_id = ?", 0, 0).
		Order("id desc").
		Find(&allRows).Error; err != nil {
		return nil, err
	}

	systemItems := make(map[int64]model.RecordingCognitionDomain)
	systemOrder := make([]int64, 0)
	personalOverrides := make(map[int64]model.RecordingCognitionDomain)
	personalCustoms := make([]model.RecordingCognitionDomain, 0)

	for _, row := range allRows {
		if row.Eid == 0 && row.OwnerID == 0 {
			systemItems[row.ID] = row
			systemOrder = append(systemOrder, row.ID)
		} else if row.ParentID > 0 {
			personalOverrides[row.ParentID] = row
		} else {
			if !row.IsDeleted {
				personalCustoms = append(personalCustoms, row)
			}
		}
	}

	views := make([]*RecordingCognitionDomainView, 0, len(systemOrder)+len(personalCustoms))
	for _, sysID := range systemOrder {
		sysItem := systemItems[sysID]
		if override, ok := personalOverrides[sysID]; ok {
			if override.IsDeleted {
				continue
			}
			views = append(views, &RecordingCognitionDomainView{
				ID:           sysItem.ID,
				Eid:          override.Eid,
				OwnerID:      override.OwnerID,
				ParentID:     sysID,
				Name:         override.Name,
				Description:  override.Description,
				Logo:         override.Logo,
				Code:         sysItem.Code,
				Sort:         override.Sort,
				IsDefault:    true,
				IsOverridden: true,
			})
			continue
		}
		views = append(views, &RecordingCognitionDomainView{
			ID:           sysItem.ID,
			Eid:          s.eid,
			OwnerID:      s.userID,
			ParentID:     0,
			Name:         sysItem.Name,
			Description:  sysItem.Description,
			Logo:         sysItem.Logo,
			Code:         sysItem.Code,
			Sort:         sysItem.Sort,
			IsDefault:    true,
			IsOverridden: false,
		})
	}

	for _, custom := range personalCustoms {
		views = append(views, &RecordingCognitionDomainView{
			ID:           custom.ID,
			Eid:          custom.Eid,
			OwnerID:      custom.OwnerID,
			ParentID:     0,
			Name:         custom.Name,
			Description:  custom.Description,
			Logo:         custom.Logo,
			Code:         "",
			Sort:         custom.Sort,
			IsDefault:    false,
			IsOverridden: false,
		})
	}

	// 统计认知指标（已确认数量 + 待确认数量，后者用于前端判断分类能否删除）
	counts, lastUpdates := s.domainCognitionStats(ctx)
	pendingCounts := s.domainCognitionPendingStats(ctx)
	for _, v := range views {
		v.CognitionCount = counts[v.ID]
		v.PendingCount = pendingCounts[v.ID]
		v.LastUpdatedTime = lastUpdates[v.ID]
	}

	// 列表排序：按 id 倒序——最近创建/自建的领域排在最前，系统预置领域随后。
	sort.SliceStable(views, func(i, j int) bool {
		return views[i].ID > views[j].ID
	})

	return views, nil
}

func (s *RecordingCognitionDomainService) Create(ctx context.Context, input CreateDomainInput) (*RecordingCognitionDomainView, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || len([]rune(name)) > 20 {
		return nil, ErrRecordingCognitionDomainInvalid
	}
	desc := strings.TrimSpace(input.Description)
	if len([]rune(desc)) > 100 {
		return nil, ErrRecordingCognitionDomainInvalid
	}

	// 检查重名：不能与当前用户可见领域列表重名
	existing, err := s.List(ctx)
	if err != nil {
		return nil, err
	}
	for _, v := range existing {
		if strings.EqualFold(strings.TrimSpace(v.Name), name) {
			return nil, ErrRecordingCognitionDomainDuplicateName
		}
	}

	row := &model.RecordingCognitionDomain{
		Eid:         s.eid,
		OwnerID:     s.userID,
		ParentID:    0,
		Name:        name,
		Description: desc,
		Logo:        strings.TrimSpace(input.Logo),
		Sort:        input.Sort,
		IsDeleted:   false,
	}
	if err := model.DB.WithContext(ctx).Create(row).Error; err != nil {
		return nil, err
	}
	invalidateRecordingCognitionOverviewCache(s.eid, s.userID)

	return &RecordingCognitionDomainView{
		ID:           row.ID,
		Eid:          row.Eid,
		OwnerID:      row.OwnerID,
		Name:         row.Name,
		Description:  row.Description,
		Logo:         row.Logo,
		Sort:         row.Sort,
		IsDefault:    false,
		IsOverridden: false,
	}, nil
}

func (s *RecordingCognitionDomainService) Update(ctx context.Context, domainID int64, input UpdateDomainInput) (*RecordingCognitionDomainView, error) {
	if domainID <= 0 {
		return nil, ErrRecordingCognitionDomainNotFound
	}
	if input.Name != nil {
		trimmed := strings.TrimSpace(*input.Name)
		if trimmed == "" || len([]rune(trimmed)) > 20 {
			return nil, ErrRecordingCognitionDomainInvalid
		}
		*input.Name = trimmed

		// 检查重名：不能与当前除自身外的可见领域重名
		existing, err := s.List(ctx)
		if err != nil {
			return nil, err
		}
		for _, v := range existing {
			if v.ID != domainID && strings.EqualFold(strings.TrimSpace(v.Name), trimmed) {
				return nil, ErrRecordingCognitionDomainDuplicateName
			}
		}
	}
	if input.Description != nil {
		trimmed := strings.TrimSpace(*input.Description)
		if len([]rune(trimmed)) > 100 {
			return nil, ErrRecordingCognitionDomainInvalid
		}
		*input.Description = trimmed
	}

	var target model.RecordingCognitionDomain
	if err := model.DB.WithContext(ctx).Where("id = ?", domainID).First(&target).Error; err != nil {
		return nil, ErrRecordingCognitionDomainNotFound
	}

	if target.Eid == 0 && target.OwnerID == 0 {
		var override model.RecordingCognitionDomain
		err := model.DB.WithContext(ctx).
			Where("eid = ? AND owner_id = ? AND parent_id = ?", s.eid, s.userID, target.ID).
			First(&override).Error

		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}

		if errors.Is(err, gorm.ErrRecordNotFound) {
			name := target.Name
			if input.Name != nil {
				name = *input.Name
			}
			desc := target.Description
			if input.Description != nil {
				desc = *input.Description
			}
			logo := target.Logo
			if input.Logo != nil {
				logo = *input.Logo
			}
			sort := target.Sort
			if input.Sort != nil {
				sort = *input.Sort
			}

			newOverride := model.RecordingCognitionDomain{
				Eid:         s.eid,
				OwnerID:     s.userID,
				ParentID:    target.ID,
				Name:        name,
				Description: desc,
				Logo:        logo,
				Sort:        sort,
				IsDeleted:   false,
			}
			if err := model.DB.WithContext(ctx).Create(&newOverride).Error; err != nil {
				return nil, err
			}
			invalidateRecordingCognitionOverviewCache(s.eid, s.userID)
			return &RecordingCognitionDomainView{
				ID:           target.ID,
				Eid:          s.eid,
				OwnerID:      s.userID,
				ParentID:     target.ID,
				Name:         newOverride.Name,
				Description:  newOverride.Description,
				Logo:         newOverride.Logo,
				Code:         target.Code,
				Sort:         newOverride.Sort,
				IsDefault:    true,
				IsOverridden: true,
			}, nil
		}

		updates := make(map[string]interface{})
		if input.Name != nil {
			updates["name"] = *input.Name
		}
		if input.Description != nil {
			updates["description"] = *input.Description
		}
		if input.Logo != nil {
			updates["logo"] = *input.Logo
		}
		if input.Sort != nil {
			updates["sort"] = *input.Sort
		}
		updates["is_deleted"] = false

		if err := model.DB.WithContext(ctx).Model(&override).Updates(updates).Error; err != nil {
			return nil, err
		}

		_ = model.DB.WithContext(ctx).Where("id = ?", override.ID).First(&override).Error
		invalidateRecordingCognitionOverviewCache(s.eid, s.userID)
		return &RecordingCognitionDomainView{
			ID:           target.ID,
			Eid:          s.eid,
			OwnerID:      s.userID,
			ParentID:     target.ID,
			Name:         override.Name,
			Description:  override.Description,
			Logo:         override.Logo,
			Code:         target.Code,
			Sort:         override.Sort,
			IsDefault:    true,
			IsOverridden: true,
		}, nil
	}

	if target.Eid != s.eid || target.OwnerID != s.userID {
		return nil, ErrRecordingCognitionDomainNotFound
	}

	updates := make(map[string]interface{})
	if input.Name != nil {
		updates["name"] = *input.Name
	}
	if input.Description != nil {
		updates["description"] = *input.Description
	}
	if input.Logo != nil {
		updates["logo"] = *input.Logo
	}
	if input.Sort != nil {
		updates["sort"] = *input.Sort
	}

	if len(updates) > 0 {
		if err := model.DB.WithContext(ctx).Model(&target).Updates(updates).Error; err != nil {
			return nil, err
		}
	}

	_ = model.DB.WithContext(ctx).Where("id = ?", target.ID).First(&target).Error
	invalidateRecordingCognitionOverviewCache(s.eid, s.userID)
	return &RecordingCognitionDomainView{
		ID:           target.ID,
		Eid:          target.Eid,
		OwnerID:      target.OwnerID,
		Name:         target.Name,
		Description:  target.Description,
		Logo:         target.Logo,
		Sort:         target.Sort,
		IsDefault:    false,
		IsOverridden: false,
	}, nil
}

// Delete 删除（个人自建）或屏蔽（系统预置，写个人掩码）领域。
// 守卫、屏蔽/删除与残留清理在同一事务内完成，避免并发写入造成"领域不可见但认知仍在"的悬挂数据。
func (s *RecordingCognitionDomainService) Delete(ctx context.Context, domainID int64) error {
	if domainID <= 0 {
		return ErrRecordingCognitionDomainNotFound
	}

	var target model.RecordingCognitionDomain
	if err := model.DB.WithContext(ctx).Where("id = ?", domainID).First(&target).Error; err != nil {
		return ErrRecordingCognitionDomainNotFound
	}
	isSystem := target.Eid == 0 && target.OwnerID == 0
	if !isSystem && (target.Eid != s.eid || target.OwnerID != s.userID) {
		return ErrRecordingCognitionDomainNotFound
	}

	if err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.ensureDomainDeletable(ctx, tx, target.ID); err != nil {
			return err
		}
		if isSystem {
			var override model.RecordingCognitionDomain
			findErr := tx.Where("eid = ? AND owner_id = ? AND parent_id = ?", s.eid, s.userID, target.ID).
				First(&override).Error
			if findErr != nil && !errors.Is(findErr, gorm.ErrRecordNotFound) {
				return findErr
			}
			if errors.Is(findErr, gorm.ErrRecordNotFound) {
				mask := model.RecordingCognitionDomain{
					Eid:         s.eid,
					OwnerID:     s.userID,
					ParentID:    target.ID,
					Name:        target.Name,
					Description: target.Description,
					Logo:        target.Logo,
					Sort:        target.Sort,
					IsDeleted:   true,
				}
				if err := tx.Create(&mask).Error; err != nil {
					return err
				}
			} else if err := tx.Model(&override).Update("is_deleted", true).Error; err != nil {
				return err
			}
		} else if err := tx.Model(&target).Update("is_deleted", true).Error; err != nil {
			return err
		}
		// 并发兜底：守卫通过后仍可能有新认知/候选落库，同事务内一并删除，保证删除后无残留
		return purgeRecordingCognitionByDomain(tx, s.eid, s.userID, target.ID)
	}); err != nil {
		return err
	}
	invalidateRecordingCognitionOverviewCache(s.eid, s.userID)
	return nil
}

// recordingCognitionDomainVisibleIn 判断领域在指定用户视角下是否可见（与 List 的可见性规则一致）：
// 系统预置项被个人屏蔽（parent_id 掩码 is_deleted=1）、或个人自建/重写项已删除、或行不存在时不可见。
func recordingCognitionDomainVisibleIn(db *gorm.DB, eid, ownerID, domainID int64) bool {
	if domainID <= 0 {
		return false
	}
	var target model.RecordingCognitionDomain
	if err := db.Where("id = ?", domainID).First(&target).Error; err != nil {
		return false
	}
	if target.Eid == 0 && target.OwnerID == 0 {
		var maskCount int64
		if err := db.Model(&model.RecordingCognitionDomain{}).
			Where("eid = ? AND owner_id = ? AND parent_id = ? AND is_deleted = 1", eid, ownerID, target.ID).
			Count(&maskCount).Error; err != nil {
			return false
		}
		return maskCount == 0
	}
	return target.Eid == eid && target.OwnerID == ownerID && !target.IsDeleted
}

// purgeRecordingCognitionByDomain 硬删除指向该领域的正式认知与候选（含审计版本、外部证据），
// 并清空候选对已删认知的引用。用于删除/屏蔽领域时的并发残留清理。
func purgeRecordingCognitionByDomain(tx *gorm.DB, eid, ownerID, domainID int64) error {
	if domainID <= 0 {
		return nil
	}
	// 表按环境可能未建（升级/裁剪部署），逐表判断存在性，避免清理动作本身报错
	hasCognition := tx.Migrator().HasTable(&model.RecordingCognition{})
	hasVersion := tx.Migrator().HasTable(&model.RecordingCognitionVersion{})
	hasCandidate := tx.Migrator().HasTable(&model.RecordingCognitionCandidate{})
	hasEvidence := tx.Migrator().HasTable(&model.RecordingCognitionExternalEvidence{})

	var cognitionIDs []int64
	if hasCognition {
		if err := tx.Model(&model.RecordingCognition{}).
			Where("eid = ? AND owner_id = ? AND domain_id = ?", eid, ownerID, domainID).
			Pluck("id", &cognitionIDs).Error; err != nil {
			return err
		}
	}
	if len(cognitionIDs) > 0 {
		if hasVersion {
			if err := tx.Where("eid = ? AND owner_id = ? AND cognition_id IN ?", eid, ownerID, cognitionIDs).
				Delete(&model.RecordingCognitionVersion{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("eid = ? AND owner_id = ? AND id IN ?", eid, ownerID, cognitionIDs).
			Delete(&model.RecordingCognition{}).Error; err != nil {
			return err
		}
		if hasCandidate {
			if err := tx.Model(&model.RecordingCognitionCandidate{}).
				Where("eid = ? AND owner_id = ? AND target_cognition_id IN ?", eid, ownerID, cognitionIDs).
				Update("target_cognition_id", 0).Error; err != nil {
				return err
			}
		}
	}
	var candidateIDs []int64
	if hasCandidate {
		if err := tx.Model(&model.RecordingCognitionCandidate{}).
			Where("eid = ? AND owner_id = ? AND domain_id = ?", eid, ownerID, domainID).
			Pluck("id", &candidateIDs).Error; err != nil {
			return err
		}
	}
	if len(candidateIDs) > 0 {
		if hasEvidence {
			if err := tx.Where("candidate_id IN ?", candidateIDs).
				Delete(&model.RecordingCognitionExternalEvidence{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("eid = ? AND owner_id = ? AND id IN ?", eid, ownerID, candidateIDs).
			Delete(&model.RecordingCognitionCandidate{}).Error; err != nil {
			return err
		}
	}
	if len(cognitionIDs) > 0 || len(candidateIDs) > 0 {
		logger.SysWarnf("【认知领域】删除领域 domain_id=%d 时清理残留：认知=%d 候选=%d（eid=%d owner_id=%d）",
			domainID, len(cognitionIDs), len(candidateIDs), eid, ownerID)
	}
	return nil
}

// ensureDomainDeletable 校验领域下的已确认与待确认认知都已删除——产品要求认知删完才能删除分类。
// db 传事务句柄，保证守卫与后续屏蔽/删除同事务。
func (s *RecordingCognitionDomainService) ensureDomainDeletable(ctx context.Context, db *gorm.DB, domainID int64) error {
	confirmed, pending, err := countDomainCognitions(ctx, db, s.eid, s.userID, domainID)
	if err != nil {
		return err
	}
	if confirmed > 0 || pending > 0 {
		return ErrRecordingCognitionDomainNotEmpty
	}
	return nil
}

func (s *RecordingCognitionDomainService) Reset(ctx context.Context, domainID int64) error {
	if domainID <= 0 {
		return ErrRecordingCognitionDomainNotFound
	}

	var target model.RecordingCognitionDomain
	if err := model.DB.WithContext(ctx).Where("id = ?", domainID).First(&target).Error; err != nil {
		return ErrRecordingCognitionDomainNotFound
	}

	if target.Eid != 0 || target.OwnerID != 0 {
		return ErrRecordingCognitionDomainInvalid
	}

	if err := model.DB.WithContext(ctx).
		Where("eid = ? AND owner_id = ? AND parent_id = ?", s.eid, s.userID, target.ID).
		Delete(&model.RecordingCognitionDomain{}).Error; err != nil {
		return err
	}
	invalidateRecordingCognitionOverviewCache(s.eid, s.userID)
	return nil
}

func (s *RecordingCognitionDomainService) ResolveDomainName(ctx context.Context, domainID int64) string {
	if domainID <= 0 {
		return ""
	}

	var override model.RecordingCognitionDomain
	if err := model.DB.WithContext(ctx).
		Where("eid = ? AND owner_id = ? AND parent_id = ?", s.eid, s.userID, domainID).
		First(&override).Error; err == nil {
		if override.IsDeleted {
			return ""
		}
		return override.Name
	}

	var target model.RecordingCognitionDomain
	if err := model.DB.WithContext(ctx).Where("id = ?", domainID).First(&target).Error; err != nil {
		return ""
	}
	if target.IsDeleted {
		return ""
	}
	return target.Name
}

// ---- 存量认知领域归属修复 ----

// RecordingCognitionLegacyRepairPreview 是存量认知领域归属修复的统计（dry_run 预览与执行结果共用）。
type RecordingCognitionLegacyRepairPreview struct {
	ReboundByCode     int64    `json:"rebound_by_code"`     // 按领域编码回填的行数
	ReboundByName     int64    `json:"rebound_by_name"`     // 按领域名称（含个人自建领域）回填的行数
	CoreDomainCleared int64    `json:"core_domain_cleared"` // 核心认知清空领域归属的行数
	CodeAligned       int64    `json:"code_aligned"`        // domain_code 与领域表对齐的行数
	UnmatchedRows     int64    `json:"unmatched_rows"`      // 匹配不到领域的存量行（有编码或悬挂引用）
	UncategorizedRows int64    `json:"uncategorized_rows"`  // 真"未分类"（无任何历史编码）的行数
	DeletedCognitions int64    `json:"deleted_cognitions"`  // 实际删除的认知数（含其审计版本）
	DeletedCandidates int64    `json:"deleted_candidates"`  // 实际删除的候选数
	UnresolvedValues  []string `json:"unresolved_values"`   // 无法映射的历史写法（去重排序）
}

// RecordingCognitionLegacyRepairOptions 是存量修复的硬删开关，两个开关都默认关闭：
// 关闭时只做"回填领域 / 清空核心领域 / 对齐编码"，不删除任何存量行。
type RecordingCognitionLegacyRepairOptions struct {
	DeleteUnmatched     bool // 硬删"匹配不到领域"的存量认知与候选（有编码但无法映射、悬挂引用）
	DeleteUncategorized bool // 硬删真"未分类"（无任何历史编码）的领域认知与候选
}

// PreviewRecordingCognitionLegacyRepair 只读预览存量领域归属修复的影响面，不写库。
func PreviewRecordingCognitionLegacyRepair(ctx context.Context, db *gorm.DB) (*RecordingCognitionLegacyRepairPreview, error) {
	return repairRecordingCognitionLegacyDomain(ctx, db, false, RecordingCognitionLegacyRepairOptions{})
}

// RepairRecordingCognitionLegacyDomain 执行存量认知领域归属修复（幂等）：
//  1. 领域认知缺失 domain_id 但有历史编码/名称的，按当前用户可见领域（系统预置 + 个人自建/重写）匹配回填；
//  2. domain_id 指向不可见/不存在领域的悬挂行，按历史编码重新匹配；
//  3. 核心认知（core）不归属业务领域，一律清空其 domain_id/domain_code；
//  4. domain_code 与领域表不一致的按领域表对齐，保证前端展示与领域统计口径一致；
//  5. opts 的硬删开关为 true 时删除对应存量行（认知连同审计版本一并删除，并清空指向它们的候选引用）：
//     DeleteUnmatched 清理"匹配不到领域"的行，DeleteUncategorized 清理真"未分类"的行；两个开关默认关闭。
//
// 版本表作为审计快照不单独删除。
func RepairRecordingCognitionLegacyDomain(ctx context.Context, db *gorm.DB, opts RecordingCognitionLegacyRepairOptions) (*RecordingCognitionLegacyRepairPreview, error) {
	return repairRecordingCognitionLegacyDomain(ctx, db, true, opts)
}

type recordingCognitionRepairScope struct {
	Eid     int64 `gorm:"column:eid"`
	OwnerID int64 `gorm:"column:owner_id"`
}

func repairRecordingCognitionLegacyDomain(ctx context.Context, db *gorm.DB, apply bool, opts RecordingCognitionLegacyRepairOptions) (*RecordingCognitionLegacyRepairPreview, error) {
	preview := &RecordingCognitionLegacyRepairPreview{UnresolvedValues: []string{}}
	if db == nil {
		db = model.DB
	}
	if db == nil || !db.Migrator().HasTable(&model.RecordingCognition{}) {
		return preview, nil
	}

	// 匹配面必须包含系统预置领域：执行前先补齐预置种子（幂等），
	// 否则预置尚未落库时会把可回填的行误判为"匹配不到"，开启硬删开关即造成误删。
	if apply {
		if err := EnsureDefaultDomainSeeds(ctx, db); err != nil {
			return nil, err
		}
	}

	// 按 (eid, owner) 逐个用户修复：领域可见范围与个人自建领域都按用户隔离
	scopes := make([]recordingCognitionRepairScope, 0)
	seenScopes := make(map[recordingCognitionRepairScope]struct{})
	for _, table := range []interface{}{&model.RecordingCognition{}, &model.RecordingCognitionCandidate{}} {
		if !db.Migrator().HasTable(table) {
			continue
		}
		var rows []recordingCognitionRepairScope
		if err := db.WithContext(ctx).Model(table).Distinct("eid", "owner_id").Scan(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			if _, exists := seenScopes[row]; exists {
				continue
			}
			seenScopes[row] = struct{}{}
			scopes = append(scopes, row)
		}
	}

	tables := []struct {
		model     interface{}
		deletable bool
	}{
		{&model.RecordingCognition{}, true},
		{&model.RecordingCognitionVersion{}, false},
		{&model.RecordingCognitionCandidate{}, true},
	}
	unresolved := make(map[string]struct{})
	pendingDeleteCognitionIDs := make([]int64, 0)
	pendingDeleteCandidateIDs := make([]int64, 0)

	for _, scope := range scopes {
		// 预览不建种子：把尚未落库的预置领域按"可回填（ID 待种子落库后确定）"纳入匹配面，保证预览与执行同口径
		lookup, codeByID := recordingCognitionLegacyLookup(ctx, db, scope.Eid, scope.OwnerID, !apply)
		for _, item := range tables {
			if !db.Migrator().HasTable(item.model) {
				continue
			}
			var rows []struct {
				ID         int64  `gorm:"column:id"`
				Layer      string `gorm:"column:layer"`
				DomainID   int64  `gorm:"column:domain_id"`
				DomainCode string `gorm:"column:domain_code"`
			}
			if err := db.WithContext(ctx).Model(item.model).
				Select("id, layer, domain_id, domain_code").
				Where("eid = ? AND owner_id = ?", scope.Eid, scope.OwnerID).
				Find(&rows).Error; err != nil {
				return nil, err
			}
			update := func(id int64, values map[string]interface{}) error {
				if !apply {
					return nil
				}
				return db.WithContext(ctx).Model(item.model).Where("id = ?", id).Updates(values).Error
			}
			drop := func(id int64, enabled bool) {
				if !apply || !enabled || !item.deletable {
					return
				}
				if _, isCandidate := item.model.(*model.RecordingCognitionCandidate); isCandidate {
					pendingDeleteCandidateIDs = append(pendingDeleteCandidateIDs, id)
					return
				}
				pendingDeleteCognitionIDs = append(pendingDeleteCognitionIDs, id)
			}

			for _, row := range rows {
				if row.Layer == recordingCognitionLayerCore {
					// 核心认知跨赛道通用，不归属任何业务领域
					if row.DomainID == 0 && row.DomainCode == "" {
						continue
					}
					preview.CoreDomainCleared++
					if err := update(row.ID, map[string]interface{}{"domain_id": 0, "domain_code": ""}); err != nil {
						return nil, err
					}
					continue
				}
				if row.DomainID > 0 {
					if code, exists := codeByID[row.DomainID]; exists {
						if code != row.DomainCode {
							preview.CodeAligned++
							if err := update(row.ID, map[string]interface{}{"domain_code": code}); err != nil {
								return nil, err
							}
						}
						continue
					}
					// 悬挂引用：按历史编码重新匹配，匹配不到才算失败
					if domainID, code := resolveRecordingCognitionDomain(lookup, row.DomainCode); domainID > 0 || code != "" {
						preview.countLegacyRebound(row.DomainCode, code)
						if domainID > 0 {
							if err := update(row.ID, map[string]interface{}{"domain_id": domainID, "domain_code": code}); err != nil {
								return nil, err
							}
						}
						continue
					}
					preview.UnmatchedRows++
					if raw := strings.TrimSpace(row.DomainCode); raw != "" {
						unresolved[raw] = struct{}{}
					}
					drop(row.ID, opts.DeleteUnmatched)
					continue
				}
				raw := strings.TrimSpace(row.DomainCode)
				if raw == "" {
					// 真"未分类"：不是匹配失败，默认保留；显式开启开关时一并硬删
					preview.UncategorizedRows++
					drop(row.ID, opts.DeleteUncategorized)
					continue
				}
				domainID, code := resolveRecordingCognitionDomain(lookup, raw)
				if domainID <= 0 && code == "" {
					preview.UnmatchedRows++
					unresolved[raw] = struct{}{}
					drop(row.ID, opts.DeleteUnmatched)
					continue
				}
				preview.countLegacyRebound(raw, code)
				if domainID > 0 {
					if err := update(row.ID, map[string]interface{}{"domain_id": domainID, "domain_code": code}); err != nil {
						return nil, err
					}
				}
			}
		}
	}

	for value := range unresolved {
		preview.UnresolvedValues = append(preview.UnresolvedValues, value)
	}
	sort.Strings(preview.UnresolvedValues)

	if apply && len(pendingDeleteCognitionIDs) > 0 {
		// 硬删：先清空指向被删认知的引用，再连同审计版本一起删除，避免悬挂引用
		if db.Migrator().HasTable(&model.RecordingCognitionCandidate{}) {
			if err := db.WithContext(ctx).Model(&model.RecordingCognitionCandidate{}).
				Where("target_cognition_id IN ?", pendingDeleteCognitionIDs).
				Update("target_cognition_id", 0).Error; err != nil {
				return nil, err
			}
		}
		if db.Migrator().HasTable(&model.RecordingCognitionVersion{}) {
			if err := db.WithContext(ctx).Where("cognition_id IN ?", pendingDeleteCognitionIDs).
				Delete(&model.RecordingCognitionVersion{}).Error; err != nil {
				return nil, err
			}
		}
		if err := db.WithContext(ctx).Where("id IN ?", pendingDeleteCognitionIDs).
			Delete(&model.RecordingCognition{}).Error; err != nil {
			return nil, err
		}
		preview.DeletedCognitions = int64(len(pendingDeleteCognitionIDs))
	}
	if apply && len(pendingDeleteCandidateIDs) > 0 {
		if err := db.WithContext(ctx).Where("id IN ?", pendingDeleteCandidateIDs).
			Delete(&model.RecordingCognitionCandidate{}).Error; err != nil {
			return nil, err
		}
		preview.DeletedCandidates = int64(len(pendingDeleteCandidateIDs))
	}

	return preview, nil
}

// countLegacyRebound 区分"按领域编码命中"与"按领域名称命中"（含个人自建领域名称）。
func (p *RecordingCognitionLegacyRepairPreview) countLegacyRebound(raw, canonicalCode string) {
	if canonicalCode != "" && normalizeRecordingCognitionDomainKey(raw) == normalizeRecordingCognitionDomainKey(canonicalCode) {
		p.ReboundByCode++
		return
	}
	p.ReboundByName++
}

// recordingCognitionLegacyLookup 构建某个用户可见领域的"编码/名称 -> 领域"匹配表与 domain_id -> 规范 code 映射。
// 可见范围与领域列表一致：系统预置（eid=0, owner_id=0）+ 个人自建/重写（同 eid 与 owner），排除已删除；
// 个人重写/遮罩行的认知记在所属系统预置领域 ID 上，因此按父领域归位。
func recordingCognitionLegacyLookup(ctx context.Context, db *gorm.DB, eid, ownerID int64, includeMissingSeeds bool) (map[string]*RecordingCognitionDomainView, map[int64]string) {
	lookup := make(map[string]*RecordingCognitionDomainView)
	codeByID := make(map[int64]string)
	if !db.Migrator().HasTable(&model.RecordingCognitionDomain{}) {
		return lookup, codeByID
	}
	var rows []model.RecordingCognitionDomain
	if err := db.WithContext(ctx).
		Where("(eid = ? AND owner_id = ?) OR (eid = ? AND owner_id = ?)", eid, ownerID, 0, 0).
		Find(&rows).Error; err != nil {
		return lookup, codeByID
	}
	presetCode := make(map[int64]string)
	existingSeedCodes := make(map[string]struct{})
	for _, row := range rows {
		if row.Eid == 0 && row.OwnerID == 0 {
			presetCode[row.ID] = row.Code
			codeByID[row.ID] = row.Code
			existingSeedCodes[row.Code] = struct{}{}
		}
	}
	if includeMissingSeeds {
		// 预置定义里尚未落库的领域：ID 记 0 表示"可归位、待种子落库"，写库路径会跳过
		for _, seed := range defaultRecordingCognitionDomainSeeds {
			if _, exists := existingSeedCodes[seed.Code]; exists {
				continue
			}
			view := &RecordingCognitionDomainView{ID: 0, Code: seed.Code, Name: seed.Name}
			lookup[normalizeRecordingCognitionDomainKey(seed.Code)] = view
			lookup[normalizeRecordingCognitionDomainKey(seed.Name)] = view
		}
	}
	for _, row := range rows {
		if row.IsDeleted {
			continue
		}
		targetID, code := row.ID, row.Code
		if row.ParentID > 0 {
			targetID, code = row.ParentID, presetCode[row.ParentID]
		}
		if targetID <= 0 {
			continue
		}
		view := &RecordingCognitionDomainView{ID: targetID, Code: code, Name: row.Name}
		if code != "" {
			lookup[normalizeRecordingCognitionDomainKey(code)] = view
		}
		lookup[normalizeRecordingCognitionDomainKey(row.Name)] = view
		codeByID[targetID] = code
	}
	return lookup, codeByID
}
