package skill

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
)

type SkillManager struct {
	skills     map[string]*Skill
	skillsPath string
	mu         sync.RWMutex
	// Tenant skills map: eid -> skillName -> Skill
	tenantSkills map[int64]map[string]*Skill
}

var (
	instance *SkillManager
	once     sync.Once
)

// GetManager returns the singleton instance of SkillManager
func GetManager() *SkillManager {
	once.Do(func() {
		instance = &SkillManager{
			skills:       make(map[string]*Skill),
			tenantSkills: make(map[int64]map[string]*Skill),
			skillsPath:   "data/skills", // Default path
		}
	})
	return instance
}

// Init initializes the manager with a specific path
func (m *SkillManager) Init(path string) error {
	m.skillsPath = path
	return m.Reload()
}

// Reload scans the skills directory and loads all skills
func (m *SkillManager) Reload() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	newSkills := make(map[string]*Skill)
	newTenantSkills := make(map[int64]map[string]*Skill)

	// Ensure directory exists
	if _, err := os.Stat(m.skillsPath); os.IsNotExist(err) {
		if err := os.MkdirAll(m.skillsPath, 0755); err != nil {
			return err
		}
	}

	// 1. Load Global Skills (from "global" subdirectory or root for backward compatibility)
	// We check if "global" directory exists, if so use it, otherwise scan root (legacy)
	globalPath := filepath.Join(m.skillsPath, "global")
	if _, err := os.Stat(globalPath); err == nil {
		m.loadSkillsFromDir(globalPath, newSkills)
	} else {
		// Fallback to root scan (excluding "tenants" directory)
		m.loadSkillsFromDir(m.skillsPath, newSkills)
	}

	// 2. Load Tenant Skills (from "tenants/{eid}" subdirectory)
	tenantsPath := filepath.Join(m.skillsPath, "tenants")
	if _, err := os.Stat(tenantsPath); err == nil {
		entries, err := os.ReadDir(tenantsPath)
		if err == nil {
			for _, entry := range entries {
				if !entry.IsDir() {
					continue
				}
				// Parse EID
				eid, err := strconv.ParseInt(entry.Name(), 10, 64)
				if err != nil {
					continue // Skip non-numeric directories
				}

				tenantSkillMap := make(map[string]*Skill)
				tenantPath := filepath.Join(tenantsPath, entry.Name())
				m.loadSkillsFromDir(tenantPath, tenantSkillMap)

				if len(tenantSkillMap) > 0 {
					newTenantSkills[eid] = tenantSkillMap
				}
			}
		}
	}

	m.skills = newSkills
	m.tenantSkills = newTenantSkills
	return nil
}

// loadSkillsFromDir scans a directory for skills
func (m *SkillManager) loadSkillsFromDir(dirPath string, targetMap map[string]*Skill) {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return
	}

	ctx := context.Background()

	for _, entry := range entries {
		isDir := entry.IsDir()
		if !isDir {
			info, err := entry.Info()
			if err == nil && info.Mode()&os.ModeSymlink != 0 {
				targetPath := filepath.Join(dirPath, entry.Name())
				targetInfo, err := os.Stat(targetPath)
				if err == nil {
					isDir = targetInfo.IsDir()
				}
			}
		}
		if !isDir {
			continue
		}
		// Skip reserved directories if scanning root
		if entry.Name() == "global" || entry.Name() == "tenants" {
			continue
		}

		skillPath := filepath.Join(dirPath, entry.Name())
		mdPath := filepath.Join(skillPath, "SKILL.md")

		contentBytes, err := os.ReadFile(mdPath)
		if err != nil {
			// Not a skill directory or missing SKILL.md, skip silently or log debug
			continue
		}

		skill, warnings, err := ParseSkillMetadataWithValidation(string(contentBytes))
		if err != nil {
			logger.Warnf(ctx, "Failed to parse skill %s: %v", entry.Name(), err)
			continue
		}

		// Log validation warnings
		hasValidationError := false
		for _, w := range warnings {
			if w.Level == "error" {
				logger.Errorf(ctx, "【技能加载】Skill '%s' validation error: field=%s, message=%s", entry.Name(), w.Field, w.Message)
				hasValidationError = true
			} else {
				logger.Warnf(ctx, "【技能加载】Skill '%s' validation warning: field=%s, message=%s", entry.Name(), w.Field, w.Message)
			}
		}
		if hasValidationError {
			logger.Errorf(ctx, "【技能加载】Skip skill '%s' due to validation errors", entry.Name())
			continue
		}

		skill.Path = skillPath
		// Fallback name if not in frontmatter
		if skill.Name == "" {
			skill.Name = entry.Name()
		}

		targetMap[skill.Name] = skill
		logger.Infof(ctx, "【技能加载】Loaded skill: %s from %s", skill.Name, dirPath)
	}
}

// ListSkills returns all loaded skills for a specific tenant (EID)
// Merges Global Skills + Tenant Skills (Tenant skills override Global ones by name)
func (m *SkillManager) ListSkills(eid int64) []*Skill {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// Use a map to handle overrides
	skillMap := make(map[string]*Skill)

	// 1. Add Global Skills
	for name, s := range m.skills {
		skillMap[name] = s
	}

	// 2. Add/Override with Tenant Skills
	if tenantMap, ok := m.tenantSkills[eid]; ok {
		for name, s := range tenantMap {
			skillMap[name] = s
		}
	}

	// Convert to list
	list := make([]*Skill, 0, len(skillMap))
	for _, s := range skillMap {
		list = append(list, s)
	}
	return list
}

func (m *SkillManager) ListRunnableSkills(eid int64, scope RunScope) ([]*Skill, map[string][]string) {
	allSkills := m.ListSkills(eid)
	runnable := make([]*Skill, 0, len(allSkills))
	blocked := make(map[string][]string)
	for _, s := range allSkills {
		allowed, reasons := EvaluateSkillGating(s, scope)
		if allowed {
			runnable = append(runnable, s)
			continue
		}
		blocked[s.Name] = reasons
	}
	return runnable, blocked
}

func (m *SkillManager) CreateRunSnapshot(eid int64, runID string, scope RunScope) *SkillSnapshot {
	skills, blocked := m.ListRunnableSkills(eid, scope)
	return &SkillSnapshot{
		RunID:     runID,
		CreatedAt: nowFunc(),
		Skills:    skills,
		Blocked:   blocked,
		ScopeSummary: map[string]interface{}{
			"env_count":    len(scope.Env),
			"config_count": len(scope.Config),
			"run_env_vars": len(scope.EnvVars),
			"cwd":          scope.CWD,
			"secret_keys":  mapKeys(scope.Secrets),
			"run_id":       runID,
			"eid":          eid,
		},
	}
}

func (m *SkillManager) GetSkillWithScope(eid int64, name string, scope RunScope) *Skill {
	s := m.GetSkill(eid, name)
	if s == nil {
		return nil
	}
	allowed, reasons := EvaluateSkillGating(s, scope)
	if allowed {
		return s
	}
	logger.Warnf(context.Background(), "【技能准入】skill blocked by gating: skill=%s, reasons=%v", name, reasons)
	return nil
}

// GetSkill returns a specific skill by name for a tenant.
// Tenant skills take priority; global skills are the fallback.
func (m *SkillManager) GetSkill(eid int64, name string) *Skill {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if s := m.getTenantSkillLocked(eid, name); s != nil {
		return s
	}
	return m.getGlobalSkillLocked(name)
}

func (m *SkillManager) getTenantSkillLocked(eid int64, name string) *Skill {
	if tenantMap, ok := m.tenantSkills[eid]; ok {
		if s, ok := tenantMap[name]; ok {
			return s
		}
	}
	return nil
}

func (m *SkillManager) getGlobalSkillLocked(name string) *Skill {
	if s, ok := m.skills[name]; ok {
		return s
	}
	return nil
}

// MatchSkills returns all matching skills sorted by score (highest first)
// Use this for multi-skill composition scenarios
func (m *SkillManager) MatchSkills(eid int64, query string) []*SkillMatchResult {
	return m.MatchSkillsWithScope(eid, query, RunScope{})
}

func (m *SkillManager) MatchSkillsWithScope(eid int64, query string, scope RunScope) []*SkillMatchResult {
	m.mu.RLock()
	defer m.mu.RUnlock()

	query = strings.ToLower(query)

	// Improved scoring: Token-based overlap
	queryTokens := tokenize(query)

	// Get merged list of skills for this tenant
	skillMap := make(map[string]*Skill)
	for name, s := range m.skills {
		skillMap[name] = s
	}
	if tenantMap, ok := m.tenantSkills[eid]; ok {
		for name, s := range tenantMap {
			skillMap[name] = s
		}
	}

	var results []*SkillMatchResult

	for _, skill := range skillMap {
		if scope.Env != nil || scope.Config != nil || scope.BinCache != nil {
			allowed, reasons := EvaluateSkillGating(skill, scope)
			if !allowed {
				logger.Debugf(context.Background(), "【技能准入】skip skill in match: skill=%s, reasons=%v", skill.Name, reasons)
				continue
			}
		}

		score := 0.0

		// 1. Name Match (High weight)
		// Split name by hyphen or space
		nameTokens := tokenize(strings.ReplaceAll(skill.Name, "-", " "))
		nameOverlap := countOverlap(queryTokens, nameTokens)
		if len(nameTokens) > 0 {
			// If all name tokens match, high score
			matchRatio := float64(nameOverlap) / float64(len(nameTokens))
			score += matchRatio * 0.8
		}

		// 2. Description Match (Medium weight)
		if skill.Description != "" {
			descTokens := tokenize(skill.Description)
			descOverlap := countOverlap(queryTokens, descTokens)
			if len(descTokens) > 0 {
				// We don't expect user to type entire description, just keywords
				// So we score based on how many query tokens are found in description?
				// Or how many description tokens are found in query?
				// Let's use: (matches / query_length) * weight
				// This implies "how much of the user's intent is covered by this description"
				if len(queryTokens) > 0 {
					matchRatio := float64(descOverlap) / float64(len(queryTokens))
					score += matchRatio * 0.4
				}
			}
		}

		// Boost for exact keyword "weather" in "sample-weather" if query is just "weather"
		if strings.Contains(strings.ToLower(skill.Name), query) {
			score += 0.2
		}

		// Filter by threshold and collect results
		if score > 0.3 {
			results = append(results, &SkillMatchResult{Skill: skill, Score: score})
		}
	}

	// Sort by score descending
	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})

	return results
}

// MatchSkill returns the best matching skill (backward compatible)
// Delegates to MatchSkills and returns first result
func (m *SkillManager) MatchSkill(eid int64, query string) *SkillMatchResult {
	results := m.MatchSkills(eid, query)
	if len(results) > 0 {
		return results[0]
	}
	return nil
}

func (m *SkillManager) MatchSkillWithScope(eid int64, query string, scope RunScope) *SkillMatchResult {
	results := m.MatchSkillsWithScope(eid, query, scope)
	if len(results) > 0 {
		return results[0]
	}
	return nil
}

var nowFunc = func() time.Time { return time.Now() }

func mapKeys(input map[string]string) []string {
	if len(input) == 0 {
		return nil
	}
	keys := make([]string, 0, len(input))
	for k := range input {
		if strings.TrimSpace(k) == "" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func tokenize(text string) []string {
	text = strings.ToLower(text)
	f := func(c rune) bool {
		return !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))
	}
	return strings.FieldsFunc(text, f)
}

func countOverlap(s1, s2 []string) int {
	count := 0
	seen := make(map[string]bool)
	for _, w := range s1 {
		seen[w] = true
	}
	for _, w := range s2 {
		if seen[w] {
			count++
			// prevent double counting? usually fine for simple sets
		}
	}
	return count
}
