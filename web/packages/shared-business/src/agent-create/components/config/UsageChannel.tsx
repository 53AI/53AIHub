import { useState, useEffect, useCallback, type ComponentType } from 'react'
import { Button, Modal, Form, Input } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useAgentCreateAdapter } from '../../adapters'
import { useAgentFormStore } from '../../store'
import { CollapsibleSection } from '../shared/CollapsibleSection'
import { SvgIcon } from '@km/shared-components-react'
import { generateRandomId } from '@km/shared-utils'

// 渠道项类型
export interface ChannelItem {
  id: string
  type: 'channel'
  image?: string
  name: string
  desc?: string
}

export interface UsageChannelProps {
  className?: string
}

/**
 * 使用渠道配置组件
 * 用于第二列，只显示渠道配置
 */
export function UsageChannel({ className }: UsageChannelProps) {
  const adapter = useAgentCreateAdapter()
  const t = adapter.t || ((key: string) => key)
  const ImageUploadComponent = adapter.ImageUploadComponent as ComponentType<{
    className?: string
    value?: string
    onChange?: (url: string) => void
  }> | undefined

  // 从 store 读取状态
  const formData = useAgentFormStore((state) => state.form_data)
  const setFormData = useAgentFormStore((state) => state.setFormData)

  // 渠道数据
  const [channelList, setChannelList] = useState<ChannelItem[]>([])
  const [channelVisible, setChannelVisible] = useState(false)
  const [editingChannel, setEditingChannel] = useState<ChannelItem | null>(null)
  const [channelForm] = Form.useForm()

  // 同步 store 数据到本地状态
  useEffect(() => {
    const channels = (formData.use_cases || []).filter(
      (item: any): item is ChannelItem => item.type === 'channel'
    )
    setChannelList(channels)
  }, [formData.use_cases])

  // 同步渠道列表到 store
  const syncToStore = useCallback((channels: ChannelItem[]) => {
    // 保留其他类型的 use_cases（场景、案例）
    const otherCases = (formData.use_cases || []).filter((item: any) => item.type !== 'channel')
    setFormData({ use_cases: [...otherCases, ...channels] })
  }, [formData.use_cases, setFormData])

  // 渠道操作
  const onChannelOpen = useCallback((data?: ChannelItem) => {
    if (data) {
      setEditingChannel(data)
      channelForm.setFieldsValue(data)
    } else {
      setEditingChannel(null)
      channelForm.resetFields()
    }
    setChannelVisible(true)
  }, [channelForm])

  const onChannelDelete = useCallback((index: number) => {
    const newList = channelList.filter((_, i) => i !== index)
    setChannelList(newList)
    syncToStore(newList)
  }, [channelList, syncToStore])

  const onChannelConfirm = useCallback(async () => {
    try {
      const values = await channelForm.validateFields()
      const id = editingChannel?.id || generateRandomId(8)
      const newItem: ChannelItem = {
        type: 'channel',
        id,
        image: values.image || '',
        name: values.name || '',
        desc: values.desc || '',
      }

      let newList: ChannelItem[]
      const existingIndex = channelList.findIndex(item => item.id === id)
      if (existingIndex >= 0) {
        newList = channelList.map(item => item.id === id ? newItem : item)
      } else {
        newList = [...channelList, newItem]
      }
      setChannelList(newList)
      syncToStore(newList)
      setChannelVisible(false)
    } catch (err) {
      // Validation failed
    }
  }, [editingChannel, channelList, channelForm, syncToStore])

  return (
    <div className={className || ''}>
      <CollapsibleSection
        title={t('agent.usage_channel')}
        actions={
          <Button  color="default" variant="link" className="px-0" onClick={() => onChannelOpen()}>
            <PlusOutlined />
          </Button>
        }
      >
        {channelList.length === 0 ? (
          <div className="text-sm text-[#9CA3AF]">{t('agent.guide_channel_tip')}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {channelList.map((item, index) => (
              <div
                key={item.id}
                className="w-full flex justify-between items-center h-10 px-3 bg-white rounded-xl hover:bg-[#EBEEF3] cursor-pointer group"
              >
                <h6
                  className="text-sm text-[#1D1E1F] max-w-[10em] truncate"
                  title={item.name}
                >
                  {item.name}
                </h6>
                <div className="flex gap-2 invisible group-hover:visible">
                  <Button
                    color="default"
                    variant="link"
                    className="px-0"
                    onClick={(e) => { e.stopPropagation(); onChannelOpen(item); }}
                  >
                    <SvgIcon name="setting" />
                  </Button>
                  <Button
                    color="default"
                    variant="link"
                    className="px-0"
                    onClick={(e) => { e.stopPropagation(); onChannelDelete(index); }}
                  >
                    <SvgIcon name="reduce-one" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* 渠道弹框 */}
      <Modal
        open={channelVisible}
        title={editingChannel ? t('action.edit') : t('action.add')}
        onCancel={() => setChannelVisible(false)}
        onOk={onChannelConfirm}
        width={600}
        destroyOnHidden
      >
        <Form form={channelForm} labelCol={{ flex: '102px' }} labelAlign="left" colon={false}>
          <Form.Item
            name="image"
            label={t('agent.qrcode')}
            rules={[{ required: true, message: t('form.upload_placeholder') }]}
          >
            {ImageUploadComponent ? (
              <ImageUploadComponent className="!w-[120px] !h-[112px]" />
            ) : (
              <Input />
            )}
          </Form.Item>
          <Form.Item
            name="name"
            label={t('agent.channel_name')}
            rules={[
              { required: true, message: t('form.input_placeholder') },
              { max: 20, message: t('form.input_placeholder_max_length', { max: 20 }) },
            ]}
          >
            <Input maxLength={20} showCount placeholder={t('agent.please_fill_channel_name')} />
          </Form.Item>
          <Form.Item
            name="desc"
            label={t('form.desc')}
            rules={[
              { required: true, message: t('form.input_placeholder') },
              { max: 100, message: t('form.input_placeholder_max_length', { max: 100 }) },
            ]}
          >
            <Input.TextArea rows={5} style={{ resize: 'none' }} maxLength={100} showCount placeholder={t('agent.please_fill_usage_guide')} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default UsageChannel
