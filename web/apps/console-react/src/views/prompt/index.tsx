import { Table, Button, Switch, message, Modal } from "antd";
import { SvgIcon, Search } from "@km/shared-components-react";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ColumnsType } from "antd/es/table";
import { PageLayoutContent } from "@/components/PageLayout";
import { promptApi } from "@/api/modules/prompt";
import { groupApi } from "@/api/modules/group";
import type { Group } from "@/api/modules/group";
import { subscriptionApi } from "@/api/modules/subscription";
import { GroupTabs, type GroupTabsRef } from "@/components/GroupTabs";
import { GROUP_TYPE } from "@/constants/group";
import { eventBus } from "@km/shared-utils";
import { t } from "@/locales";
import { api_host } from "@/utils/config";
import { useListState } from "@/hooks";
import { PromptBasicInfo, type PromptBasicInfoRef } from "./create/components/PromptBasicInfo";

const DEFAULT_LOGO = `${api_host}/api/images/prompt/logo.png`;

const DEFAULT_CREATE_FORM = {
  name: "",
  description: "",
  logo: DEFAULT_LOGO,
  group_ids: [] as number[],
};

interface PromptItem {
  prompt_id: number;
  name: string;
  description: string;
  group_ids: number[];
  group_names: string[];
  user_group_names: string[];
  internal_members: string[];
  status: number;
  created_time: string;
}

interface FilterForm {
  group_id: number[];
  keyword: string;
  page: number;
  pageSize: number;
}

export function PromptPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [tableData, setTableData] = useState<PromptItem[]>([]);
  const [tableTotal, setTableTotal] = useState(0);

  // 默认状态（稳定引用，避免每次渲染创建新对象）
  const defaultFilterForm = useMemo<FilterForm>(() => ({
    group_id: [] as number[],
    keyword: "",
    page: 1,
    pageSize: 10,
  }), []);

  // 使用 useListState 管理 URL 持久化状态
  const { state: filterForm, stateRef: filterFormRef, updateState } = useListState<FilterForm>(
    defaultFilterForm,
    {
      enableUrlSync: true,
      urlPrefix: 'prompt_',
      searchFields: ['keyword', 'group_id'],
    }
  );

  // 标记是否已初始化（避免初始化时重复请求）
  const initializedRef = useRef(false);

  const groupTabsRef = useRef<GroupTabsRef>(null);
  const internalGroupOptionsRef = useRef<Record<number, string>>({});
  const subscriptionListOptionsRef = useRef<Record<number, string>>({});
  const groupListRef = useRef<Group[]>([]);
  const loadingRef = useRef(false);

  // Load data - 使用传入的参数或 ref 中的值
  const loadData = useCallback(async (params?: { group_id?: number[]; keyword?: string; page?: number; pageSize?: number }) => {
    if (loadingRef.current) return;
    setLoading(true);
    loadingRef.current = true;

    try {
      // 优先使用传入的参数，否则使用 ref 中的当前值
      const current = filterFormRef.current;
      const group_id = params?.group_id ?? current.group_id;
      const keyword = params?.keyword ?? current.keyword;
      const page = params?.page ?? current.page;
      const pageSize = params?.pageSize ?? current.pageSize;

      const res = await promptApi.list({
        params: {
          group_id: group_id.join(","),
          keyword,
          offset: (page - 1) * pageSize,
          limit: pageSize,
        },
      });

      const groupOpts: Record<number, string> = {};
      groupListRef.current.forEach((item: Group) => {
        groupOpts[item.group_id] = item.group_name;
      });
      const internalOpts = internalGroupOptionsRef.current;
      const subscriptionOpts = subscriptionListOptionsRef.current;

      const list = (res.list || []).map((item: any) => {
        item.group_ids = item.group_ids || [];
        item.group_names = [];
        item.internal_members = [];
        item.user_group_names = [];
        item.logo = item.logo || DEFAULT_LOGO;
        item.group_ids.forEach((id: number) => {
          if (groupOpts[id]) item.group_names.push(groupOpts[id]);
          if (internalOpts[id]) item.internal_members.push(internalOpts[id]);
          if (subscriptionOpts[id]) item.user_group_names.push(subscriptionOpts[id]);
        });
        return item;
      });

      setTableData(list);
      setTableTotal(res.total || 0);
    } catch (error) {
      console.error("Load prompt list error:", error);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, []);

  // Load subscription list
  const loadSubscriptionList = useCallback(async () => {
    try {
      const list = await subscriptionApi.list({ params: { offset: 0, limit: 1000 } });
      const options: Record<number, string> = {};
      list.forEach((item: any) => {
        options[item.group_id] = item.group_name;
      });
      subscriptionListOptionsRef.current = options;
    } catch (error) {
      console.error("Load subscription list error:", error);
    }
  }, []);

  // Load internal group list
  const loadInternalGroupList = useCallback(async () => {
    try {
      const list = await groupApi.list({ params: { group_type: GROUP_TYPE.INTERNAL_USER } });
      const options: Record<number, string> = {};
      list.forEach((item: any) => {
        options[item.group_id] = item.group_name;
      });
      internalGroupOptionsRef.current = options;
    } catch (error) {
      console.error("Load internal group list error:", error);
    }
  }, []);

  // Handle status change
  const handleStatusChange = useCallback(async (item: PromptItem, checked: boolean) => {
    try {
      await promptApi.update_status({ prompt_id: item.prompt_id, status: checked ? 1 : 0 });
      message.success(t("action_save_success"));
      loadData();
    } catch (error) {
      console.error("Update status error:", error);
    }
  }, [loadData]);

  // Handle edit
  const handleEdit = useCallback((item: PromptItem) => {
    navigate(`/prompt/create?prompt_id=${item.prompt_id}`);
  }, [navigate]);

  // Handle delete
  const handleDelete = useCallback(async (item: PromptItem) => {
    Modal.confirm({
      title: t("tip"),
      content: t("prompt.delete_confirm"),
      onOk: async () => {
        try {
          await promptApi.delete({ prompt_id: item.prompt_id });
          message.success(t("action_delete_success"));
          loadData();
        } catch (error) {
          console.error("Delete prompt error:", error);
        }
      },
    });
  }, [loadData]);

  // Handle row click
  const onRowClick = useCallback((record: PromptItem) => {
    handleEdit(record);
  }, [handleEdit]);

  // Create modal state
  const createModalRef = useRef<PromptBasicInfoRef>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createFormData, setCreateFormData] = useState(DEFAULT_CREATE_FORM);

  // Handle create confirm
  const handleCreateConfirm = useCallback(async () => {
    const valid = await createModalRef.current?.validate();
    if (!valid) return;

    // Navigate to create page with URL parameters
    const params = new URLSearchParams();
    params.set("name", createFormData.name);
    if (createFormData.description) params.set("description", createFormData.description);
    if (createFormData.logo) params.set("logo", createFormData.logo);
    if (createFormData.group_ids.length) params.set("group_ids", createFormData.group_ids.join(","));

    navigate(`/prompt/create?${params.toString()}`);
    setCreateModalVisible(false);
  }, [navigate, createFormData]);

  // Table columns
  const columns: ColumnsType<PromptItem> = useMemo(() => [
    {
      title: t("title"),
      dataIndex: "name",
      key: "name",
      width: 180,
      render: (_: any, row) => (
        <div className="flex items-center gap-2 w-full">
          <img className="flex-none w-8 h-8 rounded-full overflow-hidden" src={row.logo || DEFAULT_LOGO} alt="" />
          <div className="flex-1 w-0 text-sm flex flex-col">
            <div className="text-primary truncate">{row.name || "--"}</div>
            {row.description && <div className="text-xs text-placeholder truncate">{row.description}</div>}
          </div>
        </div>
      ),
    },
    {
      title: t('prompt.ai_links'),
      dataIndex: "ai_links_data",
      key: "ai_links_data",
      width: 160,
      ellipsis: true,
      render: (links: any[]) => (
        <span className={!(links && links.length) ? "text-placeholder" : ""}>
          {links ? links.map(item => item.name).join('、') : "--"}
        </span>
      ),
    },
    {
      title: t("group"),
      dataIndex: "group_names",
      key: "group_names",
      width: 180,
      ellipsis: true,
      render: (names: string[]) => (
        <span className={!names?.length ? "text-placeholder" : ""}>{names?.join("、") || "--"}</span>
      ),
    },
    {
      title: t("usage_range"),
      key: "usage_range",
      width: 180,
      ellipsis: true,
      render: (_, record) => (
        <div className={`whitespace-nowrap truncate ${!record.internal_members?.length ? "text-placeholder" : ""}`}>
          {record.internal_members?.join("、") || "--"}
        </div>
      ),
    },
    {
      title: t("action_enable"),
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: number, record) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Switch checked={status === 1} onChange={(checked) => handleStatusChange(record, checked)} />
        </div>
      ),
    },
    {
      title: t("operation"),
      key: "operation",
      width: 100,
      align: "right",
      fixed: "end",
      render: (_, record) => (
        <>
          <Button type="text" icon={<SvgIcon name="edit" />} className="invisible group-hover:visible hover:!text-brand" onClick={(e) => { e.stopPropagation(); handleEdit(record); }} />
          <Button type="text" danger icon={<SvgIcon name="delete" />} className="invisible group-hover:visible hover:!text-tag-red" onClick={(e) => { e.stopPropagation(); handleDelete(record); }} />
        </>
      ),
    },
  ], [handleStatusChange, handleEdit, handleDelete]);

  // Refresh - 只更新状态，数据加载由 useEffect 监听
  const refresh = useCallback(() => {
    updateState({ page: 1 });
  }, [updateState]);

  // Handle pagination
  const handleTableChange = useCallback((pagination: any) => {
    updateState({ page: pagination.current, pageSize: pagination.pageSize });
  }, [updateState]);

  // 初始化
  useEffect(() => {
    const init = async () => {
      await Promise.all([loadInternalGroupList(), loadSubscriptionList()]);
      initializedRef.current = true;
      loadData();
    };
    init();

    eventBus.on("user-login-success", refresh);
    eventBus.on("prompt-create", refresh);
    eventBus.on("prompt-update", loadData);

    return () => {
      eventBus.off("user-login-success", refresh);
      eventBus.off("prompt-create", refresh);
      eventBus.off("prompt-update", loadData);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只在挂载时执行一次

  // 监听 filterForm 变化，自动加载数据
  const filterKey = JSON.stringify(filterForm);
  useEffect(() => {
    if (!initializedRef.current) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);
  // Filter bar
  const filterBar = (
    <>
      <div className="flex-1 w-0 flex items-center gap-2">
        <GroupTabs
          ref={groupTabsRef}
          className="w-[200px]"
          type="dropdown"
          groupType={GROUP_TYPE.PROMPT}
          value={filterForm.group_id}
          onChange={(ids) => {
            // 将 string[] 转换为 number[]
            const groupIds = Array.isArray(ids)
              ? ids.map(id => Number(id)).filter(n => !isNaN(n))
              : Number(ids)
            updateState({ group_id: Array.isArray(groupIds) ? groupIds : [groupIds] });
          }}
          onOptionsChange={(options) => {
            groupListRef.current = options as Group[];
          }}
        />
        <Search
          mode="expanded"
          value={filterForm.keyword}
          onDebouncedChange={(val) => {
            updateState({ keyword: val });
          }}
          placeholder={t("prompt.search_placeholder")}
          className="w-[268px]"
        />
      </div>
      <div className="flex-none flex items-center gap-3 ml-8">
        <Button type="primary" onClick={() => {
          setCreateFormData(DEFAULT_CREATE_FORM);
          setCreateModalVisible(true);
        }}>
          {t("action_add")}
        </Button>
      </div>
    </>
  );

  return (
    <PageLayoutContent header={t("module.prompt")} filterBar={filterBar}>
      <Table
        rowKey="prompt_id"
        columns={columns}
        dataSource={tableData}
        loading={loading}
        pagination={{
          current: filterForm.page,
          pageSize: filterForm.pageSize,
          total: tableTotal,
          showSizeChanger: true,
          showTotal: (total) => t("table_footer_text", { total }),
        }}
        onChange={handleTableChange}
        onRow={(record) => ({
          onClick: () => onRowClick(record),
          className: "group cursor-pointer",
        })}
        rowClassName="group cursor-pointer"
      />

      {/* Create modal */}
      <Modal
        open={createModalVisible}
        title={t("dialog.basic_info")}
        onCancel={() => setCreateModalVisible(false)}
        onOk={handleCreateConfirm}
        destroyOnHidden
        width="50%"
      >
        <PromptBasicInfo
          ref={createModalRef}
          value={createFormData}
          onChange={setCreateFormData}
          t={t}
        />
      </Modal>
    </PageLayoutContent>
  );
}

export default PromptPage;
