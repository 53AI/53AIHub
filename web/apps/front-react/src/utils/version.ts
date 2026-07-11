import { useEnterpriseStore } from '@/stores/modules/enterprise'

/**
 * 检查版本权限
 * @param module 模块
 * @param count 数量
 * @returns boolean 是否满足版本要求
 */
export const checkVersion = (module: string, count?: number) => {
  const enterpriseStore = useEnterpriseStore.getState()
  const features = enterpriseStore.features
  if (module in features) {
    const feature = features[module]
    // 功能禁用
    if (feature.max === 0) return false
    return feature.max > (count || 0)
  }
  return true
}
