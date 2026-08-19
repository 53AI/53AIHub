import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Empty, Spin, message, Button } from "antd";
import { useEnterpriseStore, useIsSoftStyle } from "@/stores/modules/enterprise";
import { useAgentStore } from "@/stores/modules/agent";
import { UsageGuide, ChatConfigProvider } from "@km/shared-business/chat";
import { chatAdapters } from "@/adapters/chat-adapters";
import { createPlatformsByType } from '@km/shared-business/agent-create';
import { SvgIcon } from '@km/shared-components-react';
import Header, { BreadcrumbItem } from "@/components/Layout/Header";
import Breadcrumb, { MODULE_CONFIGS } from "@/components/Breadcrumb";
import AuthTagGroup from "@/components/AuthTagGroup";
import agentsApi from "@/api/modules/agents";
import { checkPermission } from "@/utils/permission";
import { t } from "@/locales";
import type { Agent } from "@/types/agent";

const DEFAULT_IMG = "/images/default_agent.png";

interface UseCase {
  type: "case" | "scene" | "channel";
  input_text?: string;
  output_text?: string;
  image?: string;
  scene?: string;
  desc?: string;
  name?: string;
}

export function AgentDetailView() {
  const { agent_id } = useParams<{ agent_id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isSoftStyle = useIsSoftStyle();
  const locale = useEnterpriseStore((state) => state.language);

  const platforms = createPlatformsByType('')

  // 新增：获取 agentStore
  const agentStore = useAgentStore();

  // 通过 URL 参数区分智能体类型：type=my 表示"我的智能体"，否则为公司智能体
  const agentType = searchParams.get("type");
  // 从 URL 读取来源分组ID（用户从哪个分类进入）
  const urlGroupId = searchParams.get("group_id");

  const [loading, setLoading] = useState(true);
  const [detailData, setDetailData] = useState<Agent.State | null>(null);
  const [adding, setAdding] = useState(false);

  // 快捷方式相关状态
  const { isShortcutAdded, loadShortcutIds, addShortcut } = useAgentStore();
  const isAdded = agent_id ? isShortcutAdded(agent_id) : false;

  // 新增：构建面包屑数据
  const breadcrumbItems = useMemo<BreadcrumbItem[]>(() => {
    if (!detailData) return [];

    const items: BreadcrumbItem[] = [
      { label: t("module.index"), path: "/index" },
      {
        label: t("module.agent"),
        // 根据来源页面传递正确的参数，确保返回时保持原有 tab 状态
        path: agentType === "my" ? "/agent?from=my" : "/agent"
      }
    ];

    // 仅在"探索"模式下添加分组面包屑（我的智能体不支持分组过滤）
    if (agentType !== "my") {
      // 优先使用 URL 中的 group_id（用户从哪个分类进入），否则使用数据本身的分组
      const targetGroupId = urlGroupId ? Number(urlGroupId) : '';
      const group = agentStore.categorys.find(
        (c) => c.group_id === targetGroupId
      );
      if (group && group.group_id > 0) {
        items.push({
          label: group.group_name,
          path: `/agent?group_id=${group.group_id}`
        });
      }
    }

    return items;
  }, [detailData?.group_id, agentStore.categorys, agentType, urlGroupId]);

  useEffect(() => {
    if (agent_id) {
      fetchAgentDetail();
    }
  }, [agent_id, agentType]);

  // 软件模式下加载已添加的快捷方式 ID 列表
  useEffect(() => {
    if (isSoftStyle) {
      loadShortcutIds()
    }
    agentStore.loadCategorys()
  }, [isSoftStyle, loadShortcutIds])

  const fetchAgentDetail = async () => {
    if (!agent_id) return;
    setLoading(true);
    try {
      // 根据 type 参数选择不同的 API
      if (agentType === "my") {
        // 我的智能体：直接获取详情
        const response = await agentsApi.my.detail(agent_id);
        setDetailData(response.data as Agent.State);
      } else {
        // 公司智能体：从列表中查找

        const agents = await agentStore.loadAgentList()
        const agent = agents.find(
          (a: any) => a.agent_id === agent_id || String(a.agent_id) === agent_id
        );
        setDetailData(agent as unknown as Agent.State);
      }
    } catch (error) {
      console.error("Failed to fetch agent detail:", error);
      message.error(t("agent.fetch_failed"));
    } finally {
      setLoading(false);
    }
  };

  // 获取分组名称
  const groupName = useMemo(() => {
    const group = agentStore.categorys.find(c => c.group_id === detailData?.group_id)
    return group?.group_name || ''
  }, [detailData?.group_id, agentStore.categorys])

  const getTypeInfo = useMemo(() => {
    const custom_config_obj = JSON.parse(detailData?.custom_config || '{}') || {}
    const agentMode = custom_config_obj.agent_mode
    const agentType = custom_config_obj.agent_type

    const platform = platforms.find(item => item.value === agentType)

    return {
      icon: agentMode === 'chat' ? 'chat_v2' : agentMode === 'assistant' ? 'agent' : 'app-one',
      label: platform ? platform.label : agentType
    }
  }, [detailData?.custom_config])

  const handleUseAgent = () => {
    if (agent_id) {
      navigate({ pathname: "/chat", search: `?agent_id=${agent_id}` });
    }
  };

  // 添加快捷方式
  const handleAddShortcut = () => {
    if (!agent_id || !detailData) return
    checkPermission({
      onClick: async () => {
        try {
          setAdding(true)
          await addShortcut(agent_id)
          message.success(t('action.add_success'))
        } catch (error) {
          message.error(t('action.operation_failed'))
        } finally {
          setAdding(false)
        }
      }
    })
  }

  // 软件模式下跳转到工作台智能体页
  const handleUseAgentSoft = () => {
    if (agent_id) {
      navigate(`/agent/agent?agent_id=${agent_id}`)
    }
  }

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.target as HTMLImageElement;
    if (target.src.endsWith(DEFAULT_IMG)) return;
    target.src = DEFAULT_IMG;
  };

  // 解析 use_cases 数据
  const useCasesData = useMemo((): UseCase[] => {
    if (!detailData?.use_cases) return [];
    try {
      const parsed = JSON.parse(detailData.use_cases);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [detailData]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  if (!detailData) {
    return (
      <div className="h-full flex items-center justify-center">
        <Empty description={t("agent.not_found") || "智能体不存在"} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {isSoftStyle && (
        <Header
          border={false}
          breadcrumb={breadcrumbItems}
        />
      )}
      <div className="flex-1 py-6 overflow-y-auto">
        <div className={`w-11/12 lg:w-4/5 max-w-[1200px] mx-auto`}>
          {!isSoftStyle && (
            <Breadcrumb
              module={MODULE_CONFIGS.agent}
              name={detailData.name}
            />
          )}

          <div className="flex items-center gap-3">
            <img
              className="size-14 md:size-12 rounded-lg object-cover flex-none"
              src={detailData.logo || DEFAULT_IMG}
              alt={detailData.name}
              onError={handleImageError}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl md:text-xl font-semibold text-primary truncate">
                  {detailData.name}
                </h1>
                <div className="bg-[#F4F4F7] flex h-[22px] items-center px-2 gap-1 rounded-md whitespace-nowrap text-[#6B7280]">
                  <SvgIcon name={getTypeInfo.icon} size={14} />
                  <p className="text-xs">{getTypeInfo.label}</p>
                </div>
              </div>

              {groupName && (
                <span className="h-5 inline-flex items-center px-2 text-xs text-theme bg-[#EBF1FF] rounded-sm">
                  {groupName}
                </span>
              )}
            </div>
            {!isSoftStyle && (<Button type="primary" onClick={handleUseAgent}>{t('action.use')}</Button>)}
          </div>
          <p className="text-base text-placeholder mt-5 text-wrap break-words whitespace-pre-wrap">
            {detailData.description || ""}
          </p>
          {!isSoftStyle && detailData.user_group_ids && detailData.user_group_ids.length > 0 && (
            <div className="mt-5">
              <AuthTagGroup value={detailData.user_group_ids} scopes={detailData.scopes} />
            </div>
          )}

          <div className="h-6"></div>
          <ChatConfigProvider lang={locale} adapters={chatAdapters}>
            <UsageGuide
              useCases={useCasesData}
              defaultImage={DEFAULT_IMG}
              plain
            />
          </ChatConfigProvider>

          {/* 软件模式下底部悬浮栏 */}
          {isSoftStyle && (
            <>
              <div className="h-28"></div>
              <div className="fixed shadow-[0_4px_20px_rgba(0,0,0,0.08)] bottom-7 left-[calc(50%+27px)] -translate-x-1/2 h-[70px] w-11/12 lg:w-4/5 max-w-[1200px] px-5 bg-white rounded-xl flex items-center justify-between">
                <div className="flex-1 overflow-hidden">
                  {detailData.user_group_ids && detailData.user_group_ids.length > 0 && (
                    <AuthTagGroup value={detailData.user_group_ids} scopes={detailData.scopes} mode="compact" />
                  )}
                </div>
                {isAdded ? (
                  <Button type="primary" onClick={handleUseAgentSoft}>{t('action.use')}</Button>
                ) : (
                  <Button type="primary" loading={adding} onClick={handleAddShortcut}>{t('action.add_to_workbench')}</Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AgentDetailView;
