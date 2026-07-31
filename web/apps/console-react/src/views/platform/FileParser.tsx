import { useState, useEffect, useRef, useMemo } from "react";
import { Button, Drawer, Modal, Form, Input, message, Tag, Tooltip } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { t } from "@/locales";
import platformSettingsApi from "@/api/modules/platform-settings";
import { transformPlatformSetting } from "@/api/modules/platform-settings/transform";
import type {
  PlatformSetting,
  ParserHealth,
} from "@/api/modules/platform-settings/types";
import {
  PARSER_CONFIGS, getAvailableKeys
} from "@/constants/parser";
import { useEnv } from "@/hooks/useEnv";
import { useModelTest, getTestKey } from "./hooks/useModelTest";

const formatSecret = (value: string) => {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
};

const formatLatency = (ms: number) => {
  if (ms === undefined || ms === null) return "";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
};

const HealthTag = ({ health }: { health: ParserHealth | undefined }) => {
  if (!health) {
    return (
      <Tag color="default" className="mr-0">
        {t("platform.parser_health_unchecked")}
      </Tag>
    );
  }
  const usable = health.usable;
  const label = t(
    usable ? "platform.parser_health_available" : "platform.parser_health_unavailable",
  );
  const color = usable ? "success" : "error";
  const tipParts = [label];
  if (health.message) tipParts.push(health.message);
  if (health.latency_ms !== undefined) tipParts.push(formatLatency(health.latency_ms));
  return (
    <Tooltip title={tipParts.join(" · ")}>
      <Tag color={color} className="mr-0">
        {label}
      </Tag>
    </Tooltip>
  );
};

export function PlatformFileParser() {
  const { isRcEnv, isDevEnv } = useEnv();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDocumentDrawer, setShowDocumentDrawer] = useState(false);
  const [showAudioDrawer, setShowAudioDrawer] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [currentEditKey, setCurrentEditKey] = useState<string>("");
  const [settingsMap, setSettingsMap] = useState<
    Record<string, PlatformSetting | null>
  >({
    markitdown: {
      id: "0",
      platform_key: "markitdown",
      setting: {},
      created_time: 0,
      updated_time: 0,
      eid: "0",
    },
  });

  const [form] = Form.useForm();
  const formRef = useRef<any>(null);
  const availableKeys = getAvailableKeys();
  const { voiceModels, loadVoiceModels } = useVoiceModels();
  const [addedVoiceIds, setAddedVoiceIds] = useState<Set<string>>(new Set());
  const { testMap, handleModelTest } = useModelTest();
  const [healthMap, setHealthMap] = useState<Record<string, ParserHealth>>({});

  const documentConfigs = useMemo(
    () => PARSER_CONFIGS.filter((config) => config.category === "document"),
    [],
  );

  const currentConfig = useMemo(() => {
    return PARSER_CONFIGS.find((config) => config.key === currentEditKey);
  }, [currentEditKey]);

  
  const loadAllSettings = async () => {
    const res = await platformSettingsApi.find();
    const map: Record<string, PlatformSetting | null> = documentConfigs.filter(item => item.isSystem).reduce((result, item) => {
    result[item.key] = {
      id: "0",
      platform_key: item.key,
      setting: {},
      created_time: 0,
      updated_time: 0,
      eid: "0",
    }
    return result
  }, {} as any);
    res.forEach((item) => {
      if (availableKeys.includes(item.platform_key)) {
        map[item.platform_key] = transformPlatformSetting(item);
      }
    });
    setSettingsMap(map);
  };

  const loadHealth = async () => {
    try {
      const list = await platformSettingsApi.health();
      const next: Record<string, ParserHealth> = {};
      list.forEach((item) => {
        next[item.platform_key] = item;
        if (item.engine) {
          next[item.engine] = item;
        }
      });
      // 所有 paddlepaddle 开头的解析器共用同一条健康检查记录
      const paddleBase = "paddlepaddle";
      if (next[paddleBase]) {
        PARSER_CONFIGS
          .filter((c) => c.key.startsWith(`${paddleBase}_`))
          .forEach((c) => {
            if (!next[c.key]) next[c.key] = next[paddleBase];
          });
      }
      setHealthMap(next);
    } catch (error) {
      console.error("Load health error:", error);
    }
  };

  // 合并所有渠道已添加的语音模型（model_type=4），按 model_id 去重
  const openAudioDrawer = async () => {
    await loadVoiceModels();
    setShowAudioDrawer(true);
  };

  const handleVoiceModelAdd = async (model: VoiceModelItem) => {
    // TODO: 保存接口暂未提供，待后端支持后接入；已添加列表初始也应从后端拉取
    setAddedVoiceIds((prev) => new Set(prev).add(model.model_id));
    message.success(t("action_add_success"));
  };

  const handleVoiceModelDelete = (model: VoiceModelItem) => {
    // TODO: 删除接口暂未提供，临时只做本地状态更新
    setAddedVoiceIds((prev) => {
      const next = new Set(prev);
      next.delete(model.model_id);
      return next;
    });
    message.success(t("action_delete_success"));
  };

  const openConfigDialog = (key: string) => {
    const config = PARSER_CONFIGS.find((c) => c.key === key);
    if (!config) return;

    setCurrentEditKey(key);
    setShowDocumentDrawer(false);
    setShowAudioDrawer(false);

    const formData: Record<string, string> = {};
    config.formFields.forEach((field) => {
      formData[field.key] = field.defaultValue || "";
    });
    form.setFieldsValue(formData);
    setShowConfigDialog(true);
  };

  const handleEdit = (key: string) => {
    const config = PARSER_CONFIGS.find((c) => c.key === key);
    if (!config) return;

    setCurrentEditKey(key);
    const setting = settingsMap[key];

    const formData: Record<string, string> = {};
    if (setting) {
      config.formFields.forEach((field) => {
        formData[field.key] = setting.setting[field.key] || "";
      });
    } else {
      config.formFields.forEach((field) => {
        formData[field.key] = field.defaultValue || "";
      });
    }
    form.setFieldsValue(formData);
    setShowConfigDialog(true);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const values = await form.validateFields();
      const config = currentConfig;
      if (!config) return;

      const setting: Record<string, string> = {};
      config.formFields.forEach((field) => {
        setting[field.key] = values[field.key];
      });

      const currentSetting = settingsMap[config.key];

      if (currentSetting?.id) {
        await platformSettingsApi.update(currentSetting.id, {
          platform_key: config.key,
          setting: JSON.stringify(setting),
        });
      } else {
        await platformSettingsApi.create({
          platform_key: config.key,
          setting: JSON.stringify(setting),
        });
      }
      message.success(t("action_save_success"));
      setShowConfigDialog(false);
      await loadAllSettings();
    } catch (error) {
      console.error("Save error:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (key: string) => {
    const config = PARSER_CONFIGS.find((c) => c.key === key);
    if (!config) return;

    Modal.confirm({
      title: t("platform.delete_config_confirm", { name: config.name }),
      okText: t("action_confirm"),
      cancelText: t("action_cancel"),
      onOk: async () => {
        const currentSetting = settingsMap[key];
        if (currentSetting?.id) {
          await platformSettingsApi.delete(currentSetting.id);
          setSettingsMap((prev) => ({ ...prev, [key]: null }));
          message.success(t("action_delete_success"));
        }
      },
    });
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadAllSettings(), loadVoiceModels(), loadHealth()]);
      setLoading(false);
    };
    init();
  }, []);

  return (
    <div className="h-full flex flex-col  py-6 px-2to">
      {/* 文档解析模块 */}
      <div className="mb-8">
        <div className="flex items-center gap-2.5 mb-4">
          <h3 className="text-base font-medium text-primary">
            {t("platform.document_parse")}
          </h3>
          <p className="text-xs text-placeholder">
            {t("platform.document_parse_desc")}
          </p>
        </div>

        <div className="space-y-3">
          {documentConfigs.map((config) =>
            settingsMap[config.key]?.id ? (
              <div
                key={config.key}
                className="group flex items-center justify-between bg-white border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow"
              >
                {/* 左侧：图标和名称 */}
                <div className="flex-shrink-0 w-[300px] flex items-center gap-3">
                  <img
                    src={config.icon}
                    alt={config.name}
                    className="w-8 h-8"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium text-primary">
                        {config.name}
                      </h4>
                      <HealthTag health={healthMap[config.key]} />
                    </div>
                    <p className="text-xs text-placeholder">
                      {config.desc}
                    </p>
                  </div>
                  <div className="flex-1"></div>
                  <div className="border-r h-3 w-px"></div>
                </div>

                {/* 中间：配置信息 */}
                <div className="flex-1 px-6 flex items-center gap-2 overflow-hidden text-secondary truncate">
                  支持格式： { config.supportedExts.join('、') }
                </div>

                {/* 右侧：操作按钮 / 内置标签 */}
                {config.isSystem ? (
                  <div className="flex items-center gap-2 ml-2">
                    <span className="px-2 py-0.5 bg-[#F0F2F5] text-secondary text-xs rounded">
                      {t("agent.builtin")}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 ml-2">
                    <Button
                      type="text"
                      icon={<SvgIcon name="edit" />}
                      className="invisible group-hover:visible hover:!text-brand"
                      onClick={() => handleEdit(config.key)}
                    />
                    <Button
                      type="text"
                      danger
                      icon={<SvgIcon name="delete" />}
                      className="invisible group-hover:visible hover:!text-tag-red"
                      onClick={() => handleDelete(config.key)}
                    />
                  </div>
                )}
              </div>
            ) : null,
          )}
        </div>

        <div className="mt-4">
          <Button
            className="border-none"
            color="primary"
            variant="filled"
            onClick={() => setShowDocumentDrawer(true)}
          >
            +{t("action_add")}
          </Button>
        </div>
      </div>

      {/* 语音解析模块 */}
      <div className="hidden">
        <div className="flex items-center gap-2.5 mb-4">
          <h3 className="text-base font-medium text-primary">语音解析</h3>
          <p className="text-xs text-placeholder">
            设置音视频文件的解析模型
          </p>
        </div>

          {/* 已添加的语音模型列表-抽屉中已添加的模型 */}
          {voiceModels.length > 0 && (
            <div className="w-full border border-gray-200 rounded-lg overflow-hidden">
              {voiceModels.map((model) => {
                const testKey = getTestKey(model.channel_id, model.model_id);
                const testResult = testMap[testKey];
                return (
                  <div
                    key={model.model_id}
                    className="flex items-center justify-between px-5 py-4 bg-white border-b border-gray-100 last:border-b-0 hover:bg-[#FAFBFC] transition-colors"
                  >
                    {/* 左侧：图标 + 名称 + model_id */}
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {model.icon && (
                        <img
                          src={model.icon}
                          alt={model.model_name}
                          className="w-8 h-8 object-contain flex-none"
                        />
                      )}
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm font-medium text-primary">
                          {model.model_name}
                        </span>
                        {model.model_name !== model.model_id && (
                          <>
                            <span className="text-placeholder text-xs">|</span>
                            <span className="text-placeholder text-xs truncate">
                              {model.model_id}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* 右侧：操作按钮 */}
                    <div className="flex items-center gap-3 ml-4">
                      {/* 测试结果标签 */}
                      {testResult && !testResult.loading && (
                        <>
                          { testResult.success ? (
                            <Tag color="success" className="!ml-2">
                              {t("action_test_success")}
                            </Tag>
                          ) : (
                            <Tag color="error" className="!ml-2">
                              {t("action_test_failed")}
                            </Tag>
                          )}
                          <div className="h-4 w-px border-r border-[#E1E2E6]" />
                        </>
                      )}
                      <Tooltip title={t("action_test")}>
                        <Button
                          type="link"
                          className="!px-0 text-placeholder"
                          loading={testResult?.loading}
                          onClick={() => handleModelTest(model)}
                        >
                          <SvgIcon name="tool" width="14" />
                        </Button>
                      </Tooltip>
                      <Tooltip title={t("action_delete")}>
                        <Button
                          type="link"
                          className="!px-0 text-placeholder"
                          onClick={() => handleVoiceModelDelete(model)}
                        >
                          <SvgIcon name="delete" width="14" />
                        </Button>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4">
            <Button
              className="border-none"
              color="primary"
              variant="filled"
              onClick={openAudioDrawer}
            >
              +{t("action_add")}
            </Button>
          </div>
        </div>

      {/* 文档解析工具抽屉 */}
      <Drawer
        open={showDocumentDrawer}
        title={t("platform.select_access")}
        onClose={() => setShowDocumentDrawer(false)}
        styles={{ wrapper: { width: 700 } }}
      >
        <div className="p-4">
          <div className="space-y-3">
            {documentConfigs.map((config) => (
              <div
                key={config.key}
                className="flex items-center justify-between px-5 py-4 rounded-md bg-[#F8F9FA]"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10">
                    <img
                      src={config.icon}
                      alt={config.name}
                      className="w-10 h-10"
                    />
                  </div>
                  <span className="text-base font-medium text-primary">
                    {config.name}
                  </span>
                </div>
                <Button
                  disabled={Boolean(settingsMap[config.key]?.id)}
                  className="!border-none"
                  color="primary"
                  variant="filled"
                  onClick={() => openConfigDialog(config.key)}
                >
                  {t("action_add")}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </Drawer>


      {/* 配置对话框 */}
      <Modal
        open={showConfigDialog}
        width={600}
        onCancel={() => setShowConfigDialog(false)}
        getContainer={false}
        title={
          <div className="flex items-center gap-2">
            {currentConfig && (
              <img
                src={currentConfig.icon}
                alt={currentConfig.name}
                className="w-8 h-8"
              />
            )}
            <span className="text-base font-medium text-primary">
              {currentConfig?.name}
            </span>
          </div>
        }
        footer={
          <>
            <Button onClick={() => setShowConfigDialog(false)}>
              {t("action_cancel")}
            </Button>
            <Button type="primary" loading={saving} onClick={handleSave}>
              {t("action_save")}
            </Button>
          </>
        }
      >
        {/* 说明文字 */}
        {currentConfig?.description && (
          <div className="p-4 text-sm text-primary bg-[#F6F9FC] mb-4">
            <div
              dangerouslySetInnerHTML={{ __html: currentConfig.description }}
            />
          </div>
        )}

        {/* 输入表单 */}
        <Form form={form} layout="vertical" ref={formRef}>
          {currentConfig?.formFields.map((field) => (
            <Form.Item
              key={field.key}
              label={field.label}
              name={field.key}
              rules={[
                {
                  required: true,
                  message: t("form.input_placeholder") + field.label,
                },
              ]}
            >
              <Input
                placeholder={t("form.input_placeholder") + field.label}
                allowClear
              />
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </div>
  );
}

export default PlatformFileParser;
