import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, Outlet, useMatch, useNavigate, useSearchParams } from 'react-router-dom'
import { Input, Modal, message } from 'antd'
import { usePoll } from '@/hooks/usePoll'
import { useRecordingStore } from '@/stores/modules/recording'
import { useCognitionStore } from '@/stores/modules/cognition'
import { useLiveTranscriptStore } from '@/stores/modules/live-transcript'
import recordingApi from '@/api/modules/recording'
import type { RecordingSceneOption } from '@/api/modules/recording/types'
import { buildUrl } from '@/utils/router'
import { t } from '@/locales'
import { useIsRecordOnly } from '@/stores/modules/enterprise'
import { useLibraryStore } from '@/stores/modules/library'
import agentsApi from '@/api/modules/agents'
import { AGENT_USAGES } from '@/constants/agent'
import {
  useRecordingList,
  type RecordingFileItemUI,
  type RecordingFilter,
} from './hooks/useRecordingList'
import { RecordingFileSidebar } from './components/sidebar/RecordingFileSidebar'
import { useFlutterPanelMutation } from './components/flutter-panel/useFlutterPanelMutation'

// 分类标签项：全部（key='0'）+ 服务端场景字典（GET /api/recordings/scenes）
type SceneTag = { key: string; label: string }

const scenesToTags = (scenes: RecordingSceneOption[]): SceneTag[] => [
  { key: '0', label: '全部' },
  ...scenes.map((s) => ({ key: s.key, label: s.name })),
]

/**
 * RecordingView 通过 <Outlet context> 下发给右栏子路由的能力。
 * 预览页的收藏/重命名/删除必须直接作用于左栏那一份列表状态，
 * 否则两边会各自持有一份数据而不同步。
 */
export type RecordingOutletContext = {
  refresh: () => void
  updateFileName: (id: string, name: string) => void
  updateFileDescription: (id: string, description: string) => void
  findListItem: (id: string) => RecordingFileItemUI | null
  toggleFavorite: (id: string, isFavorite: boolean) => Promise<void> | void
  removeFile: (item: RecordingFileItemUI) => Promise<void> | void
  openRenameModal: (item: RecordingFileItemUI) => void
}

/**
 * 安心录布局：左栏（文件列表等）+ 右栏（Outlet 子路由）。
 *
 * 路由与菜单 1:1：index=经营（默认跳第一个文件预览）；memory=记忆；
 * cognition=认知；relations=关系（占位）；preview/:fileId=经营的内容态。
 * 左栏的具体内容（设备/录音控制/搜索/列表）见 RecordingFileSidebar。
 */
export function RecordingView() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  // 旧 URL /recording?preview=xxx 兼容重定向：
  // 把它转成 /recording/preview/:fileId，由专用路由直接渲染预览（无首页闪烁）。
  // 老链接、邮件分享、收藏夹里残留的 query 都能继续 work，但不会再经历"先看到首页"。
  const legacyPreviewId = searchParams.get('preview')
  if (legacyPreviewId) {
    return <Navigate to={`/recording/preview/${legacyPreviewId}`} replace />
  }
  // 当前预览的文件 id 从 URL 派生（子路由 /recording/preview/:fileId），
  // 不再用组件内 state——列表高亮与右栏内容由同一个 URL 决定，天然一致。
  const previewMatch = useMatch('/recording/preview/:fileId')
  const selectedFileId = previewMatch?.params.fileId ?? null
  // 索引路由（=经营）精确匹配
  const sceneMatch = useMatch('/recording')
  // 安心录模式（erhao.html 入口或企业配置）：仅“经营”（索引 / preview）渲染左栏，
  // 记忆 / 认知 / 关系 子页面隐藏左栏、内容区整页展示；
  // 其余入口保持左栏常驻（主入口内左栏是唯一的子页面导航）。
  const isRecordOnly = useIsRecordOnly()
  const showFileSidebar = !isRecordOnly || !!(sceneMatch || previewMatch)

  const recordingStatus = useRecordingStore((s) => s.status)
  const recordingConfig = useRecordingStore((s) => s.recordingConfig)
  const prevRecordingStatusRef = useRef(recordingStatus)

  // 搜索：keywordInput 即时更新（左栏输入框），keyword 防抖后驱动取数
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [category] = useState<RecordingFilter>('all')

  // 分类标签（服务端场景字典加载；失败/空时仅保留"全部"，列表照常可用）
  const [sceneTags, setSceneTags] = useState<SceneTag[]>(() => scenesToTags([]))
  const [activeSceneTag, setActiveSceneTag] = useState<string>('0')
  const [scenesLoaded, setScenesLoaded] = useState(false)

  // 排序
  const [sortOrder, setSortOrder] = useState<'updated_time' | 'created_time'>('updated_time')

  // rename 弹窗（列表行命令与预览页经 Outlet context 都会打开）
  const [renameModalVisible, setRenameModalVisible] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renamingItem, setRenamingItem] = useState<RecordingFileItemUI | null>(null)

  // 端侧实时转写模型预加载：进安心录即后台拉取（首次 ~280MB，IndexedDB 缓存后秒开），
  // 用户点录音时模型已就绪、字幕立即可用（若录音开始才加载，下载期间的语音不被转写）。
  // 延迟 3s 避免与首屏 API 竞争带宽；失败静默（录音时 attach 会重试）。
  useEffect(() => {
    const timer = setTimeout(() => {
      useLiveTranscriptStore.getState().preload()
    }, 3000)
    return () => clearTimeout(timer)
  }, [])

  // 控制文档助手入口（AssistantBtn）显示：
  // 仅当 后台开关 recording_agent_enabled = true 且 usage=5 至少有一个启用时展示。
  // 开关关闭时直接 false，不发 agents 请求。
  useEffect(() => {
    const recordingAgentEnabled = !!recordingConfig?.recording_agent_enabled
    if (!recordingAgentEnabled) {
      useLibraryStore.getState().setAssistantInstall(false)
      return
    }
    const loadAssistantInstall = async () => {
      try {
        const res = await agentsApi.list({
          agent_usages: String(AGENT_USAGES.KM_RECORDING_CHAT),
        })
        const hasAgentEnabled = res.agents.some((item: any) => item.enable)
        useLibraryStore.getState().setAssistantInstall(hasAgentEnabled)
      } catch {
        // ignore
      }
    }
    loadAssistantInstall()
  }, [recordingConfig?.recording_agent_enabled])

  const {
    fileList,
    loading,
    hasMore,
    loadMore,
    refresh,
    toggleFavorite,
    rename,
    remove,
    updateFileName,
    updateFileDescription,
  } = useRecordingList({
    keyword,
    category,
    sortBy: sortOrder,
    scene: activeSceneTag && activeSceneTag !== '0' ? activeSceneTag : undefined,
    ready: scenesLoaded,
  })

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => setKeyword(keywordInput), 300)
    return () => clearTimeout(timer)
  }, [keywordInput])

  // 加载场景字典：失败静默（仅保留"全部"），不阻塞列表，不额外提示。
  const loadScenes = useCallback(async () => {
    try {
      const scenes = await recordingApi.getRecordingScenes()
      setSceneTags(scenesToTags(scenes))
    } catch {
      // ignore：场景字典是锦上添花，加载失败不影响列表
    } finally {
      setScenesLoaded(true)
    }
  }, [])

  useEffect(() => {
    loadScenes()
  }, [loadScenes])

  // 认知待确认数：轮询必须常驻本布局——erhao.html 入口下左栏隐藏时，
  // 应用侧边栏"认知"红点仍依赖这份 store 数据（接口请求已收敛到 store，单次失败内部吞掉）。
  const cognitionPendingCount = useCognitionStore((s) => s.pendingCount)
  const { start: startCognitionPendingPoll } = usePoll(
    () => useCognitionStore.getState().refresh(),
    10000,
  )
  useEffect(() => {
    startCognitionPendingPoll()
  }, [startCognitionPendingPoll])

  // 录音结束（status 转 idle）刷新列表并提示
  useEffect(() => {
    if (prevRecordingStatusRef.current !== 'idle' && recordingStatus === 'idle') {
      message.success('录音已上传，录音转写与洞察生成需要一些时间...')
      refresh()
    }
    prevRecordingStatusRef.current = recordingStatus
  }, [recordingStatus, refresh])

  // Flutter 面板（右侧 iframe）里的删除同步到本页：列表重拉反映删除结果。
  // 预览页的退回导航由 RecordingPreviewRoute 自己监听同一消息处理，
  // 这里只负责左栏列表。create（添加总结模块）只影响预览页内容，
  // 不动列表。
  useFlutterPanelMutation((mutation) => {
    if (mutation.module === 'recording' && mutation.action === 'delete') {
      refresh()
    }
  })

  // 点列表项：跳转到 /recording/preview/:fileId 专用路由。
  // 列表与预览已分离为两条路由，不再用 inline selectedFile state 在同一页切换。
  const handleSelect = (item: RecordingFileItemUI) => {
    navigate(`/recording/preview/${item.id}`)
  }

  // 列表更多菜单命令。new-tab 打开预览专用路由的直链
  const handleListCommand = async (item: RecordingFileItemUI, cmd: string) => {
    if (cmd === 'new-tab') {
      window.open(buildUrl(`/recording/preview/${item.id}`), '_blank')
    } else if (cmd === 'favorite') {
      await toggleFavorite(item.id, item.isFavorite)
    } else if (cmd === 'rename') {
      setRenamingItem(item)
      setRenameValue(item.name)
      setRenameModalVisible(true)
    } else if (cmd === 'rename') {
      setRenamingItem(item)
      setRenameValue(item.name)
      setRenameModalVisible(true)
    } else if (cmd === 'delete') {
      Modal.confirm({
        title: t('common.tip'),
        content: t('status.file_del'),
        okText: t('action.confirm'),
        cancelText: t('action.cancel'),
        onOk: async () => {
          await remove(item)
          // 删的正是当前预览文件时退回"经营"（自动打开剩余第一个文件），避免右栏残留在已删文件上
          if (item.id === selectedFileId) {
            navigate('/recording', { replace: true })
          }
        },
      })
    }
  }

  // rename 弹窗确认
  const handleRenameConfirm = async () => {
    if (!renamingItem || !renameValue.trim()) return
    const item = renamingItem
    try {
      await rename(item, renameValue.trim())
      setRenameModalVisible(false)
      setRenamingItem(null)
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || ''
      const displayMsg = msg.includes('目标路径已存在') ? '已有相同文件名' : msg || '重命名失败'
      message.error(displayMsg)
    }
  }

  // 传给右栏子路由的上下文：预览页需要反向驱动左栏列表
  // （重命名/收藏/移动/删除都要让列表立刻反映，不能各自持一份状态）。
  const outletContext: RecordingOutletContext = {
    refresh,
    updateFileName,
    updateFileDescription,
    findListItem: (id: string) => fileList.find((it) => it.id === id) ?? null,
    toggleFavorite,
    removeFile: remove,
    openRenameModal: (item) => {
      setRenamingItem(item)
      setRenameValue(item.name)
      setRenameModalVisible(true)
    },
  }

  return (
    <div className="flex h-full">
      {/* 左栏：erhao.html 入口下仅"经营"相关子路由渲染。
          设备/录音控制/搜索/列表等左栏逻辑全部内聚在 RecordingFileSidebar，
          不渲染时相关请求与轮询也随之停止。 */}
      {showFileSidebar && (
        <RecordingFileSidebar
          fileList={fileList}
          loading={loading}
          hasMore={hasMore}
          onLoadMore={loadMore}
          selectedId={selectedFileId}
          onSelect={handleSelect}
          onCommand={handleListCommand}
          keyword={keywordInput}
          onKeywordChange={setKeywordInput}
          categoryTags={sceneTags}
          activeCategoryTag={activeSceneTag}
          onActiveCategoryTagChange={setActiveSceneTag}
          sortOrder={sortOrder}
          onSortOrderChange={setSortOrder}
          cognitionPendingCount={cognitionPendingCount}
          refresh={refresh}
        />
      )}

      {/* 右栏：由子路由决定（index=经营 / memory=记忆 / cognition=认知 / relations=关系 / preview=录音预览）
          安心录右侧 Flutter Web 面板已提升到 layout.tsx，与 main 平级挂最右侧 */}
      <Outlet context={outletContext} />

      {/* Rename Modal */}
      <Modal
        title={t('action.rename')}
        open={renameModalVisible}
        onOk={handleRenameConfirm}
        onCancel={() => {
          setRenameModalVisible(false)
          setRenamingItem(null)
        }}
        okText={t('action.confirm')}
        cancelText={t('action.cancel')}
      >
        <Input
          value={renameValue}
          onChange={(e) => {
            const v = e.target.value
            if (!/[\/\\]/.test(v)) setRenameValue(v)
          }}
          placeholder={t('common.file_name')}
          onPressEnter={handleRenameConfirm}
        />
      </Modal>
    </div>
  )
}

export default RecordingView
