import {
  useState,
  useCallback, forwardRef,
  useImperativeHandle,
  useMemo
} from "react";
import { Drawer, Button, Table, Switch, message, Modal } from "antd";
import { SvgIcon, Search } from "@km/shared-components-react";
import { t } from "@/locales";
import { useNavigate } from "react-router-dom";
import { agentApi, AGENT_TYPE } from "@/api/modules/agent";
import { subscriptionApi } from "@/api/modules/subscription";
import {
  getAgentByChannelType,
  PROVIDER_VALUES,
} from "@/constants/platform/config";
import { VERSION_MODULE } from "@/constants/enterprise";
import { useVersion } from "@/hooks";

interface AgentData {
  agent_id?: number;
  name?: string;
  description?: string;
  logo?: string;
  enable?: boolean;
  sort?: number;
  user_group_ids: number[];
  user_group_names: string[];
  channel_config?: {
    channel_type?: string;
  };
}

interface SubscriptionData {
  group_id: number;
  group_name: string;
}

interface AgentListDrawerProps {
  onChange?: () => void;
}

export interface AgentListDrawerRef {
  open: (options?: { data?: Record<string, any>; type?: number }) => void;
  close: () => void;
  loadListData: () => Promise<void>;
  create: (options?: { data?: Record<string, any>; type?: number }) => void;
}

export const AgentListDrawer = forwardRef<
  AgentListDrawerRef,
  AgentListDrawerProps
>(({ onChange }, ref) => {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [filterForm, setFilterForm] = useState({
    channel_types: String(PROVIDER_VALUES.DIFY),
    keyword: "",
    offset: 0,
    limit: 10,
  });
  const [tableData, setTableData] = useState<AgentData[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  const [originData, setOriginData] = useState<Record<string, any>>({});
  const [subscriptionList, setSubscriptionList] = useState<SubscriptionData[]>(
    [],
  );
  const [allTotal, setAllTotal] = useState(0);

  const { guard: guardAgentVersion } = useVersion({
    module: VERSION_MODULE.AGENT,
    count: allTotal,
    content: t("version.agent_limit"),
  });

  const drawerTitle = useMemo(() => {
    const agent = getAgentByChannelType(Number(filterForm.channel_types));
    return agent && agent.label ? t(agent.label) : "";
  }, [filterForm.channel_types]);

  const loadSubscriptionList = useCallback(async () => {
    if (subscriptionList.length === 0) {
      const response = await subscriptionApi.list({
        params: { offset: 0, limit: 1000 },
      });
      setSubscriptionList(response);
    }
  }, [subscriptionList.length]);

  const loadAllTotal = useCallback(async () => {
    const { count = 0 } = await agentApi.list({
      params: {
        group_id: "-1",
        keyword: "",
        offset: 0,
        limit: 1,
      },
    });
    setAllTotal(count as number);
  }, []);

  const loadListData = useCallback(
    async (params?: { offset?: number; limit?: number; channel_types?: string; keyword?: string }) => {
      setTableLoading(true);
      await loadSubscriptionList();
      loadAllTotal();
      const currentOffset = params?.offset ?? filterForm.offset;
      const currentLimit = params?.limit ?? filterForm.limit;
      const channelTypes = params?.channel_types ?? filterForm.channel_types;
      const searchKeyword = params?.keyword ?? filterForm.keyword;
      try {
        const { count = 0, agents = [] } = await agentApi.list({
          params: {
            ...filterForm,
            offset: currentOffset,
            limit: currentLimit,
            channel_types: channelTypes,
            keyword: searchKeyword,
          },
        });

        const mappedAgents = agents.map((item: any) => ({
          ...item,
          user_group_ids: item.user_group_ids || [],
          user_group_names: (item.user_group_ids || [])
            .map((value: number) => {
              const sub = subscriptionList.find(
                (row) => row.group_id === value,
              );
              return sub ? sub.group_name : "";
            })
            .filter(Boolean),
        }));

        setTableData(mappedAgents);
        setTableTotal(count as number);
        setOriginData((prev) => ({ ...prev, agent_total: count }));
      } finally {
        setTableLoading(false);
      }
    },
    [filterForm, loadSubscriptionList, loadAllTotal, subscriptionList],
  );

  const refresh = useCallback(() => {
    setFilterForm((prev) => ({ ...prev, offset: 0 }));
    return loadListData({ offset: 0 });
  }, [loadListData]);

  const open = useCallback(
    async (options: { data?: Record<string, any>; type?: number } = {}) => {
      const { data = {}, type = PROVIDER_VALUES.DIFY } = options;
      const channelTypes = String(type);
      setFilterForm((prev) => ({ ...prev, channel_types: channelTypes, offset: 0, keyword: "" }));
      setOriginData(data);
      setTableData([]);
      setVisible(true);
      setTimeout(() => loadListData({ offset: 0, channel_types: channelTypes, keyword: "" }), 0);
    },
    [loadListData],
  );

  const close = useCallback(() => {
    setVisible(false);
  }, []);

  const onAgentCreate = useCallback(
    (data?: Partial<AgentData> & { channel_type?: string | number; title?: string; channelTypeValue?: number }) => {
      const channelTypeValue = data?.channelTypeValue ?? Number(filterForm.channel_types);
      const agent = getAgentByChannelType(channelTypeValue);
      const agent_type = agent.name || AGENT_TYPE.DIFY_AGENT;

      if (data?.agent_id) {
        navigate({
          pathname: "/agent/create-v2",
          search: `?type=${agent_type}&agent_id=${data.agent_id}`,
        });
      } else {
        const channelType = data?.channel_type ?? originData.id;
        const title = data?.title ?? originData?.label ?? "";
        navigate({
          pathname: "/agent/create-v2",
          search: `?type=${agent_type}&channel_type=${channelType}&title=${title}&from=platform`,
        });
      }
    },
    [filterForm.channel_types, originData, navigate],
  );

  const onRowClick = useCallback(
    (row: AgentData) => {
      onAgentCreate(row);
    },
    [onAgentCreate],
  );

  const onAgentStatusChange = useCallback(async (data: AgentData) => {
    await agentApi.updateStatus({
      data: { agent_id: data.agent_id!, enable: data.enable! },
    });
    message.success(
      t(data.enable ? "action_enable_success" : "action_disable_success"),
    );
  }, []);

  const onAgentDelete = useCallback(
    async (data: AgentData) => {
      Modal.confirm({
        title: t("action_delete"),
        content: t("agent_delete_confirm"),
        okText: t("action_confirm"),
        cancelText: t("action_cancel"),
        onOk: async () => {
          await agentApi.delete({ data: { agent_id: data.agent_id! } });
          message.success(t("action_delete_success"));
          loadListData();
        },
      });
    },
    [loadListData],
  );

  const handleTest = useCallback(
    (data: AgentData) => {
      if (guardAgentVersion()) {
        onAgentCreate(data);
      }
    },
    [guardAgentVersion, onAgentCreate],
  );

  useImperativeHandle(
    ref,
    () => ({
      open,
      close,
      loadListData,
      create: (options: { data?: Record<string, any>; type?: number } = {}) => {
        const { data = {}, type = PROVIDER_VALUES.DIFY } = options;
        setFilterForm((prev) => ({ ...prev, channel_types: String(type) }));
        setOriginData(data);
        onAgentCreate({ channel_type: data.id, title: data?.label || "", channelTypeValue: type });
      },
    }),
    [open, close, loadListData, onAgentCreate],
  );

  const columns = [
    {
      title: t("module.agent"),
      dataIndex: "name",
      key: "name",
      width: 180,
      ellipsis: true,
      render: (_: any, row: AgentData) => (
        <div className="flex items-center gap-2 w-full">
          <img
            className="flex-none w-8 h-8 rounded-full overflow-hidden"
            src={row.logo}
            alt=""
          />
          <div className="flex-1 w-0 text-sm flex flex-col">
            <div className="text-brand truncate">{row.name || "--"}</div>
            {row.description && (
              <div className="text-xs text-placeholder truncate">
                {row.description}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      title: t("usage_range"),
      dataIndex: "user_group_names",
      key: "user_group_names",
      width: 140,
      ellipsis: true,
      render: (names: string[]) => (
        <span className={names.length === 0 ? "text-placeholder" : ""}>
          {names.join("、") || "--"}
        </span>
      ),
    },
    {
      title: t("sort"),
      dataIndex: "sort",
      key: "sort",
      width: 80,
      ellipsis: true,
    },
    {
      title: t("action_enable"),
      dataIndex: "enable",
      key: "enable",
      width: 80,
      render: (enable: boolean, row: AgentData) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={enable}
            onChange={(checked) => {
              row.enable = checked;
              onAgentStatusChange(row);
            }}
          />
        </div>
      ),
    },
    {
      title: t("operation"),
      key: "operation",
      width: 120,
      align: "left" as const,
      fixed: "end" as const,
      render: (_: any, row: AgentData) => (
        <div className="flex gap-2 opacity-0 group-hover:opacity-100">
          <Button
            type="link"
            icon={<SvgIcon name="edit" />}
            className="hover:!text-brand"
            onClick={(e) => {
              e.stopPropagation();
              onAgentCreate(row);
            }}
          />
          <Button
            type="link"
            icon={<SvgIcon name="delete" />}
            className="hover:!text-tag-red"
            onClick={(e) => {
              e.stopPropagation();
              onAgentDelete(row);
            }}
          />
        </div>
      ),
    },
  ];

  return (
    <Drawer
      open={visible}
      title={drawerTitle}
      onClose={close}
      destroyOnHidden
      mask={{ closable: false }}
      styles={{ wrapper: { width: '70%' } }}
    >
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <Search
            mode="expanded"
            placeholder={t("action_search")}
            value={filterForm.keyword}
            onDebouncedChange={(val) => {
              setFilterForm((prev) => ({ ...prev, keyword: val }));
              loadListData({ keyword: val });
            }}
          />
        </div>
        <Button type="primary" onClick={() => handleTest({} as AgentData)}>
          {t("action_add")}
        </Button>
      </div>

      <Table
        rowKey="agent_id"
        columns={columns}
        dataSource={tableData}
        loading={tableLoading}
        className="platform-table"
        scroll={{ x: "max-content" }}
        pagination={{
          current: filterForm.offset + 1,
          pageSize: filterForm.limit,
          total: tableTotal,
          showSizeChanger: true,
          showTotal: (total) => t("table_footer_text", { total }),
          onChange: (page, pageSize) => {
            const newOffset = (page - 1) * pageSize;
            setFilterForm((prev) => ({
              ...prev,
              offset: newOffset,
              limit: pageSize,
            }));
            loadListData({ offset: newOffset, limit: pageSize });
          },
        }}
        onRow={(row) => ({
          onClick: () => onRowClick(row),
          className: "group cursor-pointer",
        })}
        headerRowClassName="rounded overflow-hidden"
      />
    </Drawer>
  );
});

export default AgentListDrawer;
