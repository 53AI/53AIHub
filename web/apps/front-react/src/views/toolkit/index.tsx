import { useIsSoftStyle } from "@/stores/modules/enterprise";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import GroupList from "./components/GroupList";
import Header from "@/components/Layout/Header";
import Footer from "@/components/Layout/Footer";

export function ToolkitView() {
  const isSoftStyle = useIsSoftStyle();

  return (
    <>
      {isSoftStyle && <Header title={t('module.toolbox')} border={false} />}
      <div
        className={`w-11/12 lg:w-4/5 max-w-[1200px] mx-auto ${isSoftStyle ? "" : "pt-4"}`}
      >
        <div
          className="sticky z-[101] bg-white w-full py-4 flex items-end"
          style={{ top: isSoftStyle ? "56px" : "0px" }}
        >
          <div className="h-8 text-xl font-medium flex items-center text-[#1D1E1F] cursor-pointer relative">
            {t("toolbox.explore")}
            <SvgIcon
              name="explore"
              size={20}
              className="absolute -right-5 -top-2"
              color="var(--el-color-primary, #2563eb)"
            />
          </div>
        </div>

        <GroupList enableUrlSync />
      </div>
      <Footer />
    </>
  );
}

export default ToolkitView;
