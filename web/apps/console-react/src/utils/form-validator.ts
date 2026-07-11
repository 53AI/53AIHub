/**
 * 表单字段验证工具（React 通用）
 * @param formRef 支持 validateFields 的表单实例（如 Ant Design Form 的 form）
 * @param field 要验证的字段名
 * @returns 验证是否通过
 */
export async function validateFormField(
  formRef: { validateFields: (fields?: unknown) => Promise<unknown> } | null | undefined,
  field: string,
): Promise<boolean> {
  if (!formRef || typeof formRef.validateFields !== 'function') return false
  try {
    await formRef.validateFields([field])
    return true
  } catch {
    return false
  }
}

export function validateEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return re.test(email)
}

export function validateMobile(mobile: string): boolean {
  const re = /^1[3-9]\d{9}$/
  return re.test(mobile)
}
