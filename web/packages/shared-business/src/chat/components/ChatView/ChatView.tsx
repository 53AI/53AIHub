import { CloseOutlined } from "@ant-design/icons";
import { message as antdMessage, Modal, Spin } from "antd";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import type { IAgentInfo } from "../../adapters/types";
import {
	getOpenClawMessageListMaxActivitySeq,
	getOpenClawPayloadTimelineMaxSeq,
	mergeOpenClawActiveMessageIntoList,
	mergeOpenClawTimelineEventsIntoMessage,
	useChatMessages,
	useChatSend,
	useChatTimeout,
	useEmbedMode,
} from "../../hooks";
import {
	type IChatAdapters,
	useChatAdapters,
	useTranslation,
} from "../../i18n";
import { useConversationStore } from "../../stores";
import { setConversationApi } from "../../stores/conversation";
import type {
	ChunkItem,
	ConversationInfo,
	FileItem,
	Message,
	OpenClawActivityItem,
	OpenClawInteractionOption,
	Skill,
	SourceReferenceData,
} from "../../types";
import {
	isOpenClawConversationId,
	shouldStartOpenClawBlankConversation,
} from "../../utils/openclaw";
// 纯辅助函数已抽到 ../../utils/openclaw-chatview-helpers
// (以下 helper 只在 helpers 文件内部相互调用,不在 ChatView 中直接使用,
//  故未从该模块导入: collectOpenClawMessageIdentityCandidates,
// getOpenClawLedgerActiveRequestIdFromTimelineEvent, getOpenClawLedgerRunIdFromTimelineEvent,
// getOpenClawOptionKey, getOpenClawOptionValue, getOpenClawSnapshotTurnId,
// hasOpenClawRenderableFinalContent, readOpenClawString)
import {
	buildOpenClawInteractionControlPayload,
	buildOpenClawOptimisticConversationTitle,
	getLatestOpenClawMessageForConversation,
	getOpenClawAuthBlockedReason,
	getOpenClawLedgerTurnIdFromTimelineEvent,
	getOpenClawSnapshotActiveTurns,
	getOpenClawSnapshotRunningTurnIds,
	getOpenClawTerminalEvents,
	getOpenClawTimelineEvents,
	getOpenClawTimelineEventsAfterSeq,
	hasConversationId,
	isOpenClawActiveRecoveryMessage,
	isOpenClawCompletedRenderableMessage,
	isOpenClawNotFoundError,
	isOpenClawRunningActiveTurn,
	isOpenClawTerminalTimelineEvent,
	isOptimisticResolvedOpenClawConversation,
	markOpenClawInteractionResolved, openClawTimelineEventBelongsToMessage,
	openClawUserFileToOutputFile,
	readOpenClawTimelineEventSeq,
	summarizeOpenClawSnapshotPayload,
	syncConversationIdToUrl,
	withOpenClawEventsAfterSeq,
	withOpenClawTimelineEvents
} from "../../utils/openclaw-chatview-helpers";
import { rebaseOpenClawMessageConversation } from "../../utils/openclaw-timeline";
import {
	appendOpenClawEvents,
	createOpenClawTurnState,
	projectOpenClawTurn,
	syncOpenClawProjectionToMessage,
} from "../../utils/openclaw-turn";
import { ChatMessages } from "../ChatMessages";
import {
	ChatHistory,
	type ChatHistoryRef,
	CompletionView,
	LoadingState,
	MessageMenu,
	ShareHeader,
	SourceReferenceManager,
	type SourceReferenceManagerRef,
	UsageGuide,
} from "../index";
import ChatHeader from "./ChatHeader";
import ChatInput, { type SendData } from "./ChatInput";
// 默认值与 OpenClaw 常量已抽到 ./constants
import {
	CHAT_VIEW_DEFAULTS,
	OPENCLAW_CONVERSATION_INVALIDATED_EVENT,
	OPENCLAW_EVENT_EMPTY_BACKOFF_INTERVALS,
	OPENCLAW_EVENT_FAST_POLL_INTERVAL,
	OPENCLAW_EVENT_INITIAL_POLL_INTERVAL,
	OPENCLAW_MESSAGES_SYNC_POLL_INTERVAL,
	OPENCLAW_MESSAGE_HISTORY_FETCH_LIMIT,
	OPENCLAW_OPTIMISTIC_RESOLVED_VIRTUAL_ID,
	openClawOptimisticResolvedConversationIds,
} from "./constants";
import { useChatFeedback } from "./hooks/useChatFeedback";
import { useChatShareMode } from "./hooks/useChatShareMode";
import type { ChatViewProps, ChatViewRef } from "./types";

export const ChatView = forwardRef<ChatViewRef, ChatViewProps>(
	(
		{
			agentId,
			initialConversationId,
			syncToUrl = true,
			agentInfo: agentInfoProp,
			userAvatar,
			slots,
			renderHeader,
			history,
			newConversation,
			languageSwitcher,
			guide,
			welcome,
			fileUpload,
			agentRecommend,
			message,
			share,
			permission,
			feedback,
			openclaw,
			sendContext,
			timeout,
			boxClassName = "",
		},
		ref,
	) => {
		// Chunk 弹窗适配器（通过 ChatConfigProvider 注入）
		const chunkPopup = useChatAdapters()?.chunkPopup;
		const historyEnabled = history?.enabled ?? CHAT_VIEW_DEFAULTS.history.enabled;
		const newConversationEnabled =
			newConversation?.enabled ?? CHAT_VIEW_DEFAULTS.newConversation.enabled;
		const languageSwitcherEnabled =
			languageSwitcher?.enabled ?? CHAT_VIEW_DEFAULTS.languageSwitcher.enabled;
		const guideEnabled = guide?.enabled ?? CHAT_VIEW_DEFAULTS.guide.enabled;
		const messageShowMenu =
			message?.showMenu ?? CHAT_VIEW_DEFAULTS.message.showMenu;
		const welcomeShow = welcome?.show ?? CHAT_VIEW_DEFAULTS.welcome.show;
		const welcomeIndexLayout = welcome?.indexLayout ?? false;
		const fileUploadEnabled = fileUpload?.enabled ?? false;
		const shareEnabled = share?.enabled ?? false;
		const openclawEnabled = openclaw?.enabled ?? false;
		const openclawInputDisabled = openclaw?.inputDisabled ?? false;
		const openclawInputDisabledReason = openclaw?.inputDisabledReason;
		const openclawInitialConversationResolving =
			openclaw?.initialConversationResolving ?? false;
		const openclawSkipInitialLoad = openclaw?.skipInitialLoad ?? false;
		const agentRecommendShowRelatedScene =
			agentRecommend?.showRelatedScene ?? false;
		const resolvedMessage = {
			...(message ?? {}),
		};

		const chatAdapters = useChatAdapters();
		const { t, lang, setLang } = useTranslation();
		const embedMode = useEmbedMode();
		// unify-chat-adapters：原 usePluginAdapters() 已被并入 useChatAdapters()，
		// 局部别名 `adapters` 保留以避免改动下游 21 处 `adapters.conversationApi` / `adapters.agentApi` 引用。
		const adapters = chatAdapters as IChatAdapters &
			Required<Pick<IChatAdapters, "conversationApi" | "agentApi">>;

		const [agentInfo, setAgentInfo] = useState<IAgentInfo | null>(
			agentInfoProp || null,
		);
		// 如果 agentInfoProp 存在但 agent_id 未就绪，也需要等待加载完成。
		const [agentLoading, setAgentLoading] = useState(
			!agentInfoProp || agentInfoProp?.agent_id === "",
		);
		const [isResolvingConversation, setIsResolvingConversation] =
			useState(false);
		const [isInitialLoading, setIsInitialLoading] = useState(true);
		const [
			openClawStreamingConversationId,
			setOpenClawStreamingConversationId,
		] = useState<string | null>(null);
		// 通过 snapshot 轮询发现的"仍在运行"会话:刷新页面后远端 turn 还在跑、
		// 本地 SSE 早已断开,只有 snapshot 的 active_turns.status=running 能告诉我们。
		// 用于驱动 visibleIsStreaming / sendBlockedRef,让 Sender 切到 loading、Stop 按钮可点。
		const [openClawSnapshotRunning, setOpenClawSnapshotRunning] =
			useState(false);
		const agentMode = agentInfo?.custom_config_obj?.agent_mode;

		// Feedback 功能判断:
		//   - 前台 agent_usage 已知的:1 (KM_AI_SEARCH)、4 (WORK_AI) → 直接判定
		//   - 其他:由后台 backend_agent_type(agent_type)判定
		//     (0=对话 / 1=工作流 / 2=助理(含 openclaw / qclaw))
		//   - 与 openclaw 模式解耦:openclaw / qclaw 智能体也启用反馈,调 work_ai 的 config
		//   - 仅要求 feedback adapter 已注入
		//   - 上层 feedback.enabled 透传优先(例如 ChatContainer 禁用 openclaw 类型反馈),
		//     未传时回退到上述 agent_type 判断
		const isAssistantUsage =
			agentInfo?.agent_usage === 1 || agentInfo?.agent_usage === 4;
		const isAssistantBackend = agentInfo?.agent_type === 2; // openclaw / qclaw 等助理型智能体
		const isChatOrWorkflowBackend =
			agentInfo?.agent_type === 0 || agentInfo?.agent_type === 1;
		const feedbackFromAgentType =
			(isAssistantUsage || isAssistantBackend || isChatOrWorkflowBackend) &&
			Boolean(chatAdapters?.feedback);
		const feedbackEnabled = feedback?.enabled ?? feedbackFromAgentType;

		const currentConversationId = useConversationStore(
			(state) => state.current_conversationid,
		);
		const currentConversationAgentId = useConversationStore(
			(state) => state.current_agentid,
		);
		const loadConversations = useConversationStore(
			(state) => state.loadConversations,
		);
		const createConversation = useConversationStore(
			(state) => state.createConversation,
		);
		const addConversation = useConversationStore(
			(state) => state.addConversation,
		);
		const setCurrentState = useConversationStore(
			(state) => state.setCurrentState,
		);

		const {
			state: { messageList, hasMore, isLoadingMore, isLoadingMessages },
			loadMessageList,
			handleLoadListMore,
			updateMessageList,
			clearMessageList,
			recoverRunningMessage,
			isRecoveredRunning,
			clearRecoveredRunning,
		} = useChatMessages({
			limit: openclawEnabled ? OPENCLAW_MESSAGE_HISTORY_FETCH_LIMIT : 20,
			...(feedbackEnabled ? { loadFeedback: true } : {}),
		});

		// Feedback 业务逻辑(配置加载 + 5 个 handler + timeout 自清理)已抽到 ./hooks/useChatFeedback
		const { feedbackHandlers } = useChatFeedback({
			chatAdapters,
			agentUsage: agentInfo?.agent_usage,
			agentType: agentInfo?.agent_type,
			openclawEnabled,
			feedbackEnabled,
			updateMessageList,
		});

		const {
			sendMessage,
			handleStop,
			isStreaming,
			isStopping,
			clearStreamingState,
		} = useChatSend(adapters.conversationApi);

		const [inputValue, setInputValue] = useState("");
		const [showGuide, setShowGuide] = useState(false);
		const [openClawInitialMessageLoading, setOpenClawInitialMessageLoading] =
			useState(false);
		const [openClawStopReconcilePending, setOpenClawStopReconcilePending] =
			useState(false);
		const [openClawAuthBlockedReason, setOpenClawAuthBlockedReason] =
			useState("");
		const [openClawCachedHistoryTick, setOpenClawCachedHistoryTick] =
			useState(0);
		const [openClawSkillOptions, setOpenClawSkillOptions] = useState<Skill[]>(
			[],
		);
		const [selectedOpenClawSkill, setSelectedOpenClawSkill] =
			useState<Skill | null>(null);
		const historyRef = useRef<ChatHistoryRef>(null);
		const sourceRefManagerRef = useRef<SourceReferenceManagerRef>(null);
		const loadedConversationRef = useRef<string | number | null>(null);
		const skipNextLoadRef = useRef(false);
		// 标记是否是初始加载（刷新进入），用于 timeout 计算
		const isInitialLoadRef = useRef(true);
		const hasInitialLoadedRef = useRef(false);
		const messageListRef = useRef<Message[]>([]);
		const skipInitialConversationReloadRef = useRef<string | null>(null);
		const sendBlockedRef = useRef(false);
		const sendTurnRef = useRef(0);
		const openClawEventSeqRef = useRef<Record<string, number>>({});
		const openClawMessagesLoadingRef = useRef<Record<string, boolean>>({});
		const openClawCachedHistoryRef = useRef<Record<string, boolean>>({});
		const openClawFreshRevalidatedRef = useRef<Record<string, boolean>>({});
		const openClawActiveMessageRef = useRef<Record<string, Message>>({});
		const openClawSnapshotRecoveryMergedRef = useRef<Record<string, boolean>>(
			{},
		);
		const openClawStopReconcileConversationIdRef = useRef<string | null>(null);
		// 标记是否已经为当前 agentId 完成过首次会话初始化。
		// 修复:用户操作(切换会话/点击"新建")会通过 syncConversationIdToUrl 改变 URL,
		// 进而导致 initialConversationId prop 变化,使本 effect 重跑;
		// 重跑不应再重置 store、不应再 fallback 到"最新会话",
		// 否则会(1)重复触发 Load messages 效应多次请求 latest-run/messages,
		//    (2)新建后跳到最新会话,(3)URL 带 conversation_id 时仍被最新覆盖。
		const lastInitializedAgentIdRef = useRef<string | number | null>(null);
		const loadMessageListRef = useRef(loadMessageList);
		const mergeOpenClawActiveMessageForConversationRef = useRef<
			(conversationId: string | number) => void
		>(() => {});
		const mergeOpenClawPayloadIntoLatestMessageRef = useRef<
			(conversationId: string | number, payload: any) => boolean
		>(() => false);
		const updateOpenClawEventSeqFromMessagesRef = useRef<
			(conversationId: string | number, messages: Message[]) => void
		>(() => {});
		const openClawStopPending = Boolean(
			openclawEnabled && (isStopping || openClawStopReconcilePending),
		);
		const openClawAuthBlocked = Boolean(
			openclawEnabled && openClawAuthBlockedReason,
		);
		const translatedLoadingMessages = t("chat.loading_messages");
		const conversationLoadingReason = openclawEnabled
			? "加载消息..."
			: translatedLoadingMessages &&
					translatedLoadingMessages !== "chat.loading_messages"
				? translatedLoadingMessages
				: "加载消息...";
		const isInitialConversationResolving = Boolean(
			openclawEnabled && openclawInitialConversationResolving,
		);
		const isOpenClawRuntimeUnavailable = Boolean(
			openclawEnabled && openclawInputDisabled,
		);
		const isCurrentConversationForAgent =
			!hasConversationId(currentConversationId) ||
			String(currentConversationAgentId || "") === String(agentId);
		const isOpenClawConversationPendingLoad = Boolean(
			openclawEnabled &&
				isCurrentConversationForAgent &&
				!isInitialConversationResolving &&
				!isOpenClawRuntimeUnavailable &&
				hasConversationId(currentConversationId) &&
				loadedConversationRef.current !== currentConversationId &&
				!isOptimisticResolvedOpenClawConversation(currentConversationId),
		);
		const isOpenClawConversationMetadataResolving = Boolean(
			openclawEnabled &&
				(isInitialConversationResolving || isResolvingConversation),
		);
		const isConversationLoading =
			(!openclawEnabled && isResolvingConversation) ||
			isLoadingMessages ||
			openClawInitialMessageLoading ||
			isOpenClawConversationPendingLoad;
		const isInputConversationBlocked =
			isConversationLoading || isOpenClawConversationMetadataResolving;
		const visibleIsStreaming = openclawEnabled
			? openClawStopPending ||
				(isStreaming &&
					String(currentConversationId || "") ===
						String(openClawStreamingConversationId || "")) ||
				openClawSnapshotRunning
			: isStreaming || isRecoveredRunning;
		// work-ai 入口空态:把 welcome 元素统一放进同一 flex-none 容器居中堆叠
		const isWelcomeLayout =
			welcomeIndexLayout && messageList.length === 0 && !visibleIsStreaming;

		// Share mode state(打开/取消/全选/单选/创建链接)已抽到 ./hooks/useChatShareMode
		const { shareMode, selectMessageIds, selectAll, shareHandlers } =
			useChatShareMode({
				share,
				currentConversationId,
				messageList,
				t,
			});

		// Handle new conversation - define before useChatTimeout
		// 新建会话:仅重置前端"运行中"状态(Sender loading / sendBlocked / sendTurn /
		// isStreaming / isRecoveredRunning / currentMessageRef / openclaw turn phase),
		// 不调用 handleStop——避免取消底层 fetch、agent run、openclaw 远端 turn
		// (那些副作用由用户显式点"停止"或正常完成触发)。clearStreamingState 内部
		// bump requestIdRef,让 in-flight 流的回调早返回,不再污染已清空的消息列表。
		const handleNewConversation = useCallback(() => {
			clearStreamingState();
			clearRecoveredRunning();
			sendTurnRef.current += 1;
			sendBlockedRef.current = false;
			setCurrentState(agentId, 0);
			clearMessageList();
			loadedConversationRef.current = null;
			openClawCachedHistoryRef.current = {};
			openClawFreshRevalidatedRef.current = {};
			if (syncToUrl) syncConversationIdToUrl(agentId, 0, openclawEnabled);
		}, [
			clearStreamingState,
			clearRecoveredRunning,
			setCurrentState,
			agentId,
			clearMessageList,
			syncToUrl,
			openclawEnabled,
		]);

		// 历史会话切换:与 handleNewConversation 同构,目标会话改为入参 conv。
		// 清理顺序严格保持 — clearStreamingState 必须在 setCurrentState 之前,
		// 否则 ChatView "Load messages when conversation changes" effect
		// (ChatView.tsx "if (isStreaming && !openclawEnabled) return" 守卫)
		// 会因 isStreaming 仍为 true 而跳过加载,导致新会话消息永不显示。
		const handleSelectConversation = useCallback(
			(conv: ConversationInfo) => {
				clearStreamingState();
				clearRecoveredRunning();
				sendTurnRef.current += 1;
				sendBlockedRef.current = false;
				setIsInitialLoading(true);
				hasInitialLoadedRef.current = false;
				setCurrentState(conv.agent_id || 0, conv.conversation_id);
				clearMessageList();
				loadedConversationRef.current = null;
				openClawCachedHistoryRef.current = {};
				openClawFreshRevalidatedRef.current = {};
				if (syncToUrl)
					syncConversationIdToUrl(agentId, conv.conversation_id, openclawEnabled);
			},
			[
				clearStreamingState,
				clearRecoveredRunning,
				setCurrentState,
				setIsInitialLoading,
				agentId,
				clearMessageList,
				syncToUrl,
				openclawEnabled,
			],
		);

		const clearOpenClawInvalidConversation = useCallback(
			(conversationId: string | number, reason: string) => {
				if (!openclawEnabled || !hasConversationId(conversationId)) return;
				const targetConversationId = String(conversationId);
				delete openClawMessagesLoadingRef.current[targetConversationId];
				delete openClawCachedHistoryRef.current[targetConversationId];
				delete openClawFreshRevalidatedRef.current[targetConversationId];
				delete openClawActiveMessageRef.current[targetConversationId];
				delete openClawSnapshotRecoveryMergedRef.current[targetConversationId];
				delete openClawEventSeqRef.current[targetConversationId];
				loadedConversationRef.current = null;
				clearMessageList();
				setOpenClawInitialMessageLoading(false);
				setOpenClawAuthBlockedReason("");
				setCurrentState(agentId, 0);
				if (syncToUrl) syncConversationIdToUrl(agentId, 0, true);
				try {
					window.dispatchEvent(
						new CustomEvent(OPENCLAW_CONVERSATION_INVALIDATED_EVENT, {
							detail: {
								agentId: String(agentId),
								conversationId: targetConversationId,
								reason,
							},
						}),
					);
				} catch {
					// ignore browsers without CustomEvent construction support
				}
			},
			[agentId, clearMessageList, openclawEnabled, setCurrentState, syncToUrl],
		);

		useEffect(() => {
			if (!openclawEnabled) return;
			const state = useConversationStore.getState();
			if (!hasConversationId(state.current_conversationid)) return;
			if (String(state.current_agentid || "") === String(agentId)) return;
			loadedConversationRef.current = null;
			setOpenClawInitialMessageLoading(false);
			clearMessageList();
			setCurrentState(agentId, 0);
			if (syncToUrl) syncConversationIdToUrl(agentId, 0, true);
		}, [
			agentId,
			clearMessageList,
			openclawEnabled,
			setCurrentState,
			syncToUrl,
		]);

		// Openclaw 模式禁用 timeout（没有新建会话和历史功能）
		const timeoutEnabled = timeout ? timeout > 0 && !openclawEnabled : false;

		const { setLastMessageTime, resetTimer } = useChatTimeout({
			timeout: timeout || 0,
			enabled: timeoutEnabled,
			onTimeout: () => {
				Modal.warning({
					title: t("chat.timeout_title"),
					content: t("chat.timeout_message"),
					okText: t("chat.timeout_ok"),
					onOk: handleNewConversation,
				});
			},
		});

		// Initialize conversation API
		useEffect(() => {
			setConversationApi(adapters.conversationApi);
		}, [adapters.conversationApi]);

		useEffect(() => {
			if (!openclawEnabled) {
				setOpenClawSkillOptions([]);
				setSelectedOpenClawSkill(null);
				return;
			}

			const skillApi = chatAdapters?.skillApi;
			if (!skillApi?.listMySkills) {
				setOpenClawSkillOptions([]);
				return;
			}

			let disposed = false;
			const loadSkills = () => {
				skillApi
					.listMySkills()
					.then((skills: Skill[]) => {
						if (disposed) return;
						setOpenClawSkillOptions(
							(Array.isArray(skills) ? skills : []).filter(
								(skill: any) =>
									!skill.binding_status || skill.binding_status === "enabled",
							),
						);
					})
					.catch((err: unknown) => {
						console.warn("Failed to load OpenClaw skills:", err);
						if (!disposed) setOpenClawSkillOptions([]);
					});
			};

			loadSkills();

			const handleWindowFocus = () => {
				loadSkills();
			};
			window.addEventListener("focus", handleWindowFocus);

			return () => {
				disposed = true;
				window.removeEventListener("focus", handleWindowFocus);
			};
		}, [chatAdapters?.skillApi, openclawEnabled]);

		// Cleanup store on unmount
		useEffect(() => {
			return () => {
				// 清空会话状态
				useConversationStore.setState({
					conversations: [],
					current_agentid: 0,
					current_conversationid: 0,
					currentVirtualId: "",
				});
				openClawCachedHistoryRef.current = {};
				openClawFreshRevalidatedRef.current = {};
				openClawActiveMessageRef.current = {};
				openClawSnapshotRecoveryMergedRef.current = {};
				openClawEventSeqRef.current = {};
				// feedback success timeout 清理已迁移到 useChatFeedback 自身的 unmount effect
			};
		}, []);

		useEffect(() => {
			loadedConversationRef.current = null;
		}, [adapters.conversationApi, openclawEnabled]);

		// 切换智能体时重置初始加载状态
		useEffect(() => {
			setIsInitialLoading(true);
			hasInitialLoadedRef.current = false;
		}, [agentId]);

		// 切换会话时清掉上一会话残留的"snapshot 仍在运行"标记,避免跨会话脏标记
		useEffect(() => {
			setOpenClawSnapshotRunning(false);
		}, [currentConversationId]);

		useEffect(() => {
			messageListRef.current = messageList as Message[];
		}, [messageList]);

		useEffect(() => {
			sendBlockedRef.current =
				isStreaming ||
				isRecoveredRunning ||
				openClawStopPending ||
				openClawSnapshotRunning ||
				isInputConversationBlocked ||
				openClawAuthBlocked;
		}, [
			isStreaming,
			isRecoveredRunning,
			openClawStopPending,
			openClawSnapshotRunning,
			isInputConversationBlocked,
			openClawAuthBlocked,
		]);

		const canMergeOpenClawActiveSnapshots = useCallback(
			(previous: Message, next: Message) => {
				const previousClientId = String(
					previous._openclawClientMessageId || "",
				);
				const nextClientId = String(next._openclawClientMessageId || "");
				if (previousClientId && nextClientId)
					return previousClientId === nextClientId;

				const previousTurnKey = String(previous.openclawTurn?.turnKey || "");
				const nextTurnKey = String(next.openclawTurn?.turnKey || "");
				if (previousTurnKey && nextTurnKey)
					return previousTurnKey === nextTurnKey;

				if (previousClientId || nextClientId || previousTurnKey || nextTurnKey)
					return false;

				const previousId = String(previous.id || "");
				const nextId = String(next.id || "");
				if (previousId && nextId) return previousId === nextId;

				return false;
			},
			[],
		);

		const cacheOpenClawActiveMessage = useCallback(
			(message?: Message | null, fallbackConversationId?: string | number) => {
				if (!openclawEnabled || !message) return undefined;
				const conversationId = String(
					message.conversation_id || fallbackConversationId || "",
				);
				if (!hasConversationId(conversationId)) return undefined;
				if (message.interrupted && !message.loading) {
					delete openClawActiveMessageRef.current[conversationId];
					return undefined;
				}

				const snapshot: Message = {
					...message,
					conversation_id: conversationId,
					openclawActivities: message.openclawActivities
						? [...message.openclawActivities]
						: undefined,
					openclawTimelineItems: message.openclawTimelineItems
						? [...message.openclawTimelineItems]
						: undefined,
					process_records: message.process_records
						? [...message.process_records]
						: undefined,
					skillRunItems: message.skillRunItems
						? [...message.skillRunItems]
						: undefined,
				};

				const previous = openClawActiveMessageRef.current[conversationId];
				const nextSnapshot =
					previous && canMergeOpenClawActiveSnapshots(previous, snapshot)
						? {
								...previous,
								...snapshot,
								openclawTurn:
									previous.openclawTurn && snapshot.openclawTurn
										? appendOpenClawEvents(
												previous.openclawTurn,
												snapshot.openclawTurn.events || [],
											)
										: snapshot.openclawTurn || previous.openclawTurn,
							}
						: snapshot;

				if (nextSnapshot.openclawTurn) {
					syncOpenClawProjectionToMessage(
						nextSnapshot,
						projectOpenClawTurn(nextSnapshot.openclawTurn, {
							isStreaming: Boolean(nextSnapshot.loading),
							canonicalOnly: true,
						}),
					);
				}

				openClawActiveMessageRef.current[conversationId] = nextSnapshot;
				return nextSnapshot;
			},
			[canMergeOpenClawActiveSnapshots, openclawEnabled],
		);

		const mergeOpenClawActiveMessageForConversation = useCallback(
			(conversationId: string | number) => {
				if (!openclawEnabled || !hasConversationId(conversationId)) return;
				const activeMessage =
					openClawActiveMessageRef.current[String(conversationId)];
				if (!activeMessage) return;

				updateMessageList((list) => {
					const next = mergeOpenClawActiveMessageIntoList(
						list,
						activeMessage,
						conversationId,
					);
					messageListRef.current = next as Message[];
					return next;
				});
			},
			[openclawEnabled, updateMessageList],
		);

		const updateOpenClawEventSeqFromMessages = useCallback(
			(conversationId: string | number, messages: Message[]) => {
				if (
					!openclawEnabled ||
					!hasConversationId(conversationId) ||
					!Array.isArray(messages)
				)
					return;
				const targetConversationId = String(conversationId);
				const messageSeq = getOpenClawMessageListMaxActivitySeq(
					messages,
					targetConversationId,
				);
				openClawEventSeqRef.current[targetConversationId] = Math.max(
					openClawEventSeqRef.current[targetConversationId] || 0,
					messageSeq,
				);
			},
			[openclawEnabled],
		);

		const mergeOpenClawPayloadIntoLatestMessage = useCallback(
			(conversationId: string | number, payload: any) => {
				if (!openclawEnabled || !hasConversationId(conversationId))
					return false;
				const targetConversationId = String(conversationId);
				const events = getOpenClawTimelineEvents(payload);
				if (!events.length) return false;

				let merged = false;
				updateMessageList((list) => {
					if (
						String(
							useConversationStore.getState().current_conversationid || "",
						) !== targetConversationId
					) {
						return list;
					}
					const targetIndex = [...list]
						.reverse()
						.findIndex(
							(item) =>
								String(item.conversation_id || "") === targetConversationId,
						);
					if (targetIndex < 0) return list;

					const index = list.length - 1 - targetIndex;
					const next = [...list];
					const target = { ...next[index] } as Message;
					const scopedEvents = events.filter((event) =>
						openClawTimelineEventBelongsToMessage(event, target),
					);
					if (!scopedEvents.length) return list;
					const scopedPayload =
						scopedEvents.length === events.length
							? payload
							: withOpenClawTimelineEvents(payload, scopedEvents);
					const changed = mergeOpenClawTimelineEventsIntoMessage(
						target,
						scopedPayload,
						{ canonicalOnly: true },
					);
					if (!changed) return list;

					next[index] = target;
					cacheOpenClawActiveMessage(target, targetConversationId);
					messageListRef.current = next as Message[];
					merged = true;
					return next;
				});
				return merged;
			},
			[cacheOpenClawActiveMessage, openclawEnabled, updateMessageList],
		);

		const mergeOpenClawActiveTurnsFromSnapshot = useCallback(
			(conversationId: string | number, payload: any) => {
				if (!openclawEnabled || !hasConversationId(conversationId))
					return false;
				const targetConversationId = String(conversationId);
				const snapshotActiveTurns = getOpenClawSnapshotActiveTurns(payload);
				const runningActiveTurns = snapshotActiveTurns.filter(
					isOpenClawRunningActiveTurn,
				);
				const activeTurn = runningActiveTurns.sort(
					(left, right) =>
						Number(right?.last_seq || 0) - Number(left?.last_seq || 0),
				)[0];
				const activeTurnId = String(
					activeTurn?.turn_id || activeTurn?.turnId || "",
				);
				if (!activeTurn || !activeTurnId) return false;

				const activeRequestId = String(
					activeTurn.active_request_id ||
						activeTurn.activeRequestId ||
						activeTurnId,
				);
				const turnEvents = getOpenClawTimelineEvents(payload).filter(
					(event) => {
						const eventTurnId = getOpenClawLedgerTurnIdFromTimelineEvent(event);
						return eventTurnId === activeTurnId;
					},
				);

				let merged = false;
				updateMessageList((list) => {
					if (
						String(
							useConversationStore.getState().current_conversationid || "",
						) !== targetConversationId
					) {
						return list;
					}
					const targetIndex = [...list]
						.reverse()
						.findIndex(
							(item) =>
								String(item.conversation_id || "") === targetConversationId,
						);
					if (targetIndex < 0) {
						return list;
					}

					const index = list.length - 1 - targetIndex;
					const next = [...list];
					const target = { ...next[index] } as Message;
					const targetIdentity = String(
						target._openclawActiveRequestId ||
							target._openclawClientMessageId ||
							"",
					);
					if (
						targetIdentity &&
						activeRequestId &&
						targetIdentity !== activeRequestId &&
						!activeTurnId.includes(targetIdentity)
					) {
						return list;
					}
					if (isOpenClawCompletedRenderableMessage(target)) {
						// 已"completed"但 snapshot 显示同一 activeRequestId 仍在跑——
						// 通常是刷新页面后,本地消息保留了上一轮终态,但服务器为同 id 起了新一轮。
						// 此时以服务器为准:不跳过,把 loading 拉回 true,让 UI 重新进入 streaming。
						// 但仅在伴随增量事件时才清空老内容;否则空清空会让消息卡在 loading 空态。
						if (
							targetIdentity &&
							activeRequestId &&
							targetIdentity === activeRequestId &&
							turnEvents.length > 0
						) {
							// fallthrough: force-reopen with new events
						} else {
							return list;
						}
					}
					target.loading = true;
					target.error = false;
					target.interrupted = false;
					target._openclawActiveRequestId = activeRequestId;
					target._openclawClientMessageId =
						target._openclawClientMessageId || activeRequestId;
					const targetTurnKey = String(target.openclawTurn?.turnKey || "");
					// 检测是否属于"force-reopen"路径:目标消息本地已 completed,但服务器用同一
					// activeRequestId 又起了一轮。如果是,清掉上一轮的 answer / reasoning / 过程记录,
					// 否则新流开始后这些字段会和 projection 一起渲染,显示成"老内容 + 新 loading"。
					const isForceReopenCompleted =
						!target.loading &&
						targetIdentity !== "" &&
						activeRequestId !== "" &&
						targetIdentity === activeRequestId;
					if (isForceReopenCompleted) {
						target.answer = "";
						target.reasoning_content = "";
						target.process_records = [];
						target.skillRunItems = [];
						target.outputFiles = [];
						target.rag_temp = {};
						target.rag_stats = undefined;
						target.rag_search_text = "";
					}
					const shouldBindSnapshotTurn =
						!target.openclawTurn ||
						(targetTurnKey &&
							targetTurnKey !== activeTurnId &&
							!activeTurnId.includes(targetTurnKey));
					const streamingTurn = {
						...(shouldBindSnapshotTurn
							? createOpenClawTurnState({
									sessionId: targetConversationId,
									turnKey: activeTurnId,
									status: "streaming",
								})
							: (target.openclawTurn ??
								createOpenClawTurnState({
									sessionId: targetConversationId,
									turnKey: activeTurnId,
									status: "streaming",
								}))),
						status: "streaming" as const,
					};
					target.openclawTurn = streamingTurn;

					if (turnEvents.length) {
						mergeOpenClawTimelineEventsIntoMessage(
							target,
							{ events: turnEvents },
							{ canonicalOnly: true },
						);
					} else {
						syncOpenClawProjectionToMessage(
							target,
							projectOpenClawTurn(streamingTurn, {
								isStreaming: true,
								canonicalOnly: true,
							}),
						);
					}
					target.loading = true;

					next[index] = target;
					cacheOpenClawActiveMessage(target, targetConversationId);
					messageListRef.current = next as Message[];
					merged = true;
					return next;
				});
				return merged;
			},
			[cacheOpenClawActiveMessage, openclawEnabled, updateMessageList],
		);

		useEffect(() => {
			loadMessageListRef.current = loadMessageList;
			mergeOpenClawActiveMessageForConversationRef.current =
				mergeOpenClawActiveMessageForConversation;
			mergeOpenClawPayloadIntoLatestMessageRef.current =
				mergeOpenClawPayloadIntoLatestMessage;
			updateOpenClawEventSeqFromMessagesRef.current =
				updateOpenClawEventSeqFromMessages;
		}, [
			loadMessageList,
			mergeOpenClawActiveMessageForConversation,
			mergeOpenClawPayloadIntoLatestMessage,
			updateOpenClawEventSeqFromMessages,
		]);

		// Notify parent when ready (embed mode) - use embedMode.notifyReady()
		useEffect(() => {
			embedMode.notifyReady();
		}, [embedMode]);

		// Load agent info
		useEffect(() => {
			// If agentInfo is provided via prop, use it directly
			if (agentInfoProp) {
				setAgentInfo(agentInfoProp);
				if (agentInfoProp.agent_id !== undefined) {
					setAgentLoading(false);
				}
				return;
			}

			if (!agentId) {
				setAgentLoading(false);
				return;
			}

			setAgentLoading(true);
			adapters.agentApi
				.detail(agentId)
				.then((agent: IAgentInfo) => {
					if (openclawEnabled) {
						setOpenClawAuthBlockedReason("");
					}
					setAgentInfo(agent);
				})
				.catch((err) => {
					console.error("Failed to load agent:", err);
					if (openclawEnabled) {
						const reason = getOpenClawAuthBlockedReason(err);
						if (reason) setOpenClawAuthBlockedReason(reason);
					}
					setAgentInfo(null);
				})
				.finally(() => {
					setAgentLoading(false);
				});
		}, [agentId, agentInfoProp, adapters.agentApi, openclawEnabled]);

		// Initialize conversation when agent loaded
		useEffect(() => {
			if (isInitialConversationResolving) return;
			if (!agentId || agentLoading) return;
			if (
				openclawEnabled &&
				hasConversationId(initialConversationId) &&
				(skipInitialConversationReloadRef.current ===
					String(initialConversationId) ||
					isOptimisticResolvedOpenClawConversation(initialConversationId))
			) {
				skipInitialConversationReloadRef.current = null;
				return;
			}
			let cancelled = false;

			// Completion 模式不需要加载会话和消息
			if (agentMode === "completion") {
				if (!hasInitialLoadedRef.current) {
					hasInitialLoadedRef.current = true;
					setIsInitialLoading(false);
				}
				return;
			}

			const initConversation = async () => {
				setIsResolvingConversation(true);
				try {
					// 关键分支:非首次加载只同步 URL → store,不再重置 store / 选最新会话。
					// 首次加载(切换 agent 或首次挂载)走完整初始化逻辑。
					const isFirstLoadForAgent =
						lastInitializedAgentIdRef.current !== agentId;
					if (!isFirstLoadForAgent) {
						const currentStoreState = useConversationStore.getState();
						const urlConvId = initialConversationId
							? String(initialConversationId)
							: "";
						const storeConvId = String(
							currentStoreState.current_conversationid || "",
						);
						// 仅当 URL 明确指向另一个会话(外部 deep link / 浏览器前进后退)时才同步 store
						if (urlConvId && urlConvId !== storeConvId) {
							setCurrentState(agentId, initialConversationId!);
						}
						return;
					}

					// 先清空旧状态（包括 current_conversationid，防止触发旧会话的消息加载）
					if (!openclawEnabled) {
						useConversationStore.setState({
							conversations: [],
							current_conversationid: 0,
						});
					}
					if (!openclawEnabled || hasConversationId(initialConversationId)) {
						clearMessageList();
					}
					loadedConversationRef.current = null;

					if (initialConversationId) {
						setCurrentState(agentId, initialConversationId);
						await loadConversations(agentId);
					} else if (
						shouldStartOpenClawBlankConversation({
							openclaw: openclawEnabled,
							initialConversationId,
						})
					) {
						setCurrentState(agentId, 0);
						if (syncToUrl) syncConversationIdToUrl(agentId, 0, true);
						await loadConversations(agentId);
					} else if (openclawSkipInitialLoad) {
						// skipInitialLoad: 直接设置为空会话，显示欢迎页
						setCurrentState(agentId, 0);
						if (syncToUrl) syncConversationIdToUrl(agentId, 0, openclawEnabled);
						// 但仍然加载会话列表，用于历史面板
						await loadConversations(agentId);
					} else {
						const conversations = await loadConversations(agentId);
						if (cancelled) return;
						if (conversations.length > 0) {
							const latestConversationId = conversations[0].conversation_id;
							setCurrentState(agentId, latestConversationId);
							if (syncToUrl)
								syncConversationIdToUrl(
									agentId,
									latestConversationId,
									openclawEnabled,
								);
						} else {
							setCurrentState(agentId, 0);
						}
					}
					if (openclawEnabled) {
						setOpenClawAuthBlockedReason("");
					}
				} catch (err) {
					if (!cancelled) {
						console.error("Failed to load conversations:", err);
						if (openclawEnabled) {
							const reason = getOpenClawAuthBlockedReason(err);
							if (reason) setOpenClawAuthBlockedReason(reason);
							setCurrentState(
								agentId,
								hasConversationId(initialConversationId)
									? initialConversationId!
									: 0,
							);
						} else if (lastInitializedAgentIdRef.current !== agentId) {
							setCurrentState(agentId, 0);
						}
					}
				} finally {
					if (!cancelled) {
						setIsResolvingConversation(false);
						// 如果没有会话需要加载消息，结束初始加载状态
						const finalConversationId =
							useConversationStore.getState().current_conversationid;
						if (
							!hasConversationId(finalConversationId) &&
							!hasInitialLoadedRef.current
						) {
							hasInitialLoadedRef.current = true;
							setIsInitialLoading(false);
						}
					}
				}
			};

			initConversation().finally(() => {
				if (!cancelled) {
					lastInitializedAgentIdRef.current = agentId;
				}
			});
			return () => {
				cancelled = true;
			};
		}, [
			agentId,
			agentLoading,
			agentMode,
			initialConversationId,
			setCurrentState,
			loadConversations,
			clearMessageList,
			openclawSkipInitialLoad,
			openclawEnabled,
			isInitialConversationResolving,
			syncToUrl,
		]);

		// Load messages when conversation changes
		useEffect(() => {
			if (isInitialConversationResolving) return;
			// Completion 模式不需要加载消息
			if (agentMode === "completion") return;

			// 直接从 store 获取最新值，避免闭包问题
			const latestState = useConversationStore.getState();
			const latestConversationId = latestState.current_conversationid;

			if (
				openclawEnabled &&
				hasConversationId(latestConversationId) &&
				String(latestState.current_agentid || "") !== String(agentId)
			) {
				return;
			}

			if (!hasConversationId(latestConversationId)) {
				// Bug 3 修复:冷启动首屏渲染时,store.current_conversationid 还是 0(init effect 还没跑完),
				// 此时若 URL 明确带了 conversation_id=Y,绝不能 syncConversationIdToUrl(0) 把 URL 清掉 —
				// 那会触发 popstate → useSearchParams 重新解析 → initialConversationId 变 undefined,
				// init effect 走"选最新"分支,把 latest(Z) 写进 store 和 URL。
				// 正确做法:让 init effect 接管,本 effect 直接 return。
				if (
					hasConversationId(initialConversationId) &&
					lastInitializedAgentIdRef.current !== agentId
				) {
					return;
				}
				loadedConversationRef.current = null;
				if (openclawEnabled) {
					setOpenClawInitialMessageLoading(false);
				}
				// 注意：此处不设置 isInitialLoading = false
				// 因为会话初始化可能还没完成，由会话初始化 effect 的 finally 处理
				if (syncToUrl) syncConversationIdToUrl(agentId, 0, openclawEnabled);
				return;
			}

			if (skipNextLoadRef.current) {
				skipNextLoadRef.current = false;
				return;
			}

			if (isStreaming && !openclawEnabled) return;

			if (isOpenClawConversationId(latestConversationId) && !openclawEnabled) {
				return;
			}

			if (
				openclawEnabled &&
				isOptimisticResolvedOpenClawConversation(latestConversationId)
			) {
				loadedConversationRef.current = latestConversationId;
				setOpenClawInitialMessageLoading(false);
				if (
					String(initialConversationId || "") === String(latestConversationId)
				) {
					openClawOptimisticResolvedConversationIds.delete(
						String(latestConversationId),
					);
					useConversationStore.setState((state) => ({
						conversations: state.conversations.map((item: any) =>
							String(item?.conversation_id || "") ===
							String(latestConversationId)
								? { ...item, virtual_id: "" }
								: item,
						),
					}));
				}
				return;
			}

			if (loadedConversationRef.current === latestConversationId) return;
			loadedConversationRef.current = latestConversationId;

			if (syncToUrl)
				syncConversationIdToUrl(agentId, latestConversationId, openclawEnabled);

			const conversationId = String(latestConversationId);
			openClawMessagesLoadingRef.current[conversationId] = true;
			if (openclawEnabled) {
				setOpenClawInitialMessageLoading(true);
			}

			// 流程：
			// - agentRun 模式：recover → (内部)loadMessageList → onMessageLoaded → 完成
			// - 非 agentRun 模式：loadMessageList → 完成
			//
			// agentRun 模式下先调 recover（拉取 latest_run），recover 内部按需
			// 调用 loadMessageList 加载消息（带 isRunning/runningMessageId 标记
			// loading）。无论 isRunning 与否，消息只加载一次，没有重复请求。
			const finishInitialLoad = () => {
				delete openClawMessagesLoadingRef.current[conversationId];
				if (openclawEnabled) {
					setOpenClawInitialMessageLoading(false);
				}
				if (!hasInitialLoadedRef.current) {
					hasInitialLoadedRef.current = true;
					setIsInitialLoading(false);
				}
			};

			const handleMessageLoaded = (list: Message[]) => {
				if (openclawEnabled) {
					setOpenClawAuthBlockedReason("");
					const historyMeta = (list as any)?.openclawHistoryMeta;
					if (historyMeta?.source === "mirror") {
						openClawCachedHistoryRef.current[conversationId] = true;
						openClawFreshRevalidatedRef.current[conversationId] = false;
						setOpenClawCachedHistoryTick((tick) => tick + 1);
					} else if (historyMeta?.source === "openclaw") {
						openClawCachedHistoryRef.current[conversationId] = false;
					}
				}
				updateOpenClawEventSeqFromMessages(conversationId, list as Message[]);
				mergeOpenClawActiveMessageForConversation(latestConversationId);
				// openclaw 模式:初始消息列表加载完后,额外打一发 snapshot 探测 running 状态。
				// 解决"刷新页面后远端 turn 仍在跑,但 isStreaming=false、openClawActiveMessageRef 空,
				// 轮询 effect 早退不跑"导致 visibleIsStreaming 永远是 false 的问题。
				if (openclawEnabled && adapters.conversationApi.snapshot) {
					void adapters.conversationApi
						.snapshot(String(latestConversationId), { fresh: true })
						.then((response: any) => {
							const rawPayload = response?.data ?? response;
							const summary = summarizeOpenClawSnapshotPayload(rawPayload);
							if (
								String(
									useConversationStore.getState().current_conversationid || "",
								) !== String(latestConversationId)
							) {
								return;
							}
							if (summary.runningActiveTurns > 0) {
								setOpenClawSnapshotRunning(true);
								// 让轮询 effect 的 hasLocalActivity 在下一轮也保持 true,
								// 持续 catch up 增量事件。
								mergeOpenClawActiveTurnsFromSnapshot(
									String(latestConversationId),
									rawPayload,
								);
							} else {
								setOpenClawSnapshotRunning(false);
							}
						})
						.catch((err: any) => {
							const reason = getOpenClawAuthBlockedReason(err);
							if (reason) setOpenClawAuthBlockedReason(reason);
						});
				}
				// 初始加载（刷新进入）：用历史消息最后一条时间检查是否超时
				// 切换历史会话：不计时
				if (isInitialLoadRef.current && list && list.length > 0) {
					const lastMessage = list[list.length - 1];
					if (typeof lastMessage.updated_time === "number") {
						setLastMessageTime(lastMessage.updated_time);
					}
				}
				// 标记已完成初始加载
				isInitialLoadRef.current = false;
				finishInitialLoad();
			};

			if (!openclawEnabled && chatAdapters?.agentRun) {
				// agentRun 流程：先 recover，让 recover 内部按需 loadMessageList
				void recoverRunningMessage(conversationId, undefined, {
					onMessageLoaded: handleMessageLoaded,
				}).catch((err: any) => {
					if (openclawEnabled) {
						const reason = getOpenClawAuthBlockedReason(err);
						if (reason) setOpenClawAuthBlockedReason(reason);
					}
					console.error("Failed to recover running message:", err);
					finishInitialLoad();
				});
			} else {
				// 非 agentRun 流程：直接 loadMessageList
				loadMessageList(conversationId, (id, params) =>
					adapters.conversationApi.messages(id, params),
				)
					.then((list) => {
						handleMessageLoaded(list as Message[]);
					})
					.catch((err: any) => {
						if (openclawEnabled) {
							if (isOpenClawNotFoundError(err)) {
								clearOpenClawInvalidConversation(
									conversationId,
									"history.initial.not_found",
								);
								finishInitialLoad();
								return;
							}
							const reason = getOpenClawAuthBlockedReason(err);
							if (reason) setOpenClawAuthBlockedReason(reason);
						}
						console.error("Failed to load messages:", err);
						finishInitialLoad();
					});
			}
		}, [
			currentConversationId,
			loadMessageList,
			adapters.conversationApi,
			agentId,
			agentMode,
			setLastMessageTime,
			isStreaming,
			syncToUrl,
			openclawEnabled,
			isInitialConversationResolving,
			isOpenClawRuntimeUnavailable,
			clearOpenClawInvalidConversation,
			mergeOpenClawActiveMessageForConversation,
			updateOpenClawEventSeqFromMessages,
			recoverRunningMessage,
			chatAdapters?.agentRun,
		]);

		useEffect(() => {
			if (
				!openclawEnabled ||
				!isCurrentConversationForAgent ||
				isInitialConversationResolving ||
				isOpenClawRuntimeUnavailable ||
				isStreaming ||
				!hasConversationId(currentConversationId)
			) {
				return;
			}

			const conversationId = String(currentConversationId);
			const freshAgentKey = String(agentId);
			const isStillCurrentFreshLoad = () => {
				const state = useConversationStore.getState();
				return (
					String(state.current_agentid || "") === freshAgentKey &&
					String(state.current_conversationid || "") === conversationId
				);
			};
			if (!openClawCachedHistoryRef.current[conversationId]) return;
			if (openClawFreshRevalidatedRef.current[conversationId]) return;

			let cancelled = false;
			openClawFreshRevalidatedRef.current[conversationId] = true;

			void loadMessageList(
				conversationId,
				(id, params) =>
					adapters.conversationApi.messages(id, {
						...params,
						fresh: true,
					}),
				{ silent: true },
			)
				.then((list: any[]) => {
					if (cancelled || !isStillCurrentFreshLoad()) return;
					const historyMeta = (list as any)?.openclawHistoryMeta;
					if (historyMeta?.source === "openclaw") {
						openClawCachedHistoryRef.current[conversationId] = false;
						resolvedMessage.onSent?.();
					}
					updateOpenClawEventSeqFromMessages(conversationId, list as Message[]);
					mergeOpenClawActiveMessageForConversation(conversationId);
				})
				.catch((err: any) => {
					if (cancelled || !isStillCurrentFreshLoad()) return;
					if (isOpenClawNotFoundError(err)) {
						clearOpenClawInvalidConversation(
							conversationId,
							"history.fresh.not_found",
						);
						return;
					}
					openClawFreshRevalidatedRef.current[conversationId] = false;
					const reason = getOpenClawAuthBlockedReason(err);
					if (reason) setOpenClawAuthBlockedReason(reason);
				});

			return () => {
				cancelled = true;
			};
		}, [
			adapters.conversationApi,
			agentId,
			currentConversationId,
			openclawEnabled,
			isInitialConversationResolving,
			isOpenClawRuntimeUnavailable,
			isCurrentConversationForAgent,
			isStreaming,
			loadMessageList,
			clearOpenClawInvalidConversation,
			mergeOpenClawActiveMessageForConversation,
			openClawCachedHistoryTick,
			resolvedMessage.onSent,
			updateOpenClawEventSeqFromMessages,
		]);

		useEffect(() => {
			// 跨端同步交给 effect4(/messages?fresh=1 拉轮询)负责。
			// 本 effect 仅在"本地有需要 listen 的流/turn"时跑:
			// - isStreaming:本地 SSE 流推中,需要 catch up 事件
			// - openClawSnapshotRunning:snapshot 显示远端 turn 仍在跑(刷新页面后常见)
			// - openClawActiveMessageRef:该 conversation 有未消费的 active/running turn
			// idle(没活跃)期间早退,不再 idle 期间空跑 snapshot/events。
			const conversationIdForGuard = hasConversationId(currentConversationId)
				? String(currentConversationId)
				: "";
			const hasLocalActivity =
				isStreaming ||
				openClawSnapshotRunning ||
				(conversationIdForGuard !== "" &&
					openClawActiveMessageRef.current[conversationIdForGuard] != null);
			if (
				isInitialConversationResolving ||
				isOpenClawRuntimeUnavailable ||
				!openclawEnabled ||
				!isCurrentConversationForAgent ||
				!hasConversationId(currentConversationId) ||
				(!adapters.conversationApi.events &&
					!adapters.conversationApi.snapshot) ||
				!hasLocalActivity
			) {
				return;
			}

			const conversationId = String(currentConversationId);
			let stopped = false;
			let timer: ReturnType<typeof setTimeout> | null = null;
			let inFlight = false;
			let emptyPollCount = 0;

			const nextBackoffDelay = () => {
				const index = Math.min(
					emptyPollCount,
					OPENCLAW_EVENT_EMPTY_BACKOFF_INTERVALS.length - 1,
				);
				emptyPollCount += 1;
				return OPENCLAW_EVENT_EMPTY_BACKOFF_INTERVALS[index];
			};

			const resetFastDelay = () => {
				emptyPollCount = 0;
				return OPENCLAW_EVENT_FAST_POLL_INTERVAL;
			};

			updateOpenClawEventSeqFromMessagesRef.current(
				conversationId,
				messageListRef.current,
			);

			const poll = async () => {
				if (stopped || inFlight) return;
				inFlight = true;
				let nextDelay = OPENCLAW_EVENT_FAST_POLL_INTERVAL;
				let shouldContinue = true;
				try {
					if (openClawMessagesLoadingRef.current[conversationId]) {
						return;
					}
					const afterSeq = openClawEventSeqRef.current[conversationId] || 0;
					const response = adapters.conversationApi.snapshot
						? await adapters.conversationApi.snapshot(conversationId, {
								fresh: true,
								...(afterSeq > 0 ? { after_seq: afterSeq } : {}),
							})
						: await adapters.conversationApi.events?.(conversationId, {
								limit: 100,
								fresh: true,
								...(afterSeq > 0 ? { after_seq: afterSeq } : {}),
							});
					if (stopped || !response) return;

					const rawPayload = response?.data ?? response;
					const payload = adapters.conversationApi.snapshot
						? rawPayload
						: withOpenClawEventsAfterSeq(rawPayload, afterSeq);
					const events = getOpenClawTimelineEvents(payload);
					const newEvents = getOpenClawTimelineEventsAfterSeq(
						payload,
						afterSeq,
					);
					const nextSeq = getOpenClawPayloadTimelineMaxSeq(payload);
					const hasEvents = events.length > 0;
					const hasNewEvents = newEvents.length > 0 && nextSeq > afterSeq;
					const isSnapshotRecoveryPayload = Boolean(
						adapters.conversationApi.snapshot,
					);
					const snapshotActiveTurns =
						getOpenClawSnapshotActiveTurns(rawPayload);
					const runningActiveTurns = snapshotActiveTurns.filter(
						isOpenClawRunningActiveTurn,
					);
					const runningActiveTurnCount = runningActiveTurns.length;
					const runningActiveTurnIds =
						getOpenClawSnapshotRunningTurnIds(snapshotActiveTurns);
					const runningActiveLastSeqMax = runningActiveTurns.reduce(
						(max, turn) =>
							Math.max(max, Number(turn?.last_seq || turn?.lastSeq || 0) || 0),
						0,
					);
					const terminalEvents = getOpenClawTerminalEvents({
						events: newEvents,
					});
					const terminalEventTurnIds = terminalEvents
						.map(getOpenClawLedgerTurnIdFromTimelineEvent)
						.filter(Boolean);
					const hasTerminalEvent = terminalEvents.length > 0;
					const hasTerminalForRunningActiveTurn =
						runningActiveTurnIds.size > 0 &&
						terminalEventTurnIds.some((turnId) =>
							runningActiveTurnIds.has(turnId),
						);
					const hasUnscopedTerminalAtOrAfterRunningTurn =
						runningActiveTurnCount > 0 &&
						terminalEvents.some((event) => {
							if (getOpenClawLedgerTurnIdFromTimelineEvent(event)) return false;
							return (
								readOpenClawTimelineEventSeq(event) >= runningActiveLastSeqMax
							);
						});
					const activeRecoveryMessage =
						openClawActiveMessageRef.current[conversationId] ||
						getLatestOpenClawMessageForConversation(
							messageListRef.current,
							conversationId,
						);
					const hasTerminalForActiveRecoveryMessage =
						isOpenClawActiveRecoveryMessage(activeRecoveryMessage) &&
						terminalEvents.some((event) =>
							openClawTimelineEventBelongsToMessage(
								event,
								activeRecoveryMessage,
							),
						);
					const shouldStopForTerminal =
						hasTerminalEvent &&
						((!isSnapshotRecoveryPayload && runningActiveTurnCount === 0) ||
							hasTerminalForRunningActiveTurn ||
							hasUnscopedTerminalAtOrAfterRunningTurn ||
							hasTerminalForActiveRecoveryMessage);
					const restoredActiveTurn =
						adapters.conversationApi.snapshot &&
						runningActiveTurnCount > 0 &&
						!shouldStopForTerminal
							? mergeOpenClawActiveTurnsFromSnapshot(conversationId, rawPayload)
							: false;
					if (hasEvents) {
						nextDelay = hasNewEvents ? resetFastDelay() : nextBackoffDelay();
						openClawEventSeqRef.current[conversationId] = Math.max(
							openClawEventSeqRef.current[conversationId] || 0,
							nextSeq,
						);
						const shouldMergeRecoveryWindow =
							hasNewEvents ||
							!openClawSnapshotRecoveryMergedRef.current[conversationId];
						if (shouldMergeRecoveryWindow) {
							const merged = mergeOpenClawPayloadIntoLatestMessageRef.current(
								conversationId,
								payload,
							);
							if (merged || !hasNewEvents) {
								openClawSnapshotRecoveryMergedRef.current[conversationId] =
									true;
							}
						}
					} else {
						nextDelay = nextBackoffDelay();
					}
					if (restoredActiveTurn) {
						nextDelay = resetFastDelay();
					}

					// 同步"通过 snapshot 发现的 running 会话":运行中则置位,出现终态则清掉。
					// 必须在 visibleIsStreaming 计算所在 render 之前更新,否则刷新后第一帧
					// Sender / Stop 按钮无法进入 loading。
					if (
						adapters.conversationApi.snapshot &&
						String(
							useConversationStore.getState().current_conversationid || "",
						) === conversationId
					) {
						if (runningActiveTurnCount > 0 && !shouldStopForTerminal) {
							setOpenClawSnapshotRunning(true);
						} else if (shouldStopForTerminal || runningActiveTurnCount === 0) {
							setOpenClawSnapshotRunning(false);
						}
					}

					// result trace removed
					if (
						shouldStopForTerminal &&
						String(
							useConversationStore.getState().current_conversationid || "",
						) === conversationId
					) {
						const loaded = await loadMessageListRef.current(
							String(conversationId),
							(id, params) =>
								adapters.conversationApi.messages(id, {
									...params,
									fresh: true,
								}),
							{ silent: true },
						);
						if (Array.isArray(loaded)) {
							updateOpenClawEventSeqFromMessagesRef.current(
								conversationId,
								loaded as Message[],
							);
							if (loaded.length > 0) {
								delete openClawActiveMessageRef.current[conversationId];
							} else {
								mergeOpenClawPayloadIntoLatestMessageRef.current(
									conversationId,
									payload,
								);
								mergeOpenClawActiveMessageForConversationRef.current(
									conversationId,
								);
							}
						} else {
							mergeOpenClawPayloadIntoLatestMessageRef.current(
								conversationId,
								payload,
							);
							mergeOpenClawActiveMessageForConversationRef.current(
								conversationId,
							);
						}
						resolvedMessage.onSent?.();
						shouldContinue = false;
					}
				} catch (err: any) {
					// OpenClaw 运行态同步是展示增强；失败时不影响主聊天流程。
					nextDelay = nextBackoffDelay();
				} finally {
					inFlight = false;
					if (!stopped && shouldContinue) {
						timer = setTimeout(poll, nextDelay);
					}
				}
			};

			timer = setTimeout(poll, OPENCLAW_EVENT_INITIAL_POLL_INTERVAL);

			return () => {
				stopped = true;
				if (timer) {
					clearTimeout(timer);
				}
			};
		}, [
			adapters.conversationApi,
			currentConversationId,
			openclawEnabled,
			isCurrentConversationForAgent,
			isInitialConversationResolving,
			isOpenClawRuntimeUnavailable,
			isStreaming,
			openClawSnapshotRunning,
			mergeOpenClawActiveTurnsFromSnapshot,
			resolvedMessage.onSent,
		]);

		// 周期性 /messages?fresh=1 轮询(仅 openclaw,本地 send 期间暂停,结束后自动重启)。
		// 与 snapshot/events 轮询并存:本轮询负责把其他客户端(其他 tab / 设备)写入的新 turn
		// 拉回当前 UI,而 snapshot 轮询负责推送运行中的事件流。
		useEffect(() => {
			if (
				isInitialConversationResolving ||
				isOpenClawRuntimeUnavailable ||
				!openclawEnabled ||
				!isCurrentConversationForAgent ||
				isStreaming ||
				!hasConversationId(currentConversationId)
			) {
				return;
			}

			const conversationId = String(currentConversationId);
			let stopped = false;
			let timer: ReturnType<typeof setTimeout> | null = null;
			let inFlight = false;

			const poll = async () => {
				if (stopped || inFlight) return;
				inFlight = true;
				try {
					// 与 effect2 的 fresh-revalidate 互斥:
					// 当 openClawMessagesLoadingRef 已被该路径置 true 时本轮不再发,
					// 等下一拍再补。`finally` 仍排下一拍,保证不停摆。
					if (openClawMessagesLoadingRef.current[conversationId]) {
						return;
					}
					await loadMessageListRef.current(
						conversationId,
						(id, params) =>
							adapters.conversationApi.messages(id, {
								...params,
								fresh: true,
							}),
						{ silent: true },
					);
				} catch {
					// poll error 已沿 store 暴露给 UI；这里保持空以保持轮询节奏。
				} finally {
					inFlight = false;
					if (!stopped) {
						timer = setTimeout(poll, OPENCLAW_MESSAGES_SYNC_POLL_INTERVAL);
					}
				}
			};

			// 首次等满一个节拍再发,避免 mount race。
			timer = setTimeout(poll, OPENCLAW_MESSAGES_SYNC_POLL_INTERVAL);

			return () => {
				stopped = true;
				if (timer) clearTimeout(timer);
			};
		}, [
			adapters.conversationApi,
			currentConversationId,
			openclawEnabled,
			isCurrentConversationForAgent,
			isInitialConversationResolving,
			isOpenClawRuntimeUnavailable,
			isStreaming,
		]);

		// Reset timer on new conversation
		useEffect(() => {
			resetTimer();
		}, [currentConversationId, resetTimer]);

		// Format files for API
		const formatFiles = useCallback(
			(files: any[]) =>
				files?.map((item) => ({
					id: item.id,
					type: "image" as const,
					content: `file_id:${item.id}`,
					filename: item.name,
					size: item.size,
					mime_type: item.mime_type,
					url: item.url,
				})) || [],
			[],
		);

		// Handle send message
		const handleSend = useCallback(
			async (data: SendData | string, userFiles: any[] = []) => {
				const question =
					typeof data === "string"
						? data
						: data.textContent || data.pureTextContent || "";
				const files =
					typeof data === "string" ? userFiles : data.files || userFiles;
				// NEW: 透传 @ 提及与 / 技能(由 ChatContainer 按 agent_usage 注入的 sender 配置驱动)
				const atList = typeof data === "string" ? [] : data.atList;
				const skillList = typeof data === "string" ? [] : data.skillList;
				// 优先使用 selectedSkills(包含完整 skill_name 与 display_name),回退到 skillList 字符串数组
				const selectedSkills =
					typeof data === "string" ? [] : data.selectedSkills;
				// 合并 ChatContainer.sendContext.links 与 Sender atList(对齐原版 IndexChat.tsx 的 links 参数)
				// 场景:ChatContainer 维护了 selectedMentionLinks 但用户还没在 Sender 看到/触发它时,
				//     links 仍需正确传给 useChatSend 用于构建 messages.specified_files
				const senderLinks = Array.isArray(atList) ? atList : [];
				const contextLinks = Array.isArray(sendContext?.links)
					? sendContext.links
					: [];
				const links = contextLinks.length > 0 ? contextLinks : senderLinks;
				const hasSelectedSkills =
					Array.isArray(selectedSkills) && selectedSkills.length > 0;
				const skillName = hasSelectedSkills
					? selectedSkills[0].skill_name || selectedSkills[0].display_name || ""
					: Array.isArray(skillList) && skillList.length > 0
						? skillList[0]
						: "";
				const skillDisplayName = hasSelectedSkills
					? selectedSkills[0].display_name || skillName
					: Array.isArray(skillList) && skillList.length > 0
						? skillList[0]
						: "";
				const skillPayload = skillName
					? { skill_name: skillName, display_name: skillDisplayName }
					: undefined;

				if (openclawEnabled && openclawInputDisabled) return;
				if (
					!question.trim() ||
					sendBlockedRef.current ||
					openClawStopPending ||
					isInputConversationBlocked ||
					openClawAuthBlocked ||
					!agentId
				)
					return;

				// 权限检查
				if (permission?.checkAccess) {
					const hasPermission = await permission?.checkAccess(agentId);
					if (!hasPermission) {
						return;
					}
				}
				const sendTurn = ++sendTurnRef.current;
				sendBlockedRef.current = true;
				setInputValue("");

				let conversationId = openclawEnabled
					? useConversationStore.getState().current_conversationid
					: currentConversationId;
				// 安全解析 configs
				let configs: Record<string, any> = {};
				try {
					const configsRaw = agentInfo?.configs || "{}";
					configs =
						typeof configsRaw === "string"
							? JSON.parse(configsRaw)
							: configsRaw;
				} catch {
					console.warn("Failed to parse agent configs");
				}
				const completionParams = configs.completion_params || {};

				if (!hasConversationId(conversationId)) {
					if (openclawEnabled) {
						conversationId = "";
					} else {
						try {
							const conversation = await createConversation(agentId, question);
							addConversation({
								...conversation,
								virtual_id: Date.now().toString(),
							} as any);
							skipNextLoadRef.current = true;
							setCurrentState(agentId, conversation.conversation_id);
							conversationId = conversation.conversation_id;
						} catch (err) {
							console.error("Failed to create conversation:", err);
							return;
						}
					}
				} else if (openclawEnabled && syncToUrl) {
					syncConversationIdToUrl(agentId, conversationId, true);
				}

				const baselineMessageList = messageListRef.current;
				const requestConversationId = String(conversationId || "");
				const turnStartSeq = openclawEnabled
					? Math.max(
							openClawEventSeqRef.current[requestConversationId] || 0,
							getOpenClawMessageListMaxActivitySeq(
								baselineMessageList,
								requestConversationId,
							),
						)
					: 0;
				let activeOpenClawConversationId = requestConversationId;
				if (openclawEnabled && hasConversationId(requestConversationId)) {
					delete openClawActiveMessageRef.current[requestConversationId];
				}
				const getVisibleConversationId = () =>
					String(useConversationStore.getState().current_conversationid || "");
				const shouldUpdateVisibleConversation = () => {
					if (!openclawEnabled) return true;
					const visibleConversationId = getVisibleConversationId();
					if (!activeOpenClawConversationId && !visibleConversationId)
						return true;
					return visibleConversationId === activeOpenClawConversationId;
				};
				let resolvedOpenClawConversationId = "";
				const openclawConversationTitle = openclawEnabled
					? useConversationStore
							.getState()
							.conversations.find(
								(item) =>
									String(item.conversation_id) === requestConversationId,
							)?.title
					: undefined;
				if (openclawEnabled) {
					setOpenClawStreamingConversationId(requestConversationId);
				}

				try {
					// 业务参数透传:由 ChatContainer 按 agent_usage 注入的 sendContext 驱动
					// - knowledge (agent_usage=1): type / networkSearch / knowledgeGraph / library / modelId
					// - work-ai (agent_usage=4):   type / library / networkSearch / modelId
					// - 其他: 默认精简模式 (type="agent", minimalParams=true)
					const effectiveType = sendContext?.type ?? "agent";
					const effectiveMinimalParams = sendContext?.minimalParams ?? true;
					// 当 sendContext 提供 agentInfo 时,优先使用(携带 settings.web_search_setting 等)
					// 否则回退到 ChatView 内部的 agentInfo(保证 openclaw 等场景不被影响)
					const effectiveAgentInfo = sendContext?.agentInfo ?? agentInfo;

					await sendMessage({
						question,
						agent_id: agentId,
						conversation_id: openclawEnabled
							? conversationId || ""
							: conversationId || 0,
						modelId: sendContext?.modelId ?? "",
						completion_params: completionParams,
						messageList: baselineMessageList,
						links, // @ 提及列表(由 Sender atList 或 sendContext.links 合并)
						wikis: sendContext?.wikis,
						files: formatFiles(files),
						knowledgeSource: sendContext?.knowledgeSource,
						library: sendContext?.library,
						options: sendContext?.options, // specified_content / system prompt 注入
						skill: skillPayload, // / 技能(由 Sender 透传)
						agentInfo: effectiveAgentInfo,
						minimalParams: effectiveMinimalParams,
						openclaw: openclawEnabled,
						openclawStartSeq: turnStartSeq,
						openclawConversationTitle,
						type: effectiveType,
						onMessageListChange: (updater, updatedMessage) => {
							const cachedOpenClawMessage = cacheOpenClawActiveMessage(
								updatedMessage,
								activeOpenClawConversationId || requestConversationId,
							);
							if (!shouldUpdateVisibleConversation()) return;
							updateMessageList((list) => {
								const updated = updater(list);
								const next = openclawEnabled
									? mergeOpenClawActiveMessageIntoList(
											updated,
											cachedOpenClawMessage ||
												openClawActiveMessageRef.current[
													activeOpenClawConversationId
												],
											activeOpenClawConversationId || requestConversationId,
										)
									: updated;
								messageListRef.current = next as Message[];
								return next;
							});
						},
						onOpenClawConversationResolved: (resolvedConversationId) => {
							if (
								!openclawEnabled ||
								!hasConversationId(resolvedConversationId)
							)
								return;
							resolvedOpenClawConversationId = resolvedConversationId;
							activeOpenClawConversationId = resolvedConversationId;
							openClawOptimisticResolvedConversationIds.add(
								String(resolvedConversationId),
							);
							setOpenClawStreamingConversationId(resolvedConversationId);
							const pendingSnapshot =
								openClawActiveMessageRef.current[requestConversationId];
							if (
								pendingSnapshot &&
								requestConversationId !== resolvedConversationId
							) {
								delete openClawActiveMessageRef.current[requestConversationId];
								cacheOpenClawActiveMessage(
									rebaseOpenClawMessageConversation(
										pendingSnapshot as Message & {
											_openclawLastAnswerItemKey?: string;
										},
										resolvedConversationId,
										requestConversationId,
									),
									resolvedConversationId,
								);
							}
							openClawEventSeqRef.current[resolvedConversationId] = Math.max(
								openClawEventSeqRef.current[resolvedConversationId] || 0,
								turnStartSeq,
							);
							const numericAgentId = Number(agentId);
							const resolvedConversation = {
								conversation_id: resolvedConversationId,
								...(Number.isFinite(numericAgentId)
									? { agent_id: numericAgentId }
									: {}),
								title: buildOpenClawOptimisticConversationTitle(question),
								question,
								created_time: Date.now(),
								updated_time: Date.now(),
							};
							onOpenClawConversationResolved?.(resolvedConversation);
							addConversation({
								...resolvedConversation,
								virtual_id: OPENCLAW_OPTIMISTIC_RESOLVED_VIRTUAL_ID,
								top: 0,
								is_valid: 1,
							} as any);
							const visibleConversationId = getVisibleConversationId();
							const stillShowingStartedConversation =
								(!visibleConversationId && !requestConversationId) ||
								visibleConversationId === requestConversationId;
							if (!stillShowingStartedConversation) return;

							if (!hasConversationId(requestConversationId)) {
								skipInitialConversationReloadRef.current =
									resolvedConversationId;
							}
							skipNextLoadRef.current = true;
							loadedConversationRef.current = resolvedConversationId;
							setCurrentState(agentId, resolvedConversationId);
							if (syncToUrl)
								syncConversationIdToUrl(agentId, resolvedConversationId, true);
							updateMessageList((list) => {
								const next = list.map((item) =>
									String(item.conversation_id || "") === requestConversationId
										? rebaseOpenClawMessageConversation(
												item as Message & {
													_openclawLastAnswerItemKey?: string;
												},
												resolvedConversationId,
												requestConversationId,
											)
										: item,
								);
								messageListRef.current = next as Message[];
								return next;
							});
						},
						onOpenClawEventSeqChange: (conversationId, seq) => {
							if (!openclawEnabled || !hasConversationId(conversationId))
								return;
							openClawEventSeqRef.current[conversationId] = Math.max(
								openClawEventSeqRef.current[conversationId] || 0,
								seq,
							);
						},
					});
				} finally {
					if (sendTurnRef.current === sendTurn) {
						sendBlockedRef.current = false;
					}
					if (openclawEnabled && sendTurnRef.current === sendTurn) {
						setOpenClawStreamingConversationId(null);
					}
				}

				if (openclawEnabled && resolvedOpenClawConversationId) {
					loadConversations(agentId);
				}

				setLastMessageTime(Date.now());
				resolvedMessage.onSent?.();
			},
			[
				sendMessage,
				agentId,
				currentConversationId,
				agentInfo,
				updateMessageList,
				createConversation,
				addConversation,
				setCurrentState,
				formatFiles,
				setLastMessageTime,
				permission?.checkAccess,
				openclawEnabled,
				openClawAuthBlocked,
				openClawStopPending,
				isInputConversationBlocked,
				syncToUrl,
				loadConversations,
				cacheOpenClawActiveMessage,
				resolvedMessage.onSent,
				openclaw?.onConversationResolved,
			],
		);

		const reconcileOpenClawStopBoundary = useCallback(
			async (conversationId: string) => {
				if (!openclawEnabled || !hasConversationId(conversationId)) return;
				updateOpenClawEventSeqFromMessages(
					conversationId,
					messageListRef.current,
				);
				if (
					!adapters.conversationApi.events &&
					!adapters.conversationApi.snapshot
				)
					return;

				const afterSeq = openClawEventSeqRef.current[conversationId] || 0;
				try {
					const response = adapters.conversationApi.snapshot
						? await adapters.conversationApi.snapshot(conversationId, {
								fresh: true,
								...(afterSeq > 0 ? { after_seq: afterSeq } : {}),
							})
						: await adapters.conversationApi.events!(conversationId, {
								limit: 100,
								fresh: true,
								...(afterSeq > 0 ? { after_seq: afterSeq } : {}),
							});
					const rawPayload = response?.data ?? response;
					const payload = adapters.conversationApi.snapshot
						? rawPayload
						: withOpenClawEventsAfterSeq(rawPayload, afterSeq);
					const events = getOpenClawTimelineEvents(payload);
					const nextSeq = getOpenClawPayloadTimelineMaxSeq(payload);
					if (nextSeq > afterSeq) {
						openClawEventSeqRef.current[conversationId] = nextSeq;
					}
					if (!events.length) return;

					const terminalEvents = events.filter(isOpenClawTerminalTimelineEvent);
					if (terminalEvents.length) {
						if (
							String(
								useConversationStore.getState().current_conversationid || "",
							) !== conversationId
						) {
							delete openClawActiveMessageRef.current[conversationId];
							return;
						}

						const loaded = await loadMessageListRef.current(
							String(conversationId),
							(id, params) =>
								adapters.conversationApi.messages(id, {
									...params,
									fresh: true,
								}),
							{ silent: true },
						);
						if (Array.isArray(loaded)) {
							updateOpenClawEventSeqFromMessagesRef.current(
								conversationId,
								loaded as Message[],
							);
							if (loaded.length > 0) {
								delete openClawActiveMessageRef.current[conversationId];
							} else {
								mergeOpenClawPayloadIntoLatestMessageRef.current(
									conversationId,
									payload,
								);
								mergeOpenClawActiveMessageForConversationRef.current(
									conversationId,
								);
							}
						} else {
							mergeOpenClawPayloadIntoLatestMessageRef.current(
								conversationId,
								payload,
							);
							mergeOpenClawActiveMessageForConversationRef.current(
								conversationId,
							);
						}
						resolvedMessage.onSent?.();
						return;
					}

					mergeOpenClawPayloadIntoLatestMessageRef.current(
						conversationId,
						payload,
					);
					mergeOpenClawActiveMessageForConversationRef.current(conversationId);
				} catch (err: any) {
					const reason = getOpenClawAuthBlockedReason(err);
					if (reason) setOpenClawAuthBlockedReason(reason);
				}
			},
			[
				adapters.conversationApi,
				openclawEnabled,
				resolvedMessage.onSent,
				updateOpenClawEventSeqFromMessages,
			],
		);

		useEffect(() => {
			if (!openclawEnabled || !openClawStopReconcilePending || isStopping)
				return;

			const conversationId = openClawStopReconcileConversationIdRef.current;
			let cancelled = false;

			void (async () => {
				try {
					if (conversationId) {
						await reconcileOpenClawStopBoundary(conversationId);
					}
				} finally {
					if (!cancelled) {
						openClawStopReconcileConversationIdRef.current = null;
						setOpenClawStopReconcilePending(false);
					}
				}
			})();

			return () => {
				cancelled = true;
			};
		}, [
			openclawEnabled,
			isStopping,
			openClawStopReconcilePending,
			reconcileOpenClawStopBoundary,
		]);

		const handleStopStreaming = useCallback(() => {
			if (openClawStopPending) return;
			const stopConversationId = String(
				openClawStreamingConversationId || currentConversationId || "",
			);
			if (openclawEnabled && hasConversationId(stopConversationId)) {
				openClawStopReconcileConversationIdRef.current = stopConversationId;
				delete openClawActiveMessageRef.current[stopConversationId];
				updateOpenClawEventSeqFromMessages(
					stopConversationId,
					messageListRef.current,
				);
				setOpenClawStopReconcilePending(true);
				// 显式 stop 后,snapshot 轮询应当让出"仍在运行"标记,避免
				// reconcile 完成前 visibleIsStreaming 被反复回写为 true。
				setOpenClawSnapshotRunning(false);
			}
			sendTurnRef.current += 1;
			sendBlockedRef.current = true;
			handleStop();
		}, [
			currentConversationId,
			openclawEnabled,
			handleStop,
			openClawStopPending,
			openClawStreamingConversationId,
			updateOpenClawEventSeqFromMessages,
		]);

		const refreshOpenClawEventsOnce = useCallback(
			async (conversationId: string) => {
				if (
					!openclawEnabled ||
					(!adapters.conversationApi.events &&
						!adapters.conversationApi.snapshot) ||
					!hasConversationId(conversationId)
				) {
					return;
				}

				updateOpenClawEventSeqFromMessages(
					conversationId,
					messageListRef.current,
				);
				const afterSeq = openClawEventSeqRef.current[conversationId] || 0;
				const response = adapters.conversationApi.snapshot
					? await adapters.conversationApi.snapshot(conversationId, {
							fresh: true,
							...(afterSeq > 0 ? { after_seq: afterSeq } : {}),
						})
					: await adapters.conversationApi.events!(conversationId, {
							limit: 100,
							fresh: true,
							...(afterSeq > 0 ? { after_seq: afterSeq } : {}),
						});
				const rawPayload = response?.data ?? response;
				const payload = adapters.conversationApi.snapshot
					? rawPayload
					: withOpenClawEventsAfterSeq(rawPayload, afterSeq);
				const events = getOpenClawTimelineEvents(payload);
				const nextSeq = getOpenClawPayloadTimelineMaxSeq(payload);
				openClawEventSeqRef.current[conversationId] = Math.max(
					openClawEventSeqRef.current[conversationId] || 0,
					nextSeq,
				);
				if (!events.length) return;
				mergeOpenClawPayloadIntoLatestMessage(conversationId, payload);
			},
			[
				adapters.conversationApi,
				openclawEnabled,
				mergeOpenClawPayloadIntoLatestMessage,
				updateOpenClawEventSeqFromMessages,
			],
		);

		const handleOpenClawInteractionSubmit = useCallback(
			async (
				activity: OpenClawActivityItem,
				option: OpenClawInteractionOption,
				msg: Message,
			) => {
				if (!openclawEnabled || !adapters.conversationApi.control) return;
				const conversationId = String(
					activity.sessionId ||
						msg.conversation_id ||
						currentConversationId ||
						"",
				);
				if (!hasConversationId(conversationId)) {
					antdMessage.error("无法定位 WorkBuddy 会话");
					return;
				}

				const payload = buildOpenClawInteractionControlPayload(
					activity,
					option,
				);
				try {
					await adapters.conversationApi.control(conversationId, payload);
					updateMessageList((list) => {
						const next = list.map((item) =>
							item.id === msg.id
								? markOpenClawInteractionResolved(item as Message, activity.key)
								: item,
						);
						messageListRef.current = next as Message[];
						return next;
					});
					try {
						await refreshOpenClawEventsOnce(conversationId);
					} catch (err: any) {
						const reason = getOpenClawAuthBlockedReason(err);
						if (reason) setOpenClawAuthBlockedReason(reason);
					}
					antdMessage.success("已提交选择");
				} catch (err: any) {
					const reason = getOpenClawAuthBlockedReason(err);
					if (reason) setOpenClawAuthBlockedReason(reason);
					antdMessage.error(reason || "提交选择失败");
					throw err;
				}
			},
			[
				adapters.conversationApi,
				currentConversationId,
				openclawEnabled,
				refreshOpenClawEventsOnce,
				updateMessageList,
			],
		);

		// Handle suggestion click
		const handleSuggestion = useCallback(
			(content: string) => {
				handleSend(content);
			},
			[handleSend],
		);

		// Handle regenerate message
		const handleRegenerate = useCallback(
			(msg: Message) => {
				const question = msg.original_question || msg.question || "";
				if (!question.trim()) return;
				handleSend(question, msg.uploaded_files || []);
			},
			[handleSend],
		);

		const handleOpenClawUserFilePreview = useCallback(
			(file: FileItem) => {
				if (!openclawEnabled || !resolvedMessage.onPreviewOutputFile) return;
				resolvedMessage.onPreviewOutputFile(
					openClawUserFileToOutputFile(file),
					{
						id: `openclaw-input-file-${file.id}`,
						question: "",
						answer: "",
					} as Message,
				);
			},
			[openclawEnabled, resolvedMessage.onPreviewOutputFile],
		);

		// Handle history open
		const handleHistoryOpen = useCallback(() => {
			historyRef.current?.open();
		}, []);

		const handleLoadMoreMessages = useCallback(
			(done: () => void) => {
				if (!hasConversationId(currentConversationId)) {
					done();
					return;
				}
				handleLoadListMore(done, String(currentConversationId), (id, params) =>
					adapters.conversationApi.messages(
						id,
						openclawEnabled ? { ...params, fresh: true } : params,
					),
				);
			},
			[
				currentConversationId,
				handleLoadListMore,
				adapters.conversationApi,
				openclawEnabled,
			],
		);

		// Handle embed close - use embedMode.requestClose()
		const handleEmbedClose = useCallback(() => {
			embedMode.requestClose();
		}, [embedMode]);

		// Share mode handlers 已抽到 ./hooks/useChatShareMode 的 shareHandlers

		// 源引用相关回调 - 需要在顶层声明
		const handleSourceClick = useCallback(
			(source: ChunkItem, msg: Message) => {
				if (resolvedMessage.onSourceClick) {
					resolvedMessage.onSourceClick(source, msg);
					return;
				}
				sourceRefManagerRef.current?.handleSourceClick(source, msg);
			},
			[resolvedMessage.onSourceClick],
		);

		const handleOpenKnow = useCallback(
			(msg: Message) => {
				if (resolvedMessage.onOpenKnowledgePanel) {
					resolvedMessage.onOpenKnowledgePanel(msg);
					return;
				}
				antdMessage.info("查看知识库详情");
			},
			[resolvedMessage.onOpenKnowledgePanel],
		);

		const handleSourceReferenceClick = useCallback(
			(data: SourceReferenceData, msg: Message) => {
				sourceRefManagerRef.current?.handleSourceReferenceClick(data, msg);
			},
			[],
		);

		const renderSource = useCallback(
			({ type, number }: { type: string; number: number }) => {
				if (type === "web") return `${number}`;
				return `${type}-${number}`;
			},
			[],
		);

		const normalizeSkillItem = (skill: Skill & Record<string, any>) => ({
			...skill,
			id: String(
				skill.id ||
					skill.skill_id ||
					skill.skill_name ||
					skill.display_name ||
					skill.label ||
					"",
			),
			label: String(
				skill.label || skill.display_name || skill.skill_name || "",
			),
			display_name: skill.display_name || skill.label || skill.skill_name,
			skill_name: skill.skill_name || skill.name,
		});
		const openClawSenderSkill = openclawEnabled
			? {
					enabled: false, // 是否展示技能按钮
					suggestions: openClawSkillOptions.map((skill) =>
						normalizeSkillItem(skill as Skill & Record<string, any>),
					),
					list: selectedOpenClawSkill
						? [
								normalizeSkillItem(
									selectedOpenClawSkill as Skill & Record<string, any>,
								),
							]
						: [],
					onSelect: (skill: Skill & Record<string, any>) =>
						setSelectedOpenClawSkill(skill),
					onRemove: () => setSelectedOpenClawSkill(null),
					onOpenLibrary: chatAdapters?.skillApi?.openSkillLibrary,
				}
			: slots?.senderSkill;
		const showInitialSpinner =
			isInitialLoading || (openclawEnabled && isInitialConversationResolving);

		useImperativeHandle(ref, () => ({
			reload: () => {
				if (agentInfoProp) {
					setAgentInfo(agentInfoProp);
					setAgentLoading(false);
					return;
				}
				setAgentLoading(true);
				adapters.agentApi
					.detail(agentId)
					.then(setAgentInfo)
					.finally(() => setAgentLoading(false));
			},
			newConversation: handleNewConversation,
			selectConversation: handleSelectConversation,
			openHistory: handleHistoryOpen,
			showShare: shareHandlers.onOpenShare,
			sendMessage: (content: string) => {
				if (content?.trim()) {
					handleSend(content);
				}
			},
			setPrompt: (content: string) => {
				setInputValue(content);
			},
			updateMessage: (updater) => {
				updateMessageList((list) =>
					list.map((item) => {
						if (item.role !== "assistant") return item;
						return updater(item as Message);
					}),
				);
			},
		}));

		if (agentLoading) {
			return <LoadingState message={t("agent.loading")} />;
		}

		if (!agentId) {
			return <div></div>;
		}

		if (!agentInfo) {
			return <LoadingState message={t("agent.not_found")} />;
		}

		// If agent is completion mode, render CompletionView instead
		if (agentMode === "completion") {
			return (
				<CompletionView
					agentInfo={agentInfo}
					slots={{
						header: slots?.header,
					}}
					languageSwitcher={{ enabled: languageSwitcherEnabled }}
					guide={{ enabled: guideEnabled }}
					agentRecommend={{
						showRelatedScene: agentRecommendShowRelatedScene,
						onNavigateNext: agentRecommend?.onNavigateNext,
						onRefresh: agentRecommend?.onRefresh,
					}}
					permission={{ checkAccess: permission?.checkAccess }}
					completion={{ onComplete: resolvedMessage.onSent }}
				/>
			);
		}

		return (
			<div className="flex flex-col h-full bg-white">
				{/* Share Header */}
				{shareMode && shareEnabled && (
					<ShareHeader
						selectedCount={selectMessageIds.length}
						selectAll={selectAll}
						onSelectAll={shareHandlers.onSelectAll}
						onCreateShare={shareHandlers.onCreateShare}
						onCancel={shareHandlers.onCancelShare}
					/>
				)}

				{/* Header - 支持 slot 或默认，分享模式下隐藏 */}
				{!shareMode &&
					(renderHeader || slots?.header ? (
						(renderHeader || slots?.header)?.({
							agentInfo,
							lang,
							setLang,
							showGuide,
							onGuideChange: setShowGuide,
						})
					) : (
						<ChatHeader
							agentInfo={agentInfo}
							lang={lang}
							setLang={setLang}
							showGuide={showGuide}
							onGuideChange={setShowGuide}
							isEmbedMode={embedMode.isEmbedMode}
							onClose={handleEmbedClose}
							messageCount={messageList.length}
							onShare={shareHandlers.onOpenShare}
							features={{
								languageSwitcher: languageSwitcherEnabled,
								guide: guideEnabled,
								share: shareEnabled,
							}}
						/>
					))}

				{/* 消息区域容器 - 工作台入口布局无消息时居中 */}
				<div
					className={`flex-1 flex flex-col overflow-hidden ${isWelcomeLayout ? "items-center justify-center" : ""}`}
				>
					{/* 初始加载中 - 显示加载动画，隐藏消息列表和输入框 */}
					{showInitialSpinner && (
						<div className="flex-1 flex items-center justify-center">
							<Spin size="large" />
						</div>
					)}
					{/* ChatMessages - 工作台入口布局无消息时隐藏，初始加载时隐藏 */}
					{!showInitialSpinner &&
						!(
							welcomeIndexLayout &&
							messageList.length === 0 &&
							!visibleIsStreaming
						) && (
							<ChatMessages
								messageList={messageList as Message[]}
								agentInfo={agentInfo}
								userAvatar={userAvatar}
								isStreaming={visibleIsStreaming}
								features={{
									menu: {
										copy: true,
										regenerate: messageShowMenu,
										share: shareEnabled && !openclawEnabled,
										feedback: feedbackEnabled,
										addAsMd:
											messageShowMenu &&
											openclawEnabled &&
											Boolean(resolvedMessage.onSaveToKnowledge),
									},
								}}
								selection={{
									selectedMessageIds: selectMessageIds,
									selectAll,
									onSelect: (msg) => shareHandlers.onSelectMessage(msg.id),
									onSelectAll: shareHandlers.onSelectAll,
								}}
								agentRecommend={{
									showRelatedScene: agentRecommendShowRelatedScene,
									onNavigateNext: agentRecommend?.onNavigateNext,
									onRefresh: agentRecommend?.onRefresh,
								}}
								welcome={{ show: welcomeShow }}
								loadMore={{
									hasMore,
									isLoadingMore,
									isConversationLoading,
									onLoadMore: handleLoadMoreMessages,
								}}
								messageAction={{
									onSuggestionClick: handleSuggestion,
									onRegenerate: handleRegenerate,
									onShare:
										shareEnabled && !openclawEnabled
											? shareHandlers.onOpenShare
											: undefined,
									onAddAsMd: openclawEnabled
										? resolvedMessage.onSaveToKnowledge
										: undefined,
									// 反馈回调由 useChatFeedback 统一管理(配置加载 + 5 个 handler + timeout 自清理)。
									// 必须传入,否则 AssistantMessage 退化为内部硬编码状态,既不加载远程
									// feedbackConfig 也不调 createFeedback / updateFeedback / deleteFeedback。
									onFeedback: feedbackEnabled
										? feedbackHandlers.onFeedback
										: undefined,
									onFeedbackClose: feedbackEnabled
										? feedbackHandlers.onClose
										: undefined,
									onFeedbackToggle: feedbackEnabled
										? feedbackHandlers.onToggleOption
										: undefined,
									onFeedbackDescriptionChange: feedbackEnabled
										? feedbackHandlers.onDescriptionChange
										: undefined,
									onFeedbackSubmit: feedbackEnabled
										? feedbackHandlers.onSubmit
										: undefined,
								}}
								fileAction={{
									onClick:
										openclawEnabled && resolvedMessage.onPreviewOutputFile
											? handleOpenClawUserFilePreview
											: () => {},
									onPreview: resolvedMessage.onPreviewOutputFile,
									onFavorite: resolvedMessage.onOutputFileFavorite,
									onCheckFavorite: resolvedMessage.onOutputFileCheckFavorite,
								}}
								sourceAction={{
									onClick: handleSourceClick,
									onOpenKnow: handleOpenKnow,
									onReferenceClick: handleSourceReferenceClick,
								}}
								openclaw={{
									enabled: openclawEnabled,
									onInteractionSubmit: handleOpenClawInteractionSubmit,
								}}
								slots={{
									authTags: slots?.authTags,
									source: renderSource,
									messageMenu:
										!shareMode && messageShowMenu
											? (props) => (
													<MessageMenu
														type={props.type}
														content={
															props.type === "user"
																? props.message.question || ""
																: props.message.answer || ""
														}
														features={
															openclawEnabled
																? {
																		copy: true,
																		regenerate: props.type === "assistant",
																		share: false,
																		feedback: feedbackEnabled,
																		addAsFile: false,
																	}
																: {
																		copy: true,
																		regenerate: props.type === "assistant",
																		share: shareEnabled,
																		feedback: feedbackEnabled,
																		addAsFile:
																			props.type === "assistant" &&
																			Boolean(
																				resolvedMessage.onSaveToKnowledge,
																			),
																	}
														}
														feedbackType={
															props.type === "assistant"
																? props.message.feedback_type || ""
																: ""
														}
														onRegenerate={
															props.type === "assistant"
																? () => handleRegenerate(props.message)
																: undefined
														}
														onShare={
															!openclawEnabled && shareEnabled
																? shareHandlers.onOpenShare
																: undefined
														}
														onAddAsFile={
															!openclawEnabled &&
															props.type === "assistant" &&
															resolvedMessage.onSaveToKnowledge
																? () =>
																		resolvedMessage.onSaveToKnowledge!(
																			props.message,
																		)
																: undefined
														}
														onFeedback={
															feedbackEnabled && props.type === "assistant"
																? (type) =>
																		feedbackHandlers.onFeedback(
																			props.message,
																			type,
																		)
																: undefined
														}
													/>
												)
											: undefined,
								}}
								isShareMode={shareMode}
								t={t}
								boxClassName={boxClassName}
							/>
						)}
					{/* 源引用管理器 */}
					<SourceReferenceManager
						ref={sourceRefManagerRef}
						fetchChunkDetail={chunkPopup?.fetchChunkDetail}
						fetchWikiPageDetail={chunkPopup?.fetchWikiPageDetail}
						renderMarkdown={chunkPopup?.renderMarkdown}
						onOpenLibrary={chunkPopup?.onOpenLibrary}
					/>

					{/* 工作台入口欢迎布局 - 标题描述 + Sender + 下方扩展 + 推荐问题统一居中堆叠 */}
					{/* 对齐原版 chat.tsx:welcome 元素全部放进同一个 flex-none 容器,
					    整体居中。Sender 在 welcome 模式下需要禁用 sticky(!static),
					    否则会被父容器的 overflow-hidden 拉到视口底部,破坏居中布局。 */}
					{!shareMode && !showInitialSpinner && (
						<div
							className={
								isWelcomeLayout
									? `flex-none ${boxClassName || "w-11/12 lg:w-4/5 max-w-[1200px] mx-auto"}`
									: ""
							}
						>
							{isWelcomeLayout && (
								<>
									<h2 className="text-2xl text-center">
										{agentInfo?.name || ""}
									</h2>
									{agentInfo?.settings_obj?.opening_statement && (
										<p className="text-base text-[#666666] text-center mt-3 mb-9 whitespace-pre-wrap max-h-52 overflow-y-auto">
											{agentInfo.settings_obj.opening_statement}
										</p>
									)}
								</>
							)}
							<ChatInput
								inputValue={inputValue}
								onChange={setInputValue}
								onSend={handleSend}
								onStop={handleStopStreaming}
								isStreaming={visibleIsStreaming}
								slots={{
									leftButtons: slots?.agentSelector
										? () =>
												slots.agentSelector!({
													agentInfo,
													onSelect: (agent) => {
														if (syncToUrl) {
															const url = new URL(window.location.href);
															url.searchParams.set(
																"agent_id",
																String(agent.agent_id),
															);
															url.searchParams.delete("conversation_id");
															window.location.href = url.toString();
														}
													},
												})
										: undefined,
									// NEW: 透传 Sender 内部 slot(merge senderSlots 与 extrasLeft)
									renderLeftExtras: slots?.senderLeftExtras,
									senderSlots: slots?.senderSlots,
									senderPlaceholder: slots?.senderPlaceholder,
								}}
								// NEW: 透传 mention / skill / actionPosition
								mention={slots?.senderMention}
								skill={openClawSenderSkill}
								actionPosition={slots?.senderActionPosition}
								history={{
									enabled: historyEnabled,
									onOpen: handleHistoryOpen,
								}}
								newConversation={{
									enabled: newConversationEnabled,
									onCreate: handleNewConversation,
								}}
								fileUpload={{
									enabled: fileUploadEnabled,
									enableDrag: fileUpload?.enableDrag ?? false,
									allowMultiple:
										fileUpload?.allowMultiple ??
										CHAT_VIEW_DEFAULTS.fileUpload.allowMultiple,
									allowSendWithFiles:
										fileUpload?.allowSendWithFiles ?? false,
									enablePaste: fileUpload?.enablePaste ?? false,
									acceptTypes: fileUpload?.acceptTypes,
									maxFileSize: fileUpload?.maxFileSize,
									request: fileUpload?.request,
								}}
								inputState={{
									disabled:
										isInputConversationBlocked ||
										openClawStopPending ||
										openClawAuthBlocked ||
										Boolean(openclawEnabled && openclawInputDisabled),
									stopDisabled: isConversationLoading || openClawStopPending,
									disabledReason: openClawAuthBlocked
										? openClawAuthBlockedReason
										: isInputConversationBlocked
											? conversationLoadingReason
											: openclawInputDisabledReason,
								}}
								placeholder={
									openClawAuthBlocked
										? openClawAuthBlockedReason
										: isInputConversationBlocked
											? conversationLoadingReason
											: openclawEnabled &&
													openclawInputDisabled &&
													openclawInputDisabledReason
												? openclawInputDisabledReason
												: openclawEnabled
													? "请输入你的需求，按「Enter」发送"
													: t("chat.input_placeholder")
								}
								boxClassName={isWelcomeLayout ? "!static" : boxClassName}
							/>
							{isWelcomeLayout && slots?.senderBelowExtras && (
								<div className="mt-2">{slots.senderBelowExtras}</div>
							)}
							{isWelcomeLayout &&
								agentInfo?.settings_obj?.suggested_questions?.some(
									(item: any) => item?.content?.trim(),
								) && (
									<>
										<div className="text-sm text-[#1D1E1F] mt-10 mb-3">
											{t("chat.suggested_questions")}
										</div>
										<div className="grid grid-cols-4 gap-3">
											{agentInfo.settings_obj.suggested_questions.map(
												(item, index) => (
													<div
														key={item.id || index}
														className="py-3 px-5 rounded-xl border border-[#E6E8EB] cursor-pointer hover:bg-[#F2F3F5] transition-all"
														onClick={() =>
															handleSuggestion(item.content || "")
														}
													>
														<span className="text-sm text-[#6B7280] line-clamp-2">
															{item.content}
														</span>
													</div>
												),
											)}
										</div>
									</>
								)}
						</div>
					)}
				</div>

				{/* Copyright */}
				{!shareMode && slots?.copyright?.()}

				<ChatHistory
					ref={historyRef}
					onNew={handleNewConversation}
					onSelect={handleSelectConversation}
					title={openclawEnabled ? "OpenClaw 历史会话" : undefined}
					showCreate={newConversationEnabled}
					showItemActions={!openclawEnabled}
				/>

				{showGuide && guideEnabled && (
					<div className="fixed inset-0 z-20 bg-white overflow-hidden">
						<div className="h-[70px] flex items-center justify-center border-b relative">
							<h4 className="text-lg text-[#1F2123]">
								{t("chat.usage_guide")}
							</h4>
							<div
								className="flex items-center justify-center size-6 absolute right-2 top-1/2 -translate-y-1/2 rounded cursor-pointer hover:bg-[#ECEDEE]"
								onClick={() => setShowGuide(false)}
							>
								<CloseOutlined />
							</div>
						</div>
						<UsageGuide useCases={agentInfo?.use_cases} />
					</div>
				)}
			</div>
		);
	},
);

ChatView.displayName = "ChatView";

export default ChatView;
