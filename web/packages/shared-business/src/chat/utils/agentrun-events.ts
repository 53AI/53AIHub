import type { AgentRunEvent, AgentRunStatus } from "../adapters/types";
import { AGENT_RUN_RUNNING_STATUSES } from "../adapters/types";
import type { Message } from "../types";

/**
 * 将 AgentRun 事件列表应用到消息对象
 *
 * 遍历事件列表，按顺序更新消息的 loading/answer/reasoning_content 等字段。
 * 每次调用都是幂等的——从完整事件列表重新计算消息状态。
 */
export function applyAgentRunEvents(
  message: Message,
  events: AgentRunEvent[],
): Message {
  let next: Message = message;
  // process_records 用 Map 缓存 stepCode → index，避免 O(n²) findIndex
  let stepIndex: Map<string, number> | null = null;

  for (const event of events) {
    switch (event.type) {
      case 'run.created':
        if (!next.loading) {
          next = { ...next, loading: true };
        }
        break;

      case 'run.status_changed': {
        const status = event.payload.status as AgentRunStatus;
        const loading = AGENT_RUN_RUNNING_STATUSES.includes(status);
        if (next.loading !== loading) {
          next = { ...next, loading };
        }
        break;
      }

      case 'message.delta': {
        // 兼容两种 payload 结构：
        // 1) 直接 { content, reasoning_content }
        // 2) SSE 风格 { choices: [{ delta: { content, reasoning_content } }] }（replay / OpenAI 兼容）
        const choices = (event.payload as any)?.choices;
        const delta = Array.isArray(choices) && choices.length > 0
          ? (choices[0]?.delta ?? {})
          : event.payload;
        const content = (delta as any)?.content;
        const reasoningContent = (delta as any)?.reasoning_content;
        let answer = next.answer;
        let reasoning_content = next.reasoning_content;
        let mutated = false;
        if (typeof content === 'string' && content.length > 0) {
          answer = (answer || '') + content;
          mutated = true;
        }
        if (typeof reasoningContent === 'string' && reasoningContent.length > 0) {
          reasoning_content = (reasoning_content || '') + reasoningContent;
          mutated = true;
        }
        if (mutated) {
          next = { ...next, answer, reasoning_content };
        }
        break;
      }

      case 'message.completed': {
        const completedAnswer = event.payload.answer;
        const updates: Partial<Message> = { loading: false };
        if (typeof completedAnswer === 'string') {
          updates.answer = completedAnswer;
        }
        next = { ...next, ...updates };
        break;
      }

      case 'process.step': {
        // 后端 payload 结构是 { object: "process.step", process_step: {...} },
        // 这里统一解包 process_step 后再读字段,避免 step_code 落到 undefined。
        const step = (event.payload as any)?.process_step ?? event.payload;
        const stepCode = String(step.step_code ?? '');
        if (!stepIndex) {
          stepIndex = new Map(
            (next.process_records ?? []).map((r, i) => [r.step_code, i]),
          );
        }
        const records = next.process_records ? [...next.process_records] : [];
        const newData = step.data !== undefined && step.data !== null
          ? (typeof step.data === "string" ? step.data : JSON.stringify(step.data))
          : undefined;

        // llm_delta:每个 event 只包含一段 content(分片流式),
        // 必须基于"已有 record 的 data"累加,而不是当前 event 的 data —— 否则
        // 首事件就会把自身的 content 拼到自己身上(变成 "HelloHello")。
        if (stepCode === 'llm_delta') {
          let accumulatedContent = '';
          let accumulatedType = 'reasoning';
          const idx = stepIndex.get(stepCode);
          if (idx !== undefined) {
            const existing = records[idx] as any;
            if (existing?.data) {
              try {
                const parsed = JSON.parse(existing.data);
                if (typeof parsed?.content === 'string') accumulatedContent = parsed.content;
                if (typeof parsed?.type === 'string') accumulatedType = parsed.type;
              } catch {
                /* keep defaults */
              }
            }
          }
          const incomingContent = (step.data as any)?.content;
          if (typeof incomingContent === 'string') {
            accumulatedContent += incomingContent;
          }
          const incomingType = (step.data as any)?.type;
          if (typeof incomingType === 'string') {
            accumulatedType = incomingType;
          }
          const mergedData = JSON.stringify({ content: accumulatedContent, type: accumulatedType });
          if (idx !== undefined) {
            records[idx] = {
              ...records[idx],
              step_code: stepCode,
              status: step.status,
              message: step.message,
              data: mergedData,
            } as typeof records[number];
          } else {
            const newRecord = {
              step_code: stepCode,
              status: step.status,
              message: step.message,
              data: mergedData,
            };
            records.push(newRecord as typeof records[number]);
            stepIndex.set(stepCode, records.length - 1);
          }
          next = { ...next, process_records: records as typeof next.process_records };
          break;
        }

        // tool_execution:start 事件带 tool_calls,completed 事件没有 data。
        // 如果 completed 直接覆盖,UI 端就拿不到 tool_calls,无法渲染调用详情。
        // 这里采用"优先保留已有 data,只在没有时才用新 data"的合并策略。
        if (stepCode === 'tool_execution') {
          const idx = stepIndex.get(stepCode);
          if (idx !== undefined) {
            const existing = records[idx] as any;
            records[idx] = {
              ...existing,
              step_code: stepCode,
              status: step.status,
              message: step.message || existing?.message,
              // 已有 data(start 的 tool_calls)就保留;没有才用新 data。
              data: existing?.data ?? newData,
            } as typeof records[number];
          } else {
            const newRecord = {
              step_code: stepCode,
              status: step.status,
              message: step.message,
              data: newData,
            };
            records.push(newRecord as typeof records[number]);
            stepIndex.set(stepCode, records.length - 1);
          }
          next = { ...next, process_records: records as typeof next.process_records };
          break;
        }

        // 其他 step_code:按 step_code upsert,后到的覆盖前到的
        const record = {
          step_code: stepCode,
          status: step.status,
          message: step.message,
          data: newData,
        };
        const idx = stepIndex.get(stepCode);
        if (idx !== undefined) {
          records[idx] = record as typeof records[number];
        } else {
          records.push(record as typeof records[number]);
          stepIndex.set(stepCode, records.length - 1);
        }
        next = { ...next, process_records: records as typeof next.process_records };
        break;
      }

      case 'run.completed':
        if (next.loading) {
          next = { ...next, loading: false };
        }
        break;

      case 'run.failed': {
        const updates: Partial<Message> = { loading: false, error: true };
        if (!next.answer?.trim()) {
          updates.answer = String(event.payload.error_message || '运行失败');
        }
        next = { ...next, ...updates };
        break;
      }

      case 'run.cancelled': {
        const updates: Partial<Message> = { loading: false, interrupted: true };
        if (!next.answer?.trim()) {
          updates.answer = '本次运行已取消';
        }
        next = { ...next, ...updates };
        break;
      }
    }
  }

  // 有答案且有推理内容时，折叠推理
  if (
    next.answer?.trim() &&
    next.reasoning_content?.trim() &&
    next.reasoning_expanded
  ) {
    next = { ...next, reasoning_expanded: false };
  }

  return next;
}
