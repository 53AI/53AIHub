/**
 * 「添加到」弹窗：将聊天回答保存为 Markdown 文件到知识库。
 *
 * 从 front-react 的 components/Chat/AddAnswerAsMd 下沉而来，供前台聊天与
 * 后台记录详情抽屉共用。应用差异通过 props 注入：
 * - api：空间/知识库/文件读写适配器（前台按用户权限过滤，后台为管理员全量）
 * - buildFileUrl：创建成功后打开文件的 URL 构建器（可选）
 * - folderIcon：目录树图标（前台用图片，默认 antd FolderOutlined）
 */
import {
	useState,
	useImperativeHandle,
	forwardRef,
	useRef,
	useCallback,
	useEffect,
	useMemo,
	type CSSProperties,
	type ReactNode,
} from "react";
import { Modal, Button, Radio, Input, Tree, Empty, Spin, message } from "antd";
import type { TreeDataNode } from "antd";
import {
	CheckOutlined,
	CloseOutlined,
	FolderOutlined,
	LeftOutlined,
	RightOutlined,
} from "@ant-design/icons";
import { generateUniqueFileName, generateUniqueFolderName } from "@km/shared-utils";
import { SafeImage } from "@km/shared-components-react";
import { useTranslation } from "../../i18n";

/** 空间（应用侧负责权限过滤后传入） */
export interface AddAsMdSpace {
	id: string;
	name: string;
}

/** 知识库 */
export interface AddAsMdLibrary {
	id: string;
	name: string;
	icon?: string;
}

/** 文件/文件夹（type: 0=文件夹） */
export interface AddAsMdFileItem {
	id: string;
	path: string;
	type: number;
	created_time: number;
	updated_time: number;
}

/** 应用侧需实现的 API 适配器 */
export interface AddAnswerAsMdApi {
	/** 空间列表 */
	listSpaces(): Promise<AddAsMdSpace[]>;
	/** 指定空间下的知识库列表 */
	listLibraries(spaceId: string): Promise<AddAsMdLibrary[]>;
	/** 知识库内全部文件（含文件夹） */
	listFiles(libraryId: string): Promise<AddAsMdFileItem[]>;
	/** 创建文件（type: 0=文件夹 1=文件）或文件夹 */
	createFile(data: {
		path: string;
		type: number;
		library_id: string;
		permissions: unknown[];
	}): Promise<AddAsMdFileItem>;
	/** 写入文件内容 */
	createFileBody(data: {
		content: string;
		file_id: string;
		library_id: string;
	}): Promise<unknown>;
	/** 同步 chunk */
	syncChunks(data: { file_id: string }): Promise<unknown>;
}

export interface AddAnswerAsMdProps {
	/** API 适配器 */
	api: AddAnswerAsMdApi;
	/** 创建成功后打开文件的 URL 构建器（可选，缺省仅提示成功） */
	buildFileUrl?: (libraryId: string, fileId: string) => string;
	/** 目录树节点图标（默认 antd FolderOutlined） */
	folderIcon?: ReactNode;
	/** 保存成功回调 */
	onConfirm?: () => void;
}

export interface AddAnswerAsMdRef {
	open: (data: { answer: string; question: string }) => void;
}

/** 目录树节点（本弹窗只展示与选择文件夹） */
interface FolderNode {
	id: string;
	name: string;
	path: string;
	base_path: string;
	checked: boolean;
	isEditing: boolean;
	children: FolderNode[];
}

/** 在树中收集 base_path 等于给定值的节点（用于文件名去重） */
const findNodesInBasePath = (
	basePath: string,
	nodes: FolderNode[],
): FolderNode[] => {
	const result: FolderNode[] = [];
	for (const node of nodes) {
		if (node.base_path === basePath) result.push(node);
		if (node.children.length) {
			result.push(...findNodesInBasePath(basePath, node.children));
		}
	}
	return result;
};

const findFolderByPath = (
	nodes: FolderNode[],
	targetPath: string,
): FolderNode | null => {
	for (const node of nodes) {
		if (node.path === targetPath) return node;
		if (node.children.length) {
			const childNode = findFolderByPath(node.children, targetPath);
			if (childNode) return childNode;
		}
	}
	return null;
};

/** 扁平文件夹列表 → 目录树 */
const buildFolderTree = (files: AddAsMdFileItem[]): FolderNode[] => {
	const map = new Map<string, FolderNode>();
	const roots: FolderNode[] = [];
	files.forEach((file) => {
		const name = file.path.split("/").pop() || "";
		map.set(file.path, {
			id: file.id,
			name,
			path: file.path,
			base_path: file.path.split("/").slice(0, -1).join("/"),
			checked: false,
			isEditing: false,
			children: [],
		});
	});
	files.forEach((file) => {
		const node = map.get(file.path)!;
		const parent = file.path.includes("/")
			? map.get(file.path.split("/").slice(0, -1).join("/"))
			: undefined;
		if (parent) parent.children.push(node);
		else roots.push(node);
	});
	return roots;
};

/** 简易移动端判定（与前台 useResponsive 断点一致） */
const useIsMobile = (): boolean => {
	const [isMobile, setIsMobile] = useState(
		typeof window !== "undefined" ? window.innerWidth < 768 : false,
	);
	useEffect(() => {
		const mq = window.matchMedia("(max-width: 767px)");
		const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
		setIsMobile(mq.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);
	return isMobile;
};

const DEFAULT_FOLDER_ICON = <FolderOutlined />;

export const AddAnswerAsMd = forwardRef<AddAnswerAsMdRef, AddAnswerAsMdProps>(
	({ api, buildFileUrl, folderIcon = DEFAULT_FOLDER_ICON, onConfirm }, ref) => {
		const { t } = useTranslation();
		const [visible, setVisible] = useState(false);
		const [spaceList, setSpaceList] = useState<AddAsMdSpace[]>([]);
		const [libraryList, setLibraryList] = useState<AddAsMdLibrary[]>([]);
		const [folderTree, setFolderTree] = useState<FolderNode[]>([]);
		const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
		const [loading, setLoading] = useState({
			space: false,
			library: false,
			folder: false,
		});
		const [state, setState] = useState({
			spaceId: "",
			libraryId: "",
			fileId: "",
			selectRoot: true,
			content: "",
			question: "",
			creating: false,
			selectedFolderPath: "",
			lastSelectedFolderPath: "",
		});
		const newFolderInputRef = useRef<any>(null);
		const isMobile = useIsMobile();

		// 移动端下钻层级：空间 → 知识库 → 目录；桌面端三列并排
		const [drillLevel, setDrillLevel] = useState<
			"space" | "library" | "folder"
		>("space");
		// 打开弹窗后自动选中首个空间/知识库并加载目录，
		// 移动端随之直接落到目录级，返回键逐级上跳
		const autoJumpedRef = useRef(false);

		const curLibrary =
			libraryList.find((item) => item.id === state.libraryId) || null;
		const confirmBtnDisabled =
			!state.libraryId || (!state.selectRoot && !state.selectedFolderPath);

		useEffect(() => {
			if (!autoJumpedRef.current && state.libraryId) {
				autoJumpedRef.current = true;
				setDrillLevel("folder");
			}
		}, [state.libraryId]);

		const showSpaceCol = !isMobile || drillLevel === "space";
		const showLibraryCol = !isMobile || drillLevel === "library";
		const showFolderCol = !isMobile || drillLevel === "folder";

		useImperativeHandle(ref, () => ({
			open: async (data: { answer: string; question: string }) => {
				setVisible(true);
				autoJumpedRef.current = false;
				setDrillLevel("space");
				// 过滤掉技能执行过程的 skill-run / reasoning 代码块，只保留实际内容
				const content = data.answer
					.replace(/```skill-run\n[\s\S]*?\n```\n?/g, "")
					.replace(/```reasoning\n[\s\S]*?\n```\n?/g, "")
					.trim();
				setState((prev) => ({
					...prev,
					content,
					question: data.question,
					spaceId: "",
					libraryId: "",
					selectRoot: true,
					selectedFolderPath: "",
					lastSelectedFolderPath: "",
				}));
				setLibraryList([]);
				setFolderTree([]);
				setExpandedKeys([]);
				const list = await loadSpaceList();
				if (list && list.length > 0) {
					handleSelectSpace(list[0]);
				}
			},
		}));

		const loadSpaceList = async () => {
			setLoading((prev) => ({ ...prev, space: true }));
			try {
				const list = await api.listSpaces();
				setSpaceList(list);
				return list;
			} finally {
				setLoading((prev) => ({ ...prev, space: false }));
			}
		};

		const loadLibraryList = async (spaceId: string) => {
			setLoading((prev) => ({ ...prev, library: true }));
			try {
				const list = await api.listLibraries(spaceId);
				setLibraryList(list);
				return list;
			} finally {
				setLoading((prev) => ({ ...prev, library: false }));
			}
		};

		const loadFoldersAll = async (libraryId: string) => {
			setLoading((prev) => ({ ...prev, folder: true }));
			try {
				const list = await api.listFiles(libraryId);
				const folders = list.filter((item) => item.type === 0);
				if (folders.length === 0) {
					setFolderTree([]);
					setExpandedKeys([]);
					return;
				}
				const tree = buildFolderTree(folders);
				setFolderTree(tree);
				// 默认展开所有文件夹
				setExpandedKeys(folders.map((item) => item.id));
				return tree;
			} finally {
				setLoading((prev) => ({ ...prev, folder: false }));
			}
		};

		const clearChecked = useCallback((nodes: FolderNode[]) => {
			nodes?.forEach((item) => {
				item.checked = false;
				if (item.children.length) clearChecked(item.children);
			});
		}, []);

		const handleSelectSpace = (item: AddAsMdSpace) => {
			// 移动端：点击空间下钻到知识库层级（去重守卫之前，返回后重选同一空间也能进入）
			if (isMobile) setDrillLevel("library");
			if (state.spaceId === item.id || loading.space) return;
			setState((prev) => ({
				...prev,
				spaceId: item.id,
				libraryId: "",
				selectRoot: true,
				selectedFolderPath: "",
				lastSelectedFolderPath: "",
			}));
			setLibraryList([]);
			setFolderTree([]);
			setExpandedKeys([]);
			loadLibraryList(item.id).then((list) => {
				if (list && list.length > 0) {
					handleSelectLibrary(list[0]);
				}
			});
		};

		const handleSelectLibrary = async (item: AddAsMdLibrary) => {
			// 移动端：点击知识库下钻到目录层级
			if (isMobile) setDrillLevel("folder");
			if (state.libraryId === item.id || loading.library) return;
			setState((prev) => ({
				...prev,
				libraryId: item.id,
				selectRoot: true,
				selectedFolderPath: "",
				lastSelectedFolderPath: "",
			}));
			await loadFoldersAll(item.id);
		};

		const handleSelectRoot = (checked: boolean) => {
			setState((prev) => ({
				...prev,
				selectRoot: checked,
				selectedFolderPath: "",
			}));
			if (checked) {
				clearChecked(folderTree);
				setFolderTree([...folderTree]);
			}
		};

		const handleCheckChange = (data: FolderNode) => {
			clearChecked(folderTree);
			const node = findFolderByPath(folderTree, data.path);
			if (node) node.checked = true;
			setState((prev) => ({
				...prev,
				selectedFolderPath: data.path,
				selectRoot: false,
			}));
			setFolderTree([...folderTree]);
		};

		const removeEmptyNode = (nodes: FolderNode[]) => {
			if (!nodes || nodes.length === 0) return;
			for (let i = nodes.length - 1; i >= 0; i--) {
				const n = nodes[i];
				if (!n.id || n.isEditing) {
					nodes.splice(i, 1);
				}
			}
		};

		const handleCreateFolder = () => {
			if (!state.libraryId) return;
			// 移动端：新建文件夹时切到目录层级，便于看到命名输入框
			if (isMobile) setDrillLevel("folder");
			if (state.lastSelectedFolderPath === "") {
				removeEmptyNode(folderTree);
			} else {
				const prev = findFolderByPath(folderTree, state.lastSelectedFolderPath);
				if (prev) removeEmptyNode(prev.children);
			}
			const newFolder: FolderNode = {
				id: `new-folder-${Date.now()}`,
				name: "",
				path: "",
				base_path: "",
				checked: false,
				isEditing: true,
				children: [],
			};
			if (state.selectRoot) {
				setFolderTree([...folderTree, newFolder]);
				setState((prev) => ({ ...prev, lastSelectedFolderPath: "" }));
				setTimeout(() => {
					newFolderInputRef.current?.focus();
				}, 0);
			} else {
				const parent = findFolderByPath(folderTree, state.selectedFolderPath);
				if (parent) {
					parent.children.push(newFolder);
					if (!expandedKeys.includes(parent.id)) {
						setExpandedKeys([...expandedKeys, parent.id]);
					}
					setFolderTree([...folderTree]);
					setState((prev) => ({
						...prev,
						lastSelectedFolderPath: state.selectedFolderPath,
					}));
					setTimeout(() => {
						newFolderInputRef.current?.focus();
					}, 0);
				}
			}
		};

		const handleConfirmCreateFolderWithValue = async (
			_node: FolderNode,
			value: string,
		) => {
			if (!state.selectRoot && !state.selectedFolderPath) {
				message.warning(t("library.select_folder_first"));
				return;
			}
			const safeValue = value.replace(/\//g, "");
			if (!safeValue) {
				message.warning(t("library.input_folder_name"));
				return;
			}
			const base = state.selectRoot ? "" : state.selectedFolderPath;
			const parent = state.selectRoot
				? null
				: findFolderByPath(folderTree, state.selectedFolderPath);
			const list = state.selectRoot
				? folderTree.slice(0, -1)
				: parent?.children.filter((n) => !!n.id) || [];
			const name = generateUniqueFolderName(safeValue, list);
			const path = `${base}/${name}`.replace(/\/+/g, "/");
			try {
				await api.createFile({
					path,
					type: 0,
					library_id: state.libraryId,
					permissions: [],
				});
				message.success(t("library.create_success"));
				const newTree = await loadFoldersAll(state.libraryId);
				if (newTree) {
					selectCurFolder(newTree, path);
				}
			} catch (e) {
				console.error(e);
			}
		};

		const selectCurFolder = (
			nodes: FolderNode[],
			targetPath: string,
		): boolean => {
			for (const fileData of nodes) {
				if (fileData.path === targetPath) {
					fileData.checked = true;
					fileData.isEditing = false;
					setState((prev) => ({
						...prev,
						selectedFolderPath: fileData.path,
						selectRoot: false,
					}));
					clearChecked(nodes);
					fileData.checked = true;
					setFolderTree([...nodes]);
					return true;
				}
				if (fileData.children.length) {
					if (selectCurFolder(fileData.children, targetPath)) return true;
				}
			}
			return false;
		};

		const handleCancelCreateFolder = (data: FolderNode) => {
			if (state.selectRoot) {
				setFolderTree(folderTree.slice(0, -1));
			} else {
				const parent = findFolderByPath(folderTree, state.selectedFolderPath);
				if (parent) {
					const index = parent.children.findIndex((d) => d.id === data.id);
					if (index !== -1) {
						parent.children.splice(index, 1);
					}
				}
				setFolderTree([...folderTree]);
			}
		};

		const handleClose = () => {
			setVisible(false);
		};

		const createMd = async (
			path: string,
		): Promise<{ fileId: string; libraryId: string }> => {
			const nodes = findNodesInBasePath(path, folderTree);
			const name = generateUniqueFileName(state.question, nodes) + ".md";
			const res = await api.createFile({
				path: `${path}/${name}`,
				type: 1,
				library_id: state.libraryId,
				permissions: [],
			});
			setState((prev) => ({ ...prev, fileId: res.id }));
			await api.createFileBody({
				content: state.content,
				file_id: res.id,
				library_id: state.libraryId,
			});
			await api.syncChunks({ file_id: res.id });
			message.success(t("action.save_success"));
			return { fileId: res.id, libraryId: state.libraryId };
		};

		const handleConfirm = async () => {
			const basePath = state.selectRoot ? "" : state.selectedFolderPath;
			setState((prev) => ({ ...prev, creating: true }));
			try {
				const result = await createMd(basePath);
				onConfirm?.();
				setTimeout(() => {
					if (buildFileUrl) {
						window.open(
							buildFileUrl(result.libraryId, result.fileId),
							"_blank",
						);
					}
					handleClose();
				}, 1000);
			} catch (error) {
				console.error(error);
				message.error(t("action.save_failed"));
			} finally {
				setState((prev) => ({ ...prev, creating: false }));
			}
		};

		const convertToTreeData = (
			nodes: FolderNode[],
			parentPath = "",
		): TreeDataNode[] => {
			return nodes.map((node, index) => ({
				key: node.id || `temp-${parentPath}-${index}`,
				path: node.path,
				isEditing: node.isEditing,
				title: node.isEditing ? (
					<div className="p-2 flex items-center gap-2">
						<span className="size-6 flex-center shrink-0">{folderIcon}</span>
						<Input
							ref={newFolderInputRef}
							key={node.id || "new-folder"}
							defaultValue={t("library.untitled_folder")}
							className="flex-1 min-w-0"
							style={{ maxWidth: 200 }}
							onPressEnter={(e) => {
								const input = e.target as HTMLInputElement;
								const value = input.value.trim();
								if (value) {
									handleConfirmCreateFolderWithValue(node, value);
								}
							}}
						/>
						<CheckOutlined
							className="cursor-pointer hover:opacity-70 mr-1"
							onClick={() => {
								const input = newFolderInputRef.current?.input;
								const value = (input as HTMLInputElement)?.value?.trim();
								if (value) {
									handleConfirmCreateFolderWithValue(node, value);
								}
							}}
						/>
						<CloseOutlined
							className="cursor-pointer hover:opacity-70"
							onClick={() => handleCancelCreateFolder(node)}
						/>
					</div>
				) : (
					<div className="w-full h-10 p-2 flex justify-between items-center">
						<div className="flex-1 flex items-center gap-2">
							<span className="size-6 flex-center shrink-0">{folderIcon}</span>
							<span className="text-sm text-[#1D1E1F] truncate">
								{node.name}
							</span>
						</div>
						<Radio
							checked={node.checked}
							onClick={(e) => e.stopPropagation()}
							onChange={() => handleCheckChange(node)}
						/>
					</div>
				),
				children: node.children.length
					? convertToTreeData(node.children, node.path)
					: undefined,
			}));
		};

		const treeData = useMemo(
			() => convertToTreeData(folderTree),
			// eslint-disable-next-line react-hooks/exhaustive-deps
			[folderTree, folderIcon],
		);

		return (
			<Modal
				open={visible}
				title={
					<span>
						<span className="text-lg">{t("library.add_to")}</span>
						<span className="text-sm text-[#999999] ml-2 font-normal">
							{t("library.can_add_to")}
						</span>
					</span>
				}
				width={isMobile ? "95%" : 840}
				centered
				destroyOnHidden
				onCancel={handleClose}
				mask={{ closable: false }}
				footer={
					<div className="flex flex-wrap items-center justify-between gap-2">
						<Button
							type="link"
							className="px-0"
							disabled={!state.libraryId}
							onClick={handleCreateFolder}
						>
							+ {t("library.create_folder")}
						</Button>
						<div className="flex gap-2">
							<Button onClick={handleClose}>{t("action.cancel")}</Button>
							<Button
								type="primary"
								loading={state.creating}
								disabled={confirmBtnDisabled}
								onClick={handleConfirm}
							>
								{t("action.confirm")}
							</Button>
						</div>
					</div>
				}
			>
				<div className="h-[500px] max-md:h-[55vh] flex flex-col md:flex-row overflow-hidden border rounded-lg">
					{/* Space Panel */}
					<div
						className={`${showSpaceCol ? "flex" : "hidden md:flex"} flex-col overflow-hidden p-2 w-full flex-1 min-h-0 md:flex-none md:w-[170px] md:h-auto md:border-r`}
					>
						<div className="h-10 px-4 flex items-center text-sm text-[#999999]">
							{t("library.team_space")}
						</div>
						<div className="flex-1 space-y-1 overflow-y-auto">
							{loading.space ? (
								<div className="flex items-center justify-center h-full">
									<Spin />
								</div>
							) : spaceList.length === 0 ? (
								<Empty
									description={t("library.no_space")}
									image={Empty.PRESENTED_IMAGE_SIMPLE}
								/>
							) : (
								spaceList.map((item) => (
									<div
										key={item.id}
										className={`h-10 pl-4 flex items-center gap-2 rounded cursor-pointer text-[#1D1E1F] hover:bg-[#F2F3F5] ${state.spaceId === item.id ? "bg-[#F2F3F5]" : ""}`}
										onClick={() => handleSelectSpace(item)}
									>
										<span className="size-4 flex-center">
											<FolderOutlined />
										</span>
										<p className="flex-1 text-sm truncate">{item.name}</p>
										{state.spaceId === item.id && (
											<RightOutlined className="text-xs text-[#999]" />
										)}
									</div>
								))
							)}
						</div>
					</div>

					{/* Library Panel */}
					<div
						className={`${showLibraryCol ? "flex" : "hidden md:flex"} flex-col overflow-hidden p-2 w-full flex-1 min-h-0 md:flex-none md:w-[170px] md:h-auto md:border-r`}
					>
						{isMobile ? (
							<div
								className="h-10 px-2 flex items-center gap-1"
								onClick={() => setDrillLevel("space")}
							>
								<div className="size-7 flex items-center justify-center rounded cursor-pointer hover:bg-[#F2F3F5]">
									<LeftOutlined className="text-xs text-[#999]" />
								</div>
								<span className="flex-1 text-sm text-[#999999] truncate">
									{spaceList.find((s) => s.id === state.spaceId)?.name ||
										t("library.team_space")}
								</span>
							</div>
						) : (
							<div className="h-10 px-4 flex items-center text-sm text-[#999999]">
								{t("library.name")}
							</div>
						)}
						<div className="flex-1 space-y-1 overflow-y-auto">
							{loading.library ? (
								<div className="flex items-center justify-center h-full">
									<Spin />
								</div>
							) : libraryList.length === 0 ? (
								<Empty
									description={t("library.no_library")}
									image={Empty.PRESENTED_IMAGE_SIMPLE}
								/>
							) : (
								libraryList.map((item) => (
									<div
										key={item.id}
										className={`h-10 pl-4 flex items-center gap-2 rounded cursor-pointer text-[#1D1E1F] hover:bg-[#F2F3F5] ${state.libraryId === item.id ? "bg-[#F2F3F5]" : ""}`}
										onClick={() => handleSelectLibrary(item)}
									>
										{item.icon && (
											<SafeImage src={item.icon} className="size-6" alt="" />
										)}
										<p className="flex-1 text-sm truncate">{item.name}</p>
										{state.libraryId === item.id && (
											<RightOutlined className="text-xs text-[#999]" />
										)}
									</div>
								))
							)}
						</div>
					</div>

					{/* Folder Tree Panel */}
					<div
						className={`${showFolderCol ? "flex" : "hidden md:flex"} flex-1 min-h-0 p-2 flex-col overflow-hidden`}
					>
						{isMobile ? (
							// 移动端：返回键 + 当前知识库名 + 根目录选择合并为一行
							<div
								className="h-10 px-2 flex items-center gap-1 cursor-pointer"
								onClick={() => setDrillLevel("library")}
							>
								<div className="size-7 flex-none flex items-center justify-center rounded cursor-pointer hover:bg-[#F2F3F5]">
									<LeftOutlined className="text-xs text-[#999]" />
								</div>
								<span className="flex-1 min-w-0 text-sm text-[#999999] truncate">
									{curLibrary?.name || t("library.name")}
								</span>
								<div
									className="flex-none flex items-center text-sm text-[#999999]"
									onClick={(e) => {
										e.stopPropagation();
										handleSelectRoot(!state.selectRoot);
									}}
								>
									{t("library.root_folder")}
									<Radio className="ml-1" checked={state.selectRoot} />
								</div>
							</div>
						) : (
							<div
								className="h-10 px-2 md:px-7 flex items-center justify-between gap-2 text-sm text-[#999999] relative hover:bg-[#F2F3F5] cursor-pointer"
								onClick={() => handleSelectRoot(!state.selectRoot)}
							>
								{curLibrary && (
									<div className="flex-1 min-w-0 flex items-center gap-2">
										{curLibrary.icon && (
											<SafeImage src={curLibrary.icon} className="size-6" alt="" />
										)}
										<span className="text-sm text-[#1D1E1F] truncate">
											{curLibrary.name}
										</span>
									</div>
								)}
								<div className="flex-none flex items-center">
									{t("library.root_folder")}
									<Radio className="ml-1" checked={state.selectRoot} />
								</div>
							</div>
						)}
						<div className="flex-1 min-h-0 overflow-y-auto">
							{loading.folder ? (
								<div className="flex items-center justify-center h-full">
									<Spin />
								</div>
							) : folderTree.length === 0 ? (
								<Empty
									description={t("library.no_folder")}
									image={Empty.PRESENTED_IMAGE_SIMPLE}
								/>
							) : (
								<Tree
									blockNode={true}
									expandedKeys={expandedKeys}
									onExpand={(keys) => setExpandedKeys(keys as string[])}
									style={
										{
											"--ant-tree-indent-size": "6px",
											"--ant-tree-title-height": "40px",
										} as CSSProperties
									}
									treeData={treeData}
									onSelect={(_keys, info) => {
										// 点击行与 Radio 同效：切换选中目录
										const treeNode = info.node as any;
										if (treeNode?.path && !treeNode.isEditing) {
											const originalNode = findFolderByPath(
												folderTree,
												treeNode.path,
											);
											if (originalNode) {
												originalNode.checked = !originalNode.checked;
												handleCheckChange(originalNode);
											}
										}
									}}
								/>
							)}
						</div>
					</div>
				</div>
			</Modal>
		);
	},
);

AddAnswerAsMd.displayName = "AddAnswerAsMd";

export default AddAnswerAsMd;
