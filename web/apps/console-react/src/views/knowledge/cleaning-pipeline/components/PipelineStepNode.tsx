import { SvgIcon } from "@km/shared-components-react";
import { NODE_ICONS_MAP, LIST_DISPLAY_NODE_TYPES } from "@km/shared-business/knowledge-pipeline";
import type { PipelineStep } from "@km/shared-business/knowledge-pipeline";

// Get node icon
export const getNodeIcon = (stepKey: string) => NODE_ICONS_MAP[stepKey] || "document";

// Filter nodes for list display
export const getDisplayNodes = (nodes: PipelineStep[]) =>
  nodes.filter((n) => LIST_DISPLAY_NODE_TYPES.includes(n.step_key));

interface PipelineStepNodeProps {
  step: PipelineStep;
  size?: number;
}

export function PipelineStepNode({ step, size = 14 }: PipelineStepNodeProps) {
  const isSkip = step.run_mode === "skip";
  const isAuto = step.run_mode === "auto";

  return (
    <div
      className="relative size-8 rounded flex items-center justify-center transition-all"
      style={{
        backgroundColor: isSkip ? "#F7F8FA" : "#EEF3FE",
        color: isSkip ? "#999999" : "#2563EB",
      }}
      title={step.name}
    >
      <SvgIcon
        name={getNodeIcon(step.step_key)}
        width={size}
        height={size}
      />

      {/* Status icon */}
      {!isSkip && (
        <div
          className="absolute -top-1.5 -right-1.5 size-5 rounded flex items-center justify-center border border-white"
          style={{
            color: isAuto ? "#07C160" : "#EE7702",
            backgroundColor: isAuto ? "#F0FFF7" : "#FFF7F0",
            borderColor: isAuto ? "#E1F5EB" : "#F5EBE1",
          }}
        >
          <SvgIcon name={isAuto ? "light" : "five-five"} size={12} />
        </div>
      )}
    </div>
  );
}

interface PipelineStepsProps {
  steps: PipelineStep[];
}

export function PipelineSteps({ steps }: PipelineStepsProps) {
  const displayNodes = getDisplayNodes(steps);

  return (
    <div className="flex items-center gap-1.5">
      {displayNodes.map((node) => (
        <PipelineStepNode key={node.step_key} step={node} />
      ))}
    </div>
  );
}

export default PipelineStepNode;
