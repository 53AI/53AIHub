import { useState, useEffect, useRef, useMemo } from "react";
import { Button, Drawer, Modal, Form, Input, message } from "antd";
import { t } from "@/locales";
import platformSettingsApi from "@/api/modules/platform-settings";
import { transformPlatformSetting } from "@/api/modules/platform-settings/transform";
import type { PlatformSetting } from "@/api/modules/platform-settings/types";
import {
  PARSER_CONFIGS, getAvailableKeys
} from "@/constants/parser";
import { useEnv } from "@/hooks/useEnv";

const formatSecret = (value: string) => {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
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

  const documentConfigs = useMemo(
    () => PARSER_CONFIGS.filter((config) => config.category === "document"),
    [],
  );
  const audioConfigs = useMemo(
    () => PARSER_CONFIGS.filter((config) => config.category === "audio"),
    [],
  );

  const currentConfig = useMemo(() => {
    return PARSER_CONFIGS.find((config) => config.key === currentEditKey);
  }, [currentEditKey]);

  const loadAllSettings = async () => {
    const res = await platformSettingsApi.find();
    const map: Record<string, PlatformSetting | null> = {
      markitdown: {
        id: "0",
        platform_key: "markitdown",
        setting: {},
        created_time: 0,
        updated_time: 0,
        eid: "0",
      },
    };
    res.forEach((item) => {
      if (availableKeys.includes(item.platform_key)) {
        map[item.platform_key] = transformPlatformSetting(item);
      }
    });
    setSettingsMap(map);
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
      message.success("保存成功");
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
      title: `确定删除${config.name}配置吗？`,
      okText: t("action_confirm"),
      cancelText: t("action_cancel"),
      onOk: async () => {
        const currentSetting = settingsMap[key];
        if (currentSetting?.id) {
          await platformSettingsApi.delete(currentSetting.id);
          setSettingsMap((prev) => ({ ...prev, [key]: null }));
          message.success("删除成功");
        }
      },
    });
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadAllSettings();
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
                className="flex items-center justify-between bg-white border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow"
              >
                {/* 左侧：图标和名称 */}
                <div className="flex-none w-[170px] flex items-center gap-3">
                  <img
                    src={config.icon}
                    alt={config.name}
                    className="w-8 h-8"
                  />
                  <h4 className="flex-1 text-sm font-medium text-gray-900">
                    {config.name}
                  </h4>
                  <div className="border-r h-3 w-px"></div>
                </div>

                {/* 中间：配置信息 */}
                {config.key !== "markitdown" && (
                  <div className="flex-1 px-6 flex items-center gap-2 overflow-hidden">
                    {config.displayFields.map((field) => (
                      <div
                        key={field.key}
                        className="flex items-center gap-1"
                      >
                        <span className="text-sm text-placeholder">
                          {field.label}：
                        </span>
                        <span className="flex-1 text-sm text-primary truncate">
                          {field.isSecret
                            ? formatSecret(
                                settingsMap[config.key]?.setting[field.key],
                              )
                            : settingsMap[config.key]?.setting[field.key]}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 右侧：操作按钮 */}
                {config.key !== "markitdown" && (
                  <div className="flex items-center gap-4 ml-2">
                    <div className="border-r h-3 w-px"></div>
                    <div className="flex items-center">
                      <Button
                        type="link"
                        onClick={() => handleEdit(config.key)}
                      >
                        {t("action_edit")}
                      </Button>
                      <Button
                        type="link"
                        onClick={() => handleDelete(config.key)}
                      >
                        {t("action_delete")}
                      </Button>
                    </div>
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
          <h3 className="text-base font-medium text-primary">语音解析</h3>
          <p className="text-xs text-placeholder">
            设置音视频文件的转写和解析方法
          </p>
        </div>

          <div className="space-y-3">
            {audioConfigs.map((config) =>
              settingsMap[config.key]?.id ? (
                <div
                  key={config.key}
                  className="flex items-center justify-between bg-white border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow"
                >
                  {/* 左侧：图标和名称 */}
                  <div className="flex-none w-[170px] flex items-center gap-3">
                    <img
                      src={config.icon}
                      alt={config.name}
                      className="w-8 h-8"
                    />
                    <h4 className="flex-1 text-sm font-medium text-gray-900">
                      {config.name}
                    </h4>
                    <div className="border-r h-3 w-px"></div>
                  </div>

                  {/* 中间：配置信息 */}
                  <div className="flex-1 px-6 flex items-center gap-2 overflow-hidden">
                    {config.displayFields.map((field) => (
                      <div
                        key={field.key}
                        className="flex items-center gap-1"
                      >
                        <span className="text-sm text-placeholder">
                          {field.label}：
                        </span>
                        <span className="flex-1 text-sm text-primary truncate">
                          {field.isSecret
                            ? formatSecret(
                                settingsMap[config.key]?.setting[field.key],
                              )
                            : settingsMap[config.key]?.setting[field.key]}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* 右侧：操作按钮 */}
                  <div className="flex items-center gap-4 ml-2">
                    <div className="border-r h-3 w-px"></div>
                    <div className="flex items-center">
                      <Button
                        type="link"
                        onClick={() => handleEdit(config.key)}
                      >
                        {t("action_edit")}
                      </Button>
                      <Button
                        type="link"
                        onClick={() => handleDelete(config.key)}
                      >
                        {t("action_delete")}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null,
            )}
          </div>

          <div className="mt-4">
            <Button
              className="border-none"
              color="primary"
              variant="filled"
              onClick={() => setShowAudioDrawer(true)}
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

      {/* 语音解析工具抽屉 */}
      <Drawer
        open={showAudioDrawer}
        title={t("platform.select_access")}
        onClose={() => setShowAudioDrawer(false)}
        styles={{ wrapper: { width: 700 } }}
      >
        <div className="p-4">
          <div className="space-y-3">
            {audioConfigs.map((config) => (
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
                  color="primary"
                  className="!border-none"
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
