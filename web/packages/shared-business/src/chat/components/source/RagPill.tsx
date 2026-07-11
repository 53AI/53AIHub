// packages/shared-business/src/chat/components/source/RagPill.tsx
//
// 5 处字节级重复的 RAG 标签胶囊原子组件。
// 封装 10 个公共 Tailwind 类：h-8 px-2 rounded-lg cursor-pointer bg-[#F4F5F7]
// hover:bg-[#E1E2E3] inline-flex items-center
// 差异（mb-3 vs mt-3、onClick、children）通过 props 透传。

import type { MouseEventHandler, ReactNode } from "react";

export interface RagPillProps {
  /** 标签内部内容 */
  children: ReactNode;
  /** 点击回调（未传则不挂 onClick） */
  onClick?: MouseEventHandler<HTMLElement>;
  /** 额外 className，用于追加 margin 等 */
  className?: string;
  /**
   * 渲染元素类型：
   * - "div"（默认）：纯展示
   * - "button"：交互按钮，自动加 `type="button"` 避免表单提交
   */
  as?: "div" | "button";
  /** 透传测试 id */
  "data-testid"?: string;
}

const RAG_PILL_BASE_CLASS =
  "h-8 px-2 rounded-lg cursor-pointer bg-[#F4F5F7] hover:bg-[#E1E2E3] inline-flex items-center";

export function RagPill({
  children,
  onClick,
  className = "",
  as = "div",
  "data-testid": testId,
}: RagPillProps) {
  const merged = `${RAG_PILL_BASE_CLASS}${className ? ` ${className}` : ""}`.trim();

  if (as === "button") {
    return (
      <button type="button" className={merged} onClick={onClick} data-testid={testId}>
        {children}
      </button>
    );
  }
  return (
    <div className={merged} onClick={onClick} data-testid={testId}>
      {children}
    </div>
  );
}

export default RagPill;
