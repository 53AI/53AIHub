import { SvgIcon } from '@km/shared-components-react'
import { getBlockColor, getBlockIcon } from '../../components/preview/BlockDecorations'

/**
 * 认知条目图标：传入 `name` 时用本地 sprite 图标（保持原色），并用 `iconBg` 作底色；
 * 否则沿用远程 PNG + drop-shadow 染色（认知抽屉/领域区），底色用 palette 浅色。
 */
export function RegistryIcon({ name, iconBg, index = 0 }: { name?: string; iconBg?: string; index?: number }) {
  const colors = getBlockColor(index)
  return (
    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg" style={{ backgroundColor: iconBg || colors.light }}>
      {name ? (
        <SvgIcon name={name} size={16} />
      ) : (
        <img
          className="size-4 object-cover -translate-y-[60px]"
          style={{ filter: `drop-shadow(${colors.dark} 0 60px)` }}
          src={getBlockIcon(index)}
          alt=""
        />
      )}
    </span>
  )
}