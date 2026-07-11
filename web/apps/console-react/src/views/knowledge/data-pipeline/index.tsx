import { useEffect } from "react";
import { Button, Spin } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import { PipelineDetail } from "./components/PipelineDetail";
import { usePipeline } from "./hooks/usePipeline";
import { NODE_ICONS_MAP, LIST_DISPLAY_NODE_TYPES } from "./constants";
import type { PipelineStep } from "./types";

// 获取节点图标
const getNodeIcon = (stepKey: string) => NODE_ICONS_MAP[stepKey] || "document";

// 过滤列表展示的节点
const getDisplayNodes = (nodes: PipelineStep[]) =>
  nodes.filter((n) => LIST_DISPLAY_NODE_TYPES.includes(n.step_key));

export function KnowledgeDataPipeline() {
  const {
    pipelines,
    isLoading,
    detailVisible,
    currentPipeline,
    fetchPipelines,
    handleEdit,
    handleSave,
    setDetailVisible,
    setCurrentPipeline,
  } = usePipeline();

  // 初始化数据
  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  return (
    <div className="py-5 px-2 h-full overflow-y-auto">
      <Spin spinning={isLoading}>
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="px-6 py-4 font-medium text-gray-500">
                  {t("data_pipeline.col_name")}
                </th>
                <th className="px-6 py-4 font-medium text-gray-500">
                  {t("data_pipeline.col_enabled_nodes")}
                </th>
                <th className="px-6 py-4 font-medium text-gray-500 text-center">
                  {t("data_pipeline.col_volume")}
                </th>
                <th className="px-6 py-4 font-medium text-gray-500 text-center">
                  {t("data_pipeline.col_success_rate")}
                </th>
                <th className="px-6 py-4 font-medium text-gray-500 text-right">
                  {t("data_pipeline.col_operation")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {pipelines.map((pipeline) => (
                <tr
                  key={pipeline.id}
                  className="hover:bg-gray-50/30 transition-colors group cursor-pointer"
                  onClick={() => handleEdit(pipeline)}
                >
                  <td className="px-6 py-6">
                    <div className="flex items-center gap-3">
                      <div className="flex-shrink-0 size-12 rounded-lg">
                        <img
                          src={pipeline.icon}
                          className="size-12 object-contain"
                          alt={pipeline.name}
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-base font-semibold text-primary">
                            {pipeline.name}
                          </span>
                        </div>
                        <div className="text-sm text-placeholder mt-0.5">
                          {t("data_pipeline.created_at_label")}:{" "}
                          {pipeline.created_at}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-6">
                    <div className="flex items-center gap-1.5">
                      {getDisplayNodes(pipeline.profile_json.steps).map(
                        (node) => (
                          <div
                            key={node.step_key}
                            className="relative size-8 rounded flex items-center justify-center transition-all"
                            style={{
                              backgroundColor:
                                node.run_mode !== "skip"
                                  ? "#EEF3FE"
                                  : "#F7F8FA",
                              color:
                                node.run_mode !== "skip"
                                  ? "#2563EB"
                                  : "#999999",
                            }}
                            title={node.name}
                          >
                            <SvgIcon
                              name={getNodeIcon(node.step_key)}
                              width={14}
                              height={14}
                            />

                            {/* 状态小图标 */}
                            {node.run_mode !== "skip" && (
                              <div
                                className="absolute -top-1.5 -right-1.5 size-5 rounded flex items-center justify-center border border-white"
                                style={{
                                  color:
                                    node.run_mode === "auto"
                                      ? "#07C160"
                                      : "#EE7702",
                                  backgroundColor:
                                    node.run_mode === "auto"
                                      ? "#F0FFF7"
                                      : "#FFF7F0",
                                  borderColor:
                                    node.run_mode === "auto"
                                      ? "#E1F5EB"
                                      : "#F5EBE1",
                                }}
                              >
                                <SvgIcon
                                  name={
                                    node.run_mode === "auto"
                                      ? "light"
                                      : "five-five"
                                  }
                                  size={12}
                                />
                              </div>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-6 text-center text-gray-600 font-medium">
                    {pipeline.stats.total}
                  </td>
                  <td className="px-6 py-6 text-center">
                    <span className="text-emerald-500 bg-emerald-50 px-2 py-1 rounded">
                      {pipeline.stats.success_rate}%
                    </span>
                  </td>
                  <td className="px-6 py-6 text-right">
                    <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        type="link"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(pipeline);
                        }}
                      >
                        <SettingOutlined style={{ fontSize: 18 }} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Spin>

      {/* 详情抽屉 (配置节点) */}
      {currentPipeline && (
        <PipelineDetail
          open={detailVisible}
          pipeline={currentPipeline}
          onClose={() => setDetailVisible(false)}
          onSave={handleSave}
          onUpdatePipeline={setCurrentPipeline}
        />
      )}
    </div>
  );
}

export default KnowledgeDataPipeline;
