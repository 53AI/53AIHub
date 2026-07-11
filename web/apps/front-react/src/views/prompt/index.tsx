import { useState } from "react";
import { SvgIcon } from "@km/shared-components-react";
import { useIsSoftStyle } from "@/stores/modules/enterprise";
import { t } from "@/locales";
import Footer from "@/components/Layout/Footer";
import Header from "@/components/Layout/Header";
import GroupList from "./components/GroupList";


export function PromptView() {
  const isSoftStyle = useIsSoftStyle();

  const [activeType, setActiveType] = useState("explore");


  return (
    <>
      {isSoftStyle && <Header title={t("module.prompt")} border={false} />}
      <div
        className={`w-11/12 lg:w-4/5 max-w-[1200px] mx-auto ${isSoftStyle ? "" : "pt-4"}`}
      >
        <div
          className="sticky z-[101] bg-white w-full py-4 flex items-center"
          style={{ top: isSoftStyle ? "56px" : "0px" }}
        >
          <div
            className="h-8 text-xl font-medium flex items-center text-[#1D1E1F] cursor-pointer relative"
            onClick={() => setActiveType("explore")}
          >
            {t("prompt.explore")}
            <SvgIcon
              name="explore"
              size={20}
              className="absolute -right-5 -top-2"
              color="var(--el-color-primary, #2563eb)"
            />
          </div>
        </div>

        {/* Content */}
        {activeType === "explore" && (<GroupList enableUrlSync></GroupList>)}
      </div>
      <Footer />
    </>
  );
}

export default PromptView;
