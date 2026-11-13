import { Tooltip } from "antd";
import { SafeImage } from "@km/shared-components-react";

export const AI_ICON_URL = "/images/library/ai.png";
export const MAP_ICON_URL = "/images/library/map.png";

export type SidebarIconSize = "default" | "small";

const IMG_SIZE_CLASS: Record<SidebarIconSize, string> = {
  default: "size-6",
  small: "size-5",
};

interface SidebarAppItemProps {
  icon: string;
  title: string;
  active: boolean;
  iconSize?: SidebarIconSize;
  onClick: () => void;
}

export function SidebarAppItem({
  icon,
  title,
  active,
  iconSize = "default",
  onClick,
}: SidebarAppItemProps) {
  return (
    <Tooltip placement="left" title={title}>
      <div
        role="button"
        aria-label={title}
        className={`size-[38px] flex-center rounded-md cursor-pointer hover:shadow-[0_2px_8px_#0b1b403d] ${active ? "bg-[#E6EEFF]" : ""}`}
        onClick={onClick}
      >
        <SafeImage
          className={IMG_SIZE_CLASS[iconSize]}
          style={active ? {} : { filter: "grayscale(100%) opacity(0.5)" }}
          src={icon}
          alt=""
        />
      </div>
    </Tooltip>
  );
}

export default SidebarAppItem;