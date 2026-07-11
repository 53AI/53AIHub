import { Modal, Form, Input, Button, message } from 'antd'
import { forwardRef, useImperativeHandle, useState, useRef, useCallback } from 'react'
import IconPopover from '@/components/Icon/popover'
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

export interface InfoSaveDialogRef {
  open: (data?: SpaceItem) => void
  close: () => void
}

export interface InfoSaveDialogProps {
  onRefresh?: (reset?: boolean) => void
}

const defaultPermission = {
  subject_type: SUBJECT_TYPE.company_all,
  subject_id: 0,
  permission: PERMISSION_TYPE.viewer,
}

function InfoSaveDialogInner(
  props: InfoSaveDialogProps,
  ref: React.ForwardedRef<InfoSaveDialogRef>
) {
  const { onRefresh } = props
  const [form] = Form.useForm()
  const [visible, setVisible] = useState(false)
  const [originData, setOriginData] = useState<Partial<SpaceItem>>({})
  const [iconFile, setIconFile] = useState<File | string>('')
  const [formData, setFormData] = useState<SpaceCreateRequest>({
    name: '',
    description: '',
    icon: '',
    visibility: VISIBILITY_TYPE.public,
    permissions: [],
  })
  const userStore = useUserStore()

  const open = useCallback(
    async (data: SpaceItem = {} as SpaceItem) => {
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
        newFormData.permissions = res.filter(
          (item) => item.subject_type !== SUBJECT_TYPE.space_active
        )
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
      setVisible(true)
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

  return (
    <Modal
      open={visible}
      title={originData.id ? t('action.edit') : t('action.create')}
      onCancel={close}
      destroyOnHidden
      mask={{ closable: false }}
      width={500}
      footer={
        <>
          <Button onClick={close}>{t('action_cancel')}</Button>
          <Button type="primary" onClick={handleSave}>
            {t('action_save')}
          </Button>
        </>
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
            className="flex-1 !mb-0"
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
        <Member
          formData={formData}
          ownerId={originData.owner_id}
          type="create"
          onVisibilityChange={updateVisibility}
          onPermissionsChange={updatePermissions}
        />
      </Form>
    </Modal>
  )
}

export const InfoSaveDialog = forwardRef<InfoSaveDialogRef, InfoSaveDialogProps>(
  InfoSaveDialogInner
)

export default InfoSaveDialog
