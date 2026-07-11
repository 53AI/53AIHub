import { ReactNode, useRef } from 'react'
import { Spin, InputNumber } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { AgentDrawer, AgentDrawerRef } from './Drawer'
import { AgentGuide } from '../config/Guide'
import { UseScope } from '../shared/UseScope'
import ChannelConfigContext from '../../hooks/useChannelConfig'
import { useAgentCreateAdapter } from '../../adapters'
import { useAgentFormStore } from '../../store'
import { AGENT_MODES, isOpenClawCompatibleAgentType } from '../../constants'
import { Chat, ChatRef } from '../preview/Chat'
import { Completion, CompletionRef } from '../preview/Completion'
import { UsageChannel } from '../config/UsageChannel'

/** 页面头部配置 */
export interface PageHeaderConfig {
  /** 标题 */
  title: string
  /** 返回按钮 */
  back?: boolean
  /** 返回按钮点击回调 */
  onBack?: () => void
  /** 标题前缀 */
  titlePrefix?: ReactNode
  /** 标题后缀 */
  titleSuffix?: ReactNode
  /** 右侧操作区 */
  right?: ReactNode
}

export interface CreatePageLayoutProps {
  /** 头部配置或组件 */
  header: PageHeaderConfig | ReactNode
  /** 底部组件 */
  footer?: ReactNode
  /** Drawer ref */
  drawerRef: React.RefObject<AgentDrawerRef>
  /** 加载状态 */
  loading?: boolean
  /** 初始化状态 */
  initializing?: boolean
  /** 频道配置 */
  channelConfig?: Record<string, any>
  /** 成功回调 */
  onSuccess?: () => void
  /** 是否使用卡片布局（console-react 风格），默认 true */
  cardLayout?: boolean
  /** 是否嵌入式模式（只渲染内容区域），默认 false */
  embedded?: boolean
}

/**
 * Agent 创建页面布局组件
 *
 * 三列布局：
 * - 第一列：平台配置 + 使用范围（注册用户/内部用户）
 * - 第二列：应用配置区域 + 使用说明
 * - 第三列：调试预览（始终可见）
 * - footer 在卡片底部
 */
export function CreatePageLayout({
  footer,
  drawerRef,
  loading = false,
  initializing = false,
  channelConfig = {},
  onSuccess,
  cardLayout = true,
  embedded = false,
}: CreatePageLayoutProps) {
  const adapter = useAgentCreateAdapter()
  const t = adapter.t || ((key: string) => key)

  // 从 store 获取当前 agent_type
  const agentType = useAgentFormStore((state) => state.agent_type)
  const sort = useAgentFormStore((state) => state.form_data.sort)
  const updateField = useAgentFormStore((state) => state.updateField)

  // 从适配器获取平台配置中的 mode，用于选择预览组件
  const agentMode = adapter.getAgentConfig?.(agentType)?.mode || 'chat'

  // 判断是否显示使用范围（只有 console-react 有 GroupSelectComponent）
  const showUseScope = !!adapter.GroupSelectComponent

  // 判断是否是 Openclaw 类型（Openclaw 不显示重新开始按钮）
  const isOpenclaw = isOpenClawCompatibleAgentType(agentType)

  // 预览组件 ref，用于调用 restart 方法
  const chatRef = useRef<ChatRef>(null)
  const completionRef = useRef<CompletionRef>(null)

  // 重新开始
  const handleRestart = () => {
    if (agentMode === AGENT_MODES.COMPLETION) {
      completionRef.current?.restart()
    } else {
      chatRef.current?.restart()
    }
  }

  // 渲染三列内容区域
  const renderContent = () => (
    <div className="flex-1 flex min-h-0">
      <div className="w-2/3 flex flex-col">
        <div className='h-14 flex items-center px-6 font-base text-primary border-b border-[#E9EEF7]'>{t('agent.config_title')}</div>
        <div className="flex-1 min-h-0 flex">
          {/* 第一列：平台配置 + 使用范围 */}
          <div className={`flex-1 px-5 py-4 border-r overflow-y-auto`}>
            {/* <div className="h-6 flex items-center font-sm font-medium mb-3">{t('app.connected_platform')}</div> */}
            {
              agentType === 'prompt' ? (
                <AgentDrawer
                  className="flex-1 min-h-0"
                  ref={drawerRef}
                  onSuccess={onSuccess}
                />
              ) : (
                <AgentDrawer
                  className={ isOpenclaw ? '-mx-5 -my-3' : '' }
                  ref={drawerRef}
                  onSuccess={onSuccess}
                />
              )
            }
            {/* 排序字段 */}
            {showUseScope && (
              <>
                <div className="mt-5 border-b "></div>
                <div className="h-11 flex items-center gap-2">
                  <div className="text-sm text-[#373A3D]">{t('agent.frontend_sort')}</div>
                  <span className="text-xs text-disabled">
                    {t('module.agent_sort_desc')}
                  </span>
                </div>
                <InputNumber
                  className="w-full"
                  controls={false}
                  precision={0}
                  min={0}
                  max={99999999}
                  value={sort}
                  onChange={(value) => updateField('sort', value ?? 0)}
                  placeholder={t('form.input_placeholder')}
                />
                  
              </>
            )}
            {showUseScope && (
              <>
              <div className="my-5 -mx-5 border-b "></div>
                <div className="font-bold mb-3">{t('user.use_scope')}</div>
                <UseScope />
              </>
            )}
          </div>

          {/* 第二列：应用配置区域 + 使用说明 */}
          <div className="flex-1 px-5 py-2 overflow-y-auto">
            {initializing ? (
              <div className="flex items-center justify-center h-64">
                <Spin />
              </div> 
            ) : adapter.AgentFormComponent ? (
              <adapter.AgentFormComponent
                agentType={agentType || adapter.defaultPlatform}
                showChannelConfig={false}
              />
            ) : (
              <div className="p-5 text-sm text-gray-500">
                {t('agent.platform_config_loaded')}
              </div>
            )}
            <AgentGuide />
            {agentType === 'openclaw' && <UsageChannel></UsageChannel> }
          </div>
        </div>
      </div>

      {/* 第三列：调试预览 */}
      <div className="w-1/3 border-l bg-white flex flex-col">
        {isOpenclaw && adapter.OpenClawPreviewComponent ? (
          <adapter.OpenClawPreviewComponent className="flex-1 min-h-0" />
        ) : (
          <>
            <div className='flex-none h-14 flex items-center justify-between px-6 font-base text-primary'>
              <span>{t('app.debug_preview')}</span>
              <Button type='link' className='px-0' onClick={handleRestart}>
                <ReloadOutlined />
                {t('common.restart')}
              </Button>
            </div>
            {agentMode === AGENT_MODES.COMPLETION ? (
              <Completion ref={completionRef} className="flex-1 min-h-0" />
            ) : (
              <Chat ref={chatRef} className="flex-1 min-h-0" hideTitle />
            )}
          </>
        )}
      </div>
    </div>
  )

  // 嵌入式模式：只渲染内容区域
  if (embedded) {
    return (
      <ChannelConfigContext.Provider value={channelConfig}>
        <Spin
          spinning={loading}
          classNames={{
            root: 'h-full flex flex-col',
            container: 'h-full flex flex-col',
          }}
        >
          {renderContent()}
        </Spin>
      </ChannelConfigContext.Provider>
    )
  }

  // 卡片布局（console-react 风格）
  if (cardLayout) {
    return (
      <ChannelConfigContext.Provider value={channelConfig}>
        <div className="px-[60px] py-8 h-full flex flex-col bg-[#F7F7FA]">
          {/* 主内容区域 - 白色圆角卡片 */}
          <Spin
            spinning={loading}
            classNames={{
              root: 'flex-1 min-h-0 flex flex-col bg-white rounded-lg',
              container: 'flex-1 min-h-0 flex flex-col',
            }}
          >
            {renderContent()}
          </Spin>

          {/* 底部区域 - 在卡片内 */}
          {footer && (
            <div className="flex-none border-t px-4 py-5 bg-white rounded-b-lg -mt-px">
              {footer}
            </div>
          )}
        </div>
      </ChannelConfigContext.Provider>
    )
  }

  // 简单布局（front-react 风格）
  return (
    <ChannelConfigContext.Provider value={channelConfig}>
      <div className="h-full flex flex-col overflow-hidden bg-[#F7F7FA]">
        {/* 主内容区域 */}
        <Spin
          spinning={loading}
          classNames={{
            root: 'w-full h-full flex overflow-hidden flex-1',
            container: 'w-full h-full flex overflow-hidden',
          }}
        >
          {renderContent()}
        </Spin>

        {/* 底部区域 */}
        {footer}
      </div>
    </ChannelConfigContext.Provider>
  )
}

export default CreatePageLayout
