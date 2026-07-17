package service

import (
	"context"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

func InitializeRecordingPipelineForPersonalLibrary(ctx context.Context, eid int64, parserPlatform string) error {
	if parserPlatform != model.PLATFORM_KEY_TINGWU {
		logger.Infof(ctx, "【录音配置】平台 %s 暂不支持自动初始化管线，跳过", parserPlatform)
		return nil
	}

	existingPipelines, err := model.GetRagPipelineProfilesByEidAndName(eid, "听悟")
	if err != nil {
		return fmt.Errorf("查询已有pipeline失败: %w", err)
	}

	if len(existingPipelines) == 0 {
		pipeline, err := createTingwuPipeline(eid)
		if err != nil {
			return fmt.Errorf("创建听悟pipeline失败: %w", err)
		}
		existingPipelines = []model.RagPipelineProfile{*pipeline}
	}

	pipelineID := existingPipelines[0].ID

	existingStrategies, err := model.GetRagRoutingStrategiesByEidAndName(eid, "m4a")
	if err != nil {
		return fmt.Errorf("查询已有m4a策略失败: %w", err)
	}

	if len(existingStrategies) == 0 {
		if _, err := createM4aStrategy(eid, pipelineID); err != nil {
			return fmt.Errorf("创建m4a策略失败: %w", err)
		}
	}

	logger.Infof(ctx, "【录音配置】解析管线初始化完成: eid=%d platform=%s", eid, parserPlatform)
	return nil
}

func createTingwuPipeline(eid int64) (*model.RagPipelineProfile, error) {
	profileJSON := `{
        "steps": [
            {
                "config": {
                    "enable_inverse_text_normalization": true,
                    "enable_punctuation": true,
                    "enable_speaker_diarization": true,
                    "enable_summary": false,
                    "enable_words": false,
                    "engine": "tingwu",
                    "language": "zh",
                    "enable_smart_match": false
                },
                "description": "转文档为可处理的结构化文本",
                "name": "文档解析",
                "run_mode": "auto",
                "step_key": "document_parsing"
            },
            {
                "config": {
                    "child_chunk": {
                        "identifier_level": "h3",
                        "max_length": 512,
                        "mode": "custom",
                        "strategy": "length"
                    },
                    "chunk_type": "default",
                    "index_enhancement": {
                        "generative_enhancement": {
                            "generate_faq": true,
                            "generate_summary": true
                        },
                        "metadata_injection": {
                            "append_filename": true,
                            "append_subtitle": true,
                            "append_title": true
                        }
                    },
                    "parent_chunk": {
                        "append_filename": true,
                        "append_subtitle": true,
                        "append_title": true,
                        "identifier_level": "h2",
                        "max_length": 2048,
                        "mode": "custom",
                        "strategy": "identifier"
                    },
                    "enable_smart_match": false,
                    "match_preference_prompt": ""
                },
                "description": "拆分文档内容为语料片段",
                "name": "语料拆分",
                "run_mode": "manual",
                "step_key": "document_chunking"
            },
            {
                "config": {},
                "description": "拆分文本并建索引，便于检索",
                "name": "向量索引",
                "run_mode": "manual",
                "step_key": "vector_indexing"
            },
            {
                "config": {
                    "execution_mode": "predefined",
                    "graph_template_id": "hfNBvQ"
                },
                "run_mode": "manual",
                "step_key": "graph_generation",
                "name": "图谱生成",
                "description": "提取信息，用图谱呈现内容关联"
            }
        ]
    }`

	pipeline := &model.RagPipelineProfile{
		Eid:         eid,
		Name:        "听悟",
		Icon:        "https://kmapitest.53ai.com/api/preview/7d5d28ec836bc3f291962e8ecd7b8878.png",
		Status:      model.RagPipelineStatusEnabled,
		ProfileJSON: profileJSON,
	}

	if err := model.DB.Create(pipeline).Error; err != nil {
		return nil, err
	}

	return pipeline, nil
}

func createM4aStrategy(eid int64, pipelineID int64) (*model.RagRoutingStrategy, error) {
	conditionsJSON := `{
        "matchers": [
            {
                "type": "extension",
                "operator": "eq",
                "value": "m4a"
            }
        ]
    }`

	strategy := &model.RagRoutingStrategy{
		Eid:            eid,
		Name:           "m4a",
		Icon:           "",
		Priority:       2,
		Enabled:        true,
		IsDefault:      false,
		PipelineID:     pipelineID,
		Logic:          model.RagRoutingLogicAnd,
		ConditionsJSON: conditionsJSON,
	}

	if err := model.DB.Create(strategy).Error; err != nil {
		return nil, err
	}

	return strategy, nil
}
