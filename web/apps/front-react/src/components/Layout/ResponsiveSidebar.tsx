import { ReactNode, useCallback, useEffect, useState } from "react";
import { SvgIcon } from "@km/shared-components-react";
import { useResponsive } from "@/hooks/useResponsive";

export interface ResponsiveSidebarContextValue {
  /** 移动端选择完内容后调用，用于关闭侧边栏（桌面端调用无副作用） */
  close: () => void;
}

interface ResponsiveSidebarProps {
  /**
   * 侧边栏内容。传入函数时会把 close 作为参数下发，
   * 供列表项点击后自动收起（移动端）。
   */
  children: ReactNode | ((ctx: ResponsiveSidebarContextValue) => ReactNode);
  /** 桌面端侧边栏宽度，默认 280px，同时作为移动端抽屉宽度 */
  width?: number;
  /** 附加到侧边栏容器上的 className（背景色、边框等） */
  className?: string;
}

/**
 * 通用侧边栏容器：
 * - 桌面端：正常参与 flex 布局，固定宽度
 * - 移动端（<768px）：抽屉化，默认隐藏，由左侧边缘中间的切换按钮触发覆盖式滑出
 */
export function ResponsiveSidebar({
  children,
  width = 280,
  className = "",
}: ResponsiveSidebarProps) {
  const { isMobile } = useResponsive();
  const [open, setOpen] = useState(false);

  // 移动端抽屉宽度不超过视口的 85%，避免桌面端拖宽（如 480px）后在手机上溢出屏幕
  const effectiveWidth =
    isMobile && typeof window !== "undefined"
      ? Math.min(width, Math.floor(window.innerWidth * 0.85))
      : width;

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  // 切回桌面端时复位，避免残留移动端覆盖态
  useEffect(() => {
    if (!isMobile) setOpen(false);
  }, [isMobile]);

  const ctx: ResponsiveSidebarContextValue = { close };

  // overflow-y-auto：矮视口（横屏手机/矮窗口）下固定内容超出抽屉高度时，
  // 整体可滚动而不是被外层 overflow-hidden 裁切（否则底部块不可见也滚不到）
  const sidebarClassName = [
    "h-full shrink-0 flex flex-col overflow-y-auto",
    className,
    "md:translate-x-0",
    "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-[100] max-md:shadow-2xl",
    "max-md:transition-transform max-md:duration-300 max-md:ease-in-out",
    open ? "max-md:translate-x-0" : "max-md:-translate-x-full",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      {/* 侧边栏容器 */}
      <aside className={sidebarClassName} style={{ width: effectiveWidth }}>
        {typeof children === "function" ? children(ctx) : children}
      </aside>

      {/* 移动端遮罩 */}
      {isMobile && open && (
        <div
          className="md:hidden fixed inset-0 z-[90] bg-black/40 animate-overlay-in"
          onClick={close}
        />
      )}

      {/* 移动端左侧中间切换按钮 */}
      <button
        type="button"
        className="md:hidden fixed top-1/2 -translate-y-1/2 z-[110] flex items-center justify-center h-12 w-6 rounded-r-lg bg-white border border-l-0 border-[#E5E7EB] shadow-md transition-all duration-300"
        style={{ left: open ? effectiveWidth : 0 }}
        onClick={toggle}
        aria-label={open ? "关闭侧边栏" : "打开侧边栏"}
      >
        <SvgIcon name={open ? "arrow-left" : "arrow-right"} size={14} color="#6B7280" />
      </button>
    </>
  );
}

export default ResponsiveSidebar;
