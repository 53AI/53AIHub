import type { RawProviderItem, ProviderItem } from './types'
import { getPublicPath } from '@/utils/config'

function getProviderMeta(provider_type: number): { icon: string; label: string } {
  // React 侧暂未全量迁移 console 的 platform/config，这里先给最小可用映射，保证字段 shape 一致
  const map: Record<number, { icon: string; label: string }> = {
    1: { icon: 'coze_cn', label: 'coze_cn' },
    3: { icon: 'app_builder', label: 'app_builder' },
    4: { icon: '53ai', label: '53ai' },
    5: { icon: 'coze_osv', label: 'coze_osv' },
    1001: { icon: 'dify', label: 'dify' },
    1003: { icon: 'bailian', label: 'bailian' },
    1004: { icon: 'volcengine', label: 'volcengine' },
    1006: { icon: 'yuanqi', label: 'yuanqi' },
  }
  return map[provider_type] || { icon: 'default', label: String(provider_type) }
}

export const transformProviderItem = (item: RawProviderItem): ProviderItem => {
  const provider = getProviderMeta(item.provider_type)
  const providerIconUrl = `/images/platform/${provider.icon}.png`
  return {
    ...item,
    provider_icon: getPublicPath(providerIconUrl),
    provider_label: provider.label,
    configs: typeof item.configs === 'string' ? JSON.parse(item.configs) : (item.configs as any) || {},
  }
}

export const transformProviderList = (list: RawProviderItem[]): ProviderItem[] => {
  return list.map(transformProviderItem)
}

