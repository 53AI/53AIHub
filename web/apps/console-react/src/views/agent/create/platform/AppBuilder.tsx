import { forwardRef, useImperativeHandle, useState, useEffect } from "react";
import { Form, Select } from "antd";
import { t } from "@/locales";
import { useAgentFormStore } from "../store";
import { useAgentForm, createValidateForm } from "../hooks";
import { AgentInfo, BaseConfig, ExpandConfig, UseScope, RelateAgents } from "../components";
import { SelectPlus } from "@/components/SelectPlus";
import providersApi from "@/api/modules/providers/index";
import { transformProviderList } from "@/api/modules/providers/transform";
import { ProviderItem } from "@/api/modules/providers/types";
import agentApi, {
    AppBuilderBotItem,
    transformAppBuilderBotItem,
} from "@/api/modules/agent";
import { PROVIDER_VALUES } from "@/constants/platform/config";

interface AppBuilderProps {
  showChannelConfig?: boolean;
  className?: string;
}

export interface AppBuilderRef {
  validateForm: () => Promise<boolean>;
}

interface BotOption {
  value: string;
  label: string;
  icon?: string;
}

export const AppBuilder = forwardRef<AppBuilderRef, AppBuilderProps>(
  ({ showChannelConfig, className }, ref) => {
    const [form] = Form.useForm();
    const [providers, setProviders] = useState<ProviderItem[]>([]);
    const [bots, setBots] = useState<BotOption[]>([]);

    // 使用 hook 获取状态和方法
    const { formData, updateCustomConfig } = useAgentForm();
    const customConfig = formData.custom_config;

    const loadBots = async () => {
      const store = useAgentFormStore.getState();
      const list = await agentApi.appbuilder.bots_list({
        provider_id: store.form_data.custom_config.provider_id,
      });
      const transformedList = list.map(transformAppBuilderBotItem);
      setBots(
        transformedList.map((item: AppBuilderBotItem) => ({
          value: item.value,
          label: item.label,
          icon: item.logo,
        })),
      );
    };

    const loadProviders = async () => {
      const list = await providersApi.list({
        providerType: PROVIDER_VALUES.APP_BUILDER,
      });
      const transformedList = transformProviderList(list);
      setProviders(transformedList);

      const store = useAgentFormStore.getState();
      if (transformedList.length && !store.form_data.custom_config.provider_id) {
        updateCustomConfig({ provider_id: transformedList[0].provider_id });
      }
      loadBots();
    };

    const onProviderChange = () => {
      loadBots();
      updateCustomConfig({ app_builder_bot_id: "" });
    };

    useEffect(() => {
      if (showChannelConfig) {
        loadProviders();
      }
    }, [showChannelConfig]);

    useImperativeHandle(ref, () => ({
      validateForm: createValidateForm(form),
    }));

    // 获取需要同步到 Form 的字段
    const { logo, name, group_id, sort } = formData

    // 同步 custom_config 字段到 Form（确保验证时能读取到正确的值）
    useEffect(() => {
      form.setFieldsValue({
        custom_config: {
          app_builder_bot_id: customConfig.app_builder_bot_id,
        },
      })
    }, [form, customConfig.app_builder_bot_id])

    return (
      <div className={`${showChannelConfig ? "" : "pb-7"} ${className || ""}`}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            logo,
            name,
            group_id,
            sort,
            custom_config: {
              app_builder_bot_id: customConfig.app_builder_bot_id,
            },
          }}
        >
          {showChannelConfig ? (
            <>
              <div className="text-base text-primary font-medium mb-4">
                {t("app_builder")}
              </div>
              <Form.Item label={t("module.website_info_name")}>
                <Select
                  value={customConfig.provider_id}
                  onChange={(value) => {
                    updateCustomConfig({ provider_id: value });
                    onProviderChange();
                  }}
                  options={providers.map((item) => ({
                    label: item.name,
                    value: item.provider_id,
                  }))}
                />
              </Form.Item>
              <Form.Item
                label={t("select_agent")}
                name={["custom_config", "app_builder_bot_id"]}
                rules={[
                  { required: true, message: t("form_select_placeholder") },
                ]}
                getValueProps={() => ({ value: customConfig.app_builder_bot_id })}
                getValueFromEvent={(value) => {
                  updateCustomConfig({ app_builder_bot_id: value as string });
                  return value;
                }}
              >
                <SelectPlus
                  useI18n={false}
                  options={bots}
                />
              </Form.Item>
              <AgentInfo form={form} />
            </>
          ) : (
            <>
              <UseScope />
              <BaseConfig />
              <RelateAgents />
              <ExpandConfig />
            </>
          )}
        </Form>
      </div>
    );
  },
);

AppBuilder.displayName = "AppBuilder";

export default AppBuilder;
