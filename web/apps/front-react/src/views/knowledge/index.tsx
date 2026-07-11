import { useParams } from "react-router-dom";
import {
  useIsSoftStyle,
} from "@/stores/modules/enterprise";
import GroupList from "./components/GroupList";
import Footer from "@/components/Layout/Footer";

export function KnowledgeView() {
  const { space_id } = useParams<{ space_id: string }>();
  const isSoftStyle = useIsSoftStyle();

  return (
    <div className="h-full overflow-hidden">
      {/* {isSoftStyle && <Header title={t("module.knowledge")} />} */}
      <div className={`flex-1 ${isSoftStyle ? "h-full overflow-hidden" : "w-11/12 lg:w-4/5 max-w-[1200px] mx-auto py-4 md:py-6 lg:py-8"}`}>
        <GroupList stickyOffset={isSoftStyle ? 64 : 0} spaceId={space_id} />
      </div>
      {isSoftStyle ? null : <Footer />}
    </div>
  );
}

export default KnowledgeView;
