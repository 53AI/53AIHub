/**
 * Agent 创建页面 v2 - front-react 版本
 *
 * 所有平台统一使用三列布局
 * Header 包含编辑入口（点击编辑图标打开弹框）
 * front-react 无分组功能
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Modal, message } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import { t } from '@/locales'
import {
  AdapterProvider,
  useAgentCreateAdapter,
  useAgentFormStore,
  AgentDrawerRef,
  CreatePageLayout,
  AgentBasicInfo
} from '@km/shared-business/agent-create'
import { eventBus } from '@km/shared-utils'
import { frontAgentAdapter } from '@/adapters/agent-create-adapter'
import Header from '@/components/Layout/Header'

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
        className="size-[72px]"
        value={value}
        onChange={onChange}
      />
      <Button
        className="w-[72px] text-xs"
        onClick={() => imageUploadRef.current?.trigger()}
      >
        {t('agent.change_avatar') || '更换头像'}
      </Button>
    </div>
  )
}

/**
 * 页面内容组件（三列布局，所有平台统一）
 */
function AgentCreatePageContent() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const adapter = useAgentCreateAdapter()

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
  const setFormData = useAgentFormStore((state) => state.setFormData)

  const infoDrawerRef = useRef<AgentDrawerRef>(null)
  const channelConfig = useRef<Record<string, any>>({})

  // 获取当前平台配置
  const agentConfig = adapter.getAgentConfig?.(agentType) || {}
  const platformName = agentConfig.name || 'Prompt'

  // 编辑弹窗的 avatarSlot
  const avatarSlot = adapter.ImageUploadComponent
    ? ({ value, onChange }: { value: string; onChange: (logo: string) => void }) => (
        <AvatarSlot value={value} onChange={onChange} />
      )
    : undefined

  // 保存
  const onSave = async () => {
    const store = useAgentFormStore.getState()
    if (store.saving) return

    useAgentFormStore.setState({ saving: true })

    try {
      // 所有平台统一通过 drawer 保存
      await infoDrawerRef.current?.handleSave()
      message.success(t('action.save_success'))

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

  // 初始化
  useEffect(() => {
    const agentIdParam = searchParams.get('agent_id') || searchParams.get('id') || ''
    const agentTypeFromUrl = (searchParams.get('type') as string) || adapter.defaultPlatform
    const isNew = searchParams.get('is_new') === 'true'

    // 确保 adapter 已设置到 store
    const store = useAgentFormStore.getState()
    if (!store.adapter) {
      useAgentFormStore.setState({ adapter })
    }

    // 如果 URL 有 type，立即更新 store
    if (searchParams.get('type')) {
      useAgentFormStore.setState({ agent_type: searchParams.get('type') })
    }

    const init = async () => {
      if (!isNew && agentIdParam) {
        // 编辑模式：加载详情数据
        useAgentFormStore.getState().reset()
        useAgentFormStore.setState({
          is_new: false,
          agent_id: agentIdParam,
          initializing: true,
          adapter, // 确保 adapter 在 reset 后重新设置
        })

        await useAgentFormStore.getState().loadDetailData()

        useAgentFormStore.setState({ initializing: false })
      } else {
        // 创建模式：设置初始状态
        const agentConfig = adapter.getAgentConfig?.(agentTypeFromUrl) || {}
        useAgentFormStore.setState({
          is_new: true,
          agent_id: 0,
          agent_type: agentTypeFromUrl,
          adapter,
          form_data: {
            ...useAgentFormStore.getState().form_data,
            channel_type: agentConfig.channelType || 0,
            custom_config: {
              ...useAgentFormStore.getState().form_data.custom_config,
              agent_type: agentTypeFromUrl,
            },
          },
        })
      }

      // 打开 drawer
      infoDrawerRef.current?.open({
        agent_type: agentTypeFromUrl,
        agent_id: agentIdParam,
        cache: true,
        data: {
          channel_config: {},
        },
      })
    }

    init()

    return () => {
      const store = useAgentFormStore.getState()
      if (!store.saving) {
        store.reset()
      }
    }
  }, [searchParams, adapter])

  // 渲染内容区
  const renderContent = () => {
    // 所有平台统一使用 CreatePageLayout
    return (
      <CreatePageLayout
        drawerRef={infoDrawerRef}
        loading={loading}
        initializing={initializing}
        channelConfig={channelConfig.current}
        cardLayout={false}
        onSuccess={() => eventBus.emit('agent-change')}
      />
    )
  }

  // 头部组件
  const header = (
    <Header
      className="h-[80px] !bg-[#F7F7FA]"
      back
      titleSuffix={
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            {formData.logo && (
              <img
                src={formData.logo}
                className="w-8 rounded"
                alt=""
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            )}
            <span>{formData.name || t('agent_create_title')}</span>
            <EditOutlined
              className="cursor-pointer text-[#999] hover:text-[#666]"
              style={{ fontSize: 14 }}
              onClick={handleEditOpen}
            />
          </div>
          <div className="flex items-center gap-2 text-sm max-w-[200px]">
            <span className="text-xs text-[#999] truncate">
              {formData.description || t('agent.no_desc')}
            </span>
            <span className="px-2 py-0.5 bg-white rounded text-[#666] text-xs">
              {platformName}
            </span>
          </div>
        </div>
      }
      right={
        <div className="flex items-center gap-4">
          <Button type="primary" loading={saving} onClick={onSave}>
            {t('action.save')}
          </Button>
        </div>
      }
    />
  )

  return (
    <>
      <div className="h-full flex flex-col overflow-hidden bg-[#F7F7FA]">
        {header}
        {renderContent()}
      </div>
      {/* 编辑基本信息弹框（无分组） */}
      <Modal
        open={editVisible}
        title={t('agent.edit_info')}
        onCancel={() => setEditVisible(false)}
        onOk={handleEditSave}
        width="50%"
      >
        <AgentBasicInfo
          value={editBasicInfo}
          onChange={setEditBasicInfo}
          avatarSlot={avatarSlot}
          t={t}
        />
      </Modal>
    </>
  )
}

export function AgentCreateV2() {
  return (
    <AdapterProvider adapter={frontAgentAdapter}>
      <AgentCreatePageContent />
    </AdapterProvider>
  )
}

export default AgentCreateV2
