/**
 * useKnowledgeSenderConfig — agent_usage === 1 (KM_AI_SEARCH) 时,
 * 把 knowledge/chat.tsx 的 sender 行为(模型选择器 + 知识源选择器 + @ 提及)适配到 ChatContainer。
 *
 * 来源:apps/front-react/src/views/knowledge/chat.tsx (lines 1330-1462, 301-326, 967-1031)
 * 注意:本 hook 复刻的是 legacy Sender 的行为,而不是 refactor-sender-props-grouped 后的新行为。
 *      后续 task 3.x 把 knowledge/chat 迁到新 Sender 后,本 hook 可以简化为共享 @km/shared-business/chat 实现。
 */

import type { MentionFeature, SenderSlots } from "@km/hub-ui-x-react";
import { CacheMode, cacheManager as cache } from "@km/shared-utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import agentsApi from "@/api/modules/agents/index";
import { filesApi } from "@/api/modules/files";
import type { FileSearchResponse } from "@/api/modules/files/types";
import { formatFile, formatFileSearchResults } from "@/api/modules/files/transform";
import type { KnowledgeSourceState, KnowledgeSourceSelectorRef } from "@/components/KnowledgeSource";
import { t } from "@/locales";
import { useLibraryStore } from "@/stores/modules/library";
import { useNavigationStore } from "@/stores/modules/navigation";
import { useSpaceStore } from "@/stores/modules/space";
import { useUserStore } from "@/stores/modules/user";

export interface KnowledgeSenderConfig {
	mention: MentionFeature;
	senderSlots: SenderSlots;
	placeholder: string;
	/** 模型选择菜单 items(由 KnowledgeSenderExtras 渲染) */
	modelMenuItems: Array<{ key: string; label: React.ReactNode }>;
	/** 当前选中的模型值 */
	model: string;
	/** 模型列表 */
	agentModels: Array<{
		id: number;
		name: string;
		value: string;
		channel_id: number;
		channel_type: number;
		model: string;
		temperature: number;
		icon: string;
		type: string;
	}>;
	/** 切换模型 */
	onChangeModel: (value: string) => void;
	/** 知识源状态(由 KnowledgeSenderExtras 渲染) */
	knowledgeSource: KnowledgeSourceState;
	/** 切换知识源 */
	onChangeKnowledgeSource: (state: KnowledgeSourceState) => void;
	/** 当前生效的 library(决定 placeholder) */
	library: { name: string; icon?: string; value: string[]; isSpace: boolean };
	/** 发送后清空受控 list(在 ChatContainer.message.onSent 调用) */
	reset: () => void;
	/** @ 提及链接列表(含文件/知识库/空间,用于 sendContext.links) */
	selectedMentionLinks: any[];
}

interface UseKnowledgeSenderConfigParams {
	currentAgent: any;
	enabled: boolean;
	isInLibrary: boolean;
	/**
	 * 可选:KnowledgeSourceSelector 的 ref。
	 * 提供后,@ 弹窗底部的「@ 从知识库里选择」入口将调用 selector.open(),
	 * 复用知识源选择器内部的同一个 SpaceDialog(基于当前 knowledgeSource 预填已选项),
	 * 而不是再挂一个重复的对话框。对齐原版 Sender 的 handleOpenLibrary 行为。
	 */
	knowledgeSelectorRef?: React.RefObject<KnowledgeSourceSelectorRef | null>;
}

const KNOWLEDGE_SENDER_DEBOUNCE_MS = 300;

// 默认:动态知识(wiki)与知识图谱(knowledgeGraph)由智能体 settings 决定是否默认开启,
// 前台AI搜问(networkSearch)始终保持关闭。
// 实际取值由 deriveInitialKnowledgeSource 从 currentAgent.settings_obj 解析:
//   - enable=true && default_enable=true:开启
//   - 其他所有缺省/关闭情形:关闭(缺省一律返回 false,不擅自打开)
const INITIAL_KNOWLEDGE_SOURCE: KnowledgeSourceState = {
	mode: "all",
	allKnowledge: true,
	knowledgeGraph: false,
	networkSearch: false,
	wiki: false,
	selectedFiles: [],
	selectedLibraries: [],
	selectedSpaces: [],
	selectedWikiSpaces: [],
	selectedWikiPages: [],
};

/** 单个 setting 子对象的默认开启判断:enable=true 且 default_enable=true 才开启 */
function shouldDefaultEnable(setting: any): boolean {
	if (!setting) return false;
	if (setting.enable !== true) return false;
	return Boolean(setting.default_enable);
}

/** 从 currentAgent.settings_obj 解析默认知识源。 */
function deriveInitialKnowledgeSource(currentAgent: any): KnowledgeSourceState {
	const settings = currentAgent?.settings_obj ?? {};
	const nextState = {
		...INITIAL_KNOWLEDGE_SOURCE,
		knowledgeGraph: shouldDefaultEnable(settings.graph_search_setting),
		wiki: shouldDefaultEnable(settings.wiki_search_setting),
		networkSearch: false,
	};
	return nextState;
}

type KnowledgeLinkType = "file" | "library" | "space";

/**
 * 构造一条 selectedMentionLinks / mention.list 中使用的链接对象。
 * 收敛三处原地拼装的字段(对齐 knowledge/chat.tsx 原版 Sender 写入形态),
 * 字段命名变更只需改这里。
 *
 * @param extra 站点差异字段;最后一次展开,允许覆盖默认字段。
 *   - mention 入口强制 upload_file_id/file_size/file_mime=null、isfolder=false(对齐原版 handleSelectMention)
 *   - onChangeKnowledgeSource 在 library 上额外带 library_id: l.id(对齐原版)
 */
function makeKnowledgeLink(
	type: KnowledgeLinkType,
	item: { id: any; name: any; icon?: any; [k: string]: any },
	extra: Record<string, any> = {},
) {
	if (type === "file") {
		return {
			id: String(item.id),
			name: item.name,
			icon: item.icon,
			library_id: item.library_id,
			upload_file_id: item.upload_file_id ?? null,
			file_size: item.file_size ?? null,
			file_mime: item.file_mime ?? null,
			isfolder: item.isfolder ?? false,
			islibrary: false,
			isspace: false,
			ui: { active: true },
			source: "knowledge" as const,
			...extra,
		};
	}
	if (type === "library") {
		return {
			id: String(item.id),
			name: item.name,
			icon: item.icon,
			isfolder: false,
			islibrary: true,
			isspace: false,
			ui: { active: true },
			source: "knowledge" as const,
			...extra,
		};
	}
	// space
	return {
		id: String(item.id),
		name: item.name,
		icon: item.icon,
		isfolder: false,
		islibrary: false,
		isspace: true,
		ui: { active: true },
		source: "knowledge" as const,
		...extra,
	};
}

/**
 * mention 入口(file-from-recentList / file-from-suggestions)专用:对齐原版
 * handleSelectMention 的"未知字段强制 null"语义,避免把 recentList/suggestions
 * 里不存在的 upload_file_id/file_size/file_mime 错误地当成有值。
 */
function makeMentionFileLink(item: any) {
	return makeKnowledgeLink("file", item, {
		upload_file_id: null,
		file_size: null,
		file_mime: null,
		isfolder: false,
	});
}

export function useKnowledgeSenderConfig(
	params: UseKnowledgeSenderConfigParams,
): KnowledgeSenderConfig | null {
	const { currentAgent, enabled, isInLibrary, knowledgeSelectorRef } = params;
	const userStore = useUserStore();
	const navigationStore = useNavigationStore();
	// selector 订阅,避免 store 任意字段更新都触发下游 effect 重跑(finding #4)
	const libraryId = useLibraryStore((s) => s.library?.id);
	const libraryName = useLibraryStore((s) => s.library?.name);
	// 新增:订阅 library.icon,用于构造 selectedLibraries/selectedMentionLinks
	const libraryIcon = useLibraryStore((s) => s.library?.icon);
	const loadSpaceList = useSpaceStore((s) => s.loadSpaceList);

	// ============ State ============
	const [agentInfo, setAgentInfo] = useState<any>(currentAgent || null);
	const [agentModels, setAgentModels] = useState<
		KnowledgeSenderConfig["agentModels"]
	>([]);
	const [model, setModel] = useState("");
	const [library, setLibrary] = useState<{
		name: string;
		icon?: string;
		value: string[];
		isSpace: boolean;
	}>({
		name: t("library.all_libraries"),
		value: ["all"] as string[],
		isSpace: false,
	});
	const [knowledgeSource, setKnowledgeSource] = useState<KnowledgeSourceState>(
		() => deriveInitialKnowledgeSource(currentAgent),
	);
	const [searchKeyword, setSearchKeyword] = useState("");
	const [searchLoading, setSearchLoading] = useState(false);
	const [suggestions, setSuggestions] = useState<Array<any>>([]);
	const [recentList, setRecentList] = useState<Array<any>>([]);
	const [selectedMentionLinks, setSelectedMentionLinks] = useState<Array<any>>(
		[],
	);

	const searchSeqRef = useRef(0);
	const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// currentAgent 通过 ref 暴露给 effect,避免依赖 nested settings 子对象(finding #5)
	const currentAgentRef = useRef(currentAgent);
	currentAgentRef.current = currentAgent;

	const lastInitializedAgentIdRef = useRef<string | null>(
		currentAgent?.agent_id ?? null,
	);
	useEffect(() => {
		const newId = currentAgent?.agent_id ?? null;
		if (!enabled) return;
		if (!newId) return;
		if (lastInitializedAgentIdRef.current === newId) return;
		lastInitializedAgentIdRef.current = newId;
		setKnowledgeSource(deriveInitialKnowledgeSource(currentAgent));
	}, [enabled, currentAgent?.agent_id]);

	// ============ 同步 currentAgent -> agentInfo ============
	useEffect(() => {
		if (currentAgent && currentAgent.agent_id) {
			setAgentInfo(currentAgent);
		}
	}, [currentAgent]);

	// ============ 加载模型列表 ============
	// deps 仅保留 agent_id + enabled;settings 通过 currentAgentRef 读取最新值(finding #5)
	useEffect(() => {
		if (!enabled || !currentAgent?.agent_id) return;
		let cancelled = false;
		agentsApi.models
			.list(currentAgent.agent_id)
			.then((res: any) => {
				if (cancelled) return;
				const agent = currentAgentRef.current;
				const deepConfig = agent?.settings_obj?.deep_thinking_config || {
					temperature: 0.5,
				};
				const fastConfig = agent?.settings_obj?.fast_reasoning_config || {
					temperature: 0.5,
				};
				const deepValue = `${deepConfig.channel_id}_${deepConfig.channel_type}_${deepConfig.model_name}`;
				const models = (res.agent_models || []).map((item: any) => {
					const value = `${item.channel_id}_${item.channel_type}_${item.model}`;
					const isDeepThinking = value === deepValue;
						return {
							...item,
							type: isDeepThinking ? "deep_reasoning" : "fast_reasoning",
							icon: isDeepThinking ? "star-link" : "lightning",
							name: isDeepThinking
								? t("chat.deep_thinking")
								: t("chat.fast_response"),
							temperature: isDeepThinking
								? deepConfig.temperature
								: fastConfig.temperature,
						value,
						};
				});
				setAgentModels(models);
				// 保留用户已选 model;仅当当前值不在新列表中或为空时回退到第一项(finding #2)
				setModel((prev) => {
					if (prev && models.some((m: any) => m.value === prev)) return prev;
					return models[0]?.value ?? "";
				});
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [enabled, currentAgent?.agent_id]);

	// ============ 加载最近文件 ============
	useEffect(() => {
		if (!enabled) return;
		filesApi
			.recently()
			.then((res: any[]) => {
				// 使用 formatFile 把原始 API 数据转换为带 name/icon 的结构(对齐 workAi 行为)
				if (Array.isArray(res)) {
					setRecentList(res.map((f) => formatFile(f)));
				} else {
					setRecentList([]);
				}
			})
			.catch(() => setRecentList([]));
	}, [enabled]);

	// ============ 加载 library 缓存 ============
	useEffect(() => {
		if (!enabled) return;
		if (isInLibrary) {
			const libId = String(libraryId ?? "");
			const libName = libraryName || t("library.this_library_content");
			setLibrary({
				name: libName,
				icon: libraryIcon,
				value: [libId],
				isSpace: false,
			});
			// 默认把当前 library 勾为知识源(对应 useChatSend 的 knowledge_base_ids)
			const libraryLink = {
				id: libId,
				name: libName,
				icon: libraryIcon,
				isfolder: false,
				islibrary: true,
				isspace: false,
				ui: { active: true },
				source: "knowledge",
			};
			// isInLibrary 分支:依然默认勾选当前 library,但 wiki / knowledgeGraph
			// 必须遵循 agent settings_obj 的 default_enable,不能因为在 /library/ 路由下
			// 就强行关闭(原先硬写 false 会让 /library/:id/chat 永远关掉动态知识)。
			const agentSettings = currentAgentRef.current?.settings_obj ?? {};
			setKnowledgeSource({
				mode: "libraries",
				allKnowledge: false,
				knowledgeGraph: false,
				networkSearch: false,
				wiki: shouldDefaultEnable(agentSettings.wiki_search_setting),
				selectedFiles: [],
				selectedLibraries: [{ id: libId, name: libName, icon: libraryIcon }],
				selectedSpaces: [],
			});
			setSelectedMentionLinks([libraryLink]);
			loadSpaceList();
			return;
		}
		cache
			.get<{ name: string; value: string[] }>(
				`library_${userStore.info.eid}`,
				CacheMode.LOCAL_STORAGE,
			)
			.then((cached: { name: string; value: string[] } | null | undefined) => {
				if (cached) setLibrary({ ...cached, isSpace: false });
			});
	}, [
		enabled,
		isInLibrary,
		libraryId,
		libraryName,
		libraryIcon,
		userStore.info.eid,
		loadSpaceList,
	]);

	// ============ 搜索(防抖) ============
	useEffect(() => {
		if (!enabled) return;
		if (searchTimerRef.current) {
			clearTimeout(searchTimerRef.current);
			searchTimerRef.current = null;
		}
		const keyword = searchKeyword.trim();
		if (!keyword) {
			setSuggestions([]);
			setSearchLoading(false);
			return;
		}
		setSearchLoading(true);
		const mySeq = ++searchSeqRef.current;
		searchTimerRef.current = setTimeout(() => {
			filesApi
				.search({ query: keyword, top_k: 10 })
				.then((res: FileSearchResponse) => {
					if (mySeq !== searchSeqRef.current) return;
					const formatted = formatFileSearchResults(res.results || []);
					setSuggestions(
						formatted.map((item) => ({
							id: String(item.file_id),
							name: item.name,
							icon: item.icon,
							library_id: String(item.library_id || ""),
							library_name: item.library_name,
							score: item.score,
							ui: { active: false },
							source: "knowledge",
							isfolder: item.isfolder,
							islibrary: false,
							isspace: false,
						})),
					);
				})
				.catch(() => {
					if (mySeq !== searchSeqRef.current) return;
					setSuggestions([]);
				})
				.finally(() => {
					if (mySeq === searchSeqRef.current) setSearchLoading(false);
				});
		}, KNOWLEDGE_SENDER_DEBOUNCE_MS);
		return () => {
			if (searchTimerRef.current) {
				clearTimeout(searchTimerRef.current);
				searchTimerRef.current = null;
			}
		};
	}, [enabled, searchKeyword]);

	// ============ mention 配置 ============
	const handleSelectMention = useCallback((item: any) => {
		setSelectedMentionLinks((prev) => {
			if (prev.some((p) => String(p.id) === String(item.id))) return prev;
			return [...prev, makeMentionFileLink(item)];
		});

		// 联动更新 knowledgeSource,让 KnowledgeSourceSelector 同步勾选该文件
		// 对齐 handleSelectFilesFromLibrary 的写入形态(append,不去动 selectedLibraries/Spaces)。
		setKnowledgeSource((prev) => {
			if (
				(prev.selectedFiles || []).some((f) => String(f.id) === String(item.id))
			)
				return prev;
			return {
				...prev,
				mode: "files" as const,
				allKnowledge: false,
				selectedFiles: [
					...(prev.selectedFiles || []),
					{
						id: String(item.id),
						name: item.name,
						icon: item.icon,
						library_id: item.library_id,
						upload_file_id: item.upload_file_id ?? null,
						file_size: item.file_size ?? null,
						file_mime: item.file_mime ?? null,
						isfolder: item.isfolder ?? false,
					},
				],
			};
		});
	}, []);

	const handleRemoveMention = useCallback((item: any) => {
		setSelectedMentionLinks((prev) =>
			prev.filter((p) => String(p.id) !== String(item.id)),
		);

		// 联动更新 knowledgeSource:对齐原版 Sender onRemoveLink 行为
		// apps/front-react/src/views/knowledge/chat.tsx line 1344-1368
		setKnowledgeSource((prev) => {
			let changed = false;
			let next = prev;

			if (item.isspace) {
				const newSpaces = (prev.selectedSpaces || []).filter(
					(s: any) => String(s.id) !== String(item.id),
				);
				if (newSpaces.length !== (prev.selectedSpaces || []).length) {
					changed = true;
					next = { ...next, selectedSpaces: newSpaces };
				}
			} else if (item.islibrary) {
				const newLibraries = (prev.selectedLibraries || []).filter(
					(l: any) => String(l.id) !== String(item.id),
				);
				if (newLibraries.length !== (prev.selectedLibraries || []).length) {
					changed = true;
					next = { ...next, selectedLibraries: newLibraries };
				}
			} else {
				// 普通文件
				const newFiles = (prev.selectedFiles || []).filter(
					(f: any) => String(f.id) !== String(item.id),
				);
				if (newFiles.length !== (prev.selectedFiles || []).length) {
					changed = true;
					next = { ...next, selectedFiles: newFiles };
				}
			}

			// 如果删除了所有受控资源,切回 allKnowledge 模式
			// 修复:把 wiki 也加入判定,避免「删空文件后 wiki 仍开启但 knowledge_base_ids = ["all"]」
			// 与 wiki_search_config 同时发送造成前后矛盾。
			if (
				changed &&
				next.selectedFiles?.length === 0 &&
				(next.selectedLibraries?.length || 0) === 0 &&
				(next.selectedSpaces?.length || 0) === 0 &&
				(next.selectedWikiSpaces?.length || 0) === 0 &&
				(next.selectedWikiPages?.length || 0) === 0
			) {
				next = {
					...next,
					mode: "all" as const,
					allKnowledge: true,
					wiki: false,
					selectedWikiSpaces: [],
					selectedWikiPages: [],
				};
			}

			return changed ? next : prev;
		});
	}, []);

	// ============ 打开知识库 Dialog ============
	// 复用 KnowledgeSourceSelector 内部的 SpaceDialog(通过 selector.open())。
	// selector 基于当前 knowledgeSource 预填已选项;由于 knowledgeSource 与
	// selectedMentionLinks 双向同步,这里无需再手动构造 files/libraries/spaces。
	// 相比之前在 ChatContainer 单独挂一个 SpaceDialog,这样只保留单一对话框,
	// 且能正确带上「动态知识」选项(对齐 selector 的 allowSelectDynamicKnowledge)。
	const handleOpenLibrary = useCallback(() => {
		knowledgeSelectorRef?.current?.open();
	}, [knowledgeSelectorRef]);

	const handleSelectFilesFromLibrary = useCallback(
		(files: any[], _libraries?: any[], spaces?: any[], wikis?: any[]) => {
			const newFiles = (files || []).map((f: any) => ({
				id: String(f.id),
				name: f.name,
				icon: f.icon,
				library_id: f.library_id,
				isfolder: f.isfolder,
				upload_file_id: f.upload_file_id,
				file_size: f.file_size,
				file_mime: f.file_mime,
			}));
			const newLibraries = (_libraries || []).map((l: any) => ({
				id: String(l.id),
				name: l.name,
				icon: l.icon,
			}));
			const newSpaces = (spaces || []).map((s: any) => ({
				id: String(s.id),
				name: s.name,
				icon: s.icon,
			}));
			const newWikiSpaces = (wikis || [])
					.filter((w: any) => w.wikiType === 'space')
					.map((s: any) => ({
				id: String(s.id),
				name: s.name,
				icon: s.icon,
				wikiType: 'space' as const,
			}));
			const newWikiPages = (wikis || [])
					.filter((w: any) => w.wikiType === 'page')
					.map((p: any) => ({
				id: p.id,
				title: p.title,
				slug: p.slug,
				summary: p.summary,
				space_id: p.space_id,
				wikiType: 'page' as const,
			}));
			// 如果有选中的动态知识，设置 wiki: true
			const hasWikiSelection = newWikiSpaces.length > 0 || newWikiPages.length > 0;
			setKnowledgeSource((prev) => ({
				...prev,
				mode: hasWikiSelection ? "wiki" as const : "files" as const,
				allKnowledge: false,
				wiki: hasWikiSelection,
				selectedFiles: newFiles,
				selectedLibraries: newLibraries,
				selectedSpaces: newSpaces,
				selectedWikiSpaces: newWikiSpaces,
				selectedWikiPages: newWikiPages,
			}));
			// 同步把这些文件/知识库/空间加入 selectedMentionLinks
			setSelectedMentionLinks((prev) => {
				const next = [...prev];
				newFiles.forEach((f) => {
					if (!next.some((p) => String(p.id) === String(f.id))) {
						next.push(makeKnowledgeLink("file", f));
					}
				});
				newLibraries.forEach((l) => {
					if (!next.some((p) => String(p.id) === String(l.id))) {
						next.push(makeKnowledgeLink("library", l));
					}
				});
				newSpaces.forEach((s) => {
					if (!next.some((p) => String(p.id) === String(s.id))) {
						next.push(makeKnowledgeLink("space", s));
					}
				});
				return next;
			});
		},
		[],
	);

	const mentionEnabled =
		enabled &&
		userStore.is_login &&
		navigationStore.hasKnowledge &&
		userStore.info.is_internal;

	const mention: MentionFeature = useMemo(
		() => ({
			enabled: Boolean(mentionEnabled),
			disabled: knowledgeSource.networkSearch,
			tooltip: t("work_ai.knowledge_placeholder"),
			// 受控 list:由 ChatContainer 维护的 selectedMentionLinks
			list: selectedMentionLinks,
			suggestions,
			recentList,
			searchKeyword,
			searchLoading,
			onSearch: setSearchKeyword,
			onSelect: handleSelectMention,
			onRemove: handleRemoveMention,
			// 触发 KnowledgeSourceSelector 内部 SpaceDialog(对齐原版 Sender 的 handleOpenLibrary)
			onOpenLibrary: knowledgeSelectorRef ? handleOpenLibrary : undefined,
			onSelectFiles: handleSelectFilesFromLibrary,
		}),
		[
			mentionEnabled,
			knowledgeSource.networkSearch,
			selectedMentionLinks,
			suggestions,
			recentList,
			searchKeyword,
			searchLoading,
			handleSelectMention,
			handleRemoveMention,
			handleSelectFilesFromLibrary,
			knowledgeSelectorRef,
			handleOpenLibrary,
		],
	);

	// 占位符
	const placeholder = knowledgeSource.networkSearch
		? t("index.chat_placeholder")
		: t("index.chat_placeholder_library", { name: library.name });

	// 切换模型
	const onChangeModel = useCallback((value: string) => {
		setModel(value);
	}, []);

	// 切换知识源
	const onChangeKnowledgeSource = useCallback((next: KnowledgeSourceState) => {
		setKnowledgeSource(next);
		// 把 selectedFiles/Libraries/Spaces 同步到 selectedMentionLinks
		if (
			(next.selectedFiles?.length ?? 0) === 0 &&
			(next.selectedLibraries?.length ?? 0) === 0 &&
			(next.selectedSpaces?.length ?? 0) === 0
		) {
			setSelectedMentionLinks([]);
		} else {
			const newLinks: any[] = [];
			(next.selectedFiles || []).forEach((f) =>
				newLinks.push(makeKnowledgeLink("file", f)),
			);
			(next.selectedLibraries || []).forEach((l) =>
				newLinks.push(makeKnowledgeLink("library", l, { library_id: l.id })),
			);
			(next.selectedSpaces || []).forEach((s) =>
				newLinks.push(makeKnowledgeLink("space", s)),
			);
			setSelectedMentionLinks(newLinks);
		}
	}, []);

	const senderSlots: SenderSlots = useMemo(
		() => ({
			// 默认 mentionDropdown / linkList 由新 Sender 提供
		}),
		[],
	);

	// 清空受控 list + 知识源(供 ChatContainer 在 message.onSent 调用)
	// 注意:必须放在 `if (!enabled) return null` 之前,否则 enabled 翻转时
	// 这一个 hook 的位置会变化,导致 React 内部 hook list 错位(规则:Hooks
	// 必须在每次渲染以相同顺序调用)。
	//
	// /library/:id/chat 路由(指定知识库问答):send 后不应回退到「全部知识」,
	// 仍以当前知识库为默认知识源,只清掉用户在本次输入中临时勾选的文件 / 空间 /
	// 动态知识,避免每次发送都被重置回 allKnowledge=true。
	const reset = useCallback(() => {
		if (isInLibrary) {
			const agentSettings = currentAgentRef.current?.settings_obj ?? {};
			const libId = String(libraryId ?? "");
			const libName = libraryName || t("library.this_library_content");
			const libraryLink = {
				id: libId,
				name: libName,
				icon: libraryIcon,
				isfolder: false,
				islibrary: true,
				isspace: false,
				ui: { active: true },
				source: "knowledge",
			};
			setKnowledgeSource({
				...INITIAL_KNOWLEDGE_SOURCE,
				mode: "libraries",
				allKnowledge: false,
				knowledgeGraph: false,
				networkSearch: false,
				wiki: shouldDefaultEnable(agentSettings.wiki_search_setting),
				selectedFiles: [],
				selectedLibraries: [
					{ id: libId, name: libName, icon: libraryIcon },
				],
				selectedSpaces: [],
			});
			setSelectedMentionLinks([libraryLink]);
			return;
		}
		setSelectedMentionLinks([]);
		setKnowledgeSource(deriveInitialKnowledgeSource(currentAgentRef.current));
	}, [isInLibrary, libraryId, libraryName, libraryIcon]);

	if (!enabled) return null;

	return {
		mention,
		senderSlots,
		placeholder,
		modelMenuItems: [],
		model,
		agentModels,
		onChangeModel,
		knowledgeSource,
		onChangeKnowledgeSource,
		library,
		reset,
		selectedMentionLinks,
	};
}
