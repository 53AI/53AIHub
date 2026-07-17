import { Button, Form, message, Modal } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { useEffect, useRef, useState, useCallback } from "react";
import { t } from "@/locales";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageLayoutContent } from "@/components/PageLayout";
import { usePromptFormDataStore } from "./store";
import { eventBus } from "@km/shared-utils";
import { PromptBasicInfo, PromptBasicInfoRef } from "./components/PromptBasicInfo";
import { PromptConfigTab } from "./components/PromptConfigTab";
import StoreDialog, {
  StoreDialogRef,
} from "@/views/toolbox-refactored/components/StoreDialog";
import { getSimpleDateFormatString } from '@km/shared-utils';
import LinksDialog, { LinksDialogRef } from "../components/LinksDialog";
export function PromptCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm();

  const linksDialogRef = useRef<LinksDialogRef>(null);
  const storeDialogRef = useRef<StoreDialogRef>(null);
  const basicInfoRef = useRef<PromptBasicInfoRef>(null);

  const [editVisible, setEditVisible] = useState(false);
  const [editBasicInfo, setEditBasicInfo] = useState({
    name: "",
    description: "",
    logo: "",
    group_ids: [] as number[],
  });

  const formData = usePromptFormDataStore((state) => state.formData);
  const detailData = usePromptFormDataStore((state) => state.detailData);
  const loading = usePromptFormDataStore((state) => state.loading);
  const submitting = usePromptFormDataStore((state) => state.submitting);
  const setFormData = usePromptFormDataStore((state) => state.set);
  const fetchDetail = usePromptFormDataStore((state) => state.fetchDetail);
  const reset = usePromptFormDataStore((state) => state.reset);
  const clear = usePromptFormDataStore((state) => state.clear);
  const save = usePromptFormDataStore((state) => state.save);
  const loadDefaultLinks = usePromptFormDataStore(
    (state) => state.loadDefaultLinks,
  );

  const promptId = searchParams.get("prompt_id");
  const isEdit = !!promptId;

  // 格式化保存时间（接受时间戳，默认当前时间）
  const formatSavedTime = (timestamp?: number) => {
    const now = timestamp ? new Date(timestamp) : new Date();
    return getSimpleDateFormatString({
            date: now,
            format: 'YYYY-MM-DD hh:mm:ss'})
  };

  // Handle open dialogs
  const handleOpenLinksDialog = () => {
    linksDialogRef.current?.open();
  };

  const handleOpenStoreDialog = () => {
    storeDialogRef.current?.open();
  };

  // Handle add scene
  const handleAddScene = (data: { data: any }) => {
    setFormData({
      ai_links: [
        ...(formData.ai_links || []),
        {
          ai_link: { ...data.data },
          delete: false,
        },
      ],
    });
  };

  // Handle delete link
  const handleDeleteLink = (item: any) => {
    item.delete = true;
    setFormData({ ai_links: [...formData.ai_links] });
  };

  // Handle save
  const handleSave = async () => {
    try {
      // Validate basic info fields (name, group_ids)
      if (!formData.name?.trim()) {
        message.warning(t("form_input_placeholder"));
        return;
      }
      if (!formData.group_ids?.length) {
        message.warning(t("form_select_placeholder"));
        return;
      }

      // Validate prompt content
      if (!formData.content?.trim()) {
        message.warning(t("prompt.content_required"));
        return;
      }

      const valid = await form.validateFields();
      if (!valid) return;

      // Get form values to include in save
      const formValues = form.getFieldsValue();

      if (!promptId) {
        const isAILinksChanged = formData.ai_links?.some(
          (item: any) => item.delete,
        );
        const data = await save({ hideToast: isAILinksChanged, formValues });
        if (isAILinksChanged) {
          await save({ prompt_id: data.prompt_id });
        }
        message.success(t("action_save_success"));
        // Notify list page to refresh
        eventBus.emit("prompt-create");
        navigate(
          {
            pathname: "/prompt/create",
            search: `prompt_id=${data.prompt_id}`,
          },
          { replace: true },
        );
      } else {
        await save({ formValues });
        message.success(t("action_save_success"));
        // Notify list page to refresh
        eventBus.emit("prompt-update");
        fetchDetail({ prompt_id: promptId });
      }
    } catch (error) {
      console.error("Save prompt error:", error);
      message.error(t("action_save_failed"));
    }
  };

  // 打开编辑弹框
  const handleEditOpen = useCallback(() => {
    setEditBasicInfo({
      name: formData.name || "",
      description: formData.description || "",
      logo: formData.logo || "",
      group_ids: formData.group_ids || [],
    });
    setEditVisible(true);
  }, [formData.name, formData.description, formData.logo, formData.group_ids]);

  // 保存编辑
  const handleEditSave = useCallback(async () => {
    const valid = await basicInfoRef.current?.validate();
    if (!valid) return;

    setFormData({
      name: editBasicInfo.name,
      description: editBasicInfo.description,
      logo: editBasicInfo.logo,
      group_ids: editBasicInfo.group_ids,
    });
    setEditVisible(false);
  }, [setFormData, editBasicInfo]);

  // Track if form values have been synced from formData
  const syncedRef = useRef(false);

  useEffect(() => {
    syncedRef.current = false;
    form.resetFields();

    if (promptId) {
      fetchDetail({ prompt_id: promptId });
    } else {
      reset().then(() => {
        loadDefaultLinks();

        // Read URL parameters and fill form data
        const nameParam = searchParams.get("name");
        const descriptionParam = searchParams.get("description");
        const logoParam = searchParams.get("logo");
        const groupIdsParam = searchParams.get("group_ids");

        if (nameParam || descriptionParam || logoParam || groupIdsParam) {
          setFormData({
            name: nameParam || "",
            description: descriptionParam || "",
            ...(logoParam ? { logo: logoParam } : {}),
            ...(groupIdsParam ? { group_ids: groupIdsParam.split(",").map(Number) } : {}),
          });
        }
      });
    }

    return () => {
      clear();
    };
  }, [promptId]);

  // Sync form values from formData only when data is loaded
  useEffect(() => {
    // Only sync once when data is ready
    // - Edit mode: formData.prompt_id matches current promptId
    // - New mode: formData.prompt_id is 0
    const isEditModeReady = promptId && String(formData.prompt_id) === promptId;
    const isNewModeReady = !promptId && formData.prompt_id === 0;

    if (!syncedRef.current && (isEditModeReady || isNewModeReady)) {
      syncedRef.current = true;
      form.setFieldsValue({
        content: formData.content || "",
        sort: formData.sort ?? 0,
        subscription_group_ids: formData.subscription_group_ids || [],
        user_group_ids: formData.user_group_ids || [],
      });
    }
  }, [
    promptId,
    formData.prompt_id,
    formData.content,
    formData.sort,
    formData.subscription_group_ids,
    formData.user_group_ids,
    form,
  ]);

  // 渲染配置内容
  const renderConfigContent = () => {
    return (
      <PromptConfigTab
        form={form}
        onOpenLinksDialog={handleOpenLinksDialog}
        onOpenStoreDialog={handleOpenStoreDialog}
        onDeleteLink={handleDeleteLink}
      />
    );
  };

  return (
    <PageLayoutContent
      className="h-full w-full !px-0 !py-0 bg-[#F7F9FC]"
      header={{
        title: (
          <div className="flex items-center gap-2">
            <span>{formData.name || detailData.name || t("action_add")}</span>
            <EditOutlined
              className="cursor-pointer text-placeholder hover:text-tertiary"
              style={{ fontSize: 14 }}
              onClick={handleEditOpen}
            />
          </div>
        ),
        back: true,
        fallbackPath: "/prompt",
        titlePrefix: (formData.logo || detailData.logo) ? (
          <img
            src={formData.logo || detailData.logo}
            className="w-8 rounded"
            alt=""
          />
        ) : (
          <div className="size-8 rounded bg-[#F5F5F7]" />
        ),
        description: (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 truncate max-w-[200px]">
              {formData.description || detailData.description || t("prompt.no_desc")}
            </span>
          </div>
        ),
        right: (
          <div className="flex items-center gap-3">
            {detailData.updated_time && (
              <span className="text-xs text-placeholder">
                {t('agent.last_saved')}：{formatSavedTime(detailData.updated_time)}
              </span>
            )}
            <Button type="primary" loading={loading || submitting} onClick={handleSave}>
              {t('action_publish')}
            </Button>
          </div>
        ),
      }}
      headerClassName="h-16 px-4 border-b border-[#E9EEF7]"
      contentClassName="flex-1 flex overflow-hidden !bg-[#F7F7FA]"
      scrollable={false}
    >
      {renderConfigContent()}
      {/* 编辑基本信息弹框 */}
      <Modal
        open={editVisible}
        title={t("dialog.basic_info")}
        onCancel={() => setEditVisible(false)}
        onOk={handleEditSave}
        width="50%"
      >
        <PromptBasicInfo
          ref={basicInfoRef}
          value={editBasicInfo}
          onChange={setEditBasicInfo}
          t={t}
        />
      </Modal>
      {/* Dialogs */}
      <StoreDialog
        ref={storeDialogRef}
        showAddManual={false}
        onAdd={handleAddScene}
      />
      <LinksDialog ref={linksDialogRef} />
    </PageLayoutContent>
  );
}

export default PromptCreatePage;
