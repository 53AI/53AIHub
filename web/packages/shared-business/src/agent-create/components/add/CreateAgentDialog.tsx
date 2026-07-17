import { useState, useMemo, useEffect } from 'react'
import { Modal, Button, message, Tooltip } from 'antd'
import { SvgIcon, OverflowTooltip } from '@km/shared-components-react'
import { AGENT_TYPE_OPTIONS } from '../../platformConfig'
import { AgentBasicInfo } from '../shared/AgentBasicInfo'
import type {
  CreateAgentDialogProps,
  AgentTypeOption,
  AgentPlatformOption,
} from '../../adapters/types'
import { BACKEND_AGENT_TYPE } from '../../constants'

// 初始状态
const INITIAL_BASIC_INFO = { name: '', description: '', logo: '' }
const DEFAULT_AGENT_TYPE = BACKEND_AGENT_TYPE.ASSISTANT

// Tab 类型
type TabType = 'builtin' | 'thirdparty'

const TABS = [
  { value: 'thirdparty' as const, labelKey: 'dialog.tab_thirdparty' },
  { value: 'builtin' as const, labelKey: 'dialog.tab_builtin' },
]

// 平台分组组件
function PlatformSection({
  platforms,
  selectedPlatform,
  onSelect,
  t,
}: {
  platforms: AgentPlatformOption[]
  selectedPlatform: string
  onSelect: (platform: AgentPlatformOption) => void
  t: (key: string) => string
}) {
  if (platforms.length === 0) return null
  return (
    <div>
      <div className="grid grid-cols-6 gap-3">
        {platforms.map((platform) => {
          const isActive = selectedPlatform === platform.value
          const label = platform.label.startsWith('agent_app.') ? t(platform.label) : platform.label
          return (
            <div
              key={platform.value}
              className={`p-3 rounded-lg border cursor-pointer transition-all flex items-center gap-2 ${
                isActive
                  ? 'border-[#2563EB] bg-[#F7FAFF] text-theme'
                  : 'border-transparent bg-[#F8F9FA] text-[#333] hover:border-[#2563EB]'
              }`}
              onClick={() => onSelect(platform)}
            >
              <img src={platform.icon} className="size-6" alt={label} />
              <OverflowTooltip>
                <span className="text-md leading-tight truncate">{label}</span>
              </OverflowTooltip>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function CreateAgentDialog({
  visible,
  onClose,
  onConfirm,
  types = AGENT_TYPE_OPTIONS,
  platformsByType,
  groupValue,
  onGroupChange,
  groupOptions,
  avatarSlot,
  t: tProp
}: CreateAgentDialogProps) {
  // Fallback translation function when t is not provided
  const t = tProp ?? ((key: string) => key)

  const [loading, setLoading] = useState(false)
  const [selectedType, setSelectedType] = useState<number>(types[0]?.agent_type || DEFAULT_AGENT_TYPE)
  const [selectedPlatform, setSelectedPlatform] = useState<string>('')
  const [basicInfo, setBasicInfo] = useState(INITIAL_BASIC_INFO)
  const [activeTab, setActiveTab] = useState<TabType>('thirdparty')

  // 重置状态
  const resetState = () => {
    setSelectedType(types[0]?.agent_type || DEFAULT_AGENT_TYPE)
    setSelectedPlatform('')
    setBasicInfo(INITIAL_BASIC_INFO)
    setActiveTab('thirdparty')
  }

  // 表单验证
  const validate = (): string | null => {
    if (!basicInfo.name.trim()) return t('dialog.error_name_required')
    if (!basicInfo.logo.trim()) return t('dialog.error_avatar_required')
    if (!selectedPlatform) return t('dialog.error_platform_required')
    return null
  }

  // 获取当前类型对应的平台列表（过滤隐藏平台）
  const currentPlatforms = useMemo(() => {
    return platformsByType.filter(p => p.agent_type === selectedType && !p.hidden)
  }, [selectedType, platformsByType])

  // 将当前类型的平台分为"平台内置"和"三方接入"两组（过滤隐藏平台）
  const builtInPlatforms = useMemo(() => {
    return currentPlatforms.filter((p) => p.channel_type === 0)
  }, [currentPlatforms])

  const thirdPartyPlatforms = useMemo(() => {
    return currentPlatforms.filter((p) => p.channel_type !== 0)
  }, [currentPlatforms])

  // 系统内置可用平台（对话型和助理型），用于判断系统内置 tab 是否有可用内容（过滤隐藏平台）
  const builtinAvailablePlatforms = useMemo(() => {
    return platformsByType.filter(p => (p.agent_type === BACKEND_AGENT_TYPE.AGENT || p.agent_type === BACKEND_AGENT_TYPE.ASSISTANT) && p.channel_type === 0 && !p.hidden)
  }, [platformsByType])

  // 所有三方平台（不限类型），用于判断是否有三方接入可用（过滤隐藏平台）
  const allThirdPartyPlatforms = useMemo(() => {
    return platformsByType.filter(p => p.channel_type !== 0 && !p.hidden)
  }, [platformsByType])

  // 初始化选中平台
  useEffect(() => {
    if (currentPlatforms.length > 0 && !selectedPlatform) {
      const platforms = activeTab === 'builtin' ? builtInPlatforms : thirdPartyPlatforms
      const firstPlatform = platforms[0] || currentPlatforms[0]
      setSelectedPlatform(firstPlatform.value)
      if (firstPlatform.icon) {
        setBasicInfo(prev => ({ ...prev, logo: firstPlatform.icon }))
      }
    }
  }, [currentPlatforms, selectedPlatform, builtInPlatforms, thirdPartyPlatforms, activeTab])

  // 判断当前类型在系统内置下是否可用（对话型和助理型可用）
  const isBuiltinTypeAvailable = selectedType === BACKEND_AGENT_TYPE.AGENT || selectedType === BACKEND_AGENT_TYPE.ASSISTANT

  // Tab 切换时，确保选中可用的类型和 tab
  useEffect(() => {
    if (activeTab === 'thirdparty') {
      // 三方接入没有可用平台，但系统内置有可用平台时，切到系统内置
      if (allThirdPartyPlatforms.length === 0 && builtinAvailablePlatforms.length > 0) {
        setActiveTab('builtin')
        return
      }
    }
    if (activeTab === 'builtin') {
      // 系统内置没有可用平台，但有三方平台可用时，切到三方接入
      if (builtinAvailablePlatforms.length === 0 && allThirdPartyPlatforms.length > 0) {
        setActiveTab('thirdparty')
        return
      }
      // 系统内置 tab 下，只有对话型和助理型可选
      if (!isBuiltinTypeAvailable) {
        setSelectedType(BACKEND_AGENT_TYPE.AGENT)
        setSelectedPlatform('')
        setBasicInfo(INITIAL_BASIC_INFO)
      }
    }
  }, [activeTab, isBuiltinTypeAvailable, builtinAvailablePlatforms, allThirdPartyPlatforms])

  // 类型选择
  const handleTypeSelect = (type: AgentTypeOption) => {
    // 系统内置 tab 下，应用型不可选
    if (activeTab === 'builtin' && type.agent_type === BACKEND_AGENT_TYPE.WORKFLOW) return
    if (type.disabled) return
    setSelectedType(type.agent_type)
    setSelectedPlatform('')
    setBasicInfo(INITIAL_BASIC_INFO)
  }

  // 平台选择
  const handlePlatformSelect = (platform: AgentPlatformOption) => {
    setSelectedPlatform(platform.value)
    setBasicInfo(prev => ({ ...prev, logo: platform.icon }))
  }

  // 关闭弹窗
  const handleClose = () => {
    onClose()
    resetState()
  }

  // 提交
  const handleSubmit = async () => {
    const error = validate()
    if (error) {
      message.error(error)
      return
    }

    setLoading(true)
    try {
      await onConfirm({
        agentType: selectedPlatform,
        name: basicInfo.name,
        description: basicInfo.description,
        logo: basicInfo.logo,
        groupId: groupValue,
        backend_agent_type: selectedType,
        agent_mode: platformsByType.find(p => p.value === selectedPlatform)?.agent_mode || '',
      })
      handleClose()
    } catch (err) {
      message.error(t('dialog.error_create_failed'))
      console.error('Create agent failed:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={visible}
      title={t('action.add')}
      width={1000}
      onCancel={handleClose}
      footer={null}
      className="add-agent-dialog"
      destroyOnClose
    >
      <div >
        {/* Tab 切换：系统内容 / 三方接入 */}
        <div className="inline-flex flex-none items-center gap-1 bg-[#F7F7F9] p-1 rounded-xl">
          {TABS.map((item) => (
            <div
              key={item.value}
              className={`h-9 px-4 flex items-center text-sm cursor-pointer transition-colors ${
                activeTab === item.value
                  ? "text-[#1D1E1F] font-medium bg-white rounded-md"
                  : "text-[#9A9A9A] hover:text-[#666]"
              }`}
              onClick={() => {
                setActiveTab(item.value)
                setSelectedPlatform('')
              }}
            >
              {t(item.labelKey)}
            </div>
          ))}
        </div>

        {/* 类型选择 */}
        <div className="mt-4">
          <div className="text-sm font-medium text-[#1D1E1F] mb-3">{t('common.type')}</div>
          <div className="flex gap-3">
            {types.map((type) => {
              // 系统内置 tab 下，应用型不可选
              const isBuiltinDisabled = activeTab === 'builtin' && type.agent_type === BACKEND_AGENT_TYPE.WORKFLOW
              const isActive = selectedType === type.agent_type && !type.disabled && !isBuiltinDisabled
              const isDisabled = type.disabled || isBuiltinDisabled
              const tooltipText = isBuiltinDisabled
                ? t('dialog.feature_developing')
                : type.disabled ? t('dialog.feature_developing') : ''
              return (
                <Tooltip
                  key={type.agent_type}
                  title={tooltipText}
                >
                  <div
                    className={`flex-1 rounded-lg border p-4 transition-all ${
                      isDisabled
                        ? 'border-[#E5E5E5] cursor-not-allowed opacity-60'
                        : isActive
                          ? 'border-[#2563EB] bg-[#2563EB]/5 text-theme cursor-pointer'
                          : 'border-[#E5E5E5] text-[#1D1E1F] hover:border-[#D0D0D0] cursor-pointer'
                    }`}
                    onClick={() => handleTypeSelect(type)}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <SvgIcon
                        name={type.icon}
                        size={18}
                      />
                      <span className="text-sm font-medium">
                        {type.label}
                      </span>
                      {type.subLabel && (
                        <span className="text-sm font-medium">
                          {type.subLabel}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#9A9A9A] leading-5">{type.desc}</p>
                  </div>
                </Tooltip>
              )
            })}
          </div>
        </div>

        {/* 平台选择 - 根据 Tab 显示 */}
        <div className="mt-5">
          {activeTab === 'builtin' ? (
            <PlatformSection
              platforms={builtInPlatforms}
              selectedPlatform={selectedPlatform}
              onSelect={handlePlatformSelect}
              t={t}
            />
          ) : (
            <PlatformSection
              platforms={thirdPartyPlatforms}
              selectedPlatform={selectedPlatform}
              onSelect={handlePlatformSelect}
              t={t}
            />
          )}
        </div>

        {/* 基本信息 */}
        <div className="mt-5">
          <div className="text-sm font-medium text-[#1D1E1F] mb-3">{t('dialog.basic_info')}</div>
          <AgentBasicInfo
            value={basicInfo}
            onChange={setBasicInfo}
            avatarSlot={avatarSlot}
            groupValue={groupValue}
            onGroupChange={onGroupChange}
            groupOptions={groupOptions}
            t={t}
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-6">
        <Button onClick={handleClose}>{t('action.cancel')}</Button>
        <Button type="primary" loading={loading} onClick={handleSubmit}>
          {t('action.confirm')}
        </Button>
      </div>
    </Modal>
  )
}

export default CreateAgentDialog
