/**
 * LinkChip — Sender 下方 chip 的视觉与交互原语。
 *
 * 复用方:
 *   - LegacyLinkList(@ 链接列表 chip)
 *   - WikiLinkList(动态知识选中项 chip,空间/页面两种)
 *
 * 与原 inline JSX 完全等价;仅把样式/事件/OverflowTooltip 收敛到一处。
 */
import { CloseOutlined } from "@ant-design/icons";
import { OverflowTooltip } from "@km/shared-components-react";

export interface LinkChipProps {
  icon: React.ReactNode;
  name: React.ReactNode;
  onRemove: () => void;
  className?: string;
}

export function LinkChip({ icon, name, onRemove, className = "" }: LinkChipProps) {
  return (
    <div
      className={`h-6 max-w-[200px] overflow-hidden px-1.5 rounded bg-[#F3F3F5] flex items-center text-sm text-[#6B6C70] group cursor-pointer relative ${className}`}
    >
      <div className="flex-none size-4 rounded mr-1 overflow-hidden">
        {icon}
      </div>
      <OverflowTooltip>
        <span className="truncate">{name}</span>
      </OverflowTooltip>
      <div
        className="group-hover:flex hidden absolute top-1/2 right-0 -translate-y-1/2 size-4 border rounded-full bg-white items-center justify-center"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onRemove();
        }}
      >
        <CloseOutlined style={{ fontSize: 10, color: "#B8B8B8" }} />
      </div>
    </div>
  );
}

export default LinkChip;