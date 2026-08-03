import { CheckOutlined, DownOutlined, RightOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import type { MenuProps } from "antd";
import { Dropdown, Tooltip } from "antd";
import {
	forwardRef,
	useCallback,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import type { FileItem } from "@/api/modules/files/types";
import type { LibraryItem } from "@/api/modules/libraries";
import type { SpaceItem } from "@/api/modules/spaces";
import SpaceDialog from "@/components/Space/dialog";
import { t } from "@/locales";
import type {
	KnowledgeSourceSelectorProps,
	KnowledgeSourceSelectorRef,
	KnowledgeSourceState,
	WikiItem,
} from "./types";
import "./selector.css";

export const KnowledgeSourceSelector = forwardRef<
	KnowledgeSourceSelectorRef,
	KnowledgeSourceSelectorProps
>(function KnowledgeSourceSelector(
	{
		value,
		onChange,
		library,
		disabled,
		allowSelectLibrary = false,
		allowSelectSpace = false,
		allowSelectDynamicKnowledge: allowSelectDynamicKnowledgeProp,
		agentInfo,
	},
	ref,
) {
	const spaceDialogRef = useRef<any>(null);
	const [dropdownOpen, setDropdownOpen] = useState(false);

	// 动态知识开关优先采用 props 注入(单一来源);
	// 当 prop 未传时,降级为 agentInfo 的 enable 设置(向后兼容旧调用方)。
	const allowSelectDynamicKnowledge =
		allowSelectDynamicKnowledgeProp ??
		(agentInfo?.settings?.wiki_search_setting?.enable ?? false);

	// 下拉框状态变化：点击菜单项时不关闭，只有点击外部时才关闭
	const handleDropdownOpenChange = useCallback((open: boolean, info: any) => {
		// source: 'trigger' = 点击触发器, 'menu' = 点击菜单项
		// 点击菜单项导致关闭时，保持打开状态
		if (!open && info?.source === "menu") {
			return;
		}
		setDropdownOpen(open);
	}, []);

	// 配置开关
	const graphSearchEnabled =
		agentInfo?.settings?.graph_search_setting?.enable ?? false;
	const webSearchEnabled =
		agentInfo?.settings?.web_search_setting?.enable ?? false;
	const wikiSearchEnabled =
		agentInfo?.settings?.wiki_search_setting?.enable ?? false;

	// 重置方法
	const reset = useCallback(() => {
		const initialState: KnowledgeSourceState = {
			mode: "all",
			allKnowledge: true,
			knowledgeGraph:
				agentInfo?.settings?.graph_search_setting?.default_enable ?? false,
			networkSearch: false,
			wiki: agentInfo?.settings?.wiki_search_setting?.default_enable ?? false,
			selectedFiles: [],
		};
		onChange(initialState);
	}, [agentInfo, onChange]);

	// useImperativeHandle 移至 handleOpenFileDialog 定义之后(见下方),
	// 以便 open() 复用同一个打开逻辑,避免 const TDZ。

	// 触发按钮显示内容（图标+文字）
	const displayContent = useMemo(() => {
		// 联网搜索（优先级最高，与其他互斥）
		if (value.networkSearch) {
			return {
				icon: <SvgIcon name="network" size={16} />,
				text: t("chat.online_search"),
			};
		}

		// 动态知识和知识图谱可以同时启用，优先显示动态知识
		if (value.wiki) {
			return {
				icon: <SvgIcon name="book-one" size={16} />,
				text: t("chat.wiki"),
			};
		}

		// 知识图谱
		if (value.knowledgeGraph) {
			return {
				icon: <SvgIcon name="graph_v2" size={16} />,
				text: t("chat.knowledge_graph"),
			};
		}

		const hasFiles = value.selectedFiles && value.selectedFiles.length > 0;
		const hasLibraries =
			allowSelectLibrary &&
			value.selectedLibraries &&
			value.selectedLibraries.length > 0;
		const hasSpaces =
			allowSelectSpace &&
			value.selectedSpaces &&
			value.selectedSpaces.length > 0;

		// 计算总个数（空间 + 知识库 + 知识）
		const totalCount =
			(value.selectedSpaces?.length || 0) +
			(value.selectedLibraries?.length || 0) +
			(value.selectedFiles?.length || 0);

		// 新增:仅选中当前库时,显示库名(而不是 "1 个")
		const onlyCurrentLibrarySelected =
			library?.value?.length > 0 &&
			(value.selectedLibraries?.length ?? 0) === 1 &&
			String(value.selectedLibraries?.[0]?.id) === String(library.value[0]);

		// 有选择任何内容
		if (hasFiles || hasLibraries || hasSpaces) {
			// 仅选中当前库时,显示库名而不是 "1 个"
			if (onlyCurrentLibrarySelected && !hasFiles && !hasSpaces) {
				return {
					icon: <SvgIcon name="folder" size={16} />,
					text: library?.name || "",
				};
			}
			return {
				icon: <span className="text-base">@</span>,
				text: `${totalCount}个`,
			};
		}

		// 全部知识模式 — 优先显示「全部知识」,即使存在 library 上下文也不能用库名代替
		// (对齐 handleToggleAllKnowledge 行为:切回全部知识后 trigger 必须回到 "All Knowledge" 文案)
		if (value.allKnowledge) {
			return {
				icon: <SvgIcon name="documents" size={16} />,
				text: t("library.all_knowledge"),
			};
		}

		// 否则显示当前知识库/空间
		if (library?.value?.length > 0) {
			return {
				icon: <SvgIcon name="folder" size={16} />,
				text: library?.name || "",
			};
		}
		// 默认显示全部知识（兜底）
		return {
			icon: <SvgIcon name="documents" size={16} />,
			text: t("library.all_knowledge"),
		};
	}, [value, library, allowSelectLibrary, allowSelectSpace]);

	// 打开文件选择弹窗（先关闭下拉框）
	const handleOpenFileDialog = useCallback(() => {
		setDropdownOpen(false);
		// 传递已选中的文件、知识库、空间和动态知识（合并 wikis 数组）
		const wikis = [
			...(value.selectedWikiSpaces || []),
			...(value.selectedWikiPages || []),
		];
		spaceDialogRef.current?.open(
			value.selectedFiles,
			value.selectedLibraries,
			undefined,
			value.selectedSpaces,
			wikis,
		);
	}, [value.selectedFiles, value.selectedLibraries, value.selectedSpaces, value.selectedWikiSpaces, value.selectedWikiPages]);

	// 暴露给外部:reset(重置状态) + open(基于当前 value 打开选择弹窗)。
	// open 复用 handleOpenFileDialog,让外部(如 Sender 的 @ 从知识库入口)与
	// 下拉菜单里的「@ 从知识库选择」走同一个 SpaceDialog,避免重复挂载。
	useImperativeHandle(ref, () => ({ reset, open: handleOpenFileDialog }), [
		reset,
		handleOpenFileDialog,
	]);

	// 从知识库选择文件/知识库/空间和动态知识
	const handleSelectFiles = useCallback(
		(
			files: FileItem[],
			libraries?: LibraryItem[],
			spaces?: SpaceItem[],
			wikis?: WikiItem[],
		) => {
			const hasFiles = files.length > 0;
			const hasLibraries =
				allowSelectLibrary && libraries && libraries.length > 0;
			const hasSpaces = allowSelectSpace && spaces && spaces.length > 0;
			const hasWikiSpaces = wikis?.some(w => w.wikiType === 'space') ?? false;
			const hasWikiPages = wikis?.some(w => w.wikiType === 'page') ?? false;

			// 都为空时重置为全部知识（只取消联网搜索，保留动态知识/知识图谱）
			if (!hasFiles && !hasLibraries && !hasSpaces && !hasWikiSpaces && !hasWikiPages) {
				const newState: KnowledgeSourceState = {
					...value,
					mode: "all",
					allKnowledge: true,
					selectedFiles: [],
					selectedLibraries: [],
					selectedSpaces: [],
					selectedWikiSpaces: [],
					selectedWikiPages: [],
					networkSearch: false,
				};
				onChange(newState);
				return;
			}
			// 确定模式：动态知识优先 → 文件 → 知识库 → 空间
			// 修复:仅选了 wiki 时 mode 不应 fallthrough 到 "spaces"(selectedSpaces 为空会导致
			// useChatSend 的 knowledge_base_ids = [])。
			const hasAnyWikiSelection = hasWikiSpaces || hasWikiPages;
			const mode = hasAnyWikiSelection
				? "wiki"
				: hasFiles
					? "files"
					: hasLibraries
						? "libraries"
						: "spaces";
			const hasFileOrLibOrSpace = hasFiles || hasLibraries || hasSpaces;
			const newState: KnowledgeSourceState = {
				...value,
				mode,
				// 规则: 选择文件/知识库/空间时，关闭知识图谱、联网搜索、全部知识
				// 动态知识与全部知识可同时存在（仅联网搜索与动态知识互斥）
				allKnowledge: hasFileOrLibOrSpace ? false : value.allKnowledge,
				knowledgeGraph: hasFileOrLibOrSpace ? false : value.knowledgeGraph,
				networkSearch: hasFileOrLibOrSpace ? false : value.networkSearch,
				// 如果有动态知识选择，勾选动态知识
				wiki: hasAnyWikiSelection ? true : value.wiki,
				selectedFiles: hasFiles
					? files.map((file) => ({
							id: String(file.id),
							name: file.name,
							icon: file.icon,
							library_id: file.library_id,
							isfolder: file.isfolder,
						}))
					: [],
				selectedLibraries: hasLibraries
					? libraries.map((lib) => ({
							id: String(lib.id),
							name: lib.name,
							icon: lib.icon,
							islibrary: true,
						}))
					: [],
				selectedSpaces: hasSpaces
					? spaces.map((space) => ({
							id: String(space.id),
							name: space.name,
							icon: space.icon,
						}))
					: [],
				selectedWikiSpaces: wikis
					?.filter(w => w.wikiType === 'space')
					.map(w => ({
						id: String(w.id),
						name: w.name,
						icon: w.icon,
						wikiType: 'space' as const,
					})) ?? [],
				selectedWikiPages: wikis
					?.filter(w => w.wikiType === 'page')
					.map(w => ({
						id: w.id,
						title: w.title,
						slug: w.slug,
						summary: w.summary,
						space_id: w.space_id,
						wikiType: 'page' as const,
					})) ?? [],
			};
			onChange(newState);
		},
		[value, onChange, allowSelectLibrary, allowSelectSpace],
	);

	// 切换全部知识
	const handleToggleAllKnowledge = useCallback(() => {
		// 参考 PreviewKnowledgeSourceSelector.handleMenuClick: 取消全部知识时，知识图谱也要去掉
		if (value.allKnowledge) {
			// 取消全部知识
			const newState: KnowledgeSourceState = {
				...value,
				mode: "all",
				allKnowledge: false,
				knowledgeGraph: false,
			};
			onChange(newState);
		} else {
			// 选中全部知识
			const newState: KnowledgeSourceState = {
				...value,
				mode: "all",
				networkSearch: false,
				allKnowledge: true,
				selectedFiles: [],
				selectedLibraries: [],
				selectedSpaces: [],
			};
			onChange(newState);
		}
	}, [value, onChange]);

	// 切换知识图谱（与联网搜索互斥，与动态知识可同时启用）
	const handleToggleKnowledgeGraph = useCallback(() => {
		const newKnowledgeGraph = !value.knowledgeGraph;
		const newState: KnowledgeSourceState = {
			...value,
			// 规则1: 知识图谱必须选中全部知识，关闭联网搜索
			networkSearch: false,
			allKnowledge: newKnowledgeGraph ? true : value.allKnowledge,
			knowledgeGraph: newKnowledgeGraph,
			// 清空从知识库选中的内容
			selectedFiles: [],
			selectedLibraries: [],
			selectedSpaces: [],
		};
		onChange(newState);
	}, [value, onChange]);

	// 切换联网搜索（与动态知识、知识图谱互斥）
	const handleToggleNetworkSearch = useCallback(() => {
		const newState: KnowledgeSourceState = {
			...value,
			// 规则3: 联网搜索关闭全部知识、动态知识、知识图谱
			allKnowledge: false,
			wiki: false,
			knowledgeGraph: false,
			networkSearch: !value.networkSearch,
			// 清空从知识库选中的内容
			selectedFiles: [],
			selectedLibraries: [],
			selectedSpaces: [],
			selectedWikiSpaces: [],
			selectedWikiPages: [],
		};
		onChange(newState);
	}, [value, onChange]);

	// 切换动态知识（与联网搜索互斥，与全部知识/知识图谱可同时启用）
	const handleToggleWiki = useCallback(() => {
		const newWiki = !value.wiki;
		const newState: KnowledgeSourceState = {
			...value,
			// 动态知识与联网搜索互斥：启用动态知识时取消联网搜索，取消时恢复
			networkSearch: newWiki ? false : value.networkSearch,
			wiki: newWiki,
		};
		onChange(newState);
	}, [value, onChange]);

	// 下拉菜单项
	const menuItems: MenuProps["items"] = useMemo(() => {
		// 计算总个数（空间 + 知识库 + 知识）
		const totalCount =
			(value.selectedSpaces?.length || 0) +
			(value.selectedLibraries?.length || 0) +
			(value.selectedFiles?.length || 0);
		const hasSelection = totalCount > 0;

		const items: MenuProps["items"] = [
			{
				key: "select-files",
				label: (
					<div className="flex items-center gap-2.5">
						<span className="text-base">@</span>
						<span className={`knowledge-source-menu-text`}>
							{t("chat.select_from_knowledge")}
						</span>
						{hasSelection && (
							<span className="knowledge-source-file-count">{totalCount}</span>
						)}
						<RightOutlined className="knowledge-source-menu-arrow" />
					</div>
				),
				onClick: handleOpenFileDialog,
			},
			{ type: "divider" },
			{
				key: "all-knowledge",
				label: (
					<div className="knowledge-source-menu-item">
						<SvgIcon
							name="documents"
							size={16}
							className={value.allKnowledge ? "selected" : ""}
						/>
						<span
							className={`knowledge-source-menu-text ${value.allKnowledge ? "selected" : ""}`}
						>
							{t("knowledge.document_file")}
						</span>
						{value.allKnowledge && (
							<CheckOutlined
								className="knowledge-source-menu-check"
								style={{ fontSize: 14 }}
							/>
						)}
					</div>
				),
				onClick: handleToggleAllKnowledge,
			},
		];

		// 新增:当前知识库动态项(仅 library 模式可见)
		if (library?.value?.length > 0) {
			const currentLibId = String(library.value[0]);
			const isCurrentLibSelected =
				(value.selectedLibraries?.length ?? 0) === 1 &&
				String(value.selectedLibraries?.[0]?.id) === currentLibId;
			items.push({
				key: "current-library",
				label: (
					<div className="knowledge-source-menu-item">
						<SvgIcon
							name="folder"
							size={16}
							className={isCurrentLibSelected ? "selected" : ""}
						/>
						<span
							className={`knowledge-source-menu-text ${isCurrentLibSelected ? "selected" : ""}`}
						>
							{t("library.current_library")}: {library.name}
						</span>
						{isCurrentLibSelected && (
							<CheckOutlined
								className="knowledge-source-menu-check"
								style={{ fontSize: 14 }}
							/>
						)}
					</div>
				),
				onClick: () => {
					onChange({
						...value,
						mode: "libraries",
						allKnowledge: false,
						knowledgeGraph: false,
						networkSearch: false,
						selectedFiles: [],
						selectedLibraries: [
							{
								id: currentLibId,
								name: library.name || "",
								// 来源:library prop 注入的 icon(由 useKnowledgeSenderConfig 在
								// isInLibrary 分支写入)。不允许从旧 selectedLibraries 取,
								// 否则用户先切「全部知识」再点回「当前知识库」时,icon 会丢失。
								icon: library?.icon,
								islibrary: true,
							},
						],
						selectedSpaces: [],
					});
				},
			});
		}

		if (wikiSearchEnabled) {
			items.push({
				key: "wiki",
				label: (
					<div className="knowledge-source-menu-item">
						<SvgIcon
							name="book-one"
							size={16}
							className={value.wiki ? "selected" : ""}
						/>
						<span
							className={`knowledge-source-menu-text ${value.wiki ? "selected" : ""}`}
						>
							{t("chat.wiki")}
						</span>
						{value.wiki && (
							<CheckOutlined
								className="knowledge-source-menu-check"
								style={{ fontSize: 14 }}
							/>
						)}
					</div>
				),
				onClick: handleToggleWiki,
			});
		}
		if (graphSearchEnabled) {
			items.push({
				key: "knowledge-graph",
				label: (
					<div className="knowledge-source-menu-item">
						<SvgIcon
							name="graph_v2"
							size={16}
							className={value.knowledgeGraph ? "selected" : ""}
						/>
						<span
							className={`knowledge-source-menu-text ${value.knowledgeGraph ? "selected" : ""}`}
						>
							{t("chat.knowledge_graph")}
						</span>
						{value.knowledgeGraph && (
							<CheckOutlined
								className="knowledge-source-menu-check"
								style={{ fontSize: 14 }}
							/>
						)}
					</div>
				),
				onClick: handleToggleKnowledgeGraph,
			});
		}

		if (webSearchEnabled) {
			items.push({
				key: "network-search",
				label: (
					<div className="knowledge-source-menu-item">
						<SvgIcon
							name="network"
							size={16}
							className={value.networkSearch ? "selected" : ""}
						/>
						<span
							className={`knowledge-source-menu-text ${value.networkSearch ? "selected" : ""}`}
						>
							{t("chat.online_search")}
						</span>
						{value.networkSearch && (
							<CheckOutlined
								className="knowledge-source-menu-check"
								style={{ fontSize: 14 }}
							/>
						)}
					</div>
				),
				onClick: handleToggleNetworkSearch,
			});
		}

		return items;
	}, [
		graphSearchEnabled,
		webSearchEnabled,
		wikiSearchEnabled,
		value.allKnowledge,
		value.knowledgeGraph,
		value.networkSearch,
		value.wiki,
		value.selectedSpaces,
		value.selectedLibraries,
		value.selectedFiles,
		library,
		handleOpenFileDialog,
		handleToggleAllKnowledge,
		handleToggleKnowledgeGraph,
		handleToggleNetworkSearch,
	]);

	return (
		<>
			<Dropdown
				open={dropdownOpen}
				onOpenChange={handleDropdownOpenChange}
				menu={{ items: menuItems }}
				trigger={["click"]}
				placement="bottomLeft"
				disabled={disabled}
				overlayClassName="knowledge-source-dropdown"
			>
				<Tooltip title={t("index.select_knowledge_range")}>
					<div
						className={`knowledge-source-trigger ${disabled ? "disabled" : ""}`}
					>
						{displayContent.icon}
						<span className="knowledge-source-trigger-text">
							{displayContent.text}
						</span>
						<DownOutlined style={{ fontSize: 12 }} />
					</div>
				</Tooltip>
			</Dropdown>

			<SpaceDialog
				ref={spaceDialogRef}
				onConfirm={handleSelectFiles}
				allowSelectLibrary={allowSelectLibrary}
				allowSelectSpace={allowSelectSpace}
				allowSelectDynamicKnowledge={allowSelectDynamicKnowledge}
			/>
		</>
	);
});
