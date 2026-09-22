/**
 * 验证码规则回归测试（邮箱 / 手机统一为 ≥4 位数字）
 *
 * 背景：验证码字段同时挂了 required 和位数校验两条规则时，空值会让两条规则都失败，
 * antd 会把两条提示一起渲染出来（"请输入验证码" + "请输入正确的验证码"）。
 * 约定：位数规则放过空值，空值只由 required 负责，保证一个字段一次只有一条提示。
 */
import { Form, Input } from 'antd'
import type { FormInstance } from 'antd'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { t } from '@/locales'

import { useEmail } from './useEmail'
import { useMobile } from './useMobile'

type Kind = 'email' | 'mobile'

const requiredMessage = () => t('form.input_placeholder') + t('form.verify_code')
const formatMessage = () => t('form.verify_code_format')

const formRef: { current: FormInstance | null } = { current: null }

function CodeForm({ kind, value }: { kind: Kind; value: string }) {
  const { emailCodeRule } = useEmail()
  const { codeRule } = useMobile()
  const [form] = Form.useForm()
  formRef.current = form

  return (
    <Form form={form} initialValues={{ code: value }}>
      <Form.Item
        name="code"
        label={t('form.verify_code')}
        rules={[
          { required: true, message: requiredMessage() },
          kind === 'email' ? emailCodeRule : codeRule,
        ]}
      >
        <Input />
      </Form.Item>
    </Form>
  )
}

/** 返回校验产生的提示文案数组（validateFields 的 errorFields[0].errors） */
async function errorsOf(kind: Kind, value: string): Promise<string[]> {
  formRef.current = null
  render(<CodeForm kind={kind} value={value} />)
  const form = formRef.current as FormInstance | null
  if (!form) throw new Error('表单未初始化')

  const result = await form.validateFields().then(
    () => [] as string[],
    (error: { errorFields?: { errors: string[] }[] }) =>
      error.errorFields?.[0]?.errors ?? []
  )
  return result
}

describe('邮箱验证码', () => {
  it('空值只提示一次（required 负责）', async () => {
    await expect(errorsOf('email', '')).resolves.toEqual([requiredMessage()])
  })

  it('少于 4 位时提示格式错误', async () => {
    await expect(errorsOf('email', '123')).resolves.toEqual([formatMessage()])
  })

  it('4 位及以上数字通过', async () => {
    await expect(errorsOf('email', '1234')).resolves.toEqual([])
    await expect(errorsOf('email', '123456')).resolves.toEqual([])
    await expect(errorsOf('email', '1234567')).resolves.toEqual([])
  })
})

describe('手机验证码', () => {
  it('空值只提示一次（required 负责）', async () => {
    await expect(errorsOf('mobile', '')).resolves.toEqual([requiredMessage()])
  })

  it('少于 4 位时提示格式错误', async () => {
    await expect(errorsOf('mobile', '123')).resolves.toEqual([formatMessage()])
  })

  it('4 位及以上数字通过', async () => {
    await expect(errorsOf('mobile', '1234')).resolves.toEqual([])
    await expect(errorsOf('mobile', '123456')).resolves.toEqual([])
  })
})
