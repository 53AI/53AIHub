import { useState, useEffect, useRef } from "react";
import { Button, Drawer, Modal, Form, Input, Empty, message } from "antd";
import { t } from "@/locales";
import platformSettingsApi from "@/api/modules/platform-settings";
import { transformPlatformSetting } from "@/api/modules/platform-settings/transform";
import type { PlatformSetting } from "@/api/modules/platform-settings/types";
import { getRealPath, api_host } from "@/utils/config";
import { copyToClip } from "@km/shared-utils";

const formatSecret = (value: string) => {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
};

export function PlatformFileEditor() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAccessDrawer, setShowAccessDrawer] = useState(false);
  const [showHighPrecisionDialog, setShowHighPrecisionDialog] = useState(false);
  const [wpsSetting, setWpsSetting] = useState<PlatformSetting | null>(null);

  const [form] = Form.useForm();
  const formRef = useRef<any>(null);

  const settingForm = {
    server_url: api_host,
    app_id: "",
    app_secret: "",
  };

  const loadWpsSetting = async () => {
    const res = await platformSettingsApi.find({ platform_key: "wps" });
    if (res && res.length > 0) {
      setWpsSetting(transformPlatformSetting(res[0]));
    }
  };

  const openHighPrecisionDialog = () => {
    form.setFieldsValue({
      app_id: "",
      app_secret: "",
    });
    setShowAccessDrawer(false);
    setShowHighPrecisionDialog(true);
  };

  const handleEdit = () => {
    if (wpsSetting) {
      form.setFieldsValue({
        app_id: wpsSetting.setting.app_id,
        app_secret: wpsSetting.setting.app_secret,
      });
    }
    setShowHighPrecisionDialog(true);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const values = await form.validateFields();
      const settingData = {
        server_url: api_host,
        ...values,
      };
      if (wpsSetting?.id) {
        await platformSettingsApi.update(wpsSetting.id, {
          platform_key: "wps",
          setting: JSON.stringify(settingData),
          external_id: values.app_id,
        });
      } else {
        await platformSettingsApi.create({
          platform_key: "wps",
          setting: JSON.stringify(settingData),
          external_id: values.app_id,
        });
      }
      message.success("保存成功");
      setShowHighPrecisionDialog(false);
      loadWpsSetting();
    } catch (error) {
      console.error("Save error:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    Modal.confirm({
      title: "确定删除WPS WebOffice配置吗？",
      okText: t("action_confirm"),
      cancelText: t("action_cancel"),
      onOk: async () => {
        if (wpsSetting?.id) {
          await platformSettingsApi.delete(wpsSetting.id);
          setWpsSetting(null);
          message.success("删除成功");
        }
      },
    });
  };

  const handleCopy = () => {
    copyToClip(`${api_host}/api/wps`);
    message.success("复制成功");
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadWpsSetting();
      setLoading(false);
    };
    init();
  }, []);

  return (
    <div className="h-full flex flex-col bg-white py-6 px-2">
      {!loading && wpsSetting && wpsSetting.id ? (
        <>
          <div className="space-y-4">
            {/* WPS WebOffice配置项 */}
            <div className="flex items-center justify-between bg-white border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
              {/* 左侧：图标和名称 */}
              <div className="flex-none w-[170px] flex items-center gap-3">
                <img
                  src={getRealPath("/images/tools/wps-office.png")}
                  alt="WPS WebOffice"
                  className="w-8 h-8"
                />
                <h4 className="flex-1 text-sm font-medium text-gray-900">
                  WPS WebOffice
                </h4>
                <div className="border-r h-3 w-px"></div>
              </div>

              {/* 中间：服务器地址 */}
              <div className="flex-1 px-6 flex items-center gap-2 overflow-hidden">
                <div className="flex items-center gap-1">
                  <span className="text-sm text-placeholder">APPID：</span>
                  <span className="flex-1 text-sm text-primary truncate">
                    {wpsSetting.setting["app_id"]}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-placeholder">AppSecret</span>
                  <span className="flex-1 text-sm text-primary truncate">
                    {formatSecret(wpsSetting.setting["app_secret"])}
                  </span>
                </div>
              </div>

              {/* 右侧：开关和操作按钮 */}
              <div className="flex items-center gap-4 ml-2">
                <div className="border-r h-3 w-px"></div>
                <div className="flex items-center">
                  <Button type="link" onClick={handleEdit}>
                    {t("action_edit")}
                  </Button>
                  <Button type="link" onClick={handleDelete}>
                    {t("action_delete")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
          {/* 底部操作按钮 */}
          <div className="mt-6">
            <Button
              className="border-none"
              color="primary"
              variant="filled"
              onClick={() => setShowAccessDrawer(true)}
            >
              +{t("action_add")}
            </Button>
          </div>
        </>
      ) : !loading && !wpsSetting ? (
        <Empty
          image={getRealPath("/images/empty.png")}
          styles={{ image: { height: 110 } }}
          description={t("platform.file_editor_not_connected")}
        >
          <Button
            className="border-none"
            color="primary"
            variant="filled"
            onClick={() => setShowAccessDrawer(true)}
          >
            +{t("action_add")}
          </Button>
        </Empty>
      ) : null}

      {/* 选择接入抽屉 */}
      <Drawer
        open={showAccessDrawer}
        title={t("platform.select_access")}
        onClose={() => setShowAccessDrawer(false)}
        styles={{ wrapper: { width: 700 } }}
      >
        <div className="p-4">
          <div className="space-y-3">
            {/* WPS WebOffice */}
            <div className="flex items-center justify-between px-5 py-4 rounded-md bg-[#F8F9FA]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10">
                  <img
                    src={getRealPath("/images/tools/wps-office.png")}
                    alt="WPS WebOffice"
                    className="w-10 h-10"
                  />
                </div>
                <span className="text-base font-medium text-primary">
                  WPS WebOffice
                </span>
              </div>
              <Button
                disabled={Boolean(wpsSetting && wpsSetting.id)}
                color="primary"
                variant="filled"
                className="!border-none"
                onClick={openHighPrecisionDialog}
              >
                {t("action_add")}
              </Button>
            </div>
          </div>
        </div>
      </Drawer>

      {/* WPS WebOffice配置对话框 */}
      <Modal
        open={showHighPrecisionDialog}
        width={600}
        onCancel={() => setShowHighPrecisionDialog(false)}
        getContainer={false}
        title={
          <div className="flex items-center gap-2">
            <img
              src={getRealPath("/images/tools/wps-office.png")}
              alt="WPS WebOffice"
              className="w-8 h-8"
            />
            <span className="text-base font-medium text-primary">
              WPS WebOffice
            </span>
          </div>
        }
        footer={
          <>
            <Button onClick={() => setShowHighPrecisionDialog(false)}>
              {t("action_cancel")}
            </Button>
            <Button type="primary" loading={saving} onClick={handleSave}>
              {t("action_save")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* 输入表单 */}
          <Form form={form} layout="vertical" ref={formRef}>
            <Form.Item
              label="APPID"
              name="app_id"
              rules={[
                {
                  required: true,
                  message: t("form.input_placeholder") + "APPID",
                },
              ]}
            >
              <Input
                placeholder={t("form.input_placeholder") + "APPID"}
                allowClear
              />
            </Form.Item>
            <Form.Item
              label="AppSecret"
              name="app_secret"
              rules={[
                {
                  required: true,
                  message: t("form.input_placeholder") + "AppSecret",
                },
              ]}
            >
              <Input
                placeholder={t("form.input_placeholder") + "AppSecret"}
                allowClear
              />
            </Form.Item>
          </Form>
          {/* 说明文字 */}
          <div className="p-4 text-sm text-primary bg-[#F6F9FC]">
            <p className="mb-3">
              通过调用WPS开放平台服务接口，实现文件的预览和编辑。
            </p>
            <ol className="list-decimal list-inside space-y-1">
              <li>
                在(
                <a
                  href="https://solution.wps.cn/"
                  target="_blank"
                  className="text-brand"
                >
                  WPS开放平台
                </a>
                )注册为服务商，按需购买服务:
              </li>
              <li>
                在【开发者后台-在线编辑预览】下，添加应用，得到APPID、AppSecret；
              </li>
              <li>
                数据回调地址：
                <span className="text-tag-red">{api_host}/api/wps</span>
                <span
                  className="inline-block ml-1 cursor-pointer text-brand"
                  onClick={handleCopy}
                >
                  复制
                </span>
              </li>
            </ol>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default PlatformFileEditor;
