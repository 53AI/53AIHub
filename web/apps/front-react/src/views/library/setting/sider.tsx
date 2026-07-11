import { useMemo } from "react";
import { Menu } from "antd";
import { LeftOutlined } from "@ant-design/icons";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useLibraryStore } from "@/stores/modules/library";
import { VirtualLogo } from "@/components/VirtualLogo";
import { SvgIcon } from "@km/shared-components-react";

const menuItems = [
  { key: "info", label: "基础信息", icon: "clean" },
  { key: "permission", label: "成员与权限", icon: "peoples" },
  { key: "api", label: "开放接口", icon: "api" },
  { type: "divider" },
  { key: "recycle", label: "回收站", icon: "delete-one" },
];

interface SettingSiderProps {
  className?: string;
}

export function SettingSider({ className }: SettingSiderProps) {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
  const libraryStore = useLibraryStore();

  const libraryId = params.id;

  const currentKey = useMemo(() => {
    const parts = location.pathname.split("/");
    return parts[parts.length - 1];
  }, [location.pathname]);

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(`/library/${libraryId}/setting/${key}`, { replace: true });
  };

  const handleBack = () => {
    navigate(`/library/${libraryId}`);
  };

  return (
    <div className={`w-[232px] h-full pt-5 px-4 bg-[#F8F9FA] ${className || ""}`}>
      <div className="h-9 flex items-center gap-1.5">
        <div
          className="flex items-center justify-center size-6 cursor-pointer rounded hover:bg-[#E5E5E5]"
          onClick={handleBack}
        >
          <LeftOutlined />
        </div>
        <div className="size-7">
          <VirtualLogo
            text={libraryStore.library?.name}
            src={libraryStore.library?.icon}
            size={28}
          />
        </div>
        <p className="truncate text-sm">{libraryStore.library?.name}</p>
      </div>

      <h2 className="h-9 flex items-center px-2 mt-5 mb-2.5 text-lg text-[#1D1E1F]">
        知识库设置
      </h2>

      <Menu
        mode="vertical"
        selectedKeys={[currentKey]}
        onClick={handleMenuClick}
        style={{
          border: "none",
          background: "#F6F7F8",
        }}
        items={menuItems.map((item) => {
          if (item.type === "divider") {
            return { key: "divider", type: "divider" as const };
          }
          return {
            key: item.key,
            label: (
              <div className="flex items-center gap-2">
                <SvgIcon name={item.icon || ""} width="18px" />
                <span>{item.label}</span>
              </div>
            ),
          };
        })}
      />
    </div>
  );
}

export default SettingSider;
