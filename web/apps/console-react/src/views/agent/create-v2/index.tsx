/**
 * Agent 创建页面 v2 - console-react 版本
 *
 * 所有平台统一使用 Tab 三列布局
 * Header 包含编辑入口（点击编辑图标打开弹框）
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Modal, message } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import { t } from '@/locales'
import { PageLayoutContent } from '@/components/PageLayout'
import { getSimpleDateFormatString } from '@km/shared-utils'
import {
  AdapterProvider,
  useAgentCreateAdapter,
  useAgentFormStore,
  AgentDrawerRef,
  CreatePageLayout,
  getInitialFormData,
  AgentBasicInfo, createPlatformsByType,
  isOpenClawCompatibleAgentType
} from '@km/shared-business/agent-create'
import { eventBus } from '@km/shared-utils'
import { GROUP_TYPE } from "@/constants/group"
import { img_host, getPublicPath } from '@/utils/config'
import { consoleAgentAdapter } from '@/adapters/agent-create-adapter'
import { attachDefaultImg } from '@/directive/default-img'
import { AgentDataTab } from './DataTab'
import { AgentIntegrateTab } from './IntegrateTab'
import { AgentFeedbackTab } from './FeedbackTab'
import { subscriptionApi } from "@/api/modules/subscription"
import { groupApi, Group } from "@/api/modules/group"
import { isEqual } from 'lodash-es'
import { SvgIcon } from '@km/shared-components-react'
import { useEnterpriseStore } from '@/stores'

/**
 * 头像上传 slot 组件
 * 需要独立组件以正确使用 useRef
 */
function AvatarSlot({
  value,
  onChange,
}: {
  value: string
  onChange: (logo: string) => void
}) {
  const adapter = useAgentCreateAdapter()
  const ImageUploadComponent = adapter.ImageUploadComponent
  const imageUploadRef = useRef<{ trigger: () => void }>(null)

  if (!ImageUploadComponent) return null

  return (
    <div className="flex flex-col items-center gap-2">
      <ImageUploadComponent
        ref={imageUploadRef}
        className="!size-[72px]"
        value={value}
        onChange={onChange}
      />
      <Button
        className="w-[72px] text-xs"
        onClick={() => imageUploadRef.current?.trigger()}
      >
        {t('change_avatar')}
      </Button>
    </div>
  )
}
// 获取默认的注册用户和内部用户分组 ID
const getDefaultGroupIds = async () => {
  const subscriptionRes = await subscriptionApi.list({ params: { offset: 0, limit: 1000 } });
  const subscriptionGroupIds = subscriptionRes.map((item: SubscriptionItem) => item.group_id);

  const internalGroupRes = await groupApi.list({ params: { group_type: GROUP_TYPE.INTERNAL_USER } });
  const internalGroupIds = internalGroupRes.map((item: Group) => item.group_id);

  return { subscriptionGroupIds, internalGroupIds };
}

/**
 * 页面内容组件（Tab 三列布局，所有平台统一）
 */
function AgentCreatePageContent() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const adapter = useAgentCreateAdapter()

  // Tab 状态
  const [activeTab, setActiveTab] = useState(() => {
    return searchParams.get('tab') || 'config'
  })

  // 编辑弹框状态
  const [editVisible, setEditVisible] = useState(false)
  const [editBasicInfo, setEditBasicInfo] = useState({ name: '', description: '', logo: '' })

  // 从 store 读取状态
  const saving = useAgentFormStore((state) => state.saving)
  const loading = useAgentFormStore((state) => state.loading)
  const initializing = useAgentFormStore((state) => state.initializing)
  const formData = useAgentFormStore((state) => state.form_data)
  const agentType = useAgentFormStore((state) => state.agent_type)
  const agentId = useAgentFormStore((state) => state.agent_id)
  const agentData = useAgentFormStore((state) => state.agent_data)
  const groupOptions = useAgentFormStore((state) => state.group_options)
  const setFormData = useAgentFormStore((state) => state.setFormData)
  const setAgentData = useAgentFormStore((state) => state.setAgentData)
  const initialFormData = useAgentFormStore((state) => state.initial_form_data)

  const infoDrawerRef = useRef<AgentDrawerRef>(null)
  const channelConfig = useRef<Record<string, any>>({})

  // 从 URL 获取类型参数（用于初始渲染时计算类型）
  const urlTypeParam = searchParams.get('type')

  // 获取当前平台配置

  // 获取类型名称（backend_agent_type: 0=对话, 1=补全, 2=助手）
  const getTypeName = (backendAgentType?: number) => {
    if (backendAgentType === 0) return t('agent_type_chat_v2')
    if (backendAgentType === 1) return t('agent_type_completion_v2')
    if (backendAgentType === 2) return t('agent_type.assistant')
    return '--'
  }

  // 根据 agent_type 推断 backend_agent_type
  const getBackendAgentType = (agentTypeValue: string): number | undefined => {
    // 如果 agentType 为空或无效，返回 undefined
    if (!agentTypeValue) return undefined
    const config = adapter.getAgentConfig?.(agentTypeValue)
    const mode = config?.mode
    if (mode === 'completion') return 1 // 应用型/工作流
    if (mode === 'assistant') return 2 // 助理型
    if (mode === 'chat') return 0 // 对话型
    return undefined
  }

  // 优先使用 agentData 中的 backend_agent_type，其次用 URL 参数推断，最后用 store 中的 agentType
  // 注意：创建模式下 agentData 为空，需要使用 URL 参数 (urlTypeParam) 而非 store 中的 agentType
  // 因为 store 更新可能有延迟，第一次渲染时 agentType 可能是旧值
  const backendAgentType = agentData?.backend_agent_type ?? getBackendAgentType(urlTypeParam || agentType)
  const typeName = getTypeName(backendAgentType)

  // 格式化最近保存时间
  const lastSavedAt = agentId && agentData?.updated_time
    ? getSimpleDateFormatString({ date: agentData.updated_time, format: 'YYYY-MM-DD hh:mm:ss' })
    : ''

  // 编辑弹窗的 avatarSlot
  const avatarSlot = adapter.ImageUploadComponent
    ? ({ value, onChange }: { value: string; onChange: (logo: string) => void }) => (
        <AvatarSlot value={value} onChange={onChange} />
      )
    : undefined

  // 检查是否有未保存的修改
  const hasUnsavedChanges = useCallback(() => {
    if (!initialFormData) return false
    return !isEqual(initialFormData, formData)
  }, [initialFormData, formData])

  // 保存
  const onSave = async () => {
    const store = useAgentFormStore.getState()
    if (store.saving) return

    useAgentFormStore.setState({ saving: true })

    try {
      // 所有平台统一通过 drawer 保存
      await infoDrawerRef.current?.handleSave()
      message.success(t('action_save_success'))
      setAgentData({
        ...useAgentFormStore.getState().agent_data,
        updated_time: Date.now(),
      })

      // 保存成功后更新初始数据，重置 dirty 状态
      const currentFormData = useAgentFormStore.getState().form_data
      useAgentFormStore.getState().setInitialFormData(currentFormData)

      const currentState = useAgentFormStore.getState()
      if (currentState.is_new) {
        eventBus.emit('agent-create')
        if (currentState.agent_id) {
          navigate(
            {
              pathname: '/agent/create-v2',
              search: `?type=${currentState.agent_type}&agent_id=${currentState.agent_id}`,
            },
            { replace: true },
          )
        }
      } else {
        eventBus.emit('agent-update')
      }
    } finally {
      useAgentFormStore.setState({ saving: false })
    }
  }

  // Tab 切换
  const handleTabChange = (key: string) => {
    setActiveTab(key)
  }

  // 打开编辑弹框
  const handleEditOpen = useCallback(() => {
    setEditBasicInfo({
      name: formData.name || '',
      description: formData.description || '',
      logo: formData.logo || '',
    })
    setEditVisible(true)
  }, [formData.name, formData.description, formData.logo])

  // 保存编辑
  const handleEditSave = useCallback(() => {
      setFormData({
        name: editBasicInfo.name,
        description: editBasicInfo.description,
        logo: editBasicInfo.logo,
      })
    setEditVisible(false)
  }, [setFormData, editBasicInfo])

  // 分组变更
  const handleGroupChange = (value: number) => {
    setFormData({ group_id: value })
  }

  // 初始化
  const agentIdParam = searchParams.get('agent_id')
  const typeParam = searchParams.get('type')
  const isNewParam = searchParams.get('is_new')

  useEffect(() => {
    const agentId = agentIdParam || ''
    const agentTypeFromUrl = (typeParam as string) || adapter.defaultPlatform

    const init = async () => {
      // 编辑和创建模式都先重置状态，避免缓存污染
      useAgentFormStore.getState().reset()

      if (agentId) {
        // 编辑模式：加载数据
        useAgentFormStore.setState({
          is_new: isNewParam === 'true',
          agent_id: agentId,
          agent_type: agentTypeFromUrl,
          initializing: true,
        })

        // 加载详情数据
        await useAgentFormStore.getState().loadDetailData()

        // 获取加载后的 agent_type
        const loadedAgentType = useAgentFormStore.getState().agent_type

        // 设置平台配置
        if (loadedAgentType !== 'prompt') {
          const config = adapter.getAgentConfig?.(loadedAgentType) || {}
          channelConfig.current.name = config.channelName || ''
          channelConfig.current.channel_type = config.channelType || 0
        }

        useAgentFormStore.setState({ initializing: false })

        // 保存初始表单数据用于修改追踪
        const currentFormData = useAgentFormStore.getState().form_data
        useAgentFormStore.getState().setInitialFormData(currentFormData)

        // 打开 drawer（cache 模式，不重置已加载的数据）
        infoDrawerRef.current?.open({
          agent_type: loadedAgentType,
          agent_id: agentId,
          cache: true,
          data: {
            channel_config: channelConfig.current,
          },
        })

        // 加载分组选项
        await useAgentFormStore.getState().loadGroupOptions()
        
        // 所有异步操作完成后，设置初始数据
        const finalFormData = useAgentFormStore.getState().form_data
        useAgentFormStore.getState().setInitialFormData(finalFormData)
      } else {
        // 创建模式：从 URL 参数获取弹框数据，统一初始化
        const nameParam = searchParams.get('name')
        const descParam = searchParams.get('description')
        const logoParam = searchParams.get('logo')
        const groupIdParam = searchParams.get('group_id')
        const agentModeParam = searchParams.get('agent_mode')
        const backendAgentTypeParam = searchParams.get('backend_agent_type')

        const { subscriptionGroupIds, internalGroupIds } = await getDefaultGroupIds();
        const agentInfo = createPlatformsByType(img_host, getPublicPath).find((item) => item.value === agentTypeFromUrl) || { label: '', icon: '' }

        // 加载分组选项
        await useAgentFormStore.getState().loadGroupOptions()

        // 获取分组列表，如果 group_id 为 0 则选择第一个分组
        const groupOptions = useAgentFormStore.getState().group_options
        let groupId = groupIdParam ? Number(groupIdParam) : 0
        if (!groupId && groupOptions.length > 0) {
          groupId = groupOptions[0].value
        }

        // 获取企业信息，判断是否需要设置 scopes 默认值
        const enterprise = useEnterpriseStore.getState().info
        const shouldSetDefaultScopes = enterprise.is_enterprise || enterprise.is_industry

        const initialFormData = {
          ...getInitialFormData(),
          name: nameParam || agentInfo.label || 'agent',
          logo: logoParam || agentInfo.icon || '',
          description: descParam || '',
          group_id: groupId,
          subscription_group_ids: subscriptionGroupIds,
          // 新建时默认选中"全部成员"；编辑模式按接口返回值显示
          scopes: shouldSetDefaultScopes ? [{ scope_type: 'company', target_id: 0 }] : [],
          custom_config: {
            ...getInitialFormData().custom_config,
            agent_mode: agentModeParam || 'chat',
            agent_type: agentTypeFromUrl,
          },
        }

        useAgentFormStore.setState({
          is_new: true,
          agent_id: 0,
          agent_type: agentTypeFromUrl,
          form_data: initialFormData,
        })

        // 设置 backend_agent_type
        if (backendAgentTypeParam) {
          useAgentFormStore.getState().setAgentData({
            ...useAgentFormStore.getState().agent_data,
            backend_agent_type: Number(backendAgentTypeParam),
          })
        }

        // 保存初始表单数据用于修改追踪
        useAgentFormStore.getState().setInitialFormData(initialFormData)

        // 打开 drawer（cache 模式）
        infoDrawerRef.current?.open({
          agent_type: agentTypeFromUrl,
          agent_id: 0,
          cache: true,
          data: {
            channel_config: {},
          },
        })
      }
    }

    init()

    return () => {
      // 组件卸载时不重置，避免页面内跳转时丢失数据
    }
  }, [agentIdParam, typeParam, isNewParam, adapter])

  // 处理浏览器关闭/刷新时的提醒
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) {
        const msg = t('skills.unsaved_confirm_message')
        event.preventDefault()
        event.returnValue = msg
        return msg
      }
      return undefined
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  // 处理返回操作
  const handleBack = useCallback(() => {
    const doNavigate = () => {
      // 判断是否有上一页
      const state = window.history.state || {}
      const hasHistory = state.idx !== undefined ? state.idx > 0 : false
      navigate(hasHistory ? -1 : '/agent')
    }

    if (hasUnsavedChanges()) {
      Modal.confirm({
        content: t('skills.unsaved_confirm_message'),
        okText: t('action.confirm'),
        cancelText: t('action.cancel'),
        onOk: doNavigate,
      })
    } else {
      doNavigate()
    }
  }, [hasUnsavedChanges, navigate])

  // 渲染内容区
  const renderContent = () => {
    switch (activeTab) {
      case 'config':
        // 所有平台统一使用 CreatePageLayout
        return (
          <CreatePageLayout
            drawerRef={infoDrawerRef}
            loading={loading}
            initializing={initializing}
            channelConfig={channelConfig.current}
            onSuccess={() => eventBus.emit('agent-change')}
            embedded
          />
        )
      case 'data':
        return <AgentDataTab agentId={agentId} agentType={agentType} />
      case 'feedback':
        return <AgentFeedbackTab agentId={agentId} agentType={agentType} backendAgentType={backendAgentType} />
      case 'integrate':
        return <AgentIntegrateTab agentId={agentId} />
      default:
        return null
    }
  }

  // Tab 配置 - 根据 backend_agent_type 动态生成（0=对话, 1=工作流/补全, 2=助理）
  // openclaw 家族：反馈由 OpenClawEmbeddedChatWorkspace 承载，隐藏反馈 Tab
  const tabItems = useMemo(() => {
    const baseTabs = [{ key: 'config', label: t('agent.tab_config') }]

    // 助理型（2）：小助理、AI搜问等 → 仅反馈 Tab
    if (backendAgentType === 2) {
      baseTabs.push(
        { key: 'data', label: t('agent.tab_data') },
        { key: 'feedback', label: t('agent.tab_feedback') },
      )
    } else if (backendAgentType === 0 || backendAgentType === 1) {
      // 对话型（0）和工作流（1）→ 接入 Tab 与反馈 Tab 并存
      baseTabs.push(
        { key: 'data', label: t('agent.tab_data') },
        { key: 'feedback', label: t('agent.tab_feedback') },
        { key: 'integrate', label: t('agent.tab_integrate') },
      )
    } else {
      // 其他类型：仅接入 Tab
      baseTabs.push(
        { key: 'data', label: t('agent.tab_data') },
        { key: 'integrate', label: t('agent.tab_integrate') },
      )
    }

    if (isOpenClawCompatibleAgentType(agentType)) {
      return baseTabs.filter((tab) => tab.key !== 'feedback')
    }
    return baseTabs
  }, [backendAgentType, agentType, t])

  // 当 tabItems 变化（如 agentType 改变导致反馈 Tab 被隐藏）时，校正 activeTab 到合法 tab
  // 防止 ?tab=feedback 直接进入 openclaw 智能体导致空白页
  useEffect(() => {
    if (agentId && tabItems.length > 0 && !tabItems.some((tab) => tab.key === activeTab)) {
      setActiveTab(tabItems[0].key)
    }
  }, [tabItems, agentId, activeTab])

  return (
    <PageLayoutContent
      className="h-full w-full !px-0 !py-0 bg-[#F7F9FC]"
      header={{
        title: (
          <div className="flex items-center gap-2">
            <span>{formData.name || t('agent_create_title')}</span>

            <span className="px-2 h-6 flex items-center gap-1 bg-[#F4F4F7] rounded text-tertiary text-xs">
              <SvgIcon size={14} name={backendAgentType === 1 ? 'app-one' : backendAgentType === 2 ? 'agent' : 'chat_v2'}></SvgIcon>
              {t(`agent_app.${agentType}`) || '--'}
            </span>
            <EditOutlined
              className="cursor-pointer text-placeholder hover:text-tertiary"
              style={{ fontSize: 14 }}
              onClick={handleEditOpen}
            />
          </div>
        ),
        back: true,
        onBack: handleBack,
        titlePrefix: formData.logo ? (
          <img
            src={formData.logo}
            className="w-8 rounded"
            alt=""
            onError={(e) => {
              attachDefaultImg(e.currentTarget)
            }}
          />
        ) : (
          <div className="size-8 rounded" />
        ),
        description: (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 truncate max-w-[200px]">
              {formData.description || t('agent.no_desc')}
            </span>
            
          </div>
        ),
        center: (
          <div className="flex gap-1">
            { !!(agentId) && tabItems.map((item) => (
              <div
                key={item.key}
                className={`h-8 px-5 flex items-center cursor-pointer rounded-md ${
                  activeTab === item.key ? 'bg-white text-brand shadow' : 'text-[#2029459E] hover:bg-white hover:text-brand'
                }`}
                onClick={() => handleTabChange(item.key)}
              >
                {item.label}
              </div>
            ))}
          </div>
        ),
        right: (
          <div className="flex items-center gap-3">
            {lastSavedAt && (
              <span className="text-xs text-placeholder">
                {t('agent.last_saved')}：{lastSavedAt}
              </span>
            )}
            <Button type="primary" loading={saving} onClick={onSave}>
              {t('action_publish')}
            </Button>
          </div>
        ),
      }}
      headerClassName="h-16 px-4 border-b border-[#E9EEF7]"
      contentClassName="flex-1 flex overflow-hidden !bg-[#F7F7FA]"
      scrollable={false}
    >
      {renderContent()}
      {/* 编辑基本信息弹框 */}
      <Modal
        open={editVisible}
        title={t('dialog.basic_info')}
        onCancel={() => setEditVisible(false)}
        onOk={handleEditSave}
        width="50%"
      >
        <AgentBasicInfo
          value={editBasicInfo}
          onChange={setEditBasicInfo}
          avatarSlot={avatarSlot}
          groupValue={formData.group_id}
          onGroupChange={handleGroupChange}
          groupOptions={groupOptions}
          t={t}
        />
      </Modal>
    </PageLayoutContent>
  )
}

export function AgentCreatePageV2() {
  return (
    <AdapterProvider adapter={consoleAgentAdapter}>
      <AgentCreatePageContent />
    </AdapterProvider>
  )
}

export default AgentCreatePageV2
