import { useRef, useCallback, useState } from "react";
import type { IConversationApi, ChatCompletionParams, AgentRunInfo } from "../adapters/types";
import type { Message, SendMessageOptions, Skill, MessageFile, SpecifiedFile } from "../types";
import {
  getOpenClawMessageListMaxActivitySeq,
  getOpenClawPayloadTimelineMaxSeq,
  mergeOpenClawActiveMessageIntoList,
  mergeOpenClawTimelineEventsIntoMessage,
  replaceOpenClawTurnWithTimelineEvents,
  useChatStream,
} from "./useChatStream";
import { useRagStats } from "./useRagStats";
import { useAgentRun } from "./useAgentRun";
import { isOpenClawPendingConversationId } from "../utils/openclaw";
import { hasConversationId } from "../utils/openclaw-chatview-helpers";
import { getOpenClawTimelineEventsFromLedgerPayload } from "../utils/openclaw-ledger";
import { buildOpenClawTurnKey, createOpenClawTurnState } from "../utils/openclaw-turn";
import { useChatAdapters } from "../i18n";
import { useConversationStore } from "../stores/conversation";
import { buildKnowledgeSourcePayload } from "../utils/buildKnowledgeSourcePayload";

/**
 * 格式化问题：添加技能前缀
 */
function formatQuestionWithSkill(question: string, skill?: Skill): string {
  return skill?.skill_name && skill?.display_name
    ? `/${skill.skill_name} ${question}`
    : question;
}

/**
 * 构建文件内容项（用于 user 消息中的文件）
 */
function buildFileContent(file: any, useUploadId: boolean = false): any | null {
  const fileId = useUploadId ? file.upload_file_id : file.id;
  if (!fileId) return null;
  return {
    type: "file",
    content: `file_id:${fileId}`,
    filename: file.filename || file.name,
    file_id: file.id ?? '',
    library_id: file.library_id ?? '',
    size: file.file_size ?? file.size,
    mime_type: file.file_mime ?? file.mime_type,
    preview_key: file.preview_key,
    url: file.url,
    preview_url: file.preview_url,
    download_url: file.download_url,
    signed_download_url: file.signed_download_url,
  };
}

function buildOpenClawInputFileMetadata(files: any[]): any[] {
  return files
    .map((file) => {
      const id = file.id ?? file.file_id ?? file.upload_file_id;
      if (!id && !file.url && !file.preview_url && !file.download_url && !file.signed_download_url) {
        return null;
      }
      return {
        ...(id ? { id, file_id: id } : {}),
        name: file.name ?? file.file_name ?? file.filename,
        file_name: file.file_name ?? file.name ?? file.filename,
        filename: file.filename ?? file.name ?? file.file_name,
        size: file.file_size ?? file.size,
        mime_type: file.file_mime ?? file.mime_type,
        preview_key: file.preview_key,
        url: file.url,
        preview_url: file.preview_url,
        download_url: file.download_url,
        signed_download_url: file.signed_download_url,
      };
    })
    .filter(Boolean);
}

function buildOpenClawSkillMetadata(skill?: Skill): Record<string, any> | undefined {
  if (!skill?.skill_name && !skill?.id && !skill?.skill_id) {
    return undefined;
  }
  return {
    skill_id: skill.skill_id ?? skill.id,
    skill_name: skill.skill_name,
    display_name: skill.display_name,
    ensure: true,
  };
}

function readOpenClawSkillEnsureData(response: any): any {
  return response?.data?.data ?? response?.data ?? response;
}

function assertOpenClawSkillEnsureSucceeded(response: any): void {
  const data = readOpenClawSkillEnsureData(response);
  if (!data || (data.status !== "failed" && data.ok !== false)) {
    return;
  }
  throw new Error(data.error || "OpenClaw 技能安装失败");
}

/**
 * 构建 specified_files（用于 info 消息）
 */
function buildSpecifiedFilesInfo(links: SpecifiedFile[]): { content: string; role: string } {
  return {
    content: JSON.stringify({
      type: 'specified_files',
      list: links.map(item => ({
        id: item.id,
        name: item.name,
        icon: item.icon,
        library_id: item.library_id,
        space_id: item.space_id,
        ...(item.isfolder !== undefined && { isfolder: item.isfolder }),
        ...(item.islibrary && { islibrary: item.islibrary }),
        ...(item.isspace && { isspace: item.isspace }),
        ...(item.ispage && { ispage: item.ispage }),
        ...(item.slug && { slug: item.slug }),
        ...(item.type && { type: item.type }),
      }))
    }),
    role: "info",
  };
}

/**
 * 构建 specified_content（用于 info 消息）
 */
function buildSpecifiedContentInfo(text: string): { content: string; role: string } {
  return {
    content: JSON.stringify({ type: "specified_content", content: text }),
    role: "info",
  };
}

type OpenClawTurnPhase = "idle" | "queued" | "dispatching" | "stopping";

function getOpenClawTimelineEvents(payload: any): any[] {
  const events = payload?.events ?? payload?.data?.events;
  if (Array.isArray(events) && events.length) return events;
  return getOpenClawTimelineEventsFromLedgerPayload(payload);
}

function withOpenClawEventsAfterSeq(payload: any, afterSeq: number): any {
  if (!afterSeq) return payload;

  const events = getOpenClawTimelineEvents(payload);
  if (!events.length) return payload;

  const nextEvents = events.filter((event) => {
    const seq = typeof event?.seq === "number" ? event.seq : Number(event?.seq);
    return Number.isFinite(seq) && seq > afterSeq;
  });

  if (payload?.data && Array.isArray(payload.data.events)) {
    return {
      ...payload,
      data: {
        ...payload.data,
        events: nextEvents,
      },
    };
  }

  return {
    ...payload,
    events: nextEvents,
  };
}

function hasOpenClawEventsAfterSeq(payload: any, afterSeq: number): boolean {
  return getOpenClawTimelineEvents(payload).some((event) => {
    const seq = typeof event?.seq === "number" ? event.seq : Number(event?.seq);
    return Number.isFinite(seq) && seq > afterSeq;
  });
}

function isCanceledError(err: any) {
  return err?.message === "canceled" || err?.code === "ERR_CANCELED" || err?.name === "CanceledError";
}

function getOpenClawErrorMessage(err: any): string {
  const message =
    err?.response?.data?.message ||
    err?.response?.data?.error?.message ||
    err?.message ||
    "";
  if (/插件未连接|plugin.*connect|not connected/i.test(message)) {
    return "OpenClaw 插件未连接";
  }
  if (/timeout|超时/i.test(message)) {
    return "OpenClaw 响应超时";
  }
  if (/gateway/i.test(message)) {
    return "Gateway 当前不可用";
  }
  return message || "OpenClaw 请求失败";
}

function hasOpenClawTerminalState(message: Message): boolean {
  const status = message.openclawTurn?.status;
  return Boolean(
    message.interrupted ||
      message.error ||
      status === "completed" ||
      status === "failed" ||
      status === "interrupted"
  );
}

/**
 * Chat Message Sending Hook
 * Uses injected conversation API adapter for actual API calls
 *
 * 支持请求锁机制：防止并发请求覆盖 currentMessageRef
 *
 * 通过 ChatConfigProvider 注入完整 `IConversationApi`（unify-chat-adapters 之后）：
 * ```tsx
 * <ChatConfigProvider adapters={{ conversationApi, ... }}>
 *   <YourComponent />
 * </ChatConfigProvider>
 * ```
 */
export function useChatSend(legacyConversationApi?: IConversationApi) {
  const adapters = useChatAdapters();
  const conversationApi = legacyConversationApi || adapters?.conversationApi;

  if (!conversationApi) {
    throw new Error(
      'useChatSend requires conversationApi adapter. ' +
      'Please provide it in ChatConfigProvider: adapters={{ conversationApi }}'
    );
  }

  const { processStreamData, clearBuffer } = useChatStream();
  const { formatRagStats } = useRagStats();
  const agentRun = useAgentRun();
  const recentUsedApi = adapters?.recentUsed;

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentMessageRef = useRef<Message | null>(null);
  const messageListChangeRef = useRef<SendMessageOptions["onMessageListChange"] | null>(null);
  const openClawRequestRef = useRef(false);
  const openClawStopPromiseRef = useRef<Promise<void> | null>(null);
  const openClawTurnPhaseRef = useRef<OpenClawTurnPhase>("idle");
  /** 请求锁：防止并发请求覆盖 currentMessageRef */
  const requestIdRef = useRef(0);
  /**
   * 守护:每次 sendMessage 内最多拉一次 latest run。
   * 对齐老 IndexChat.tsx 第 207 行的 latestRunFetchedRef —— 在 sendMessage 开头
   * 重置为 false,在首次拿到 server 真实 message_id 后置为 true 并触发 latest,
   * 避免重入 + 避免在流式未启动时把上一条消息的 run 当成当前消息的 run。
   */
  const latestRunFetchedRef = useRef(false);
  /**
   * 记录当前 run 所属的 conversation_id,用于在 clearStreamingState/handleStop/
   * sendMessage 收尾时精准清掉 useConversationStore.conversations[X].latest_run,
   * 让 ChatHistory 的 loading spinner 与 store 状态保持一致。
   *
   * 为什么需要这个 ref:
   * - useAgentRun.setCurrentRun 维护的是"当前在跑的 run",是 hook 局部 React state,
   *   与 useConversationStore 里的 latest_run 字段是两份独立状态。
   * - ChatHistory 只能读 store 的 latest_run 来判断 isRunRunning(item.latest_run)
   *   是否显示 spinner;若不主动同步,新启动的 run 永远反映不到列表上。
   * - 主动清时也必须用 ref 记住上次写入的是哪个会话,否则在切流/并发请求时会把
   *   无关会话的 latest_run 误清。
   */
  const currentRunConversationIdRef = useRef<string | null>(null);
  /**
   * 把当前 run 同步到 useConversationStore.conversations[X].latest_run,
   * 让 ChatHistory 侧能正确显示 loading 状态。
   *
   * 行为:
   * - run 非 null:记录 run.conversation_id 到 ref,并把 run 写入 store 的 latest_run。
   * - run 为 null:读取 ref 拿到上次写入的会话,把它的 latest_run 清成 null。
   *
   * 注:这里和 agentRun.setCurrentRun 解耦 —— agentRun 的 currentRun 是为了
   * handleStop 时的 cancel() 定位 run_id;store 的 latest_run 是给 ChatHistory
   * 显示 spinner 用的。两者用途不同,清理时机也可以独立。
   */
  const syncLatestRunToStore = useCallback(
    (run: AgentRunInfo | null) => {
      const updateConversationLatestRun = useConversationStore.getState()
        .updateConversationLatestRun;
      if (run) {
        currentRunConversationIdRef.current = String(run.conversation_id);
        updateConversationLatestRun(run.conversation_id, run);
        return;
      }
      const previousConversationId = currentRunConversationIdRef.current;
      if (previousConversationId) {
        updateConversationLatestRun(previousConversationId, null);
        currentRunConversationIdRef.current = null;
      }
    },
    [],
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  const sendMessage = useCallback(
    async (options: SendMessageOptions) => {
      const {
        question,
        agent_id,
        conversation_id,
        modelId = "",
        completion_params = {},
        messageList = [],
        links = [],
        wikis = [],
        agentInfo,
        files = [],
        fileInfo,
        options: sendOptions = {},
        minimalParams = false,
        openclaw = false,
        openclawStartSeq = 0,
        openclawConversationTitle,
        skill,
        type = "",
        onMessageListChange,
        onOpenClawConversationResolved,
        onOpenClawEventSeqChange,
        knowledgeSource,
      } = options;

      if (openclaw && openClawStopPromiseRef.current) {
        return;
      }

      // ========== 清理上一次请求状态 ==========
      clearBuffer();
      const requestId = ++requestIdRef.current;
      openClawRequestRef.current = openclaw;
      messageListChangeRef.current = onMessageListChange || null;
      // 重置 latest-run 守护:本轮 sendMessage 内首次拿到 server 真实 message_id
      // 后才会触发一次 latest run 拉取并回填 currentRun(对齐 IndexChat 老版 latestRunFetchedRef)
      latestRunFetchedRef.current = false;

      if (openclaw && skill && conversationApi.ensureSkill) {
        const ensureResponse = await conversationApi.ensureSkill(skill);
        assertOpenClawSkillEnsureSucceeded(ensureResponse);
      }

      // ========== 场景标识 ==========
      const isFromWorkAI = type === "work-ai";
      const isAgentType = type === "agent";
      const hasFiles = files.length > 0;
      const linkLibraries = links.filter(link => link.islibrary)
      const linkSpaces = links.filter(link => link.isspace)
      const linkFiles = links.filter(link => !link.islibrary && !link.isspace)
      const hasLinkFiles = links.filter(link => !link.islibrary && !link.isspace).length > 0
      const hasLinkLibraries = linkLibraries.length > 0
      const hasLinkSpaces = linkSpaces.length > 0
      const networkSearch = knowledgeSource?.state?.networkSearch ?? false


      // ========== 1. 构建用户消息内容 ==========
      const formattedQuestion = openclaw ? question : formatQuestionWithSkill(question, skill);
      const userMessageContent: any[] = [{ type: "text", content: formattedQuestion }];
      const uploadedFiles: MessageFile[] = [];
      const specifiedFiles: SpecifiedFile[] = [];

      if (openclaw && hasFiles) {
        uploadedFiles.push(...(files as MessageFile[]));
      } else if (isAgentType && hasFiles) {
        // agent 场景：文件直接序列化
        userMessageContent.push(...files);
        uploadedFiles.push(...(files as MessageFile[]));
      } else if (hasFiles || hasLinkFiles) {
        // 其他场景：文件转为 file_id 格式
        files.forEach((file) => {
          const item = buildFileContent(file);
          if (item) userMessageContent.push(item);
        });
        uploadedFiles.push(...(files as MessageFile[]));

        // work-ai 场景：links 也用 upload_file_id 加入 user 消息
        links.forEach((file) => {
          const item = buildFileContent(file, isFromWorkAI);
          if (item) userMessageContent.push(item);
        });
      }

      // UI 展示用的 specified_files（含文件/知识库/空间）
      if (links.length > 0) {
        specifiedFiles.push(
          ...links.map((item) => ({
            id: item.id,
            name: item.name,
            icon: item.icon,
            library_id: item.library_id,
            ...(item.file_size && { file_size: item.file_size }),
            ...(item.file_mime && { file_mime: item.file_mime }),
            ...(item.islibrary !== undefined && { islibrary: item.islibrary }),
            ...(item.isspace !== undefined && { isspace: item.isspace }),
          }))
        );
      }

      // UI 展示用的 specified_files（动态知识）
  
      if (wikis.length > 0) {
        specifiedFiles.push(
          ...wikis.map((item) => ({
            id: item.id,
            name: item.title,
            icon: item.icon,
            type: 'wiki',
            space_id: item.space_id,
            ...(item.wikiType === 'space' && { isspace: true }),
            ...(item.wikiType === 'page' && { ispage: true }),
            ...(item.title && { title: item.title }),
            ...(item.slug && { slug: item.slug }),
          }))
        );
      }

      // ========== 2. 构建 API messages ==========
      const messages: any[] = [];

      // system prompt
      if (sendOptions.prompt) {
        messages.push({ content: sendOptions.prompt, role: "system" });
      }

      // specified_content
      if (sendOptions.text) {
        messages.push(buildSpecifiedContentInfo(sendOptions.text));
      }

      // specified_files（非 work-ai 场景）
    if (specifiedFiles.length) {
        messages.push(buildSpecifiedFilesInfo(specifiedFiles));
      }

      // user 消息
      const userContent = openclaw
        ? formattedQuestion
        : hasFiles || hasLinkFiles
          ? JSON.stringify(userMessageContent)
          : formattedQuestion;
      messages.push({ role: "user", content: userContent });

      // ========== 3. 创建 UI 消息对象 ==========
      const optimisticMessageId = Date.now().toString();
      const openClawInputFiles = openclaw ? buildOpenClawInputFileMetadata(files) : [];
      const openClawSkill = openclaw ? buildOpenClawSkillMetadata(skill) : undefined;
      const openClawRequestMetadata = openclaw
        ? {
            ...(openclawConversationTitle
              ? { openclaw_conversation_title: openclawConversationTitle }
              : {}),
            openclaw_client_message_id: optimisticMessageId,
            ...(openClawInputFiles.length > 0 ? { openclaw_input_files: openClawInputFiles } : {}),
            ...(openClawSkill ? { openclaw_skill: openClawSkill } : {}),
          }
        : undefined;
      const effectiveOpenClawStartSeq = openclaw
        ? Math.max(
            Number.isFinite(Number(openclawStartSeq)) ? Number(openclawStartSeq) : 0,
            getOpenClawMessageListMaxActivitySeq(messageList || [], conversation_id)
          )
        : 0;
      const newMessage: Message = {
        id: optimisticMessageId,
        role: "assistant",
        _openclawClientMessageId: openclaw ? optimisticMessageId : undefined,
        _openclawActiveRequestId: openclaw ? optimisticMessageId : undefined,
        question,
        answer: "",
        loading: true,
        agent_id: String(agent_id),
        conversation_id: String(conversation_id ?? ""),
        reasoning_content: "",
        reasoning_expanded: true,
        specified_files: specifiedFiles,
        uploaded_files: uploadedFiles,
        specified_content: sendOptions.text || "",
        skill: skill || { skill_name: "", display_name: "" },
        process_records: [],
        rag_stats: null,
        rag_search_text: "",
        rag_temp: { type: "rag_search" },
        knowledge_graph: knowledgeSource?.state?.knowledgeGraph ?? false,
        ...(openclaw ? { _openclawTurnStartSeq: effectiveOpenClawStartSeq } : {}),
        ...(openclaw
          ? {
              openclawTurn: createOpenClawTurnState({
                sessionId: String(conversation_id ?? ""),
                turnKey: buildOpenClawTurnKey({
                  sessionId: String(conversation_id ?? ""),
                  clientMessageId: optimisticMessageId,
                  messageId: optimisticMessageId,
                  turnStartSeq: effectiveOpenClawStartSeq,
                }),
                status: "streaming",
              }),
            }
          : {}),
      };

      currentMessageRef.current = newMessage;

      // 添加消息到列表
      onMessageListChange?.((list) => [...list, newMessage], newMessage);

      if (openclaw) {
        openClawTurnPhaseRef.current = "dispatching";
      }

      // ========== 4. 构建请求参数 ==========
      const model = `agent-${agent_id}${modelId ? `-${modelId}` : ""}`;
      const agentSettings = agentInfo?.settings_obj || agentInfo?.settings ||  {}
      const rerankConfig = agentSettings.rerank_config || {};
      const webSearchConfig = agentSettings.web_search_setting || {};

      const completionsPayload: ChatCompletionParams = minimalParams
        ? {
            conversation_id,
            model,
            messages,
            ...(openClawRequestMetadata ? { metadata: openClawRequestMetadata } : {}),
            frequency_penalty: 0,
            presence_penalty: 0,
            stream: true,
            temperature: 0,
            top_p: 0,
            ...completion_params,
          }
        : {
            conversation_id,
            model,
            messages,
            ...(openClawRequestMetadata ? { metadata: openClawRequestMetadata } : {}),
            enable_process_steps: true,
            frequency_penalty: 0,
            temperature: 0.5,
            top_p: 1,
            presence_penalty: 0,
            stream: true,
            // knowledgeSource.state 推导逻辑:
            // - networkSearch: 不使用知识库 (空数组)
            // - allKnowledge: 使用 ["all"]
            // - knowledgeGraph/wiki: 由 buildKnowledgeSourcePayload 处理，不影响 knowledge_base_ids
            knowledge_base_ids: (networkSearch)
              ? []
              : hasLinkLibraries
                ? linkLibraries.map(lib => String(lib.id))
                : (knowledgeSource?.state?.allKnowledge)
                  ? ["all"] : [],
            file_ids: hasLinkFiles ? linkFiles.map((item) => item.id) : [],
            space_ids: hasLinkSpaces ? linkSpaces.map(item => String(item.id)) : [],
            message_file_id: fileInfo?.id,
            solo_file_mode: !!fileInfo,
            search_config: {
              ...rerankConfig,
              top_k: (networkSearch)
                ? webSearchConfig.top_k || rerankConfig.top_k
                : rerankConfig.top_k,
            },
            // graph_search / web_search / wiki_search 统一走构建器,确保与 preview 行为一致
            // (graph/wiki 需要对应 agent 设置开关守卫;wikis 非空时附带 space_ids / wiki_page_ids)
            ...buildKnowledgeSourcePayload(
              {
                state: {
                  allKnowledge: Boolean(knowledgeSource?.state?.allKnowledge),
                  networkSearch,
                  knowledgeGraph: Boolean(knowledgeSource?.state?.knowledgeGraph),
                  wiki: Boolean(knowledgeSource?.state?.wiki),
                },
                graphEnabled: Boolean(agentSettings.graph_search_setting?.enable),
                webSearchEnabled: Boolean(agentSettings.web_search_setting?.enable),
                wikiEnabled: Boolean(agentSettings.wiki_search_setting?.enable),
                wikis: (wikis || []).map((w) => ({
                  id: String(w.id),
                  wikiType: w.wikiType,
                  ...(w.space_id != null && { space_id: String(w.space_id) }),
                })),
              },
              { webSearchConfig: webSearchConfig as Record<string, unknown> },
            ),
            ...completion_params,
          };

      // ========== 5. 发送请求 ==========
      abortControllerRef.current = new AbortController();
      let processedLength = 0;
      let lastUpdateTime = 0;
      let openClawConversationResolved = false;
      let openClawEventConversationId = "";
      let openClawEventTimer: ReturnType<typeof setTimeout> | null = null;
      let openClawEventPollingStopped = false;
      let openClawEventFetchInFlight = false;
      let openClawLastEventSeq = openclaw
        ? effectiveOpenClawStartSeq
        : 0;
      const UPDATE_INTERVAL = 100;
      const OPENCLAW_EVENT_POLL_INTERVAL = 800;
      const OPENCLAW_FINAL_RECONCILE_DELAYS = [0, 300, 900, 2500, 5500, 8500, 15000, 30000, 60000];
      const initialConversationId = String(conversation_id ?? "");

      const publishMessageList = (messageToPublish: Message = newMessage) => {
        onMessageListChange?.((list) => [...list], messageToPublish);
      };

      /**
       * 流式 chunk 处理后调用:仅当 message.id 已被 server 真实 id 覆盖
       * (不再是 optimisticMessageId),且本轮 sendMessage 内尚未触发 latest 时,
       * 拉一次 latest run 并显式覆盖 run.message_id,让 handleStop 时 cancel()
       * 能用 currentMessage.id 精确定位当前消息对应的 run。
       *
       * 对齐老 IndexChat.tsx 第 555-569 行 latestRunFetchedRef + run.message_id = newMessage.id
       * 的模式 —— 修复前在 await completions 之前同步触发 latest,此时流式尚未开始,
       * message.id 还是 optimistic(Date.now()),latest run 可能是上一条消息的 run,
       * run.message_id 与当前消息没有强绑定关系。
       */
      const ensureLatestRunFetched = () => {
        if (latestRunFetchedRef.current) return;
        if (!agentRun.enabled || openclaw) return;
        if (!hasConversationId(initialConversationId)) return;
        const message = currentMessageRef.current;
        if (!message?.id) return;
        // 关键守卫:只信任 server 真实返回的 message_id(乐观 ID 是 Date.now().toString() 形式,
        // 一旦 processStreamDataItem 写入 server message_id,就视为"已有真实 id")
        if (message.id === optimisticMessageId) return;
        const adapter = adapters?.agentRun;
        if (!adapter?.latest) return;

        latestRunFetchedRef.current = true;
        const messageIdAtFetch = message.id;
        adapter.latest(initialConversationId).then(({ run }) => {
          // 仅在请求未被覆盖、且 currentMessage 仍是同一条消息时回填,避免旧请求污染新消息
          if (requestId !== requestIdRef.current) return;
          if (!run) return;
          const currentMessage = currentMessageRef.current;
          if (currentMessage?.id && currentMessage.id !== messageIdAtFetch) return;
          run.message_id = messageIdAtFetch;
          agentRun.setCurrentRun(run);
          // 同步到 conversation store,让 ChatHistory 在历史列表里对这个会话显示 loading。
          // 只在 run 真实归属于当前消息时写,避免被中途被覆盖的旧请求污染 store。
          syncLatestRunToStore(run);
        }).catch(() => {});
      };

      const publishReconciledOpenClawMessage = (messageToPublish: Message, conversationId: string) => {
        onMessageListChange?.(
          (list) => mergeOpenClawActiveMessageIntoList([...list], messageToPublish, conversationId),
          messageToPublish
        );
      };

      const hydrateOpenClawEvents = async (
        conversationId: string,
        force = false,
        messageToHydrate?: Message
      ): Promise<boolean> => {
        if (!openclaw || (!conversationApi.events && !conversationApi.snapshot) || !conversationId) return false;
        if (!hasConversationId(conversationId) || isOpenClawPendingConversationId(conversationId)) return false;
        if (openClawEventFetchInFlight && !force) return false;
        const targetMessage = messageToHydrate || currentMessageRef.current;
        if (!targetMessage) return false;

        openClawEventFetchInFlight = true;
        try {
          const turnStartSeq = Number.isFinite(Number(targetMessage._openclawTurnStartSeq))
            ? Number(targetMessage._openclawTurnStartSeq)
            : 0;
          const requestAfterSeq = force ? turnStartSeq : openClawLastEventSeq;
          const response = conversationApi.snapshot
            ? await conversationApi.snapshot(conversationId, {
                ...(requestAfterSeq > 0 ? { after_seq: requestAfterSeq } : {}),
              })
            : await conversationApi.events!(conversationId, {
                limit: 100,
                ...(requestAfterSeq > 0 ? { after_seq: requestAfterSeq } : {}),
              });
          if (!force && (requestId !== requestIdRef.current || !currentMessageRef.current)) return false;

          const rawPayload = response?.data ?? response;
          const payload = force
            ? rawPayload
            : withOpenClawEventsAfterSeq(rawPayload, requestAfterSeq);
          if (!force && !hasOpenClawEventsAfterSeq(rawPayload, requestAfterSeq)) {
            return false;
          }
          const nextSeq = getOpenClawPayloadTimelineMaxSeq(payload);
          if (nextSeq > openClawLastEventSeq) {
            openClawLastEventSeq = nextSeq;
            onOpenClawEventSeqChange?.(conversationId, nextSeq);
          }
          const changed = force
            ? replaceOpenClawTurnWithTimelineEvents(targetMessage, payload, { canonicalOnly: true })
            : mergeOpenClawTimelineEventsIntoMessage(targetMessage, payload, { canonicalOnly: true });
          if (changed) {
            if (force) {
              publishReconciledOpenClawMessage(targetMessage, conversationId);
            } else {
              publishMessageList(targetMessage);
            }
          }
          return changed;
        } catch {
          // Event hydration is an enhancement for OpenClaw realtime UI. Chat streaming remains authoritative.
          return false;
        } finally {
          openClawEventFetchInFlight = false;
        }
      };

      const finishOpenClawLoadingIfReady = (
        messageToFinish: Message,
        conversationId: string
      ): boolean => {
        if (!messageToFinish.loading) return false;
        if (!hasOpenClawTerminalState(messageToFinish)) {
          return false;
        }
        messageToFinish.loading = false;
        publishReconciledOpenClawMessage(messageToFinish, conversationId);
        return true;
      };

      const reconcileFinalOpenClawEvents = async (conversationId: string, messageToReconcile: Message) => {
        for (const delayMs of OPENCLAW_FINAL_RECONCILE_DELAYS) {
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
          await hydrateOpenClawEvents(conversationId, true, messageToReconcile);
          finishOpenClawLoadingIfReady(messageToReconcile, conversationId);
        }
      };

      const finishOpenClawRequest = async (currentMessage: Message) => {
        const finalConversationId = String(currentMessage.conversation_id || openClawEventConversationId || "");
        if (!hasConversationId(finalConversationId)) {
          currentMessage.loading = false;
          publishMessageList(currentMessage);
          return;
        }
        if (!hasOpenClawTerminalState(currentMessage)) {
          currentMessage.loading = true;
        }
        await hydrateOpenClawEvents(finalConversationId, true, currentMessage);
        if (!hasOpenClawTerminalState(currentMessage)) {
          currentMessage.loading = true;
        }
        if (!finishOpenClawLoadingIfReady(currentMessage, finalConversationId)) {
          publishReconciledOpenClawMessage(currentMessage, finalConversationId);
        }
        void reconcileFinalOpenClawEvents(finalConversationId, currentMessage);
      };

      const scheduleOpenClawEventPolling = (conversationId: string) => {
        if (!openclaw || (!conversationApi.events && !conversationApi.snapshot)) return;
        if (!hasConversationId(conversationId) || isOpenClawPendingConversationId(conversationId)) return;

        openClawEventConversationId = conversationId;
        if (openClawEventPollingStopped || openClawEventTimer) return;

        openClawEventTimer = setTimeout(() => {
          openClawEventTimer = null;
          void hydrateOpenClawEvents(openClawEventConversationId).finally(() => {
            scheduleOpenClawEventPolling(openClawEventConversationId);
          });
        }, OPENCLAW_EVENT_POLL_INTERVAL);
      };

      const stopOpenClawEventPolling = () => {
        openClawEventPollingStopped = true;
        if (openClawEventTimer) {
          clearTimeout(openClawEventTimer);
          openClawEventTimer = null;
        }
      };

      const notifyOpenClawConversationResolved = () => {
        if (!openclaw || openClawConversationResolved || !currentMessageRef.current) return;
        const nextConversationId = String(currentMessageRef.current.conversation_id || "");
        if (!hasConversationId(nextConversationId)) return;
        if (isOpenClawPendingConversationId(nextConversationId)) return;
        if (nextConversationId === initialConversationId) return;

        openClawConversationResolved = true;
        scheduleOpenClawEventPolling(nextConversationId);
        onOpenClawConversationResolved?.(nextConversationId);
      };

      if (openclaw && hasConversationId(initialConversationId) && !isOpenClawPendingConversationId(initialConversationId)) {
        scheduleOpenClawEventPolling(initialConversationId);
      }

      setIsStreaming(true);
      try {
        // 保存最近使用记录（仅知识库 / 工作台 AI 场景，对齐旧版 useChatSend.ts:391-399）
        // openclaw 场景跳过：openclaw 通过自己的会话管理记录使用历史
        if (recentUsedApi && !openclaw && !isAgentType && links.length > 0) {
          const recentItems = links
            .map((link) => {
              const resourceType = (link as any).isspace ? 0 : link.islibrary ? 1 : 2;
              const resourceId = link.id ?? "";
              if (!resourceId) return null;
              return {
                resource_type: resourceType as 0 | 1 | 2,
                resource_id: resourceId,
              };
            })
            .filter((item): item is { resource_type: 0 | 1 | 2; resource_id: string | number } => item !== null);
          if (recentItems.length > 0) {
            // fire-and-forget：失败仅记录，不影响发送主流程
            recentUsedApi.save(recentItems).catch(() => {});
          }
        }

        // 注：原"在 await completions 之前同步触发 adapter.latest"已移除。
        // 旧实现的问题:此时流式尚未开始,message.id 还是 optimistic(Date.now()),
        // latest 拉回的 run.message_id 与当前消息没有强绑定关系,且与 handleStop
        // 时 cancel() 所需的 currentMessage.id 也对不上。
        // 现在改为在 onDownloadProgress 内 processStreamData 把 message.id 覆盖为
        // server 真实 id 后再触发(见 ensureLatestRunFetched),对齐老 IndexChat.tsx
        // 的 latestRunFetchedRef + run.message_id = newMessage.id 模式。

        await conversationApi.completions(completionsPayload, {
          responseType: "stream",
          onDownloadProgress: (e: any) => {
            // 检查请求是否已被新请求覆盖
            if (requestId !== requestIdRef.current) return;
            if (!currentMessageRef.current) return;

            processedLength = processStreamData(
              e,
              processedLength,
              currentMessageRef.current,
              networkSearch,
              formatRagStats,
              { openclaw, canonicalOnly: openclaw }
            );
            notifyOpenClawConversationResolved();

            // 流式 chunk 处理后:message.id 可能已被 server 真实 id 覆盖。
            // 若已覆盖且本轮 sendMessage 内尚未拉过 latest,补拉一次并覆盖 run.message_id
            // (对齐老 IndexChat.tsx 第 555-569 行的 latestRunFetchedRef 模式)。
            ensureLatestRunFetched();

            // 节流触发 React 重渲染
            const now = Date.now();
            if (now - lastUpdateTime >= UPDATE_INTERVAL && onMessageListChange) {
              lastUpdateTime = now;
              publishMessageList();
            }
          },
          signal: abortControllerRef.current.signal,
        });
      } catch (err: any) {
        // 旧请求被覆盖时静默忽略错误
        if (requestId !== requestIdRef.current) return;

        if (isCanceledError(err)) {
          return;
        }

        if (err.message !== "canceled") {
          const currentMessage = currentMessageRef.current;
          if (currentMessage && !currentMessage.answer) {
            currentMessage.answer = openclaw ? getOpenClawErrorMessage(err) : err.response?.data || "网络错误";
            currentMessage.error = true;
          }
        }
        throw err;
      } finally {
        // 只有当前请求才更新状态
        if (requestId === requestIdRef.current) {
          const currentMessage = currentMessageRef.current;
          stopOpenClawEventPolling();
          abortControllerRef.current = null;
          clearBuffer();
          setIsStreaming(false);
          if (openclaw && currentMessage) {
            void finishOpenClawRequest(currentMessage);
          } else if (currentMessage) {
            currentMessage.loading = false;
            if (onMessageListChange) publishMessageList(currentMessage);
          } else if (onMessageListChange) {
            publishMessageList();
          }
          // 流式自然结束时清掉 store 中对应会话的 latest_run,
          // 避免 ChatHistory 列表里的 spinner 一直挂着等 5s 轮询兜底。
          // openclaw 模式 ensureLatestRunFetched 早返回,ref 从未被写入,
          // syncLatestRunToStore(null) 内部判定 previousConversationId 为空,直接 no-op。
          if (agentRun.enabled) {
            syncLatestRunToStore(null);
          }
          if (openclaw) {
            openClawTurnPhaseRef.current = "idle";
          }
        }
      }
    },
    [conversationApi, processStreamData, clearBuffer, formatRagStats, syncLatestRunToStore]
  );

  /** 停止生成 */
  const handleStop = useCallback(() => {
    if (openClawStopPromiseRef.current) {
      return;
    }

    // 立即使当前流式请求失效，避免被 abort 的旧请求在 finally 中继续刷新 events
    // 或清理下一轮请求的 AbortController。
    requestIdRef.current += 1;

    const currentMessage = currentMessageRef.current;
    const currentPhase = openClawTurnPhaseRef.current;
      if (openClawRequestRef.current && currentMessage) {
        currentMessage.interrupted = true;
        currentMessage.error = false;
        currentMessage.loading = false;
        if (currentMessage.openclawTurn) {
          currentMessage.openclawTurn = {
            ...currentMessage.openclawTurn,
            status: "interrupted",
          };
        }
        if (!currentMessage.answer?.trim()) {
          currentMessage.answer = "本次运行已中断";
        }
      messageListChangeRef.current?.((list) => [...list], currentMessage);
    }

    if (currentPhase === "queued") {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      openClawRequestRef.current = false;
      currentMessageRef.current = null;
      openClawTurnPhaseRef.current = openClawStopPromiseRef.current ? "stopping" : "idle";
      clearBuffer();
      setIsStreaming(false);
      return;
    }

    const controlOpenClawConversation = conversationApi.control;
    const shouldStopRemoteOpenClawRequest =
      openClawRequestRef.current &&
      currentMessage &&
      hasConversationId(currentMessage.conversation_id) &&
      !isOpenClawPendingConversationId(currentMessage.conversation_id) &&
      controlOpenClawConversation;

    if (shouldStopRemoteOpenClawRequest) {
      let trackedStopPromise: Promise<void>;
      const remoteStopPromise = Promise.resolve(
        controlOpenClawConversation(String(currentMessage.conversation_id), { action: "stop" })
      )
        .catch(() => {
          // The local stream is still stopped below; the UI will surface the next status refresh/error if the remote stop fails.
        });
      trackedStopPromise = remoteStopPromise.finally(() => {
        if (openClawStopPromiseRef.current === trackedStopPromise) {
          openClawStopPromiseRef.current = null;
        }
        if (openClawTurnPhaseRef.current === "stopping") {
          openClawTurnPhaseRef.current = "idle";
        }
        setIsStopping(false);
      });
      openClawStopPromiseRef.current = trackedStopPromise;
      openClawTurnPhaseRef.current = "stopping";
      setIsStopping(true);
    }

    // AgentRun: 取消远程 run
    // 注：openclaw 模式不调 recover，currentRun 始终为 null，
    // 因此这里的判断天然排除 openclaw 场景。
    // 修复：sendMessage 中已通过 agentRun.latest() 异步回填 currentRun，
    // 此处 cancel 才能拿到 run_id 调用 agentRunApi.cancel(runId)。
    if (agentRun.enabled && currentMessage && agentRun.currentRun) {
      agentRun.cancel().catch(() => {});
    }
    // 取消后清理 currentRun，避免下次发送误用旧 run_id
    if (agentRun.enabled) {
      agentRun.setCurrentRun(null);
    }
    // 同步清掉 store 中对应会话的 latest_run,让 ChatHistory 的 spinner
    // 在用户主动 stop 时立刻消失(不等 5s 轮询兜底)。
    if (agentRun.enabled) {
      syncLatestRunToStore(null);
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    openClawRequestRef.current = false;
    currentMessageRef.current = null;
    if (!openClawStopPromiseRef.current) {
      openClawTurnPhaseRef.current = "idle";
    }
    clearBuffer();
    setIsStreaming(false);
  }, [clearBuffer, conversationApi, agentRun, syncLatestRunToStore]);

  /** 获取当前 AbortController */
  const getAbortController = useCallback(() => abortControllerRef.current, []);

  /**
   * 仅重置"运行中"前端状态,不做任何副作用(不 abort、不 cancel agent run、
   * 不调 controlOpenClawConversation)。用于"新建会话"路径:用户主动放弃当前会话
   * 上下文时,让 Sender 立即退出 loading 态、sendBlocked 归零、in-flight 流回调
   * 因 requestIdRef 自增而早返回,后续残留数据不会写回已清空的消息列表。
   *
   * 跟 handleStop 的区别:
   * - handleStop:取消一切(用户意图 = 停止当前生成)
   * - clearStreamingState:只重置 UI 状态(用户意图 = 切到新会话,底层请求让其自然结束)
   */
  const clearStreamingState = useCallback(() => {
    requestIdRef.current += 1;
    currentMessageRef.current = null;
    openClawStopPromiseRef.current = null;
    openClawTurnPhaseRef.current = "idle";
    openClawRequestRef.current = false;
    setIsStopping(false);
    setIsStreaming(false);
    clearBuffer();
  }, [clearBuffer]);

  return {
    sendMessage,
    handleStop,
    isStreaming,
    isStopping,
    getAbortController,
    clearStreamingState,
  };
}

export default useChatSend;
