import { useState, useCallback, useRef, useEffect } from "react";
import { useChatAdapters } from "../i18n";
import type { IAgentRunApi, AgentRunEvent, AgentRunInfo, AgentRunConnection } from "../adapters/types";
import { AGENT_RUN_TERMINAL_EVENTS, AGENT_RUN_RUNNING_STATUSES } from "../adapters/types";

export type AgentRunConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface RecoverCallbacks {
  onStart?: () => void;
  onMessage?: (isRunning: boolean, messageId?: string) => void | Promise<void>;
}

export interface UseAgentRunReturn {
  /** 是否启用 agentRun 能力（由 adapter 是否存在决定） */
  enabled: boolean;
  /** 恢复运行状态 */
  recover: (conversationId: string, callbacks?: RecoverCallbacks) => Promise<{ run: AgentRunInfo | null; isrunning: boolean }>;
  /** 取消运行 */
  cancel: () => Promise<void>;
  /** 断开 SSE 连接 */
  disconnect: () => void;
  /** 事件列表 */
  events: AgentRunEvent[];
  /** 当前 run 信息 */
  currentRun: AgentRunInfo | null;
  /**
   * 直接设置 currentRun（用于 sendMessage 后异步拉取到 latest-run 时回填，
   * 让 handleStop 时 cancel() 能拿到 run_id）。
   * 也接受 null 用于清理。
   */
  setCurrentRun: (run: AgentRunInfo | null) => void;
  /** 连接状态 */
  connectionStatus: AgentRunConnectionStatus;
}

/**
 * AgentRun Hook
 *
 * 管理 agent run 的 SSE 实时连接，支持：
 * 1. 页面刷新后恢复正在执行的 agent run（recover）
 * 2. 实时监听 agent 执行事件
 * 3. 取消正在执行的 agent run
 *
 * 通过 ChatConfigProvider 注入 agentRun adapter 启用：
 * ```tsx
 * <ChatConfigProvider adapters={{ agentRun: agentRunApi }}>
 *   <YourComponent />
 * </ChatConfigProvider>
 * ```
 *
 * 不注入 adapter 时，返回 enabled=false 的空实现，不影响其他 hooks。
 */
export function useAgentRun(): UseAgentRunReturn {
  const adapters = useChatAdapters();
  const agentRun = adapters?.agentRun as IAgentRunApi | undefined;

  const [events, setEvents] = useState<AgentRunEvent[]>([]);
  const [currentRun, setCurrentRunState] = useState<AgentRunInfo | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<AgentRunConnectionStatus>('disconnected');

  const connectionRef = useRef<AgentRunConnection | null>(null);
  const lastSeqRef = useRef(0);

  const disconnect = useCallback(() => {
    if (connectionRef.current) {
      connectionRef.current.disconnect();
      connectionRef.current = null;
    }
    setConnectionStatus('disconnected');
  }, []);

  // 无 adapter 时返回空实现
  if (!agentRun) {
    return {
      enabled: false,
      recover: async () => ({ run: null, isrunning: false }),
      cancel: async () => {},
      disconnect: () => {},
      events: [],
      currentRun: null,
      setCurrentRun: () => {},
      connectionStatus: 'disconnected',
    };
  }

  const handleEvent = useCallback((event: AgentRunEvent) => {
    // 去重：seq 小于等于 lastSeq 的事件忽略
    if (event.seq <= lastSeqRef.current) return;
    lastSeqRef.current = event.seq;

    setEvents((prev) => [...prev, event]);

    // 终端事件时断开连接
    if (AGENT_RUN_TERMINAL_EVENTS.includes(event.type)) {
      if (connectionRef.current) {
        connectionRef.current.disconnect();
        connectionRef.current = null;
      }
      setConnectionStatus('disconnected');
    }
  }, []);

  const subscribe = useCallback((runId: string, afterSeq: number) => {
    if (connectionRef.current) {
      connectionRef.current.disconnect();
    }

    setConnectionStatus('connecting');

    connectionRef.current = agentRun.subscribe(
      runId,
      {
        onEvent: handleEvent,
        onError: () => {
          setConnectionStatus('disconnected');
        },
        onReconnect: () => {
          setConnectionStatus('reconnecting');
        },
        onTerminal: () => {
          if (connectionRef.current) {
            connectionRef.current = null;
          }
          setConnectionStatus('disconnected');
        },
      },
      { after_seq: afterSeq },
    );

    setConnectionStatus('connected');
  }, [agentRun, handleEvent]);

  const recover = useCallback(async (conversationId: string, callbacks?: RecoverCallbacks) => {
    callbacks?.onStart?.();

    try {
      const { run } = await agentRun.latest(conversationId);

      if (!run || !AGENT_RUN_RUNNING_STATUSES.includes(run.status)) {
        await callbacks?.onMessage?.(false);
        return { run, isrunning: false };
      }

      setCurrentRunState(run);
      // 等待 onMessage 完成——它会触发 loadMessageList。
      // 必须等 messageList 加载完再 setEvents,否则 useEffect 会因 targetIndex === -1
      // 把 replay 事件丢弃(silently dropped)。
      await callbacks?.onMessage?.(true, run.message_id);

      // 获取历史事件
      const { events: historyEvents } = await agentRun.replay(run.run_id);
      for (const event of historyEvents) {
        if (event.seq > lastSeqRef.current) {
          lastSeqRef.current = event.seq;
        }
      }
      setEvents(historyEvents);

      // 如果仍在运行，建立 SSE 连接
      if (AGENT_RUN_RUNNING_STATUSES.includes(run.status)) {
        subscribe(run.run_id, lastSeqRef.current);
      }

      return { run, isrunning: true };
    } catch (error: any) {
      // 404 表示没有运行中的 run
      if (error?.response?.status === 404) {
        await callbacks?.onMessage?.(false);
        return { run: null, isrunning: false };
      }
      throw error;
    }
  }, [agentRun, subscribe]);

  const cancel = useCallback(async () => {
    if (currentRun) {
      await agentRun.cancel(currentRun.run_id);
    }
  }, [agentRun, currentRun]);

  const setCurrentRun = useCallback((run: AgentRunInfo | null) => {
    setCurrentRunState(run);
  }, []);

  // 组件卸载时断开连接
  useEffect(() => {
    return () => {
      if (connectionRef.current) {
        connectionRef.current.disconnect();
        connectionRef.current = null;
      }
    };
  }, []);

  return {
    enabled: true,
    recover,
    cancel,
    disconnect,
    events,
    currentRun,
    setCurrentRun,
    connectionStatus,
  };
}

export default useAgentRun;
