/**
 * Toolbox 创建/编辑页面（重构版）
 * 使用 Zustand 状态管理 + 复用原版组件
 */
import { useState, useEffect, useCallback } from "react";
import { Button, Form, Input, Select, Modal, message } from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";

import ImageUpload from "@/components/Upload/image";
import { PageLayoutContent } from "@/components/PageLayout";
import { GROUP_TYPE } from "@/constants/group";
import { t } from "@/locales";
import { imageValidator, textValidator, urlValidator } from "@/utils/form-rule";
import { useEnterpriseStore } from "@/stores/modules/enterprise";
import groupApi from "@/api/modules/group";

import { toolboxApi } from "../api/toolboxApi";
import type { SharedAccountItem } from "../types";

// 使用 refactored 目录的组件
import UseGroup from "./components/UseGroup";
import SharedAccountDialog from "./components/SharedAccountDialog";
import SharedAccountTable from "./components/SharedAccountTable";

/** 分组选项 */
interface GroupOption {
  group_id: number;
  group_name: string;
}

/** 表单验证器包装 */
const withValidator =
  (
    validator: (opts: {
      value?: unknown;
      callback: (err?: Error) => void;
    }) => void,
  ) =>
  (_: unknown, value: unknown) =>
    new Promise<void>((resolve, reject) => {
      validator({ value, callback: (err) => (err ? reject(err) : resolve()) });
    });

/**
 * Toolbox 创建/编辑页面
 */
export function ToolboxCreatePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const enterpriseStore = useEnterpriseStore();
  const [form] = Form.useForm();

  // 状态
  const [groupOptions, setGroupOptions] = useState<GroupOption[]>([]);
  const [userGroup, setUserGroup] = useState<number[]>([]);
  const [subscriptionGroup, setSubscriptionGroup] = useState<number[]>([]);
  const [accountList, setAccountList] = useState<SharedAccountItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] =
    useState<SharedAccountItem | null>(null);
  const [isEditable, setIsEditable] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState(t("action_add"));
  const [sort, setSort] = useState(0);

  // 计算属性
  const showGroupOptions = groupOptions.filter((item) => item.group_id > 0);

  // 加载分组
  const loadGroups = useCallback(async () => {
    const list = await groupApi.list({
      params: { group_type: GROUP_TYPE.AI_LINK },
    });
    setGroupOptions(list || []);
    return list || [];
  }, []);

  // 获取用户分组 ID
  const getGroupIds = useCallback(
    async (groupType: number) => {
      if (
        (groupType === GROUP_TYPE.USER &&
          (enterpriseStore.info.is_independent ||
            enterpriseStore.info.is_industry)) ||
        (groupType === GROUP_TYPE.INTERNAL_USER &&
          (enterpriseStore.info.is_enterprise ||
            enterpriseStore.info.is_industry))
      ) {
        const list = await groupApi.list({ params: { group_type: groupType } });
        return (list || []).map((item: GroupOption) => item.group_id);
      }
      return [];
    },
    [enterpriseStore.info],
  );

  // 加载表单数据
  const loadFormData = useCallback(
    async (id?: string, name?: string) => {
      const groups = await loadGroups();
      const internalGroups = await getGroupIds(GROUP_TYPE.INTERNAL_USER);
      const subscriptionGroups = await getGroupIds(GROUP_TYPE.USER);

      if (id) {
        // 编辑模式
        const detail = await toolboxApi.detail(id);
        const data = detail.data;

        setTitle(data.name || "");
        setIsEditable(true);
        setSort(data.sort || 0);

        const accounts = data.shared_account
          ? JSON.parse(data.shared_account)
          : [];
        setAccountList(accounts);
        // 参考Vue版本：从 user_group_ids 中过滤出对应的分组ID
        // 因为后端可能将所有ID都放在 user_group_ids 中返回
        const allGroupIds = data.user_group_ids || [];
        setUserGroup(
          allGroupIds.filter((id) => internalGroups.includes(id)),
        );
        setSubscriptionGroup(
          allGroupIds.filter((id) => subscriptionGroups.includes(id)),
        );

        form.setFieldsValue({
          logo: data.logo || "",
          name: data.name || "",
          url: data.url || "",
          description: data.description || "",
          group_id: data.group_id || groups[0]?.group_id,
        });
      } else if (name) {
        // 从商店添加
        setTitle(name);
        setIsEditable(false);
        setSort(0);
        setAccountList([]);
        // 设置默认权限组（新建模式下默认全选）
        setUserGroup(internalGroups);
        setSubscriptionGroup(subscriptionGroups);

        const storeData = await toolboxApi.store();
        for (const group of storeData.data || []) {
          const found = group.links?.find((link) => link.name === name);
          if (found) {
            form.setFieldsValue({
              logo: found.logo || "",
              name: found.name || "",
              url: found.url || "",
              description: found.description || "",
              group_id: found.group_id || groups[0]?.group_id,
            });
            return;
          }
        }

        // 未找到，使用默认值
        form.setFieldsValue({ group_id: groups[0]?.group_id });
      } else {
        // 新建
        setTitle(t("action_add"));
        setIsEditable(false);
        setSort(0);
        setAccountList([]);
        setUserGroup(internalGroups);
        setSubscriptionGroup(subscriptionGroups);
        form.setFieldsValue({ group_id: groups[0]?.group_id });
      }
    },
    [loadGroups, getGroupIds, form],
  );

  // 保存
  const handleSave = useCallback(async () => {
    if (submitting) return;

    try {
      const values = await form.validateFields();
      setSubmitting(true);

      const payload = {
        ...values,
        sort,
        shared_account: accountList.length ? JSON.stringify(accountList) : "",
        subscription_group_ids: subscriptionGroup,
        user_group_ids: userGroup,
        ai_link_id: searchParams.get("id") || undefined,
      };

      const result = await toolboxApi.save(payload);
      message.success(t("action_save_success"));

      if (!isEditable && result.ai_link_id) {
        setSearchParams({ id: result.ai_link_id });
        setTitle(result.name || "");
        setIsEditable(true);
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    form,
    accountList,
    subscriptionGroup,
    userGroup,
    sort,
    isEditable,
    submitting,
    searchParams,
    setSearchParams,
  ]);

  // 返回
  const handleBack = useCallback(() => {
    navigate("/toolbox");
  }, [navigate]);

  // 分组变更
  const handleGroupChange = useCallback(
    (payload: { groupType: number; data: number[] }) => {
      if (payload.groupType === GROUP_TYPE.USER) {
        setSubscriptionGroup(payload.data);
      } else {
        setUserGroup(payload.data);
      }
    },
    [],
  );

  // 账号操作
  const handleAddAccount = useCallback(() => {
    setEditingAccount(null);
    setDialogOpen(true);
  }, []);

  const handleAccountSubmit = useCallback(
    (values: SharedAccountItem) => {
      setAccountList((prev) => {
        const index = prev.findIndex(
          (item) => item.account === editingAccount?.account,
        );
        if (index >= 0) {
          const next = [...prev];
          next[index] = values;
          return next;
        }
        return [...prev, values];
      });
      setDialogOpen(false);
      setEditingAccount(null);
    },
    [editingAccount],
  );

  const handleAccountEdit = useCallback((item: SharedAccountItem) => {
    setEditingAccount(item);
    setDialogOpen(true);
  }, []);

  const handleAccountDelete = useCallback(async (item: SharedAccountItem) => {
    try {
      await new Promise<void>((resolve, reject) => {
        Modal.confirm({
          title: t("action_delete_tip"),
          content: t("form_delete_confirm"),
          onOk: () => resolve(),
          onCancel: () => reject(),
        });
      });
      setAccountList((prev) =>
        prev.filter((account) => account.account !== item.account),
      );
      message.success(t("action_delete_success"));
    } catch {
      // 用户取消
    }
  }, []);

  // 初始化
  useEffect(() => {
    loadFormData(
      searchParams.get("id") || undefined,
      searchParams.get("name") || undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  return (
    <PageLayoutContent
      header={{ title, back: true, onBack: handleBack }}
      contentClassName="flex-1 flex overflow-hidden"
      footer={
        <Button type="primary" loading={submitting} onClick={handleSave}>
          {t("action_save")}
        </Button>
      }
    >
      <div className="h-full flex">
        {/* 左侧 - 基本信息 */}
        <div className="w-1/2 h-full p-6 border-r overflow-y-auto">
          <div className="font-bold mb-3">{t("basic_info")}</div>
          <Form
            form={form}
            layout="vertical"
            className="p-5 bg-[#F7F8FA] rounded"
            requiredMark
          >
            <Form.Item
              label={t("group")}
              name="group_id"
              rules={[{ validator: withValidator(textValidator) }]}
            >
              <Select
                placeholder={t("form_select_placeholder")}
                options={showGroupOptions.map((item) => ({
                  label: t(item.group_name),
                  value: item.group_id,
                }))}
              />
            </Form.Item>
            <Form.Item
              label="URL"
              name="url"
              rules={[{ validator: withValidator(urlValidator) }]}
            >
              <Input placeholder="http://" />
            </Form.Item>
            <Form.Item
              label={t("name")}
              name="name"
              rules={[{ validator: withValidator(textValidator) }]}
            >
              <Input
                maxLength={20}
                showCount
                placeholder={t("form_input_placeholder")}
              />
            </Form.Item>
            <Form.Item label={t("description")} name="description">
              <Input.TextArea
                rows={3}
                maxLength={200}
                showCount
                placeholder={t("form_input_placeholder")}
                style={{ resize: "none" }}
              />
            </Form.Item>
            <Form.Item
              label={t("avatar")}
              name="logo"
              valuePropName="value"
              rules={[{ validator: withValidator(imageValidator) }]}
            >
              <ImageUpload className="w-12 h-12" />
            </Form.Item>
          </Form>
        </div>

        {/* 右侧 - 工具配置 */}
        <div className="w-1/2 h-full p-6 overflow-y-auto">
          <div className="font-bold mb-3">{t("tool_config")}</div>
          <div className="p-5 bg-[#F7F8FA] rounded">
            <UseGroup
              userGroup={userGroup}
              subscriptionGroup={subscriptionGroup}
              editable={isEditable}
              onChange={handleGroupChange}
            />
            <div className="mt-4 mb-2 flex items-center justify-between gap-2">
              <div className="text-sm text-secondary">
                {t("shared_account")}
              </div>
              <Button
                type="link"
                className="!text-blue-500"
                onClick={handleAddAccount}
              >
                +{t("action_add")}
              </Button>
            </div>
            <SharedAccountTable
              data={accountList}
              onEdit={handleAccountEdit}
              onDelete={handleAccountDelete}
              onRowClick={handleAccountEdit}
            />
          </div>
        </div>
      </div>

      <SharedAccountDialog
        open={dialogOpen}
        accountList={accountList}
        initialValues={editingAccount}
        onCancel={() => {
          setDialogOpen(false);
          setEditingAccount(null);
        }}
        onSubmit={handleAccountSubmit}
      />
    </PageLayoutContent>
  );
}

export default ToolboxCreatePage;
