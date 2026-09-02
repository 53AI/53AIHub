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
  /**
   * 正在编辑的设备（null = 新增模式）
   * - 新增：title "设备接入"，apiKey 必填，保存 → createDevice
   * - 编辑：title "编辑设备"，apiKey 留空 = 不修改，保存 → updateDeviceById
   */
  editingDevice?: RecordingDeviceConfig | null
  onOk: () => void
  onCancel: () => void
}

/**
 * 设备接入 / 编辑弹窗。
 *
 * 用自定义 BrandPicker 替代原生 Radio.Button，但通过
 * `valuePropName="value"` + `trigger="onChange"` 接驳 antd Form，
 * 让上层表单能正常拿到 brand 字符串。
 *
 * 编辑模式下 brand 字段 disabled（spec 允许改 type，但多 key 场景下用户改 type
 * 容易混淆，本期先不允许）。
 */
export function ConnectDeviceModal({
  open,
  loading,
  connectForm,
  editingDevice,
  onOk,
  onCancel,
}: ConnectDeviceModalProps) {
  const isEdit = !!editingDevice
  const hasExistingKey = !!editingDevice?.api_key
  return (
    <Modal
      title={isEdit ? '编辑设备' : '设备接入'}
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
        initialValues={{ brand: editingDevice?.device_type ?? SONICNOTE_DEVICE_TYPE }}
      >
        <Form.Item
          name="brand"
          label="品牌"
          valuePropName="value"
          trigger="onChange"
        >
          <BrandPicker
            options={BRAND_OPTIONS.map((o) =>
              isEdit && o.value !== editingDevice?.device_type
                ? { ...o, enabled: false, disabledHint: '编辑模式不允许切换品牌' }
                : o,
            )}
          />
        </Form.Item>
        <Form.Item
          name="apiKey"
          label="API Key"
          rules={[
            {
              // 新增模式必填；编辑模式留空 = 不修改
              required: !isEdit,
              message: '请输入 API Key',
            },
          ]}
          extra={isEdit ? '留空表示不修改；填入新值则覆盖' : ''}
        >
          <Input
            placeholder={hasExistingKey ? '保持原值请留空' : '请输入 API Key'}
            autoComplete="off"
            disabled={isEdit && !hasExistingKey}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
