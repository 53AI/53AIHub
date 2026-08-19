import { useCallback, useRef, useState } from 'react'

export interface TreeNode {
	id: string
	name: string
	path: string
	hasChildren?: boolean
	/**
	 * 该节点对当前用户不可作为移动目标（如无权限）。
	 * MoveToModal 会据此禁用 radio 并展示 disabledReason 的 tooltip。
	 */
	disabled?: boolean
	/** 禁用原因文案，传给 tooltip；与 disabled 配合使用 */
	disabledReason?: string
}

export type FetchDirsFn = (params: {
	path?: string
	keyword?: string
	type?: 'dir' | 'file'
}) => Promise<{ data: any[] }>

interface NodeState {
	loaded: boolean
	loading: boolean
	error: boolean
	children: TreeNode[]
}

export interface UseFolderTreeReturn {
	// 目录树相关
	rootDirNodes: TreeNode[]
	loadDirChildren: (path: string) => Promise<void>
	isDirLoading: (path: string) => boolean
	dirError: (path: string) => boolean
	reloadDir: (path: string) => Promise<void>
	// 文件列表相关（与目录树同样的懒加载/缓存语义，但 key 用 path+':file'）
	rootFileNodes: TreeNode[]
	loadFileChildren: (path: string) => Promise<void>
	isFileLoading: (path: string) => boolean
	fileError: (path: string) => boolean
	reloadFile: (path: string) => Promise<void>
	// 任意节点的已加载子节点读取（懒加载场景必备：buildDirNode 用来给
	// 任意目录节点填 DataNode.children，否则 antd Tree 看不到懒加载后的子树）
	getDirChildren: (path: string) => TreeNode[]
	getFileChildren: (path: string) => TreeNode[]
	/**
	 * 缓存变更计数：每次 cacheRef 内容变化（load 成功、reset、reload 等）即 +1。
	 * 用作 React 侧 useMemo 的依赖项，让消费方在懒加载子树变动时重算 treeData。
	 */
	version: number
	// 公共
	reset: () => void
	/**
	 * 根据节点 id 反查路径。在 load 成功后会被填充，
	 * 用于 antd Tree 的懒加载场景（DataNode 不携带 path）。
	 */
	getPathById: (id: string) => string | undefined
	/**
	 * 根据路径反查节点 id。与 getPathById 互为反向。
	 */
	getIdByPath: (path: string) => string | undefined
}

const ROOT_KEY = '__root__'

function mapToTreeNode(raw: any): TreeNode {
	return {
		id: String(raw.id),
		name: raw.name || raw.path?.split('/').pop() || raw.path,
		path: raw.path,
		hasChildren: raw.has_children ?? undefined,
	}
}

export function useFolderTree(fetchDirs: FetchDirsFn): UseFolderTreeReturn {
	// 缓存 key 用 `${type}:${path}` 区分目录与文件，避免互相覆盖
	const cacheRef = useRef<Map<string, NodeState>>(new Map())
	// idMap: 维护已经加载过的节点 id -> path 的映射。
	// load 成功时同步写入，reset/reload 时同步清理。
	const idMapRef = useRef<Map<string, string>>(new Map())
	const [version, setVersion] = useState(0)
	const trigger = () => setVersion((n) => n + 1)

	const dirKey = (path: string) => `dir:${path || ROOT_KEY}`
	const fileKey = (path: string) => `file:${path || ROOT_KEY}`

	const getState = (key: string): NodeState => {
		let s = cacheRef.current.get(key)
		if (!s) {
			s = { loaded: false, loading: false, error: false, children: [] }
			cacheRef.current.set(key, s)
		}
		return s
	}

	// 把已加载节点的 id->path 写入 idMap（不覆盖已有 mapping，避免 reload 后 key 漂移）
	const ingestIdMap = useCallback((children: TreeNode[]) => {
		for (const c of children) {
			if (!idMapRef.current.has(c.id)) {
				idMapRef.current.set(c.id, c.path)
			}
		}
	}, [])

	const loadChildrenByType = useCallback(
		async (path: string, type: 'dir' | 'file') => {
			const key = type === 'dir' ? dirKey(path) : fileKey(path)
			const state = getState(key)
			if (state.loaded || state.loading) return
			state.loading = true
			state.error = false
			trigger()
			try {
				const res = await fetchDirs({ path, type })
				const mapped = (res.data || []).map(mapToTreeNode)
				state.children = mapped
				state.loaded = true
				ingestIdMap(mapped)
			} catch (e) {
				console.error('useFolderTree loadChildren failed:', path, type, e)
				state.error = true
			} finally {
				state.loading = false
				trigger()
			}
		},
		[fetchDirs, ingestIdMap],
	)

	const loadDirChildren = useCallback(
		(path: string) => loadChildrenByType(path, 'dir'),
		[loadChildrenByType],
	)
	const loadFileChildren = useCallback(
		(path: string) => loadChildrenByType(path, 'file'),
		[loadChildrenByType],
	)

	const reloadByType = useCallback(
		async (path: string, type: 'dir' | 'file') => {
			const key = type === 'dir' ? dirKey(path) : fileKey(path)
			const state = getState(key)
			for (const child of state.children) {
				idMapRef.current.delete(child.id)
			}
			cacheRef.current.delete(key)
			trigger()
			await loadChildrenByType(path, type)
		},
		[loadChildrenByType],
	)

	const reloadDir = useCallback(
		(path: string) => reloadByType(path, 'dir'),
		[reloadByType],
	)
	const reloadFile = useCallback(
		(path: string) => reloadByType(path, 'file'),
		[reloadByType],
	)

	const reset = useCallback(() => {
		cacheRef.current.clear()
		idMapRef.current.clear()
		trigger()
	}, [])

	const getPathById = useCallback((id: string) => idMapRef.current.get(id), [])
	const getIdByPath = useCallback((path: string) => {
		// 先在 dir 缓存里查；dir 是树的主干，命中率最高
		const dirState = cacheRef.current.get(dirKey(path))
		if (dirState) {
			const found = dirState.children.find((c) => c.path === path)
			if (found) return found.id
		}
		const fileState = cacheRef.current.get(fileKey(path))
		if (fileState) {
			const found = fileState.children.find((c) => c.path === path)
			if (found) return found.id
		}
		return undefined
	}, [])

	// 根目录与根文件状态：loadDirChildren('/') 与 loadFileChildren('/') 写入对应 key
	const rootDirState = getState(dirKey('/'))
	const rootFileState = getState(fileKey('/'))

	// 只读访问：未加载过的 path 返回空数组（不会创建 cache 条目，避免污染）
	const readChildren = (key: string): TreeNode[] => cacheRef.current.get(key)?.children ?? []

	return {
		rootDirNodes: rootDirState.children,
		loadDirChildren,
		isDirLoading: (path: string) => getState(dirKey(path)).loading,
		dirError: (path: string) => getState(dirKey(path)).error,
		reloadDir,
		rootFileNodes: rootFileState.children,
		loadFileChildren,
		isFileLoading: (path: string) => getState(fileKey(path)).loading,
		fileError: (path: string) => getState(fileKey(path)).error,
		reloadFile,
		getDirChildren: (path: string) => readChildren(dirKey(path)),
		getFileChildren: (path: string) => readChildren(fileKey(path)),
		version,
		reset,
		getPathById,
		getIdByPath,
	}
}