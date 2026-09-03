import {
  Table,
  Button,
  Select,
  Switch,
  Modal,
  message,
} from "antd";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { t } from "@/locales";
import { useNavigate } from "react-router-dom";
import { agentApi, AgentData } from "@/api/modules/agent";
import { AGENT_USAGES } from "@/constants/agent";
import { providerApi } from "@/api/modules/provider";
import { subscriptionApi } from "@/api/modules/subscription";
import { groupApi, Group } from "@/api/modules/group";
import { channelApi } from "@/api/modules/channel";
import {
  channels,
  getProvidersByAuth,
  getProviderByAgentId, AgentType, BACKEND_AGENT_TYPE
} from "@/constants/platform/config";
import { VERSION_MODULE } from "@/constants/enterprise";
import { GROUP_TYPE } from "@/constants/group";
import { PageLayoutContent } from "@/components/PageLayout";
import { GroupDialog } from "@/components/GroupDialog";
import { GroupTabs, type GroupTabsRef } from "@/components/GroupTabs";
import { useListState, useVersion, useScopeDictionary } from "@/hooks";
import { eventBus } from "@km/shared-utils";
import {
  CreateAgentDialog,
  AGENT_TYPE_OPTIONS,
  createPlatformsByType, getOpenClawCompatibleAgentMetadata,
  isOpenClawCompatibleAgentType
} from "@km/shared-business/agent-create";
import type { AgentPlatformOption, CreateAgentDialogResult } from "@km/shared-business/agent-create";
import { consoleAgentAdapter } from "@/adapters/agent-create-adapter";
import ScopeDisplay from "@/components/ScopeDisplay";
import { SvgIcon, Search, IconAction, SafeImage } from "@km/shared-components-react";
import { img_host, getPublicPath } from "@/utils/config";
import { buildOpenClawEnterpriseAgentPayload } from "./openclaw-create";
import {
  buildAgentListParams,
  createAgentPlatformFilterOptions,
  AGENT_USAGE_PLATFORM_VALUES,
} from "./platform-filter";

// 获取默认的注册用户和内部用户分组 ID
interface SubscriptionItem {
  group_id: number;
  group_name: string;
}

const getDefaultGroupIds = async () => {
  const subscriptionRes = await subscriptionApi.list({ params: { offset: 0, limit: 1000 } });
  const subscriptionGroupIds = subscriptionRes.map((item: SubscriptionItem) => item.group_id);

  const internalGroupRes = await groupApi.list({ params: { group_type: GROUP_TYPE.INTERNAL_USER } });
  const internalGroupIds = internalGroupRes.map((item: Group) => item.group_id);

  return { subscriptionGroupIds, internalGroupIds };
}


interface ProviderItem {
  provider_type: string;
  is_auth: boolean;
  [key: string]: any;
}

interface FilterForm {
  group_id: number;  // 单选
  platform: string;
  type: string;
  keyword: string;
  page: number;
  page_size: number;
}

interface AgentState extends AgentData {
  user_group_names: string[];
  internal_members: string[];
  group_name: string;
  is_system?: boolean;
}

export function AgentPage() {
  const navigate = useNavigate();
  const dialogRef = useRef<any>(null);
  const uploadImageRef = useRef<{ trigger: () => void }>(null);
  const groupTabsRef = useRef<GroupTabsRef>(null);

  // 默认状态（稳定引用）
  const defaultFilterForm = useMemo<FilterForm>(() => ({
    group_id: 0,  // 0 表示全部
    platform: "",
    type: "",
    keyword: "",
    page: 1,
    page_size: 10,
  }), []);

  // 使用 useListState 管理 URL 持久化状态
  const { state: filterForm, stateRef: filterFormRef, updateState } = useListState<FilterForm>(
    defaultFilterForm,
    {
      enableUrlSync: true,
      urlPrefix: 'agent_',
      searchFields: ['keyword', 'group_id', 'platform', 'type'],
    }
  );

  const [allTotal, setAllTotal] = useState(0);
  const [tableData, setTableData] = useState<AgentState[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  const [addVisible, setAddVisible] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<number | undefined>(undefined);
  const [groupList, setGroupList] = useState<Group[]>([]);
  const [internalGroupOptions, setInternalGroupOptions] = useState<
    Record<number, string>
  >({});
  const [authProviders, setAuthProviders] = useState<ProviderItem[]>([]);
  const [initialized, setInitialized] = useState(false);
  // ScopeDisplay 共享字典:全局 hook 自动 dedup,任意调用方只触发 3 个请求
  const scopeDict = useScopeDictionary();

  // 从适配器获取图片上传组件
  const ImageUploadComponent = consoleAgentAdapter.ImageUploadComponent;

  const { guard: guardAgentVersion } = useVersion({
    module: VERSION_MODULE.AGENT,
    count: allTotal,
    content: t("version.agent_limit"),
  });

  // 使用 ref 来追踪是否已加载，避免闭包问题
  const groupLoadedRef = useRef(false);
  const internalGroupLoadedRef = useRef(false);
  const providerLoadedRef = useRef(false);

  // 使用 ref 存储最新数据，供 loadListData 使用
  const subscriptionListRef = useRef<SubscriptionItem[]>([]);
  const groupListRef = useRef<Group[]>([]);
  const internalGroupOptionsRef = useRef<Record<number, string>>({});
  const authProvidersRef = useRef<ProviderItem[]>([]);

  // 标记是否已初始化（避免初始化时重复请求）
  const initializedRef = useRef(false);
  // 标记分组列表是否已初始化（避免初始化加载时重置筛选）
  const groupInitializedRef = useRef(false);

  // 更新 authProvidersRef
  useEffect(() => {
    authProvidersRef.current = authProviders;
  }, [authProviders]);

  // 使用公共配置，并根据权限过滤
  const platformsByType = useMemo<AgentPlatformOption[]>(() => {
    // 构建权限映射
    const authMap = new Map(
      authProviders.map((provider) => [
        provider.provider_type,
        provider.is_auth,
      ]),
    );

    // 权限过滤函数
    const filterByAuth = (platforms: AgentPlatformOption[]): AgentPlatformOption[] => {
      return platforms.filter((platform) => {
        const provider = getProviderByAgentId(platform.value as AgentType);
        // 如果不需要授权，或者已授权，则显示
        if (!provider?.auth) return true;
        return authMap.get(provider.id) === true;
      });
    };

    // 获取公共配置的平台列表
    const basePlatforms = createPlatformsByType(img_host, getPublicPath);
    return filterByAuth(basePlatforms);
  }, [authProviders]);

  const loadGroupList = async () => {
    if (groupLoadedRef.current) return;
    groupLoadedRef.current = true;
    const list = await groupApi.list({
      params: { group_type: GROUP_TYPE.AGENT },
    });
    groupListRef.current = list;
    setGroupList(list);
  };

  const loadInternalGroupList = async () => {
    if (internalGroupLoadedRef.current) return;
    internalGroupLoadedRef.current = true;
    const list = await groupApi.list({
      params: { group_type: GROUP_TYPE.INTERNAL_USER },
    });
    const options: Record<number, string> = {};
    list.forEach((item: Group) => {
      options[item.group_id] = item.group_name;
    });
    internalGroupOptionsRef.current = options;
    setInternalGroupOptions(options);
  };

  const loadAllTotal = async () => {
    const { count = 0 } = await agentApi.list({
      params: {
        group_id: "-1",
        keyword: "",
        offset: 0,
        limit: 1,
      },
    });
    setAllTotal(count);
  };

  const loadListData = async () => {
    setTableLoading(true);
    await loadGroupList();

    try {
      const currentFilter = filterFormRef.current;
      const { count = 0, agents = [] } = await agentApi.list({
        params: buildAgentListParams(currentFilter),
      });

      setTableTotal(count);

      // 使用 ref 中的分组数据构建名称映射
      const currentGroupList = groupListRef.current;
      const groupOpts: Record<number, string> = {};
      currentGroupList.forEach((item: Group) => {
        groupOpts[item.group_id] = item.group_name;
      });

      // 使用 ref 中的最新数据，而不是 state
      const currentSubscriptionList = subscriptionListRef.current;
      const currentInternalGroupOptions = internalGroupOptionsRef.current;

      const formattedAgents = agents.map((item: Partial<AgentState> = {}) => {
        const agent = item as AgentState;
        agent.user_group_ids = agent.user_group_ids || [];
        agent.user_group_names = [];
        agent.internal_members = [];
        agent.group_name = groupOpts[agent.group_id] || "";
        // 为小助理和AI搜问填充默认值
        if (agent.agent_usage === AGENT_USAGES.WORK_AI) {
          // 小助理
          agent.logo = agent.logo || `${img_host}/agent/workbench.png`;
          agent.name = agent.name || t('agent_app.workbench');
          agent.agent_type = 'workbench';
          agent.custom_config = agent.custom_config || {};
          agent.custom_config.agent_type = agent.agent_type;
          agent.backend_agent_type = BACKEND_AGENT_TYPE.ASSISTANT;
        } else if (agent.agent_usage === AGENT_USAGES.KM_AI_SEARCH) {
          // AI搜问
          agent.logo = agent.logo || `${img_host}/agent/knowledge.png`;
          agent.name = agent.name || t('agent_app.knowledge');
          agent.agent_type = 'knowledge';
          agent.custom_config = agent.custom_config || {};
          agent.custom_config.agent_type = agent.agent_type;
          agent.backend_agent_type = BACKEND_AGENT_TYPE.ASSISTANT;
        }

        agent.user_group_ids.forEach((value) => {
          const subscription = currentSubscriptionList.find(
            (row) => row.group_id === value,
          );
          if (subscription?.group_name)
            agent.user_group_names.push(subscription.group_name);
          if (currentInternalGroupOptions[value]) {
            agent.internal_members.push(currentInternalGroupOptions[value]);
          }
        });
        return agent;
      });

      setTableData(formattedAgents);
      setInitialized(true);
    } finally {
      setTableLoading(false);
    }

    loadAllTotal();
  };

  // Refresh - 只更新状态，数据加载由 useEffect 监听
  const refresh = useCallback(() => {
    updateState({ page: 1, group_id: 0 });
  }, [updateState]);

  const handleGroupChange = (result: { value: Group[] }) => {
    setGroupList(result.value);

    // 只在初始化完成后，分组变化才重置筛选
    // 初始化加载（从空到有数据）不重置，避免浏览器返回时重置页码
    if (groupInitializedRef.current) {
      updateState({ group_id: 0, page: 1 });
    } else {
      // 标记初始化完成
      groupInitializedRef.current = true
    }
  };

  const onRowClick = (row: AgentState) => {
    onAgentAdd(row.agent_type, row);
  };

  const onAgentDelete = async (row: AgentState) => {
    Modal.confirm({
      title: t("action_delete"),
      content: t("agent_delete_confirm"),
      okText: t("action_confirm"),
      cancelText: t("action_cancel"),
      onOk: async () => {
        await agentApi.delete({ data: { agent_id: row.agent_id } });
        message.success(t("action_delete_success"));
        loadListData();
      },
    });
  };

  const loadProviderList = async () => {
    if (providerLoadedRef.current) return;
    providerLoadedRef.current = true;
    const list = (await providerApi.list()) as ProviderItem[];

    const providers = getProvidersByAuth(true).map((item) => {
      const provider_type = item.id;
      return {
        ...item,
        provider_type,
        is_auth: !!list.find((row) => row.provider_type === provider_type),
      };
    });
    setAuthProviders(providers);
  };

  const checkAuth = (value: AgentType): boolean => {
    const provider = getProviderByAgentId(value);
    const auth_provider = authProvidersRef.current.find(
      (row) => row.provider_type === provider?.id,
    );

    if (auth_provider && !auth_provider?.is_auth) {
      Modal.confirm({
        title: t("tip"),
        content: t("auth_required", {
          provider_name: t(provider?.label || ""),
        }),
        okText: t("action_go"),
        cancelText: t("action_cancel"),
        onOk: () => {
          navigate("/platform");
        },
      });
      return false;
    }

    return true;
  };

  // 处理创建弹窗确认
  const handleCreateConfirm = async (data: CreateAgentDialogResult) => {
    if (!checkAuth(data.agentType as AgentType)) return;

    // OpenClaw 兼容族：在弹框确定时调用 API 创建
    if (isOpenClawCompatibleAgentType(data.agentType)) {
      try {
        const metadata = getOpenClawCompatibleAgentMetadata(data.agentType)
        // 获取或创建 channel
        const channelList = await channelApi.listv2();
        const existingChannel = channelList.find((item: any) => item.type === metadata.channelType);
        let channelId = existingChannel?.channel_id;

        if (!channelId) {
          const res = await channelApi.create({
            type: metadata.channelType,
            name: t('agent.personal_agent_channel'),
            models: 'openclaw-ws',
          });
          channelId = res?.data?.channel_id || res?.data?.id || res?.channel_id;
        }

        const { subscriptionGroupIds, internalGroupIds } = await getDefaultGroupIds();

        // 创建智能体
        const result = await agentApi.save({
          data: buildOpenClawEnterpriseAgentPayload({
            data,
            channelId,
            subscriptionGroupIds,
            internalGroupIds,
          })
        })

        navigate({
          pathname: '/agent/create-v2',
          search: `?type=${metadata.agentType}&agent_id=${result.agent_id}&is_new=false`,
        } as any)
      } catch (error) {
        console.error('创建 OpenClaw 兼容智能体失败:', error)
      }
      return
    }
    // 其他类型：通过 URL 参数传递弹框数据，由编辑页初始化
    const params = new URLSearchParams({
      type: data.agentType,
      is_new: 'true',
    })
    if (data.name) params.set('name', data.name)
    if (data.description) params.set('description', data.description)
    if (data.logo) params.set('logo', data.logo)
    if (data.groupId) params.set('group_id', String(data.groupId))
    if (data.agent_mode) params.set('agent_mode', data.agent_mode)
    if (data.backend_agent_type) params.set('backend_agent_type', String(data.backend_agent_type))

    navigate({
      pathname: "/agent/create-v2",
      search: `?${params.toString()}`,
    } as any);
    setAddVisible(false);
  };

  const onAgentAdd = async (
    value: string,
    data: Partial<AgentState> = {},
    is_new = false,
  ) => {
    if (!checkAuth(value as AgentType)) return;

    const searchParams = data.agent_id
      ? `?type=${data.agent_type}&agent_id=${data.agent_id}&is_new=${is_new}`
      : `?type=${value}&is_new=${is_new}`;

    navigate({
      pathname: "/agent/create-v2",
      search: searchParams,
    } as any);
  };

  const onAgentStatusChange = async (row: AgentState) => {
    await agentApi.updateStatus({
      data: { agent_id: row.agent_id, enable: row.enable },
    });
    message.success(
      t(row.enable ? "action_enable_success" : "action_disable_success"),
    );
  };

  useEffect(() => {
    const init = async () => {
      await loadInternalGroupList();
      initializedRef.current = true;
      loadListData();
    };
    init();
    loadProviderList();
    eventBus.on("user-login-success", refresh);
    eventBus.on("agent-create", refresh);
    eventBus.on("agent-update", loadListData);

    return () => {
      eventBus.off("user-login-success", refresh);
      eventBus.off("agent-create", refresh);
      eventBus.off("agent-update", loadListData);
    };
  }, []);

  // 监听 filterForm 变化，自动加载数据
  const filterKey = JSON.stringify(filterForm);
  useEffect(() => {
    if (!initializedRef.current) return;
    loadListData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const columns = [
    {
      title: t("module.agent"),
      dataIndex: "name",
      key: "name",
      width: 180,
      render: (_: any, row: AgentState) => (
        <div className="flex items-center gap-2 w-full">
          <SafeImage
            className="flex-none w-8 h-8 rounded-full overflow-hidden"
            src={row.logo || ""}
            alt=""
          />
          <div className="flex-1 w-0 text-sm flex flex-col">
            <div className="text-primary truncate">{row.name || "--"}</div>
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
      title: t("type"),
      dataIndex: "backend_agent_type",
      key: "backend_agent_type",
      width: 140,
      render: (backend_agent_type: number) => {
        if (backend_agent_type === BACKEND_AGENT_TYPE.AGENT) return t("agent_type_chat_v2")
        if (backend_agent_type === BACKEND_AGENT_TYPE.WORKFLOW) return t("agent_type_completion_v2")
        if (backend_agent_type === BACKEND_AGENT_TYPE.ASSISTANT) return t("agent_type.assistant")
        return "--"
      },
    },
    {
      title: t("module.platform_v2"),
      dataIndex: "agent_type",
      key: "agent_type",
      width: 140,
      render: (_: any, row: AgentState) =>
        t(`agent_app.${row.agent_type}`) || "--",
    },
    {
      title: t("common.group"),
      dataIndex: "group_name",
      key: "group_name",
      width: 140,
      ellipsis: true,
      render: (name: string) => (
        <span className={!name ? "text-placeholder" : ""}>{name || "--"}</span>
      ),
    },
    {
      title: t("usage_range"),
      key: "scopes",
      width: 180,
      ellipsis: true,
      render: (_: any, row: AgentState) => (
        <ScopeDisplay
          scopes={row.scopes}
          treeData={scopeDict?.treeData}
          users={scopeDict?.users}
          groups={scopeDict?.groups}
        />
      ),
    },
    {
      title: t("action_enable"),
      dataIndex: "enable",
      key: "enable",
      width: 100,
      render: (_: any, row: AgentState) => {
        // 内置智能体显示"内置"标签
        if (row.is_system) {
          return (
            <span className="px-2 py-1 bg-[#F0F2F5] text-secondary text-xs rounded">
              {t('agent.builtin')}
            </span>
          );
        }
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={row.enable}
              onChange={(checked) => {
                row.enable = checked;
                setTableData([...tableData]);
                onAgentStatusChange(row);
              }}
            />
          </div>
        );
      },
    },
    {
      title: t("operation"),
      key: "operation",
      width: 100,
      align: "right",
      fixed: "end",
      render: (_: any, row: AgentState) => (
        <>
          <IconAction
            variant="row"
            title={t("action.edit")}
            onClick={() => onAgentAdd(row.agent_type, row)}
          >
            <SvgIcon name="edit" />
          </IconAction>
          <IconAction
            variant="row"
            title={row.is_system ? t("agent.builtin_no_delete") : ""}
            danger
            disabled={row.is_system}
            onClick={() => onAgentDelete(row)}
          >
            <SvgIcon name="delete" />
          </IconAction>
        </>
      ),
    },
  ];

  const channelOptions = useMemo(
    () =>
      createAgentPlatformFilterOptions(Object.values(channels), platformsByType, [
        { label: t("agent_app.knowledge"), value: AGENT_USAGE_PLATFORM_VALUES.KM_AI_SEARCH },
        { label: t("agent_app.workbench"), value: AGENT_USAGE_PLATFORM_VALUES.WORK_AI },
      ]),
    [platformsByType],
  );

  // 分组选项
  const groupOptions = useMemo(() =>
    groupList.map((item) => ({
      label: item.group_name,
      value: item.group_id,
    })),
    [groupList]
  );

  // 弹窗打开时默认选中第一个分组
  useEffect(() => {
    if (addVisible && groupOptions.length > 0 && !selectedGroupId) {
      setSelectedGroupId(groupOptions[0].value);
    }
  }, [addVisible, groupOptions, selectedGroupId]);

  const filterBar = (
    <>
      <div className="flex flex-1 w-0 gap-2">
        <div className="flex-none w-[150px]">
          <GroupTabs
            ref={groupTabsRef}
            type="dropdown"
            single
            groupType={GROUP_TYPE.AGENT}
            value={filterForm.group_id}
            onChange={(id) => {
              updateState({ group_id: Number(id) || 0 });
            }}
            onOptionsChange={() => loadListData()}
          />
        </div>

        <Select
          value={filterForm.type || undefined}
          className="flex-none w-[160px]"
          allowClear
          placeholder={t("all")}
          onChange={(value) => updateState({ type: value || "" })}
          prefix={<span className="text-primary mr-2">{t("type")}:</span>}
        >
          {filterForm.type && (
            <Select.Option value="">{t("all_type")}</Select.Option>
          )}
          <Select.Option value="1">
            {t("agent_type_completion_v2")}
          </Select.Option>
          <Select.Option value="0">{t("agent_type_chat_v2")}</Select.Option>
          <Select.Option value="2">{t("agent_type.assistant")}</Select.Option>
        </Select>
        <Select
          value={filterForm.platform || undefined}
          className="flex-none w-[160px]"
          allowClear
          placeholder={t("all")}
          onChange={(value) => updateState({ platform: value || "" })}
          prefix={
            <span className="text-primary mr-2">
              {t("module.platform_v2")}:
            </span>
          }
        >
          {filterForm.platform && (
            <Select.Option value="">
              {t("module.all_platform")}
            </Select.Option>
          )}
          {channelOptions.map((item) => (
            <Select.Option
              key={item.value}
              value={item.value}
            >
              {item.label}
            </Select.Option>
          ))}
        </Select>
        <div>
          <Search
            mode="expanded"
            value={filterForm.keyword}
            debounceMs={300}
            onDebouncedChange={(val) => updateState({ keyword: val })}
            placeholder={t("agent.name_v2")}
          />
        </div>
      </div>
      <div className="flex-none flex items-center gap-3 ml-8">
        <Button
          type="primary"
          onClick={() => {
            if (guardAgentVersion()) {
              setAddVisible(true);
            }
          }}
        >
          {t("action.add")}
        </Button>
      </div>
    </>
  );

  return (
    <PageLayoutContent header={t("module.agent")} filterBar={filterBar}>
      <Table
        rowKey="agent_id"
        columns={columns}
        dataSource={tableData}
        loading={tableLoading}
        pagination={{
          current: filterForm.page,
          pageSize: filterForm.page_size,
          total: tableTotal,
          showSizeChanger: true,
          showTotal: (total) => t("table_footer_text", { total }),
          onChange: (page, pageSize) => {
            updateState({ page, page_size: pageSize });
          },
        }}
        onRow={(record) => ({
          onClick: () => onRowClick(record),
          className: "group cursor-pointer",
        })}
        rowClassName="group cursor-pointer"
      />

      {/* 创建智能体弹窗 */}
      <CreateAgentDialog
        visible={addVisible}
        onClose={() => {
          setAddVisible(false);
          setSelectedGroupId(undefined);
        }}
        onConfirm={handleCreateConfirm}
        types={AGENT_TYPE_OPTIONS}
        platformsByType={platformsByType}
        groupValue={selectedGroupId}
        onGroupChange={setSelectedGroupId}
        groupOptions={groupOptions}
        t={t}
        avatarSlot={ImageUploadComponent ? ({ value, onChange }) => (
          <div className="flex flex-col items-center gap-2">
            <ImageUploadComponent
              ref={uploadImageRef}
              value={value}
              onChange={onChange}
              className="!w-[72px] !h-[72px]"
            />
            <Button
              className="w-[72px] text-xs"
              onClick={() => uploadImageRef.current?.trigger()}
            >
              {t("change_avatar")}
            </Button>
          </div>
        ) : undefined}
      />

      <GroupDialog
        ref={dialogRef}
        groupType={GROUP_TYPE.AGENT}
        options={groupList}
        onChange={handleGroupChange}
      />
    </PageLayoutContent>
  );
}

export default AgentPage;
