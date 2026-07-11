// apps/front-react/src/components/Chat/ThinkKnowledge.tsx
// 包装组件：使用 shared-business ThinkKnowledge + front-react 特定 slots

import { forwardRef } from "react";
import {
  ThinkKnowledge as BaseThinkKnowledge,
  type ThinkKnowledgeRef,
  type ThinkKnowledgeProps,
  type SearchResultItem,
} from "@km/shared-business/chat";
import { getPublicPath } from "@/utils/config";
import KnowledgeViewDrawer from "@/components/Knowledge/view-drawer";
import KnowledgeGraphDrawer from "@/components/Knowledge/graph-drawer";

// 重导出类型
export type { ThinkKnowledgeRef, SearchResultItem };

export const ThinkKnowledge = forwardRef<ThinkKnowledgeRef, Omit<ThinkKnowledgeProps, "slots" | "getPublicPath">>(
  (props, ref) => {
    return (
      <BaseThinkKnowledge
        {...props}
        ref={ref}
        slots={{
          KnowledgeViewDrawer,
          KnowledgeGraphDrawer,
        }}
        getPublicPath={getPublicPath}
      />
    );
  }
);

ThinkKnowledge.displayName = "ThinkKnowledge";

export default ThinkKnowledge;