// packages/shared-business/src/chat/components/ChatView/hooks/useChatFeedback.ts
//
// 集中管理 ChatView 的"反馈(点赞/点错)"功能:
//   - 根据 agent_usage + openclaw 模式判断 feedbackEnabled
//   - 从 feedback adapter 异步加载 reason 配置,合并默认值
//   - 5 个 feedback 回调(打开面板 / 切换选项 / 关闭 / 提交 / 修改描述)
//   - 提交成功后 2s 自动清除"成功提示"状态,跨实例共享的 timeout map
//
// 此 hook 自治管理 timeout 清理(unmount 时自动 clearAll),
// 调用方无需关心 feedbackSuccessTimeoutsRef。

import { useCallback, useEffect, useRef, useState } from "react";
import type { IChatAdapters } from "../../../i18n";
import type { Message } from "../../../types/message";

export interface UseChatFeedbackParams {
  /** chat adapters(由 ChatConfigProvider 注入) */
  chatAdapters: IChatAdapters | null;
  /**
   * agent_info.agent_usage
   *  - 1 = KM_AI_SEARCH → 反馈 config type 'km_ai_search'
   *  - 4 = WORK_AI     → 反馈 config type 'work_ai'
   *  - 其他值不直接决定反馈开关 / type;由 agentType 兜底
   */
  agentUsage?: number;
  /**
   * agent_info.backend_agent_type(后台判定)
   *  - 0 = 对话(chat)        → 反馈 config type 'chat'
   *  - 1 = 工作流(completion) → 反馈 config type 'workflow'
   *  - 2 = 助理(assistant)    → 反馈 config type 'work_ai'(openclaw / qclaw / 小助理走同一份)
   *  - 其他(包括 undefined)   → 不直接决定 type;由 agentUsage 兜底
   */
  agentType?: number;
  /** 是否启用 openclaw 模式;开启时禁用 feedback */
  openclawEnabled: boolean;
  /**
   * 反馈功能是否启用(由调用方计算后传入)。
   * 必须由调用方先行计算,因为 useChatMessages 需要这个标志位
   * 在 useChatFeedback 之前传入。
   */
  feedbackEnabled: boolean;
  /** 消息列表更新器(useChatMessages 返回) */
  updateMessageList: (updater: (messages: Message[]) => Message[]) => void;
}

export interface UseChatFeedbackResult {
  /** 反馈面板事件回调集合(传给 MessageMenu / ChatMessages) */
  feedbackHandlers: {
    onFeedback: (msg: Message, type: "satisfied" | "unsatisfied") => Promise<void>;
    onToggleOption: (msg: Message, key: string) => void;
    onClose: (msg: Message) => void;
    onSubmit: (msg: Message) => Promise<void>;
    onDescriptionChange: (msg: Message, value: string) => void;
  };
}

const DEFAULT_FEEDBACK_CONFIG = {
  satisfied: ["Accurate", "Helpful", "Other"],
  unsatisfied: ["Inaccurate", "Irrelevant", "Other"],
};

/**
 * 把 (agentUsage, agentType) 映射到 feedback config API 的 type 参数。
 *
 * 优先级:
 *   1. agentType(backend_agent_type)优先
 *      - 0 (chat)        → 'chat'
 *      - 1 (completion)  → 'workflow'
 *      - 2 (assistant)   → 'work_ai'(openclaw / qclaw / 小助理走同一份)
 *   2. agentUsage 兜底
 *      - 1 (KM_AI_SEARCH) → 'km_ai_search'
 *      - 其他(含 4)       → 'work_ai'
 *
 * 不被反馈开关使用;仅用于 getConfig 的 type 字段。开关由 ChatView 计算 feedbackEnabled 后传入 hook。
 */
function resolveFeedbackType(
  agentUsage: number | undefined,
  agentType: number | undefined,
): "chat" | "workflow" | "km_ai_search" | "work_ai" {
  if (agentType === 0) return "chat";
  if (agentType === 1) return "workflow";
  if (agentType === 2) return "work_ai";
  if (agentUsage === 1) return "km_ai_search";
  return "work_ai";
}

/**
 * ChatView 反馈功能 hook。
 *
 * 功能判断规则(由 ChatView.tsx 计算 feedbackEnabled 后传入):
 * - 非 openclaw 模式
 * - 满足任一:agent_usage ∈ {1, 4}(前台已知的 AI搜问/工作台)
 *           OR backend_agent_type(agent_type) ∈ {0, 1}(后台判定的对话型/工作流)
 * - chatAdapters.feedback 已注入
 *
 * 提交成功后会在 2s 内自动重置 feedbackSuccessful;timeout 在 hook unmount 时统一清理。
 */
export function useChatFeedback(params: UseChatFeedbackParams): UseChatFeedbackResult {
  const { chatAdapters, agentUsage, agentType, feedbackEnabled, updateMessageList } = params;

  // 反馈原因配置(默认 fallback,实际值从 API 加载)
  const [feedbackConfig, setFeedbackConfig] = useState<{
    satisfied: string[];
    unsatisfied: string[];
  }>(DEFAULT_FEEDBACK_CONFIG);

  // 加载 feedback 配置
  useEffect(() => {
    const feedbackAdapter = chatAdapters?.feedback;
    if (!feedbackEnabled || !feedbackAdapter) return;

    const loadConfig = async () => {
      try {
        const { api, context } = feedbackAdapter;
        const configData = await api.getConfig({
          eid: context.getEid(),
          type: resolveFeedbackType(agentUsage, agentType),
        });
        const configList = JSON.parse(configData.value);
        if (configList) {
          const types: Array<"satisfied" | "unsatisfied"> = ["satisfied", "unsatisfied"];
          for (const t of types) {
            if (configList[t] && !configList[t].includes("其它")) {
              configList[t].push("其它");
            }
          }
          setFeedbackConfig(configList);
        }
      } catch (err) {
        console.warn("Failed to load feedback config:", err);
      }
    };

    loadConfig();
  }, [feedbackEnabled, chatAdapters?.feedback, agentUsage, agentType]);

  // 提交成功后的 2s 自动重置 timeout(按 messageId 索引)
  const feedbackSuccessTimeoutsRef = useRef<Map<string | number, number>>(new Map());

  // unmount 时清理所有 timeout
  useEffect(() => {
    const timeouts = feedbackSuccessTimeoutsRef.current;
    return () => {
      timeouts.forEach((timeoutId) => clearTimeout(timeoutId));
      timeouts.clear();
    };
  }, []);

  // 点击点赞/点错按钮
  const onFeedback = useCallback(
    async (msg: Message, type: "satisfied" | "unsatisfied") => {
      if (!chatAdapters?.feedback) return;

      // 如果点击的是相同的类型,取消反馈
      if (msg.feedback_type === type) {
        const { api } = chatAdapters.feedback;
        if (msg.feedbackId) {
          try {
            await api.deleteFeedback(msg.feedbackId);
          } catch (err) {
            console.error("Delete feedback error:", err);
          }
        }
        updateMessageList((messages) =>
          messages.map((m) =>
            m.id === msg.id ? { ...m, feedback_type: "", feedbackId: null, feedbackVisible: false } : m
          )
        );
        return;
      }

      // 获取对应类型的配置选项
      const configList =
        feedbackConfig[type] ||
        (type === "satisfied" ? DEFAULT_FEEDBACK_CONFIG.satisfied : DEFAULT_FEEDBACK_CONFIG.unsatisfied);
      const feedbackTypeOptions = new Map<string, boolean>();
      configList.forEach((item: string) => {
        feedbackTypeOptions.set(item, false);
      });

      // 用户期望行为:点踩/点赞 → 立即 POST /api/feedback 创建一条空 reason 的 feedback 记录
      // 拿到 id 后展示配置面板;用户选 reason 提交时,onSubmit 会 PUT /api/feedback/{id} 更新。
      // 兜底:刷新页面或 message.feedbackId 已存在(再次进入对话)时跳过创建。
      let feedbackId: string | number | null = msg.feedbackId ?? null;
      if (!feedbackId) {
        try {
          const result = await chatAdapters.feedback.api.createFeedback({
            description: "",
            feedback_type: type,
            message_id: msg.id,
            question: msg.original_question || msg.question || "",
            reason: "",
          });
          feedbackId = result?.id ?? null;
        } catch (err) {
          console.error("Create feedback on click error:", err);
        }
      }

      // 一次性更新:关闭其他消息面板 + 更新当前消息状态
      updateMessageList((messages) =>
        messages.map((m) =>
          m.id === msg.id
            ? {
                ...m,
                feedback_type: type,
                feedbackId,
                feedbackVisible: true,
                feedbackTypeOptions,
                submitBtnDisabled: true,
                feedbackSuccessful: false,
              }
            : { ...m, feedbackVisible: false }
        )
      );
    },
    [chatAdapters, updateMessageList, feedbackConfig]
  );

  // 切换反馈选项
  const onToggleOption = useCallback(
    (msg: Message, key: string) => {
      const newOptions = new Map(msg.feedbackTypeOptions || new Map());
      newOptions.set(key, !newOptions.get(key));

      updateMessageList((messages) =>
        messages.map((m) =>
          m.id === msg.id
            ? {
                ...m,
                feedbackTypeOptions: newOptions,
                submitBtnDisabled: ![...newOptions.values()].includes(true),
              }
            : m
        )
      );
    },
    [updateMessageList]
  );

  // 关闭反馈面板
  const onClose = useCallback(
    (msg: Message) => {
      updateMessageList((messages) =>
        messages.map((m) => (m.id === msg.id ? { ...m, feedbackVisible: false, description: "" } : m))
      );
    },
    [updateMessageList]
  );

  // 提交反馈
  const onSubmit = useCallback(
    async (msg: Message) => {
      if (!chatAdapters?.feedback) return;

      const { api } = chatAdapters.feedback;
      const selectedOptions = Array.from((msg.feedbackTypeOptions || new Map()).entries())
        .filter(([, value]) => value)
        .map(([key]) => key);

      if (selectedOptions.length === 0) return;

      const params = {
        description: msg.description || "",
        feedback_type: msg.feedback_type || "",
        message_id: msg.id,
        question: msg.original_question || msg.question || "",
        reason: selectedOptions.join("、"),
      };

      try {
        // 主路径:onFeedback 时已 POST /api/feedback 创建了一条 feedback,这里 PUT /api/feedback/{id} 更新
        // 兜底:极小概率 feedbackId 缺失(例如前端刷新 / store 未持久化),退回 createFeedback
        if (msg.feedbackId) {
          await api.updateFeedback(msg.feedbackId, params);
        } else {
          const result = await api.createFeedback(params);
          if (result?.id) {
            updateMessageList((messages) =>
              messages.map((m) => (m.id === msg.id ? { ...m, feedbackId: result.id } : m))
            );
          }
        }

        // 关闭面板,显示成功状态
        updateMessageList((messages) =>
          messages.map((m) => (m.id === msg.id ? { ...m, feedbackVisible: false, feedbackSuccessful: true } : m))
        );

        // 清理之前的 timeout
        const existingTimeout = feedbackSuccessTimeoutsRef.current.get(msg.id);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
        }

        // 2 秒后重置成功状态
        const timeoutId = window.setTimeout(() => {
          feedbackSuccessTimeoutsRef.current.delete(msg.id);
          updateMessageList((messages) =>
            messages.map((m) => (m.id === msg.id ? { ...m, feedbackSuccessful: false } : m))
          );
        }, 2000);
        feedbackSuccessTimeoutsRef.current.set(msg.id, timeoutId);
      } catch (err) {
        console.error("Submit feedback error:", err);
      }
    },
    [chatAdapters, updateMessageList]
  );

  // 修改反馈描述
  const onDescriptionChange = useCallback(
    (msg: Message, value: string) => {
      updateMessageList((messages) => messages.map((m) => (m.id === msg.id ? { ...m, description: value } : m)));
    },
    [updateMessageList]
  );

  return {
    feedbackHandlers: {
      onFeedback,
      onToggleOption,
      onClose,
      onSubmit,
      onDescriptionChange,
    },
  };
}