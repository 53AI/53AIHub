import { Drawer, Form, Input, Button, Tabs, message } from 'antd'
import { forwardRef, useImperativeHandle, useState, useRef, useCallback } from 'react'
import IconPopover from '@/components/Icon/popover'
import KnowledgeListDrawer, { KnowledgeListDrawerRef } from './KnowledgeListDrawer'
import Member from './Member'
import { PERMISSION_TYPE, SUBJECT_TYPE, RESOURCE_TYPE, VISIBILITY_TYPE } from '@/components/Permission/constant'
import { spacesApi } from '@/api/modules/spaces'
import { permissionsApi } from '@/api/modules/permissions'
import type { SpaceItem, SpaceCreateRequest } from '@/api/modules/spaces/types'
import { useUserStore } from '@/stores/modules/user'
import { uploadApi } from '@/api/modules/upload'
import { api_host } from '@/utils/config'
import { createIconFileFromStatic } from '@km/shared-utils'
import { t } from '@/locales'

export interface DetailRef {
  open: (data: SpaceItem) => void
  close: () => void
}

export interface DetailProps {
  onRefresh?: (reset?: boolean) => void
}

const defaultPermission = {
  subject_type: SUBJECT_TYPE.company_all,
  subject_id: 0,
  permission: PERMISSION_TYPE.viewer,
}

function DetailInner(props: DetailProps, ref: React.ForwardedRef<DetailRef>) {
  const { onRefresh } = props
  const [form] = Form.useForm()
  const [visible, setVisible] = useState(false)
  const [originData, setOriginData] = useState<Partial<SpaceItem>>({})
  const [iconFile, setIconFile] = useState<File | string>('')
  const [activeTab, setActiveTab] = useState('knowledge')
  const [formData, setFormData] = useState<SpaceCreateRequest>({
    name: '',
    description: '',
    icon: '',
    visibility: VISIBILITY_TYPE.public,
    permissions: [],
  })
  const userStore = useUserStore()
  const knowledgeListDrawerRef = useRef<KnowledgeListDrawerRef>(null)

  const open = useCallback(
    async (data: SpaceItem = {} as SpaceItem) => {
      setVisible(true)
      setActiveTab('knowledge')

      const newFormData: SpaceCreateRequest = {
        name: data.name || '',
        description: data.description || '',
        icon: data.icon || '',
        visibility: typeof data.visibility === 'number' ? data.visibility : VISIBILITY_TYPE.public,
        permissions: [],
      }

      setOriginData(data || {})
      setIconFile('')

      form.setFieldsValue({
        name: newFormData.name,
        description: newFormData.description,
      })

      if (data.id) {
        const res = await permissionsApi.list({
          resource_type: RESOURCE_TYPE.space,
          resource_id: data.id,
        })
        // Filter out space_active and deduplicate by subject_type + subject_id
        const seen = new Set<string>()
        newFormData.permissions = res.filter((item) => {
          if (item.subject_type === SUBJECT_TYPE.space_active) return false
          const key = `${item.subject_type}-${item.subject_id}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      } else {
        newFormData.permissions = [
          { ...defaultPermission },
          {
            subject_type: SUBJECT_TYPE.user,
            subject_id: Number(userStore.info.user_id),
            permission: PERMISSION_TYPE.manage,
          },
        ]
      }

      setFormData(newFormData)

      // Open knowledge list drawer after render
      setTimeout(() => {
        knowledgeListDrawerRef.current?.open(data)
      }, 0)
    },
    [form, userStore.info.user_id]
  )

  const close = useCallback(() => {
    setVisible(false)
  }, [])

  useImperativeHandle(ref, () => ({ open, close }), [open, close])

  const onIconParams = useCallback(async (data: { icon: string; bgLight: string; bgDark: string }) => {
    try {
      if (data.icon && data.bgLight && data.bgDark) {
        const file = (await createIconFileFromStatic(data.icon, data.bgLight, data.bgDark, {
          size: 100,
          iconPadding: 24,
        })) as File
        setIconFile(file)
      } else {
        setIconFile('')
      }
    } catch (error) {
      console.error(error)
    }
  }, [])

  const uploadIcon = useCallback(async (file: File) => {
    try {
      const res: any = await uploadApi.upload(file)
      return res?.data
    } catch (error) {
      return {}
    }
  }, [])

  // Update formData with new partial data
  const updateFormData = useCallback((updates: Partial<SpaceCreateRequest>) => {
    setFormData(prev => ({ ...prev, ...updates }))
  }, [])

  // Update visibility
  const updateVisibility = useCallback((visibility: number) => {
    setFormData(prev => ({ ...prev, visibility }))
  }, [])

  // Update permissions
  const updatePermissions = useCallback((permissions: SpaceCreateRequest['permissions']) => {
    setFormData(prev => ({ ...prev, permissions }))
  }, [])

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields()

      let icon = formData.icon
      if (iconFile && typeof iconFile !== 'string') {
        const res = await uploadIcon(iconFile)
        icon = `${api_host}/api/preview/${res?.preview_key || ''}`
      }

      const submitData: SpaceCreateRequest = {
        name: values.name,
        description: values.description || '',
        icon,
        visibility: formData.visibility,
        permissions: [...formData.permissions],
      }

      if (originData.id) {
        await spacesApi.update(originData.id, submitData)
        message.success(t('message_status.save_success'))
      } else {
        await spacesApi.create(submitData)
        message.success(t('message_status.create_success'))
      }
      onRefresh?.(!originData.id)
      close()
    } catch (error) {
      console.error('Save space error:', error)
    }
  }, [form, formData, iconFile, originData, uploadIcon, onRefresh, close])

  const tabItems = [
    {
      key: 'knowledge',
      label: t('knowledge.name'),
      children: <KnowledgeListDrawer ref={knowledgeListDrawerRef} />,
    },
    {
      key: 'member',
      label: t('space.member_and_permission'),
      children: (
        <Member
          formData={formData}
          ownerId={originData.owner_id}
          type="detail"
          onVisibilityChange={updateVisibility}
          onPermissionsChange={updatePermissions}
        />
      ),
    },
  ]

  return (
    <Drawer
      open={visible}
      title={t('detail')}
      onClose={close}
      styles={{ wrapper: { width: '50%' } }}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={close}>{t('action_cancel')}</Button>
          <Button type="primary" onClick={handleSave}>
            {t('action_save')}
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical">
        <div className="flex items-center gap-4 mb-[18px]">
          <IconPopover
            value={formData.icon}
            onChange={(url) => updateFormData({ icon: url })}
            onIconParams={onIconParams}
            className="w-[60px] h-[60px]"
          />
          <Form.Item
            className="w-full !mb-0"
            label={t('space.name')}
            name="name"
            rules={[{ required: true, message: t('space.name_placeholder') }]}
          >
            <Input
              placeholder={t('space.name_placeholder')}
              maxLength={20}
              showCount
            />
          </Form.Item>
        </div>
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
      </Form>
    </Drawer>
  )
}

export const Detail = forwardRef<DetailRef, DetailProps>(DetailInner)

export default Detail
