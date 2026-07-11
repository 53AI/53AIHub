import {
  useEffect,
  useRef,
  useMemo,
  forwardRef,
  useImperativeHandle,
  useState,
} from "react";
import { useSearchParams, useNavigate, Outlet } from "react-router-dom";
import { Breadcrumb, Button } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import { useAgentStore, useCurrentAgent } from "@/stores/modules/agent";
import {
  useConversationStore,
  useCurrentConversation,
} from "@/stores/modules/conversation";
import {
  useEnterpriseStore,
  useIsSoftStyle,
} from "@/stores/modules/enterprise";
import { useNavigationStore } from "@/stores/modules/navigation";
import { useUserStore } from "@/stores/modules/user";
import agentsApi from "@/api/modules/agents";
import conversationApi, { ConversationType } from "@/api/modules/conversation";
import { eventBus } from "@km/shared-utils";
import { EVENT_NAMES } from "@/constants/events";
import { t } from "@/locales";
import ChatIndex, { ChatIndexRef } from "./chat";
import Completion, { CompletionRef } from "./completion";
import { isOpenClawCompatibleChannelType } from "@km/shared-business/agent-create";
import "./index.css";

export interface ChatViewRef {
  showUseCase: () => void;
  hideUseCase: () => void;
  showShare: () => void;
}

const ChatView = forwardRef<ChatViewRef, {}>((props, ref) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const chatRef = useRef<ChatIndexRef>(null);
  const completionRef = useRef<CompletionRef>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [hideBottomActions, setHideBottomActions] = useState(true);

  const agentStore = useAgentStore();
  const convStore = useConversationStore();
  const enterpriseStore = useEnterpriseStore();
  const navigationStore = useNavigationStore();
  const userStore = useUserStore();

  const currentAgent = useCurrentAgent();
  const currentConv = useCurrentConversation();

  const isSoftStyle = useIsSoftStyle();
  const isWebsite = !isSoftStyle;

  const detailData = useMemo(() => {
    return currentAgent || { name: "" };
  }, [currentAgent]);

  const isCompletion = useMemo(() => {
    return currentAgent?.custom_config_obj?.agent_mode === "completion";
  }, [currentAgent]);

  // 监听路由参数变化
  useEffect(() => {
    const loadRouteData = async () => {
      const agent_id = searchParams.get("agent_id") || "";
      const conversation_id = searchParams.get("conversation_id") || "";
      const from = searchParams.get("from") || "";

      let agent: Agent.State | undefined;
      let isMyAgent = false;


      if (from === "my" && agent_id) {
        try {
          const res = await agentsApi.my.detail(agent_id);
          if (res?.data) {
            agent = {
              ...res.data,
              custom_config_obj: res.data.custom_config
                ? JSON.parse(res.data.custom_config)
                : {},
              settings_obj: res.data.settings
                ? JSON.parse(res.data.settings)
                : {},
            } as Agent.State;
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

        // 先在我的列表查找，再在探索列表查找
        agent = myList.find((item) => item.agent_id === agent_id);
        if (agent) {
          isMyAgent = true;
        } else {
          agent = exploreList.find((item) => item.agent_id === agent_id);
          if (!agent) {
            agent = exploreList?.[0];
          }
        }
      }

      // 检查智能体是否为 Openclaw 渠道类型
      const isOpenclaw = isOpenClawCompatibleChannelType(agent?.channel_type)

      // 更新 store - Openclaw 智能体和"我的智能体"一样隐藏底部操作
      if (isMyAgent || isOpenclaw) {
        setHideBottomActions(true);
      } else {
        setHideBottomActions(false);
      }
      // 处理会话
      const actualAgentId = agent?.agent_id || agent_id;
      if (!conversation_id) {
        // Openclaw 智能体和"我的智能体"使用相同的会话处理逻辑
        if (isMyAgent || isOpenclaw) {
          // 我的智能体/Openclaw：获取正式会话列表
          try {
            const res = await conversationApi.list({
              agent_id: actualAgentId,
              conversation_type: ConversationType.FORMAL,
            });
            const convs = res?.data?.conversations || [];
            const firstConv = convs[0];
            if (firstConv) {
              convStore.addConversation(firstConv);
              convStore.setCurrentState(
                actualAgentId,
                firstConv.conversation_id,
                false,
              );
            } else {
              convStore.setCurrentState(actualAgentId, 0, false);
            }
          } catch (err) {
            console.error("获取我的智能体/Openclaw会话列表失败:", err);
            convStore.setCurrentState(actualAgentId, 0);
          }
        } else {
          // 探索智能体：使用 loadConversations
          convStore.setCurrentState(actualAgentId, 0);
          await convStore.loadConversations(actualAgentId);
        }
      } else {
        try {
          const convList = await convStore.loadConversations(actualAgentId);
          const conversation = convList.find(
            (item) => String(item.conversation_id) === conversation_id,
          );
          if (conversation) {
            convStore.setCurrentState(
              conversation.agent_id,
              conversation.conversation_id,
            );
          } else {
            convStore.setCurrentState(actualAgentId, "");
          }
        } catch (error) {
          convStore.setCurrentState(actualAgentId, "");
        }
        // 如果找不到会话，不设置状态（与 Vue 版本一致）
      }
    };

    loadRouteData();
  }, [searchParams]);

  // 监听 boxHeight 变化
  useEffect(() => {
    if (agentStore.boxHeight && boxRef.current) {
      boxRef.current.scrollTop = agentStore.boxHeight;
    }
  }, [agentStore.boxHeight]);

  const showUseCase = () => {
    if (isCompletion) {
      completionRef.current?.showUseCase();
    } else {
      chatRef.current?.showUseCase();
    }
  };

  const hideUseCase = () => {
    if (isCompletion) {
      completionRef.current?.hideUseCase();
    } else {
      chatRef.current?.hideUseCase();
    }
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
    [isCompletion],
  );

  useEffect(() => {
    agentStore.loadCategorys();

    const handleLoginSuccess = () => {
      convStore.loadConversations();
    };

    eventBus.on(EVENT_NAMES.LOGIN_SUCCESS, handleLoginSuccess);

    return () => {
      convStore.clearCurrentState();
      eventBus.off(EVENT_NAMES.LOGIN_SUCCESS, handleLoginSuccess);
    };
  }, []);

  return (
    <section
      className={`h-full flex flex-col ${isWebsite ? "overflow-hidden pt-6" : ""}`}
    >
      {isWebsite && (
        <div className="relative flex-none flex items-center gap-4 px-4 w-11/12 mx-auto lg:w-4/5 mb-5">
          <Breadcrumb
            separator={<ArrowRightOutlined />}
            className="flex-1 w-0"
            items={[
              ...(navigationStore.homeNavigation?.menu_path
                ? [
                    {
                      title: (
                        <span
                          className="text-regular leading-6 font-normal hover-text-theme cursor-pointer"
                          onClick={() =>
                            navigate(navigationStore.homeNavigation.menu_path)
                          }
                        >
                          {t("module.index")}
                        </span>
                      ),
                    },
                  ]
                : []),
              ...(navigationStore.agentNavigation?.menu_path
                ? [
                    {
                      title: (
                        <span
                          className="text-regular leading-6 font-normal hover-text-theme cursor-pointer"
                          onClick={() =>
                            navigate(navigationStore.agentNavigation.menu_path)
                          }
                        >
                          {t("module.agent")}
                        </span>
                      ),
                    },
                  ]
                : []),
              {
                title: (
                  <span
                    className="text-primary leading-6 inline-block truncate max-w-[10em] md:max-w-[30rem]"
                    title={detailData.name}
                  >
                    {detailData.name}
                  </span>
                ),
              },
            ]}
          />
          {!isCompletion && (
            <Button type="link" onClick={showShare}>
              <SvgIcon name="share-two" size={18} color="#4F5052" stroke />
              {t("action.share")}
            </Button>
          )}
          <Button type="link" onClick={showUseCase}>
            <SvgIcon name="layout-split" size={18} />
            {t("chat.usage_guide")}
          </Button>
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
            isWebsite ? "w-11/12 lg:w-4/5 mx-auto max-w-[1200px] flex-1 h-full" : "h-full"
          }
        >
          {isCompletion ? (
            <Completion
              ref={completionRef}
              useCaseFixed={isWebsite}
              hideMenuHeader={isWebsite}
            />
          ) : (
            <ChatIndex
              ref={chatRef}
              className="flex-1"
              hideMenuHeader={isWebsite}
              showRecommend={isWebsite}
              useCaseFixed={isWebsite}
              hideBottomActions={hideBottomActions}
            />
          )}
        </div>
      </div>
    </section>
  );
});

ChatView.displayName = "ChatView";

export default ChatView;

export function ChatLayout() {
  return <Outlet />;
}
