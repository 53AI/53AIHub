package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

// InitializeRecordingPipelineForPersonalLibrary 初始化录音解析管线。
//
// 当前支持两种解析平台：
//   - tingwu：通义听悟（旧格式，兼容保留）
//   - voice_model_*：语音模型渠道（新格式）
//
// 语音模型管线使用固定名称"语音解析"，engine 取自 recording_config.parser_platform（如 voice:17:fun-asr），
// 运行时从 RecordingConfig 读取实际 channel_id 和 model_name。
// 新增其他解析平台时，在此函数中增加分支即可。
// 注意：engine 必须与 recording_config.parser_platform 一致，否则秒解析缓存会误命中或漏命中。
func InitializeRecordingPipelineForPersonalLibrary(ctx context.Context, eid int64, parserPlatform string) error {
	if parserPlatform == model.PLATFORM_KEY_TINGWU {
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

	} else if strings.HasPrefix(parserPlatform, "voice:") {
		// 验证语音模型渠道（安心录管线不依赖语音模型，但保留渠道验证用于 RecordingConfig 一致性）
		parts := strings.Split(parserPlatform, ":")
		if len(parts) < 2 {
			logger.Infof(ctx, "【录音配置】平台 %s 格式无效", parserPlatform)
		} else {
			channelTypeStr := parts[1]
			channelType, err := strconv.ParseInt(channelTypeStr, 10, 64)
			if err != nil || channelType <= 0 {
				logger.Infof(ctx, "【录音配置】平台 %s channel_type 无效", parserPlatform)
			} else {
				modelName := ""
				if len(parts) >= 3 {
					modelName = parts[2]
				}
				channel, channelErr := model.GetRandomChannel(eid, int(channelType), modelName)
				if channelErr != nil || !model.IsVoiceModelChannel(channel) {
					logger.Infof(ctx, "【录音配置】平台 %s 对应的语音模型渠道不存在或未启用", parserPlatform)
				} else if channel.Status != model.ChannelStatusEnabled {
					logger.Infof(ctx, "【录音配置】平台 %s 对应的语音模型渠道未启用", parserPlatform)
				} else {
					logger.Infof(ctx, "【录音配置】语音模型渠道验证通过: eid=%d channel_id=%d", eid, channel.ChannelID)
				}
			}
		}
	} else {
		logger.Infof(ctx, "【录音配置】平台 %s 暂不支持自动初始化管线，跳过", parserPlatform)
	}

	// 统一初始化"安心录"管线（对所有平台）
	// engine 取 parserPlatform，与 recording_config.parser_platform 一致，确保秒解析缓存按模型隔离
	// 注意：tingwu 平台有专属"听悟"管线，安心录仅作兜底，应保持旧逻辑 engine="voice_model"，
	// 因此 tingwu 分支传空字符串触发 buildAnxinluProfileJSON 内部回退，避免写入 "tingwu" 改变既有行为
	anxinluEngine := parserPlatform
	if parserPlatform == model.PLATFORM_KEY_TINGWU {
		anxinluEngine = ""
	}
	if err := initializeAnxinluPipeline(ctx, eid, anxinluEngine); err != nil {
		logger.SysErrorf("【录音配置】安心录管线初始化失败（不阻塞主流程）: eid=%d err=%v", eid, err)
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

// buildAnxinluProfileJSON 构建安心录 pipeline 的 profileJSON。
// engine 取自 recording_config.parser_platform（如 voice:17:fun-asr），用于秒解析缓存按模型隔离。
// 若 engine 为空，回退为 "voice_model" 以兼容旧逻辑（如 tingwu 平台初始化安心录时）。
func buildAnxinluProfileJSON(channelID int64, engine string) string {
	if engine == "" {
		engine = "voice_model"
	}
	return fmt.Sprintf(`{
        "steps": [
            {
                "config": {
                    "engine": "%s",
                    "channel_id": %d,
                    "enable_smart_match": false
                },
                "description": "转文档为可处理的结构化文本",
                "name": "文档解析",
                "run_mode": "auto",
                "step_key": "document_parsing"
            },
            {
                "config": {
                    "chunk_type": "default",
                    "parent_chunk": {
                        "identifier_level": "h2",
                        "max_length": 2048,
                        "mode": "custom",
                        "strategy": "identifier"
                    },
                    "child_chunk": {
                        "identifier_level": "h3",
                        "max_length": 512,
                        "mode": "custom",
                        "strategy": "length"
                    },
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
                    "enable_smart_match": false
                },
                "description": "拆分文档内容为语料片段",
                "name": "语料拆分",
                "run_mode": "auto",
                "step_key": "document_chunking"
            },
            {
                "config": {},
                "description": "拆分文本并建索引，便于检索",
                "name": "向量索引",
                "run_mode": "auto",
                "step_key": "vector_indexing"
            },
            {
                "config": {},
                "run_mode": "skip",
                "step_key": "graph_generation",
                "name": "图谱生成",
                "description": "提取信息，用图谱呈现内容关联"
            }
        ]
    }`, engine, channelID)
}

func createAnxinluPipeline(eid int64, channelID int64, engine string) (*model.RagPipelineProfile, error) {
	profileJSON := buildAnxinluProfileJSON(channelID, engine)

	pipeline := &model.RagPipelineProfile{
		Eid:         eid,
		Name:        "安心录",
		Icon:        "",
		Status:      model.RagPipelineStatusEnabled,
		ProfileJSON: profileJSON,
	}

	if err := model.DB.Create(pipeline).Error; err != nil {
		return nil, err
	}

	return pipeline, nil
}

func createAnxinluStrategy(eid int64, pipelineID int64) (*model.RagRoutingStrategy, error) {
	conditionsJSON := `{
        "matchers": [
            {
                "type": "extension",
                "operator": "eq",
                "value": "mp3"
            },
            {
                "type": "extension",
                "operator": "eq",
                "value": "m4a"
            }
        ]
    }`

	strategy := &model.RagRoutingStrategy{
		Eid:            eid,
		Name:           "安心录",
		Icon:           "",
		Priority:       1,
		Enabled:        true,
		IsDefault:      false,
		PipelineID:     pipelineID,
		Logic:          model.RagRoutingLogicOr,
		ConditionsJSON: conditionsJSON,
	}

	if err := model.DB.Create(strategy).Error; err != nil {
		return nil, err
	}

	return strategy, nil
}

// initializeAnxinluPipeline 初始化或更新"安心录"管线。
// engine 取自 recording_config.parser_platform（如 voice:17:fun-asr），用于秒解析缓存按模型隔离。
// 当 engine 为空（如 tingwu 平台或未配置平台）时，buildAnxinluProfileJSON 内部回退为 "voice_model"。
func initializeAnxinluPipeline(ctx context.Context, eid int64, engine string) error {
	config, err := model.ValidateOrCreateRecordingConfig(eid)
	if err != nil {
		return fmt.Errorf("查询录音配置失败: %w", err)
	}

	channelID := int64(0)
	if config.VoiceModelID > 0 {
		channel, channelErr := model.GetChannelByID(config.VoiceModelID)
		if channelErr == nil && channel != nil {
			channelID = channel.ChannelID
		}
	}

	if engine == "" {
		engine = "voice_model"
	}

	profileJSON := buildAnxinluProfileJSON(channelID, engine)

	pipelineName := "安心录"
	existingPipelines, err := model.GetRagPipelineProfilesByEidAndName(eid, pipelineName)
	if err != nil {
		return fmt.Errorf("查询安心录pipeline失败: %w", err)
	}

	if len(existingPipelines) == 0 {
		pipeline, err := createAnxinluPipeline(eid, channelID, engine)
		if err != nil {
			return fmt.Errorf("创建安心录pipeline失败: %w", err)
		}
		existingPipelines = []model.RagPipelineProfile{*pipeline}
	} else {
		if existingPipelines[0].ProfileJSON != profileJSON {
			if err := model.DB.Model(&existingPipelines[0]).Update("profile_json", profileJSON).Error; err != nil {
				logger.SysErrorf("【录音配置】更新安心录pipeline profileJSON失败: eid=%d err=%v", eid, err)
			} else {
				logger.Infof(ctx, "【录音配置】更新安心录pipeline profileJSON: channel_id=%d engine=%s", channelID, engine)
			}
		}
	}

	pipelineID := existingPipelines[0].ID

	existingStrategies, err := model.GetRagRoutingStrategiesByEidAndName(eid, "安心录")
	if err != nil {
		return fmt.Errorf("查询安心录策略失败: %w", err)
	}

	if len(existingStrategies) == 0 {
		if _, err := createAnxinluStrategy(eid, pipelineID); err != nil {
			return fmt.Errorf("创建安心录策略失败: %w", err)
		}
	} else {
		if existingStrategies[0].PipelineID != pipelineID {
			model.DB.Model(&existingStrategies[0]).Update("pipeline_id", pipelineID)
			logger.Infof(ctx, "【录音配置】更新安心录策略pipeline指向: strategy_id=%d old_pipeline=%d new_pipeline=%d",
				existingStrategies[0].ID, existingStrategies[0].PipelineID, pipelineID)
		}
	}

	// 禁用旧名称 anxinlu_audio 策略（迁移兼容）
	oldStrategies, err := model.GetRagRoutingStrategiesByEidAndName(eid, "anxinlu_audio")
	if err != nil {
		logger.SysErrorf("【录音配置】查询旧anxinlu_audio策略失败（不阻塞）: eid=%d err=%v", eid, err)
	} else {
		for _, s := range oldStrategies {
			if s.Enabled {
				model.DB.Model(&s).Update("enabled", false)
				logger.Infof(ctx, "【录音配置】禁用旧anxinlu_audio策略: strategy_id=%d eid=%d", s.ID, eid)
			}
		}
	}

	voiceModelStrategies, err := model.GetRagRoutingStrategiesByEidAndName(eid, "voice_model_audio")
	if err != nil {
		logger.SysErrorf("【录音配置】查询voice_model_audio策略失败（不阻塞）: eid=%d err=%v", eid, err)
	} else {
		for _, s := range voiceModelStrategies {
			if s.Enabled {
				model.DB.Model(&s).Update("enabled", false)
				logger.Infof(ctx, "【录音配置】禁用voice_model_audio策略: strategy_id=%d eid=%d", s.ID, eid)
			}
		}
	}

	return nil
}
