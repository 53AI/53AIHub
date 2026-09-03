package enterpriseinit

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

const (
	defaultWikiPipelineName     = "默认 Wiki 管线"
	defaultWikiStrategyName     = "Wiki 文档"
	defaultWikiStrategyPriority = 9999
)

// EnsureDefaultWikiPipelineForEnterprise 为企业幂等初始化默认 Wiki 管线和无条件兜底策略。
// Wiki 管线只负责 wiki_page_generation，Wiki 分类模板仍由 wiki_categories 管理。
func EnsureDefaultWikiPipelineForEnterprise(ctx context.Context, tx *gorm.DB, eid int64) error {
	_ = ctx
	if tx == nil {
		return errors.New("db is nil")
	}
	if eid <= 0 {
		return errors.New("eid is required")
	}

	profileBytes, err := json.Marshal(map[string]interface{}{
		"steps": []map[string]interface{}{{
			"step_key": "wiki_page_generation",
			"enabled":  true,
			"run_mode": "auto",
			"config":   map[string]interface{}{},
		}},
	})
	if err != nil {
		return err
	}
	profileJSON := string(profileBytes)

	var pipeline model.RagPipelineProfile
	if err := tx.Where("eid = ? AND name = ? AND kind = ?", eid, defaultWikiPipelineName, model.PipelineKindWiki).First(&pipeline).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		pipeline = model.RagPipelineProfile{
			Eid:         eid,
			Kind:        model.PipelineKindWiki,
			Name:        defaultWikiPipelineName,
			Status:      model.RagPipelineStatusEnabled,
			ProfileJSON: profileJSON,
		}
		if err := tx.Create(&pipeline).Error; err != nil {
			return err
		}
	} else if pipeline.ProfileJSON != profileJSON {
		if err := tx.Model(&pipeline).Update("profile_json", profileJSON).Error; err != nil {
			return err
		}
	}

	var strategy model.RagRoutingStrategy
	if err := tx.Where("eid = ? AND name = ? AND kind = ?", eid, defaultWikiStrategyName, model.PipelineKindWiki).First(&strategy).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		strategy = model.RagRoutingStrategy{
			Eid:            eid,
			Kind:           model.PipelineKindWiki,
			Name:           defaultWikiStrategyName,
			Priority:       defaultWikiStrategyPriority,
			Enabled:        true,
			IsDefault:      true,
			PipelineID:     pipeline.ID,
			Logic:          model.RagRoutingLogicAnd,
			ConditionsJSON: "",
		}
		return tx.Create(&strategy).Error
	}

	if strategy.PipelineID != pipeline.ID || !strategy.IsDefault || !strategy.Enabled {
		return tx.Model(&strategy).Updates(map[string]interface{}{
			"pipeline_id": pipeline.ID,
			"is_default":  true,
			"enabled":     true,
		}).Error
	}
	return nil
}
