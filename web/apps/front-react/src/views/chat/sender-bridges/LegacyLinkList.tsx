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
import { CloseOutlined } from "@ant-design/icons";
import { OverflowTooltip } from "@km/shared-components-react";
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
        <div
          key={link.id}
          className="h-6 max-w-[200px] overflow-hidden px-1.5 rounded bg-[#F3F3F5] flex items-center text-sm text-[#6B6C70] group cursor-pointer relative"
        >
          <div className="flex-none size-4 rounded mr-1 overflow-hidden">
            {link.icon ? <img src={link.icon} className="size-4" alt="" /> : null}
          </div>
          <OverflowTooltip>
            <span className="truncate">{link.name}</span>
          </OverflowTooltip>
          <div
            className="group-hover:flex hidden absolute top-1/2 right-0 -translate-y-1/2 size-4 border rounded-full bg-white items-center justify-center"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onRemove(link);
            }}
          >
            <CloseOutlined style={{ fontSize: 10, color: "#B8B8B8" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default LegacyLinkList;
