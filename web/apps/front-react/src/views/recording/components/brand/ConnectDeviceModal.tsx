import { Form, Input, Modal } from 'antd'
import type { FormInstance } from 'antd'
import type { RecordingDeviceConfig } from '@/api/modules/recording/types'
import { t } from '@/locales'
import { BRAND_OPTIONS, SONICNOTE_DEVICE_TYPE } from '../../constants/brandOptions'
import { BrandPicker } from './BrandPicker'

interface ConnectDeviceModalProps {
  open: boolean
  loading: boolean
  connectForm: FormInstance<{
    brand: RecordingDeviceConfig['device_type']
    apiKey: string
  }>
  sonicnoteDevice: RecordingDeviceConfig | null
  onOk: () => void
  onCancel: () => void
}

/**
 * 设备接入弹窗。
 *
 * 用自定义 BrandPicker 替代原生 Radio.Button，但通过
 * `valuePropName="value"` + `trigger="onChange"` 接驳 antd Form，
 * 让上层表单能正常拿到 brand 字符串。
 *
 * API Key 留空语义：未配置过（无 api_key）时必填；已配置过则留空视为"不修改、保留原值"。
 */
export function ConnectDeviceModal({
  open,
  loading,
  connectForm,
  sonicnoteDevice,
  onOk,
  onCancel,
}: ConnectDeviceModalProps) {
  return (
    <Modal
      title="设备接入"
      width={500}
      open={open}
      onOk={onOk}
      confirmLoading={loading}
      onCancel={onCancel}
      okText={t('action.confirm')}
      cancelText={t('action.cancel')}
    >
      <Form
        form={connectForm}
        layout="horizontal"
        labelCol={{ style: { width: 80, textAlign: 'left' } }}
        colon={false}
        requiredMark={(label, info) => (
          <>
            {label}
            {info.required && <span className="text-red-500 ml-1">*</span>}
          </>
        )}
        initialValues={{ brand: SONICNOTE_DEVICE_TYPE }}
      >
        <Form.Item
          name="brand"
          label="品牌"
          valuePropName="value"
          trigger="onChange"
        >
          <BrandPicker options={BRAND_OPTIONS} />
        </Form.Item>
        <Form.Item
          name="apiKey"
          label="API Key"
          rules={[
            {
              required: !sonicnoteDevice?.api_key,
              message: '请输入 API Key',
            },
          ]}
          extra={
            sonicnoteDevice?.api_key ? '留空表示不修改；填入新值则覆盖' : ''
          }
        >
          <Input
            placeholder={
              sonicnoteDevice?.api_key ? '保持原值请留空' : '请输入 API Key'
            }
            autoComplete="off"
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}