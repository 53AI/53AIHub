import { useState, useEffect, useMemo, useCallback, forwardRef, useImperativeHandle, useRef } from 'react'
import {
    Modal, Form, Input, Button, message
} from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import { t } from '@/locales'
import { useEnterpriseStore } from '@/stores'
import { copyToClip } from '@km/shared-utils'
import { api_host } from '@/utils/config'
import { PROVIDER_VALUE } from '@/constants/platform/provider'
import type { ProviderValueType } from '@/constants/platform/provider'
import providersApi from '@/api/modules/providers'
import type { ProviderCreateRequest } from '@/api/modules/providers/types'

interface ProviderData {
  name?: string
  provider_type?: ProviderValueType
  provider_id?: number
  configs?: Record<string, string>
  base_url?: string
  is_authorized?: number
  access_token?: string
  label?: string
  id?: number
}

interface PlatformConfig {
  i18n_key: string
  tip: {
    url: string
    needRedirectUrl?: boolean
  }
  fields: {
    label: string
    prop: string
    placeholder: string
  }[]
  setFormData?: (form: ProviderFormData) => void
  needsConfirmation?: boolean
  getAuthUrl?: (form: ProviderFormData, redirectUrl: string, provider_id: number) => string
}

interface ProviderFormData {
  name: string
  configs: Record<string, string>
  base_url: string
  access_token: string
  provider_type: number
}

interface ProviderAuthorizeDialogProps {
  open: boolean
  data: {
    label?: string
    provider: ProviderValueType
    channel_type: number
    [key: string]: any
  }
  onClose: () => void
  onSuccess: () => void
}

export interface ProviderAuthorizeDialogRef {
  open: (options?: { data?: ProviderData }) => void
  close: () => void
  reset: () => void
}

const PLATFORM_CONFIGS: Record<ProviderValueType, PlatformConfig> = {
  [PROVIDER_VALUE.APP_BUILDER]: {
    i18n_key: 'platform_auth.app_builder.tip',
    tip: { url: 'https://qianfan.cloud.baidu.com/appbuilder' },
    fields: [
      {
        label: t('module.platform_tool_api_key'),
        prop: 'access_token',
        placeholder: t('module.platform_tool_api_key_placeholder'),
      },
    ],
  },
  [PROVIDER_VALUE.COZE_CN]: {
    i18n_key: 'platform_auth.coze_cn.tip',
    tip: {
      url: 'https://www.coze.cn/open/oauth/apps',
      needRedirectUrl: true,
    },
    fields: [
      {
        label: t('module.platform_auth_client_id'),
        prop: 'configs.client_id',
        placeholder: t('module.platform_auth_client_id_placeholder'),
      },
      {
        label: t('module.platform_auth_client_secret'),
        prop: 'configs.client_secret',
        placeholder: t('module.platform_auth_client_secret_placeholder'),
      },
    ],
    needsConfirmation: true,
    setFormData: (form: ProviderFormData) => {
      form.access_token = ''
    },
    getAuthUrl: (form: ProviderFormData, redirectUrl: string, provider_id: number) =>
      `https://www.coze.cn/api/permission/oauth2/authorize?response_type=code&client_id=${form.configs.client_id}&redirect_uri=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(`provider_id=${provider_id.toString()}`)}`,
  },
  [PROVIDER_VALUE.COZE_OSV]: {
    i18n_key: 'platform_auth.coze_osv.tip',
    tip: { url: 'https://www.53ai.com/' },
    fields: [
      {
        label: t('module.platform_tool_api_endpoint'),
        prop: 'base_url',
        placeholder: t('module.platform_model_base_url_placeholder'),
      },
      {
        label: t('module.platform_tool_token'),
        prop: 'access_token',
        placeholder: t('module.platform_tool_token_placeholder'),
      },
    ],
  },
  [PROVIDER_VALUE['53AI']]: {
    i18n_key: 'platform_auth.53ai.tip',
    tip: { url: 'https://chat.53ai.com/' },
    fields: [
      {
        label: t('module.platform_auth_url'),
        prop: 'base_url',
        placeholder: t('module.platform_model_base_url_placeholder_53ai'),
      },
      {
        label: t('module.platform_auth_secret'),
        prop: 'access_token',
        placeholder: t('module.platform_tool_api_key_placeholder'),
      },
    ],
    setFormData: (form: ProviderFormData) => {
      form.base_url = form.base_url.trim() || 'https://api.53ai.com'
      form.access_token = form.access_token.trim()
    },
  },
  [PROVIDER_VALUE.TENCENT]: {
    i18n_key: 'platform_auth.tencent.tip',
    tip: { url: 'https://console.cloud.tencent.com/cam/capi/' },
    fields: [
      {
        label: t('module.platform_auth_url'),
        prop: 'base_url',
        placeholder: t('module.platform_model_base_url_placeholder_53ai'),
      },
      {
        label: t('module.platform_auth_secret_id'),
        prop: 'configs.secret_id',
        placeholder: t('module.platform_auth_secret_id_placeholder'),
      },
      {
        label: t('module.platform_auth_secret_key'),
        prop: 'configs.secret_key',
        placeholder: t('module.platform_auth_secret_key_placeholder'),
      },
    ],
    setFormData: (form: ProviderFormData) => {
      form.base_url = form.base_url.trim() || 'https://wss.lke.cloud.tencent.com'
      form.configs.region = 'ap-guangzhou'
    },
  },
}

export const ProviderAuthorizeDialog = forwardRef<ProviderAuthorizeDialogRef, ProviderAuthorizeDialogProps>(
  ({ open, data, onClose, onSuccess }, ref) => {
    const enterpriseStore = useEnterpriseStore()
    const [form] = Form.useForm()
    const [loading, setLoading] = useState(false)
    const [originData, setOriginData] = useState<ProviderData>({})
    const [formData, setFormData] = useState<ProviderFormData>({
      name: '',
      configs: {},
      base_url: '',
      access_token: '',
      provider_type: 0,
    })
    const copyIconRef = useRef<HTMLSpanElement>(null)

    // Get current config
    const currentConfig = useMemo(() => {
      const provider_type = originData.provider_type
      return typeof provider_type === 'number' ? PLATFORM_CONFIGS[provider_type as ProviderValueType] : null
    }, [originData.provider_type])

    // Check if Coze CN
    const isCozeCN = useMemo(() => {
      return originData.provider_type === PROVIDER_VALUE.COZE_CN
    }, [originData.provider_type])

    // Coze auth URL
    const coze_auth_url = useMemo(() => {
      const enterprise_info = enterpriseStore.info
      return `${api_host}/api/callback/cozecn/auth/${enterprise_info.eid}`
    }, [enterpriseStore.info])

    // Guide HTML content
    const guideHtml = useMemo(() => {
      const config = currentConfig
      if (!config) return ''

      const tipParams: Record<string, string> = {
        url: `<a class='text-link' href='${config.tip.url}' target='_blank'>${config.tip.url}</a>`,
      }

      if (config.tip.needRedirectUrl) {
        tipParams.redirect_url = `<span class='text-[#F04F4D]'>${coze_auth_url}</span><span class='copy-hook'></span>`
        tipParams.client_id = `<span class='text-[#F04F4D]'>${t('module.platform_auth_client_id')}</span>`
        tipParams.client_secret = `<span class='text-[#F04F4D]'>${t('module.platform_auth_client_secret')}</span>`
      }

      return t(config.i18n_key, tipParams)
    }, [currentConfig, coze_auth_url])

    // Schema options
    const schemaOptions = useMemo(() => currentConfig?.fields || [], [currentConfig])

    // Get form value
    const getFormValue = (prop: string) => {
      const isConfigProp = prop.startsWith('configs.')
      const key = isConfigProp ? prop.replace('configs.', '') : prop
      return isConfigProp ? formData.configs[key] || '' : (formData as any)[key] || ''
    }

    // Set form value
    const setFormValue = (prop: string, value: string) => {
      const isConfigProp = prop.startsWith('configs.')
      const key = isConfigProp ? prop.replace('configs.', '') : prop

      if (isConfigProp) {
        setFormData(prev => ({
          ...prev,
          configs: { ...prev.configs, [key]: value }
        }))
      } else {
        setFormData(prev => ({ ...prev, [key]: value }))
      }
    }

    // Reset form
    const reset = useCallback(() => {
      setFormData({
        name: '',
        configs: {},
        base_url: '',
        access_token: '',
        provider_type: 0,
      })
      form.resetFields()
    }, [form])

    // Open dialog
    const openDialog = useCallback((options: { data?: ProviderData } = {}) => {
      const { data = {} as ProviderData } = options
      reset()
      setOriginData(data)

      const newFormData: ProviderFormData = {
        name: data.name || '',
        provider_type: data.provider_type || 0,
        base_url: data.base_url || '',
        access_token: data.access_token || '',
        configs: { ...data.configs } || {},
      }

      // Apply platform specific form data handling
      const config = typeof newFormData.provider_type === 'number'
        ? PLATFORM_CONFIGS[newFormData.provider_type as ProviderValueType]
        : null

      if (config?.setFormData) {
        config.setFormData(newFormData)
      }

      setFormData(newFormData)
      form.setFieldsValue({
        name: newFormData.name,
        base_url: newFormData.base_url,
        access_token: newFormData.access_token,
        ...newFormData.configs,
      })
    }, [form, reset])

    // Close dialog
    const close = useCallback(() => {
      reset()
      onClose()
    }, [reset, onClose])

    // Handle copy
    const handleCopy = useCallback((text: string) => {
      if (!text) return
      copyToClip(text)
      message.success(t('action_copy_success'))
    }, [])

    // Handle authorization
    const handleAuthorization = useCallback((auth_url: string, provider_type: ProviderValueType) => {
      const auth_window = window.open(auth_url, '_blank', 'width=1000,height=800')

      const handleMessage = (event: MessageEvent) => {
        if (event.data?.provider_type === provider_type) {
          auth_window?.close()
          message.success(t('action_authorize_success'))
          onSuccess()
          window.removeEventListener('message', handleMessage)
        }
      }

      window.addEventListener('message', handleMessage)
    }, [onSuccess])

    // Handle confirm
    const handleConfirm = async () => {
      try {
        const values = await form.validateFields()
        setLoading(true)

        const config = currentConfig
        if (!config) return

        const data: ProviderCreateRequest = {
          name: formData.name,
          provider_type: formData.provider_type,
          configs: JSON.stringify(formData.configs),
          base_url: formData.base_url,
          access_token: formData.access_token,
        }

        // Check if needs confirmation
        if (config.needsConfirmation) {
          Modal.confirm({
            title: t('tip'),
            content: t('module.platform_auth_coze_confirm'),
            okText: t('action_confirm'),
            cancelText: t('action_cancel'),
            onOk: async () => {
              await saveProvider(data, config)
            },
          })
        } else {
          await saveProvider(data, config)
        }
      } catch (error) {
        console.error('Save provider error:', error)
      } finally {
        setLoading(false)
      }
    }

    // Save provider
    const saveProvider = async (data: ProviderCreateRequest, config: PlatformConfig) => {
      let provider_id = originData.provider_id

      if (provider_id) {
        await providersApi.update(provider_id, data)
      } else {
        const result = await providersApi.create(data)
        provider_id = result.provider_id
      }

      // Handle OAuth flow
      if (config.getAuthUrl && provider_id) {
        const auth_url = config.getAuthUrl(formData, coze_auth_url, provider_id)
        handleAuthorization(auth_url, originData.provider_type as ProviderValueType)
      }

      message.success(t('action_save_success'))
      onSuccess()
      close()
    }

    useImperativeHandle(ref, () => ({
      open: openDialog,
      close,
      reset,
    }), [openDialog, close, reset])

    // Initialize when open
    useEffect(() => {
      if (open && data) {
        openDialog({ data: data as ProviderData })
      }
    }, [open, data, openDialog])

    // Move copy icon to copy-hook position (like Vue's nextTick logic)
    useEffect(() => {
      if (isCozeCN && open) {
        const timer = setTimeout(() => {
          const copyHook = document.querySelector('.copy-hook')
          if (copyHook && copyIconRef.current) {
            copyHook.appendChild(copyIconRef.current)
          }
        }, 0)
        return () => clearTimeout(timer)
      }
    }, [isCozeCN, open, guideHtml])

    return (
      <Modal
        open={open}
        title={t('action_authorize') + t(originData.label || '')}
        onCancel={close}
        width={720}
        destroyOnHidden
        mask={{ closable: false }}
        footer={
          <>
            {isCozeCN && (
              <div className="text-center text-sm text-disabled mb-3">
                {t('platform_auth.coze_cn.tip_1')}
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button onClick={close}>
                {t('action_cancel')}
              </Button>
              <Button type="primary" loading={loading} onClick={handleConfirm}>
                {t('action_confirm')}
              </Button>
            </div>
          </>
        }
      >
        <Form form={form} layout="vertical">
          {/* Guide info */}
          <div className="w-full flex flex-col gap-3 bg-[#F6F9FC] p-5 mb-4 box-border text-sm text-secondary">
            <div
              className="whitespace-pre-wrap leading-7"
              dangerouslySetInnerHTML={{ __html: guideHtml }}
            />
            {isCozeCN && (
              <span
                ref={copyIconRef}
                className="cursor-pointer ml-1 text-secondary hover:text-brand"
                onClick={() => handleCopy(coze_auth_url)}
              >
                <CopyOutlined style={{ fontSize: 14 }} />
              </span>
            )}
          </div>

          {/* Name field */}
          <Form.Item
            name="name"
            label={t('module.website_info_name')}
            rules={[{ required: true, message: t('module.website_info_name_placeholder') }]}
          >
            <Input
              placeholder={t('module.website_info_name_placeholder')}
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            />
          </Form.Item>

          {/* Dynamic schema fields */}
          {schemaOptions.map((option) => (
            <Form.Item
              key={option.prop}
              label={option.label}
              rules={[{ required: true, message: option.placeholder }]}
            >
              <Input
                placeholder={option.placeholder}
                value={getFormValue(option.prop)}
                onChange={(e) => setFormValue(option.prop, e.target.value)}
              />
            </Form.Item>
          ))}
        </Form>
      </Modal>
    )
  }
)

export default ProviderAuthorizeDialog
