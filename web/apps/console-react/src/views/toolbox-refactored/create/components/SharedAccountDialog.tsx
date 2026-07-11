import { memo, useCallback, useMemo } from 'react'

import { Form, Input, Modal, message } from 'antd'

import { t } from '@/locales'

// ============================================================================
// Types
// ============================================================================

/** 共享账号项 */
export interface SharedAccountItem {
  /** 账号 */
  account: string
  /** 密码 */
  password: string
  /** 备注 */
  remark?: string
}

/** Props */
export interface SharedAccountDialogProps {
  /** 是否打开 */
  open: boolean
  /** 已有账号列表（用于去重校验） */
  accountList?: SharedAccountItem[]
  /** 初始值（编辑模式） */
  initialValues?: SharedAccountItem | null
  /** 取消回调 */
  onCancel: () => void
  /** 提交回调 */
  onSubmit: (values: SharedAccountItem) => void
}

// ============================================================================
// Helpers
// ============================================================================

/** 检查账号是否已存在 */
function checkAccountExists(
  account: string,
  accountList: SharedAccountItem[],
  excludeAccount?: string,
): boolean {
  return accountList.some(
    (item) => item.account === account && item.account !== excludeAccount,
  )
}

// ============================================================================
// Component
// ============================================================================

function SharedAccountDialogInternal({
  open,
  accountList = [],
  initialValues,
  onCancel,
  onSubmit,
}: SharedAccountDialogProps) {
  const [form] = Form.useForm<SharedAccountItem>()
  const isEdit = !!initialValues?.account

  // 账号校验规则
  const accountRules = useMemo(() => {
    return [
      { required: true, message: t('form_input_placeholder') },
      {
        validator: (_: unknown, value: string) => {
          if (!isEdit && value && checkAccountExists(value, accountList)) {
            return Promise.reject(new Error(t('form_account_exit')))
          }
          return Promise.resolve()
        },
      },
    ]
  }, [isEdit, accountList])

  // 处理确认
  const handleOk = useCallback(async () => {
    try {
      const values = await form.validateFields()
      message.success(isEdit ? t('action_save_success') : t('action_add_success'))
      form.resetFields()
      onSubmit(values)
    } catch {
      // 表单校验失败，Ant Design 已自动显示错误信息
    }
  }, [form, isEdit, onSubmit])

  // 处理取消
  const handleCancel = useCallback(() => {
    form.resetFields()
    onCancel()
  }, [form, onCancel])

  // 打开时重置表单
  const formInitialValues = useMemo(
    () =>
      initialValues || {
        account: '',
        password: '',
        remark: '',
      },
    [initialValues],
  )

  return (
    <Modal
      title={isEdit ? t('action_edit') : t('action_add')}
      open={open}
      onCancel={handleCancel}
      onOk={handleOk}
      destroyOnHidden
      width={600}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={formInitialValues}
        key={initialValues?.account || 'new'}
      >
        <Form.Item label={t('account')} name="account" rules={accountRules}>
          <Input placeholder={t('form_input_placeholder')} />
        </Form.Item>
        <Form.Item
          label={t('password')}
          name="password"
          rules={[{ required: true, message: t('form_input_placeholder') }]}
        >
          <Input placeholder={t('form_input_placeholder')} />
        </Form.Item>
        <Form.Item label={t('remark')} name="remark">
          <Input.TextArea
            rows={3}
            resize="none"
            maxLength={200}
            showCount
            placeholder={t('form_input_placeholder')}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

SharedAccountDialogInternal.displayName = 'SharedAccountDialogInternal'

export const SharedAccountDialog = memo(SharedAccountDialogInternal)

export default SharedAccountDialog
