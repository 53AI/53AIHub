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
import type { ScopeItem } from "@/api/modules/agent";

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
  const [subscriptionGroup, setSubscriptionGroup] = useState<number[]>([]);
  const [scopes, setScopes] = useState<ScopeItem[]>([]);
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

  // 加载表单数据
  const loadFormData = useCallback(
    async (id?: string, name?: string) => {
      const groups = await loadGroups();

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
        // scopes 非数组视为空(后端可能返回 "" 或 null,不再用 user_group_ids 派生)
        if (Array.isArray(data.scopes) && data.scopes.length > 0) {
          setScopes(data.scopes);
        } else {
          setScopes([]);
        }
        // 编辑模式读取 user_group_ids 恢复注册用户勾选：
        // AI-link 详情接口在读取时把注册用户分组回填到 user_group_ids（而非 subscription_group_ids，
        // 后者读取时恒为 undefined）。AI-link 模型没有内部用户复选项（内部用户走 scopes），
        // 因此此模型的 user_group_ids 即注册用户分组。转数字归一化后按外层值点亮选项。
        const restoredSubscription = (data.user_group_ids || []).map(Number);
        setSubscriptionGroup(restoredSubscription);

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
        // 企业版/行业版默认全选"全部成员"
        setScopes(
          enterpriseStore.info.is_enterprise || enterpriseStore.info.is_industry
            ? [{ scope_type: 'company', target_id: 0 }]
            : [],
        );

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
        // 企业版/行业版默认全选"全部成员"
        setScopes(
          enterpriseStore.info.is_enterprise || enterpriseStore.info.is_industry
            ? [{ scope_type: 'company', target_id: 0 }]
            : [],
        );
        form.setFieldsValue({ group_id: groups[0]?.group_id });
      }
    },
    [loadGroups, enterpriseStore.info, form],
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
        scopes,
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
    scopes,
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

  // 分组变更（注册用户）
  const handleSubscriptionGroupChange = useCallback((value: number[]) => {
    setSubscriptionGroup(value);
  }, []);

  // 内部用户作用域变更
  const handleScopesChange = useCallback((value: ScopeItem[]) => {
    setScopes(value);
  }, []);

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
              scopes={scopes}
              subscriptionGroup={subscriptionGroup}
              onSubscriptionGroupChange={handleSubscriptionGroupChange}
              onScopesChange={handleScopesChange}
              autoFillAll={!isEditable}
              isNew={!searchParams.get("id")}
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
