import { useState, useEffect, useImperativeHandle, forwardRef } from "react";
import { Button, message, Spin } from "antd";
import { t } from "@/locales";
import agentsApi from "@/api/modules/agents/index";
import { AGENT_USAGES } from "@/constants/agent";
import { transformAgentInfo } from "@/api/modules/agents/transform";
import type { AgentInfo } from "@/api/modules/agents/index";
import settingApi from "@/api/modules/setting";
import ModelSelect from "@/components/Model/select";
import { deepCopy, assign } from "@/utils";
import { useSettingStore } from "@/stores/modules/setting";

export interface MapSettingRef {
  handleStatusChange: (enable: boolean) => void;
}

interface MapSettingProps {
  onAgentChange?: (agent: AgentInfo) => void;
  onLoading?: (loading: boolean) => void;
}

const SETTING_KEY = "km_knowledge_map_setting";

const DEFAULT_SETTINGS = {
  name: "知识地图",
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
    agent_mode: "chat",
  },
  settings: {
    auto_generate_map_config: {
      enable: false,
      content: "",
    },
  },
  agent_usage: AGENT_USAGES.KM_MAP,
};

export const MapSetting = forwardRef<MapSettingRef, MapSettingProps>(
  ({ onAgentChange, onLoading }, ref) => {
    const settingStore = useSettingStore();
    const [isLoading, setIsLoading] = useState(false);
    const [form, setForm] = useState<any>(deepCopy(DEFAULT_SETTINGS));
    const [settingId, setSettingId] = useState<number>(0);

    useEffect(() => {
      onLoading?.(isLoading);
    }, [isLoading, onLoading]);

    const getLogicValue = () => {
      const { channel_type, model, custom_config } = form;
      const channel_id = custom_config?.channel_id;
      return channel_type && model && channel_id
        ? `${channel_id}_53aikm_${model}_53aikm_${channel_type}`
        : "";
    };

    const setLogicValue = (value: string) => {
      if (!value) return;
      const [channel_id, model, channel_type] = value.split("_53aikm_");
      setForm((prev: any) => ({
        ...prev,
        custom_config: {
          ...prev.custom_config,
          channel_id: Number(channel_id),
        },
        channel_type: Number(channel_type),
        model,
      }));
    };

    useImperativeHandle(ref, () => ({
      handleStatusChange: (enable: boolean) => {
        const newForm = { ...form, enable };
        setForm(newForm);
        onAgentChange?.(newForm);
      },
    }));

    const saveSetting = async (currentForm: any, currentSettingId: number) => {
      const data = {
        key: SETTING_KEY,
        value: JSON.stringify({
          enabled: currentForm.enable,
          auto_generate: currentForm.settings.auto_generate_map_config.enable,
        }),
      };
      let sid = currentSettingId;
      if (!sid) {
        const result = await settingApi.get(SETTING_KEY);
        if (result.data) {
          sid = result.data.setting_id;
          setSettingId(sid);
        }
      }
      if (sid) {
        settingStore.saveSetting(sid, data);
      }
    };

    const handleSave = async (noverify = false, currentForm = form) => {
      const data = deepCopy(currentForm);
      if (!noverify) {
        if (!getLogicValue()) {
          message.error("请选择生成模型");
          return;
        }
      } else {
        data.model = data.model || "deepseek-chat";
      }

      data.configs = JSON.stringify(data.configs);
      data.tools = JSON.stringify(data.tools);
      data.use_cases = JSON.stringify(data.use_cases);
      data.custom_config = JSON.stringify(data.custom_config);
      data.settings = JSON.stringify(data.settings);

      let agent_id = 0;
      if (currentForm.agent_id) {
        agent_id = currentForm.agent_id;
        await agentsApi.update(currentForm.agent_id, data);
        message.success(t("action_save_success"));
      } else {
        const result = await agentsApi.create(data);
        agent_id = result.agent_id;
        currentForm.agent_id = agent_id;
        setForm({ ...currentForm });
      }
      await saveSetting(currentForm, settingId);
    };

    const loadList = async () => {
      setIsLoading(true);
      try {
        const result = await agentsApi.list({
          agent_usages: AGENT_USAGES.KM_MAP,
        });
        const agent = result.agents[0]
          ? transformAgentInfo(result.agents[0])
          : deepCopy(DEFAULT_SETTINGS);

        const newForm = assign(deepCopy(DEFAULT_SETTINGS), agent, {
          settings: {
            out_of_range_reply: {
              enable: false,
            },
          },
        });

        setForm(newForm);

        if (!agent.agent_id) {
          await handleSave(true, newForm);
        }
        onAgentChange?.(newForm);
      } finally {
        setIsLoading(false);
      }
    };

    useEffect(() => {
      loadList();
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
          <div className="max-w-2xl">
            <div className="flex mb-4">
              <div className="flex-none w-[100px] h-8 flex items-center justify-between gap-2">
                <div className="text-sm text-primary">
                  {t("model.select_model")}
                </div>
              </div>
              <div className="flex-1">
                <ModelSelect
                  value={getLogicValue()}
                  onChange={setLogicValue}
                  valueKey="model_value"
                />
              </div>
            </div>
            {/* <div className="flex mb-4">
              <div className="flex-none w-[100px] h-8 flex items-center justify-between gap-2">
                <div className="text-sm text-primary">{t("form.generate_rule")}</div>
              </div>
              <div className="flex-1">
                <div className="border rounded-lg px-5 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-primary">{t("form.auto_generate_map_config")}</div>
                    <Switch
                      checked={form.settings?.auto_generate_map_config?.enable}
                      onChange={(checked) => {
                        setForm((prev: any) => ({
                          ...prev,
                          settings: {
                            ...prev.settings,
                            auto_generate_map_config: {
                              ...prev.settings.auto_generate_map_config,
                              enable: checked,
                            },
                          },
                        }));
                      }}
                    />
                  </div>
                  <div className="text-xs text-disabled mt-1">{t("form.auto_generate_map_config_desc")}</div>
                </div>
              </div>
            </div> */}
          </div>
          <div className="mt-6">
            <Button type="primary" onClick={() => handleSave(false, form)}>
              {t("action_save")}
            </Button>
          </div>
        </div>
      </Spin>
    );
  },
);

export default MapSetting;
