import { useParams } from "react-router-dom";
import {
  useIsSoftStyle,
} from "@/stores/modules/enterprise";
import KnowledgePanel from "./shell/KnowledgePanel";
import Footer from "@/components/Layout/Footer";

export function KnowledgeView() {
  const { space_id } = useParams<{ space_id: string }>();
  const isSoftStyle = useIsSoftStyle();

  return (
    // 软件模式：面板内部自管滚动，根节点锁定高度防整页滚动；
    // 网站模式：跟随 layout main（overflow-y-auto）自然滚动，不设高度/裁剪，
    // 否则内容与 Footer 会被裁剪在首屏内无法滚动
    <div className={isSoftStyle ? "h-full overflow-hidden" : undefined}>
      {/* {isSoftStyle && <Header title={t("module.knowledge")} />} */}
      <div className={`flex-1 ${isSoftStyle ? "h-full overflow-hidden" : "w-11/12 lg:w-4/5 max-w-[1200px] mx-auto py-4 md:py-6 lg:py-8"}`}>
        <KnowledgePanel stickyOffset={isSoftStyle ? 64 : 0} spaceId={space_id} />
      </div>
      {isSoftStyle ? null : <Footer />}
    </div>
  );
}

export default KnowledgeView;
