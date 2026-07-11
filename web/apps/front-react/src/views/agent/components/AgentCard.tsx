import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Empty, Modal, message, Button } from 'antd'
import { Dropdown } from '@km/shared-components-react'
import { EditOutlined, DeleteOutlined, MoreOutlined } from '@ant-design/icons'
import { SvgIcon } from '@km/shared-components-react'
import { useIsSoftStyle } from "@/stores/modules/enterprise"
import { useAgentStore } from "@/stores/modules/agent"
import { getPublicPath } from '@/utils/config'
import { t } from '@/locales'
import { checkPermission } from '@/utils/permission'
import agentsApi from '@/api/modules/agents'
import { createPlatformsByType, isOpenClawCompatibleChannelType } from '@km/shared-business/agent-create'

const DEFAULT_IMG = '/images/default_agent.png'

interface AgentCardProps {
  item: Agent.State
  keyword?: string
  type?: 'explore' | 'my'
  groupId?: number              // 当前分组ID（探索模式）
  onRefresh?: () => void
  showTypeTag?: boolean
  fixedType?: string // 固定类型显示（如 'Openclaw'）
  selectMode?: boolean  // 选择模式：区分已添加/待添加
  flatMode?: boolean    // 扁平渲染模式
  canView?: boolean
  /** 选中并触发跳转/操作时回调（用于关闭外层 Modal 等） */
  onSelect?: () => void
}

export function AgentCard({
  item,
  keyword = '',
  type = 'explore',
  groupId,
  onRefresh,
  showTypeTag = true,
  fixedType,
  selectMode = false,
  flatMode = false,
  canView = true,
  onSelect,
}: AgentCardProps) {
  const navigate = useNavigate()
  const isSoftStyle = useIsSoftStyle()
  const agentStore = useAgentStore()
  const [adding, setAdding] = useState(false)

  const platforms = createPlatformsByType('')

  // 快捷方式相关状态
  const isAdded = agentStore.isShortcutAdded(item.agent_id)

  // 加载已添加的快捷方式 ID 列表（软件模式或选择模式）
  useEffect(() => {
    if (isSoftStyle || selectMode) {
      agentStore.loadShortcutIds()
    }
  }, [isSoftStyle, selectMode, agentStore.loadShortcutIds])

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.target as HTMLImageElement
    const fallback = getPublicPath(DEFAULT_IMG)
    if (target.src.endsWith(fallback)) return
    target.src = fallback
  }

  const highlightKeyword = (text: string, kw: string) => {
    if (!kw.trim()) return text
    const regex = new RegExp(`(${kw})`, 'gi')
    return text.replace(regex, "<span class='text-theme'>$1</span>")
  }

  // 判断是否为 Openclaw 智能体
  const isOpenclawAgent = () => {
    return isOpenClawCompatibleChannelType(item.channel_type)
  }

  // 获取跳转参数
  const getNavigateSearch = () => {
    if (isOpenclawAgent()) {
      return `?agent_id=${item.agent_id}&hide_bottom_actions=true&type=openclaw&from=${type}`
    }
    return `?agent_id=${item.agent_id}&from=${type}`
  }

  const handleCardClick = () => {
    // 选择模式下不跳转
    if (selectMode || !canView) return

    // 构建查询参数
    const params = new URLSearchParams()
    if (type === 'my') {
      params.set('type', 'my')
    }
    if (groupId && groupId > 0) {
      params.set('group_id', String(groupId))
    }

    // 软件模式：跳转详情页
    if (isSoftStyle) {
      const searchStr = params.toString()
      onSelect?.()
      navigate(`/agent/${item.agent_id}${searchStr ? '?' + searchStr : ''}`)
      return
    }
    // 网站模式：直接跳转对话
    onSelect?.()
    navigate({ pathname: '/chat', search: getNavigateSearch() })
  }

  const handleCommand = async (command: string) => {
    if (command === 'edit') {
      navigate({ pathname: '/agent/create-v2', search: `?type=openclaw&id=${item.agent_id}` })
    } else if (command === 'delete') {
      Modal.confirm({
        title: t('agent.tip'),
        content: t('agent.confirm_delete_agent'),
        okText: t('action.ok'),
        cancelText: t('action.cancel'),
        onOk: async () => {
          try {
            await agentsApi.my.delete(item.agent_id)
            message.success(t('agent.delete_success'))
            onRefresh?.()
          } catch (error) {
            // Delete failed or cancelled
          }
        }
      })
    }
  }

// 添加快捷方式
  const handleAddShortcut = async (e: React.MouseEvent) => {
    e.stopPropagation()
    checkPermission({
      onClick: async () => {
        try {
          setAdding(true)
          await agentStore.addShortcut(item.agent_id)
          message.success(t('action.add_success'))
        } catch (error) {
          message.error(t('action.operation_failed'))
        } finally {
          setAdding(false)
        }
      }
    })
  }

  // 使用按钮跳转（网页版）
  const handleUseAgent = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect?.()
    navigate({ pathname: '/chat', search: getNavigateSearch() })
  }

  // 软件模式下跳转到工作台智能体页
  const handleUseAgentSoft = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect?.()
    navigate(`/agent/agent?agent_id=${item.agent_id}`)
  }

  // 获取类型图标和名称
  const getTypeInfo = useMemo(() => {
    const agentMode = item.custom_config_obj?.agent_mode
    const agentType = item.custom_config_obj?.agent_type
    const platform = platforms.find(item => item.value === agentType)

    return {
      icon: agentMode === 'chat' ? 'chat_v2' : agentMode === 'assistant' ? 'agent' : 'app-one',
      label: platform ? platform.label : agentType
    }
  }, [item.custom_config_obj, fixedType])

  // 获取分组名称
  const groupName = useMemo(() => {
    const group = agentStore.categorys.find(c => c.group_id === item.group_id)
    return group?.group_name || ''
  }, [item.group_id, agentStore.categorys])

  // 扁平模式渲染
  if (flatMode) {
    return (
      <div
        className="flex items-center p-3 rounded-lg border bg-white hover:shadow-sm transition-all duration-300 cursor-pointer"
        onClick={handleCardClick}
      >
        <img
          className="size-12 rounded-lg mr-3 flex-none object-cover"
          src={item.logo}
          alt={item.name}
          onError={handleImageError}
        />
        <div className="flex-1 min-w-0">
          <h3
            className="font-medium text-sm line-clamp-1 text-primary"
            title={item.name}
            dangerouslySetInnerHTML={{
              __html: type === 'explore' ? highlightKeyword(item.name, keyword) : item.name
            }}
          />
          <p
            className="text-xs text-placeholder line-clamp-1 mt-1"
            title={item.description}
            dangerouslySetInnerHTML={{
              __html: type === 'explore' ? highlightKeyword(item.description || '', keyword) : item.description || ''
            }}
          />
        </div>
        {/* 选择模式下显示添加按钮 */}
        {selectMode && (
          <Button
            type="primary"
            disabled={isAdded}
            loading={adding}
            onClick={handleAddShortcut}
            className="ml-3"
          >
            {isAdded ? t('action.added') : t('action.add')}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div
      className="h-[186px] relative flex flex-col justify-between p-5 rounded-lg overflow-hidden bg-cover cursor-pointer group border border-[#E6E6E6] hover:shadow-md transition-all duration-300 bg-white"
      onClick={handleCardClick}
    >
      <div className="flex items-start flex-1">
        <img
          className="flex-none size-12 mr-3 rounded-lg object-cover"
          src={item.logo}
          alt={item.name}
          onError={handleImageError}
        />
        <div className="flex-1 overflow-hidden">
          <div className="flex items-center">
            <div className="flex-1 flex items-center gap-2">
              <h3
                className="text-base font-medium line-clamp-1 text-primary"
                title={item.name}
                dangerouslySetInnerHTML={{
                  __html: type === 'explore' ? highlightKeyword(item.name, keyword) : item.name
                }}
              />
              {showTypeTag && (
                <div className="bg-[#F4F4F7] flex h-[22px] items-center px-2 gap-1 rounded-md whitespace-nowrap text-[#6B7280]">
                  <SvgIcon name={getTypeInfo.icon} />
                  <p className="text-xs">{getTypeInfo.label}</p>
                </div>
              )}
            </div>

            { type === 'my' && (<Dropdown
              trigger={['click']}
              menu={{
                items: [
                  {
                    key: 'edit',
                    icon: <EditOutlined style={{ fontSize: 16 }} />,
                    label: t('action.edit')
                  },
                  {
                    key: 'delete',
                    danger: true,
                    icon: <DeleteOutlined style={{ fontSize: 16 }} />,
                    label: t('action.delete')
                  }
                ],
                onClick: ({ key }) => handleCommand(key)
              }}
            >
              <div
                className="size-8 flex items-center justify-center cursor-pointer hover:bg-[#F5F5F7] rounded-md border invisible group-hover:visible"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreOutlined style={{ fontSize: 14, transform: 'rotate(90deg)' }} />
              </div>
            </Dropdown>) }
          </div>
          {groupName && (
            <span className="h-5 inline-flex items-center px-2 text-xs text-theme bg-[#EBF1FF] rounded-sm">
              {groupName}
            </span>
          )}
        </div>
      </div>
      <p
        className="flex-1 text-sm text-placeholder line-clamp-2 leading-relaxed my-2"
        title={item.description}
        dangerouslySetInnerHTML={{
          __html: type === 'explore' ? highlightKeyword(item.description || '', keyword) : item.description || ''
        }}
      />
      <div className="flex-1 flex items-center justify-between">
        {/* 左侧：使用次数（仅 explore 类型） */}
        {selectMode || type === 'my' ? (
          <div></div>
        ) : (
          <div className="flex items-center text-sm text-placeholder">
            <SvgIcon className="size-[16px]" name="view" />
            <span className="ml-1">
              {t('index.use_history', { count: item.conversation_count || 0 })}
            </span>
          </div>
        )}

        {/* 右侧：按钮 */}
        {selectMode ? (
          <Button
            type="primary"
            disabled={isAdded}
            loading={adding}
            onClick={handleAddShortcut}
          >
            {isAdded ? t('action.added') : t('action.add')}
          </Button>
        ) : isSoftStyle ? (
          isAdded ? (
            <Button onClick={handleUseAgentSoft}>{t('action.use')}</Button>
          ) : (
            <Button loading={adding} onClick={handleAddShortcut}>
              {t('action.add')}
            </Button>
          )
        ) : (
          <Button onClick={handleUseAgent}>{t('action.use')}</Button>
        )}
      </div>
    </div>
  )
}

// 加载骨架屏组件 - 卡片模式
export function AgentCardSkeleton({ flatMode = false }: { flatMode?: boolean }) {
  // 扁平模式骨架屏
  if (flatMode) {
    return (
      <div className="flex items-center p-3 rounded-lg border bg-white animate-pulse">
        <div className="size-12 rounded-lg mr-3 flex-none bg-gray-200"></div>
        <div className="flex-1 min-w-0">
          <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
          <div className="h-3 bg-gray-200 rounded w-2/3"></div>
        </div>
      </div>
    )
  }

  // 卡片模式骨架屏
  return (
    <div className="relative flex flex-col justify-between p-5 rounded-lg overflow-hidden bg-cover cursor-pointer border border-[#E6E6E6] bg-white animate-pulse">
      <div className="flex items-start flex-1">
        <div className="w-[48px] h-[48px] bg-gray-200 rounded-lg mr-3 flex-none shrink-0"></div>
        <div className="flex-1 overflow-hidden">
          <div className="h-5 bg-gray-200 rounded w-1/2 mb-2"></div>
          <div className="h-[22px] bg-gray-200 rounded w-20"></div>
        </div>
      </div>
      <div className="mt-3">
        <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="h-4 bg-gray-200 rounded w-20"></div>
        <div className="h-8 bg-gray-200 rounded w-12"></div>
      </div>
    </div>
  )
}

// 空状态组件
export function AgentEmpty({ className = '' }) {
  return (
    <div className={className}>
      <div className="col-span-full flex flex-col items-center justify-center">
        <Empty
          description={t('agent.no_data')}
          image={getPublicPath('/images/chat/completion_empty.png')}
        />
      </div>
    </div>
  )
}

export default AgentCard
