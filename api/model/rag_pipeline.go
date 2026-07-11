package model

import (
	"encoding/json"
	"errors"
	"path"
	"strings"

	"gorm.io/gorm"
)

// Pipeline 状态
const (
	RagPipelineStatusEnabled  = 1
	RagPipelineStatusDisabled = 0
)

// 路由策略逻辑
const (
	RagRoutingLogicAnd = 1
	RagRoutingLogicOr  = 2
)

// RagPipelineProfile RAG流水线配置（合并了原 Pipeline 和 Profile）
type RagPipelineProfile struct {
	ID          int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid         int64  `json:"eid" gorm:"not null;index;comment:企业ID"`
	Name        string `json:"name" gorm:"type:varchar(255);not null;comment:流水线名称"`
	Icon        string `json:"icon" gorm:"type:varchar(255);comment:图标"`
	Status      int    `json:"status" gorm:"type:smallint;not null;default:1;comment:状态 1:启用 0:禁用"`
	ProfileJSON string `json:"profile_json" gorm:"type:text;comment:配置详情JSON"`

	// 冗余统计字段
	SuccessCount int64 `json:"success_count" gorm:"default:0;comment:成功次数"`
	FailureCount int64 `json:"failure_count" gorm:"default:0;comment:失败次数"`
	LastRunTime  int64 `json:"last_run_time" gorm:"comment:最后运行时间"`

	BaseModel
}

func (RagPipelineProfile) TableName() string {
	return "rag_pipeline_profiles"
}

// RagRoutingStrategy 策略路由规则
type RagRoutingStrategy struct {
	ID             int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid            int64  `json:"eid" gorm:"not null;index;comment:企业ID"`
	Name           string `json:"name" gorm:"type:varchar(255);not null;comment:策略名称"`
	Icon           string `json:"icon" gorm:"type:varchar(255);comment:图标"`
	Priority       int    `json:"priority" gorm:"not null;comment:优先级(1-99)"`
	Enabled        bool   `json:"enabled" gorm:"not null;default:true;comment:是否启用"`
	IsDefault      bool   `json:"is_default" gorm:"not null;default:false;comment:是否默认策略(兜底)"`
	PipelineID     int64  `json:"pipeline_id" gorm:"not null;index;comment:关联的流水线ID"` // 关联 RagPipelineProfile.ID
	Logic          int    `json:"logic" gorm:"type:smallint;not null;default:1;comment:组内逻辑 1:AND 2:OR"`
	ConditionsJSON string `json:"conditions_json" gorm:"type:text;comment:匹配条件JSON"`
	BaseModel
}

func (RagRoutingStrategy) TableName() string {
	return "rag_routing_strategies"
}

// RoutingStrategyDetail 包含 Pipeline 信息
type RoutingStrategyDetail struct {
	RagRoutingStrategy
	PipelineName string `json:"pipeline_name" gorm:"->"`
}

// StrategyWithPipelineResponse 包含完整 Pipeline 信息的策略响应
type StrategyWithPipelineResponse struct {
	RagRoutingStrategy
	Pipeline *RagPipelineProfile `json:"pipeline"`
}

// FindHighestPriorityRagRoutingStrategyAndPipelineByFile 根据文件扩展名查找最高优先级的 RAG 路由策略和流水线
func FindHighestPriorityRagRoutingStrategyAndPipelineByFile(db *gorm.DB, file *File) (*RagRoutingStrategy, *RagPipelineProfile, error) {
	if db == nil {
		return nil, nil, errors.New("db is nil")
	}
	if file == nil {
		return nil, nil, errors.New("file is nil")
	}

	fileName := ""
	if file.UploadFile != nil && strings.TrimSpace(file.UploadFile.FileName) != "" {
		fileName = file.UploadFile.FileName
	} else if file.UploadFileID > 0 {
		var uploadFile UploadFile
		if err := db.Select("file_name").Where("id = ?", file.UploadFileID).First(&uploadFile).Error; err == nil {
			if strings.TrimSpace(uploadFile.FileName) != "" {
				fileName = uploadFile.FileName
			}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, err
		}
	}
	if fileName == "" {
		filePath := strings.TrimPrefix(file.GetPath(), "/")
		fileName = ExtractSimpleFileName(filePath)
	}

	ext := strings.TrimPrefix(strings.ToLower(path.Ext(fileName)), ".")

	var strategies []RagRoutingStrategy
	// 直接查询 rag_routing_strategies
	if err := db.Where("eid = ? AND enabled = ?", file.Eid, true).
		Order("priority asc, id asc").
		Find(&strategies).Error; err != nil {
		return nil, nil, err
	}

	type routingMatcher struct {
		Type     string          `json:"type"`
		Operator string          `json:"operator"`
		Value    json.RawMessage `json:"value"`
	}
	type routingConditions struct {
		Matchers []routingMatcher `json:"matchers"`
	}

	matchMatcher := func(m routingMatcher) (bool, error) {
		parseStringList := func(raw json.RawMessage) ([]string, error) {
			var values []string
			if err := json.Unmarshal(raw, &values); err == nil {
				return values, nil
			}
			var single string
			if err := json.Unmarshal(raw, &single); err != nil {
				return nil, err
			}
			return []string{single}, nil
		}
		switch strings.ToLower(strings.TrimSpace(m.Type)) {
		case "extension":
			op := strings.ToLower(strings.TrimSpace(m.Operator))
			values, err := parseStringList(m.Value)
			if err != nil {
				return false, err
			}
			for i := range values {
				values[i] = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(values[i]), "."))
			}
			switch op {
			case "in", "belongs":
				for _, v := range values {
					if v == ext {
						return true, nil
					}
				}
				return false, nil
			case "eq", "equals":
				if len(values) == 0 {
					return false, nil
				}
				return values[0] == ext, nil
			default:
				return false, nil
			}
		case "filename":
			op := strings.ToLower(strings.TrimSpace(m.Operator))
			targetName := strings.ToLower(fileName)
			switch op {
			case "contains", "include":
				var value string
				if err := json.Unmarshal(m.Value, &value); err != nil {
					return false, err
				}
				matchValue := strings.ToLower(value)
				return strings.Contains(targetName, matchValue), nil
			case "eq", "equals":
				var value string
				if err := json.Unmarshal(m.Value, &value); err != nil {
					return false, err
				}
				matchValue := strings.ToLower(value)
				// 文件名等于：使用不带后缀的文件名进行比较
				targetNameWithoutExt := strings.TrimSuffix(targetName, strings.ToLower(path.Ext(targetName)))
				return targetNameWithoutExt == matchValue, nil
			case "starts_with", "startswith", "prefix":
				var value string
				if err := json.Unmarshal(m.Value, &value); err != nil {
					return false, err
				}
				matchValue := strings.ToLower(value)
				return strings.HasPrefix(targetName, matchValue), nil
			case "ends_with", "endswith", "suffix":
				var value string
				if err := json.Unmarshal(m.Value, &value); err != nil {
					return false, err
				}
				matchValue := strings.ToLower(value)
				return strings.HasSuffix(targetName, matchValue), nil
			case "in", "belongs":
				values, err := parseStringList(m.Value)
				if err != nil {
					return false, err
				}
				for _, v := range values {
					if strings.ToLower(strings.TrimSpace(v)) == targetName {
						return true, nil
					}
				}
				return false, nil
			default:
				return false, nil
			}
		default:
			return false, nil
		}
	}

	for i := range strategies {
		strategy := strategies[i]
		raw := strings.TrimSpace(strategy.ConditionsJSON)
		matched := false

		if raw == "" {
			matched = true
		} else {
			conditionsBytes := []byte(raw)
			// 尝试解析为 routingConditions
			var cond routingConditions
			if err := json.Unmarshal(conditionsBytes, &cond); err == nil && len(cond.Matchers) > 0 {
				if strategy.Logic == RagRoutingLogicOr {
					matched = false
					for _, m := range cond.Matchers {
						ok, err := matchMatcher(m)
						if err != nil {
							return nil, nil, err
						}
						if ok {
							matched = true
							break
						}
					}
				} else {
					// 默认逻辑：AND
					matched = true
					for _, m := range cond.Matchers {
						ok, err := matchMatcher(m)
						if err != nil {
							return nil, nil, err
						}
						if !ok {
							matched = false
							break
						}
					}
				}
			}
		}

		if !matched {
			continue
		}

		var profile RagPipelineProfile
		if err := db.First(&profile, strategy.PipelineID).Error; err != nil {
			return nil, nil, err
		}
		return &strategy, &profile, nil
	}

	// 如果没有任何策略命中，尝试返回标记为 is_default 的兜底策略
	var defaultStrategy RagRoutingStrategy
	if err := db.Where("eid = ? AND enabled = ? AND is_default = ?", file.Eid, true, true).
		Order("priority asc, id asc").
		First(&defaultStrategy).Error; err == nil {
		var profile RagPipelineProfile
		if err := db.First(&profile, defaultStrategy.PipelineID).Error; err != nil {
			return nil, nil, err
		}
		return &defaultStrategy, &profile, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, err
	}

	return nil, nil, gorm.ErrRecordNotFound
}

func GetRagPipelineProfilesByEidAndName(eid int64, name string) ([]RagPipelineProfile, error) {
	var pipelines []RagPipelineProfile
	err := DB.Where("eid = ? AND name = ?", eid, name).Find(&pipelines).Error
	return pipelines, err
}

func GetRagRoutingStrategiesByEidAndName(eid int64, name string) ([]RagRoutingStrategy, error) {
	var strategies []RagRoutingStrategy
	err := DB.Where("eid = ? AND name = ?", eid, name).Find(&strategies).Error
	return strategies, err
}
