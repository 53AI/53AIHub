import type { ReactNode } from "react";
import { SafeImage } from "@km/shared-components-react";

/**
 * 气泡头像（`x-bubble__avatar` / `x-assistant-bubble__avatar`）的统一渲染。
 *
 * WHY：`@km/hub-ui-x-react` 是独立发布的 UI 库（不依赖任何 `@km` 包），
 * 所以不能在里面直接引 `SafeImage`。气泡组件提供了 `avatarSlot` 插槽，
 * 业务侧（本包）用本函数传进去，头像因此和全站其它图片一样享受
 * 「离屏探针 + 有界重试 + 兜底图」，而不是裸 `<img>` 的裂图。
 *
 * 尺寸由气泡自己的 CSS 决定（容器 36×36、`overflow: hidden`），因此
 * `className` 只负责「铺满 + 裁切」，占位/兜底各分支尺寸一致、不跳动。
 */
export function bubbleAvatarSlot(src?: string): ReactNode {
  if (!src) return undefined;
  return <SafeImage src={src} alt="" className="w-full h-full object-cover" />;
}
