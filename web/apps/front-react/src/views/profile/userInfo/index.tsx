import { useEffect, lazy, Suspense } from "react";
import { Spin, message } from "antd";
import { useUserStore } from "@/stores/modules/user";
import { useEnterpriseStore } from "@/stores/modules/enterprise";
import { t } from "@/locales";
import "../profile.css";

// 懒加载大型组件 UserInfo
const UserInfo = lazy(() => import("../components/userinfo"));

export function ProfileView() {
  const enterpriseStore = useEnterpriseStore();
  const userStore = useUserStore();

  const handleLogout = () => {
    userStore.logout();
    message.success(t("status.logout_success"));
  };

  useEffect(() => {
    enterpriseStore.loadInfo();
  }, []);

  return (
    <div className="flex flex-col h-full py-[26px] px-[30px] overflow-y-auto">
      <h2 className="text-xl font-medium text-[#1D1E1F] mb-6">
        {t("profile.user_info")}
      </h2>
      {/* 内容区域 */}
      <div className="flex-1 w-full lg:w-3/5 max-w-[600px] mx-auto">
        <Suspense
          fallback={
            <div className="flex justify-center py-8">
              <Spin />
            </div>
          }
        >
          <UserInfo />
        </Suspense>

        <div
          className="h-11 mt-8 flex items-center justify-center bg-[#F8F8F9] gap-2 px-6 mb-2 rounded text-[#F84E55] cursor-pointer"
          onClick={handleLogout}
        >
          <span className="text-sm">{t("action.logout")}</span>
        </div>
      </div>
    </div>
  );
}

export default ProfileView;