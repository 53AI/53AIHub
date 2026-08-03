import { Tooltip } from "antd";
import { getPublicPath } from "@/utils/config";

export const AI_ICON_URL = getPublicPath("/images/library/ai.png");
export const MAP_ICON_URL = getPublicPath("/images/library/map.png");

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
        <img
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