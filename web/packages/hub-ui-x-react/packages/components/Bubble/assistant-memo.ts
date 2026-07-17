/**
 * BubbleAssistant 的 memo 比较函数。
 *
 * 设计：父组件（AssistantMessage / 应用层）应当通过 `useMemo` 把
 * header / footer / menu / error 这几个 React 元素 prop 引用稳定化——
 * 数据未变时返回同一个 React 元素，数据变了才生成新元素。
 *
 * memo 同时比较：
 * - 真正影响渲染输出的标量 props（content / streaming / reasoning / showError /
 *   alwaysShowMenu）
 * - 引用稳定的 suggestions 数组
 * - header / footer / menu / error 这四个 React 元素的引用
 *
 * 为什么必须比较 React 元素引用：流式阶段父组件可能仅 message.process_records
 * 更新（content 未变），如果 memo 跳过渲染，header 包裹的 ProcessFlowHeader
 * 就会停留在旧的 processRecords 数据，必须等 streaming 翻转为 false
 * 才会一次性渲染所有步骤（"流式结束后才正常渲染"的 bug 根因）。
 */
import type { BubbleAssistantProps } from "./assistant";

export function shouldBubbleAssistantSkipRender(
  prev: BubbleAssistantProps,
  next: BubbleAssistantProps,
): boolean {
  // suggestions: 父组件经常传默认空数组（`suggestions ?? []`），每次都是新引用。
  // 当两侧都为空时视为相等，避免 memo 在父组件频繁重渲染时失效。
  const suggestionsEqual =
    prev.suggestions === next.suggestions ||
    (prev.suggestions.length === 0 && next.suggestions.length === 0);

  return (
    prev.content === next.content &&
    prev.streaming === next.streaming &&
    prev.reasoning === next.reasoning &&
    prev.showError === next.showError &&
    prev.alwaysShowMenu === next.alwaysShowMenu &&
    suggestionsEqual &&
    prev.header === next.header &&
    prev.footer === next.footer &&
    prev.menu === next.menu &&
    prev.error === next.error
  );
}