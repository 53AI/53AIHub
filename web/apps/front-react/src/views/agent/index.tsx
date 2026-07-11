import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useIsSoftStyle } from "@/stores/modules/enterprise";
import { SvgIcon } from "@km/shared-components-react";
import { Tooltip } from "antd";
import { t } from "@/locales";
import { checkLoginStatus } from "@/utils/permission";
import GroupList from "./components/GroupList";
import MyList from "./components/MyList";
import Header from "@/components/Layout/Header";
import Footer from "@/components/Layout/Footer";

export function AgentPage() {
  const isSoftStyle = useIsSoftStyle();
  const [searchParams, setSearchParams] = useSearchParams();
  const [siderVisible, setSiderVisible] = useState(true);
  const [activeType, setActiveType] = useState<"explore" | "my">("explore");

  const toggleSider = () => {
    setSiderVisible(!siderVisible);
  };


  // 响应 URL 参数变化切换 tab
  useEffect(() => {
    if (searchParams.get("from") === "my") {
      setActiveType("my");
    }
  }, [searchParams]);

  return (
    <div className="size-full flex">
      <div
        className={`w-full flex-1 flex flex-col ${isSoftStyle ? "overflow-y-auto" : ""}`}
      >
        {isSoftStyle && (
          <Header
            back={false}
            title={t("module.agent")}
            border={false}
            beforePrefix={
              !siderVisible && (
                <>
                  <Tooltip title={t("action.expand")}>
                    <div
                      className="size-5 flex-center cursor-pointer"
                      onClick={toggleSider}
                    >
                      <SvgIcon name="double-right" />
                    </div>
                  </Tooltip>
                  <div className="h-4 border-l mx-2" />
                </>
              )
            }
          />
        )}
        <div className="w-11/12 lg:w-4/5 max-w-[1200px] mx-auto">
          <div
            className="sticky z-[101] bg-white w-full py-4 flex items-center gap-5"
            style={{ top: isSoftStyle ? "56px" : "0px" }}
          >
            <div
              className={`h-8 text-xl font-medium flex items-center cursor-pointer relative  ${activeType === "explore" ? "text-[#1D1E1F]" : "text-[#999999]"}`}
              onClick={() => {
                checkLoginStatus()
                setActiveType("explore");
                setSearchParams({ from: "explore" });
              }}
            >
              {t("agent.explore")}
              {activeType === "explore" && (
                <SvgIcon
                  name="explore"
                  size={20}
                  className="absolute -right-5 -top-2"
                  color="var(--el-color-primary, #2563eb)"
                />
              )}
            </div>
            <div
              className={`h-8 text-xl font-medium flex  items-center cursor-pointer relative  ${activeType === "my" ? "text-[#1D1E1F]" : "text-[#999999]"}`}
              onClick={() => {
                checkLoginStatus()
                setActiveType("my");
                setSearchParams({ from: "my" });
              }}
            >
              {t("module.mine")}
              {activeType === "my" && (
                <SvgIcon
                  name="explore"
                  size={20}
                  className="absolute -right-5 -top-2"
                  color="var(--el-color-primary, #2563eb)"
                />
              )}
            </div>
          </div>

          {activeType === "explore" ? <GroupList /> : <MyList />}
        </div>
        <Footer />
      </div>
    </div>
  );
}

export default AgentPage;