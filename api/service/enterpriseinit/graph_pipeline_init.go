package enterpriseinit

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// 默认图谱管线与兜底策略的固定命名/优先级
const (
	defaultGraphPipelineName     = "默认图谱管线"
	defaultGraphStrategyName     = "通用文档"
	legacyGraphStrategyName      = "默认图谱策略" // 旧默认图谱策略名，重命名迁移兼容
	defaultGraphStrategyPriority = 9999
)

// EnsureDefaultGraphPipelineForEnterprise 为企业初始化默认图谱管线（kind=graph）与无条件兜底策略（幂等）。
// 调用时机：
//   - 企业某空间首次开启图谱开关（enable_knowledge_graph=true）时，在保存开关的同一事务内调用；
//   - 存量已开启图谱的企业由 kg_pipeline_split 迁移逐个调用。
//
// 默认图谱管线不绑定固定模板（graph_template_id 为空）：执行时先智能匹配选模板，匹配不到则智能生成模板兜底；
// SAAS 场景仍会保证种子模板存在（作为智能匹配候选），但 profile 不写入模板。
// config 不再写入 enable_smart_match 参数（无模板自动智能匹配）。
func EnsureDefaultGraphPipelineForEnterprise(ctx context.Context, tx *gorm.DB, eid int64) error {
	if tx == nil {
		return errors.New("db is nil")
	}
	if eid <= 0 {
		return errors.New("eid is required")
	}

	// SAAS 场景保证种子图谱模板存在（作为智能匹配候选），但默认管线不绑定模板
	if config.IS_SAAS {
		if _, err := ensureSeededGraphTemplates(tx, eid); err != nil {
			return err
		}
	}

	steps := []map[string]interface{}{
		{
			"step_key": "graph_generation",
			"config": map[string]interface{}{
				"enabled":                 true,
				"graph_template_id":       "",
				"enable_smart_generation": true,
			},
		},
	}
	profileBytes, err := json.Marshal(map[string]interface{}{"steps": steps})
	if err != nil {
		return err
	}
	profileJSON := string(profileBytes)

	var pipeline model.RagPipelineProfile
	if err := tx.Where("eid = ? AND name = ? AND kind = ?", eid, defaultGraphPipelineName, model.PipelineKindGraph).First(&pipeline).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		pipeline = model.RagPipelineProfile{
			Eid:         eid,
			Kind:        model.PipelineKindGraph,
			Name:        defaultGraphPipelineName,
			Icon:        "",
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
	if err := tx.Where("eid = ? AND name = ? AND kind = ?", eid, defaultGraphStrategyName, model.PipelineKindGraph).First(&strategy).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		// 旧名「默认图谱策略」兼容迁移：存在则重命名复用（ID 不变），避免残留重复兜底策略
		var legacy model.RagRoutingStrategy
		legacyErr := tx.Where("eid = ? AND name = ? AND kind = ?", eid, legacyGraphStrategyName, model.PipelineKindGraph).First(&legacy).Error
		if legacyErr == nil {
			if err := tx.Model(&legacy).Updates(map[string]interface{}{
				"name":        defaultGraphStrategyName,
				"pipeline_id": pipeline.ID,
			}).Error; err != nil {
				return err
			}
			return nil
		}
		if !errors.Is(legacyErr, gorm.ErrRecordNotFound) {
			return legacyErr
		}
		strategy = model.RagRoutingStrategy{
			Eid:            eid,
			Kind:           model.PipelineKindGraph,
			Name:           defaultGraphStrategyName,
			Icon:           "",
			Priority:       defaultGraphStrategyPriority,
			Enabled:        true,
			IsDefault:      true,
			PipelineID:     pipeline.ID,
			Logic:          model.RagRoutingLogicAnd,
			ConditionsJSON: "",
		}
		if err := tx.Create(&strategy).Error; err != nil {
			return err
		}
	} else if strategy.PipelineID != pipeline.ID {
		if err := tx.Model(&strategy).Update("pipeline_id", pipeline.ID).Error; err != nil {
			return err
		}
	}

	return nil
}
