import { useState, useMemo } from "react";
import { Drawer, Button, message } from "antd";
import { CloseOutlined, CaretDownOutlined } from "@ant-design/icons";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import type { Pipeline, PipelineStep } from "../types";
import { NODE_ICONS_MAP, LIST_DISPLAY_NODE_TYPES } from "../constants";

// Import node config components
import { ParseConfig } from "./configs/ParseConfig";
import { ChunkConfig } from "./configs/ChunkConfig";
import { SummaryConfig } from "./configs/SummaryConfig";
import { VectorConfig } from "./configs/VectorConfig";
import { GraphConfig } from "./configs/GraphConfig";
import { CleanConfig } from "./configs/CleanConfig";

interface PipelineDetailProps {
  open: boolean;
  pipeline: Pipeline | null;
  onClose: () => void;
  onSave: (pipeline: Pipeline) => void;
  onEditBasic: (pipeline: Pipeline) => void;
  onUpdatePipeline: (pipeline: Pipeline) => void;
}

const getAvailableStatuses = (type: string) => {
  const common = ["auto", "manual"];
  if (
    [
      "graph_generation",
      "vector_indexing",
      "summary_generation",
      "content_cleaning",
    ].includes(type)
  ) {
    return [...common, "skip"];
  }
  return common;
};

const getNodeIcon = (type: string) => NODE_ICONS_MAP[type] || "document";

const getNodeConfigComponent = (type: string) => {
  const map: Record<string, React.ComponentType<{ config: any }> | React.FC> = {
    document_parsing: ParseConfig,
    content_cleaning: CleanConfig,
    summary_generation: SummaryConfig,
    document_chunking: ChunkConfig,
    vector_indexing: VectorConfig,
    graph_generation: GraphConfig,
  };
  return map[type] || (() => null);
};

export function PipelineDetail({
  open,
  pipeline,
  onClose,
  onSave,
  onEditBasic,
  onUpdatePipeline,
}: PipelineDetailProps) {
  const [activeNodeIdx, setActiveNodeIdx] = useState(0);

  const visibleNodes = useMemo(() => {
    return (pipeline?.profile_json?.steps || []).filter((n: PipelineStep) =>
      LIST_DISPLAY_NODE_TYPES.includes(n.step_key),
    );
  }, [pipeline]);

  const activeNode = visibleNodes[activeNodeIdx] || visibleNodes[0];

  // Update node run_mode
  const handleUpdateRunMode = (status: string) => {
    if (!pipeline || !activeNode) return;
    const updatedSteps = pipeline.profile_json.steps.map(
      (step: PipelineStep) =>
        step.step_key === activeNode.step_key
          ? { ...step, run_mode: status }
          : step,
    );
    onUpdatePipeline({
      ...pipeline,
      profile_json: {
        ...pipeline.profile_json,
        steps: updatedSteps,
      },
    });
  };

  // Update node config
  const handleUpdateConfig = (val: any) => {
    if (!pipeline || !activeNode) return;
    const updatedSteps = pipeline.profile_json.steps.map(
      (step: PipelineStep) =>
        step.step_key === activeNode.step_key ? { ...step, config: val } : step,
    );
    onUpdatePipeline({
      ...pipeline,
      profile_json: {
        ...pipeline.profile_json,
        steps: updatedSteps,
      },
    });
  };

  const handleConfirm = () => {
    if (pipeline) {
      const graphStep = (pipeline?.profile_json?.steps || []).find(
        (s: PipelineStep) => s.step_key === "graph_generation",
      );
      const runMode = graphStep?.run_mode;
      const templateId = graphStep?.config?.graph_template_id;
      const isSmartMatchEnabled = Boolean(graphStep?.config?.enable_smart_match);

      if (graphStep && runMode !== "skip" && !isSmartMatchEnabled && !templateId) {
        message.warning("图谱生成未跳过时，请选择图谱模板");
        return;
      }
      onSave(pipeline);
    }
  };

  const handleEditBasic = () => {
    if (pipeline) {
      onEditBasic(pipeline);
    }
  };

  if (!pipeline) return null;

  const ConfigComponent = activeNode
    ? getNodeConfigComponent(activeNode.step_key)
    : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      closable={false}
      styles={{
        wrapper: { width: 1200 },
        body: { padding: 0 },
      }}
    >
      <div className="flex flex-col h-full overflow-hidden bg-white">
        {/* Modal Header */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3 px-2">
            <div className="flex-none w-8 h-8 rounded flex items-center justify-center">
              {pipeline.icon && (
                <img
                  src={pipeline.icon}
                  className="size-8 object-contain"
                  alt="logo"
                />
              )}
            </div>
            <h2 className="font-bold text-gray-800 text-lg">
              {pipeline.name || t("data_pipeline.add_pipeline")}
            </h2>
            {pipeline.id && (
              <Button type="link" onClick={handleEditBasic}>
                <SvgIcon name="edit" width={18} height={18} />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="text-gray-400 hover:text-gray-600 p-1 transition-colors"
              onClick={onClose}
            >
              <CloseOutlined style={{ fontSize: 24 }} />
            </button>
          </div>
        </div>

        {/* Modal Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar: Nodes Flow */}
          <div className="w-96 bg-[#F7F8FA] border-r border-gray-100 p-6 overflow-y-auto overflow-x-hidden">
            <div className="text-sm text-placeholder mb-4">
              {t("data_pipeline.section_title")}
            </div>
            {visibleNodes.map((node, i) => (
              <div key={node.step_key}>
                <button
                  className="w-full flex items-center gap-3 p-3 rounded-lg transition-all border group relative"
                  style={{
                    backgroundColor:
                      activeNodeIdx === i ? "#F0F5FF" : "#FFFFFF",
                    borderColor: activeNodeIdx === i ? "#2563EB" : "#E6E8EB",
                    boxShadow:
                      activeNodeIdx === i
                        ? "0 0 0 4px rgba(37, 99, 235, 0.1)"
                        : undefined,
                  }}
                  onClick={() => setActiveNodeIdx(i)}
                >
                  <div
                    className="w-6 h-6 rounded-md flex items-center justify-center transition-colors"
                    style={{
                      backgroundColor:
                        activeNodeIdx === i ? "#2563EB" : "#2563EB14",
                      color: activeNodeIdx === i ? "white" : "#2563EB",
                    }}
                  >
                    <SvgIcon
                      name={getNodeIcon(node.step_key)}
                      width={16}
                      height={16}
                    />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-sm text-primary">{node.name}</div>
                    <div className="text-xs text-placeholder">
                      {node.description}
                    </div>
                  </div>
                  <div
                    className="h-6 px-2 text-sm flex items-center gap-1 rounded border"
                    style={{
                      color:
                        node.run_mode === "auto"
                          ? "#07C160"
                          : node.run_mode === "manual"
                            ? "#EE7702"
                            : "#4F5052",
                      borderColor:
                        node.run_mode === "auto"
                          ? "#D2FAE5"
                          : node.run_mode === "manual"
                            ? "#F2E7DC"
                            : "#F7F7F7",
                      backgroundColor:
                        node.run_mode === "auto"
                          ? "#EBFFF4"
                          : node.run_mode === "manual"
                            ? "#FFFAF5"
                            : "#F7F7F7",
                    }}
                  >
                    <SvgIcon
                      name={
                        node.run_mode === "auto"
                          ? "light"
                          : node.run_mode === "manual"
                            ? "five-five"
                            : "power"
                      }
                      width={12}
                      height={12}
                      color={
                        node.run_mode === "auto"
                          ? "#07C160"
                          : node.run_mode === "manual"
                            ? "#EE7702"
                            : "#4F5052"
                      }
                    />
                    {node.run_mode === "auto"
                      ? t("data_pipeline.run_mode_auto")
                      : node.run_mode === "manual"
                        ? t("data_pipeline.run_mode_manual")
                        : t("data_pipeline.run_mode_skip")}
                  </div>
                  {activeNodeIdx === i && (
                    <div className="flex items-center justify-center absolute -right-14 top-1/2 rotate-45 -translate-y-1/2 size-[35px] bg-[#fff]"></div>
                  )}
                </button>
                {i < visibleNodes.length - 1 && (
                  <div className="flex py-1 my-1 justify-center relative">
                    <CaretDownOutlined style={{ color: "#DCDDE0" }} />
                    <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 border border-dashed border-[#DCDDE0]"></div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Right Content: Node Settings */}
          {activeNode && (
            <div className="flex-1 px-9 py-10 overflow-y-auto custom-scrollbar">
              {/* 顶部节点标题和状态切换 */}
              <div className="flex items-center mb-6">
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-800">
                    {activeNode.name}
                    {t("data_pipeline.node_config")}
                  </h3>
                  <p className="text-sm text-gray-400 mt-2">
                    {activeNode.description}
                  </p>
                </div>
                <div className="flex bg-gray-100 p-1 rounded-lg">
                  {getAvailableStatuses(activeNode.step_key).map((status) => (
                    <button
                      key={status}
                      className="px-4 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2"
                      style={{
                        backgroundColor:
                          activeNode.run_mode === status ? "white" : undefined,
                        color:
                          activeNode.run_mode === status
                            ? status === "auto"
                              ? "#07C160"
                              : status === "manual"
                                ? "#EE7702"
                                : "#4F5052"
                            : "#9ca3af",
                        boxShadow:
                          activeNode.run_mode === status
                            ? "0 1px 2px rgba(0,0,0,0.05)"
                            : undefined,
                      }}
                      onClick={() => handleUpdateRunMode(status)}
                    >
                      <SvgIcon
                        name={
                          status === "auto"
                            ? "light"
                            : status === "manual"
                              ? "five-five"
                              : "power"
                        }
                        width={14}
                        height={14}
                        color={
                          activeNode.run_mode === status
                            ? status === "auto"
                              ? "#07C160"
                              : status === "manual"
                                ? "#EE7702"
                                : "#4F5052"
                            : "#9ca3af"
                        }
                      />
                      {status === "auto"
                        ? t("data_pipeline.run_mode_auto")
                        : status === "manual"
                          ? t("data_pipeline.run_mode_manual")
                          : t("data_pipeline.run_mode_skip")}
                    </button>
                  ))}
                </div>
              </div>

              {ConfigComponent && (
                <ConfigComponent
                  config={activeNode.config}
                  manageable={activeNode.step_key === "graph_generation"}
                  onUpdateConfig={handleUpdateConfig}
                />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 flex justify-end gap-2">
          <Button onClick={onClose}>{t("action_cancel")}</Button>
          <Button type="primary" onClick={handleConfirm}>
            {t("action_save")}
          </Button>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #e5e7eb;
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background-color: transparent;
        }
      `}</style>
    </Drawer>
  );
}

export default PipelineDetail;
