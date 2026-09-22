/**
 * matcher.value 在接口定义里是 string | string[]（见 api/modules/rag-strategy/types.ts），
 * 但后端实际返回可能是别的类型。这里统一判定是否填有有效值，
 * 避免上层直接调用 .trim() 抛 TypeError。
 */
export function hasMatcherValue(matcher: { value?: unknown }): boolean {
  const { value } = matcher
  if (Array.isArray(value)) {
    return value.some((item) => typeof item === 'string' && item.trim() !== '')
  }
  return typeof value === 'string' && value.trim() !== ''
}
