/**
 * 录音洞察页面通用装饰组件
 *
 * 共享 BlockTitle（图标+标题）和 ContentWithLine（左侧竖线）组件，
 * 以及图标/颜色常量和辅助函数。
 */
import { img_host } from '@/utils/config';

// ============= 图标 + 颜色 =============

/** 与 SetIcon 一致的图标列表（icon1.png ~ icon34.png） */
const ICON_LIST: string[] = Array.from({ length: 34 }, (_, i) => `${img_host}/icon/icon${i + 1}.png`)

/** 随机颜色调色板（dark 用于图标/竖线，light 用于图标底色） */
const COLOR_PALETTE: { dark: string; light: string }[] = [
  { dark: '#2563EB', light: '#2563EB1A' },
  { dark: '#16A34A', light: '#16A34A1A' },
  { dark: '#D97706', light: '#D977061A' },
  { dark: '#EF4444', light: '#EF44441A' },
  { dark: '#7C3AED', light: '#7C3AED1A' },
  { dark: '#0891B2', light: '#0891B21A' },
  { dark: '#4F46E5', light: '#4F46E51A' },
  { dark: '#06B6D4', light: '#06B6D41A' },
  { dark: '#E11D48', light: '#E11D481A' },
  { dark: '#CA8A04', light: '#CA8A041A' },
]

/** 根据 block index 确定性选取图标 */
export function getBlockIcon(index: number): string {
  return ICON_LIST[index % ICON_LIST.length]
}

/** 根据 block index 确定性选取颜色（图标底色 + 竖线共用同一颜色） */
export function getBlockColor(index: number): { dark: string; light: string } {
  return COLOR_PALETTE[index % COLOR_PALETTE.length]
}

// ============= 带图标的标题组件 =============

/** 为 block 标题添加左侧图标（图标底色 + drop-shadow 染色，颜色与竖线一致） */
export function BlockTitle({ title, blockIndex, className }: { title: string; blockIndex: number; className?: string }) {
  const iconSrc = getBlockIcon(blockIndex)
  const colors = getBlockColor(blockIndex)
  return (
    <div className={`flex items-center gap-3 mb-4 ${className || ''}`}>
      <div
        className="size-8 rounded-lg overflow-hidden flex-shrink-0 flex justify-center items-center"
        style={{ backgroundColor: colors.light }}
      >
        <img
          className="size-4 object-cover -translate-y-[60px]"
          style={{ filter: `drop-shadow(${colors.dark} 0 60px)` }}
          src={iconSrc}
          alt=""
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none'
          }}
        />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
    </div>
  )
}

// ============= 内容左侧竖线 =============

/** 在内容左侧渲染2px竖线，颜色与图标颜色一致 */
export function ContentWithLine({ blockIndex, showLine = true, children }: { blockIndex: number; showLine?: boolean; children: React.ReactNode }) {
  const color = getBlockColor(blockIndex).dark
  if (!showLine) {
    return <div className="flex-1 min-w-0">{children}</div>
  }
  return (
    <div className="flex gap-3">
      <div className="w-[2px] flex-shrink-0 self-stretch my-2 ml-[15px] mr-6 rounded-full" style={{ backgroundColor: color }} />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}