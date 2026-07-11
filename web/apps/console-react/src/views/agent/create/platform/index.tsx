import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useMemo,
  Suspense,
  lazy,
} from "react";
import { Spin } from "antd";
import { AGENT_TYPES } from "@/constants/platform/config";

interface AgentFormProps {
  agentType: string;
  showChannelConfig?: boolean;
  className?: string;
}

export interface AgentFormRef {
  save?: () => Promise<{ data?: { agent_id?: string } }>;
  validateForm?: () => Promise<boolean>;
  onChannelSave?: () => Promise<void>;
}

const componentMap: Record<
  string,
  React.LazyExoticComponent<React.ComponentType<any>>
> = {
  [AGENT_TYPES.PROMPT]: lazy(() => import("./Prompt")),
  [AGENT_TYPES.COZE_AGENT_CN]: lazy(() => import("./CozeCN")),
  [AGENT_TYPES.COZE_WORKFLOW_CN]: lazy(() => import("./CozeCN")),
  [AGENT_TYPES.COZE_AGENT_OSV]: lazy(() => import("./CozeOSV")),
  [AGENT_TYPES.COZE_WORKFLOW_OSV]: lazy(() => import("./CozeOSV")),
  [AGENT_TYPES.DIFY_AGENT]: lazy(() => import("./DifyAgent")),
  [AGENT_TYPES.DIFY_WORKFLOW]: lazy(() => import("./DifyAgent")),
  [AGENT_TYPES["53AI_AGENT"]]: lazy(() => import("./Agent53AI")),
  [AGENT_TYPES["53AI_WORKFLOW"]]: lazy(() => import("./Agent53AI")),
  [AGENT_TYPES.APP_BUILDER]: lazy(() => import("./AppBuilder")),
  [AGENT_TYPES.YUANQI]: lazy(() => import("./Yuanqi")),
  [AGENT_TYPES.BAILIAN]: lazy(() => import("./Bailian")),
  [AGENT_TYPES.VOLCENGINE]: lazy(() => import("./Volcengine")),
  [AGENT_TYPES.FASTGPT_AGENT]: lazy(() => import("./FastGPT")),
  [AGENT_TYPES.FASTGPT_WORKFLOW]: lazy(() => import("./FastGPT")),
  [AGENT_TYPES.MAXKB_AGENT]: lazy(() => import("./MaxKB")),
  [AGENT_TYPES.N8N_WORKFLOW]: lazy(() => import("./N8N")),
  [AGENT_TYPES.TENCENT]: lazy(() => import("./Tencent")),
};

export const AgentForm = forwardRef<AgentFormRef, AgentFormProps>(
  ({ agentType, showChannelConfig, className }, ref) => {
    const viewRef = useRef<any>(null);

    const CurrentComponent = useMemo(() => {
      return componentMap[agentType];
    }, [agentType]);

    useImperativeHandle(ref, () => ({
      get save() {
        return viewRef.current?.save;
      },
      get validateForm() {
        return viewRef.current?.validateForm;
      },
      get onChannelSave() {
        return viewRef.current?.onChannelSave;
      },
    }));

    if (!CurrentComponent) {
      return null;
    }

    return (
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-64">
            <Spin />
          </div>
        }
      >
        <CurrentComponent
          key={agentType}
          ref={viewRef}
          className={className}
          showChannelConfig={showChannelConfig}
        />
      </Suspense>
    );
  },
);

AgentForm.displayName = "AgentForm";

export default AgentForm;
