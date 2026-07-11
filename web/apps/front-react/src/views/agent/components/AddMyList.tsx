import { useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from 'antd'
import {
  CreateAgentDialog,
  createFrontTypeOptions,
  createFrontPlatformsByType,
  getOpenClawCompatibleAgentMetadata,
} from '@km/shared-business/agent-create'
import type { CreateAgentDialogResult } from '@km/shared-business/agent-create'
import { frontAgentAdapter } from '@/adapters/agent-create-adapter'
import agentsApi from '@/api/modules/agents'
import channelApi from '@/api/modules/channel'
import { t } from '@/locales'
import { img_host } from '@/utils/config'
import './AddMyList.css'
import { buildOpenClawPersonalAgentPayload } from './openclaw-create'

interface AddMyListProps {
  visible: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function AddMyList({ visible, onClose, onSuccess }: AddMyListProps) {
  const navigate = useNavigate()
  const uploadImageRef = useRef<{ trigger: () => void }>(null)

  // 从适配器获取图片上传组件
  const ImageUploadComponent = frontAgentAdapter.ImageUploadComponent

  const types = useMemo(() => createFrontTypeOptions(), [])

  const platformsByType = useMemo(() => createFrontPlatformsByType(img_host), [])

  // 自定义头像上传组件（带裁剪），使用适配器的组件保持与编辑页一致
  const avatarSlot = useMemo(() => {
    if (!ImageUploadComponent) return undefined
    return ({ value, onChange }: { value: string; onChange: (logo: string) => void }) => (
      <div className="flex flex-col items-center gap-2">
        <ImageUploadComponent
          ref={uploadImageRef}
          className="!size-[72px]"
          value={value}
          onChange={onChange}
        />
        <Button
          className="w-[72px] text-xs"
          onClick={() => uploadImageRef.current?.trigger()}
        >
          {t('agent.change_avatar')}
        </Button>
      </div>
    )
  }, [ImageUploadComponent])

  // 处理确认
  const handleConfirm = async (data: CreateAgentDialogResult) => {
    try {
      const metadata = getOpenClawCompatibleAgentMetadata(data.agentType)
      // 获取或创建 channel
      const channelList = await channelApi.listv2()
      const existingChannel = channelList.find((item: any) => item.type === metadata.channelType)
      let channelId = existingChannel?.channel_id

      if (!channelId) {
        const res = await channelApi.create({
          type: metadata.channelType,
          name: t('agent.personal_agent_channel'),
          models: 'openclaw-ws',
        })
        channelId = res?.data?.channel_id || res?.data?.id || res?.channel_id
      }

      // 创建智能体
      const result = await agentsApi.my.create(buildOpenClawPersonalAgentPayload(data, channelId))

      navigate({
        pathname: '/agent/create-v2',
        search: `?type=${metadata.agentType}&agent_id=${result.agent_id}`
      })

      onSuccess?.()
    } catch (error) {
      console.error('创建失败:', error)
    }
  }

  return (
    <CreateAgentDialog
      visible={visible}
      onClose={onClose}
      onConfirm={handleConfirm}
      types={types}
      platformsByType={platformsByType}
      avatarSlot={avatarSlot}
      t={t}
    />
  )
}

export default AddMyList
