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
	KnowledgeSourceState,
} from "./types";
import "./selector.css";

export const KnowledgeSourceSelector = forwardRef<
	any,
	KnowledgeSourceSelectorProps
>(function KnowledgeSourceSelector(
	{
		value,
		onChange,
		library,
		disabled,
		allowSelectLibrary = false,
		allowSelectSpace = false,
		agentInfo,
	},
	ref,
) {
	const spaceDialogRef = useRef<any>(null);
	const [dropdownOpen, setDropdownOpen] = useState(false);

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

	// 重置方法
	const reset = useCallback(() => {
		const initialState: KnowledgeSourceState = {
			mode: "all",
			allKnowledge: true,
			knowledgeGraph:
				agentInfo?.settings?.graph_search_setting?.default_enable ?? false,
			networkSearch: false,
			selectedFiles: [],
		};
		onChange(initialState);
	}, [agentInfo, onChange]);

	useImperativeHandle(ref, () => ({ reset }), [reset]);

	// 触发按钮显示内容（图标+文字）
	const displayContent = useMemo(() => {
		// 联网搜索（与全部知识、选择文件互斥）
		if (value.networkSearch) {
			return {
				icon: <SvgIcon name="network" size={16} />,
				text: t("chat.online_search"),
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
		// 传递已选中的文件、知识库和空间
		spaceDialogRef.current?.open(
			value.selectedFiles,
			value.selectedLibraries,
			undefined,
			value.selectedSpaces,
		);
	}, [value.selectedFiles, value.selectedLibraries, value.selectedSpaces]);

	// 从知识库选择文件/知识库/空间
	const handleSelectFiles = useCallback(
		(files: FileItem[], libraries?: LibraryItem[], spaces?: SpaceItem[]) => {
			const hasFiles = files.length > 0;
			const hasLibraries =
				allowSelectLibrary && libraries && libraries.length > 0;
			const hasSpaces = allowSelectSpace && spaces && spaces.length > 0;

			// 都为空时重置为全部知识
			if (!hasFiles && !hasLibraries && !hasSpaces) {
				const newState: KnowledgeSourceState = {
					...value,
					mode: "all",
					allKnowledge: true,
					selectedFiles: [],
					selectedLibraries: [],
					selectedSpaces: [],
					networkSearch: false,
					knowledgeGraph: false,
				};
				onChange(newState);
				return;
			}
			// 确定模式：有文件用 files，否则有知识库用 libraries，否则用 spaces
			const mode = hasFiles ? "files" : hasLibraries ? "libraries" : "spaces";
			const newState: KnowledgeSourceState = {
				...value,
				mode,
				allKnowledge: false,
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
				networkSearch: false,
				knowledgeGraph: false,
			};
			onChange(newState);
		},
		[value, onChange, allowSelectLibrary, allowSelectSpace],
	);

	// 切换全部知识
	const handleToggleAllKnowledge = useCallback(() => {
		// 联网搜索选中时，点击全部知识会取消联网搜索并选中全部知识
		if (value.networkSearch) {
			const newState: KnowledgeSourceState = {
				...value,
				mode: "all",
				allKnowledge: true,
				selectedFiles: [],
				selectedLibraries: [],
				selectedSpaces: [],
				networkSearch: false,
			};
			onChange(newState);
			return;
		}
		// 当前不是全部知识时（allKnowledge = false），点击切换到全部知识
		if (!value.allKnowledge) {
			const newState: KnowledgeSourceState = {
				...value,
				mode: "all",
				allKnowledge: true,
				selectedFiles: [],
				selectedLibraries: [],
				selectedSpaces: [],
			};
			onChange(newState);
			return;
		}
		// 全部知识已选中时，不做任何变化（保持选中）
	}, [value, onChange]);

	// 切换知识图谱（与选择文件、知识库、空间互斥）
	const handleToggleKnowledgeGraph = useCallback(() => {
		const newKnowledgeGraph = !value.knowledgeGraph;
		const newState: KnowledgeSourceState = {
			...value,
			mode: "all",
			allKnowledge: true,
			knowledgeGraph: newKnowledgeGraph,
			networkSearch: false,
			selectedFiles: [],
			selectedLibraries: [],
			selectedSpaces: [],
		};
		onChange(newState);
	}, [value, onChange]);

	// 切换联网搜索（与全部知识、选择文件、知识图谱都互斥）
	const handleToggleNetworkSearch = useCallback(() => {
		const newState: KnowledgeSourceState = {
			...value,
			mode: "all",
			allKnowledge: !value.networkSearch ? false : true, // 选中联网搜索时取消全部知识，取消时恢复
			selectedFiles: [],
			selectedLibraries: [],
			selectedSpaces: [],
			knowledgeGraph: false,
			networkSearch: !value.networkSearch,
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
					<div className="flex items-center gap-[10px]">
						<span className="text-base">@</span>
						<span className={`knowledge-source-menu-text`}>
							{t("chat.select_from_library")}
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
							{t("library.all_knowledge")}
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
		value.allKnowledge,
		value.knowledgeGraph,
		value.networkSearch,
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
				placement="bottom"
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
			/>
		</>
	);
});
