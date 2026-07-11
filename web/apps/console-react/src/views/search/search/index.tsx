import { useState, useEffect, useMemo, forwardRef } from "react";
import { t } from "@/locales";
import {
    Checkbox,
    Switch,
    Slider,
    Radio,
    Input,
    Button,
    message,
    Spin,
    Tooltip,
    Divider,
} from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import agentsApi from "@/api/modules/agents";
import { transformAgentInfo } from "@/api/modules/agents/transform";
import { AGENT_USAGES } from "@/constants/agent";
import { MODEL_USE_TYPE, REASONING_MODE } from "@/constants/platform/config";
import ModelSelectPopover from "@/components/Model/select-popover";
import ModelSelect from "@/components/Model/select";
import { SelectPlus } from "@/components/SelectPlus";
import { MarkdownEditor } from "@/components/Markdown/editor";
import { PromptInput } from "@/components/Prompt/input";
import { Sortable } from "@km/shared-components-react";
import Fullscreen from "@/components/Fullscreen";
import { generateRandomId, deepCopy, assign } from "@/utils";
import platformSettingsApi from "@/api/modules/platform-settings";
import { transformPlatformSetting } from "@/api/modules/platform-settings/transform";
import { useEnterpriseStore } from "@/stores";
import type { AgentInfo } from "@/api/modules/agents/index";

const RERANKING_MODE = {
  WEIGHTED_SCORE: "weighted_score",
  RERANKING_MODEL: "reranking_model",
};

const OUT_REPLY_TYPE = {
  FIXED_REPLY: "fixed_reply",
  CONTINUE: "continue",
};

const MAX_QUESTION_LENGTH = 4;

export interface SearchSettingRef {
  handleStatusChange: (enable: boolean) => void;
}

interface SearchSettingPageProps {
  onAgentChange?: (agent: AgentInfo) => void;
  onLoading?: (loading: boolean) => void;
}

export const SearchSettingPage = forwardRef<SearchSettingRef, SearchSettingPageProps>(
  ({ onAgentChange, onLoading }, ref) => {
  const enterpriseStore = useEnterpriseStore();
  const [isLoading, setIsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bochaSetting, setBochaSetting] = useState<any>(null);
  const [searchOptions, setSearchOptions] = useState<any[]>([]);

  const DEFAULT_SETTINGS = useMemo(
    () => ({
      name: "",
      logo: "",
      description: "",
      model: "",
      enable: true,
      agent_type: 0,
      channel_type: 0,
      prompt: "",
      sort: 0,
      configs: {
        completion_params: {
          temperature: 0.2,
          top_p: 0.75,
          presence_penalty: 0.5,
          frequency_penalty: 0.5,
        },
      },
      custom_config: {
        agent_type: "prompt",
        provider_id: 0,
        channel_id: 0,
        channel_config: {},
        file_parse: { enable: false },
        image_parse: { enable: false },
        agent_mode: "chat",
      },
      settings: {
        opening_statement: `你好，我是${enterpriseStore.info?.name || ""}助手。无论你有什么问题，我都会尽我所能为你提供帮助和支持。`,
        suggested_questions: [
          {
            id: generateRandomId(10),
            content: "最近几年哪几个行业的前景不错？",
          },
          {
            id: generateRandomId(10),
            content: "说说AI行业的发展趋势和重要事件",
          },
        ],
        out_of_range_reply: {
          enable: true,
          reply: "当前问题可能因内容未收录、解析中或权限限制无法解答。",
          mode: "fixed_reply",
          prompt: `你是一个专业、友好的AI助手。现在用户提出的问题超出了你的知识库范围，你需要生成一个礼貌且有帮助的回复。\n\n## 回复要求\n- 诚实承认你无法提供准确答案\n- 简洁友好，不要过度道歉\n- 可以提供相关的建议或替代方案\n- 回复控制在50字以内\n- 使用礼貌、专业的语气\n\n## Few-shot示例\n用户问题: 今天杭州西湖的游客数量是多少?\n回复: 抱歉，我无法获取实时的杭州西湖游客数据。您可以通过杭州旅游官网或相关APP查询这一信息。\n`,
        },
        rerank_config: {
          fulltext: false,
          hybrid: false,
          rerank_model: RERANKING_MODE.RERANKING_MODEL,
          score_threshold: 0,
          top_k: 20,
          vector: true,
          rerank_channel_id: 0,
          rerank_model_name: "",
          reranking_enable: true,
          score_threshold_enabled: true,
          weights: {
            keyword_setting: { keyword_weight: 1 },
            vector_setting: { vector_weight: 0 },
          },
        },
        question_rewrite_config: { enable: false },
        web_search_setting: {
          enable: false,
          platform_setting_id: "",
          platform_key: "",
          top_k: 20,
        },
        graph_search_setting: {
          enable: false,
          default_enable: false,
        },
        answer_preference_config: { enable: false, content: "" },
        answer_remarks_config: { enable: false, content: "" },
        fast_reasoning_config: {
          enable: true,
          channel_id: 0,
          channel_type: 0,
          model_name: "",
          temperature: 0.7,
        },
        deep_thinking_config: {
          enable: false,
          channel_id: 0,
          channel_type: 0,
          model_name: "",
          temperature: 0.7,
        },
      },
      agent_usage: AGENT_USAGES.KM_AI_SEARCH,
      agent_id: 0,
    }),
    [enterpriseStore.info?.name],
  );

  const [form, setForm] = useState<any>(deepCopy(DEFAULT_SETTINGS));

  // Computed properties equivalents
  const rerankValue =
    form.settings.rerank_config.rerank_channel_id &&
    form.settings.rerank_config.rerank_model_name
      ? `${form.settings.rerank_config.rerank_channel_id}_53aikm_${form.settings.rerank_config.rerank_model_name}`
      : "";

  const setRerankValue = (value: string) => {
    const [channel_id, model_name] = value.split("_53aikm_");
    setForm((prev: any) => {
      const next = deepCopy(prev);
      next.settings.rerank_config.rerank_channel_id = Number(channel_id);
      next.settings.rerank_config.rerank_model_name = model_name;
      return next;
    });
  };

  const searchValue =
    form.settings.web_search_setting.platform_setting_id &&
    form.settings.web_search_setting.platform_key &&
    bochaSetting?.id === form.settings.web_search_setting.platform_setting_id
      ? `${form.settings.web_search_setting.platform_setting_id}_53aikm_${form.settings.web_search_setting.platform_key}`
      : "";

  const setSearchValue = (value: string) => {
    const [platform_setting_id, platform_key] = value.split("_53aikm_");
    setForm((prev: any) => {
      const next = deepCopy(prev);
      next.settings.web_search_setting.platform_setting_id =
        platform_setting_id;
      next.settings.web_search_setting.platform_key = platform_key;
      return next;
    });
  };

  const fastReasoningValue =
    form.settings.fast_reasoning_config.channel_id &&
    form.settings.fast_reasoning_config.model_name &&
    form.settings.fast_reasoning_config.channel_type
      ? `${form.settings.fast_reasoning_config.channel_id}_53aikm_${form.settings.fast_reasoning_config.model_name}_53aikm_${form.settings.fast_reasoning_config.channel_type}`
      : "";

  const setFastReasoningValue = (value: string) => {
    const [channel_id, model_name, channel_type] = value.split("_53aikm_");
    setForm((prev: any) => {
      const next = deepCopy(prev);
      next.settings.fast_reasoning_config.channel_id = Number(channel_id);
      next.settings.fast_reasoning_config.model_name = model_name;
      next.settings.fast_reasoning_config.channel_type = Number(channel_type);
      return next;
    });
  };

  const deepThinkingValue =
    form.settings.deep_thinking_config.channel_id &&
    form.settings.deep_thinking_config.model_name &&
    form.settings.deep_thinking_config.channel_type
      ? `${form.settings.deep_thinking_config.channel_id}_53aikm_${form.settings.deep_thinking_config.model_name}_53aikm_${form.settings.deep_thinking_config.channel_type}`
      : "";

  const setDeepThinkingValue = (value: string) => {
    const [channel_id, model_name, channel_type] = value.split("_53aikm_");
    setForm((prev: any) => {
      const next = deepCopy(prev);
      next.settings.deep_thinking_config.channel_id = Number(channel_id);
      next.settings.deep_thinking_config.model_name = model_name;
      next.settings.deep_thinking_config.channel_type = Number(channel_type);
      return next;
    });
  };

  const loadModelList = async (agent_id: number, currentForm: any) => {
    try {
      const result = await agentsApi.models.list(agent_id);
      const models = result.agent_models;
      const fastModels = models.find(
        (item: any) => !item.model_meta.deep_thinking,
      );
      const deepModels = models.find(
        (item: any) => item.model_meta.deep_thinking,
      );

      setForm((prev: any) => {
        const next = deepCopy(prev);
        if (fastModels) {
          next.settings.fast_reasoning_config.channel_id =
            fastModels.channel_id;
          next.settings.fast_reasoning_config.model_name = fastModels.model;
          next.settings.fast_reasoning_config.channel_type =
            fastModels.channel_type;
        }
        if (deepModels) {
          next.settings.deep_thinking_config.channel_id = deepModels.channel_id;
          next.settings.deep_thinking_config.model_name = deepModels.model;
          next.settings.deep_thinking_config.channel_type =
            deepModels.channel_type;
        }
        return next;
      });
    } catch (e) {
      console.error(e);
    }
  };

  const loadList = async () => {
    setIsLoading(true);
    try {
      const result = await agentsApi.list({
        agent_usages: AGENT_USAGES.KM_AI_SEARCH,
      });
      const agent = result.agents[0]
        ? transformAgentInfo(result.agents[0])
        : deepCopy(DEFAULT_SETTINGS);

      const newForm = assign(deepCopy(DEFAULT_SETTINGS), agent, {
        settings: {
          rerank_config: {
            vector: true,
            fulltext: false,
            hybrid: false,
            reranking_enable: true,
            score_threshold_enabled: true,
          },
        },
      });
      setForm(newForm);

      if (agent.agent_id) {
        onAgentChange?.(agent);
        await loadModelList(agent.agent_id, newForm);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const loadBochaSetting = async () => {
    try {
      const result = await platformSettingsApi.find({
        platform_key: "bochaai",
      });
      if (result && result.length > 0) {
        setBochaSetting(transformPlatformSetting(result[0]));
        setSearchOptions([
          {
            label: "博查（API）",
            value: `${result[0].id}_53aikm_bochaai`,
            icon:
              (window as any).$getRealPath?.({
                url: "/images/tools/bocha.png",
              }) || "/images/tools/bocha.png",
          },
        ]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadList();
    loadBochaSetting();
  }, []);

  useEffect(() => {
    onLoading?.(isLoading);
  }, [isLoading, onLoading]);

  const handleAddQuestion = () => {
    setForm((prev: any) => {
      const next = deepCopy(prev);
      next.settings.suggested_questions.push({
        id: generateRandomId(10),
        content: "",
      });
      return next;
    });
  };

  const handleDelQuestion = (id: string | number) => {
    setForm((prev: any) => {
      const next = deepCopy(prev);
      next.settings.suggested_questions =
        next.settings.suggested_questions.filter((item: any) => item.id !== id);
      return next;
    });
  };

  const handleRerankMode = (mode: string) => {
    setForm((prev: any) => {
      const next = deepCopy(prev);
      next.settings.rerank_config.rerank_model = mode;
      return next;
    });
  };

  const handleWeightChange = (value: number) => {
    setForm((prev: any) => {
      const next = deepCopy(prev);
      next.settings.rerank_config.weights.vector_setting.vector_weight = value;
      next.settings.rerank_config.weights.keyword_setting.keyword_weight =
        Number((1 - value).toFixed(10));
      return next;
    });
  };

  const modelsSave = async (agent_id: number) => {
    const fastConfig = form.settings.fast_reasoning_config;
    const deepConfig = form.settings.deep_thinking_config;
    const modelList = [];
    if (fastConfig.enable) {
      modelList.push({
        channel_id: fastConfig.channel_id,
        channel_type: fastConfig.channel_type,
        model: fastConfig.model_name,
      });
    }
    if (deepConfig.enable) {
      modelList.push({
        channel_id: deepConfig.channel_id,
        channel_type: deepConfig.channel_type,
        model: deepConfig.model_name,
      });
    }
    await agentsApi.models.batch({
      agent_id,
      models: modelList,
    });
  };

  const handleSave = async () => {
    const data = deepCopy(form);
    const fastValueParts = fastReasoningValue.split("_53aikm_");
    if (data.settings.fast_reasoning_config.enable) {
      if (fastValueParts.length !== 3) {
        message.error(t("form_select_placeholder") + t("model.fast_reasoning"));
        return;
      }
    }

    if (data.settings.deep_thinking_config.enable) {
      const deepValueParts = deepThinkingValue.split("_53aikm_");
      if (deepValueParts.length !== 3) {
        message.error(t("form_select_placeholder") + t("model.deep_thinking"));
        return;
      }
    }

    if (
      data.settings.rerank_config.rerank_model ===
      RERANKING_MODE.RERANKING_MODEL
    ) {
      if (!rerankValue) {
        message.error(t("form_select_placeholder") + t("model.rerank"));
        return;
      }
    }

    if (!searchValue && data.settings.web_search_setting.enable) {
      message.error("请选择联网搜索");
      return;
    }

    data.channel_type = Number(fastValueParts[2]) || 0;
    data.model = fastValueParts[1] || "";

    data.settings.suggested_questions =
      data.settings.suggested_questions.filter((item: any) =>
        item.content.trim(),
      );
    data.settings.rerank_config.rerank_channel_id = Number(
      data.settings.rerank_config.rerank_channel_id,
    );

    // Ensure stringified structures before saving
    const payload = {
      ...data,
      configs: JSON.stringify(data.configs),
      tools: JSON.stringify(data.tools),
      use_cases: JSON.stringify(data.use_cases),
      custom_config: JSON.stringify(data.custom_config),
      settings: JSON.stringify(data.settings),
    };

    setSaving(true);
    try {
      let agent_id = 0;
      if (form.agent_id) {
        agent_id = form.agent_id;
        await agentsApi.update(form.agent_id, payload);
      } else {
        const result = await agentsApi.create(payload);
        agent_id = result.agent_id;
        setForm((prev: any) => ({ ...prev, agent_id }));
      }
      await modelsSave(agent_id);
      message.success(t("action_save_success"));
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white h-full">
      <Spin
        spinning={isLoading}
        classNames={{
          root: "h-full",
          container: "h-full p-6 overflow-y-auto",
        }}
      >
        <div className="max-w-3xl">
          {/* Model Setting */}
          <div className="flex mb-4">
            <div className="flex-none w-[100px] h-8 flex items-center">
              <span className="text-sm text-primary">
                {t("module.model_setting")}
              </span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-4 mb-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={form.settings.fast_reasoning_config.enable}
                    disabled
                  />
                  <span className="text-sm text-primary">
                    {t("model.fast_reasoning")}
                  </span>
                  <Tooltip
                    title={t("model.fast_reasoning_desc")}
                    placement="top"
                  >
                    <QuestionCircleOutlined className="text-hint cursor-help" />
                  </Tooltip>
                </div>
                <div className="flex-1">
                  <ModelSelectPopover
                    value={fastReasoningValue}
                    channelId={form.settings.fast_reasoning_config.channel_id}
                    modelName={form.settings.fast_reasoning_config.model_name}
                    temperature={
                      form.settings.fast_reasoning_config.temperature
                    }
                    type={MODEL_USE_TYPE.REASONING}
                    mode={REASONING_MODE.FAST}
                    onChange={setFastReasoningValue}
                    onTemperatureChange={(value) =>
                      setForm((prev: any) => {
                        const next = deepCopy(prev);
                        next.settings.fast_reasoning_config.temperature = value;
                        return next;
                      })
                    }
                  />
                </div>
              </div>
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={form.settings.deep_thinking_config.enable}
                    onChange={(e) =>
                      setForm((prev: any) => {
                        const next = deepCopy(prev);
                        next.settings.deep_thinking_config.enable =
                          e.target.checked;
                        return next;
                      })
                    }
                  />
                  <span className="text-sm text-primary">
                    {t("model.deep_thinking")}
                  </span>
                  <Tooltip
                    title={t("model.deep_thinking_desc")}
                    placement="top"
                  >
                    <QuestionCircleOutlined className="text-hint cursor-help" />
                  </Tooltip>
                </div>
                <div className="flex-1">
                  {form.settings.deep_thinking_config.enable && (
                    <ModelSelectPopover
                      value={deepThinkingValue}
                      channelId={form.settings.deep_thinking_config.channel_id}
                      modelName={form.settings.deep_thinking_config.model_name}
                      temperature={
                        form.settings.deep_thinking_config.temperature
                      }
                      type={MODEL_USE_TYPE.REASONING}
                      mode={REASONING_MODE.DEEP}
                      onChange={setDeepThinkingValue}
                      onTemperatureChange={(value) =>
                        setForm((prev: any) => {
                          const next = deepCopy(prev);
                          next.settings.deep_thinking_config.temperature =
                            value;
                          return next;
                        })
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Question Rewrite */}
          <div className="flex mb-4">
            <div className="flex-none w-[100px] h-8 flex items-center">
              <span className="text-sm text-primary">
                {t("module.question_rewrite")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.settings.question_rewrite_config.enable}
                onChange={(checked) =>
                  setForm((prev: any) => {
                    const next = deepCopy(prev);
                    next.settings.question_rewrite_config.enable = checked;
                    return next;
                  })
                }
              />
              <span className="text-sm text-secondary">
                {t("module.question_rewrite_desc")}
              </span>
            </div>
          </div>

          {/* Answer Preference */}
          <div className="flex mb-4">
            <div className="flex-none w-[100px] h-8 flex items-center">
              <span className="text-sm text-primary">
                {t("module.answer_preference")}
              </span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.settings.answer_preference_config.enable}
                  onChange={(checked) =>
                    setForm((prev: any) => {
                      const next = deepCopy(prev);
                      next.settings.answer_preference_config.enable = checked;
                      return next;
                    })
                  }
                />
                <span className="text-sm text-secondary">
                  {t("module.answer_preference_desc")}
                </span>
              </div>
              {form.settings.answer_preference_config.enable && (
                <div className="mt-3">
                  <Fullscreen
                    zIndex={99}
                    contentWidth="60%"
                    contentHeight="60%"
                    className="w-full"
                    maskClassName="!bg-[#00000080]"
                  >
                    {({ isFullscreen, toggleFullscreen }) => (
                      <div className="flex flex-col h-full">
                        {isFullscreen && (
                          <div className="flex-none h-10 px-4 border-b flex items-center justify-between bg-gray-50 rounded-t-lg">
                            <span className="text-sm font-medium">
                              {t("module.answer_preference")}
                            </span>
                            <Tooltip title={t("action_shrink")} placement="top">
                              <span
                                className="cursor-pointer"
                                onClick={toggleFullscreen}
                              >
                                <SvgIcon name="shrink" width="18px" />
                              </span>
                            </Tooltip>
                          </div>
                        )}
                        <div className="relative flex-1">
                          <Input.TextArea
                            value={
                              form.settings.answer_preference_config.content
                            }
                            onChange={(e) =>
                              setForm((prev: any) => {
                                const next = deepCopy(prev);
                                next.settings.answer_preference_config.content =
                                  e.target.value;
                                return next;
                              })
                            }
                            placeholder={t(
                              "module.answer_preference_placeholder",
                            )}
                            rows={isFullscreen ? 25 : 4}
                            maxLength={1500}
                            showCount
                            style={{ resize: "none" }}
                            className="w-full h-full"
                          />
                          {!isFullscreen && (
                            <div className="absolute right-2 top-2 z-10">
                              <Tooltip
                                title={t("action_amplify")}
                                placement="top"
                              >
                                <span
                                  className="cursor-pointer"
                                  onClick={toggleFullscreen}
                                >
                                  <SvgIcon name="amplify" width="16px" />
                                </span>
                              </Tooltip>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </Fullscreen>
                </div>
              )}
            </div>
          </div>

          {/* Knowledge Search */}
          <div className="flex mb-4">
            <div className="flex-none w-[100px] h-8 flex items-center">
              <span className="text-sm text-primary">
                {t("module.knowledge_library_search")}
              </span>
            </div>
            <div className="flex-1">
              <div className="border rounded p-4">
                {form.settings.rerank_config.hybrid && (
                  <div className="flex gap-4 mb-4">
                    <div
                      className={`flex-1 h-10 rounded border flex items-center justify-center gap-1 cursor-pointer text-sm ${
                        form.settings.rerank_config.rerank_model ===
                        RERANKING_MODE.WEIGHTED_SCORE
                          ? "border-[#2563EB] bg-[#F6F9FE] text-brand"
                          : "text-dark"
                      }`}
                      onClick={() =>
                        handleRerankMode(RERANKING_MODE.WEIGHTED_SCORE)
                      }
                    >
                      {t("module.weighted_score")}
                      <Tooltip
                        title={t("module.weighted_score_desc")}
                        placement="top"
                      >
                        <QuestionCircleOutlined className="text-hint" />
                      </Tooltip>
                    </div>
                    <div
                      className={`flex-1 h-10 rounded border flex items-center justify-center gap-1 cursor-pointer text-sm ${
                        form.settings.rerank_config.rerank_model ===
                        RERANKING_MODE.RERANKING_MODEL
                          ? "border-[#2563EB] bg-[#F6F9FE] text-brand"
                          : "text-dark"
                      }`}
                      onClick={() =>
                        handleRerankMode(RERANKING_MODE.RERANKING_MODEL)
                      }
                    >
                      {t("module.reranking_model")}
                      <Tooltip
                        title={t("module.reranking_model_desc")}
                        placement="top"
                      >
                        <QuestionCircleOutlined className="text-hint" />
                      </Tooltip>
                    </div>
                  </div>
                )}

                {form.settings.rerank_config.hybrid &&
                  form.settings.rerank_config.rerank_model ===
                    RERANKING_MODE.WEIGHTED_SCORE && (
                    <div className="mt-4 rounded border px-5 py-4">
                      <Slider
                        value={
                          form.settings.rerank_config.weights.vector_setting
                            .vector_weight
                        }
                        min={0}
                        max={1}
                        step={0.1}
                        onChange={handleWeightChange}
                      />
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[#2590F5]">
                          语义{" "}
                          {
                            form.settings.rerank_config.weights.vector_setting
                              .vector_weight
                          }
                        </span>
                        <span className="text-[#7575FF]">
                          关键词{" "}
                          {
                            form.settings.rerank_config.weights.keyword_setting
                              .keyword_weight
                          }
                        </span>
                      </div>
                    </div>
                  )}

                {(!form.settings.rerank_config.hybrid ||
                  form.settings.rerank_config.rerank_model ===
                    RERANKING_MODE.RERANKING_MODEL) && (
                  <div className="flex items-center">
                    <div className="flex-none w-[120px] flex items-center text-sm text-dark opacity-80">
                      {t("model.rerank")}
                      <Tooltip
                        title={t("module.reranking_desc")}
                        placement="top"
                      >
                        <QuestionCircleOutlined className="ml-2" />
                      </Tooltip>
                    </div>
                    <div className="flex-1">
                      {(form.settings.rerank_config.reranking_enable ||
                        form.settings.rerank_config.hybrid) && (
                        <ModelSelect
                          value={rerankValue}
                          onChange={setRerankValue}
                          type={MODEL_USE_TYPE.RERANKER}
                        />
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-center mt-3">
                  <div className="flex-none w-[120px] flex items-center text-sm text-dark opacity-80">
                    {t("module.recall_count")}
                    <Tooltip
                      title={t("module.recall_count_desc")}
                      placement="top"
                    >
                      <QuestionCircleOutlined className="ml-2" />
                    </Tooltip>
                  </div>
                  <div className="flex-1 flex items-center">
                    <Slider
                      value={form.settings.rerank_config.top_k}
                      min={1}
                      max={20}
                      className="flex-1"
                      onChange={(value) =>
                        setForm((prev: any) => {
                          const next = deepCopy(prev);
                          next.settings.rerank_config.top_k = value;
                          return next;
                        })
                      }
                    />
                    <span className="flex-none w-9 text-right text-sm opacity-80 text-dark">
                      {form.settings.rerank_config.top_k}
                    </span>
                  </div>
                </div>


                <div className="flex mt-3">
                  <div className="flex-none w-[120px] h-9 flex items-center text-sm text-dark opacity-80">
                    {t("module.reject_strategy")}
                    <Tooltip
                      title={t("module.out_of_range_reply")}
                      placement="top"
                    >
                      <QuestionCircleOutlined className="ml-2" />
                    </Tooltip>
                  </div>
                  <div className="flex-1">
                    <Radio.Group
                      value={form.settings.out_of_range_reply.mode}
                      onChange={(e) =>
                        setForm((prev: any) => {
                          const next = deepCopy(prev);
                          next.settings.out_of_range_reply.mode =
                            e.target.value;
                          return next;
                        })
                      }
                    >
                      <Radio value={OUT_REPLY_TYPE.FIXED_REPLY}>
                        {t("module.reject_strategy_fixed_reply")}
                      </Radio>
                      <Radio value={OUT_REPLY_TYPE.CONTINUE}>
                        {t("module.reject_strategy_continue")}
                      </Radio>
                    </Radio.Group>

                    {form.settings.out_of_range_reply.mode ===
                      OUT_REPLY_TYPE.FIXED_REPLY && (
                      <div className="mt-2.5 w-full">
                        <MarkdownEditor
                          value={form.settings.out_of_range_reply.reply}
                          onChange={(val) =>
                            setForm((prev: any) => {
                              const next = deepCopy(prev);
                              next.settings.out_of_range_reply.reply = val;
                              return next;
                            })
                          }
                          type="simple"
                          height="200px"
                        />
                      </div>
                    )}

                    {form.settings.out_of_range_reply.mode ===
                      OUT_REPLY_TYPE.CONTINUE && (
                      <div className="border rounded mt-2.5">
                        <div className="h-10 flex items-center px-4 text-sm text-secondary border-b">
                          {t("role_instruction_desc")}
                        </div>
                        <div>
                          <PromptInput
                            value={form.settings.out_of_range_reply.prompt}
                            onChange={(val) =>
                              setForm((prev: any) => {
                                const next = deepCopy(prev);
                                next.settings.out_of_range_reply.prompt = val;
                                return next;
                              })
                            }
                            showLine
                            wordWrap
                            style={{
                              flex: "none",
                              minHeight: "200px",
                              height: "max-content",
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Web Search */}
          <div className="flex mb-4">
            <div className="flex-none w-[100px] h-8 flex items-center">
              <span className="text-sm text-primary">
                {t("module.web_search")}
              </span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.settings.web_search_setting.enable}
                  onChange={(checked) =>
                    setForm((prev: any) => {
                      const next = deepCopy(prev);
                      next.settings.web_search_setting.enable = checked;
                      return next;
                    })
                  }
                />
                <span className="text-sm text-secondary">
                  {t("module.web_search_desc")}
                </span>
              </div>
              {form.settings.web_search_setting.enable && (
                <div className="border rounded p-5 space-y-4 mt-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-none w-[106px] text-sm text-primary">
                      {t("module.online_search_source")}
                    </div>
                    <SelectPlus
                      value={searchValue}
                      onChange={setSearchValue}
                      options={searchOptions}
                      useI18n={false}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-none w-[106px] text-sm text-primary">
                      {t("module.online_search_recall_count")}
                    </div>
                    <div className="flex-1 flex items-center">
                      <Slider
                        value={form.settings.web_search_setting.top_k}
                        min={1}
                        max={20}
                        className="flex-1"
                        onChange={(value) =>
                          setForm((prev: any) => {
                            const next = deepCopy(prev);
                            next.settings.web_search_setting.top_k = value;
                            return next;
                          })
                        }
                      />
                      <span className="flex-none w-9 text-right text-dark opacity-80 text-sm">
                        {form.settings.web_search_setting.top_k}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Graph Search */}
          <div className="flex mb-4">
            <div className="flex-none w-[100px] h-8 flex items-center">
              <span className="text-sm text-primary">
                {t("module.knowledge_graph")}
              </span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.settings.graph_search_setting.enable}
                  onChange={(checked) =>
                    setForm((prev: any) => {
                      const next = deepCopy(prev);
                      next.settings.graph_search_setting.enable = checked;
                      return next;
                    })
                  }
                />
                <span className="text-sm text-secondary">
                  {t("module.graph_search_desc")}
                </span>
              </div>
              {form.settings.graph_search_setting.enable && (
                <div className="border rounded p-4 mt-3">
                  <Checkbox
                    checked={form.settings.graph_search_setting.default_enable}
                    onChange={(e) =>
                      setForm((prev: any) => {
                        const next = deepCopy(prev);
                        next.settings.graph_search_setting.default_enable = e.target.checked;
                        return next;
                      })
                    }
                  >
                    {t("module.default_enable")}
                  </Checkbox>
                  <span className="text-placeholder text-xs">{t("module.default_enable_desc")}</span>
                </div>
              )}
            </div>
          </div>

          {/* Answer Note */}
          <div className="flex mb-4">
            <div className="flex-none w-[100px] h-8 flex items-center">
              <span className="text-sm text-primary">
                {t("module.answer_note")}
              </span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.settings.answer_remarks_config.enable}
                  onChange={(checked) =>
                    setForm((prev: any) => {
                      const next = deepCopy(prev);
                      next.settings.answer_remarks_config.enable = checked;
                      return next;
                    })
                  }
                />
                <span className="text-sm text-secondary">
                  {t("module.answer_note_desc")}
                </span>
              </div>
              {form.settings.answer_remarks_config.enable && (
                <Input
                  className="mt-3"
                  maxLength={100}
                  showCount
                  value={form.settings.answer_remarks_config.content}
                  onChange={(e) =>
                    setForm((prev: any) => {
                      const next = deepCopy(prev);
                      next.settings.answer_remarks_config.content =
                        e.target.value;
                      return next;
                    })
                  }
                />
              )}
            </div>
          </div>

          {/* Base Setting - Opening Statement */}
          <div className="flex mb-4">
            <div className="flex-none w-[100px] h-8 flex items-center">
              <span className="text-sm text-primary">
                {t("base_setting")}
              </span>
            </div>
            <div className="flex-1">
              <Input.TextArea
                rows={8}
                maxLength={200}
                showCount
                value={form.settings.opening_statement}
                onChange={(e) =>
                  setForm((prev: any) => {
                    const next = deepCopy(prev);
                    next.settings.opening_statement = e.target.value;
                    return next;
                  })
                }
                className="w-full"
                style={{ resize: "none" }}
              />
            </div>
          </div>

          {/* Suggested Questions */}
          <div className="flex mb-4">
            <div className="flex-none w-[100px] h-8 flex items-center">
              <span className="text-sm text-primary">
                {t("suggested_questions")}
              </span>
            </div>
            <div className="flex-1">
              <div className="w-full flex flex-col gap-4">
                <Sortable
                  value={form.settings.suggested_questions}
                  identity="id"
                  onChange={(newQuestions: any[]) => {
                    setForm((prev: any) => {
                      const next = deepCopy(prev);
                      next.settings.suggested_questions = newQuestions;
                      return next;
                    });
                  }}
                  renderItem={(item: any, index: number) => (
                    <div className="flex items-center border px-2 border-[#DCDFE6] rounded-sm bg-white mb-4">
                      <div className="sort-icon cursor-move">
                        <SvgIcon
                          name="drag"
                          width="16px"
                          height="32px"
                          color="#a1a5af"
                        />
                      </div>
                      <div className="flex-1 mx-2">
                        <Input
                          variant="borderless"
                          placeholder={t("form_input_placeholder")}
                          maxLength={50}
                          showCount
                          value={item.content}
                          onChange={(e) => {
                            setForm((prev: any) => {
                              const next = deepCopy(prev);
                              next.settings.suggested_questions[index].content =
                                e.target.value;
                              return next;
                            });
                          }}
                          className="w-full"
                        />
                      </div>
                      <SvgIcon
                        name="delete"
                        className="ml-4 cursor-pointer text-dark opacity-40 hover:opacity-80"
                        onClick={() => handleDelQuestion(item.id)}
                      />
                    </div>
                  )}
                />
              </div>
              <div className="flex items-center gap-2 mt-4">
                <Button
                  type="primary"
                  ghost
                  disabled={
                    form.settings.suggested_questions.length >=
                    MAX_QUESTION_LENGTH
                  }
                  onClick={handleAddQuestion}
                >
                  +{t("action_add")}
                </Button>
                <p className="text-sm text-placeholder">
                  {t("max_add_tip", { max: MAX_QUESTION_LENGTH })}
                </p>
              </div>
            </div>
          </div>
        </div>

        <Divider />
        <div className="pb-6">
          <Button type="primary" loading={saving} onClick={handleSave}>
            {t("action_save")}
          </Button>
        </div>
      </Spin>
    </div>
  );
  }
);

SearchSettingPage.displayName = "SearchSettingPage";

export default SearchSettingPage;
