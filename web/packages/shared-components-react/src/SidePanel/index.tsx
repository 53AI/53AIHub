import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

export type SidePanelSide = 'left' | 'right'

/** 视口宽度低于该值时自动启用悬浮模式（与应用移动端断点 md=768 保持一致） */
const MOBILE_BREAKPOINT = 768

/** 监听视口宽度是否小于指定断点 */
function useViewportUnder(breakpoint: number): boolean {
	const [under, setUnder] = useState(() =>
		typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
	)

	useEffect(() => {
		const handleResize = () => setUnder(window.innerWidth < breakpoint)
		window.addEventListener('resize', handleResize)
		return () => window.removeEventListener('resize', handleResize)
	}, [breakpoint])

	return under
}

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
	/** 悬浮模式开关，默认 true：移动端（视口 < 768）面板自动悬浮于内容之上，
	 *  宽度不超过视口，调用方无需逐处传参；不需要悬浮的地方单独传 overlay={false} */
	overlay?: boolean
	/** 关闭回调：悬浮模式下点击遮罩触发（仅悬浮模式生效）。
	 * 无论是否传入，悬浮模式打开时都会渲染全屏遮罩（遮挡底层交互入口，
	 * 如 ResponsiveSidebar 的移动端切换按钮，避免多个浮层同时打开） */
	onClose?: () => void
	/** 透传到外层 wrapper 的 data-testid */
	'data-testid'?: string
	children: ReactNode
}

/**
 * 从屏幕左侧或右侧平滑滑入的侧栏容器。
 *
 * 通过 `width: 0 ↔ width` 的过渡实现「拉抽屉」效果；
 * 内部内容用绝对定位 + 固定宽度渲染，避免宽度过渡过程中触发 reflow 而抖动。
 *
 * 悬浮模式默认开启（overlay 默认 true）：移动端（视口 < 768）自动切换为 fixed 悬浮，
 * 宽度不超过视口；打开时始终渲染全屏遮罩（遮挡底层内容与交互入口），
 * 传入 onClose 后点击遮罩可关闭。不需要悬浮的地方传 overlay={false}。
 */
const SidePanel: React.FC<SidePanelProps> = ({
	open,
	side,
	width,
	duration = 300,
	className = '',
	overlay = true,
	onClose,
	'data-testid': dataTestid,
	children,
}) => {
	const widthValue = typeof width === 'number' ? `${width}px` : width

	// 悬浮开关默认开启，仅在移动端视口下生效；显式传 false 可关闭
	const isMobileViewport = useViewportUnder(MOBILE_BREAKPOINT)
	const useOverlay = overlay && isMobileViewport

	// 悬浮模式：fixed 定位悬浮在内容之上，宽度不超过视口（移动端使用）
	if (useOverlay) {
		return (
			<>
				{open && (
					<div className="fixed inset-0 z-[200] bg-black/45" onClick={onClose} />
				)}
				<div
					className={`fixed inset-y-0 ${side === 'right' ? 'right-0' : 'left-0'} z-[201] overflow-hidden transition-[width] ease-out ${open ? 'shadow-2xl' : ''} ${className}`}
					style={{
						width: open ? widthValue : 0,
						maxWidth: '100vw',
						transitionDuration: `${duration}ms`,
					}}
					aria-hidden={!open}
					data-testid={dataTestid}
				>
					<div
						className={`absolute inset-y-0 ${side === 'right' ? 'left-0' : 'right-0'}`}
						style={{ width: widthValue, maxWidth: '100vw' }}
					>
						{open ? children : null}
					</div>
				</div>
			</>
		)
	}

	// 内嵌模式：占据布局流的侧栏
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