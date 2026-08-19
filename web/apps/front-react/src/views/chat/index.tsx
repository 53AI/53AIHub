/**
 * ChatView - 使用 shared-business 组件
 *
 * 功能：
 * - 路由参数解析（agent_id, conversation_id, from, type）
 * - 智能体加载（探索列表 + 我的列表）
 * - 面包屑导航
 * - 分享按钮
 * - 使用指引按钮
 *
 * 核心组件：
 * - ChatContainer（来自 shared-business）
 */
import {
  useEffect,
  useRef,
  useMemo,
  forwardRef,
  useImperativeHandle,
  useState,
} from "react";
import { useSearchParams, Outlet, useLocation } from "react-router-dom";
import { Button } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { useAgentStore, useCurrentAgent } from "@/stores/modules/agent";
import { useConversationStore } from "@/stores/modules/conversation";
import {
  useIsSoftStyle,
} from "@/stores/modules/enterprise";
import { useUserStore } from "@/stores/modules/user";
import agentsApi from "@/api/modules/agents";
import { parseAgentParsedFields } from "@/api/modules/agents/transform";
import { eventBus } from "@km/shared-utils";
import { EVENT_NAMES } from "@/constants/events";
import { t } from "@/locales";
import Breadcrumb, { MODULE_CONFIGS } from "@/components/Breadcrumb";
import ChatContainer, { ChatContainerRef } from "./ChatContainer";
import { isOpenClawCompatibleChannelType } from "@km/shared-business/agent-create";

export interface ChatViewRef {
  showUseCase: () => void;
  hideUseCase: () => void;
  showShare: () => void;
}

const ChatView = forwardRef<ChatViewRef, {}>((props, ref) => {
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const chatRef = useRef<ChatContainerRef>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [hideBottomActions, setHideBottomActions] = useState(true);

  const agentStore = useAgentStore();
  const convStore = useConversationStore();
  const userStore = useUserStore();

  const currentAgent = useCurrentAgent();

  const isSoftStyle = useIsSoftStyle();
  const isWebsite = !isSoftStyle;

  // 工作台入口路径判断
  const isIndexRoute = isSoftStyle

  // 当前智能体 ID（支持 string 类型如 "U5KLWZ"）
  const agentId = useMemo(() => {
    return searchParams.get("agent_id") || "";
  }, [searchParams]);

  // 当前会话 ID
  const conversationId = useMemo(() => {
    return searchParams.get("conversation_id") || undefined;
  }, [searchParams]);

  const detailData = useMemo(() => {
    return currentAgent || { name: "" };
  }, [currentAgent]);

  const isCompletion = useMemo(() => {
    return currentAgent?.custom_config_obj?.agent_mode === "completion";
  }, [currentAgent]);

  // 监听路由参数变化 - 加载智能体和会话
  useEffect(() => {
    const loadRouteData = async () => {
      const agent_id = searchParams.get("agent_id") || "";
      const conversation_id = searchParams.get("conversation_id") || "";
      const from = searchParams.get("from") || "";

      // 没有 agent_id 时直接返回，避免把 current_agentid fallback 到 exploreList[0]
      // （之前在 StrictMode + 路由跳转 race 下会被重复 run 覆盖成 completion agent）
      // 当前 current_agentid 保留前置状态，等待 IndexSidebar 写入默认 agent_id
      if (!agent_id) {
        return;
      }

      let agent: Agent.State | undefined;
      let isMyAgent = false;

      if (from === "my" && agent_id) {
        try {
          const res = await agentsApi.my.detail(agent_id);
          if (res?.data) {
            agent = parseAgentParsedFields(res.data) as Agent.State;
            useAgentStore.setState((state) => ({
              myAgentList: [
                agent!,
                ...state.myAgentList.filter(
                  (item) => String(item.agent_id) !== String(agent!.agent_id)
                ),
              ],
            }));
            isMyAgent = true;
          }
        } catch (err) {
          console.error("获取我的智能体详情失败:", err);
        }
      } else {
        // 获取探索列表
        const exploreList = await agentStore.loadAgentList();
        // 未登录时跳过我的智能体列表加载
        let myList: Agent.State[] = [];
        if (userStore.is_login) {
          try {
            myList = await agentStore.loadMyAgentList();
          } catch (err) {
            console.error("获取我的智能体列表失败:", err);
          }
        }

        // 先在我的列表查找，再在探索列表查找；找不到就保持 agent 为 undefined，
        // 不再 fallback 到 exploreList[0] 以避免在 race 中覆盖 current_agentid
        agent = myList.find((item) => String(item.agent_id) === String(agent_id));
        if (agent) {
          isMyAgent = true;
        } else {
          agent = exploreList.find((item) => String(item.agent_id) === String(agent_id));
        }
      }

      // 检查智能体是否为 Openclaw 渠道类型
      const isOpenclaw = isOpenClawCompatibleChannelType(agent?.channel_type);
      const isOpenclawRoute = searchParams.get("type") === "openclaw";

      // 更新 store - Openclaw 智能体和"我的智能体"一样隐藏底部操作
      if (isMyAgent || isOpenclaw) {
        setHideBottomActions(true);
      } else {
        setHideBottomActions(false);
      }

      // 设置 front-react 的 conversation store，让 useCurrentAgent 能找到 agent
      const actualAgentId = agent?.agent_id || agent_id;
      // isReplace=false 阻止 setRouter 触发页面跳转，避免 /agent/agent 路径下的无限刷新循环
      convStore.setCurrentState(actualAgentId, conversation_id, false);
      // 加载会话列表以获取会话标题
      if (actualAgentId && !isOpenclaw && !isOpenclawRoute) {
        convStore.loadConversations(actualAgentId);
      }
    };

    convStore.setBasePath(location.pathname);
    loadRouteData();
  }, [searchParams]);

  // 监听 boxHeight 变化
  useEffect(() => {
    if (agentStore.boxHeight && boxRef.current) {
      boxRef.current.scrollTop = agentStore.boxHeight;
    }
  }, [agentStore.boxHeight]);

  const showUseCase = () => {
    chatRef.current?.showUseCase();
  };

  const hideUseCase = () => {
    chatRef.current?.hideUseCase();
  };

  const showShare = () => {
    chatRef.current?.showShare();
  };

  useImperativeHandle(
    ref,
    () => ({
      showUseCase,
      hideUseCase,
      showShare,
    }),
    [],
  );

  useEffect(() => {
    agentStore.loadCategorys();

    const handleLoginSuccess = () => {
      const params = new URLSearchParams(window.location.search || "");
      const routeAgentId = params.get("agent_id") || convStore.current_agentid;
      const routeAgent = routeAgentId ? useAgentStore.getState().findAgentByAgentId(String(routeAgentId)) : undefined;
      if (params.get("type") === "openclaw" || isOpenClawCompatibleChannelType(routeAgent?.channel_type)) {
        return;
      }
      convStore.loadConversations();
    };

    eventBus.on(EVENT_NAMES.LOGIN_SUCCESS, handleLoginSuccess);

    return () => {
      convStore.clearCurrentState();
      eventBus.off(EVENT_NAMES.LOGIN_SUCCESS, handleLoginSuccess);
    };
  }, []);

  return (
    <>
      <section
        className={`h-full flex flex-col ${isWebsite ? "overflow-hidden pt-6" : ""}`}
      >
      {isWebsite && (
        <div className="relative flex-none w-11/12 lg:w-4/5 max-w-[1200px] mx-auto">
          <Breadcrumb
            module={MODULE_CONFIGS.agent}
            name={detailData.name}
            extra={
              <div className="flex items-center gap-2">
                {/* <div
                  className={`size-7 cursor-pointer rounded flex items-center justify-center ${showUserMemory ? 'bg-[#F5F5F7]' : 'hover:bg-[#F5F5F7]'}`}
                  onClick={() => setShowUserMemory(true)}
                >
                  <SvgIcon name="brain" />
                </div> */}
                {!isCompletion && (
                  <Button className="px-0" type="text" onClick={showShare}>
                    <SvgIcon name="share-two" size={18} color="#4F5052" />
                    {t("action.share")}
                  </Button>
                )}
                <Button className="px-0" type="text" onClick={showUseCase}>
                  <SvgIcon name="layout-split" size={18} />
                  {t("chat.usage_guide")}
                </Button>
              </div>
            }
          />
        </div>
      )}
      <div
        ref={boxRef}
        className={
          isWebsite ? "flex-1 px-4 overflow-y-auto" : "flex-1 overflow-y-auto"
        }
      >
        <div
          className={
            isWebsite ? "w-11/12 lg:w-4/5 max-w-[1200px] mx-auto flex-1 h-full" : "h-full"
          }
        >
          <ChatContainer
            ref={chatRef}
            agentId={agentId}
            conversationId={conversationId}
            hideBottomActions={hideBottomActions}
            useCaseFixed={isWebsite}
            showRecommend={false}
            hideMenuHeader={isWebsite}
            isIndexRoute={isIndexRoute}
            className="flex-1"
          />
        </div>
      </div>
    </section>
    </>
  );
});

ChatView.displayName = "ChatView";

export default ChatView;

export function ChatLayout() {
  return <Outlet />;
}
