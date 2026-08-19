import type { CSSProperties, ReactNode } from 'react'

export type SidePanelSide = 'left' | 'right'

export interface SidePanelProps {
	open: boolean
	/** 面板所在侧。
	 *  - "right": 面板在右侧，内层 `left-0` 锚定 → 视觉效果：左→右渐显
	 *  - "left":  面板在左侧，内层 `right-0` 锚定 → 视觉效果：右→左渐显
	 */
	side: SidePanelSide
	/** 展开后的宽度（像素数值或 CSS 字符串，如 450 / "450px"） */
	width: number | string
	/** 过渡时长（毫秒），默认 300 */
	duration?: number
	className?: string
	/** 透传到外层 wrapper 的 data-testid */
	'data-testid'?: string
	children: ReactNode
}

/**
 * 从屏幕左侧或右侧平滑滑入的侧栏容器。
 *
 * 通过 `width: 0 ↔ width` 的过渡实现「拉抽屉」效果；
 * 内部内容用绝对定位 + 固定宽度渲染，避免宽度过渡过程中触发 reflow 而抖动。
 */
const SidePanel: React.FC<SidePanelProps> = ({
	open,
	side,
	width,
	duration = 300,
	className = '',
	'data-testid': dataTestid,
	children,
}) => {
	const widthValue = typeof width === 'number' ? `${width}px` : width

	const wrapperStyle: CSSProperties = {
		width: open ? widthValue : 0,
		transitionDuration: `${duration}ms`,
	}

	const innerStyle: CSSProperties = {
		width: widthValue,
	}

	return (
		<div
			className={`flex-none relative h-full overflow-hidden transition-[width] ease-out ${className}`}
			style={wrapperStyle}
			aria-hidden={!open}
			data-testid={dataTestid}
		>
			<div
				className={`absolute inset-y-0 ${side === 'right' ? 'left-0' : 'right-0'}`}
				style={innerStyle}
			>
				{open ? children : null}
			</div>
		</div>
	)
}

export default SidePanel