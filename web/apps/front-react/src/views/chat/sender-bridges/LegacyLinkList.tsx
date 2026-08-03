/**
 * LegacyLinkList — 复刻 legacy Sender 的 linkList 视觉与交互。
 *
 * 来源:apps/front-react/src/components/Chat/Sender.tsx line 2284-2310
 *
 * 差异点(对齐):
 *   - chip 背景:#F3F3F5(text-[#6B6C70]),新 Sender 默认是 #E1E8FF / #1B3F94
 *   - chip 高度:h-6 (24px),padding: px-1.5,border-radius: rounded(4px)
 *   - 容器:flex items-center gap-2 flex-wrap overflow-x-auto overflow-y-hidden mb-1.5
 *   - 删除按钮:hover 显示,rounded-full + bg-white + size-4
 */
import { LinkChip } from "./LinkChip";
import type { LinkListSlotProps, MentionLinkItem } from "@km/hub-ui-x-react";

export type LegacyLinkListProps = LinkListSlotProps & {
  className?: string;
};

export function LegacyLinkList({ links = [], onRemove, collapsed, onToggleCollapse, className = "" }: LegacyLinkListProps) {
  return (
    <div
      className={`flex items-center gap-2 flex-wrap overflow-x-auto overflow-y-hidden mb-1.5 ${className}`}
      style={{ maxHeight: collapsed ? 28 : undefined }}
    >
      {links.map((link: MentionLinkItem) => (
        <LinkChip
          key={link.id}
          icon={link.icon ? <img src={link.icon} className="size-4" alt="" /> : null}
          name={link.name}
          onRemove={() => onRemove(link)}
        />
      ))}
    </div>
  );
}

export default LegacyLinkList;