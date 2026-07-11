import { Skeleton } from "antd";
import { Outlet } from "react-router-dom";
import { SiderMenu } from "./Sider";
import { useEnterpriseStore } from "@/stores";

// 骨架屏组件 - 优化感知性能
const ContentSkeleton = () => (
  <div className="flex-1 h-full bg-white p-6">
    <Skeleton active paragraph={{ rows: 6 }} />
  </div>
);

export function LayoutShell() {
  const enterpriseStore = useEnterpriseStore();
  const enterpriseReady = Boolean(enterpriseStore.info.eid);

  return (
    <div
      className="w-full h-full overflow-hidden flex"
      style={{ background: "#F6F7F8" }}
    >
      <SiderMenu />
      <div className="flex-1 h-full overflow-auto bg-white">
        {enterpriseReady ? <Outlet /> : <ContentSkeleton />}
      </div>
    </div>
  );
}
