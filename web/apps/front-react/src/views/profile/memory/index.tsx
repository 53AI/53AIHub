import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { Form, Input, Button, message, Spin, Select } from "antd";
import { useUserStore } from "@/stores/modules/user";
import { useEnterpriseStore } from "@/stores/modules/enterprise";
import { t } from "@/locales";
import ImportMemoryModal from "../components/import-memory";
import memoryApi from "@/api/modules/memory";

export interface ProfileMemoryRef {
  hasUnsavedChanges: () => boolean;
}

export const ProfileMemory = forwardRef<ProfileMemoryRef>((_, ref) => {
  const [form] = Form.useForm();
  const userStore = useUserStore();
  const enterpriseStore = useEnterpriseStore();
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [initialValues, setInitialValues] = useState({
    smart_memory: "",
    custom_memory: "",
    position: "",
    style: "",
  });
  const [showButtons, setShowButtons] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nickname, setNickname] = useState("");
  const [department, setDepartment] = useState("");

  // 暴露 hasUnsavedChanges 方法给父组件
  useImperativeHandle(ref, () => ({
    hasUnsavedChanges,
  }));

  // 解析记忆内容：JSON 数组转纯文本
  const parseMemoryContent = (content: string): string => {
    if (!content) return "";
    try {
      const items = JSON.parse(content);
      if (Array.isArray(items)) {
        return items.map((item: any) => item.fact || "").filter(Boolean).join("\n");
      }
    } catch {
      // 不是 JSON，直接返回原文
    }
    return content;
  };

  // 获取记忆数据
  const fetchMemory = async () => {
    setLoading(true);
    try {
      const data = await memoryApi.user.get();
      if (data) {
        // 优先使用接口返回的昵称和部门
        setNickname(data.nickname || "");
        setDepartment(data.department || "");

        const values = {
          smart_memory: parseMemoryContent(data.smart_memory || ""),
          custom_memory: parseMemoryContent(data.custom_memory || ""),
          position: data.position || "",
          style: data.style || "",
        };
        setInitialValues(values);
        form.setFieldsValue(values);
        setShowButtons(false)
      }
    } catch (error) {
      console.error("Failed to fetch user memory:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemory();
  }, []);

  // 监听表单值变化
  const handleValuesChange = () => {
    const currentValues = form.getFieldsValue();
    const hasChanges =
      currentValues.smart_memory !== initialValues.smart_memory ||
      currentValues.custom_memory !== initialValues.custom_memory ||
      currentValues.position !== initialValues.position ||
      currentValues.style !== initialValues.style;
    setShowButtons(hasChanges);
  };

  // 检测是否有未保存的更改
  const hasUnsavedChanges = () => {
    const currentValues = form.getFieldsValue();
    return (
      currentValues.smart_memory !== initialValues.smart_memory ||
      currentValues.custom_memory !== initialValues.custom_memory ||
      currentValues.position !== initialValues.position ||
      currentValues.style !== initialValues.style
    );
  };

  const handleSave = async (values: {
    smart_memory: string;
    custom_memory: string;
    position?: string;
    style?: string;
  }) => {
    setSaving(true);
    try {
      await memoryApi.user.replace({
        smart_memory: values.smart_memory,
        custom_memory: values.custom_memory,
        position: values.position,
        style: values.style,
      });
      message.success(t("profile.save_success"));
      setInitialValues(values);
      setShowButtons(false);
    } catch (error) {
      console.error("Failed to save memory:", error);
      message.error(t("profile.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    form.setFieldsValue(initialValues);
    setShowButtons(false);
  };

  const handleImport = () => {
    setImportOpen(true);
  };

  // 导入成功后刷新数据
  const handleImportSuccess = () => {
    fetchMemory();
  };

  return (
    <div className="flex flex-col h-full py-[26px] px-[30px] overflow-y-auto">
      <h2 className="text-xl font-medium mb-2">
        {t("profile.user_memory")}
      </h2>
      <p className="text-sm text-[#495266] pb-4 leading-relaxed border-b border-[#E6E8EB]">
        {t("profile.user_memory_desc")}
      </p>

      {/* 导入记忆区域 */}
      <div className="h-20 flex items-center my-6">
        <div className="flex-1 pr-8">
          <div className="text-[15px] font-medium">
            {t("profile.import_memory_title")}
          </div>
          <div className="text-sm text-[#495266] leading-relaxed">
            {t("profile.import_memory_desc")}
          </div>
        </div>
        <Button
          className="flex-none flex items-center gap-1.5 border-[#D0D5DD]"
          onClick={handleImport}
        >
          {t("mine.import")}
        </Button>
      </div>

      {/* 表单 */}
      <div className="border-t border-[#E6E8EB] pt-[26px]">
        <Spin spinning={loading}>
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSave}
            onValuesChange={handleValuesChange}
        >
          <div className="flex gap-6">
            <Form.Item label={t("form.nickname")} className="flex-1">
              <Input
                value={nickname || userStore.info.nickname || "-"}
                disabled
                className="bg-[#F5F5F5] h-10"
              />
            </Form.Item>
            <Form.Item label={t("form.department")} className="flex-1">
              <Input
                value={department || userStore.info.departments || enterpriseStore.display_name || ""}
                disabled
                className="bg-[#F5F5F5] h-10"
              />
            </Form.Item>
          </div>

          <div className="flex gap-6">
            <Form.Item
              name="position"
              label={t("form.position")}
              className="flex-1"
            >
              <Input
                maxLength={15}
                showCount
                placeholder={t("form.position_placeholder")}
                className="h-10"
              />
            </Form.Item>
            <Form.Item
              name="style"
              label={t("profile.style")}
              className="flex-1"
            >
              <Select
                placeholder={t("profile.style_placeholder")}
                allowClear
                className="h-10"
                options={[
                  { value: t("profile.style_concise"), label: t("profile.style_concise") },
                  { value:  t("profile.style_conclusion_first"), label: t("profile.style_conclusion_first") },
                  { value: t("profile.style_detailed"), label: t("profile.style_detailed") },
                ]}
              />
            </Form.Item>
          </div>

          {/* 智能记忆 */}
          <Form.Item
            name="smart_memory"
            label={
              <span className="text-sm font-medium">
                {t("profile.smart_memory")}
              </span>
            }
          >
            <Input.TextArea
              rows={5}
              placeholder={t("profile.smart_memory_placeholder")}
              style={{ resize: 'none' }}
              className="resize-none text-sm placeholder:text-secondary"
            />
          </Form.Item>

          {/* 个性要求 */}
          <Form.Item
            name="custom_memory"
            label={
              <span className="text-sm font-medium">
                {t("profile.custom_memory")}
              </span>
            }
          >
            <Input.TextArea
              rows={5}
              placeholder={t("profile.custom_memory_placeholder")}
              style={{ resize: 'none' }}
              className="resize-none text-sm placeholder:text-secondary"
            />
          </Form.Item>

          {/* 保存按钮 - 只在有变化时显示 */}
          {showButtons && (
            <Form.Item className="mt-6">
              <div className="flex justify-end gap-3">
                <Button onClick={handleCancel}>
                  {t("action.cancel")}
                </Button>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={saving}
                >
                  {t("action.ok")}
                </Button>
              </div>
            </Form.Item>
          )}
        </Form>
        </Spin>
      </div>

      {/* 导入记忆弹窗 */}
      <ImportMemoryModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImportSuccess={handleImportSuccess}
      />
    </div>
  );
});

ProfileMemory.displayName = "ProfileMemory";

export default ProfileMemory;
