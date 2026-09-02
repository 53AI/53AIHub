import { KnowledgeList } from "@/views/space/components/KnowledgeList";
import type { SpaceItem } from "@/api/modules/spaces/types";

export interface KnowledgeTabProps {
  space: SpaceItem;
  onRefresh: () => Promise<void>;
}

export function KnowledgeTab({ space, onRefresh: _onRefresh }: KnowledgeTabProps) {
  return (
    <div className="h-full overflow-y-auto py-2">
      <KnowledgeList spaceId={space.id} />
    </div>
  );
}

export default KnowledgeTab;
