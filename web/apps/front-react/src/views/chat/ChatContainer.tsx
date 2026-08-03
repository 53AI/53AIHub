import {
	CloseOutlined,
	DownOutlined,
	LeftOutlined,
	UpOutlined,
} from "@ant-design/icons";
import { isOpenClawCompatibleChannelType } from "@km/shared-business/agent-create";
import {
	ChatConfigProvider,
	ChatHistory,
	ChatView,
	type ChatViewRef,
	getOpenClawPayload,
	getOutputFileDownloadStrategy,
	hasConversationId,
	type KnowledgePanelData,
	type Message,
	type OutputFile,
	type SendContext,
	shouldUseOpenClawChatAdapter,
	syncConversationIdToUrl,
	UsageGuide,
	useConversationStore as useSharedChatConversationStore,
} from "@km/shared-business/chat";
import { Setting } from "./components/Setting/Setting";
import { SvgIcon } from "@km/shared-components-react";
import { eventBus } from "@km/shared-utils";
import { Button, message, Popover, Tooltip } from "antd";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
	buildOpenClawConversation,
	chatAdapters,
	createOpenClawConversationApiAdapter,
} from "@/adapters/chat-adapters";
import { API_HOST } from "@/api/host";
import favoritesApi from "@/api/modules/favorites";
import mySpaceApi from "@/api/modules/my-space";
import openclawApi, { type OpenClawSession } from "@/api/modules/openclaw";
import { sharesApi } from "@/api/modules/share";
import uploadApi from "@/api/modules/upload";
import AuthTagGroup from "@/components/AuthTagGroup";
import { ThinkKnowledge, type ThinkKnowledgeRef } from "@/components/Chat";
import AddAnswerAsMd, {
	type AddAnswerAsMdRef,
} from "@/components/Chat/AddAnswerAsMd";
import FileViewer from "@/components/FileViewer";
import { ExpandSidebarButton } from "@/components/Layout/ExpandSidebarButton";
import MoreDropdown from "@/components/MoreDropdown";
import { VERSION_MODULE } from "@/constants/enterprise";
import { EVENT_NAMES } from "@/constants/events";
import { t } from "@/locales";
import { useAgentStore, useCurrentAgent } from "@/stores/modules/agent";
import { useConversationStore } from "@/stores/modules/conversation";
import {
	useEnterpriseStore,
	useIsSoftStyle,
} from "@/stores/modules/enterprise";
import { useNavigationStore } from "@/stores/modules/navigation";
import { useShortcutsStore } from "@/stores/modules/shortcuts";
import { useSkillsStore } from "@/stores/modules/skills";
import { useUserStore } from "@/stores/modules/user";
import { getPublicPath } from "@/utils/config";
import {
	checkLoginStatus,
	checkPermission as checkUserPermission,
	checkPermissionAsync as checkUserPermissionAsync,
} from "@/utils/permission";
import { buildKnowledgeFileUrl, buildUrl } from "@/utils/router";
import { checkVersion } from "@/utils/version";
import AgentTooltip from "./components/AgentTooltip";
import OpenClawPanel from "./components/OpenClawPanel";
import "./openclaw-embedded.css";
import type { FileItem } from "@/api/modules/files/types";
import type { LibraryItem } from "@/api/modules/libraries";
import type { SpaceItem } from "@/api/modules/spaces";
import { MyFilesDialog } from "@/components/MyFilesDialog/dialog";
import type { MyFilesDialogRef } from "@/components/MyFilesDialog/types";
import SpaceDialog, { type SpaceDialogRef } from "@/components/Space/dialog";
import { AGENT_USAGES } from "@/constants/agent";
import {
	getNextOpenClawHistoryVisibleCount,
	getOpenClawHistoryScrollAction,
	getOpenClawHistoryVisibleCountForSelected,
	getVisibleOpenClawHistoryItems,
	OPENCLAW_HISTORY_FETCH_LIMIT,
	OPENCLAW_HISTORY_VISIBLE_STEP,
} from "./openclaw-history";
import {
	DISCONNECTED_OPENCLAW_STATUS,
	getOpenClawConnectionState,
	getOpenClawGatewayDisplayName,
	getOpenClawInputDisabledReason,
	OPENCLAW_STATUS_CONNECTED_POLL_INTERVAL,
	OPENCLAW_STATUS_RETRY_POLL_INTERVAL,
	type OpenClawConnectionState,
} from "./openclaw-status";
import EnhancedMentionDropdown from "./sender-bridges/EnhancedMentionDropdown";
import type { KnowledgeSourceSelectorRef } from "@/components/KnowledgeSource";
import KnowledgeSenderExtras from "./sender-bridges/KnowledgeSenderExtras";
import LegacyLinkList from "./sender-bridges/LegacyLinkList";
import WikiLinkList from "./sender-bridges/WikiLinkList";
import { useKnowledgeSenderConfig } from "./sender-bridges/useKnowledgeSenderConfig";
import { useWorkAiSenderConfig } from "./sender-bridges/useWorkAiSenderConfig";
import WorkAiSenderExtras from "./sender-bridges/WorkAiSenderExtras";

interface ChatContainerProps {
	agentId: string | number; // 支持 string 类型（如 "U5KLWZ"）
	conversationId?: string | number;
	useCaseFixed?: boolean;
	hideMenuHeader?: boolean;
	className?: string;
	currentAgentOverride?: any;
	embeddedOpenClawPreview?: boolean;
	disableOpenClawUrlSync?: boolean;
	skipOpenClawFrontStoreMirror?: boolean;
	isIndexRoute?: boolean; // 工作台入口路径判断
	showRecommend?: boolean;
	showUserMemory?: boolean;
	onShowUserMemoryChange?: (show: boolean) => void;
  showSetting?: boolean;
  onShowSettingChange?: (show: boolean) => void;
}

export interface ChatContainerRef {
	showUseCase: () => void;
	hideUseCase: () => void;
	showShare: () => void;
}

const DEFAULT_IMG = "/images/default_agent.png";
const TOPIC_ICON = "/images/vibe/topic.svg";
const OPENCLAW_CHANNEL_TYPE = 1014;
const OPENCLAW_CONVERSATION_INVALIDATED_EVENT =
	"openclaw:conversation-invalidated";
const openClawStatusRequests = new Map<string, Promise<unknown>>();
const OPENCLAW_ADD_TO_KNOWLEDGE_FALLBACK_TITLE = "OpenClaw 回答";

interface OpenClawOutputFilePreviewState {
	visible: boolean;
	currentFile: {
		id?: string | number;
		name?: string;
		file_url?: string;
		download_url?: string;
		file_ext?: string;
		content?: string;
	};
}

function isOpenClawAgent(agent?: any): boolean {
	return isOpenClawCompatibleChannelType(agent?.channel_type);
}

function loadOpenClawStatus(agentId: string | number) {
	const key = String(agentId);
	const existing = openClawStatusRequests.get(key);
	if (existing) return existing;

	const request = openclawApi
		.status(agentId, { ignoreMessage: true })
		.finally(() => {
			if (openClawStatusRequests.get(key) === request) {
				openClawStatusRequests.delete(key);
			}
		});
	openClawStatusRequests.set(key, request);
	return request;
}


function TopicIcon({ className = "" }: { className?: string }) {
	return (
		<img
			className={`size-4 object-contain ${className}`}
			src={getPublicPath(TOPIC_ICON)}
			alt=""
			aria-hidden="true"
		/>
	);
}

function getConversationKey(conversation: any) {
	return String(conversation?.conversation_id || "");
}

function mergeOpenClawConversations(current: any[], incoming: any[]) {
	const next: any[] = [];
	const indexById = new Map<string, number>();

	for (const item of current) {
		const key = getConversationKey(item);
		if (!key) continue;
		if (indexById.has(key)) continue;
		indexById.set(key, next.length);
		next.push(item);
	}

	for (const item of incoming) {
		const key = getConversationKey(item);
		if (!key) continue;
		const existingIndex = indexById.get(key);
		if (existingIndex === undefined) {
			indexById.set(key, next.length);
			next.push(item);
		} else {
			const existing = next[existingIndex];
			const merged = { ...existing, ...item };
			if (
				hasMeaningfulOpenClawConversationTitle(existing) &&
				isOpenClawPlaceholderConversationTitle(
					item?.title,
					item?.conversation_id ?? item?.id,
				)
			) {
				merged.title = existing.title;
			}
			next[existingIndex] = merged;
		}
	}

	return next;
}

function mergeOpenClawConversationPage(current: any[], page: any[]) {
	if (!page.length) return [];
	const merged = mergeOpenClawConversations(current, page);
	const mergedById = new Map(
		merged.map((item) => [getConversationKey(item), item]),
	);
	return page.map((item) => mergedById.get(getConversationKey(item)) || item);
}

function hasOpenClawCachedHistory(conversation: any) {
	const raw = conversation?.raw || {};
	const value =
		conversation?.has_cached_history ??
		conversation?.hasCachedHistory ??
		conversation?.openclaw_has_cached_history ??
		raw.has_cached_history ??
		raw.hasCachedHistory;
	return value === true;
}

function isOpenClawConversationUnavailableOffline(
	conversation: any,
	openClawHealthy: boolean | null,
) {
	return openClawHealthy !== true && !hasOpenClawCachedHistory(conversation);
}

function markOpenClawConversationCached(conversation: any) {
	return {
		...conversation,
		has_cached_history: true,
		raw: {
			...(conversation?.raw || {}),
			has_cached_history: true,
		},
	};
}

function getOpenClawInvalidationKey(
	agentId: string | number,
	conversationId?: string | number | null,
) {
	return `${String(agentId)}:${String(conversationId || "")}`;
}

function isRawOpenClawConversationTitle(
	title: unknown,
	conversationId?: string | number | null,
) {
	const normalized = String(title || "").trim();
	if (!normalized) return true;
	const id = String(conversationId || "").trim();
	return (
		Boolean(id && normalized === id) || normalized.startsWith("agent:main:")
	);
}

function normalizeOpenClawConversationTitle(title: unknown) {
	return String(title || "")
		.replace(/\s+/g, " ")
		.trim();
}

function isOpenClawControlCenterTitle(title: unknown) {
	const normalized = normalizeOpenClawConversationTitle(title).toLowerCase();
	return (
		normalized === "claw control center" ||
		normalized === "openclaw control center" ||
		normalized === "qclaw control center" ||
		normalized === "control center"
	);
}

function isOpenClawPlaceholderConversationTitle(
	title: unknown,
	conversationId?: string | number | null,
) {
	return (
		isRawOpenClawConversationTitle(title, conversationId) ||
		isOpenClawControlCenterTitle(title)
	);
}

function hasMeaningfulOpenClawConversationTitle(conversation: any) {
	const title = normalizeOpenClawConversationTitle(conversation?.title);
	if (!title) return false;
	return !isOpenClawPlaceholderConversationTitle(
		title,
		conversation?.conversation_id ?? conversation?.id,
	);
}

function getOpenClawConversationDisplayTitle(
	conversation: any,
	fallbackTitle: string,
) {
	const title = normalizeOpenClawConversationTitle(conversation?.title);
	const conversationId = conversation?.conversation_id ?? conversation?.id;
	if (!isOpenClawPlaceholderConversationTitle(title, conversationId))
		return title;
	return fallbackTitle;
}

function buildOpenClawOptimisticHubTitle(
	userDisplayName: string,
	title?: string,
	question?: string,
) {
	const existingTitle = normalizeOpenClawConversationTitle(title);
	if (existingTitle.startsWith("53AI Hub")) return existingTitle;
	const titleSeed = isOpenClawPlaceholderConversationTitle(existingTitle)
		? ""
		: existingTitle;
	const normalizedQuestion = normalizeOpenClawConversationTitle(
		question || titleSeed,
	);
	if (!normalizedQuestion) return titleSeed || "新对话";
	const clippedQuestion =
		normalizedQuestion.length > 40
			? `${normalizedQuestion.slice(0, 40)}...`
			: normalizedQuestion;
	const owner = userDisplayName.trim();
	return owner ? `53AI Hub-${owner}：${clippedQuestion}` : clippedQuestion;
}

function readOpenClawCurrentSession(response: any): OpenClawSession | null {
	const payload = getOpenClawPayload(response);
	const candidate = payload?.session || payload?.conversation || payload;
	if (!candidate || typeof candidate !== "object") return null;

	const id =
		candidate.id ||
		candidate.session_id ||
		candidate.sessionId ||
		candidate.conversation_id ||
		candidate.conversationId;
	if (typeof id !== "string" || !id.trim()) return null;

	return {
		...(candidate as OpenClawSession),
		id,
	};
}

function isHubManagedOpenClawSession(session: OpenClawSession) {
	const title = String(session.title || "").trim();
	if (!title) return true;
	if (isOpenClawControlCenterTitle(title)) return false;
	return (
		title.startsWith("53AI Hub-") ||
		title.startsWith("53AIHub ") ||
		title.startsWith("53AIHub:") ||
		title.startsWith("53AIHub-")
	);
}

function getOutputFileName(file: OutputFile) {
	return (
		file.file_name?.split("/").pop() ||
		file.file_name ||
		`文件 ${file.id || ""}`.trim() ||
		"download"
	);
}

function normalizeOpenClawApiHost(value?: string | null) {
	const trimmed = String(value || "")
		.trim()
		.replace(/\/$/, "");
	if (!trimmed) return "";
	try {
		return new URL(trimmed, window.location.origin).origin;
	} catch {
		return trimmed;
	}
}

function readOpenClawAbsoluteUrlOrigin(value?: string | null) {
	const raw = String(value || "").trim();
	if (!/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) return "";
	try {
		return new URL(raw).origin;
	} catch {
		return "";
	}
}

function isOpenClawLocalDevFrontend() {
	const hostname = window.location.hostname;
	return (
		(hostname === "localhost" ||
			hostname === "127.0.0.1" ||
			hostname === "::1") &&
		(window.location.port === "5173" || window.location.port === "5174")
	);
}

function getOpenClawApiHost(originHint?: string) {
	const runtimeApiHost = normalizeOpenClawApiHost(
		typeof window !== "undefined" ? String((window as any).api_host || "") : "",
	);
	if (runtimeApiHost) return runtimeApiHost;

	const configuredApiHost = normalizeOpenClawApiHost(API_HOST);
	if (configuredApiHost && configuredApiHost !== window.location.origin)
		return configuredApiHost;

	const normalizedOriginHint = normalizeOpenClawApiHost(originHint);
	if (normalizedOriginHint && normalizedOriginHint !== window.location.origin)
		return normalizedOriginHint;

	if (isOpenClawLocalDevFrontend()) {
		return `${window.location.protocol}//${window.location.hostname}:9001`;
	}

	return configuredApiHost;
}

function getOpenClawOutputFileApiOrigin(file: OutputFile) {
	return (
		readOpenClawAbsoluteUrlOrigin(
			(file as any).download_url || (file as any).downloadUrl,
		) ||
		readOpenClawAbsoluteUrlOrigin(
			(file as any).signed_download_url || (file as any).signedDownloadUrl,
		) ||
		readOpenClawAbsoluteUrlOrigin(
			(file as any).preview_url || (file as any).previewUrl,
		) ||
		readOpenClawAbsoluteUrlOrigin((file as any).url)
	);
}

function resolveOpenClawApiUrl(rawUrl: string, originHint?: string) {
	if (!rawUrl || rawUrl.startsWith("data:") || rawUrl.startsWith("blob:"))
		return rawUrl;
	const apiHost = getOpenClawApiHost(originHint);
	if (rawUrl.startsWith("/api/") && apiHost) {
		return `${apiHost}${rawUrl}`;
	}

	let parsed: URL;
	try {
		parsed = new URL(rawUrl, window.location.origin);
	} catch {
		return rawUrl;
	}

	if (
		apiHost &&
		parsed.origin === window.location.origin &&
		parsed.pathname.startsWith("/api/")
	) {
		return `${apiHost}${parsed.pathname}${parsed.search}${parsed.hash}`;
	}

	return parsed.toString();
}

function appendOpenClawOutputFileToken(
	rawUrl: string,
	accessToken?: string,
	originHint?: string,
) {
	if (!rawUrl || rawUrl.startsWith("data:") || rawUrl.startsWith("blob:"))
		return rawUrl;
	const resolvedUrl = resolveOpenClawApiUrl(rawUrl, originHint);
	let parsed: URL;
	try {
		parsed = new URL(resolvedUrl, window.location.origin);
	} catch {
		return resolvedUrl;
	}

	const isUploadDownload =
		parsed.pathname.startsWith("/api/upload-files/") &&
		parsed.pathname.includes("/download");
	if (isUploadDownload && accessToken && !parsed.searchParams.has("token")) {
		parsed.searchParams.set("token", accessToken);
	}

	return parsed.toString();
}

function resolveOpenClawOutputFilePreviewUrl(
	file: OutputFile,
	accessToken?: string,
) {
	const previewUrl = String(
		(file as any).preview_url || (file as any).previewUrl || "",
	);
	const originHint = getOpenClawOutputFileApiOrigin(file);
	if (previewUrl) {
		return appendOpenClawOutputFileToken(previewUrl, accessToken, originHint);
	}
	const strategy = getOutputFileDownloadStrategy(file);
	const rawUrl =
		strategy.kind === "direct_url" || strategy.kind === "data_url"
			? strategy.url
			: file.signed_download_url || file.download_url || "";
	return appendOpenClawOutputFileToken(rawUrl, accessToken, originHint);
}

function resolveOpenClawOutputFileDownloadUrl(
	file: OutputFile,
	accessToken?: string,
) {
	const originHint = getOpenClawOutputFileApiOrigin(file);
	const strategy = getOutputFileDownloadStrategy(file);
	const rawUrl =
		strategy.kind === "direct_url" || strategy.kind === "data_url"
			? strategy.url
			: file.signed_download_url || file.download_url || "";
	return appendOpenClawOutputFileToken(rawUrl, accessToken, originHint);
}

function createOpenClawInlineOutputFilePreview(file: OutputFile) {
	if (typeof file.content !== "string") return null;
	const mimeType = file.mime_type || "text/plain;charset=utf-8";
	if (typeof URL.createObjectURL !== "function") {
		return {
			url: `data:${mimeType},${encodeURIComponent(file.content)}`,
			content: file.content,
		};
	}
	const blob = new Blob([file.content], { type: mimeType });
	return {
		url: URL.createObjectURL(blob),
		content: file.content,
	};
}

function getOpenClawAnswerForKnowledge(message: Message) {
	const projectedAnswer = message.openclawProjection?.visibleAnswer?.trim();
	if (projectedAnswer) return projectedAnswer;
	return "";
}

function getOpenClawQuestionForKnowledge(message: Message) {
	return (
		message.original_question?.trim() ||
		message.question?.trim() ||
		OPENCLAW_ADD_TO_KNOWLEDGE_FALLBACK_TITLE
	);
}

const ChatContainerInner = forwardRef<ChatContainerRef, ChatContainerProps>(
	(props, ref) => {
		const {
			agentId,
			conversationId,
			useCaseFixed = false,
			hideMenuHeader = false,
			className,
			currentAgentOverride,
			embeddedOpenClawPreview = false,
			disableOpenClawUrlSync = false,
			skipOpenClawFrontStoreMirror = false,
			isIndexRoute = false,
			showRecommend = false,
			showUserMemory = false,
			onShowUserMemoryChange,
			showSetting = false,
      onShowSettingChange,
		} = props;
		const navigate = useNavigate();
		const [searchParams] = useSearchParams();
		const chatViewRef = useRef<ChatViewRef>(null);
		const addAnswerAsMdRef = useRef<AddAnswerAsMdRef>(null);
		// 用于追踪 CompletionView 传入的 onGuideChange 回调，使 useImperativeHandle 能正确触发面板
		const externalOnGuideChangeRef = useRef<((show: boolean) => void) | null>(
			null,
		);
		const [showHistory, setShowHistory] = useState(false); // 工作台入口历史侧边栏
		const [showThinkKnowledge, setShowThinkKnowledge] = useState(false); // 知识检索侧边栏
		const thinkKnowledgeRef = useRef<ThinkKnowledgeRef>(null);
		const [isUserMemoryFullscreen, setIsUserMemoryFullscreen] = useState(false);
		const agentStore = useAgentStore();
		const storeCurrentAgent = useCurrentAgent();
		const currentAgent = currentAgentOverride || storeCurrentAgent;

		const convStore = useConversationStore();
		const sharedConvStore = useSharedChatConversationStore();
		const addFrontConversation = useConversationStore(
			(state) => state.addConversation,
		);
		const setFrontCurrentState = useConversationStore(
			(state) => state.setCurrentState,
		);
		const addSharedConversation = useSharedChatConversationStore(
			(state: any) => state.addConversation,
		);
		const setSharedCurrentState = useSharedChatConversationStore(
			(state: any) => state.setCurrentState,
		);
		const shortcutsStore = useShortcutsStore();
		const enterpriseStore = useEnterpriseStore();
		const isSoftStyle = useIsSoftStyle();
		const navigationStore = useNavigationStore();
		const accessToken = useUserStore((state) => state.info.access_token);
		const openClawUserDisplayName = useUserStore(
			(state) => state.info.nickname || state.info.username || "",
		);
		// selector 订阅 is_internal,确保登录态/角色切换时下游 KnowledgeSenderExtras 重新渲染(finding #3)
		const isInternal = useUserStore((state) => state.info.is_internal);
		// 用户头像（用于用户消息气泡，与 agent 头像分离）
		const userAvatar = useUserStore((state) => state.info.avatar);

		// 知识库权限：用于控制是否显示输出文件「收藏」按钮
		const hasKnowledgeBase =
			navigationStore.hasKnowledge &&
			checkVersion(VERSION_MODULE.KNOWLEDGE_BASE);

		// 获取当前语言
		const locale = useEnterpriseStore((state) => state.language);

    // agentSkill 加载 + 过滤(单源)由 sender-bridges/useWorkAiSenderConfig 负责。
    // ChatContainer 不再读 useSkillsStore 派生此数据(项目决策:project_sender_bridges_skill_owner)。


		const [showGuide, setShowGuide] = useState(false);
		const [openClawPanelOpen, setOpenClawPanelOpen] = useState(false);
		const [outputFilePreview, setOutputFilePreview] =
			useState<OpenClawOutputFilePreviewState>({
				visible: false,
				currentFile: {},
			});
		// 非 OpenClaw 模式：outputfile 浏览器面板状态
		const [outputFileBrowserState, setOutputFileBrowserState] = useState<{
			visible: boolean;
			currentFile: {
				id?: string | number;
				name?: string;
				file_url?: string;
				file_ext?: string;
			};
		}>({ visible: false, currentFile: {} });
		// 已被检查过的 fileId 集合，避免重复请求
		const checkedOutputFileIdsRef = useRef<Set<string>>(new Set());
		const [openClawHistoryOpen, setOpenClawHistoryOpen] = useState(false);
		const [openClawConversationCache, setOpenClawConversationCache] = useState<
			any[]
		>([]);
		const [openClawConversationPagination, setOpenClawConversationPagination] =
			useState<any>(null);
		const [openClawHistoryVisibleCount, setOpenClawHistoryVisibleCount] =
			useState(OPENCLAW_HISTORY_VISIBLE_STEP);
		const [openClawHistoryLoading, setOpenClawHistoryLoading] = useState(false);
		const [openClawHistoryFetching, setOpenClawHistoryFetching] =
			useState(false);
		const [openClawConnectionState, setOpenClawConnectionState] =
			useState<OpenClawConnectionState>("checking");
		const [openClawStatusLoading, setOpenClawStatusLoading] = useState(false);
		const [openClawStatusPayload, setOpenClawStatusPayload] =
			useState<any>(null);
		const [openClawInitialConversationId, setOpenClawInitialConversationId] =
			useState<string | number | undefined>();
		const [
			openClawInitialConversationAgentKey,
			setOpenClawInitialConversationAgentKey,
		] = useState<string | null>(null);
		const [
			openClawCurrentConversationResolving,
			setOpenClawCurrentConversationResolving,
		] = useState(false);
		const [openClawMirrorResolveEpoch, setOpenClawMirrorResolveEpoch] =
			useState(0);
		const openClawHistoryLoadingRef = useRef(false);
		const openClawHistoryListRef = useRef<HTMLDivElement | null>(null);
		const openClawHistoryOpenRef = useRef(false);
		const openClawHistoryUserScrolledRef = useRef(false);
		const openClawHistorySelectedScrollKeyRef = useRef<string | null>(null);
		const openClawDefaultResolveKeyRef = useRef<string | null>(null);
		const openClawFreshCurrentResolveKeyRef = useRef<string | null>(null);
		const openClawExplicitSelectionRef = useRef(false);
		const openClawVisibleConversationIdRef = useRef<string>("");
		const openClawHistoryQueuedReloadRef = useRef<{
			offset: number;
			fresh: boolean;
		} | null>(null);
		const openClawStatusAgentKeyRef = useRef<string | null>(null);
		const openClawStatusRequestSeqRef = useRef(0);
		const openClawConnectionStateRef =
			useRef<OpenClawConnectionState>("checking");
		const openClawPreviousRenderedConnectionStateRef =
			useRef<OpenClawConnectionState>("checking");
		const openClawSelectionAgentRef = useRef<string | null>(null);
		const openClawInvalidatedConversationIdsRef = useRef<Set<string>>(
			new Set(),
		);
		const openClawIgnoredRouteConversationKeyRef = useRef<string | null>(null);
		const outputFilePreviewScopeKeyRef = useRef<string>("");

		// 当前会话：统一使用 shared-business store，因为 ChatView 是主组件
		// 所有会话数据（包括新建会话）都由 shared-business store 管理
		const currentConversationId = useSharedChatConversationStore(
			(state: any) => state.current_conversationid,
		);
		const currentConversationAgentId = useSharedChatConversationStore(
			(state: any) => state.current_agentid,
		);
		const conversations = useSharedChatConversationStore(
			(state: any) => state.conversations,
		);
		openClawHistoryOpenRef.current = openClawHistoryOpen;

		// 是否为快捷方式
		const isShortcut = useMemo(() => {
			if (!currentAgent?.agent_id) return false;
			return shortcutsStore.isShortcut("agent", currentAgent.agent_id);
		}, [currentAgent?.agent_id, shortcutsStore]);

		// 判断是否为 Openclaw 智能体
		const isOpenclaw = useMemo(() => {
			return shouldUseOpenClawChatAdapter({
				currentAgent,
				agentId,
				openClawChannelType: isOpenClawCompatibleChannelType(
					currentAgent?.channel_type,
				)
					? currentAgent.channel_type
					: OPENCLAW_CHANNEL_TYPE,
				routeType: searchParams.get("type"),
				conversationId,
			});
		}, [currentAgent, agentId, searchParams, conversationId]);
		const openClawScopedCurrentConversationId =
			isOpenclaw && String(currentConversationAgentId || "") === String(agentId)
				? currentConversationId
				: 0;
		openClawVisibleConversationIdRef.current = hasConversationId(
			openClawScopedCurrentConversationId,
		)
			? String(openClawScopedCurrentConversationId)
			: "";
		const openClawHealthy = isOpenclaw
			? openClawConnectionState === "connected"
				? true
				: openClawConnectionState === "disconnected"
					? false
					: null
			: null;
		const routeOpenClawConversationIdRaw =
			isOpenclaw && hasConversationId(conversationId)
				? String(conversationId)
				: "";
		if (
			!routeOpenClawConversationIdRaw &&
			openClawIgnoredRouteConversationKeyRef.current
		) {
			openClawIgnoredRouteConversationKeyRef.current = null;
		}
		const routeOpenClawConversationKey = getOpenClawInvalidationKey(
			agentId,
			routeOpenClawConversationIdRaw,
		);
		const routeConversationMatchesCurrentAgent =
			!openClawSelectionAgentRef.current ||
			openClawSelectionAgentRef.current === String(agentId);
		const routeOpenClawConversationId =
			routeOpenClawConversationIdRaw &&
			routeConversationMatchesCurrentAgent &&
			openClawIgnoredRouteConversationKeyRef.current !==
				routeOpenClawConversationKey &&
			!openClawInvalidatedConversationIdsRef.current.has(
				routeOpenClawConversationKey,
			)
				? routeOpenClawConversationIdRaw
				: "";
		const openClawInitialConversationIdForAgent =
			isOpenclaw && openClawInitialConversationAgentKey === String(agentId)
				? openClawInitialConversationId
				: undefined;
		const setOpenClawInitialConversationForCurrentAgent = useCallback(
			(conversationId?: string | number) => {
				if (hasConversationId(conversationId)) {
					setOpenClawInitialConversationId(conversationId);
					setOpenClawInitialConversationAgentKey(String(agentId));
					return;
				}
				setOpenClawInitialConversationId(undefined);
				setOpenClawInitialConversationAgentKey(null);
			},
			[agentId],
		);
		const openClawGatewayName = useMemo(
			() => getOpenClawGatewayDisplayName(openClawStatusPayload, currentAgent),
			[currentAgent, openClawStatusPayload],
		);

		useEffect(() => {
			openClawConnectionStateRef.current = openClawConnectionState;
			const previousConnectionState =
				openClawPreviousRenderedConnectionStateRef.current;
			openClawPreviousRenderedConnectionStateRef.current =
				openClawConnectionState;
			if (
				isOpenclaw &&
				previousConnectionState === "connected" &&
				openClawConnectionState === "disconnected"
			) {
				openClawDefaultResolveKeyRef.current = null;
				openClawFreshCurrentResolveKeyRef.current = null;
				setOpenClawMirrorResolveEpoch((current) => current + 1);
			}
		}, [isOpenclaw, openClawConnectionState]);

		const selectedConversationId = isOpenclaw
			? routeOpenClawConversationId ||
				openClawScopedCurrentConversationId ||
				openClawInitialConversationIdForAgent
			: currentConversationId || conversationId;
		const outputFilePreviewScopeKey = [
			isOpenclaw ? "openclaw" : "normal",
			agentId || "",
			currentAgent?.agent_id || "",
			selectedConversationId || "",
		].join(":");
		const hasSelectedConversationId = hasConversationId(selectedConversationId);
		const visibleConversations = isOpenclaw
			? openClawConversationCache
			: conversations;

		useEffect(() => {
			if (isOpenclaw && conversations.length > 0) {
				setOpenClawConversationCache((current) =>
					mergeOpenClawConversations(current, conversations),
				);
			}
		}, [conversations, isOpenclaw]);

		const currentConv = useMemo(() => {
			const targetId = String(selectedConversationId);
			return (
				visibleConversations.find(
					(item: any) => String(item.conversation_id) === targetId,
				) ||
				(isOpenclaw
					? conversations.find(
							(item: any) => String(item.conversation_id) === targetId,
						)
					: undefined)
			);
		}, [
			conversations,
			isOpenclaw,
			selectedConversationId,
			visibleConversations,
		]);

		const openClawHistoryVisibleConversations = useMemo(
			() =>
				getVisibleOpenClawHistoryItems(
					visibleConversations,
					openClawHistoryVisibleCount,
				),
			[openClawHistoryVisibleCount, visibleConversations],
		);

		const openClawConversationOptions = useMemo(() => {
			const historyConversations = isOpenclaw
				? openClawHistoryVisibleConversations
				: visibleConversations;
			if (!isOpenclaw) return historyConversations;
			return historyConversations;
		}, [isOpenclaw, openClawHistoryVisibleConversations, visibleConversations]);

		const currentAgentLogo = currentAgent?.logo || DEFAULT_IMG;
		const chatAgentInfo = useMemo(
			() =>
				currentAgent
					? {
							agent_id: currentAgent.agent_id,
							name: currentAgent.name,
							logo: currentAgent.logo,
							description: currentAgent.description,
							custom_config_obj: currentAgent.custom_config_obj,
							configs: currentAgent.configs,
							settings_obj: currentAgent.settings_obj,
							use_cases: currentAgent.use_cases,
							user_group_ids: currentAgent.user_group_ids,
							agent_usage: currentAgent.agent_usage,
							scopes: currentAgent.scopes,
							agent_type: currentAgent.agent_type,
						}
					: undefined,
			[currentAgent],
		);
		const chatViewKey = isOpenclaw
			? `openclaw:${agentId}`
			: `normal:${agentId}`;
		const chatViewInitialConversationId = isOpenclaw
			? hasConversationId(routeOpenClawConversationId)
				? routeOpenClawConversationId
				: openClawInitialConversationIdForAgent
			: conversationId;

		// ============ Sender 分支:按 agent_usage 注入不同 sender 行为 ============
		// agent_usage === 1 (KM_AI_SEARCH):复用 knowledge/chat 的发送区(模型 + 知识源 + @)
		// agent_usage === 4 (WORK_AI):复用 IndexChat 的发送区(@ 增强 + / 技能)
		// 其它(0/2/3):使用 ChatView 默认 sender(不传 sender feature)
		const isInLibraryMode = useMemo(
			() =>
				typeof window !== "undefined" &&
				window.location.pathname.includes("/library/"),
			[],
		);

		// ============ Dialog 引用(work-ai 多入口共用 spaceDialogRef;knowledge 模式复用 KnowledgeSourceSelector 内部 dialog) ============
		const spaceDialogRef = useRef<SpaceDialogRef>(null);
		const uploadsDialogRef = useRef<MyFilesDialogRef>(null);
		const aiGeneratedDialogRef = useRef<MyFilesDialogRef>(null);
		const recordingsDialogRef = useRef<MyFilesDialogRef>(null);
		// knowledge 模式:指向 KnowledgeSenderExtras 内 KnowledgeSourceSelector 的 ref,
		// 让 @ 弹窗底部「从知识库里选择」入口复用该 selector 的 SpaceDialog(单一对话框)。
		const knowledgeSelectorRef = useRef<KnowledgeSourceSelectorRef>(null);

		const knowledgeSenderConfig = useKnowledgeSenderConfig({
			currentAgent,
			enabled: currentAgent?.agent_usage === AGENT_USAGES.KM_AI_SEARCH,
			isInLibrary: isInLibraryMode,
			// knowledge 模式:@ 弹窗底部的「@ 从知识库里选择」入口通过 selector.open() 复用
			// KnowledgeSourceSelector 内部 SpaceDialog(对齐原版 Sender 的 handleOpenLibrary)
			knowledgeSelectorRef,
		});
		const workAiSenderConfig = useWorkAiSenderConfig({
			currentAgent,
			enabled: currentAgent?.agent_usage === AGENT_USAGES.WORK_AI,
		});

		const activeSenderKind: "knowledge" | "work-ai" | null = useMemo(() => {
			if (currentAgent?.agent_usage === AGENT_USAGES.KM_AI_SEARCH)
				return "knowledge";
			if (currentAgent?.agent_usage === AGENT_USAGES.WORK_AI) return "work-ai";
			return null;
		}, [currentAgent?.agent_usage]);

		// (spaceDialogRef / uploadsDialogRef / aiGeneratedDialogRef / recordingsDialogRef 已在上方声明)

		// work-ai 模式:构造 mentionDropdown slot,把 Dialog 打开入口通过闭包注入
		const workAiMentionDropdownSlot = useMemo(() => {
			if (!workAiSenderConfig) return undefined;
			const { sources } = workAiSenderConfig;
			return (slotProps: any) => (
				<EnhancedMentionDropdown
					{...slotProps}
					onOpenLibrary={() => sources.library.open(spaceDialogRef)}
					onOpenUploads={() => sources.uploads.open(uploadsDialogRef)}
					onOpenAIGenerated={() =>
						sources["ai-generated"].open(aiGeneratedDialogRef)
					}
					onOpenRecordings={() => sources.recordings.open(recordingsDialogRef)}
				/>
			);
		}, [workAiSenderConfig]);

		// AI 搜问 (knowledge) 模式:复用与小助理同款的 EnhancedMentionDropdown,但只暴露
		// 「从知识库里选择」入口,不显示「从我上传/AI生成/我的录音」三项(这些是小助理专属)。
		// slotProps.onOpenLibrary 由 Sender 透传 mention.onOpenLibrary(已接到 KnowledgeSourceSelector.open())。
		const knowledgeMentionDropdownSlot = useMemo(() => {
			if (!knowledgeSenderConfig) return undefined;
			return (slotProps: any) => (
				// 仅透传 slotProps(包含 onOpenLibrary);其余三个回调不注入 → EnhancedMentionDropdown 自动隐藏对应入口
				<EnhancedMentionDropdown {...slotProps} />
			);
		}, [knowledgeSenderConfig]);

		const handleOpenClawHistoryOpenChange = useCallback((open: boolean) => {
			if (open) {
				openClawHistoryUserScrolledRef.current = false;
				openClawHistorySelectedScrollKeyRef.current = null;
			}
			setOpenClawHistoryOpen(open);
		}, []);

		const loadOpenClawConversationPage = useCallback(
			async (offset = 0, options?: { fresh?: boolean }) => {
				const fresh =
					options?.fresh ?? openClawConnectionStateRef.current === "connected";
				const agentKey = String(agentId);
				if (!isOpenclaw) return;
				if (fresh && openClawConnectionStateRef.current !== "connected") return;
				if (openClawHistoryLoadingRef.current) {
					if (offset === 0 || fresh) {
						openClawHistoryQueuedReloadRef.current = { offset, fresh };
					}
					return;
				}
				const shouldShowHistoryLoading = !fresh;
				openClawHistoryLoadingRef.current = true;
				setOpenClawHistoryFetching(true);
				if (shouldShowHistoryLoading) {
					setOpenClawHistoryLoading(true);
				}
				try {
					const response = await openclawApi.conversations(agentId, {
						limit: OPENCLAW_HISTORY_FETCH_LIMIT,
						offset,
						fresh,
					});
					if (openClawSelectionAgentRef.current !== agentKey) return;
					const payload = getOpenClawPayload(response);
					const page = ((payload.sessions || []) as OpenClawSession[]).map(
						(session) => buildOpenClawConversation(session, agentId),
					);
					if (fresh) {
						for (const conversation of page) {
							const conversationId = String(
								conversation?.conversation_id || "",
							);
							if (conversationId) {
								openClawInvalidatedConversationIdsRef.current.delete(
									getOpenClawInvalidationKey(agentId, conversationId),
								);
							}
						}
					}
					setOpenClawConversationPagination(payload.pagination || null);
					setOpenClawConversationCache((current) =>
						offset === 0
							? mergeOpenClawConversationPage(current, page)
							: mergeOpenClawConversations(current, page),
					);
					if (offset === 0) {
						setOpenClawHistoryVisibleCount((current) => {
							if (
								!openClawHistoryOpenRef.current ||
								!openClawHistoryUserScrolledRef.current
							) {
								return OPENCLAW_HISTORY_VISIBLE_STEP;
							}
							if (page.length === 0) return OPENCLAW_HISTORY_VISIBLE_STEP;
							return Math.min(
								Math.max(current, OPENCLAW_HISTORY_VISIBLE_STEP),
								Math.max(page.length, OPENCLAW_HISTORY_VISIBLE_STEP),
							);
						});
					} else if (offset > 0 && page.length > 0) {
						setOpenClawHistoryVisibleCount(
							(current) => current + OPENCLAW_HISTORY_VISIBLE_STEP,
						);
					}
				} catch (error) {
					console.error("Failed to load OpenClaw conversations:", error);
				} finally {
					if (openClawSelectionAgentRef.current === agentKey) {
						openClawHistoryLoadingRef.current = false;
						setOpenClawHistoryFetching(false);
						if (shouldShowHistoryLoading) {
							setOpenClawHistoryLoading(false);
						}
						const queuedReload = openClawHistoryQueuedReloadRef.current;
						openClawHistoryQueuedReloadRef.current = null;
						if (queuedReload) {
							void loadOpenClawConversationPage(queuedReload.offset, {
								fresh: queuedReload.fresh,
							});
						} else if (
							!fresh &&
							offset === 0 &&
							openClawConnectionStateRef.current === "connected"
						) {
							void loadOpenClawConversationPage(0, { fresh: true });
						}
					}
				}
			},
			[agentId, isOpenclaw],
		);

		const mergeOpenClawConversationIntoStores = useCallback(
			(conversation: any, options?: { visibleCache?: boolean }) => {
				addSharedConversation(conversation);
				if (options?.visibleCache !== false) {
					setOpenClawConversationCache((current) =>
						mergeOpenClawConversations(current, [conversation]),
					);
				}
				if (!skipOpenClawFrontStoreMirror) {
					addFrontConversation(conversation);
				}
			},
			[
				addFrontConversation,
				addSharedConversation,
				skipOpenClawFrontStoreMirror,
			],
		);

		useEffect(() => {
			if (!isOpenclaw) return;
			const handleInvalidatedConversation = (event: Event) => {
				const detail =
					(
						event as CustomEvent<{
							agentId?: string;
							conversationId?: string | number;
						}>
					).detail || {};
				if (String(detail.agentId || "") !== String(agentId)) return;
				const invalidConversationId = String(detail.conversationId || "");
				if (!hasConversationId(invalidConversationId)) return;
				openClawInvalidatedConversationIdsRef.current.add(
					getOpenClawInvalidationKey(agentId, invalidConversationId),
				);
				openClawDefaultResolveKeyRef.current = null;
				openClawFreshCurrentResolveKeyRef.current = null;
				openClawExplicitSelectionRef.current = false;
				setOpenClawInitialConversationForCurrentAgent(undefined);
				setOpenClawCurrentConversationResolving(true);
				setOpenClawConversationCache((current) =>
					current.filter(
						(item) =>
							String(item?.conversation_id || "") !== invalidConversationId,
					),
				);
				setSharedCurrentState(agentId, 0);
				if (!skipOpenClawFrontStoreMirror) {
					setFrontCurrentState(String(agentId), 0, false);
				}
				setOpenClawMirrorResolveEpoch((current) => current + 1);
			};
			window.addEventListener(
				OPENCLAW_CONVERSATION_INVALIDATED_EVENT,
				handleInvalidatedConversation,
			);
			return () => {
				window.removeEventListener(
					OPENCLAW_CONVERSATION_INVALIDATED_EVENT,
					handleInvalidatedConversation,
				);
			};
		}, [
			agentId,
			isOpenclaw,
			setFrontCurrentState,
			setOpenClawInitialConversationForCurrentAgent,
			setSharedCurrentState,
			skipOpenClawFrontStoreMirror,
		]);

		useEffect(() => {
			if (!isOpenclaw) {
				openClawDefaultResolveKeyRef.current = null;
				openClawFreshCurrentResolveKeyRef.current = null;
				openClawExplicitSelectionRef.current = false;
				setOpenClawInitialConversationForCurrentAgent(undefined);
				setOpenClawCurrentConversationResolving(false);
				return;
			}

			const routeConversationId = routeOpenClawConversationId;
			const agentKey = String(agentId);
			const previousAgentKey = openClawSelectionAgentRef.current;
			const agentChanged =
				previousAgentKey !== null && previousAgentKey !== agentKey;
			if (previousAgentKey !== agentKey) {
				openClawSelectionAgentRef.current = agentKey;
				openClawInvalidatedConversationIdsRef.current.clear();
				openClawExplicitSelectionRef.current = Boolean(routeConversationId);
				openClawHistoryQueuedReloadRef.current = null;
				openClawHistoryLoadingRef.current = false;
				setOpenClawHistoryLoading(false);
				setOpenClawHistoryFetching(false);
				setOpenClawConversationCache([]);
				setOpenClawConversationPagination(null);
				setOpenClawHistoryVisibleCount(OPENCLAW_HISTORY_VISIBLE_STEP);
				if (agentChanged && routeOpenClawConversationIdRaw) {
					openClawIgnoredRouteConversationKeyRef.current =
						getOpenClawInvalidationKey(agentId, routeOpenClawConversationIdRaw);
					setSharedCurrentState(agentId, 0);
					if (!skipOpenClawFrontStoreMirror) {
						setFrontCurrentState(String(agentId), 0, false);
					}
					if (!disableOpenClawUrlSync) {
						syncConversationIdToUrl(agentId, 0, true);
					}
				}
			} else if (routeConversationId) {
				openClawExplicitSelectionRef.current = true;
			}
			const resolveKey = `${agentKey}:${routeConversationId || "default"}:mirror:${openClawMirrorResolveEpoch}`;
			if (openClawDefaultResolveKeyRef.current === resolveKey) {
				return;
			}
			openClawDefaultResolveKeyRef.current = resolveKey;

			const hasVisibleConversation = hasConversationId(
				openClawVisibleConversationIdRef.current,
			);
			if (!hasVisibleConversation || routeConversationId) {
				setOpenClawInitialConversationForCurrentAgent(undefined);
			}
			setOpenClawCurrentConversationResolving(
				!hasVisibleConversation && !routeConversationId,
			);
			void loadOpenClawConversationPage(0, { fresh: false });

			if (routeConversationId) {
				const routeConversation = {
					conversation_id: routeConversationId,
					agent_id: Number.isFinite(Number(agentId))
						? Number(agentId)
						: agentId,
					title: t("openclaw.history.current"),
					created_time: Date.now(),
					updated_time: Date.now(),
					top: 0,
					is_valid: 1,
				};
				mergeOpenClawConversationIntoStores(routeConversation);
				setSharedCurrentState(agentId, routeConversationId);
				if (!skipOpenClawFrontStoreMirror) {
					setFrontCurrentState(String(agentId), routeConversationId, false);
				}
				setOpenClawInitialConversationForCurrentAgent(routeConversationId);
				setOpenClawCurrentConversationResolving(false);
				return;
			}

			const resolveCurrentConversation = async () => {
				try {
					const response = await openclawApi.currentConversation(agentId, {
						ignoreMessage: true,
					});
					if (
						openClawSelectionAgentRef.current !== agentKey ||
						openClawDefaultResolveKeyRef.current !== resolveKey
					) {
						return;
					}

					const session = readOpenClawCurrentSession(response);
					if (openClawExplicitSelectionRef.current) {
						return;
					}
					const isHubManaged = isHubManagedOpenClawSession(session);
					if (!session || !isHubManaged) {
						if (!hasConversationId(openClawVisibleConversationIdRef.current)) {
							setSharedCurrentState(agentId, 0);
							if (!skipOpenClawFrontStoreMirror) {
								setFrontCurrentState(String(agentId), 0, false);
							}
						}
						return;
					}

					const conversation = buildOpenClawConversation(session, agentId);
					mergeOpenClawConversationIntoStores(conversation);
					setSharedCurrentState(agentId, conversation.conversation_id);
					if (!skipOpenClawFrontStoreMirror) {
						setFrontCurrentState(
							String(agentId),
							conversation.conversation_id,
							false,
						);
					}
					setOpenClawInitialConversationForCurrentAgent(
						conversation.conversation_id,
					);
					if (!disableOpenClawUrlSync) {
						syncConversationIdToUrl(
							agentId,
							conversation.conversation_id,
							true,
						);
					}
				} catch (error) {
					if (
						openClawSelectionAgentRef.current === agentKey &&
						openClawDefaultResolveKeyRef.current === resolveKey
					) {
						console.error(
							"Failed to resolve current OpenClaw conversation:",
							error,
						);
						if (!hasConversationId(openClawVisibleConversationIdRef.current)) {
							setSharedCurrentState(agentId, 0);
							if (!skipOpenClawFrontStoreMirror) {
								setFrontCurrentState(String(agentId), 0, false);
							}
						}
					}
				} finally {
					if (
						openClawSelectionAgentRef.current === agentKey &&
						openClawDefaultResolveKeyRef.current === resolveKey
					) {
						setOpenClawCurrentConversationResolving(false);
					}
				}
			};

			void resolveCurrentConversation();
		}, [
			agentId,
			conversationId,
			isOpenclaw,
			loadOpenClawConversationPage,
			mergeOpenClawConversationIntoStores,
			openClawMirrorResolveEpoch,
			routeOpenClawConversationIdRaw,
			routeOpenClawConversationId,
			setOpenClawInitialConversationForCurrentAgent,
			setFrontCurrentState,
			disableOpenClawUrlSync,
			skipOpenClawFrontStoreMirror,
			setSharedCurrentState,
		]);

		useEffect(() => {
			if (!isOpenclaw || openClawHealthy !== true) {
				openClawFreshCurrentResolveKeyRef.current = null;
				return;
			}

			const agentKey = String(agentId);
			const routeConversationId = routeOpenClawConversationId;
			const freshKey = `${agentKey}:${routeConversationId || "default"}:fresh`;
			if (openClawFreshCurrentResolveKeyRef.current === freshKey) return;
			openClawFreshCurrentResolveKeyRef.current = freshKey;

			void loadOpenClawConversationPage(0, { fresh: true });

			const reconcileFreshCurrentConversation = async () => {
				try {
					const response = await openclawApi.currentConversation(agentId, {
						ignoreMessage: true,
						fresh: true,
					});
					if (
						openClawSelectionAgentRef.current !== agentKey ||
						openClawFreshCurrentResolveKeyRef.current !== freshKey
					)
						return;
					const session = readOpenClawCurrentSession(response);
					if (!session || !isHubManagedOpenClawSession(session)) return;

					const conversation = buildOpenClawConversation(session, agentId);
					const visibleConversationId =
						openClawVisibleConversationIdRef.current;
					const canFillBlankConversation =
						!hasConversationId(visibleConversationId) &&
						!routeConversationId &&
						!openClawExplicitSelectionRef.current;
					mergeOpenClawConversationIntoStores(conversation, {
						visibleCache: canFillBlankConversation,
					});

					if (!canFillBlankConversation) {
						return;
					}

					setSharedCurrentState(agentId, conversation.conversation_id);
					if (!skipOpenClawFrontStoreMirror) {
						setFrontCurrentState(
							String(agentId),
							conversation.conversation_id,
							false,
						);
					}
					setOpenClawInitialConversationForCurrentAgent(
						conversation.conversation_id,
					);
					if (!disableOpenClawUrlSync) {
						syncConversationIdToUrl(
							agentId,
							conversation.conversation_id,
							true,
						);
					}
				} catch (error) {
					if (
						openClawSelectionAgentRef.current === agentKey &&
						openClawFreshCurrentResolveKeyRef.current === freshKey
					) {
						console.error(
							"Failed to refresh current OpenClaw conversation:",
							error,
						);
					}
				}
			};

			void reconcileFreshCurrentConversation();
		}, [
			agentId,
			conversationId,
			disableOpenClawUrlSync,
			isOpenclaw,
			loadOpenClawConversationPage,
			mergeOpenClawConversationIntoStores,
			openClawHealthy,
			openClawMirrorResolveEpoch,
			routeOpenClawConversationId,
			setOpenClawInitialConversationForCurrentAgent,
			setFrontCurrentState,
			setSharedCurrentState,
			skipOpenClawFrontStoreMirror,
		]);

		useEffect(() => {
			if (openClawHistoryOpen && isOpenclaw) {
				void loadOpenClawConversationPage(0, {
					fresh: openClawHealthy === true,
				});
			}
		}, [
			isOpenclaw,
			loadOpenClawConversationPage,
			openClawHealthy,
			openClawHistoryOpen,
		]);

		useEffect(() => {
			if (!isOpenclaw) return;
			void loadOpenClawConversationPage(0, { fresh: openClawHealthy === true });
		}, [isOpenclaw, loadOpenClawConversationPage, openClawHealthy]);

		// 切换会话/智能体时清空 outputfile 收藏状态缓存，避免跨会话误判
		useEffect(() => {
			checkedOutputFileIdsRef.current = new Set();
			setOutputFileBrowserState({ visible: false, currentFile: {} });
		}, [agentId, conversationId]);

	
    // 切换 Agent 时关闭历史会话侧边栏
    useEffect(() => {
      setShowHistory(false);
      setShowThinkKnowledge(false);
			setShowGuide(false)
      if (showSetting && onShowSettingChange) {
        onShowSettingChange(false);
      }
    }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

		useEffect(() => {
			if (!openClawHistoryOpen || !isOpenclaw || !hasSelectedConversationId)
				return;
			if (openClawHistoryUserScrolledRef.current) return;

			const nextVisibleCount = getOpenClawHistoryVisibleCountForSelected(
				visibleConversations,
				selectedConversationId,
				(item: any) => item.conversation_id,
				openClawHistoryVisibleCount,
			);
			if (nextVisibleCount > openClawHistoryVisibleCount) {
				setOpenClawHistoryVisibleCount(nextVisibleCount);
				return;
			}

			const selectedKey = String(selectedConversationId);
			const scrollKey = `${String(agentId)}:${selectedKey}`;
			if (
				openClawHistoryUserScrolledRef.current ||
				openClawHistorySelectedScrollKeyRef.current === scrollKey
			) {
				return;
			}

			const frame = window.requestAnimationFrame(() => {
				const container = openClawHistoryListRef.current;
				if (!container) return;

				const target = Array.from(
					container.querySelectorAll<HTMLElement>("[data-conversation-id]"),
				).find((item) => item.dataset.conversationId === selectedKey);
				if (target) {
					target.scrollIntoView?.({ block: "center" });
					openClawHistorySelectedScrollKeyRef.current = scrollKey;
				}
			});

			return () => {
				window.cancelAnimationFrame(frame);
			};
		}, [
			hasSelectedConversationId,
			agentId,
			isOpenclaw,
			openClawHistoryOpen,
			openClawHistoryVisibleCount,
			selectedConversationId,
			visibleConversations,
		]);

		const refreshOpenClawStatus = useCallback(
			async ({ showLoading = false } = {}) => {
				if (!isOpenclaw) return null;
				const agentKey = String(agentId);
				const requestSeq = openClawStatusRequestSeqRef.current + 1;
				openClawStatusRequestSeqRef.current = requestSeq;
				openClawStatusAgentKeyRef.current = agentKey;
				if (showLoading) {
					setOpenClawStatusLoading(true);
				}

				try {
					const response = await loadOpenClawStatus(agentId);
					if (
						openClawStatusAgentKeyRef.current !== agentKey ||
						openClawStatusRequestSeqRef.current !== requestSeq
					) {
						return null;
					}

					const payload = getOpenClawPayload(response);
					const connectionState = getOpenClawConnectionState(payload);
					openClawConnectionStateRef.current = connectionState;
					setOpenClawStatusPayload(payload);
					setOpenClawConnectionState(connectionState);
					setOpenClawStatusLoading(false);
					return { payload, connectionState };
				} catch {
					if (
						openClawStatusAgentKeyRef.current !== agentKey ||
						openClawStatusRequestSeqRef.current !== requestSeq
					) {
						return null;
					}

					openClawConnectionStateRef.current = "disconnected";
					setOpenClawStatusPayload(DISCONNECTED_OPENCLAW_STATUS);
					setOpenClawConnectionState("disconnected");
					setOpenClawStatusLoading(false);
					return {
						payload: DISCONNECTED_OPENCLAW_STATUS,
						connectionState: "disconnected" as const,
					};
				}
			},
			[agentId, isOpenclaw],
		);

		useEffect(() => {
			if (!isOpenclaw) {
				openClawStatusRequestSeqRef.current += 1;
				openClawStatusAgentKeyRef.current = null;
				openClawConnectionStateRef.current = "checking";
				setOpenClawConnectionState("checking");
				setOpenClawStatusPayload(null);
				setOpenClawStatusLoading(false);
				return;
			}

			const agentKey = String(agentId);
			let stopped = false;
			let timer: number | null = null;
			openClawStatusRequestSeqRef.current += 1;
			openClawStatusAgentKeyRef.current = agentKey;
			openClawConnectionStateRef.current = "checking";
			setOpenClawConnectionState("checking");
			setOpenClawStatusPayload(null);
			setOpenClawStatusLoading(true);

			const schedule = (connectionState: OpenClawConnectionState) => {
				if (stopped || openClawStatusAgentKeyRef.current !== agentKey) return;
				const delay =
					connectionState === "connected"
						? OPENCLAW_STATUS_CONNECTED_POLL_INTERVAL
						: OPENCLAW_STATUS_RETRY_POLL_INTERVAL;
				timer = window.setTimeout(() => {
					void run(false);
				}, delay);
			};

			const run = async (showLoading = false) => {
				const result = await refreshOpenClawStatus({ showLoading });
				if (stopped || openClawStatusAgentKeyRef.current !== agentKey) return;
				schedule(result?.connectionState || openClawConnectionStateRef.current);
			};

			void run(true);
			return () => {
				stopped = true;
				openClawStatusRequestSeqRef.current += 1;
				if (timer) {
					window.clearTimeout(timer);
				}
			};
		}, [agentId, isOpenclaw, refreshOpenClawStatus]);

		const handleOpenClawHistoryScroll = useCallback(
			(event: any) => {
				openClawHistoryUserScrolledRef.current = true;
				const target = event.currentTarget;
				const pagination = openClawConversationPagination;
				const isNearBottom =
					target.scrollHeight - target.scrollTop - target.clientHeight <= 24;
				const action = getOpenClawHistoryScrollAction({
					isNearBottom,
					loading:
						openClawHistoryLoading ||
						openClawHistoryFetching ||
						openClawHistoryLoadingRef.current,
					visibleCount: openClawHistoryVisibleCount,
					cachedCount: openClawConversationCache.length,
					hasMoreRemote: Boolean(pagination?.hasMore),
				});

				if (action === "show-more") {
					setOpenClawHistoryVisibleCount((current) =>
						getNextOpenClawHistoryVisibleCount(
							current,
							openClawConversationCache.length,
						),
					);
					return;
				}

				if (action !== "fetch-more") return;

				const nextOffset =
					typeof pagination.nextOffset === "number"
						? pagination.nextOffset
						: openClawConversationCache.length;
				void loadOpenClawConversationPage(nextOffset);
			},
			[
				loadOpenClawConversationPage,
				openClawConversationCache.length,
				openClawConversationPagination,
				openClawHistoryFetching,
				openClawHistoryLoading,
				openClawHistoryVisibleCount,
			],
		);

		// 判断是否为 Completion 模式
		const isCompletion = useMemo(() => {
			return currentAgent?.custom_config_obj?.agent_mode === "completion";
		}, [currentAgent]);

		// 返回处理
		const handleBack = useCallback(() => {
			const from = searchParams.get("from");
			if (from === "my") {
				navigate({ pathname: "/agent", search: "?from=my" });
			} else {
				navigate("/agent");
			}
		}, [navigate, searchParams]);

		// 处理下一个智能体准备参数 - 用于 RelatedScene 的 field_mapping
		const handleNextAgent = useCallback(
			async (item: any, parameters: Record<string, string>) => {
				// 先检查智能体是否存在于 store 中
				const targetAgent = agentStore.findAgentByAgentId(item.agent_id);
				if (!targetAgent) {
					message.warning(t("agent.not_found"));
					return;
				}

				chatViewRef.current?.newConversation();

				// 设置下一个智能体的准备参数
				convStore.setNextAgentPrepare({
					agent_id: item.agent_id,
					execution_rule: item.execution_rule,
					is_workflow:
						typeof item.is_workflow === "boolean" ? item.is_workflow : true,
					parameters,
				});
				// 切换到新智能体（isReplace=false 阻止 setRouter 触发页面刷新，由后续 navigate 处理跳转）
				convStore.setCurrentState(item.agent_id, "", false);

				const isAgentOpenclaw = isOpenClawAgent(item);
				const search = isAgentOpenclaw
					? `?agent_id=${item.agent_id}&hide_bottom_actions=true&type=openclaw`
					: `?agent_id=${item.agent_id}`;

				// 软件模式下，先添加到快捷方式列表
				if (isSoftStyle) {
					try {
						await agentStore.addShortcut(item.agent_id);
					} catch (err) {
						console.error("添加快捷方式失败:", err);
					}
				}
				navigate({
					pathname: isSoftStyle ? "/agent/agent" : "/chat",
					search,
				});
			},
			[agentStore, convStore, navigate, isSoftStyle],
		);

		// 当跳转到同一个智能体时，重新初始化
		const handleInitAgent = useCallback(() => {
			// 重新加载当前智能体，清空消息列表
			chatViewRef.current?.reload();
		}, []);

		// 关闭所有侧边面板(用于面板互斥)
		// 注意:必须在 handleOpenOutputFilePreview / handlePreviewOutputFile 之前声明
		// 这两个 useCallback 的 deps 会引用 closeAllSidePanels(否则触发 TDZ)
		const closeAllSidePanels = useCallback(() => {
			setShowGuide(false);
			setOpenClawPanelOpen(false);
			onShowSettingChange?.(false);
			setOutputFilePreview({ visible: false, currentFile: {} });
			setOutputFileBrowserState({ visible: false, currentFile: {} });
		}, [
			setShowGuide,
			setOpenClawPanelOpen,
			onShowSettingChange,
			setOutputFilePreview,
			setOutputFileBrowserState,
		]);

		const handleOpenOutputFilePreview = useCallback(
			(file: OutputFile, _message: Message) => {
				const fileUrl = resolveOpenClawOutputFilePreviewUrl(file, accessToken);
				const downloadUrl = resolveOpenClawOutputFileDownloadUrl(
					file,
					accessToken,
				);
				const inlinePreview = fileUrl
					? null
					: createOpenClawInlineOutputFilePreview(file);
				const previewUrl = fileUrl || inlinePreview?.url;
				if (!previewUrl) return;

				const fileName = getOutputFileName(file);
				closeAllSidePanels();
				setOutputFilePreview({
					visible: true,
					currentFile: {
						id: file.id,
						name: fileName,
						file_url: previewUrl,
						download_url: downloadUrl || previewUrl,
						file_ext: fileName.split(".").pop() || "",
						content: inlinePreview?.content,
					},
				});
			},
			[accessToken, closeAllSidePanels],
		);

		// 添加回答到知识库（通用处理，支持非 OpenClaw 模式）
		const handleAddAnswerAsMd = useCallback(
			(message: Message) => {
				const answer =
					(isOpenclaw
						? getOpenClawAnswerForKnowledge(message)
						: message.answer?.trim()) || "";
				if (!answer) return;
				addAnswerAsMdRef.current?.open({
					answer,
					question: isOpenclaw
						? getOpenClawQuestionForKnowledge(message)
						: message.question?.trim() ||
							message.original_question?.trim() ||
							"聊天回答",
				});
			},
			[isOpenclaw],
		);

		// 非 OpenClaw 模式：outputfile 点击预览（参考 IndexChat）
		// 状态本身在顶部声明，这里只放 useCallback
		const handlePreviewOutputFile = useCallback(
			(file: OutputFile) => {
				// 优先用 file.url，兜底用 download_url / signed_download_url
				const rawUrl =
					file.url || file.signed_download_url || file.download_url || "";
				if (!rawUrl) return;
				let resolvedUrl = rawUrl;
				try {
					const parsed = new URL(rawUrl);
					// 已有 query 强制覆盖 token 参数
					if (accessToken) {
						parsed.searchParams.set("token", accessToken);
					}
					resolvedUrl = parsed.toString();
				} catch {
					// 不是合法 URL，原样使用
				}
				closeAllSidePanels();
				setOutputFileBrowserState({
					visible: true,
					currentFile: {
						id: file.id,
						name: file.file_name || `文件 ${file.id}`,
						file_url: resolvedUrl,
						file_ext: file.file_name?.split(".").pop() || "",
					},
				});
			},
			[accessToken, closeAllSidePanels],
		);

		const closeOutputFileBrowser = useCallback(() => {
			setOutputFileBrowserState({ visible: false, currentFile: {} });
		}, []);

		const downloadOutputFileBrowser = useCallback(() => {
			const file = outputFileBrowserState.currentFile;
			if (!file.file_url) return;
			const link = document.createElement("a");
			link.href = file.file_url;
			link.download = file.name || "download";
			link.target = "_blank";
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
		}, [outputFileBrowserState.currentFile]);

		/**
		 * 检查输出文件收藏状态（由 OutputFiles 组件进入视野时触发）
		 * 复用 chatViewRef.updateMessage 把结果写回消息的 outputFiles[*].is_favorite
		 */
		const handleCheckOutputFilesFavorite = useCallback(
			(fileIds: string[]) => {
				if (!hasKnowledgeBase) return;
				const unchecked = fileIds.filter(
					(id) => !checkedOutputFileIdsRef.current.has(id),
				);
				if (unchecked.length === 0) return;
				unchecked.forEach((id) => checkedOutputFileIdsRef.current.add(id));

				mySpaceApi
					.check({
						resource_type: 9999, // 上传文件类型
						ids: unchecked.slice(0, 100),
					})
					.then((res) => {
						const favorited = new Set(
							(res.favorited_ids || []).map((id) => String(id)),
						);
						chatViewRef.current?.updateMessage((msg) => {
							if (!msg.outputFiles?.length) return msg;
							return {
								...msg,
								outputFiles: msg.outputFiles.map((f: any) => ({
									...f,
									is_favorite: favorited.has(String(f.id)),
								})),
							};
						});
					})
					.catch(() => {});
			},
			[hasKnowledgeBase],
		);

		/**
		 * 切换输出文件收藏状态
		 */
		const handleToggleOutputFileFavorite = useCallback(
			async (file: any, targetMessage: Message) => {
				if (!hasKnowledgeBase) return;
				const previousFavorite = Boolean(file.is_favorite);
				// 乐观更新
				chatViewRef.current?.updateMessage((msg) => {
					if (msg.id !== targetMessage.id || !msg.outputFiles?.length)
						return msg;
					return {
						...msg,
						outputFiles: msg.outputFiles.map((f: any) =>
							f.id === file.id ? { ...f, is_favorite: !previousFavorite } : f,
						),
					};
				});
				try {
					await favoritesApi.toggle({
						resource_type: 9999,
						resource_id: String(file.id),
					});
					message.success(previousFavorite ? "已取消收藏" : "收藏成功");
				} catch (error) {
					// 回滚乐观更新
					chatViewRef.current?.updateMessage((msg) => {
						if (msg.id !== targetMessage.id || !msg.outputFiles?.length)
							return msg;
						return {
							...msg,
							outputFiles: msg.outputFiles.map((f: any) =>
								f.id === file.id ? { ...f, is_favorite: previousFavorite } : f,
							),
						};
					});
					message.error("操作失败");
				}
			},
			[hasKnowledgeBase],
		);

		// 文件点击处理：跳转到知识库文件详情页
		const handleFileClick = useCallback((file: any) => {
			if (file.isfolder) return;
			const libraryId = file.library_id;
			const fileId = file.file_id || file.id;
			if (libraryId && fileId) {
				const url = buildKnowledgeFileUrl(libraryId, fileId);
				window.open(url, "_blank", "noopener,noreferrer");
			}
		}, []);

		// ProcessFlow 知识面板点击处理（打开右侧 ThinkKnowledge 抽屉）
		const handleOpenKnowledgePanel = useCallback((data: KnowledgePanelData) => {
			// knowledge_search: 打开知识检索结果侧边栏
			if (data.type === "knowledge_search") {
				setShowThinkKnowledge(true);
				// 先传递所有检索结果
				if (data.files && data.files.length > 0) {
					setTimeout(() => {
						thinkKnowledgeRef.current?.updateResults(data.files || []);
					}, 100);
				}
				return true;
			}
			// source_click: 打开侧边栏，传递完整数据并选中对应文件
			if (data.type === "source_click" && data.source) {
				setShowThinkKnowledge(true);
				// 如果有完整的 files 数据，先更新，再选中
				if (data.files && data.files.length > 0) {
					setTimeout(() => {
						thinkKnowledgeRef.current?.updateResults(data.files || []);
						// 等数据更新后再选中
						setTimeout(() => {
							thinkKnowledgeRef.current?.selectItem(data.source!);
						}, 50);
					}, 100);
				} else {
					// 没有完整数据时，仅尝试选中（可能失败）
					setTimeout(() => {
						thinkKnowledgeRef.current?.selectItem(data.source!);
					}, 100);
				}
				return true;
			}
			// scope_narrowing: 跳转到知识库首页（新页面）
			if (data.type === "scope_narrowing" && data.source?.library_id) {
				const libraryId = data.source.library_id;
				const url = buildUrl(`/library/${libraryId}`);
				window.open(url, "_blank", "noopener,noreferrer");
				return true;
			}
			return false;
		}, []);

		const handleCloseOutputFilePreview = useCallback(() => {
			setOutputFilePreview((previous) => {
				if (previous.currentFile.file_url?.startsWith("blob:")) {
					URL.revokeObjectURL(previous.currentFile.file_url);
				}
				return {
					visible: false,
					currentFile: {},
				};
			});
		}, []);

		useEffect(() => {
			if (!outputFilePreview.visible) {
				outputFilePreviewScopeKeyRef.current = outputFilePreviewScopeKey;
				return;
			}
			if (!outputFilePreviewScopeKeyRef.current) {
				outputFilePreviewScopeKeyRef.current = outputFilePreviewScopeKey;
				return;
			}
			if (outputFilePreviewScopeKeyRef.current !== outputFilePreviewScopeKey) {
				outputFilePreviewScopeKeyRef.current = outputFilePreviewScopeKey;
				handleCloseOutputFilePreview();
			}
		}, [
			handleCloseOutputFilePreview,
			outputFilePreview.visible,
			outputFilePreviewScopeKey,
		]);

		const handleDownloadOutputFile = useCallback(() => {
			const fileUrl =
				outputFilePreview.currentFile.download_url ||
				outputFilePreview.currentFile.file_url;
			if (!fileUrl) return;
			const link = document.createElement("a");
			link.href = fileUrl;
			link.download = outputFilePreview.currentFile.name || "download";
			link.target = "_blank";
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
		}, [
			outputFilePreview.currentFile.download_url,
			outputFilePreview.currentFile.file_url,
			outputFilePreview.currentFile.name,
		]);

		useEffect(
			() => () => {
				const fileUrl = outputFilePreview.currentFile.file_url;
				if (fileUrl?.startsWith("blob:")) {
					URL.revokeObjectURL(fileUrl);
				}
			},
			[outputFilePreview.currentFile.file_url],
		);

		// 处理 next_agent_prepare - 自动填充输入或自动发送
		const nextAgentPrepare = useConversationStore(
			(state) => state.next_agent_prepare,
		);
		useEffect(() => {
			const prepare = nextAgentPrepare;

			// 只有当 prepare.agent_id 与当前 agentId 匹配时才处理
			// 确保导航完成、新组件挂载后才执行，而不是在旧组件上执行
			if (prepare.agent_id && String(prepare.agent_id) === String(agentId)) {
				const inputText = prepare.parameters?.input || "";
				if (inputText) {
					// 填充输入框
					chatViewRef.current?.setPrompt(inputText);
				}
				// execution_rule 是 auto，自动发送消息
				if (prepare.execution_rule === "auto" && inputText) {
					chatViewRef.current?.sendMessage(inputText);
				}
				// 清空准备参数
				convStore.setNextAgentPrepare({});
			}
		}, [nextAgentPrepare, convStore, agentId]);

		// 更多操作
		const handleMore = useCallback(
			async (command: string) => {
				if (command === "add-shortcut") {
					await shortcutsStore.addShortcut(
						"agent",
						String(currentAgent?.agent_id),
					);
				} else if (command === "remove-shortcut") {
					await shortcutsStore.removeShortcut(
						"agent",
						String(currentAgent?.agent_id),
					);
				}
			},
			[shortcutsStore, currentAgent],
		);

		// 图片错误处理
		const handleImageError = useCallback(
			(e: React.SyntheticEvent<HTMLImageElement>) => {
				const target = e.target as HTMLImageElement;
				const fallback = getPublicPath(DEFAULT_IMG);
				if (target.src.endsWith(fallback)) return;
				target.src = fallback;
			},
			[],
		);

		const lockOpenClawEmbeddedPreviewToCurrentAgent =
			embeddedOpenClawPreview && isOpenclaw;

		// 透传给 ChatView 的功能分组(已收敛到 ChatViewProps 的 feature group)。
		// - feedback.enabled 不在此处聚合,见 <ChatView feedback={{ enabled: !isOpenclaw }} />
		// - menu.* 由 ChatView 内部基于 feedbackEnabled / shareEnabled / openclawEnabled 派生,不在此处提供
		const features = useMemo(
			() => ({
				history: !isOpenclaw && !isIndexRoute,
				newConversation: !isOpenclaw && !isIndexRoute,
				languageSwitcher: false,
				fileUpload:
					isOpenclaw ||
					currentAgent?.settings_obj?.file_parse?.enable ||
					currentAgent?.settings_obj?.image_parse?.enable,
				guide: true, // 工作台入口也需要显示使用指引面板
				share: !isOpenclaw,
				messageMenu: true,
				skipInitialLoad: isIndexRoute ? false : !isOpenclaw,
				enableDragUpload: false,
				allowMultiple: true,
				openclaw: isOpenclaw,
				showRelatedScene: !isOpenclaw,
				allowSendWithFiles:
					isOpenclaw ||
					["53ai_agent", "fastgpt_agent"].includes(
						currentAgent?.custom_config_obj?.agent_type,
					),
				enablePasteUpload: true,
				openclawInputDisabled: isOpenclaw && openClawHealthy !== true,
				openclawInputDisabledReason:
					isOpenclaw && openClawHealthy !== true
						? getOpenClawInputDisabledReason(
								openClawConnectionState,
								openClawGatewayName,
								t,
							)
						: undefined,
				initialConversationResolving:
					isOpenclaw && openClawCurrentConversationResolving,
				showWelcome: !isIndexRoute,
				indexWelcomeLayout: isIndexRoute,
				timeout: undefined as number | undefined,
			}),
			[
				currentAgent,
				isOpenclaw,
				openClawHealthy,
				openClawConnectionState,
				openClawCurrentConversationResolving,
				openClawGatewayName,
				isIndexRoute,
				t,
			],
		);

		// 文件上传函数
		const uploadRequest = useCallback(async (file: File) => {
			const res = await uploadApi.upload(file, "my_uploads");
			const previewUrl = `${API_HOST}/api/preview/${res.data.preview_key || ""}`;
			return {
				id: res.data.id,
				url: previewUrl,
				name: res.data.file_name,
				file_name: res.data.file_name,
				size: res.data.size,
				mime_type: res.data.mime_type,
				preview_key: res.data.preview_key,
				preview_url: previewUrl,
				signed_download_url: previewUrl,
			};
		}, []);

		// 文件类型过滤
		const acceptTypes = useMemo(() => {
			let accept = "";
			const settingsObj = currentAgent?.settings_obj || {};
			if (settingsObj.file_parse?.enable) {
				accept +=
					".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.html,.json,.xml,.md";
			}
			if (settingsObj.image_parse?.enable) {
				accept += ",image/*";
			}
			return accept || "*/*";
		}, [currentAgent]);

		// 分享回调
		const handleShare = async (
			messageIds: (string | number)[],
			convId: string | number,
			selectAll: boolean,
		): Promise<string> => {
			const res = await sharesApi.create({
				message_ids: messageIds as any,
				conversation_id: convId,
				select_all: selectAll,
			});
			const link = buildUrl(`/share/chat?share_id=${res.share_id}&from=agent`);
			return link;
		};

		// 智能体选择回调
		const handleAgentSelect = (agent: any) => {
			const isAgentOpenclaw = isOpenClawAgent(agent);
			if (isAgentOpenclaw) {
				navigate({
					pathname: "/chat",
					search: `?agent_id=${agent.agent_id}&hide_bottom_actions=true&type=openclaw`,
				});
			} else {
				navigate({
					pathname: "/chat",
					search: `?agent_id=${agent.agent_id}`,
				});
			}
		};

		const handleOpenClawConversationSelect = useCallback(
			(conv: any) => {
				const pluginConnected =
					openClawHealthy === true ||
					openClawConnectionStateRef.current === "connected";
				if (!pluginConnected && !hasOpenClawCachedHistory(conv)) {
					return;
				}
				const targetAgentId = conv.agent_id || agentId;
				const selectedConversation = pluginConnected
					? markOpenClawConversationCached(conv)
					: conv;
				openClawInvalidatedConversationIdsRef.current.delete(
					getOpenClawInvalidationKey(targetAgentId, conv.conversation_id),
				);
				openClawExplicitSelectionRef.current = true;
				setOpenClawConversationCache((current) =>
					mergeOpenClawConversations(current, [selectedConversation]),
				);
				sharedConvStore.setCurrentState(targetAgentId, conv.conversation_id);
				if (!skipOpenClawFrontStoreMirror) {
					convStore.setCurrentState(targetAgentId, conv.conversation_id, false);
				}
				if (!disableOpenClawUrlSync) {
					syncConversationIdToUrl(targetAgentId, conv.conversation_id, true);
				}
				setOpenClawHistoryOpen(false);
			},
			[
				agentId,
				convStore,
				disableOpenClawUrlSync,
				openClawHealthy,
				sharedConvStore,
				skipOpenClawFrontStoreMirror,
			],
		);

		const handleOpenClawConversationResolved = useCallback(
			(resolvedConversation: {
				conversation_id?: string | number;
				title?: string;
				question?: string;
				created_time?: number;
				updated_time?: number;
			}) => {
				if (!isOpenclaw) return;
				const resolvedConversationId = String(
					resolvedConversation?.conversation_id || "",
				);
				if (!hasConversationId(resolvedConversationId)) return;

				const timestamp =
					resolvedConversation.updated_time ||
					resolvedConversation.created_time ||
					Date.now();
				const numericAgentId = Number(agentId);
				const conversation = {
					conversation_id: resolvedConversationId,
					agent_id: Number.isFinite(numericAgentId) ? numericAgentId : agentId,
					title: buildOpenClawOptimisticHubTitle(
						openClawUserDisplayName,
						resolvedConversation.title,
						resolvedConversation.question,
					),
					created_time: resolvedConversation.created_time || timestamp,
					updated_time: timestamp,
					top: 0,
					is_valid: 1,
					has_cached_history: true,
					raw: {
						id: resolvedConversationId,
						title: resolvedConversation.title,
						has_cached_history: true,
					},
				};

				openClawInvalidatedConversationIdsRef.current.delete(
					getOpenClawInvalidationKey(agentId, resolvedConversationId),
				);
				openClawExplicitSelectionRef.current = true;
				mergeOpenClawConversationIntoStores(conversation, {
					visibleCache: true,
				});
				setSharedCurrentState(agentId, resolvedConversationId);
				if (!skipOpenClawFrontStoreMirror) {
					setFrontCurrentState(String(agentId), resolvedConversationId, false);
				}
				setOpenClawInitialConversationForCurrentAgent(resolvedConversationId);
				setOpenClawCurrentConversationResolving(false);
				if (!disableOpenClawUrlSync) {
					syncConversationIdToUrl(agentId, resolvedConversationId, true);
				}
				eventBus.emit(EVENT_NAMES.SHORTCUT_UPDATED);
			},
			[
				agentId,
				disableOpenClawUrlSync,
				isOpenclaw,
				mergeOpenClawConversationIntoStores,
				openClawUserDisplayName,
				setOpenClawInitialConversationForCurrentAgent,
				setFrontCurrentState,
				setSharedCurrentState,
				skipOpenClawFrontStoreMirror,
			],
		);

		// 新分组 props：保留资源权限入口，内部用户可走 scopes API。
		const handleCheckAccess = useCallback(
			(resourceId?: string | number): boolean | Promise<boolean> => {
				const isPersonalAgent =
					searchParams.get("from") === "my" ||
					Number(currentAgent?.owner_id || 0) > 0;
				if (isPersonalAgent) {
					return true;
				}

				if (isInternal && typeof checkUserPermissionAsync === "function") {
					return checkUserPermissionAsync({
						resourceId: resourceId || currentAgent?.agent_id,
						resourceType: "agent",
					});
				}
				return checkUserPermission({
					groupIds: currentAgent?.user_group_ids || [],
				});
			},
			[currentAgent, isInternal, searchParams],
		);

		useImperativeHandle(
			ref,
			() => ({
				showUseCase: () => {
					setShowGuide(true);
					// completion 模式需要同步触发 CompletionView 的状态
					if (isCompletion && externalOnGuideChangeRef.current) {
						externalOnGuideChangeRef.current(true);
					}
				},
				hideUseCase: () => {
					setShowGuide(false);
					if (isCompletion && externalOnGuideChangeRef.current) {
						externalOnGuideChangeRef.current(false);
					}
				},
				showShare: () => chatViewRef.current?.showShare(),
			}),
			[isCompletion],
		);

    // unify-chat-adapters：原 pluginConfig / pluginAdapters useMemo 全部删除，
    // 所有 adapter 字段已并入 chatAdapters（单例）。ChatContainer 唯一额外
    // 动态覆盖的只有 conversationApi（OpenClaw 切换）。
    const chatAdaptersForAgent = useMemo(() => ({
      ...chatAdapters,
      conversationApi: isOpenclaw
        ? createOpenClawConversationApiAdapter(agentId)
        : chatAdapters.conversationApi,
      skillApi: {
        listMySkills: async () => {
          // 从 store 读取，如果没有则请求
          const store = useSkillsStore.getState();
          let list = store.agentSkillsMap.get(String(agentId));
          if (!list) {
            list = await store.loadAgentSkills(agentId);
          }
          return (list || [])
            .map((skill) => ({
              id: skill.id,
              skill_id: skill.skill_name,
              skill_name: skill.skill_name,
              display_name: skill.display_name,
              admin_status: skill.admin_status,
            }));
        },
        openSkillLibrary: () => navigate("/skills"),
      },
    }), [agentId, isOpenclaw, navigate]);

		// 自定义 Header - 使用原来的样式
		const renderHeader = useCallback(
			({
				agentInfo,
				showGuide: externalShowGuide,
				onGuideChange: externalOnGuideChange,
			}: {
				agentInfo: any;
				lang: string;
				setLang: (lang: string) => void;
				showGuide?: boolean;
				onGuideChange?: (show: boolean) => void;
			}) => {
				if (embeddedOpenClawPreview && isOpenclaw) {
					const gatewayName = openClawGatewayName;
					const statusText =
						openClawHealthy === true
							? t("openclaw.status.connected", { gatewayName })
							: openClawHealthy === false
								? t("openclaw.status.disconnected", { gatewayName })
								: t("openclaw.status.checking", { gatewayName });

					return (
						<header className="flex-none h-[60px] border-b bg-white">
							<div className="openclaw-embedded-header grid h-full items-center gap-3 px-4">
								<div className="openclaw-embedded-header-title flex min-w-0 items-center text-base font-medium text-[#1F2123]">
									预览与调试
								</div>
								<div
									data-testid="openclaw-history-selector"
									className="openclaw-embedded-history-selector min-w-0 justify-self-center w-full max-w-[240px]"
								>
									<Popover
										rootClassName="openclaw-history-popover-root"
										trigger="click"
										placement="bottom"
										open={openClawHistoryOpen}
										onOpenChange={handleOpenClawHistoryOpenChange}
										arrow={false}
										styles={{ body: { padding: 0 } } as any}
										content={
											<div className="openclaw-history-popover w-full rounded-[14px] bg-white p-3 shadow-[0_12px_30px_rgba(31,33,35,0.10)]">
												{openClawConversationOptions.length > 0 ? (
													<div
														ref={openClawHistoryListRef}
														data-testid="openclaw-history-list"
														className="max-h-[440px] overflow-y-auto pr-1"
														onScroll={handleOpenClawHistoryScroll}
													>
														{openClawConversationOptions.map(
															(item: any, index: number) => {
																const selected =
																	String(item.conversation_id) ===
																	String(selectedConversationId);
																const unavailableOffline =
																	isOpenClawConversationUnavailableOffline(
																		item,
																		openClawHealthy,
																	);
																const displayTitle =
																	getOpenClawConversationDisplayTitle(
																		item,
																		t("openclaw.history.no_title"),
																	);
																return (
																	<button
																		key={
																			item.conversation_id ||
																			`openclaw-embedded-conv-${index}`
																		}
																		type="button"
																		data-conversation-id={String(
																			item.conversation_id || "",
																		)}
																		disabled={unavailableOffline}
																		aria-disabled={unavailableOffline}
																		title={
																			unavailableOffline
																				? t(
																						"openclaw.history.connect_plugin_first",
																					)
																				: displayTitle
																		}
																		className={`openclaw-history-row flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[15px] leading-5 transition ${
																			unavailableOffline
																				? "cursor-not-allowed text-[#A0A7B5] opacity-70"
																				: selected
																					? "bg-[#F4F5F7] text-[#2F3136]"
																					: "text-[#2F3136] hover:bg-[#F7F8FA]"
																		}`}
																		onClick={() =>
																			handleOpenClawConversationSelect(item)
																		}
																	>
																		<TopicIcon
																			className={
																				unavailableOffline
																					? "opacity-25"
																					: selected
																						? "opacity-70"
																						: "opacity-45"
																			}
																		/>
																		<span className="truncate">
																			{displayTitle}
																		</span>
																	</button>
																);
															},
														)}
														{(openClawHistoryVisibleCount <
															visibleConversations.length ||
															openClawConversationPagination?.hasMore) && (
															<div className="px-3 py-2 text-center text-xs text-[#A0A7B5]">
																{openClawHistoryLoading ||
																openClawHistoryFetching
																	? t("openclaw.history.loading")
																	: t("openclaw.history.load_more_on_scroll")}
															</div>
														)}
													</div>
												) : openClawHealthy !== true ? (
													<div className="px-3 py-5 text-center text-sm text-[#A0A7B5]">
														{getOpenClawInputDisabledReason(
															openClawConnectionState,
															gatewayName,
															t,
														)}{" "}
														{t("openclaw.history.server_cache_empty_suffix")}
													</div>
												) : (
													<div className="px-3 py-5 text-center text-sm text-[#A0A7B5]">
														{t("openclaw.history.empty")}
													</div>
												)}
											</div>
										}
									>
										<button
											type="button"
											className="openclaw-history-trigger flex h-10 w-full min-w-0 items-center gap-3 rounded-[12px] border border-[#E6EBF2] bg-[#F5F7FA] px-4 text-left text-[15px] leading-5 text-[#2F3136] shadow-[0_2px_8px_rgba(31,33,35,0.04)] transition hover:bg-[#EEF1F5]"
										>
											<TopicIcon className="opacity-85" />
											<span className="min-w-0 flex-1 truncate">
												{hasSelectedConversationId && currentConv
													? getOpenClawConversationDisplayTitle(
															currentConv,
															t("openclaw.history.new"),
														)
													: t("openclaw.history.new")}
											</span>
											{openClawHistoryOpen ? (
												<UpOutlined className="shrink-0 text-xs text-[#333333]" />
											) : (
												<DownOutlined className="shrink-0 text-xs text-[#333333]" />
											)}
										</button>
									</Popover>
								</div>
								<div className="flex min-w-0 justify-end">
									<span
										className={`openclaw-embedded-status-badge inline-flex max-w-full items-center rounded-md px-2.5 py-1 text-xs font-medium ${
											openClawHealthy === true
												? "bg-[#EAFBF1] text-[#24A860]"
												: openClawHealthy === false
													? "bg-[#FFF1F0] text-[#D9363E]"
													: "bg-[#F4F6FA] text-[#7A8494]"
										}`}
										title={statusText}
									>
										<span className="openclaw-embedded-status-dot mr-1 text-sm leading-none">
											•
										</span>
										<span className="openclaw-embedded-status-text min-w-0 truncate">
											{statusText}
										</span>
									</span>
								</div>
							</div>
						</header>
					);
				}

				if (hideMenuHeader) return null;

				// 追踪 CompletionView 的 onGuideChange 回调
				externalOnGuideChangeRef.current = externalOnGuideChange ?? null;

				// completion 模式由 CompletionView 内部处理面板，使用外部的 onGuideChange
				// 非 completion 模式由 ChatContainer 自己渲染面板，使用内部的 setShowGuide
				const setGuideVisible =
					isCompletion && externalOnGuideChange
						? externalOnGuideChange
						: setShowGuide;

				return (
					<header
						className={`flex-none h-16 ${isIndexRoute ? "" : "border-b"} sticky top-0 z-10 bg-white ${isIndexRoute && showHistory ? "" : ""}`}
					>
						<div className="relative mx-auto flex h-full items-center justify-between px-4">
							<div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
								{/* 工作台入口 + 普通智能体：显示历史/新建按钮 */}
								{isIndexRoute && !showHistory && !isOpenclaw ? (
									<>
										<div className="flex-none flex items-center gap-3">
											<div
												className="size-7 cursor-pointer rounded flex items-center justify-center hover:bg-[#F5F5F7]"
												onClick={() => {
													if (!checkLoginStatus()) return;
													setShowHistory(true);
												}}
											>
												<SvgIcon name="history" size={16} />
											</div>
											<div
												className="size-7 cursor-pointer rounded flex items-center justify-center hover:bg-[#F5F5F7]"
												onClick={() => {
													if (!checkLoginStatus()) return;
													chatViewRef.current?.newConversation();
													setShowHistory(false);
												}}
											>
												<SvgIcon name="add-chat" size={16} />
											</div>
										</div>
										<div className="h-4 border-l" />
									</>
								) : isIndexRoute ? null : (
									<>
										<ExpandSidebarButton />
										<div className="h-4 border-l" />
									</>
								)}
								{isSoftStyle && !isIndexRoute && (
									<div
										className="flex-none size-7 rounded-md flex-center cursor-pointer max-md:hidden hover:bg-[#ECEDEE]"
										onClick={handleBack}
									>
										<LeftOutlined className="text-regular cursor-pointer" />
									</div>
								)}
								{isOpenclaw ? (
									<div className="flex min-w-0 items-center gap-2">
										<img
											className="size-5 shrink-0 rounded-full"
											src={currentAgentLogo}
											alt={agentInfo?.name || "Agent"}
											onError={handleImageError}
										/>
										<span
											className="truncate text-base font-medium text-[#2F3136]"
											title={agentInfo?.name || ""}
										>
											{agentInfo?.name || ""}
										</span>
										<span
											className={`size-2 shrink-0 rounded-full ${
												openClawHealthy === false
													? "bg-[#FF4D4F]"
													: openClawHealthy === true
														? "bg-[#28C76F]"
														: "bg-[#C5CBD5]"
											}`}
											title={
												openClawHealthy === false
													? t("openclaw.status.unavailable", {
															gatewayName: openClawGatewayName,
														})
													: openClawHealthy === true
														? t("openclaw.status.connected", {
																gatewayName: openClawGatewayName,
															})
														: t("openclaw.status.status_checking", {
																gatewayName: openClawGatewayName,
															})
											}
										/>
									</div>
								) : (
									<>
										<div
											className="text-base text-primary line-clamp-1 max-md:flex-1 max-md:text-center"
											title={currentConv?.title || agentInfo?.name || ""}
										>
											{currentConv?.title || agentInfo?.name || ""}
										</div>
									</>
								)}
								{isOpenclaw && (
									<div
										data-testid="openclaw-history-selector"
										className="ml-4 mr-4 hidden min-w-0 flex-1 max-w-[520px] md:block"
									>
										<Popover
											rootClassName="openclaw-history-popover-root"
											trigger="click"
											placement="bottom"
											open={openClawHistoryOpen}
											onOpenChange={handleOpenClawHistoryOpenChange}
											arrow={false}
											styles={{ body: { padding: 0 } } as any}
											content={
												<div className="openclaw-history-popover w-full rounded-[14px] bg-white p-3 shadow-[0_12px_30px_rgba(31,33,35,0.10)]">
													{openClawConversationOptions.length > 0 ? (
														<div
															ref={openClawHistoryListRef}
															data-testid="openclaw-history-list"
															className="max-h-[440px] overflow-y-auto pr-1"
															onScroll={handleOpenClawHistoryScroll}
														>
															{openClawConversationOptions.map(
																(item: any, index: number) => {
																	const selected =
																		String(item.conversation_id) ===
																		String(selectedConversationId);
																	const unavailableOffline =
																		isOpenClawConversationUnavailableOffline(
																			item,
																			openClawHealthy,
																		);
																	const displayTitle =
																		getOpenClawConversationDisplayTitle(
																			item,
																			t("openclaw.history.no_title"),
																		);
																	return (
																		<button
																			key={
																				item.conversation_id ||
																				`openclaw-conv-${index}`
																			}
																			type="button"
																			data-conversation-id={String(
																				item.conversation_id || "",
																			)}
																			disabled={unavailableOffline}
																			aria-disabled={unavailableOffline}
																			title={
																				unavailableOffline
																					? t(
																							"openclaw.history.connect_plugin_first",
																						)
																					: displayTitle
																			}
																			className={`openclaw-history-row flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[15px] leading-5 transition ${
																				unavailableOffline
																					? "cursor-not-allowed text-[#A0A7B5] opacity-70"
																					: selected
																						? "bg-[#F4F5F7] text-[#2F3136]"
																						: "text-[#2F3136] hover:bg-[#F7F8FA]"
																			}`}
																			onClick={() =>
																				handleOpenClawConversationSelect(item)
																			}
																		>
																			<TopicIcon
																				className={
																					unavailableOffline
																						? "opacity-25"
																						: selected
																							? "opacity-70"
																							: "opacity-45"
																				}
																			/>
																			<span className="truncate">
																				{displayTitle}
																			</span>
																		</button>
																	);
																},
															)}
															{(openClawHistoryVisibleCount <
																visibleConversations.length ||
																openClawConversationPagination?.hasMore) && (
																<div className="px-3 py-2 text-center text-xs text-[#A0A7B5]">
																	{openClawHistoryLoading ||
																	openClawHistoryFetching
																		? t("openclaw.history.loading")
																		: t("openclaw.history.load_more_on_scroll")}
																</div>
															)}
														</div>
													) : isOpenclaw && openClawHealthy !== true ? (
														<div className="px-3 py-5 text-center text-sm text-[#A0A7B5]">
															{getOpenClawInputDisabledReason(
																openClawConnectionState,
																openClawGatewayName,
																t,
															)}{" "}
															{t("openclaw.history.server_cache_empty_suffix")}
														</div>
													) : (
														<div className="px-3 py-5 text-center text-sm text-[#A0A7B5]">
															{t("openclaw.history.empty")}
														</div>
													)}
												</div>
											}
										>
											<button
												type="button"
												className="openclaw-history-trigger flex h-10 w-full min-w-0 items-center gap-3 rounded-[12px] border border-[#E6EBF2] bg-[#F5F7FA] px-4 text-left text-[15px] leading-5 text-[#2F3136] shadow-[0_2px_8px_rgba(31,33,35,0.04)] transition hover:bg-[#EEF1F5]"
											>
												<TopicIcon className="opacity-85" />
												<span className="min-w-0 flex-1 truncate">
													{hasSelectedConversationId && currentConv
														? getOpenClawConversationDisplayTitle(
																currentConv,
																t("openclaw.history.new"),
															)
														: t("openclaw.history.new")}
												</span>
												{openClawHistoryOpen ? (
													<UpOutlined className="shrink-0 text-xs text-[#333333]" />
												) : (
													<DownOutlined className="shrink-0 text-xs text-[#333333]" />
												)}
											</button>
										</Popover>
									</div>
								)}
							</div>
							<div className="flex flex-none items-center justify-end gap-2">
								{/* Mobile back button */}
								<span
									className="flex items-center gap-1 text-sm cursor-pointer md:hidden"
									onClick={() => navigate(-1)}
								>
									<SvgIcon name="return" size={18} stroke />
								</span>
								{isOpenclaw ? (<Tooltip title={t("openclaw.panel.settings")}>
										<button
											type="button"
											aria-label={t("openclaw.panel.settings")}
											className={`size-7 rounded flex-center cursor-pointer border-0 bg-transparent p-0 hover:bg-[#E1E2E3] ${openClawPanelOpen ? 'bg-[#E1E2E3]' : ''}`}
											onClick={() => {
												closeAllSidePanels();
												setOpenClawPanelOpen(!openClawPanelOpen);
											}}
										>
                      <SvgIcon name="equalizer" size={18} className="rotate-90" />
										</button>
									</Tooltip>) : (
                  <Tooltip title={t("action.setting")}>
                    <div
                      role="button"
                      aria-label={t("action.setting")}
                      className={`size-7 rounded flex-center cursor-pointer hover:bg-[#E1E2E3] ${showSetting ? 'bg-[#E1E2E3]' : ''}`}
                      onClick={() => {
                        closeAllSidePanels();
                        onShowSettingChange?.(!showSetting);
                      }}
                    >
                      <SvgIcon name="equalizer" size={18} className="rotate-90" />
                    </div>
                  </Tooltip>
                )}

								<Tooltip title={t("chat.usage_guide")}>
									<div
										role="button"
										aria-label={t("chat.usage_guide")}
										className={`h-6 px-1 rounded flex-center gap-1 cursor-pointer hover:bg-[#E1E2E3] ${showGuide ? 'bg-[#E1E2E3]' : ''}`}
										onClick={() => {
											closeAllSidePanels();
											setGuideVisible(!showGuide);
										}}
									>
										<SvgIcon name="layout-split" size={18} />
									</div>
								</Tooltip>
								<MoreDropdown
									items={[
										!isShortcut
											? {
													key: "add-shortcut",
													icon: "add-mode",
													label: t("shortcut.add"),
												}
											: {
													key: "remove-shortcut",
													icon: "delete-mode",
													label: t("shortcut.remove"),
												},
									].filter(Boolean)}
									onCommand={handleMore as any}
								/>
							</div>
						</div>
					</header>
				);
			},
			[
				hideMenuHeader,
				isIndexRoute,
				showHistory,
				embeddedOpenClawPreview,
				isSoftStyle,
				handleBack,
				currentConv,
				hasSelectedConversationId,
				currentAgentLogo,
				handleImageError,
				navigate,
				isOpenclaw,
				openClawHealthy,
				openClawGatewayName,
				openClawHistoryOpen,
				openClawConversationOptions,
				openClawConversationPagination,
				openClawHistoryLoading,
				openClawHistoryFetching,
				openClawHistoryVisibleCount,
				visibleConversations.length,
				handleOpenClawHistoryOpenChange,
				handleOpenClawHistoryScroll,
				selectedConversationId,
				handleOpenClawConversationSelect,
				handleCloseOutputFilePreview,
				closeAllSidePanels,
				isShortcut,
				handleMore,
				agentId,
				convStore,
				setShowGuide,
				isCompletion,
				showUserMemory,
				onShowUserMemoryChange,
				isUserMemoryFullscreen,
				// 三个按钮的背景色 / toggle 闭包需要这些状态
				openClawPanelOpen,
				showSetting,
				showGuide,
			],
		);

    const hasRightPane = Boolean(
      (showGuide && currentAgent && !isCompletion) ||
      openClawPanelOpen ||
      outputFilePreview.visible ||
      outputFileBrowserState.visible ||
      showUserMemory ||
      showSetting
    );

		// ============ ChatView slots & sendContext（useMemo 化避免每 render 重建） ============
		// 原始实现是内联字面量 + 嵌套三元 + IIFE，每次 render 都创建新的对象/函数/JSX，
		// 击穿 ChatView/Sender 的 React.memo 与下游 useCallback/useEffect 的依赖稳定性。
		// 这里把每个 slot 拆成 useMemo，整体 slots 对象再做一次 useMemo 收口。
		const agentSelector = useMemo(() => {
			if (isIndexRoute || lockOpenClawEmbeddedPreviewToCurrentAgent)
				return undefined;
			return ({ agentInfo }: { agentInfo: any }) => (
				<AgentTooltip onSelect={handleAgentSelect}>
					<div className="h-8 px-2 rounded-full flex items-center gap-1.5 bg-[#F1F2F3] cursor-pointer hover:bg-[#E1E2E3]">
						{!isOpenclaw && (
							<img
								className="w-4 h-4 rounded-full"
								src={agentInfo.logo || DEFAULT_IMG}
								alt={agentInfo.name}
								onError={handleImageError}
							/>
						)}
						<span className="text-sm text-[#1F2123] line-clamp-1 max-w-[120px]">
							{agentInfo.name}
						</span>
						<DownOutlined style={{ color: "#333333", fontSize: "12px" }} />
					</div>
				</AgentTooltip>
			);
		}, [
			isIndexRoute,
			lockOpenClawEmbeddedPreviewToCurrentAgent,
			isOpenclaw,
			handleAgentSelect,
			handleImageError,
		]);

		const authTags = useMemo(
			() =>
				lockOpenClawEmbeddedPreviewToCurrentAgent
					? undefined
					: (userGroupIds?: number[]) => <AuthTagGroup value={userGroupIds} />,
			[lockOpenClawEmbeddedPreviewToCurrentAgent],
		);

		// Knowledge 模式：模型选择器 + 知识源选择器
		const senderLeftExtras = useMemo(() => {
			if (activeSenderKind !== "knowledge" || !knowledgeSenderConfig)
				return undefined;
			return (
				<KnowledgeSenderExtras
					modelMenuItems={knowledgeSenderConfig.modelMenuItems}
					agentModels={knowledgeSenderConfig.agentModels as any}
					model={knowledgeSenderConfig.model}
					onChangeModel={knowledgeSenderConfig.onChangeModel}
					selectorRef={knowledgeSelectorRef}
					knowledgeSource={knowledgeSenderConfig.knowledgeSource}
					onChangeKnowledgeSource={
						knowledgeSenderConfig.onChangeKnowledgeSource
					}
					library={isInLibraryMode ? knowledgeSenderConfig.library : null}
					isInternal={isInternal}
					agentInfo={
						currentAgent
							? {
									agent_id: currentAgent.agent_id,
									name: currentAgent.name,
									logo: currentAgent.logo,
									// KnowledgeSourceSelector 读取 settings.web_search_setting / graph_search_setting / wiki_search_setting
									// currentAgent 上对应的字段是 settings_obj
									settings: currentAgent.settings_obj
										? {
												web_search_setting:
													currentAgent.settings_obj.web_search_setting,
												graph_search_setting:
													currentAgent.settings_obj.graph_search_setting,
												wiki_search_setting:
													currentAgent.settings_obj.wiki_search_setting,
											}
										: undefined,
								}
							: undefined
					}
				/>
			);
		}, [activeSenderKind, knowledgeSenderConfig, isInternal, currentAgent]);

    // Work-ai 模式：技能 chips + 我的技能弹窗
    const senderBelowExtras = useMemo(() => {
      if (activeSenderKind !== "work-ai" || !workAiSenderConfig) return undefined;

      // 技能列表(单源):workAiSenderConfig.agentSkills 已过滤掉 status === 'disabled'。
      const skillList = workAiSenderConfig.agentSkills.map((s) => ({
        id: s.id,
        display_name: s.display_name,
        skill_name: s.skill_name,
        icon: s.logo,
        bind_type: s.bind_type,
        admin_status: s.admin_status,
      }));

      return (
        <WorkAiSenderExtras
          skillList={skillList}
          onSelectSkill={(skill) => {
            // work-ai 模式下,点击 extras 上的技能 chip 触发新 Sender 内部技能选择
            // 由于 extras 不会触发 Sender 内部 input,这里直接更新 hook 状态(包含完整 skill_name)
            workAiSenderConfig.skill.onSelect?.({
              label: skill.display_name,
              display_name: skill.display_name,
              skill_name: skill.skill_name || skill.display_name,
              icon: skill.icon,
            });
          }}
          onOpenSkillLibrary={() => navigate("/skills")}
          hasKnowledgeBase={workAiSenderConfig.hasKnowledgeBase}
        />
      );
    }, [activeSenderKind, workAiSenderConfig, navigate]);

		const senderMention = useMemo(
			() =>
				activeSenderKind === "knowledge"
					? knowledgeSenderConfig?.mention
					: activeSenderKind === "work-ai"
						? workAiSenderConfig?.mention
						: undefined,
			[activeSenderKind, knowledgeSenderConfig, workAiSenderConfig],
		);

		const senderSkill = useMemo(
			() =>
				activeSenderKind === "work-ai" ? workAiSenderConfig?.skill : undefined,
			[activeSenderKind, workAiSenderConfig],
		);

		const senderSlots = useMemo(() => {
			if (activeSenderKind === "knowledge") {
				return {
					...(knowledgeSenderConfig?.senderSlots ?? {}),
					// AI 搜问:与小助理复用同款 EnhancedMentionDropdown,只显示「从知识库里选择」入口。
					mentionDropdown: knowledgeMentionDropdownSlot as any,
					// legacy chip 视觉:复刻 knowledge/chat.tsx line 2284-2310
					linkList: LegacyLinkList as any,
					// 动态知识选中项（在 linkList 下方渲染）
					linkListBelow: (
						<WikiLinkList
							knowledgeSource={knowledgeSenderConfig.knowledgeSource}
							onChangeKnowledgeSource={knowledgeSenderConfig.onChangeKnowledgeSource}
						/>
					),
				};
			}
			if (activeSenderKind === "work-ai") {
				return {
					...(workAiSenderConfig?.senderSlots ?? {}),
					// work-ai 模式:覆盖默认 mentionDropdown 为多入口版本
					mentionDropdown: workAiMentionDropdownSlot as any,
					// legacy chip 视觉:复刻 IndexChat.tsx line 2284-2310
					linkList: LegacyLinkList as any,
				};
			}
			return undefined;
		}, [
			activeSenderKind,
			knowledgeSenderConfig,
			workAiSenderConfig,
			workAiMentionDropdownSlot,
			knowledgeMentionDropdownSlot,
		]);

		const senderPlaceholder = useMemo(
			() =>
				activeSenderKind === "knowledge"
					? knowledgeSenderConfig?.placeholder
					: activeSenderKind === "work-ai"
						? workAiSenderConfig?.placeholder
						: undefined,
			[activeSenderKind, knowledgeSenderConfig, workAiSenderConfig],
		);

		// work-ai (小助理):使用 extras 模式。Sender 在 extras 模式下默认把 @ 按钮放在右侧
		// toolbar(与 send 同一组),技能/附件 icon 放在左侧 toolbar,符合产品视觉规范。
		const senderActionPosition = useMemo(
			() => (activeSenderKind === "work-ai" ? ("extras" as const) : undefined),
			[activeSenderKind],
		);

		const sendContext = useMemo<SendContext | undefined>(() => {
			if (activeSenderKind === "knowledge" && knowledgeSenderConfig) {
				const currentModel = knowledgeSenderConfig.agentModels.find(
					(m: any) => m.value === knowledgeSenderConfig.model,
				);
				const { networkSearch, knowledgeGraph, wiki, selectedWikiSpaces, selectedWikiPages } = knowledgeSenderConfig.knowledgeSource;
				const wikis = [...(selectedWikiSpaces || []), ...(selectedWikiPages || [])];
				return {
					type: "km-ai-search",
					knowledgeSource: {
						state: knowledgeSenderConfig.knowledgeSource,
						graphEnabled: knowledgeGraph,
						webSearchEnabled: networkSearch,
						wikiEnabled: wiki,
					},
					library: knowledgeSenderConfig.library,
					links: knowledgeSenderConfig.selectedMentionLinks,
					wikis,
					modelId: currentModel?.id ?? "",
					agentInfo: currentAgent,
					minimalParams: false,
				} satisfies SendContext;
			}
			if (activeSenderKind === "work-ai" && workAiSenderConfig) {
				// work-ai 模式:完整参数传递(对齐 IndexChat.tsx sendMessage 调用)
				return {
					type: "work-ai",
					links: workAiSenderConfig.selectedMentionLinks,
					agentInfo: currentAgent,
					minimalParams: false,
				} satisfies SendContext;
			}
			return undefined;
		}, [
			activeSenderKind,
			knowledgeSenderConfig,
			workAiSenderConfig,
			currentAgent,
		]);

		const slots = useMemo(
			() => ({
				header: renderHeader,
				agentSelector,
				authTags,
				senderLeftExtras,
				senderBelowExtras,
				senderMention,
				senderSkill,
				senderSlots,
				senderPlaceholder,
				senderActionPosition,
			}),
			[
				renderHeader,
				agentSelector,
				authTags,
				senderLeftExtras,
				senderBelowExtras,
				senderMention,
				senderSkill,
				senderSlots,
				senderPlaceholder,
				senderActionPosition,
			],
		);

		return (
			<ChatConfigProvider
				lang={locale as any}
				adapters={chatAdaptersForAgent}
				onOpenKnowledgePanel={handleOpenKnowledgePanel}
			>
				<div
					className={`flex h-full min-w-0 ${embeddedOpenClawPreview ? "openclaw-embedded-workspace overflow-x-hidden" : ""} ${hasRightPane ? "gap-0" : ""} ${className || ""}`}
				>
					{/* 工作台入口历史侧边栏 - 放在最左边 */}
					{isIndexRoute && showHistory && (
						<div className="w-60 flex-shrink-0">
							<ChatHistory
								sidebarMode
								open={showHistory}
								onClose={() => setShowHistory(false)}
								onNew={() => {
									if (!checkLoginStatus()) return;
									chatViewRef.current?.newConversation();
									setShowHistory(false);
								}}
								onSelect={(conv: any) => {
									chatViewRef.current?.selectConversation(conv);
								}}
							/>
						</div>
					)}
					{/* 聊天区域 */}
					<div
						className={`min-w-0 flex-1 flex flex-col overflow-hidden ${hasRightPane ? "border-r" : ""}`}
					>
						<ChatView
							key={chatViewKey}
							ref={chatViewRef}
							agentId={agentId}
							initialConversationId={chatViewInitialConversationId}
							syncToUrl={!disableOpenClawUrlSync}
							agentInfo={chatAgentInfo}
							userAvatar={userAvatar}
							slots={slots as any}
							renderHeader={renderHeader as any}
							// ============ 发送上下文(按 agent_usage 透传给 ChatView.handleSend) ============
							// - knowledge (agent_usage=1): type / networkSearch / knowledgeGraph / library / modelId / agentInfo
							// - work-ai   (agent_usage=4): type="work-ai" + minimalParams=false(走完整模式,与 IndexChat 对齐)
							sendContext={sendContext}
							history={{ enabled: features.history }}
							newConversation={{ enabled: features.newConversation }}
							languageSwitcher={{ enabled: features.languageSwitcher }}
							guide={{ enabled: features.guide }}
							welcome={{
								show: features.showWelcome,
								indexLayout: features.indexWelcomeLayout,
							}}
							fileUpload={{
								// work-ai 模式:原版 IndexChat.tsx 用 enableUpload={userStore.is_login} 强制启用附件,
								// 不依赖 agent.settings_obj.file_parse(work-ai agent 一般不开 file_parse)。
								// 其它模式:沿用 features.fileUpload(由 agent.file_parse / image_parse 决定)。
								enabled:
									activeSenderKind === "work-ai" ? true : features.fileUpload,
								// work-ai 模式:用 hook 的 httpRequest(同步到"我上传的"知识库) + acceptTypes
								// 其它模式:沿用 ChatContainer 原有的 uploadRequest 与 acceptTypes
								request:
									activeSenderKind === "work-ai" && workAiSenderConfig
										? workAiSenderConfig.httpRequest
										: uploadRequest,
								acceptTypes:
									activeSenderKind === "work-ai" && workAiSenderConfig
										? workAiSenderConfig.acceptTypes
										: acceptTypes,
								enableDrag: features.enableDragUpload,
								enablePaste: features.enablePasteUpload,
								allowMultiple: features.allowMultiple,
								allowSendWithFiles: features.allowSendWithFiles,
							}}
							agentRecommend={{
								showRelatedScene: features.showRelatedScene,
								onNavigateNext: handleNextAgent,
								onRefresh: handleInitAgent,
							}}
							message={{
								showMenu: features.messageMenu,
								onSent: () => {
									eventBus.emit(EVENT_NAMES.SHORTCUT_UPDATED);
									// 发送完成后清空 @ / 技能 受控 list
									if (
										activeSenderKind === "knowledge" &&
										knowledgeSenderConfig
									) {
										knowledgeSenderConfig.reset();
									} else if (
										activeSenderKind === "work-ai" &&
										workAiSenderConfig
									) {
										workAiSenderConfig.reset();
									}
								},
								onPreviewOutputFile: isOpenclaw
									? handleOpenOutputFilePreview
									: handlePreviewOutputFile,
								onOutputFileFavorite:
									!isOpenclaw && hasKnowledgeBase
										? (file, msg) => handleToggleOutputFileFavorite(file, msg)
										: undefined,
								onOutputFileCheckFavorite:
									!isOpenclaw && hasKnowledgeBase
										? (fileIds, _msg) => handleCheckOutputFilesFavorite(fileIds)
										: undefined,
								onSaveToKnowledge: handleAddAnswerAsMd,
							}}
							share={{
								enabled: features.share,
								onCreate: handleShare,
							}}
							permission={{
								checkAccess: handleCheckAccess,
							}}
							// OpenClaw / QClaw 等智能体(agent_type=2)禁用 feedback 按钮。
							// 上游 override 优先级高于 ChatView 内部的 agent_type 检测。
							feedback={{
								enabled: !isOpenclaw,
							}}
							openclaw={{
								enabled: features.openclaw,
								inputDisabled: features.openclawInputDisabled,
								inputDisabledReason: features.openclawInputDisabledReason,
								initialConversationResolving:
									features.initialConversationResolving,
								skipInitialLoad: features.skipInitialLoad,
								onConversationResolved: handleOpenClawConversationResolved,
							}}
							timeout={features.timeout}
						/>
					</div>
					{/* 使用指引右侧面板 - completion 模式由 CompletionView 内部处理 */}
					{showGuide && currentAgent && !isCompletion && (
						<div className="flex-none w-[450px] flex flex-col bg-white overflow-hidden">
							<div className="h-15 flex items-center justify-between px-5 border-b">
								<h4 className="text-lg text-primary">
									{t("chat.usage_guide")}
								</h4>
								<div
									className="flex-center size-6 rounded cursor-pointer hover:bg-[#ECEDEE]"
									onClick={() => setShowGuide(false)}
								>
									<CloseOutlined />
								</div>
							</div>
							<UsageGuide
								useCases={currentAgent.use_cases}
								showChannel={isOpenclaw}
							/>
						</div>
					)}
					{/* 思考知识库侧边栏 */}
					{showThinkKnowledge && (
						<div className="h-full w-[418px] border-l flex flex-col bg-white">
							<ThinkKnowledge
								ref={thinkKnowledgeRef}
								onClose={() => setShowThinkKnowledge(false)}
							/>
						</div>
					)}
					{/* 设置右侧面板 */}
					{showSetting && (
						<div className="flex-none w-[450px] flex flex-col bg-white overflow-hidden">
							<Setting
								agent={currentAgent}
								onClose={() => {
									onShowSettingChange?.(false);
								}}
								onSkillOpen={() => useSkillsStore.getState().loadAgentSkills(agentId)}
								onUseSkill={(skill) => {
									// 将技能添加到对话框
									workAiSenderConfig?.skill.onSelect?.({
										label: skill.display_name,
										display_name: skill.display_name,
										skill_name: skill.skill_name,
										icon: skill.icon,
									});
									onShowSettingChange?.(false);
								}}
							/>
						</div>
					)}
					{isOpenclaw && openClawPanelOpen && !embeddedOpenClawPreview && (
						<div
							data-testid="openclaw-side-panel"
							className="flex-none w-[450px] flex flex-col bg-white overflow-hidden"
						>
							<OpenClawPanel
								agentId={agentId}
								open={openClawPanelOpen}
								status={openClawStatusPayload}
								connectionState={openClawConnectionState}
								statusLoading={openClawStatusLoading}
								onRefreshStatus={refreshOpenClawStatus}
								onClose={() => setOpenClawPanelOpen(false)}
							/>
						</div>
					)}
					{isOpenclaw && outputFilePreview.visible && (
						<div
							data-testid="openclaw-output-file-preview-pane"
							className="flex-none w-[450px] h-full flex flex-col bg-white overflow-hidden"
						>
							<div className="h-15 flex items-center justify-between px-5 border-b">
								<div className="flex min-w-0 items-center gap-3">
									<h4 className="text-lg text-primary truncate">
										{outputFilePreview.currentFile.name || "--"}
									</h4>
									{outputFilePreview.currentFile.file_url && (
										<Button
											color="primary"
											variant="link"
											size="small"
											className="shrink-0"
											onClick={handleDownloadOutputFile}
										>
											{t("action.download")}
										</Button>
									)}
								</div>
								<div
									role="button"
									aria-label="关闭文件预览"
									className="flex-center size-6 rounded shrink-0 cursor-pointer hover:bg-[#ECEDEE]"
									onClick={handleCloseOutputFilePreview}
								>
									<CloseOutlined />
								</div>
							</div>
							<div className="flex-1 overflow-hidden">
								<FileViewer
									url={outputFilePreview.currentFile.file_url}
									content={outputFilePreview.currentFile.content}
									extension={outputFilePreview.currentFile.file_ext}
								/>
							</div>
						</div>
					)}
					{/* 非 OpenClaw 模式：outputfile 预览面板 */}
					{!isOpenclaw && outputFileBrowserState.visible && (
						<div className="flex-none w-[450px] h-full flex flex-col bg-white overflow-hidden">
							<div className="h-15 flex items-center justify-between px-5 border-b">
								<div className="flex min-w-0 items-center gap-3">
									<h4 className="text-lg text-primary truncate">
										{outputFileBrowserState.currentFile.name || "--"}
									</h4>
									{outputFileBrowserState.currentFile.file_url && (
										<Button
											color="primary"
											variant="link"
											size="small"
											className="shrink-0"
											onClick={downloadOutputFileBrowser}
										>
											{t("action.download")}
										</Button>
									)}
								</div>
								<div
									role="button"
									aria-label="关闭文件预览"
									className="flex-center size-6 rounded shrink-0 cursor-pointer hover:bg-[#ECEDEE]"
									onClick={closeOutputFileBrowser}
								>
									<CloseOutlined />
								</div>
							</div>
							<div className="flex-1 overflow-hidden">
								<FileViewer
									url={outputFileBrowserState.currentFile.file_url}
									extension={outputFileBrowserState.currentFile.file_ext}
								/>
							</div>
						</div>
					)}
					<AddAnswerAsMd ref={addAnswerAsMdRef} />

					{/* ============ Work-ai 模式 @ 多入口对话框 ============ */}
					{/* 这些对话框由 EnhancedMentionDropdown 通过闭包触发 */}
					{activeSenderKind === "work-ai" && workAiSenderConfig && (
						<>
							<SpaceDialog
								ref={spaceDialogRef}
								allowSelectLibrary={true}
								allowSelectSpace={true}
								onConfirm={(
									files: FileItem[],
									libraries?: LibraryItem[],
									spaces?: SpaceItem[],
								) =>
									workAiSenderConfig.sources.library.select(
										files || [],
										libraries || [],
										spaces || [],
									)
								}
							/>
							<MyFilesDialog
								ref={uploadsDialogRef}
								source="uploads"
								onConfirm={(files) =>
									workAiSenderConfig.sources.uploads.select(files || [])
								}
							/>
							<MyFilesDialog
								ref={aiGeneratedDialogRef}
								source="ai-generated"
								onConfirm={(files) =>
									workAiSenderConfig.sources["ai-generated"].select(files || [])
								}
							/>
							<MyFilesDialog
								ref={recordingsDialogRef}
								source="recordings"
								onConfirm={(files) =>
									workAiSenderConfig.sources.recordings.select(files || [])
								}
							/>
						</>
					)}
				</div>
			</ChatConfigProvider>
		);
	},
);

ChatContainerInner.displayName = "ChatContainerInner";

/**
 * 外层：注入 baseline ChatConfigProvider
 *  - baseline adapters 来自 @/adapters/chat-adapters（已含 feedback），
 *    让 ChatContainerInner 函数体内的 useChatFeedback 不再 throw
 *  - isOpenclaw / chatAdaptersForAgent 的派生仍由 Inner 处理，
 *    以保留 JSX 内层 Provider 的 OpenClaw conversationApi 覆盖
 *
 * simplify-finding：外层看似冗余（内层已 spread chatAdapters 含 feedback），
 * 但 useChatFeedback 在 hook 调用栈深处读 context，依赖外层 provider 的存在
 * 才能稳定取到 feedback。删掉会复现 "useChatFeedback requires feedback adapter" 错误。
 */
const ChatContainer = forwardRef<ChatContainerRef, ChatContainerProps>(
	(props, ref) => {
		const locale = useEnterpriseStore((state) => state.language);
		return (
			<ChatConfigProvider lang={locale as any} adapters={chatAdapters}>
				<ChatContainerInner {...props} ref={ref} />
			</ChatConfigProvider>
		);
	},
);
ChatContainer.displayName = "ChatContainer";

export default ChatContainer;
