import { useOutletContext } from "react-router-dom";
import { Header } from "@/components/Header";
import { KnowledgeList } from "@/views/space/components/KnowledgeList";
import type { SpaceSettingContext } from "../index";
import { t } from "@/locales";

export function KnowledgePage() {
  const { space } = useOutletContext<SpaceSettingContext>();

  return (
    <div className="h-screen flex flex-col overflow-hidden px-[78px] bg-white">
      <Header className="pt-8 pb-5" title={t("space.setting.menu.knowledge")} />
      <div className="flex-1 overflow-y-auto">
        <KnowledgeList spaceId={space.id} />
      </div>
    </div>
  );
}

export default KnowledgePage;
