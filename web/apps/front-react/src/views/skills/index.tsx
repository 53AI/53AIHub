import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { SvgIcon } from "@km/shared-components-react";
import { useIsSoftStyle } from "@/stores/modules/enterprise";
import { useSkillsStore } from "@/stores/modules/skills";
import { useUserStore } from "@/stores/modules/user";
import { GroupList } from "./components/GroupList";
import MyList from "./components/MyList";
import Header from "@/components/Layout/Header";
import Footer from "@/components/Layout/Footer";
import { t } from "@/locales";
import { checkLoginStatus } from "@/utils/permission";

export function SkillsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isSoftStyle = useIsSoftStyle();
  const skillsStore = useSkillsStore();
  const userStore = useUserStore();
  const [activeType, setActiveType] = useState<"explore" | "my">("explore");

  useEffect(() => {

    if (searchParams.get("from") === "my") {
      setActiveType("my");
    }
    // 只加载分类，列表数据由子组件 GroupList/MyList 自行加载
    skillsStore.loadCategorys();
  }, [searchParams, userStore.is_login]);

  return (
    <>
      {isSoftStyle && <Header back={false} title={t("module.skill")} border={false} />}
      <div
        className={`w-11/12 lg:w-4/5 max-w-[1200px] mx-auto ${isSoftStyle ? "" : "pt-4"}`}
      >
        <div
          className="sticky z-[101] bg-white w-full py-4 flex items-center gap-5"
          style={{ top: isSoftStyle ? "56px" : "0px" }}
        >
          <div
            className={`h-8 text-xl font-medium flex items-center cursor-pointer relative ${activeType === "explore" ? "text-[#1D1E1F]" : "text-[#999999]"}`}
            onClick={() => {
              checkLoginStatus()
              setActiveType("explore");
              const newParams = new URLSearchParams(searchParams);
              newParams.set("from", "explore");
              setSearchParams(newParams, { replace: true });
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
          {/* <div
            className={`h-8 text-xl font-medium flex items-center cursor-pointer relative ${activeType === "my" ? "text-[#1D1E1F]" : "text-[#999999]"}`}
            onClick={() => {
              checkLoginStatus()
              setActiveType("my");
              const newParams = new URLSearchParams(searchParams);
              newParams.set("from", "my");
              setSearchParams(newParams, { replace: true });
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
          </div> */}
        </div>

        {activeType === "explore" ? <GroupList enableUrlSync /> : <MyList />}
      </div>
      <Footer />
    </>
  );
}

export default SkillsView;