import { forwardRef, useImperativeHandle, useEffect, useState } from "react";
import { Form, Switch, Slider, InputNumber, Input, Tooltip, Radio, Checkbox } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { useAgentForm, parseModelValue, encodeModelValue, validateModelConfig } from "../hooks";
import { useAgentCreateAdapter, ChannelOption } from "../adapters";
import { BaseConfig, RelateAgents } from "../components";
import { ModelSelect, OverflowTooltip, SvgIcon } from "@km/shared-components-react";
import {
  MODEL_VALUE_SEPARATOR,
  OUT_REPLY_TYPE,
  DEFAULT_RERANK_CONFIG,
  DEFAULT_FAST_REASONING_CONFIG,
  DEFAULT_DEEP_THINKING_CONFIG,
} from "../constants";

interface KnowledgeProps {
  showChannelConfig?: boolean;
  className?: string;
}

export interface KnowledgeRef {
  validateForm: () => Promise<boolean>;
}

/** 博查平台设置接口 */
interface PlatformSetting {
  id: string
  platform_key: string
}

/** 默认设置 */
const DEFAULT_SETTINGS = {
  settings: {
    out_of_range_reply: {
      enable: true,
      reply: "当前问题可能因内容未收录、解析中或权限限制无法解答。",
      mode: "fixed_reply",
      prompt: `你是一个专业、友好的AI助手。现在用户提出的问题超出了你的知识库范围，你需要生成一个礼貌且有帮助的回复。\n\n## 回复要求\n- 诚实承认你无法提供准确答案\n- 简洁友好，不要过度道歉\n- 可以提供相关的建议或替代方案\n- 回复控制在50字以内\n- 使用礼貌、专业的语气\n\n## Few-shot示例\n用户问题: 今天杭州西湖的游客数量是多少?\n回复: 抱歉，我无法获取实时的杭州西湖游客数据。您可以通过杭州旅游官网或相关APP查询这一信息。\n`,
    },
    rerank_config: DEFAULT_RERANK_CONFIG,
    question_rewrite_config: { enable: false },
    web_search_setting: {
      enable: false,
      platform_setting_id: "",
      platform_key: "",
      top_k: 20,
    },
    wiki_search_setting: {
      enable: false,
      default_enable: false,
    },
    graph_search_setting: {
      enable: false,
      default_enable: false,
    },
    answer_preference_config: {
      enable: false,
      content: "",
    },
    fast_reasoning_config: DEFAULT_FAST_REASONING_CONFIG,
    deep_thinking_config: DEFAULT_DEEP_THINKING_CONFIG,
  },
};

export const Knowledge = forwardRef<KnowledgeRef, KnowledgeProps>(
  ({ showChannelConfig, className }, ref) => {
    const [antdForm] = Form.useForm();
    const form = useAgentForm();
    const adapter = useAgentCreateAdapter();
    const t = adapter.t || ((key: string) => key);
    const hideKnowledgeGraph = adapter.hideKnowledgeGraph ?? false;
    const [modelOptions, setModelOptions] = useState<ChannelOption[]>([]);
    const [rerankOptions, setRerankOptions] = useState<ChannelOption[]>([]);
    const [modelLoading, setModelLoading] = useState(false);
    const [rerankLoading, setRerankLoading] = useState(false);
    const [bochaPlatformSetting, setBochaPlatformSetting] = useState<PlatformSetting | null>(null);
    const [searchOptions, setSearchOptions] = useState<{ label: string; value: string; icon: string }[]>([]);

    // 加载模型列表
    useEffect(() => {
      if (showChannelConfig && adapter.loadModels) {
        setModelLoading(true);
        adapter.loadModels()
          .then(setModelOptions)
          .finally(() => setModelLoading(false));
      }
    }, [showChannelConfig, adapter]);

    // 加载重排序模型列表
    useEffect(() => {
      if (showChannelConfig && adapter.loadRerankModels) {
        setRerankLoading(true);
        adapter.loadRerankModels()
          .then(setRerankOptions)
          .finally(() => setRerankLoading(false));
      }
    }, [showChannelConfig, adapter]);

    // 加载博查设置
    useEffect(() => {
      if (showChannelConfig && adapter.loadPlatformSettings) {
        adapter.loadPlatformSettings()
          .then((result) => {
            if (result && result.length > 0) {
              setBochaPlatformSetting(result[0]);
              setSearchOptions([
                {
                  label: t('knowledge.bocha_api'),
                  value: `${result[0].id}${MODEL_VALUE_SEPARATOR}bochaai`,
                  icon:
                    (window as any).$getRealPath?.({
                      url: "/images/tools/bocha.png",
                    }) || "/images/tools/bocha.png",
                },
              ]);
            }
          })
          .catch(console.error);
      }
    }, [showChannelConfig, adapter]);

    // 初始化默认设置
    useEffect(() => {
      if (showChannelConfig) {
        form.updateFields({
          settings: {
            ...DEFAULT_SETTINGS.settings,
            ...form.formData.settings,
          },
        });
      }
    }, [showChannelConfig]);

    const validateForm = async () => {
      try {
        await antdForm.validateFields();

        // 验证模型配置（仅在 showChannelConfig 模式下）
        if (showChannelConfig) {
          const fastConfig = form.formData.settings?.fast_reasoning_config;
          const deepConfig = form.formData.settings?.deep_thinking_config;

          // 快速推理默认启用，必须验证
          if (!validateModelConfig({
            config: fastConfig,
            label: t('model.fast_reasoning'),
            t,
            required: true,
          })) {
            return false;
          }

          // 深度思考仅在启用时验证
          if (deepConfig?.enable && !validateModelConfig({
            config: deepConfig,
            label: t('model.deep_thinking'),
            t,
            required: false,
          })) {
            return false;
          }
        }

        return true;
      } catch {
        return false;
      }
    };

    useImperativeHandle(ref, () => ({
      validateForm,
    }));

    // 快速推理模型值
    const fastReasoningConfig = form.formData.settings?.fast_reasoning_config;
    const fastReasoningValue = fastReasoningConfig?.channel_id
      ? encodeModelValue({
          channel_id: fastReasoningConfig.channel_id,
          model_name: fastReasoningConfig.model_name || "",
          channel_type: fastReasoningConfig.channel_type || 0,
        })
      : "";

    const setFastReasoningValue = (value: string) => {
      const parsed = parseModelValue(value);
      form.updateFields({
        settings: {
          ...form.formData.settings,
          fast_reasoning_config: {
            ...form.formData.settings?.fast_reasoning_config,
            ...parsed,
          },
        },
      });
    };

    // 深度思考模型值
    const deepThinkingConfig = form.formData.settings?.deep_thinking_config;
    const deepThinkingValue = deepThinkingConfig?.channel_id
      ? encodeModelValue({
          channel_id: deepThinkingConfig.channel_id,
          model_name: deepThinkingConfig.model_name || "",
          channel_type: deepThinkingConfig.channel_type || 0,
        })
      : "";

    const setDeepThinkingValue = (value: string) => {
      const parsed = parseModelValue(value);
      form.updateFields({
        settings: {
          ...form.formData.settings,
          deep_thinking_config: {
            ...form.formData.settings?.deep_thinking_config,
            ...parsed,
          },
        },
      });
    };

    // 重排序模型值
    const rerankConfig = form.formData.settings?.rerank_config;
    const rerankValue = rerankConfig?.rerank_channel_id
      ? `${rerankConfig.rerank_channel_id}${MODEL_VALUE_SEPARATOR}${rerankConfig.rerank_model_name}`
      : "";

    const setRerankValue = (value: string) => {
      const [channel_id, model_name] = value.split(MODEL_VALUE_SEPARATOR);
      form.updateFields({
        settings: {
          ...form.formData.settings,
          rerank_config: {
            ...form.formData.settings?.rerank_config,
            rerank_channel_id: Number(channel_id),
            rerank_model_name: model_name,
          },
        },
      });
    };

    // 联网搜索值
    const webSearchSetting = form.formData.settings?.web_search_setting;
    const searchValue =
      webSearchSetting?.platform_setting_id &&
      webSearchSetting?.platform_key &&
      bochaPlatformSetting?.id === webSearchSetting?.platform_setting_id
        ? `${webSearchSetting.platform_setting_id}${MODEL_VALUE_SEPARATOR}${webSearchSetting.platform_key}`
        : "";

    const setSearchValue = (value: string) => {
      const [platform_setting_id, platform_key] = value.split(MODEL_VALUE_SEPARATOR);
      form.updateFields({
        settings: {
          ...form.formData.settings,
          web_search_setting: {
            ...form.formData.settings?.web_search_setting,
            platform_setting_id,
            platform_key,
          },
        },
      });
    };

    return (
      <div className={`${className || ""}`}>
        <Form form={antdForm} layout="vertical">
          {showChannelConfig ? (
            <>
              {/* 模型设置 */}
              <div className="text-sm text-[#373A3D] mb-3">{t('module.model_setting')}</div>
              <div className="p-4 border rounded-xl bg-white mb-4">
                <div className="flex flex-col gap-4">
                  {/* 快速推理 */}
                  <div className="flex items-center gap-4 ">
                    <div className="flex items-center gap-2 w-[110px] flex-none">
                      <Checkbox
                        checked={form.formData.settings?.fast_reasoning_config?.enable}
                        disabled
                      />
                      <span className="text-sm text-primary">
                        {t('model.fast_reasoning')}
                      </span>
                      <Tooltip title={t('knowledge.fast_reasoning_tip')} placement="top">
                        <QuestionCircleOutlined className="text-hint cursor-help" />
                      </Tooltip>
                    </div>
                    <div className="flex-1 overflow-hidden">
                      {adapter.OtherComponents?.ModelSelectPopover ? (
                        <adapter.OtherComponents.ModelSelectPopover
                          value={fastReasoningValue}
                          className="w-full"
                          channelId={form.formData.settings?.fast_reasoning_config?.channel_id}
                          modelName={form.formData.settings?.fast_reasoning_config?.model_name}
                          temperature={form.formData.settings?.fast_reasoning_config?.temperature}
                          type="1"
                          onChange={setFastReasoningValue}
                          onTemperatureChange={(value: number) => form.updateFields({
                            settings: {
                              ...form.formData.settings,
                              fast_reasoning_config: {
                                ...form.formData.settings?.fast_reasoning_config,
                                temperature: value,
                              },
                            },
                          })}
                        />
                      ) : null}
                    </div>
                  </div>

                  {/* 深度思考 */}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 w-[110px] flex-none">
                      <Checkbox
                        checked={form.formData.settings?.deep_thinking_config?.enable}
                        onChange={(e) => form.updateFields({
                          settings: {
                            ...form.formData.settings,
                            deep_thinking_config: {
                              ...form.formData.settings?.deep_thinking_config,
                              enable: e.target.checked,
                            },
                          },
                        })}
                      />
                      <span className="text-sm text-primary">
                        {t('model.deep_thinking')}
                      </span>
                      <Tooltip title={t('knowledge.deep_thinking_tip')} placement="top">
                        <QuestionCircleOutlined className="text-hint cursor-help" />
                      </Tooltip>
                    </div>
                    <div className="flex-1 overflow-hidden">
                      {adapter.OtherComponents?.ModelSelectPopover ? (
                        <adapter.OtherComponents.ModelSelectPopover
                          value={deepThinkingValue}
                          className="w-full"
                          channelId={form.formData.settings?.deep_thinking_config?.channel_id}
                          modelName={form.formData.settings?.deep_thinking_config?.model_name}
                          temperature={form.formData.settings?.deep_thinking_config?.temperature}
                          type="1"
                          onChange={setDeepThinkingValue}
                          onTemperatureChange={(value: number) => form.updateFields({
                            settings: {
                              ...form.formData.settings,
                              deep_thinking_config: {
                                ...form.formData.settings?.deep_thinking_config,
                                temperature: value,
                              },
                            },
                          })}
                          customClass={!form.formData.settings?.deep_thinking_config?.enable ? 'opacity-50 pointer-events-none' : ''}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              {/* 生成配置 */}
              <div className="text-sm  text-[#373A3D] mb-3">{t('module.generation_config')}</div>
              <div className="p-4 border rounded-xl bg-white mb-4">
                <div className="flex flex-col gap-4">

                  {/* 知识范围 */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-secondary w-[100px] flex-none flex items-center gap-1">
                      {t('module.knowledge_scope')}
                      <Tooltip title={t('module.knowledge_scope_desc')} placement="top">
                        <QuestionCircleOutlined className="text-hint cursor-help" />
                      </Tooltip>
                    </span>
                    <span className="text-sm text-primary flex items-center gap-1"><SvgIcon name="documents" size={14} />{t('setting.all_knowledge_base')}</span>
                  </div>

                  {/* 动态知识 */}
                  <div className="flex items-start gap-2">
                    <span className="text-sm text-secondary w-[100px] flex-none flex items-center gap-1">
                      {t('module.dynamic_knowledge')}
                      <Tooltip title={t('knowledge.wiki_search_tip')} placement="top">
                        <QuestionCircleOutlined className="text-hint cursor-help" />
                      </Tooltip>
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Switch
                          size="small"
                          checked={form.formData.settings?.wiki_search_setting?.enable}
                          onChange={(checked) => form.updateFields({
                            settings: {
                              ...form.formData.settings,
                              wiki_search_setting: {
                                ...form.formData.settings?.wiki_search_setting,
                                enable: checked,
                              },
                            },
                          })}
                        />
                        <span className={`text-xs ${form.formData.settings?.wiki_search_setting?.enable ? 'text-primary' : 'text-placeholder'}`}>
                          {form.formData.settings?.wiki_search_setting?.enable ? t('setting1.enabled') : t('setting1.disabled')}
                        </span>
                      </div>
                    </div>
                    {form.formData.settings?.wiki_search_setting?.enable && (
                      <Checkbox
                        checked={form.formData.settings?.wiki_search_setting?.default_enable}
                        onChange={(e) => form.updateFields({
                          settings: {
                            ...form.formData.settings,
                            wiki_search_setting: {
                              ...form.formData.settings?.wiki_search_setting,
                              default_enable: e.target.checked,
                            },
                          },
                        })}
                      >
                        {t('module.default_enable')}
                      </Checkbox>
                    )}
                  </div>

                  {/* 知识图谱 */}
                  {!hideKnowledgeGraph && (
                    <div className="flex items-start gap-2">
                      <span className="text-sm text-secondary w-[100px] flex-none flex items-center gap-1">
                        {t('module.knowledge_graph')}
                        <Tooltip title={t('knowledge.graph_search_tip')} placement="top">
                          <QuestionCircleOutlined className="text-hint cursor-help" />
                        </Tooltip>
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Switch
                            size="small"
                            checked={form.formData.settings?.graph_search_setting?.enable}
                            onChange={(checked) => form.updateFields({
                              settings: {
                                ...form.formData.settings,
                                graph_search_setting: {
                                  ...form.formData.settings?.graph_search_setting,
                                  enable: checked,
                                },
                              },
                            })}
                          />
                          <span className={`text-xs ${form.formData.settings?.graph_search_setting?.enable ? 'text-primary' : 'text-placeholder'}`}>
                            {form.formData.settings?.graph_search_setting?.enable ? t('setting1.enabled') : t('setting1.disabled')}
                          </span>
                        </div>
                      </div>
                      {form.formData.settings?.graph_search_setting?.enable && (
                        <Checkbox
                          checked={form.formData.settings?.graph_search_setting?.default_enable}
                          onChange={(e) => form.updateFields({
                            settings: {
                              ...form.formData.settings,
                              graph_search_setting: {
                                ...form.formData.settings?.graph_search_setting,
                                default_enable: e.target.checked,
                              },
                            },
                          })}
                        >
                          {t('module.default_enable')}
                        </Checkbox>
                      )}
                    </div>
                  )}

                  {/* 联网搜索 */}
                  <div className="flex items-start gap-2">
                    <span className="text-sm text-secondary w-[100px] flex-none flex items-center gap-1">
                      {t('module.web_search')}
                      <Tooltip title={t('module.web_search_desc')} placement="top">
                        <QuestionCircleOutlined className="text-hint cursor-help" />
                      </Tooltip>
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <Switch
                          size="small"
                          checked={form.formData.settings?.web_search_setting?.enable}
                          onChange={(checked) => form.updateFields({
                            settings: {
                              ...form.formData.settings,
                              web_search_setting: {
                                ...form.formData.settings?.web_search_setting,
                                enable: checked,
                              },
                            },
                          })}
                        />
                        <span className={`text-xs ${form.formData.settings?.web_search_setting?.enable ? 'text-primary' : 'text-placeholder'}`}>
                          {form.formData.settings?.web_search_setting?.enable ? t('setting1.enabled') : t('setting1.disabled')}
                        </span>
                        
                        {form.formData.settings?.web_search_setting?.enable && (
                          <>
                            {adapter.OtherComponents?.SelectPlus ? (
                              <adapter.OtherComponents.SelectPlus
                                className="flex-1 overflow-hidden"
                                value={searchValue}
                                onChange={setSearchValue}
                                options={searchOptions}
                                useI18n={false}
                              />
                            ) : null}
                            <div className="flex-1 flex items-center gap-2">
                              <span className="text-sm text-secondary shrink-0">{t('module.max_result')}</span>
                              <InputNumber
                                value={form.formData.settings?.web_search_setting?.top_k || 20}
                                min={1}
                                max={20}
                                controls={false}
                                className="w-20"
                                onChange={(value) => form.updateFields({
                                  settings: {
                                    ...form.formData.settings,
                                    web_search_setting: {
                                      ...form.formData.settings?.web_search_setting,
                                      top_k: value,
                                    },
                                  },
                                })}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="w-full border-t border-dashed my-3"></div>

                  {/* 重排序模型 */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-secondary w-[100px] flex items-center gap-1">
                      {t('model.rerank')}
                      <Tooltip title={t('module.reranking_desc')} placement="top">
                        <QuestionCircleOutlined className="text-hint cursor-help" />
                      </Tooltip>
                    </span>
                    <div className="flex-1 overflow-hidden">
                      <ModelSelect
                        value={rerankValue}
                        onChange={setRerankValue}
                        options={rerankOptions}
                        loading={rerankLoading}
                        t={t}
                      />
                    </div>
                  </div>

                  {/* 召回数量 */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-secondary w-[100px] flex-none flex items-center gap-1">
                      {t('module.recall_count')}
                      <Tooltip title={t('module.recall_count_desc')} placement="top">
                        <QuestionCircleOutlined className="text-hint cursor-help" />
                      </Tooltip>
                    </span>
                    <div className="flex-1 flex items-center gap-2 overflow-hidden">
                      <Slider
                        value={form.formData.settings?.rerank_config?.top_k || 20}
                        min={1}
                        max={50}
                        className="flex-1"
                        onChange={(value) => form.updateFields({
                          settings: {
                            ...form.formData.settings,
                            rerank_config: {
                              ...form.formData.settings?.rerank_config,
                              top_k: value,
                            },
                          },
                        })}
                      />
                      <span className="w-8 text-sm text-secondary text-right">
                        {form.formData.settings?.rerank_config?.top_k || 20}
                      </span>
                    </div>
                  </div>

                  {/* 回答偏好 */}
                  <div className="flex items-start gap-2">
                    <span className="text-sm text-secondary w-[100px] flex-none">{t('module.answer_preference')}</span>
                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <Switch
                          size="small"
                          checked={form.formData.settings?.answer_preference_config?.enable}
                          onChange={(checked) => form.updateFields({
                            settings: {
                              ...form.formData.settings,
                              answer_preference_config: {
                                ...form.formData.settings?.answer_preference_config,
                                enable: checked,
                              },
                            },
                          })}
                        />
                        <OverflowTooltip>
                          <span className="text-xs text-placeholder truncate">{t('knowledge.answer_preference_tip')}</span>
                        </OverflowTooltip>
                      </div>
                      {form.formData.settings?.answer_preference_config?.enable && (
                        <Input.TextArea
                          className="flex-1"
                          rows={4}
                          maxLength={1500}
                          showCount
                          value={form.formData.settings?.answer_preference_config?.content}
                          onChange={(e) => form.updateFields({
                            settings: {
                              ...form.formData.settings,
                              answer_preference_config: {
                                ...form.formData.settings?.answer_preference_config,
                                content: e.target.value,
                              },
                            },
                          })}
                          placeholder={t('module.answer_preference_placeholder')}
                          style={{ resize: "none" }}
                        />
                      )}
                    </div>
                  </div>

                  {/* 拒答策略 */}
                  <div className="flex items-start gap-2">
                    <span className="text-sm text-secondary w-[100px] mt-1 flex items-center gap-1">
                      {t('module.reject_strategy')}
                      <Tooltip title={t('module.reject_strategy_desc')} placement="top">
                        <QuestionCircleOutlined className="text-hint cursor-help" />
                      </Tooltip>
                    </span>
                    <div className="flex-1 overflow-hidden">
                      <Radio.Group
                        value={form.formData.settings?.out_of_range_reply?.mode}
                        onChange={(e) => form.updateFields({
                          settings: {
                            ...form.formData.settings,
                            out_of_range_reply: {
                              ...form.formData.settings?.out_of_range_reply,
                              mode: e.target.value,
                            },
                          },
                        })}
                      >
                        <Radio value={OUT_REPLY_TYPE.FIXED_REPLY}>
                          {t('module.reject_strategy_fixed_reply')}
                        </Radio>
                        <Radio value={OUT_REPLY_TYPE.CONTINUE}>
                          {t('module.reject_strategy_continue')}
                        </Radio>
                      </Radio.Group>

                      {form.formData.settings?.out_of_range_reply?.mode === OUT_REPLY_TYPE.FIXED_REPLY && (
                        <div className="mt-2.5 w-full">
                          <Input.TextArea
                            rows={4}
                            maxLength={500}
                            showCount
                            value={form.formData.settings?.out_of_range_reply?.reply}
                            onChange={(e) => form.updateFields({
                              settings: {
                                ...form.formData.settings,
                                out_of_range_reply: {
                                  ...form.formData.settings?.out_of_range_reply,
                                  reply: e.target.value,
                                },
                              },
                            })}
                            placeholder={t('module.out_of_range_reply_placeholder')}
                            style={{ resize: "none" }}
                          />
                        </div>
                      )}

                      {form.formData.settings?.out_of_range_reply?.mode === OUT_REPLY_TYPE.CONTINUE && (
                        <div className="border rounded mt-2.5">
                          <div className="h-10 flex items-center px-4 text-sm text-secondary border-b">
                            {t('role_instruction_desc')}
                          </div>
                          <div>
                            {adapter.OtherComponents?.PromptInput ? (
                              <adapter.OtherComponents.PromptInput
                                value={form.formData.settings?.out_of_range_reply?.prompt}
                                onChange={(val: string) => form.updateFields({
                                  settings: {
                                    ...form.formData.settings,
                                    out_of_range_reply: {
                                      ...form.formData.settings?.out_of_range_reply,
                                      prompt: val,
                                    },
                                  },
                                })}
                                showLine
                                wordWrap
                                style={{
                                  flex: "none",
                                  minHeight: "200px",
                                  height: "max-content",
                                }}
                              />
                            ) : (
                              <Input.TextArea
                                rows={8}
                                maxLength={500}
                                value={form.formData.settings?.out_of_range_reply?.prompt}
                                onChange={(e) => form.updateFields({
                                  settings: {
                                    ...form.formData.settings,
                                    out_of_range_reply: {
                                      ...form.formData.settings?.out_of_range_reply,
                                      prompt: e.target.value,
                                    },
                                  },
                                })}
                                placeholder={t('module.out_of_range_reply_prompt_placeholder')}
                                style={{ resize: "none" }}
                              />
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-[#9CA3AF] py-1.5">{t('agent.chat_enhance')}</div>
              <BaseConfig />
              <RelateAgents />
              <div className="h-3"></div>
            </>
          )}
        </Form>
      </div>
    );
  }
);

Knowledge.displayName = "Knowledge";

export default Knowledge;
