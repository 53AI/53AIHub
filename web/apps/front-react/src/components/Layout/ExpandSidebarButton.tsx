import { Tooltip } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { useSidebar } from "@/contexts/SidebarContext";
import { t } from "@/locales";

export function ExpandSidebarButton() {
  const { showSider, siderVisible, isMobile, handleToggle } = useSidebar();

  // 只有在侧边栏收起且不是移动端时才显示
  if (showSider) {
    return null;
  }

  return (
    <Tooltip title={t("chat.expand_side_bar")}>
      <div
        className="flex-none size-7 rounded-md flex-center cursor-pointer hover:bg-[#ECEDEE]"
        onClick={handleToggle}
      >
        <SvgIcon name="left-bar" />
      </div>
    </Tooltip>
  );
}

export default ExpandSidebarButton;
