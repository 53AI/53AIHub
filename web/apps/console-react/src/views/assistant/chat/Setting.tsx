import {
    useState,
    useEffect,
    useImperativeHandle,
    forwardRef,
    useRef,
    useMemo,
} from "react";
import { Checkbox, Switch, Button, Slider, message, Spin } from "antd";
import { t } from "@/locales";
import agentsApi from "@/api/modules/agents/index";
import { AGENT_USAGES } from "@/constants/agent";
import { transformAgentInfo } from "@/api/modules/agents/transform";
import type { AgentInfo } from "@/api/modules/agents/index";
import groupApi from "@/api/modules/group";
import platformSettingsApi from "@/api/modules/platform-settings";
import { transformPlatformSetting } from "@/api/modules/platform-settings/transform";
import type { PlatformSetting } from "@/api/modules/platform-settings/types";
import promptApi from "@/api/modules/prompt";
import { GROUP_TYPE } from "@/constants/group";
import { MODEL_USE_TYPE, REASONING_MODE } from "@/constants/platform/config";
import { useEnterpriseStore } from "@/stores/modules/enterprise";
import ModelSelectPopover from "@/components/Model/select-popover";
import SelectPlus from "@/components/SelectPlus";
import QuickerDialog, { QuickerDialogRef } from "./components/QuickerDialog";
import SlideDialog, { SlideDialogRef } from "./components/SlideDialog";
import { deepCopy, assign } from "@/utils";

export interface ChatSettingRef {
  handleStatusChange: (enable: boolean) => void;
}

interface ChatSettingProps {
  onAgentChange?: (agent: AgentInfo) => void;
  onLoading?: (loading: boolean) => void;
}

const RERANKING_MODE = {
  WEIGHTED_SCORE: "weighted_score",
  RERANKING_MODEL: "reranking_model",
};

const getDefaultSettings = (enterpriseName: string) => ({
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
    opening_statement: `你好，我是${enterpriseName}助手。无论你有什么问题，我都会尽我所能为你提供帮助和支持。`,
    suggested_questions: [],
    out_of_range_reply: {
      enable: false,
      reply: "当前问题可能因内容未收录、解析中或权限限制无法解答。",
    },
    rerank_config: {
      fulltext: false,
      hybrid: false,
      rerank_model: RERANKING_MODE.RERANKING_MODEL,
      score_threshold: 0.8,
      top_k: 10,
      vector: true,
      rerank_channel_id: 0,
      rerank_model_name: "",
      reranking_enable: false,
      score_threshold_enabled: false,
      weights: {
        keyword_setting: {
          keyword_weight: 1,
        },
        vector_setting: {
          vector_weight: 0,
        },
      },
    },
    question_rewrite_config: {
      enable: false,
    },
    web_search_setting: {
      enable: false,
      platform_setting_id: "",
      platform_key: "",
      top_k: 20,
    },
    generate_summary: {
      enable: false,
    },
    generate_suggested_questions: {
      enable: false,
    },
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
  agent_usage: AGENT_USAGES.KM_FILE_CHAT,
});

export const ChatSetting = forwardRef<ChatSettingRef, ChatSettingProps>(
  ({ onAgentChange, onLoading }, ref) => {
    const enterpriseStore = useEnterpriseStore();
    const [isLoading, setIsLoading] = useState(false);
    const [agent, setAgent] = useState<AgentInfo | null>(null);
    const [form, setForm] = useState<any>({});
    const [bochaSetting, setBochaSetting] = useState<PlatformSetting | null>(
      null,
    );

    const [quickGroup, setQuickGroup] = useState<any>(null);
    const [quickCommandList, setQuickCommandList] = useState<any[]>([]);
    const [slideGroup, setSlideGroup] = useState<any>(null);
    const [slideCommandList, setSlideCommandList] = useState<any[]>([]);
    const [searchOptions, setSearchOptions] = useState<any[]>([]);

    const quickerDialogRef = useRef<QuickerDialogRef>(null);
    const slideDialogRef = useRef<SlideDialogRef>(null);

    useEffect(() => {
      onLoading?.(isLoading);
    }, [isLoading, onLoading]);

    const fastReasoningValue = useMemo(() => {
      const { channel_id, model_name, channel_type } =
        form.settings?.fast_reasoning_config || {};
      return channel_id && model_name && channel_type
        ? `${channel_id}_53aikm_${model_name}_53aikm_${channel_type}`
        : "";
    }, [form.settings?.fast_reasoning_config]);

    const deepThinkingValue = useMemo(() => {
      const { channel_id, model_name, channel_type } =
        form.settings?.deep_thinking_config || {};
      return channel_id && model_name && channel_type
        ? `${channel_id}_53aikm_${model_name}_53aikm_${channel_type}`
        : "";
    }, [form.settings?.deep_thinking_config]);

    const searchValue = useMemo(() => {
      const setting = form.settings?.web_search_setting || {};
      return setting.platform_setting_id &&
        setting.platform_key &&
        bochaSetting?.id === setting.platform_setting_id
        ? `${setting.platform_setting_id}_53aikm_${setting.platform_key}`
        : "";
    }, [form.settings?.web_search_setting, bochaSetting]);

    const getFastReasoningValue = () => fastReasoningValue;
    const getDeepThinkingValue = () => deepThinkingValue;
    const getSearchValue = () => searchValue;

    const setFastReasoningValue = (value: string) => {
      if (!value) return;
      const [channel_id, model_name, channel_type] = value.split("_53aikm_");
      setForm((prev: any) => ({
        ...prev,
        settings: {
          ...prev.settings,
          fast_reasoning_config: {
            ...prev.settings.fast_reasoning_config,
            channel_id: Number(channel_id),
            model_name,
            channel_type: Number(channel_type),
          },
        },
      }));
    };

    const setDeepThinkingValue = (value: string) => {
      if (!value) return;
      const [channel_id, model_name, channel_type] = value.split("_53aikm_");
      setForm((prev: any) => ({
        ...prev,
        settings: {
          ...prev.settings,
          deep_thinking_config: {
            ...prev.settings.deep_thinking_config,
            channel_id: Number(channel_id),
            model_name,
            channel_type: Number(channel_type),
          },
        },
      }));
    };

    const setSearchValue = (value: string) => {
      if (!value) return;
      const [platform_setting_id, platform_key] = value.split("_53aikm_");
      setForm((prev: any) => ({
        ...prev,
        settings: {
          ...prev.settings,
          web_search_setting: {
            ...prev.settings.web_search_setting,
            platform_setting_id,
            platform_key,
          },
        },
      }));
    };

    useImperativeHandle(ref, () => ({
      handleStatusChange: async (enable: boolean) => {
        if (agent?.agent_id) {
          await agentsApi.status(agent.agent_id, { enable });
          const updatedAgent = { ...agent, enable };
          setAgent(updatedAgent);
          setForm((prev: any) => ({ ...prev, enable }));
          onAgentChange?.(updatedAgent);
          message.success(
            enable ? t("action_enable_success") : t("action_disable_success"),
          );
        }
      },
    }));

    const loadModelList = async (agentId: number, currentForm: any) => {
      const result = await agentsApi.models.list(agentId);
      const models = result.agent_models;
      const fastModels = models.find(
        (item: any) => !item.model_meta?.deep_thinking,
      );
      const deepModels = models.find(
        (item: any) => item.model_meta?.deep_thinking,
      );
      if (fastModels) {
        setForm((prev: any) => ({
          ...prev,
          settings: {
            ...prev.settings,
            fast_reasoning_config: {
              ...prev.settings.fast_reasoning_config,
              channel_id: fastModels.channel_id,
              model_name: fastModels.model,
              channel_type: fastModels.channel_type,
            },
          },
        }));
      }
      if (deepModels) {
        setForm((prev: any) => ({
          ...prev,
          settings: {
            ...prev.settings,
            deep_thinking_config: {
              ...prev.settings.deep_thinking_config,
              channel_id: deepModels.channel_id,
              model_name: deepModels.model,
              channel_type: deepModels.channel_type,
            },
          },
        }));
      }
    };

    const loadQuickCommandList = async () => {
      const result = await groupApi.list({
        params: { group_type: GROUP_TYPE.KM_FILE_CHAT_QUICK_COMMAND },
      });
      if (result.length > 0) {
        setQuickGroup(result[0]);
        const promptResult = await promptApi.list({
          params: { group_id: result[0].group_id, limit: 100 },
        });
        setQuickCommandList(promptResult.list);
      }
    };

    const loadSlideCommandList = async () => {
      const result = await groupApi.list({
        params: { group_type: GROUP_TYPE.KM_FILE_CHAT_SLIDE_COMMAND },
      });
      if (result.length > 0) {
        setSlideGroup(result[0]);
        const promptResult = await promptApi.list({
          params: { group_id: result[0].group_id, limit: 100 },
        });
        setSlideCommandList(promptResult.list);
      }
    };

    const loadBochaSetting = async () => {
      const result = await platformSettingsApi.find({
        platform_key: "bochaai",
      });
      if (result && result.length > 0) {
        const setting = transformPlatformSetting(result[0]);
        setBochaSetting(setting);
        setSearchOptions([
          {
            label: "博查（API）",
            value: `${result[0].id}_53aikm_bochaai`,
            icon: window.$getRealPath?.({ url: "/images/tools/bocha.png" }),
          },
        ]);
      }
    };

    const modelsSave = async (agentId: number, currentForm: any) => {
      const fastConfig = currentForm.settings?.fast_reasoning_config;
      const deepConfig = currentForm.settings?.deep_thinking_config;
      const modelList = [];
      if (
        fastConfig?.enable &&
        fastConfig.channel_id &&
        fastConfig.model_name
      ) {
        modelList.push({
          channel_id: fastConfig.channel_id,
          channel_type: fastConfig.channel_type,
          model: fastConfig.model_name,
        });
      }
      if (
        deepConfig?.enable &&
        deepConfig.channel_id &&
        deepConfig.model_name
      ) {
        modelList.push({
          channel_id: deepConfig.channel_id,
          channel_type: deepConfig.channel_type,
          model: deepConfig.model_name,
        });
      }
      if (modelList.length) {
        await agentsApi.models.batch({
          agent_id: agentId,
          models: modelList,
        });
      }
    };

    const handleQuickCommandManage = () => {
      if (!quickGroup?.group_id) return;
      quickerDialogRef.current?.open(quickGroup, quickCommandList);
    };

    const handleSlideCommandManage = () => {
      if (!slideGroup?.group_id) return;
      slideDialogRef.current?.open(slideGroup, slideCommandList);
    };

    const handleSave = async (noverify = false, formData?: any) => {
      const data = deepCopy(formData || form);
      if (!noverify) {
        const fastValue = getFastReasoningValue().split("_53aikm_");
        if (data.settings.fast_reasoning_config?.enable) {
          if (fastValue.length !== 3) {
            message.error(
              t("form_select_placeholder") + t("model.fast_reasoning"),
            );
            return;
          }
        }

        if (data.settings.deep_thinking_config?.enable) {
          const deepValue = getDeepThinkingValue().split("_53aikm_");
          if (deepValue.length !== 3) {
            message.error(
              t("form_select_placeholder") + t("model.deep_thinking"),
            );
            return;
          }
        }

        if (!getSearchValue() && data.settings.web_search_setting?.enable) {
          message.error("请选择联网搜索");
          return;
        }
      }

      const fastConfig = form.settings?.fast_reasoning_config;
      if (fastConfig?.channel_id && fastConfig?.model_name) {
        data.channel_type = fastConfig.channel_type;
        data.model = fastConfig.model_name;
      } else {
        data.model = "deepseek-chat";
      }

      data.configs = JSON.stringify(data.configs);
      data.tools = JSON.stringify(data.tools);
      data.use_cases = JSON.stringify(data.use_cases);
      data.custom_config = JSON.stringify(data.custom_config);
      data.settings = JSON.stringify(data.settings);

      let agent_id = 0;
      if (form.agent_id) {
        agent_id = form.agent_id;
        await agentsApi.update(form.agent_id, data);
        message.success(t("action_save_success"));
      } else {
        const result = await agentsApi.create(data);
        agent_id = result.agent_id;
        setForm((prev: any) => ({ ...prev, agent_id }));
      }
      await modelsSave(agent_id, form);
    };

    const loadData = async () => {
      setIsLoading(true);
      try {
        const DEFAULT_SETTINGS = getDefaultSettings(
          enterpriseStore.info?.name || "",
        );
        const result = await agentsApi.list({
          agent_usages: AGENT_USAGES.KM_FILE_CHAT,
        });
        const agentChat = result.agents.find(
          (a: any) => a.agent_usage === AGENT_USAGES.KM_FILE_CHAT,
        );
        const agentData = agentChat
          ? transformAgentInfo(agentChat)
          : deepCopy(DEFAULT_SETTINGS);
        const newForm = assign(deepCopy(DEFAULT_SETTINGS), agentData, {
          settings: {
            out_of_range_reply: {
              enable: false,
            },
          },
        });
        setForm(newForm);

        if (agentChat) {
          setAgent(agentData);
          onAgentChange?.(agentData);
          loadModelList(agentData.agent_id, newForm);
          loadQuickCommandList();
          loadSlideCommandList();
        } else {
          await handleSave(true, newForm);
        }
      } finally {
        setIsLoading(false);
      }
    };

    useEffect(() => {
      loadData();
      loadBochaSetting();
    }, []);

    return (
      <Spin
        spinning={isLoading}
        classNames={{
          root: "h-full",
          container: "h-full overflow-y-auto",
        }}
      >
        <div className="flex-1 flex flex-col bg-white mt-3 box-border">
          <div className="max-w-3xl">
            {/* Model Setting */}
            <div className="flex mb-4">
              <div className="flex-none w-[100px] h-8 flex items-center justify-between gap-2">
                <div className="text-sm text-primary">
                  {t("module.model_setting")}
                </div>
              </div>
              <div className="mb-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={form.settings?.fast_reasoning_config?.enable}
                    disabled
                  />
                  <div className="text-sm text-primary">
                    {t("model.fast_reasoning")}
                  </div>
                  <span className="text-xs text-placeholder">
                    {t("model.fast_reasoning_desc")}
                  </span>
                </div>
                <ModelSelectPopover
                  value={getFastReasoningValue()}
                  channelId={form.settings?.fast_reasoning_config?.channel_id}
                  modelName={form.settings?.fast_reasoning_config?.model_name}
                  temperature={
                    form.settings?.fast_reasoning_config?.temperature
                  }
                  type={MODEL_USE_TYPE.REASONING}
                  mode={REASONING_MODE.FAST}
                  onChange={setFastReasoningValue}
                  onTemperatureChange={(val) =>
                    setForm((prev: any) => ({
                      ...prev,
                      settings: {
                        ...prev.settings,
                        fast_reasoning_config: {
                          ...prev.settings.fast_reasoning_config,
                          temperature: val,
                        },
                      },
                    }))
                  }
                />

                <div className="flex items-center gap-2 mt-2">
                  <Checkbox
                    checked={form.settings?.deep_thinking_config?.enable}
                    onChange={(e) =>
                      setForm((prev: any) => ({
                        ...prev,
                        settings: {
                          ...prev.settings,
                          deep_thinking_config: {
                            ...prev.settings.deep_thinking_config,
                            enable: e.target.checked,
                          },
                        },
                      }))
                    }
                  />
                  <div className="text-sm text-primary">
                    {t("model.deep_thinking")}
                  </div>
                  <span className="text-xs text-placeholder">
                    {t("model.deep_thinking_desc")}
                  </span>
                </div>
                {form.settings?.deep_thinking_config?.enable && (
                  <ModelSelectPopover
                    value={getDeepThinkingValue()}
                    channelId={form.settings?.deep_thinking_config?.channel_id}
                    modelName={form.settings?.deep_thinking_config?.model_name}
                    temperature={
                      form.settings?.deep_thinking_config?.temperature
                    }
                    type={MODEL_USE_TYPE.REASONING}
                    mode={REASONING_MODE.DEEP}
                    onChange={setDeepThinkingValue}
                    onTemperatureChange={(val) =>
                      setForm((prev: any) => ({
                        ...prev,
                        settings: {
                          ...prev.settings,
                          deep_thinking_config: {
                            ...prev.settings.deep_thinking_config,
                            temperature: val,
                          },
                        },
                      }))
                    }
                  />
                )}
              </div>
            </div>

            {/* Web Search */}
            <div className="flex mb-4">
              <div className="flex-none w-[100px] h-8 flex items-center justify-between gap-2">
                <div className="text-sm text-primary">
                  {t("module.web_search")}
                </div>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.settings?.web_search_setting?.enable}
                    onChange={(checked) =>
                      setForm((prev: any) => ({
                        ...prev,
                        settings: {
                          ...prev.settings,
                          web_search_setting: {
                            ...prev.settings.web_search_setting,
                            enable: checked,
                          },
                        },
                      }))
                    }
                  />
                  <span className="text-sm text-secondary">
                    {t("module.web_search_desc")}
                  </span>
                </div>
                {form.settings?.web_search_setting?.enable && (
                  <div className="border rounded p-5 space-y-4 mt-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-none w-[106px] text-sm text-primary">
                        {t("module.online_search_source")}
                      </div>
                      <SelectPlus
                        value={getSearchValue()}
                        useI18n={false}
                        options={searchOptions}
                        onChange={setSearchValue}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-none w-[106px] text-sm text-primary">
                        {t("module.online_search_recall_count")}
                      </div>
                      <div className="flex-1 flex items-center">
                        <Slider
                          className="flex-1"
                          min={1}
                          max={20}
                          step={1}
                          value={form.settings?.web_search_setting?.top_k || 20}
                          onChange={(val) =>
                            setForm((prev: any) => ({
                              ...prev,
                              settings: {
                                ...prev.settings,
                                web_search_setting: {
                                  ...prev.settings.web_search_setting,
                                  top_k: val,
                                },
                              },
                            }))
                          }
                        />
                        <span className="flex-none w-9 text-right text-dark text-sm">
                          {form.settings?.web_search_setting?.top_k || 20}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Question Rewrite */}
            <div className="flex mb-4">
              <div className="flex-none w-[100px] h-8 flex items-center justify-between gap-2">
                <div className="text-sm text-primary">
                  {t("module.question_rewrite")}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.settings?.question_rewrite_config?.enable}
                  onChange={(checked) =>
                    setForm((prev: any) => ({
                      ...prev,
                      settings: {
                        ...prev.settings,
                        question_rewrite_config: {
                          ...prev.settings.question_rewrite_config,
                          enable: checked,
                        },
                      },
                    }))
                  }
                />
                <span className="text-sm text-secondary">
                  {t("module.question_rewrite_desc")}
                </span>
              </div>
            </div>

            {/* Generate Summary */}
            <div className="flex mb-4">
              <div className="flex-none w-[100px] h-8 flex items-center justify-between gap-2">
                <div className="text-sm text-primary">
                  {t("module.generate_summary")}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.settings?.generate_summary?.enable}
                  onChange={(checked) =>
                    setForm((prev: any) => ({
                      ...prev,
                      settings: {
                        ...prev.settings,
                        generate_summary: {
                          ...prev.settings.generate_summary,
                          enable: checked,
                        },
                      },
                    }))
                  }
                />
                <span className="text-sm text-secondary">
                  {t("module.generate_summary_desc")}
                </span>
              </div>
            </div>

            {/* Suggested Questions */}
            <div className="flex mb-4">
              <div className="flex-none w-[100px] h-8 flex items-center justify-between gap-2">
                <div className="text-sm text-primary">
                  {t("module.generate_suggested_questions")}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.settings?.generate_suggested_questions?.enable}
                  onChange={(checked) =>
                    setForm((prev: any) => ({
                      ...prev,
                      settings: {
                        ...prev.settings,
                        generate_suggested_questions: {
                          ...prev.settings.generate_suggested_questions,
                          enable: checked,
                        },
                      },
                    }))
                  }
                />
                <span className="text-sm text-secondary">
                  {t("module.generate_suggested_questions_desc")}
                </span>
              </div>
            </div>

            {/* Quick Command */}
            <div className="flex mb-4">
              <div className="flex-none w-[100px] h-8 flex items-center justify-between gap-2">
                <div className="text-sm text-primary">
                  {t("module.quick_command")}
                </div>
              </div>
              <div className="flex-1 flex gap-2.5 items-center flex-wrap">
                {quickCommandList.map((item) => (
                  <div
                    key={item.prompt_id}
                    className="h-8 px-3 border rounded flex items-center text-sm text-primary"
                  >
                    {item.name}
                  </div>
                ))}
                <Button type="link" onClick={handleQuickCommandManage}>
                  {t("action_manage")}
                </Button>
              </div>
            </div>

            {/* Slide Command */}
            <div className="flex mb-4">
              <div className="flex-none w-[100px] h-8 flex items-center justify-between gap-2">
                <div className="text-sm text-primary">
                  {t("module.slide_command")}
                </div>
              </div>
              <div className="flex-1 flex gap-2.5 items-center flex-wrap">
                {slideCommandList.map((item) => (
                  <div
                    key={item.prompt_id}
                    className="h-8 px-3 border rounded flex items-center text-sm text-primary"
                  >
                    {item.name}
                  </div>
                ))}
                <Button type="link" onClick={handleSlideCommandManage}>
                  {t("action_manage")}
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <Button
              type="primary"
              onClick={() => handleSave(false)}
              loading={isLoading}
            >
              {t("action_save")}
            </Button>
          </div>

          <QuickerDialog
            ref={quickerDialogRef}
            onChange={() => {
              loadQuickCommandList();
            }}
          />
          <SlideDialog
            ref={slideDialogRef}
            onChange={() => {
              loadSlideCommandList();
            }}
          />
        </div>
      </Spin>
    );
  },
);

export default ChatSetting;
