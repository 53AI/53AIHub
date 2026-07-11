import { useState, useCallback, useRef } from 'react';

export type StepStatus = "start" | "completed";
export type StreamStatus = "idle" | "start" | "running" | "completed";
export type SkillRunItemStatus = "pending" | "running" | "completed";

export type ProcessStep = {
  step_code: string;
  status: StepStatus;
  message: string;
  data?: unknown;
  timestamp?: number;
};

export type IntentData = {
  intent?: string;
  skill_name?: string;
  confidence?: number;
  reasoning?: string;
  keywords?: string[];
  answer?: string;
  expanded_queries?: unknown;
};

/** 技能步骤：显示 intentData */
export type SkillRunSkillItem = {
  type: "skill";
  title: string;
  status: SkillRunItemStatus;
  skillName?: string;
  intentData?: IntentData;
  /** 内部字段：存储 bash 供第三步使用 */
  _bash?: string;
  _toolCallId?: string;
};

/** 脚本步骤：显示 bash 和 output */
export type SkillRunScriptItem = {
  type: "script";
  title: string;
  bash: string;
  output: string;
  status: SkillRunItemStatus;
};

/** 搜索步骤 */
export type SkillRunSearchItem = {
  type: "search";
  title: string;
  icon?: string;
  sourceCount?: number;
  tags?: string[];
  sources?: Array<{ title: string; url?: string; icon?: string }>;
  status?: SkillRunItemStatus;
};

export type SkillRunItem = SkillRunSkillItem | SkillRunScriptItem | SkillRunSearchItem;

// ============ 工具函数 ============

function parseJson<T>(json: string): T | null {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function formatBash(code: string, language: string): string {
  const trimmed = (code || "").trim();
  return trimmed ? (language === "bash" || !language ? `$ ${trimmed}` : trimmed) : "";
}

function getIntentData(raw: unknown): IntentData | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  return {
    intent: r.intent != null ? String(r.intent) : undefined,
    skill_name: r.skill_name != null ? String(r.skill_name) : undefined,
    confidence: typeof r.confidence === "number" ? r.confidence : undefined,
    reasoning: r.reasoning != null ? String(r.reasoning) : undefined,
    keywords: Array.isArray(r.keywords) ? r.keywords.map(String) : undefined,
    answer: r.answer != null ? String(r.answer) : undefined,
    expanded_queries: r.expanded_queries,
  };
}

// ============ 更新列表的辅助函数 ============

function updateSkillItem(
  items: SkillRunItem[],
  predicate: (item: SkillRunItem) => boolean,
  updater: (item: SkillRunSkillItem) => Partial<SkillRunSkillItem>
): SkillRunItem[] {
  const idx = items.findIndex(predicate);
  if (idx === -1) return items;
  const item = items[idx] as SkillRunSkillItem;
  return [...items.slice(0, idx), { ...item, ...updater(item) }, ...items.slice(idx + 1)];
}

// ============ 主 Hook ============

export function useProcessStream() {
  const [content, setContent] = useState("");
  const [steps, setSteps] = useState<ProcessStep[]>([]);
  const [skillRunItems, setSkillRunItems] = useState<SkillRunItem[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");

  // 使用 ref 来存储最新的值，以便在回调中访问
  const contentRef = useRef("");
  const skillRunItemsRef = useRef<SkillRunItem[]>([]);
  const streamStatusRef = useRef<StreamStatus>("idle");

  contentRef.current = content;
  skillRunItemsRef.current = skillRunItems;
  streamStatusRef.current = streamStatus;

  // 获取最新值的方法（用于在异步回调中获取最新状态）
  const getLatestState = useCallback(() => ({
    content: contentRef.current,
    skillRunItems: skillRunItemsRef.current,
    streamStatus: streamStatusRef.current,
  }), []);

  // 处理意图识别
  const handleIntentClassification = useCallback((step: ProcessStep, currentItems: SkillRunItem[]) => {
    if (step.status === "start") {
      return [
        ...currentItems,
        { type: "skill" as const, title: step.message || "正在识别意图...", status: "running" as const },
      ];
    } else if (step.status === "completed") {
      const data = step.data as { intent?: unknown } | undefined;
      const intentData = getIntentData(data?.intent);
      return updateSkillItem(
        currentItems,
        (item) => item.type === "skill",
        () => ({
          title: step.message,
          status: "completed" as const,
          skillName: intentData?.skill_name,
          intentData,
        })
      );
    }
    return currentItems;
  }, []);

  // 处理技能路由
  const handleSkillRouting = useCallback((step: ProcessStep, currentItems: SkillRunItem[]) => {
    if (step.status === "completed") {
      return updateSkillItem(
        currentItems,
        (item) => item.type === "skill",
        (item) => ({
          title: item.skillName ? "技能加载完成" : step.message,
          status: "completed" as const,
        })
      );
    }
    return currentItems;
  }, []);

  // 处理工具执行开始 -> 第二步：正在使用技能
  const handleToolExecutionStart = useCallback((step: ProcessStep, currentItems: SkillRunItem[]) => {
    const data = step.data as {
      skill_name?: string;
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
    };
    const calls = data?.tool_calls ?? [];
    const firstSkill = currentItems.find((item) => item.type === "skill") as SkillRunSkillItem | undefined;

    let newItems = [...currentItems];
    for (const call of calls) {
      const args = parseJson<{ code?: string; language?: string }>(call.function?.arguments ?? "{}") ?? {};
      const bash = formatBash(args.code ?? "", args.language ?? "bash");

      newItems = [
        ...newItems,
        {
          type: "skill" as const,
          title: "正在使用技能...",
          status: "running" as const,
          skillName: data?.skill_name,
          intentData: firstSkill?.intentData,
          _bash: bash,
          _toolCallId: (call.id ?? "") + "_running",
        },
      ];
    }
    return newItems;
  }, []);

  // 处理工具执行结果 -> 第三步：技能执行完成
  const handleToolResult = useCallback((step: ProcessStep, currentItems: SkillRunItem[]) => {
    const data = step.data as { tool_call_id?: string; result?: string; skill_name?: string };
    const toolCallId = (data?.tool_call_id ?? "") + "_running";
    const result = typeof data?.result === "string" ? data.result : "";

    // 更新第二步状态
    const idx = currentItems.findIndex(
      (item) => item.type === "skill" && (item as SkillRunSkillItem)._toolCallId === toolCallId
    );
    let bash = "";
    let newItems = [...currentItems];
    if (idx !== -1) {
      const item = currentItems[idx] as SkillRunSkillItem;
      bash = item._bash ?? "";
      newItems = [
        ...currentItems.slice(0, idx),
        { ...item, status: "completed" as const },
        ...currentItems.slice(idx + 1),
      ];
    }

    // 添加第三步
    newItems = [
      ...newItems,
      {
        type: "script" as const,
        title: data?.skill_name ? `技能 ${data.skill_name} 执行完成` : "技能执行完成",
        bash,
        output: result,
        status: "completed" as const,
      },
    ];
    return newItems;
  }, []);

  // 处理单行数据
  const pushLine = useCallback((line: string) => {
    const trimmed = line.trim();
    if (!trimmed?.startsWith("data:")) return;

    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") {
      setStreamStatus("completed");
      return;
    }

    const obj = parseJson<Record<string, unknown>>(payload);
    if (!obj) return;

    // 处理流程步骤
    if (obj.object === "process.step") {
      const ps = obj.process_step as Record<string, unknown>;
      const step: ProcessStep = {
        step_code: String(ps?.step_code ?? ""),
        status: (ps?.status as StepStatus) ?? "start",
        message: String(ps?.message ?? ""),
        data: ps?.data,
        timestamp: typeof ps?.timestamp === "number" ? ps.timestamp : undefined,
      };
      setSteps(prev => [...prev, step]);

      setStreamStatus(prev => {
        if (prev === "idle") return "start";
        if (step.status === "start") return "running";
        return prev;
      });

      // 分发到具体处理器
      setSkillRunItems(prev => {
        let newItems = prev;
        switch (step.step_code) {
          case "intent_classification":
            newItems = handleIntentClassification(step, newItems);
            break;
          case "skill_routing":
            newItems = handleSkillRouting(step, newItems);
            break;
          case "tool_execution":
            if (step.status === "start" && step.data) {
              newItems = handleToolExecutionStart(step, newItems);
            }
            break;
          case "tool_result":
            if (step.status === "completed" && step.data) {
              newItems = handleToolResult(step, newItems);
            }
            break;
          case "answer_generation":
            if (step.status === "completed") {
              setStreamStatus("completed");
            }
            break;
        }
        return newItems;
      });
    }

    // 处理内容块
    if (obj.object === "chat.completion.chunk" && Array.isArray(obj.choices) && obj.choices.length > 0) {
      const delta = (obj.choices[0] as { delta?: { content?: string } })?.delta;
      if (typeof delta?.content === "string") {
        setContent(prev => prev + delta.content);
      }
    }
  }, [handleIntentClassification, handleSkillRouting, handleToolExecutionStart, handleToolResult]);

  const reset = useCallback(() => {
    setContent("");
    setSteps([]);
    setSkillRunItems([]);
    setStreamStatus("idle");
  }, []);

  const skillRunItemsForRender = useCallback(() =>
    skillRunItems.map((item) => {
      if (item.type === "skill") {
        const { _bash, _toolCallId, ...rest } = item as SkillRunSkillItem;
        return rest;
      }
      return item;
    }), [skillRunItems]);

  return {
    content,
    steps,
    skillRunItems,
    streamStatus,
    pushLine,
    reset,
    skillRunItemsForRender,
    getLatestState,
  };
}
