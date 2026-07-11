import { useState, useEffect, useRef } from "react";
import { Button, Drawer, Modal, Form, Input, Empty, message } from "antd";
import { t } from "@/locales";
import platformSettingsApi from "@/api/modules/platform-settings";
import { transformPlatformSetting } from "@/api/modules/platform-settings/transform";
import type { PlatformSetting } from "@/api/modules/platform-settings/types";
import { getRealPath } from "@/utils/config";

const BOCHA_PLATFORM_KEY = "bochaai";
const BOCHA_PLATFORM_NAME = "博查（API）";

const formatSecret = (value: string) => {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
};

export function PlatformWebSearch() {
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAccessDrawer, setShowAccessDrawer] = useState(false);
  const [showBochaDialog, setShowBochaDialog] = useState(false);
  const [bochaSetting, setBochaSetting] = useState<PlatformSetting | null>(
    null,
  );

  const [form] = Form.useForm();
  const formRef = useRef<any>(null);

  const loadBochaSetting = async () => {
    const res = await platformSettingsApi.find({
      platform_key: BOCHA_PLATFORM_KEY,
    });
    if (res && res.length > 0) {
      setBochaSetting(transformPlatformSetting(res[0]));
    }
  };

  const handleTest = () => {
    if (bochaSetting?.id) {
      platformSettingsApi.test(bochaSetting.id, BOCHA_PLATFORM_KEY).then(() => {
        message.success(`测试成功，「${BOCHA_PLATFORM_NAME}」当前可正常使用`);
      });
    }
  };

  const handleEdit = () => {
    if (bochaSetting) {
      form.setFieldsValue({
        api_key: bochaSetting.setting.api_key,
      });
    }
    setShowBochaDialog(true);
  };

  const handleDelete = async () => {
    Modal.confirm({
      title: `确定删除「${BOCHA_PLATFORM_NAME}」配置吗？`,
      okText: t("action_confirm"),
      cancelText: t("action_cancel"),
      onOk: async () => {
        if (bochaSetting?.id) {
          await platformSettingsApi.delete(bochaSetting.id);
          setBochaSetting(null);
          message.success("已删除");
        }
      },
    });
  };

  const openBochaDialog = () => {
    form.resetFields();
    setShowAccessDrawer(false);
    setShowBochaDialog(true);
  };

  const handleSaveBocha = async () => {
    try {
      setSaving(true);
      const values = await form.validateFields();
      if (bochaSetting?.id) {
        await platformSettingsApi.update(bochaSetting.id, {
          platform_key: BOCHA_PLATFORM_KEY,
          setting: JSON.stringify(values),
        });
      } else {
        await platformSettingsApi.create({
          platform_key: BOCHA_PLATFORM_KEY,
          setting: JSON.stringify(values),
          status: "enabled",
        });
      }
      message.success("保存成功");
      setShowBochaDialog(false);
      loadBochaSetting();
    } catch (error) {
      console.error("Save error:", error);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      await loadBochaSetting();
      setIsLoading(false);
    };
    init();
  }, []);

  return (
    <div className="h-full flex flex-col bg-white py-6 px-2">
      <div className="space-y-4">
        {isLoading ? null : bochaSetting && bochaSetting.id ? (
          <div className="flex items-center justify-between bg-white border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
            {/* 左侧：图标和名称 */}
            <div className="flex-none w-[170px] flex items-center gap-3">
              <img
                src={getRealPath("/images/tools/bocha.png")}
                alt={BOCHA_PLATFORM_NAME}
                className="w-8 h-8"
              />
              <h4 className="flex-1 text-sm font-medium text-gray-900">
                {BOCHA_PLATFORM_NAME}
              </h4>
              <div className="border-r h-3 w-px"></div>
            </div>

            {/* 中间：服务器地址 */}
            <div className="flex-1 px-6 flex items-center gap-2 overflow-hidden">
              <div className="flex items-center gap-1">
                <span className="text-sm text-placeholder">API Key：</span>
                <span className="flex-1 text-sm text-primary truncate">
                  {formatSecret(bochaSetting.setting.api_key)}
                </span>
              </div>
            </div>

            {/* 右侧：开关和操作按钮 */}
            <div className="flex items-center gap-4 ml-2">
              <div className="border-r h-3 w-px"></div>
              <div className="flex items-center">
                <Button type="link" onClick={handleTest}>
                  {t("action_test")}
                </Button>
                <Button type="link" onClick={handleEdit}>
                  {t("action_edit")}
                </Button>
                <Button type="link" onClick={handleDelete}>
                  {t("action_delete")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Empty
            description={t("platform.web_search_not_connected")}
            image={getRealPath("/images/empty.png")}
            styles={{ image: { height: 110 } }}
          >
            <Button
              className="border-none w-28"
              color="primary"
              variant="filled"
              onClick={() => setShowAccessDrawer(true)}
            >
              +{t("action_add")}
            </Button>
          </Empty>
        )}
      </div>

      {/* 底部操作按钮 */}
      {!isLoading && bochaSetting && (
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
      )}

      {/* 选择接入抽屉 */}
      <Drawer
        open={showAccessDrawer}
        title={t("platform.select_access")}
        onClose={() => setShowAccessDrawer(false)}
        styles={{ wrapper: { width: 700 } }}
      >
        <div className="p-4">
          <div className="space-y-3">
            {/* 高精解析 */}
            <div className="flex items-center justify-between px-5 py-4 rounded-md bg-[#F8F9FA]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10">
                  <img
                    src={getRealPath("/images/tools/bocha.png")}
                    alt={BOCHA_PLATFORM_NAME}
                    className="w-10 h-10"
                  />
                </div>
                <span className="text-base font-medium text-primary">
                  {BOCHA_PLATFORM_NAME}
                </span>
              </div>
              <Button
                disabled={Boolean(bochaSetting && bochaSetting.id)}
                className="!border-none"
                color="primary"
                variant="filled"
                onClick={openBochaDialog}
              >
                {t("action_add")}
              </Button>
            </div>
          </div>
        </div>
      </Drawer>

      {/* 博查（API）配置对话框 */}
      <Modal
        open={showBochaDialog}
        width={600}
        onCancel={() => setShowBochaDialog(false)}
        getContainer={false}
        title={
          <div className="flex items-center gap-2">
            <img
              src={getRealPath("/images/tools/bocha.png")}
              alt={BOCHA_PLATFORM_NAME}
              className="w-8 h-8"
            />
            <span className="text-base font-medium text-primary">
              {BOCHA_PLATFORM_NAME}
            </span>
          </div>
        }
        footer={
          <>
            <Button onClick={() => setShowBochaDialog(false)}>
              {t("action_cancel")}
            </Button>
            <Button type="primary" loading={saving} onClick={handleSaveBocha}>
              {t("action_save")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Form form={form} layout="vertical" ref={formRef}>
            <Form.Item
              label="API Key"
              name="api_key"
              rules={[
                {
                  required: true,
                  message: t("form.input_placeholder") + " API Key",
                },
              ]}
            >
              <Input
                placeholder={t("form.input_placeholder") + " API Key"}
                allowClear
              />
            </Form.Item>
          </Form>
        </div>
      </Modal>
    </div>
  );
}

export default PlatformWebSearch;
