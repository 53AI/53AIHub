import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Button, Drawer, Modal, Form, Input, message, Tag, Tooltip } from "antd";
import { SvgIcon, IconAction } from "@km/shared-components-react";
import { t } from "@/locales";
import platformSettingsApi from "@/api/modules/platform-settings";
import channelApi from "@/api/modules/channel";
import { transformPlatformSetting } from "@/api/modules/platform-settings/transform";
import type {
  PlatformSetting,
  ParserHealth,
} from "@/api/modules/platform-settings/types";
import {
  PARSER_CONFIGS, getAvailableKeys
} from "@/constants/parser";
import { loadModels, ModelSelect } from "@/components/Model";
import { MODEL_USE_TYPE } from "@/constants/platform/config";
import { MODEL_VALUE_SEPARATOR, parseModelValue } from "@/constants/platform/model";



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

const VoiceHealthTag = ({
  health,
}: {
  health: { usable: boolean; message?: string; loading?: boolean } | null;
}) => {
  if (!health) return null;
  if (health.loading) {
    return (
      <Tag color="processing" className="mr-0">
        {t("platform.parser_health_unchecked")}
      </Tag>
    );
  }
  const label = t(
    health.usable ? "platform.parser_health_available" : "platform.parser_health_unavailable",
  );
  const color = health.usable ? "success" : "error";
  const tipParts = [label];
  if (health.message) tipParts.push(health.message);
  return (
    <Tooltip title={tipParts.join(" · ")}>
      <Tag color={color} className="mr-0">
        {label}
      </Tag>
    </Tooltip>
  );
};

export function PlatformFileParser() {

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDocumentDrawer, setShowDocumentDrawer] = useState(false);
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
  const [voiceModels, setVoiceModels] = useState<any[]>([]);
  const [healthMap, setHealthMap] = useState<Record<string, ParserHealth>>({});
  const [recordingVoice, setRecordingVoice] = useState<PlatformSetting | null>(null);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [savingVoice, setSavingVoice] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<string>("");
  const [voiceHealth, setVoiceHealth] = useState<
    { usable: boolean; message?: string; loading?: boolean } | null
  >(null);

  const documentConfigs = useMemo(
    () => PARSER_CONFIGS.filter((config) => config.category === "document"),
    [],
  );

  const currentConfig = useMemo(() => {
    return PARSER_CONFIGS.find((config) => config.key === currentEditKey);
  }, [currentEditKey]);

  const selectedRecordingModel = useMemo(() => {
    const channelId = recordingVoice?.setting?.voice_model_id;
    const modelName = recordingVoice?.setting?.voice_model_name;
    if (!channelId || !modelName) return null;
    const target = `${channelId}${MODEL_VALUE_SEPARATOR}${modelName}`;
    for (const channel of voiceModels) {
      const opt = (channel.options || []).find((o: any) => o.value === target);
      if (opt) return { label: opt.label || opt.value, icon: opt.icon || "" };
    }
    return null;
  }, [recordingVoice, voiceModels]);

  
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

  const loadRecordingVoice = async () => {
    try {
      const list = await platformSettingsApi.find({
        platform_key: "recording_voice",
      });
      const item =
        list.find((s) => s.platform_key === "recording_voice") || list[0];
      const next = item ? transformPlatformSetting(item) : null;
      setRecordingVoice(next);
      return next;
    } catch (error) {
      console.error("Load recording voice error:", error);
      return null;
    }
  };

  const loadRecordingVoiceHealth = async (
    recordingVoice: PlatformSetting | null,
  ) => {
    const channelId = recordingVoice?.setting?.voice_model_id;
    const modelName = recordingVoice?.setting?.voice_model_name;
    if (!channelId || !modelName) {
      setVoiceHealth(null);
      return;
    }
    setVoiceHealth({ usable: false, loading: true });
    try {
      const res = await channelApi.testVoice(Number(channelId), modelName);
      setVoiceHealth({
        usable: res?.success ?? false,
        message: res?.message || "",
      });
    } catch (error) {
      console.error("Test recording voice error:", error);
      setVoiceHealth({ usable: false, message: String(error) });
    }
  };

  const refreshVoiceModels = useCallback(async () => {
    try {
      setVoiceModels(await loadModels(MODEL_USE_TYPE.VOICE));
    } catch (error) {
      console.error("Load voice models error:", error);
    }
  }, []);

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

  const openConfigDialog = (key: string) => {
    const config = PARSER_CONFIGS.find((c) => c.key === key);
    if (!config) return;

    setCurrentEditKey(key);
    setShowDocumentDrawer(false);

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

  const openVoiceModal = () => {
    const setting = recordingVoice?.setting || {};
    const channelId = setting.voice_model_id;
    const modelName = setting.voice_model_name;
    setSelectedVoice(
      channelId && modelName
        ? `${channelId}${MODEL_VALUE_SEPARATOR}${modelName}`
        : "",
    );
    setShowVoiceModal(true);
  };

  const handleSaveVoice = async () => {
    if (!selectedVoice) {
      message.warning(t("recording_voice_required"));
      return;
    }
    const parsed = parseModelValue(selectedVoice);
    if (!parsed) return;
    const setting = {
      voice_model_id: Number(parsed.modelType),
      voice_model_name: parsed.modelId,
    };
    setSavingVoice(true);
    try {
      if (recordingVoice?.id) {
        await platformSettingsApi.update(recordingVoice.id, {
          platform_key: "recording_voice",
          setting: JSON.stringify(setting),
        });
      } else {
        await platformSettingsApi.create({
          platform_key: "recording_voice",
          setting: JSON.stringify(setting),
        });
      }
      message.success(t("action_save_success"));
      setShowVoiceModal(false);
      const next = await loadRecordingVoice();
      await loadRecordingVoiceHealth(next);
    } catch (error) {
      console.error("Save recording voice error:", error);
    } finally {
      setSavingVoice(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([
        loadAllSettings(),
        refreshVoiceModels(),
        loadHealth(),
      ]);
      const voice = await loadRecordingVoice();
      await loadRecordingVoiceHealth(voice);
      setLoading(false);
    };
    init();
  }, []);

  return (
    <div className="h-full flex flex-col  py-2 px-2">
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
                    <IconAction
                      variant="row"
                      title={t("action_edit")}
                      onClick={() => handleEdit(config.key)}
                    >
                      <SvgIcon name="edit" />
                    </IconAction>
                    <IconAction
                      variant="row"
                      title={t("action_delete")}
                      danger
                      onClick={() => handleDelete(config.key)}
                    >
                      <SvgIcon name="delete" />
                    </IconAction>
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
      <div>
        <div className="flex items-center gap-2.5 mb-4">
          <h3 className="text-base font-medium text-primary">
            {t("platform.voice_parse")}
          </h3>
          <p className="text-xs text-placeholder">
            {t("platform.voice_parse_desc")}
          </p>
        </div>

        <div className="group flex items-center justify-between bg-white border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
          {/* 左侧：图标和名称 */}
          <div className="flex-shrink-0 w-[300px] flex items-center gap-3">
            {selectedRecordingModel?.icon ? (
              <img
                src={selectedRecordingModel.icon}
                alt={selectedRecordingModel.label}
                className="w-8 h-8 object-contain"
              />
            ) : (
              <div className="size-8 flex-center bg-[#EBECF2] rounded-lg">
                <SvgIcon name="voice-one" color="#9CA3AF" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-primary">
                  {selectedRecordingModel?.label ||
                    t("platform.voice_not_configured")}
                </h4>
                {recordingVoice && <VoiceHealthTag health={voiceHealth} />}
              </div>
              <p className="text-xs text-placeholder">
                语音识别模型解析
              </p>
            </div>
            <div className="flex-1"></div>
            <div className="border-r h-3 w-px"></div>
          </div>

          {/* 中间：配置信息 */}
          { recordingVoice && (
          <div className="flex-1 px-6 flex items-center gap-2 overflow-hidden text-secondary truncate">
            支持格式：mp3、wav、m4a、wma、aac、ogg、amr、flac、aiff
          </div>
          ) }

          {/* 右侧：操作按钮 */}
          <div className="flex items-center gap-2 ml-2">
            <IconAction
              title={t("action_edit")}
              onClick={openVoiceModal}
            >
              <SvgIcon name="edit" />
            </IconAction>
          </div>
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

      {/* 录音识别模型选择弹窗 */}
      <Modal
        open={showVoiceModal}
        width={500}
        onCancel={() => setShowVoiceModal(false)}
        getContainer={false}
        title={t("platform.voice_config_model")}
        footer={
          <>
            <Button onClick={() => setShowVoiceModal(false)}>
              {t("action_cancel")}
            </Button>
            <Button
              type="primary"
              loading={savingVoice}
              onClick={handleSaveVoice}
            >
              {t("action_save")}
            </Button>
          </>
        }
      >
        <Form>
          <Form.Item label={t("platform.voice_recognition_label")}>
            <ModelSelect
              value={selectedVoice || undefined}
              onChange={(val) => setSelectedVoice(val || "")}
              type={MODEL_USE_TYPE.VOICE}
              placeholder={t("recording_voice_required")}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default PlatformFileParser;
