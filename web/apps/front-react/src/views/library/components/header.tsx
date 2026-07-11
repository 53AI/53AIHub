import { ReactNode } from "react";
import { Tooltip } from "antd";
import { LeftOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useLibraryStore } from "@/stores/modules/library";
import { SvgIcon } from "@km/shared-components-react";
import "./header.css";

interface LibraryHeaderProps {
  showHeaderWhenSideHide?: boolean;
  showSiderButton?: boolean;
  showBack?: boolean;
  backProxy?: () => void;
  header?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

export function LibraryHeader({
  showHeaderWhenSideHide = false,
  showSiderButton = true,
  showBack = false,
  backProxy,
  header,
  footer,
  children,
}: LibraryHeaderProps) {
  const navigate = useNavigate();
  const libraryStore = useLibraryStore();

  const handleBack = () => {
    if (backProxy) {
      backProxy();
    } else {
      navigate(-1);
    }
  };

  if (showHeaderWhenSideHide ? !libraryStore.siderVisible : true) {
    return (
      <div className="flex-none h-[68px] px-5 flex items-center gap-2 border-b bg-white relative">
        {!libraryStore.siderVisible && showSiderButton && (
          <>
            <Tooltip title="展开">
              <div
                className="size-5 flex items-center justify-center cursor-pointer"
                onClick={() => libraryStore.toggleSider()}
              >
                <SvgIcon name="double-right" />
              </div>
            </Tooltip>
            <div className="h-4 border-l mx-2" />
          </>
        )}
        {showBack && (
          <div
            className="size-5 flex items-center justify-center cursor-pointer"
            onClick={handleBack}
          >
            <LeftOutlined className="size-5 cursor-pointer" />
          </div>
        )}
        {header}
        <div className="flex-1 flex items-center overflow-hidden">
          {children}
        </div>
        {footer}
      </div>
    );
  }

  return null;
}

export default LibraryHeader;
