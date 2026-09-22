import { providers } from './config'

// 提供商类型，针对于 平台接入
export const PROVIDER_VALUE = Object.fromEntries(
  Object.entries(providers).map(([id, provider]) => [provider.name.toUpperCase(), Number(id)]),
)

export type ProviderValueType = (typeof PROVIDER_VALUE)[keyof typeof PROVIDER_VALUE]
