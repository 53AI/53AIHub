import { useCallback, useState } from 'react';

/** 全屏覆盖样式：与右栏预览一致（固定全屏 + 高层级，覆盖侧栏/抽屉） */
const FULLSCREEN_OVERLAY = 'fixed inset-0 z-[201]';

export interface UseFullscreenOptions {
  /** 初始是否全屏，默认 false */
  initialValue?: boolean;
  /**
   * 全屏时是否附加 bg-white。容器本身已有白色背景时传 false，
   * 避免背景色叠加。默认 true。
   */
  withBackground?: boolean;
}

export interface UseFullscreenReturn {
  /** 当前是否全屏 */
  fullscreen: boolean;
  /** 切换全屏状态 */
  toggle: () => void;
  /** 显式设置全屏状态 */
  setFullscreen: (value: boolean) => void;
  /**
   * 把基础 className 与全屏覆盖样式拼接：全屏时在末尾追加
   * `fixed inset-0 z-[201] [bg-white]`，非全屏时原样返回 base。
   *
   * @example
   * const { fullscreen, toggle, composeClassName } = useFullscreen()
   * <div className={composeClassName('flex-1 overflow-hidden')}>
   *   <button onClick={toggle}>切换全屏</button>
   * </div>
   */
  composeClassName: (base: string) => string;
}

/**
 * 全屏状态管理 hook。
 *
 * 把「布尔状态 + 切换 + 覆盖层 className 拼接」封装在一起，
 * 方便多个右栏预览（Wiki 详情 / 安心录预览 / ...）共用同一套全屏行为。
 */
export function useFullscreen(options: UseFullscreenOptions = {}): UseFullscreenReturn {
  const { initialValue = false, withBackground = true } = options;
  const [fullscreen, setFullscreenState] = useState(initialValue);

  const toggle = useCallback(() => {
    setFullscreenState((v) => !v);
  }, []);

  const setFullscreen = useCallback((value: boolean) => {
    setFullscreenState(value);
  }, []);

  const composeClassName = useCallback(
    (base: string) => {
      if (!fullscreen) return base;
      const overlay = withBackground
        ? `${FULLSCREEN_OVERLAY} bg-white`
        : FULLSCREEN_OVERLAY;
      return base ? `${base} ${overlay}` : overlay;
    },
    [fullscreen, withBackground],
  );

  return { fullscreen, toggle, setFullscreen, composeClassName };
}

export default useFullscreen;
