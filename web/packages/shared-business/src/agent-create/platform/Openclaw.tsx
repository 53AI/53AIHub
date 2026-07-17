import { forwardRef, useImperativeHandle, useMemo, useCallback } from 'react'
import { Tooltip, message, Spin } from 'antd'
import { CopyOutlined, SyncOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { useAgentCreateAdapter } from '../adapters'
import { useAgentFormStore } from '../store'
import { getOpenClawCompatibleAgentMetadata } from '../constants'

interface OpenclawProps {
  showChannelConfig?: boolean
  className?: string
}

export interface OpenclawRef {
  validateForm: () => Promise<boolean>
  onChannelSave: () => Promise<void>
}

export function buildOpenClawInstallCommand({
  botId,
  secret,
  wsUrl,
  agentType,
}: {
  botId: string
  secret: string
  wsUrl: string
  agentType?: unknown
}): string {
  const metadata = getOpenClawCompatibleAgentMetadata(agentType)
  const hubArgs = `--host-kind ${metadata.agentType} --hub-bot-id "${botId}" --hub-secret "${secret}" --hub-ws-url "${wsUrl}"`

  return `npx --yes @53ai/53ai-openclaw@latest install ${hubArgs}`
}

/**
 * Openclaw 配置组件
 * - showChannelConfig=true: 显示渠道配置（访问配置 + 接入流程）
 * - showChannelConfig=false: 显示应用配置（使用渠道）
 */
export const Openclaw = forwardRef<OpenclawRef, OpenclawProps>(
  ({ showChannelConfig, className }, ref) => {
    const adapter = useAgentCreateAdapter()
    const t = adapter.t || ((key: string) => key)

    // 从 store 读取状态
    const formData = useAgentFormStore((state) => state.form_data)
    const agentId = useAgentFormStore((state) => state.agent_id)
    const loading = useAgentFormStore((state) => state.loading)
    const setFormData = useAgentFormStore((state) => state.setFormData)

    // 从 formData 获取配置
    const botId = useMemo(() => {
      return formData.bot_id?.toString() || ''
    }, [formData.bot_id])

    const secret = useMemo(() => {
      return formData.custom_config?.openclaw_app_secret || ''
    }, [formData.custom_config?.openclaw_app_secret])

    const wsUrl = useMemo(() => {
      const apiHost = adapter.apiHost || ''
      return `ws://${apiHost.replace('https://', '').replace('http://', '')}/api/v1/openclaw/ws/connect`
    }, [adapter.apiHost])

    const agentMetadata = useMemo(() => {
      return getOpenClawCompatibleAgentMetadata(formData.custom_config?.agent_type || formData.custom_config?.hostKind)
    }, [formData.custom_config?.agent_type, formData.custom_config?.hostKind])

    // 安装命令（用于展示与复制）
    const installCommand = useMemo(
      () => buildOpenClawInstallCommand({ botId, secret, wsUrl, agentType: agentMetadata.agentType }),
      [agentMetadata.agentType, botId, secret, wsUrl]
    )

    // 复制到剪贴板
    const handleCopy = useCallback(async (text: string) => {
      if (adapter.copyToClip) {
        const success = await adapter.copyToClip(text)
        if (success) {
          message.success(t('action.copy_success'))
        }
      }
    }, [adapter, t])

    // 重置密钥
    const resetSecret = useCallback(async () => {
      if (adapter.resetSecret && agentId) {
        try {
          const data = await adapter.resetSecret(agentId)
          setFormData({
            custom_config: {
              ...formData.custom_config,
              openclaw_app_secret: data.secret,
            },
          })
          message.success(t('action.reset_success') || t('action.success'))
        } catch (error) {
          // Ignore
        }
      }
    }, [adapter, agentId, formData.custom_config, setFormData, t])

    // 验证表单
    const validateForm = useCallback(async () => {
      return true
    }, [])

    // 渠道保存（配置数据已在 store 中）
    const onChannelSave = useCallback(async () => {
      // 配置数据已在 store 中，无需额外操作
    }, [])

    useImperativeHandle(ref, () => ({
      validateForm,
      onChannelSave,
    }))

    // 渠道配置（第一列）
    const renderChannelConfig = () => {
      const collapseItems = [
        {
          key: 'config',
          label: t('agent.access_config'),
          children: (
            <div className="space-y-4">
              {/* Bot ID */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 w-16 shrink-0">
                  <span className="text-sm text-[#333]">{t('agent.bot_id')}</span>
                  <Tooltip title={t('agent.bot_id_tooltip')}>
                    <QuestionCircleOutlined className="text-[#999] cursor-pointer" style={{ fontSize: 14 }} />
                  </Tooltip>
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-2 px-3 py-1 border border-[#E9EBF2] rounded">
                  <span className="text-sm text-[#333] flex-1">{botId}</span>
                  <Tooltip title={t('action.copy')}>
                    <CopyOutlined
                      className="cursor-pointer text-[#999] hover:text-[#666]"
                      style={{ fontSize: 16 }}
                      onClick={() => handleCopy(botId)}
                    />
                  </Tooltip>
                </div>
              </div>
              {/* Secret */}
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="flex items-center gap-1 w-16 shrink-0">
                  <span className="text-sm text-[#333]">{t('agent.secret')}</span>
                  <Tooltip title={t('agent.secret_tooltip')}>
                    <QuestionCircleOutlined className="text-[#999] cursor-pointer" style={{ fontSize: 14 }} />
                  </Tooltip>
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-2 px-3 py-1 border border-[#E9EBF2] rounded ">
                  <span className="text-sm text-[#333] flex-1 overflow-hidden whitespace-nowrap text-ellipsis font-mono">{secret}</span>
                  <Tooltip title={t('action.reset')}>
                    <SyncOutlined
                      className="cursor-pointer text-[#999] hover:text-[#666]"
                      style={{ fontSize: 16 }}
                      onClick={resetSecret}
                    />
                  </Tooltip>
                  <Tooltip title={t('action.copy')}>
                    <CopyOutlined
                      className="cursor-pointer text-[#999] hover:text-[#666]"
                      style={{ fontSize: 16 }}
                      onClick={() => handleCopy(secret)}
                    />
                  </Tooltip>
                </div>
              </div>
              {/* WS Url */}
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-sm text-[#333]">{t('agent.ws_url')}</span>
                  <Tooltip title={t('agent.ws_url_tooltip')}>
                    <QuestionCircleOutlined className="text-[#999] cursor-pointer" style={{ fontSize: 14 }} />
                  </Tooltip>
                </div>
                <div className="flex-1 flex items-center gap-2 px-3 py-1 border border-[#E9EBF2] rounded overflow-hidden">
                  <span className="text-sm text-[#333] flex-1 overflow-hidden text-ellipsis">{wsUrl}</span>
                  <Tooltip title={t('action.copy')}>
                    <CopyOutlined
                      className="cursor-pointer text-[#999] hover:text-[#666]"
                      style={{ fontSize: 16 }}
                      onClick={() => handleCopy(wsUrl)}
                    />
                  </Tooltip>
                </div>
              </div>
            </div>
          ),
        },
        {
          key: 'process',
          label: t('agent.access_process'),
          children: (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-[#9CA3AF] mb-2">{t('agent.step1_install_plugin')}</p>
                <div className="flex items-start gap-2 rounded-md px-3 py-2 bg-[#F5F5F7]">
                  <code className="flex-1 whitespace-pre-wrap break-all text-sm leading-6 text-[#333] font-mono">
                    {installCommand}
                  </code>
                  <Tooltip title={t('action.copy')}>
                    <CopyOutlined
                      className="mt-1 cursor-pointer text-[#999] hover:text-[#666]"
                      onClick={() => handleCopy(installCommand)}
                    />
                  </Tooltip>
                </div>
              </div>
              <div>
                <p className="text-sm text-[#9CA3AF] mb-2">{t('agent.step3_restart_service')}</p>
                <div className="flex items-center gap-2 rounded-md px-3 py-2 bg-[#F5F5F7]">
                  <code className="flex-1 text-sm text-[#333]">openclaw gateway restart</code>
                  <Tooltip title={t('action.copy')}>
                    <CopyOutlined
                      className="cursor-pointer text-[#999] hover:text-[#666]"
                      onClick={() => handleCopy('openclaw gateway restart')}
                    />
                  </Tooltip>
                </div>
              </div>
            </div>
          ),
        },
      ]

      return (
        <div className={`p-4 flex flex-col overflow-hidden ${className || ''}`}>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-50">
              <Spin size="large" />
            </div>
          )}
          { collapseItems.map((item, index) => (
            <div key={item.key || index}>
              <div className='flex items-center text-sm text-[#373A3D]'>
                {item.label}
              </div>
              <div className="p-4 bg-white rounded-xl mb-4 mt-3">
                {item.children}
              </div>
            </div>
          )) }
        </div>
      )
    }

    // 应用配置（第二列）- 只显示使用渠道
    const renderAppConfig = () => {
      return <>
      </>
    }

    return showChannelConfig ? renderChannelConfig() : renderAppConfig()
  }
)

Openclaw.displayName = 'Openclaw'

export default Openclaw
