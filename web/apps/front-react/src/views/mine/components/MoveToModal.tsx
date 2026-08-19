import { useEffect, useMemo, useState } from 'react'
import { Modal, Radio, Spin, Tooltip, Tree } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { Search as SearchInput } from '@km/shared-components-react'
import { t } from '@/locales'
import { getPublicPath } from '@/utils/config'
import { formatFileInfo } from '@/api/modules/files/transform'
import { useFolderTree, type FetchDirsFn, type TreeNode } from '../hooks/useFolderTree'
import { isIllegalTarget } from '../utils/isIllegalTarget'
import './move-to.css'

export interface MoveToModalSource {
	id: string
	name: string
	path: string
	isfolder: boolean
	/** 文件后缀（去掉点），用于 MoveToModal 内部推 icon；可缺省 */
	file_ext?: string
	/** 可选：父组件已计算好的 icon URL（缺省时 MoveToModal 内部推） */
	icon?: string
}

export interface MoveToModalProps {
	open: boolean
	title?: string
	sourceItem: MoveToModalSource | null
	fetchDirs: FetchDirsFn
	onConfirm: (targetPath: string) => Promise<void> | void
	onCancel: () => void
	/**
	 * 文件行 icon 解析器。默认与 uploaded 外层一致：formatFileInfo(name, false).icon。
	 * 录音视图传固定 recrod.png 等专属图标时通过此 prop 覆盖。
	 */
	resolveFileIcon?: (node: TreeNode) => string
}

const ROOT_PATH = '/'
const ROOT_KEY = 'root'

// i18n fallback：保证对应 i18n key 在 CSV 未及时同步时仍能渲染合理文案
const MOVE_TO_FALLBACK = '移动到'
const MOVE_TO_ROOT_FALLBACK = '根目录'
const MOVE_TO_LOAD_FAILED_FALLBACK = '文件夹加载失败'
const MOVE_TO_RETRY_FALLBACK = '重试'
const MOVE_TO_EMPTY_FALLBACK = '暂无子项'
const MOVE_TO_NO_MATCH_FALLBACK = '无匹配目录'
const MOVE_TO_CANNOT_FILE_FALLBACK = '不支持移动到当前类型下'
const MOVE_TO_SEARCH_FALLBACK = '搜索'
const MOVE_TO_NO_PERMISSION_FALLBACK = '当前用户没有操作权限'

// 文件行默认 icon 解析：复用 formatFileInfo 与 uploaded 外层保持一致
const defaultResolveFileIcon = (node: TreeNode): string => formatFileInfo(node.name, false).icon

/**
 * 移动到目标目录弹窗
 * - 顶部 SearchInput（220 宽 + 内置防抖）：keyword 为空时显示树状面板，非空时切换为扁平搜索列表
 * - 搜索列表：调 fetchDirs({ keyword, type: 'dir' })，展示 icon + 名称 + 单选 radio
 * - 主体区（无 keyword）：根节点行（"我的根目录"）+ 懒加载树状目录 + 同级文件行（radio 禁用）
 * - 单选 radio：选择根目录或子目录；选中非法目标（自身或后代）则确认按钮禁用
 * - 文件行 radio 永久禁用（移动目标不能是文件）；文件行 icon 默认走 formatFileInfo，可通过 resolveFileIcon prop 覆盖
 */
export function MoveToModal({
	open,
	sourceItem,
	fetchDirs,
	onConfirm,
	onCancel,
	title,
	resolveFileIcon = defaultResolveFileIcon,
}: MoveToModalProps) {
	// 在 useFolderTree 入口处过滤掉 path === '/' 的「根目录自引用」条目。
	// 后端 mySpaceApi.getUploads 在 dir 列表里会把根目录自身也带回来（项目里其他 7 处
	// 调用点都在各自边界做此过滤）。如果不处理，buildDirNode 递归到根节点时会调
	// getDirChildren('/')，而该缓存里又包含同一个 path === '/' 的节点，导致死循环
	// 直至 Maximum call stack size exceeded。这里在 MoveToModal 边界做一次过滤，
	// 让组件自带防御，不依赖调用方记住这个细节。
	const filteredFetchDirs = useMemo<FetchDirsFn>(
		() => async (params) => {
			const res = await fetchDirs(params)
			const data = (res.data || []).filter((item: any) => item.path !== '/')
			return { data }
		},
		[fetchDirs],
	)
	const tree = useFolderTree(filteredFetchDirs)
	const [keyword, setKeyword] = useState('')
	const [selectedPath, setSelectedPath] = useState<string>('')
	const [submitting, setSubmitting] = useState(false)
	const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([])
	const [searchResults, setSearchResults] = useState<TreeNode[]>([])

	// 打开弹窗时初始化：清空状态 + 重新加载根目录与根文件
	useEffect(() => {
		if (!open) return
		setKeyword('')
		setSelectedPath('')
		setExpandedKeys([])
		setSearchResults([])
		tree.reset()
		void tree.loadDirChildren(ROOT_PATH)
		void tree.loadFileChildren(ROOT_PATH)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open])

	// 搜索防抖：SearchInput 自带 800ms 防抖，keyword 非空时调 fetchDirs({ keyword, type: 'dir' })
	useEffect(() => {
		if (!keyword.trim()) {
			setSearchResults([])
			return
		}
		let cancelled = false
		fetchDirs({ keyword: keyword.trim(), type: 'dir' })
			.then((res) => {
				if (cancelled) return
				setSearchResults(
					(res.data || []).map((raw: any) => ({
						id: String(raw.id),
						name: raw.name || raw.path?.split('/').pop() || raw.path,
						path: raw.path,
					})),
				)
			})
			.catch(() => {
				if (cancelled) return
				setSearchResults([])
			})
		return () => {
			cancelled = true
		}
	}, [keyword, fetchDirs])

	/** 目录树行的 DataNode 构造器（递归：把已加载的子目录与子文件拼成 children，使 antd Tree 看到懒加载后的子树） */
	const buildDirNode = (node: { id: string; name: string; path: string; disabled?: boolean; disabledReason?: string }): DataNode => {
		const isSelected = selectedPath === node.path
		const illegal = sourceItem ? isIllegalTarget(sourceItem.path, node.path) : false
		// 节点被调用方标记为禁用（如无操作权限）同样禁止选中
		const unavailable = illegal || !!node.disabled
		const tipTitle = node.disabledReason
		// 取该目录节点已加载的子目录与子文件
		const childDirs = tree.getDirChildren(node.path)
		const childFiles = tree.getFileChildren(node.path)
		const childNodes = [
			...childDirs.map(buildDirNode),
			...childFiles.map(buildFileNode),
		]
		const row = (
			<div
				className={`group flex items-center gap-2 w-full ${unavailable ? 'opacity-50 cursor-not-allowed' : ''}`}
			>
				<img
					className="flex-none w-5 h-5"
					src={getPublicPath('/images/file/folder.png')}
					alt=""
				/>
				<Tooltip title={node.name} placement="topLeft">
					<span className="flex-1 truncate text-sm min-w-0">{node.name}</span>
				</Tooltip>
				<span onClick={(e) => e.stopPropagation()}>
					<Radio
						checked={isSelected}
						disabled={unavailable}
						className={`${isSelected ? '' : 'opacity-0 group-hover:opacity-100'}`}
						onChange={() => {
							if (unavailable) return
							setSelectedPath((prev) => (prev === node.path ? '' : node.path))
						}}
					/>
				</span>
			</div>
		)
		return {
			key: node.id,
			title: tipTitle ? <Tooltip title={tipTitle}>{row}</Tooltip> : row,
			children: childNodes,
		}
	}

	/** 文件行 DataNode（radio 永久禁用） */
	const buildFileNode = (node: TreeNode): DataNode => {
		const icon = resolveFileIcon(node)
		// 使用 formatFileInfo 处理文件名，消除双重扩展名（如 .xls.md → 只显示原始文件名）
		const { fname: displayName } = formatFileInfo(node.name, false)
		// 文件默认禁用原因；调用方传 disabledReason 可覆盖（如无权限）
		const fileTip =
			node.disabledReason ||
			t('move_to.cannot_move_to_file') ||
			MOVE_TO_CANNOT_FILE_FALLBACK
		return {
			key: node.id,
			isLeaf: true,
			title: (
				<Tooltip title={fileTip}>
					<div className="group flex items-center gap-2 w-full opacity-60 cursor-not-allowed">
						<img className="flex-none w-5 h-5" src={icon} alt="" />
							<span className="flex-1 truncate text-sm min-w-0">{displayName}</span>
							<span onClick={(e) => e.stopPropagation()}>
								<Radio checked={false} disabled className="opacity-0 group-hover:opacity-100" />
							</span>
					</div>
				</Tooltip>
			),
			children: [],
			disableCheckbox: true,
		}
	}

	/** 树面板数据：根目录 + 根文件。
	 * deps 包含 tree.version：每次内部 cache 变化（loadData 完成）都重算，
	 * 否则懒加载子树会被 useMemo 缓存住、antd Tree 看不见。
	 */
	const treeData: DataNode[] = useMemo(() => {
		const dirs = tree.rootDirNodes.map(buildDirNode)
		const files = tree.rootFileNodes.map(buildFileNode)
		return [...dirs, ...files]
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tree.rootDirNodes, tree.rootFileNodes, tree.version, selectedPath, sourceItem])

	const handleSelect = (_keys: React.Key[], info: any) => {
		const key = info.node?.key as string | undefined
		if (!key) return
		const path = tree.getPathById(key)
		if (!path) return
		// 文件行（不在 dir 缓存里）不进入选择逻辑
		const isFile = tree.rootFileNodes.some((n) => n.id === key)
		if (isFile) return
		// 非法目标（自身或后代）：禁止选中（即便用户点行也不要触发 selectedPath）
		if (sourceItem && isIllegalTarget(sourceItem.path, path)) return
		setSelectedPath((prev) => (prev === path ? '' : path))
	}

	const handleLoadData = async (node: any) => {
		const key = node.key as string | undefined
		if (!key) return
		const path = tree.getPathById(key)
		if (!path) return
		await Promise.all([tree.loadDirChildren(path), tree.loadFileChildren(path)])
	}

	const handleConfirm = async () => {
		if (!selectedPath || !sourceItem) return
		if (isIllegalTarget(sourceItem.path, selectedPath)) return
		setSubmitting(true)
		try {
			await onConfirm(selectedPath)
		} finally {
			setSubmitting(false)
		}
	}

	// 根目录行：根据 isIllegalTarget 决定是否禁用 radio
	const rootRadioDisabled = sourceItem ? isIllegalTarget(sourceItem.path, ROOT_PATH) : false

	const rootIsLoading = tree.isDirLoading(ROOT_PATH) || tree.isFileLoading(ROOT_PATH)
	const rootHasError = tree.dirError(ROOT_PATH) || tree.fileError(ROOT_PATH)
	const rootIsEmpty = tree.rootDirNodes.length === 0 && tree.rootFileNodes.length === 0

	return (
		<Modal
			open={open}
			title={t('action.move_to') || MOVE_TO_FALLBACK}
			onCancel={onCancel}
			onOk={handleConfirm}
			okButtonProps={{
				disabled: !selectedPath || submitting || (sourceItem ? isIllegalTarget(sourceItem.path, selectedPath) : false),
				loading: submitting,
			}}
			okText={t('action.confirm')}
			cancelText={t('action.cancel')}
			width={880}
			destroyOnHidden
			mask={{ closable: false }}
		>
			<div className="py-2">
				<SearchInput
					value={keyword}
					onDebouncedChange={(val) => setKeyword(val)}
					placeholder={t('action.search') || MOVE_TO_SEARCH_FALLBACK}
					mode="expanded"
					debounceMs={300}
					className="w-[220px]"
				/>
			</div>

			<div className="border border-gray-100 rounded p-2 max-h-[400px] overflow-y-auto">
				{/* 根节点行（"我的根目录"），始终展示 */}
				<div
					className={`group flex items-center gap-2 px-2 py-1 h-9 cursor-pointer hover:bg-gray-50 ${rootRadioDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
					onClick={() => {
						if (rootRadioDisabled) return
						setSelectedPath((p) => (p === ROOT_PATH ? '' : ROOT_PATH))
					}}
				>
					{title && <div className="h-8 flex-1 flex items-center px-3 text-sm">{title}</div>}
					<div className={`flex items-center gap-1 ${selectedPath === ROOT_PATH ? '' : 'opacity-0 group-hover:opacity-100'}`}>
						<span className="text-sm text-secondary">{t('move_to.root_dir') || MOVE_TO_ROOT_FALLBACK}</span>
						<Radio
							checked={selectedPath === ROOT_PATH}
							disabled={rootRadioDisabled}
						/>
					</div>
				</div>

				{/* 树状面板（无 keyword 时显示） */}
				{!keyword.trim() && (
					rootIsLoading && rootIsEmpty ? (
						<div className="flex justify-center py-4"><Spin size="small" /></div>
					) : rootHasError ? (
						<div className="text-sm text-[#9A9A9A] flex items-center gap-2 py-2">
							{t('move_to.folder_load_failed') || MOVE_TO_LOAD_FAILED_FALLBACK}
							<a onClick={() => { tree.reloadDir(ROOT_PATH); tree.reloadFile(ROOT_PATH) }}>{t('move_to.retry') || MOVE_TO_RETRY_FALLBACK}</a>
						</div>
					) : rootIsEmpty ? (
						<div className="text-sm text-[#9A9A9A] py-2">{t('move_to.empty') || MOVE_TO_EMPTY_FALLBACK}</div>
					) : (
						<Tree
							treeData={treeData}
							expandedKeys={expandedKeys}
							onExpand={(keys) => setExpandedKeys(keys)}
							selectedKeys={[]}
							onSelect={handleSelect}
							loadData={handleLoadData}
							blockNode
							className="move-to-tree"
						/>
					)
				)}

				{/* 搜索结果面板：扁平列表 + icon + 名称 + radio */}
				{keyword.trim() && (
					searchResults.length === 0 ? (
						<div className="text-sm text-[#9A9A9A] py-2">{t('move_to.no_match') || MOVE_TO_NO_MATCH_FALLBACK}</div>
					) : (
						<div className="flex flex-col">
							{searchResults.map((node) => {
								const isSelected = selectedPath === node.path
								const illegal = sourceItem ? isIllegalTarget(sourceItem.path, node.path) : false
								const unavailable = illegal || !!node.disabled
								const row = (
									<div
										key={node.id}
										className={`flex items-center gap-2 px-1 py-1 cursor-pointer hover:bg-gray-50 ${unavailable ? 'opacity-50 cursor-not-allowed' : ''} ${
											isSelected ? 'bg-[#E8F3FF]' : ''
										}`}
										onClick={() => {
											if (unavailable) return
											setSelectedPath((p) => (p === node.path ? '' : node.path))
										}}
									>
										<img
											className="flex-none w-5 h-5"
											src={getPublicPath('/images/file/folder.png')}
											alt=""
										/>
										<span className="flex-1 text-sm truncate">{node.name}</span>
										<Radio checked={isSelected} disabled={unavailable} />
									</div>
								)
								return node.disabledReason ? (
									<Tooltip key={node.id} title={node.disabledReason}>{row}</Tooltip>
								) : (
									row
								)
							})}
						</div>
					)
				)}
			</div>
		</Modal>
	)
}

export default MoveToModal