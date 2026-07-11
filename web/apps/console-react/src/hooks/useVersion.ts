import { useCallback, useMemo } from 'react'
import { checkVersion, checkVersionPermission } from '@/utils/version'
import type { VersionOptions } from '@/utils/version'
import { useEnterpriseStore } from '@/stores'

export interface UseVersionOptions extends Omit<VersionOptions, 'mode'> {
  /** 默认 dialog，仅在调用 guard 时生效 */
  mode?: VersionOptions['mode']
}

export interface UseVersionReturn {
  /** 仅检查版本，不弹窗 */
  canUse: boolean
  /** 检查版本 + 弹窗/tooltip 提示，返回是否通过。用于 onClick */
  guard: (e?: React.MouseEvent) => boolean
}

export function useVersion(options: UseVersionOptions): UseVersionReturn {
  const { module, count } = options

  // 订阅 version.features 变化，确保 store 更新时触发重新渲染
  const features = useEnterpriseStore((state) => state.version.features)

  const canUse = useMemo(() => checkVersion(module, count), [module, count, features])

  const guard = useCallback(
    (e?: React.MouseEvent) => {
      if (!checkVersionPermission(options)) {
        e?.stopPropagation()
        e?.preventDefault()
        return false
      }
      return true
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [module, count, options.content, options.mode, options.onClick],
  )

  return { canUse, guard }
}
