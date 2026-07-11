import React, {
  useState,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from "react";
import { Tag, Spin } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import chunksApi from "@/api/modules/chunks";
import "./NodeDetailDrawer.css";

interface SourceSegment {
  id: string;
  index: string;
  content: string;
  charCount: number;
}

interface EntityForm {
  name: string;
  description: string;
  type: string;
  properties: Record<string, string>;
}

interface SelectedNode {
  id: string;
  data: {
    name: string;
    description?: string;
    type?: string;
    properties?: Record<string, string>;
    chunk_ids?: string[];
  };
}

interface SelectedEdge {
  id: string;
  data: {
    source: string;
    target: string;
    predicate?: string;
    chunk_ids?: string[];
  };
}

interface Relation {
  id: string;
  sourceEntity: { id: string; entity_name: string };
  targetEntity: { id: string; entity_name: string };
  predicate: string;
}

interface NodeDetailDrawerRef {
  openNode: (file: any, node: SelectedNode, relatedEdges: Relation[]) => void;
  openEdge: (file: any, edge: SelectedEdge) => void;
  close: () => void;
}

interface NodeDetailDrawerProps {
  onClose?: () => void;
}

// Helper function to convert number to index (e.g., 0 -> '01', 1 -> '02')
const numberToIndex = (num: number | string): string => {
  const n = typeof num === "string" ? parseInt(num, 10) : num;
  return (n + 1).toString().padStart(2, "0");
};

export const NodeDetailDrawer = forwardRef<
  NodeDetailDrawerRef,
  NodeDetailDrawerProps
>(({ onClose }, ref) => {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentFile, setCurrentFile] = useState<any>(null);
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<SelectedEdge | null>(null);
  const [selectedRelations, setSelectedRelations] = useState<Relation[] | null>(
    null,
  );

  // Collapse states - default all expanded
  const [collapsedSections, setCollapsedSections] = useState({
    basic: false,
    source: false,
    relations: false,
  });

  // Entity form data
  const [entityForm, setEntityForm] = useState<EntityForm>({
    name: "",
    description: "",
    type: "",
    properties: {},
  });

  // Source segments data
  const [sourceSegments, setSourceSegments] = useState<SourceSegment[]>([]);

  // Fetch source segments
  const fetchSourceSegments = useCallback(async (chunkIds: string[]) => {
    if (!chunkIds || chunkIds.length === 0) {
      setSourceSegments([]);
      return;
    }

    try {
      setLoading(true);
      const res = await chunksApi.batchGet({ chunk_ids: chunkIds });
      setSourceSegments(
        (res.chunks || []).map((chunk: any) => ({
          id: chunk.id,
          index: chunk.chunk_index,
          content: chunk.content,
          charCount: chunk.content?.length || 0,
        })),
      );
    } catch (error) {
      console.error("Failed to fetch source segments:", error);
      setSourceSegments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fill entity form from node
  const fillEntityForm = useCallback((node: SelectedNode) => {
    if (node?.data) {
      setEntityForm({
        name: node.data.name || "",
        description: node.data.description || "",
        properties: node.data.properties || {},
        type: node.data.type || "",
      });
    }
  }, []);

  // Fill entity form from edge
  const fillEntityFormFromEdge = useCallback((edge: SelectedEdge) => {
    if (edge?.data) {
      setEntityForm({
        name: `${edge.data.source} → ${edge.data.target}`,
        description: "",
        type: "",
        properties: {},
      });
    }
  }, []);

  // Reset form
  const resetForm = useCallback(() => {
    setEntityForm({
      name: "",
      description: "",
      type: "",
      properties: {},
    });
    setSourceSegments([]);
    setSelectedNode(null);
    setSelectedEdge(null);
    setSelectedRelations(null);
    setCollapsedSections({
      basic: false,
      source: false,
      relations: false,
    });
  }, []);

  // Open drawer for node
  const openNode = useCallback(
    async (file: any, node: SelectedNode, relatedEdges: Relation[]) => {
      resetForm();
      setCurrentFile(file);
      setSelectedNode(node);
      setSelectedRelations(relatedEdges || []);
      fillEntityForm(node);
      setVisible(true);
      await fetchSourceSegments(node.data.chunk_ids || []);
    },
    [resetForm, fillEntityForm, fetchSourceSegments],
  );

  // Open drawer for edge
  const openEdge = useCallback(
    async (file: any, edge: SelectedEdge) => {
      resetForm();
      setCurrentFile(file);
      setSelectedEdge(edge);
      setSelectedRelations(null);
      fillEntityFormFromEdge(edge);
      setVisible(true);
      await fetchSourceSegments(edge.data.chunk_ids || []);
    },
    [resetForm, fillEntityFormFromEdge, fetchSourceSegments],
  );

  // Close drawer
  const close = useCallback(() => {
    setVisible(false);
    resetForm();
    onClose?.();
  }, [resetForm, onClose]);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    openNode,
    openEdge,
    close,
  }));

  // Handle cancel
  const handleCancel = () => {
    close();
  };

  // Toggle section
  const toggleSection = (section: "basic" | "source" | "relations") => {
    setCollapsedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  if (!visible) return null;

  return (
    <div className="node-detail-drawer flex-none bg-white w-[540px] shadow-lg flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-[60px] flex items-center px-5 border-b">
        <div className="flex-1">
          <h3 className="flex items-center gap-1 text-lg font-medium text-[#1D1E1F]">
            {entityForm.name}
          </h3>
        </div>
        <div className="cursor-pointer text-[#B8BABF]" onClick={handleCancel}>
          <SvgIcon name="close" size={16} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-5 overflow-y-auto">
        {/* 实体属性 Section */}
        <div>
          <h5
            className="flex items-center text-sm text-[#1D1E1F] mb-5 cursor-pointer select-none"
            onClick={() => toggleSection("basic")}
          >
            <SvgIcon
              name={collapsedSections.basic ? "right-one" : "down-one"}
              size={16}
            />
            <span className="ml-1">实体属性</span>
          </h5>

          {!collapsedSections.basic && (
            <div className="px-5">
              {/* 来源实体/目标实体 - for edge */}
              {selectedEdge && (
                <>
                  <div className="form-item mb-3">
                    <div className="form-label w-[80px] text-sm text-[#4F5052]">
                      来源实体
                    </div>
                    <div className="form-content">
                      <Tag>{selectedEdge.data?.source}</Tag>
                    </div>
                  </div>
                  <div className="form-item mb-3">
                    <div className="form-label w-[80px] text-sm text-[#4F5052]">
                      目标实体
                    </div>
                    <div className="form-content">
                      <Tag>{selectedEdge.data?.target}</Tag>
                    </div>
                  </div>
                </>
              )}

              {/* Properties */}
              {Object.entries(entityForm.properties).map(([key, value]) => (
                <div key={key} className="form-item mb-3">
                  <div className="form-label w-[80px] text-sm text-[#4F5052]">
                    {key}
                  </div>
                  <div className="form-content">
                    <div className="text-sm text-[#1D1E1F] whitespace-pre-wrap">
                      {value}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 实体关系 Section - only for node */}
        {selectedRelations && (
          <div>
            <h5
              className="flex items-center text-sm text-[#1D1E1F] mb-5 cursor-pointer select-none"
              onClick={() => toggleSection("relations")}
            >
              <SvgIcon
                name={collapsedSections.relations ? "right-one" : "down-one"}
                size={16}
              />
              <span className="ml-1">实体关系</span>
            </h5>

            {!collapsedSections.relations && (
              <div className="px-5 mt-4">
                {selectedRelations.length === 0 ? (
                  <div className="text-center py-8 text-sm text-[#999999]">
                    暂无关系类型
                  </div>
                ) : (
                  <div className="flex flex-col bg-white rounded-[10px] overflow-hidden border border-[#e6e8eb]">
                    {selectedRelations.map((rel) => (
                      <div key={rel.id} className="flex items-center py-3.5">
                        <div className="flex-1 px-4 flex justify-end overflow-hidden">
                          <div className="flex items-center justify-center bg-[#ebf1ff] rounded-lg min-w-[60px] h-[30px] px-3 truncate">
                            <span className="text-sm text-[#2563eb]">
                              {rel.sourceEntity.entity_name}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-center w-20">
                          <div className="flex items-center justify-center py-1 bg-[#f3f0ff] rounded-lg max-w-[120px] h-[18px] px-2 truncate">
                            <span className="text-xs text-[#8063e3] truncate">
                              {rel.predicate}
                            </span>
                          </div>
                        </div>
                        <ArrowRightOutlined style={{ color: "#D9DADB" }} />
                        <div className="flex-1 px-4 flex overflow-hidden">
                          <div className="flex items-center justify-center bg-[#ebf1ff] rounded-lg min-w-[60px] h-[30px] px-3 truncate">
                            <span className="text-sm text-[#2563eb]">
                              {rel.targetEntity.entity_name}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 来源切片 Section */}
        <div>
          <h5
            className="flex items-center text-sm text-[#1D1E1F] cursor-pointer select-none"
            onClick={() => toggleSection("source")}
          >
            <SvgIcon
              name={collapsedSections.source ? "right-one" : "down-one"}
              size={16}
            />
            <span className="ml-1">来源切片</span>
          </h5>

          {!collapsedSections.source && (
            <div className="px-5 mt-5">
              {loading ? (
                <div className="text-center py-8">
                  <Spin />
                </div>
              ) : sourceSegments.length === 0 ? (
                <div className="text-center py-8 text-sm text-[#999999]">
                  暂无来源切片
                </div>
              ) : (
                sourceSegments.map((segment) => (
                  <div
                    key={segment.id}
                    className="border rounded bg-[#F8F9FA] p-4 mb-4 group"
                  >
                    <div className="flex items-center mb-2">
                      <p className="flex-1 text-xs text-[#999999]">
                        #{numberToIndex(segment.index)} | {segment.charCount}{" "}
                        字符
                      </p>
                    </div>
                    <div className="text-sm text-[#1D1E1F] break-words">
                      {segment.content}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

NodeDetailDrawer.displayName = "NodeDetailDrawer";

export default NodeDetailDrawer;
