// packages/shared-business/src/chat/components/source/popups/Graph.tsx

import { useState, useRef, useCallback, forwardRef, useImperativeHandle, useEffect } from "react";
import { Popover, Button } from "antd";
import { CloseOutlined, ShareAltOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import { useTranslation } from "../../../i18n";
import type { ChunkItem } from "../../../types/message";

interface GraphEntity {
  id: string;
  name?: string;
  description?: string;
}

interface GraphRelation {
  source_entity_id: string;
  target_entity_id: string;
  predicate?: string;
}

interface GraphData {
  entities?: GraphEntity[];
  relations?: GraphRelation[];
}

export interface GraphRef {
  setLibraryInfo: (info: ChunkItem | null, type?: string) => void;
  hide: () => void;
}

export interface GraphProps {
  /** 查看图谱回调 */
  onView?: (info: ChunkItem) => void;
  /** 虚拟 ref 元素（用于定位弹出位置） */
  virtualRef?: React.RefObject<HTMLElement | null>;
  /** 自定义图谱渲染组件 */
  renderGraphViewer?: (data: GraphData) => React.ReactNode;
}

const DEFAULT_GRAPH_WIDTH = 680;
const DEFAULT_GRAPH_HEIGHT = 300;

function deepCopy<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}

export const Graph = forwardRef<GraphRef, GraphProps>(
  ({ onView, virtualRef, renderGraphViewer }, ref) => {
    const { t } = useTranslation();
    const [visible, setVisible] = useState(false);
    const [libraryInfo, setLibraryInfo] = useState<ChunkItem | null>(null);
    const [showGraph, setShowGraph] = useState(false);
    const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
    const graphDataRef = useRef<GraphData>({ entities: [], relations: [] });

    useImperativeHandle(ref, () => ({
      setLibraryInfo: (info: ChunkItem | null, _type?: string) => {
        setLibraryInfo(info ? deepCopy(info) : null);
        if (info?.graph) {
          setShowGraph(true);
          graphDataRef.current = {
            entities: info.graph.entities || [],
            relations: info.graph.relations || [],
          };
        }
        if (virtualRef?.current) {
          setTriggerRect(virtualRef.current.getBoundingClientRect());
        }
      },
      hide: () => {
        setVisible(false);
        setTriggerRect(null);
        setShowGraph(false);
      },
    }));

    useEffect(() => {
      if (!visible) {
        setTriggerRect(null);
      }
    }, [visible]);

    const handleViewGraph = useCallback(() => {
      if (libraryInfo) {
        onView?.(libraryInfo);
      }
      setVisible(false);
    }, [libraryInfo, onView]);

    useEffect(() => {
      if (libraryInfo && triggerRect) {
        setVisible(true);
        if (libraryInfo.graph) {
          setShowGraph(true);
        }
      }
    }, [libraryInfo, triggerRect]);

    // 默认图谱渲染
    const defaultGraphRenderer = (data: GraphData) => {
      const entityMap = new Map<string, string>();
      (data.entities || []).forEach((e) => {
        entityMap.set(e.id, e.name || e.description || "");
      });

      return (
        <div className="w-full h-full overflow-auto bg-[#f9fafb] rounded">
          {(data.relations || []).length > 0 ? (
            <div className="p-3 space-y-2">
              {(data.relations || []).map((r, idx) => {
                const sourceName = entityMap.get(r.source_entity_id) || r.source_entity_id;
                const targetName = entityMap.get(r.target_entity_id) || r.target_entity_id;
                return (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    <span className="px-2 py-1 bg-blue-100 rounded">{sourceName}</span>
                    <span className="text-gray-500">{r.predicate || "->"}</span>
                    <span className="px-2 py-1 bg-green-100 rounded">{targetName}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              {t("graph.no_data") || "暂无图谱数据"}
            </div>
          )}
        </div>
      );
    };

    const content = libraryInfo ? (
      <div style={{ width: DEFAULT_GRAPH_WIDTH }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="size-5 rounded flex items-center justify-center bg-[#145CF7] text-white">
              <SvgIcon name="six-points" />
            </div>
            <h3 className="flex-1 text-base text-[#1D1E1F] truncate">
              {t("graph.knowledge_graph") || "知识图谱"}
            </h3>
          </div>
          <Button
            type="link"
            size="small"
            onClick={() => setVisible(false)}
            className="text-gray-400 hover:text-gray-600"
          >
            <CloseOutlined />
          </Button>
        </div>

        <div className="w-full" style={{ height: DEFAULT_GRAPH_HEIGHT }}>
          {showGraph && (renderGraphViewer ? renderGraphViewer(graphDataRef.current) : defaultGraphRenderer(graphDataRef.current))}
        </div>

        <div className="flex items-center justify-between mt-4">
          <div className="flex-1" />
          <Button color="primary" variant="filled" onClick={handleViewGraph}>
            {t("graph.view") || "查看图谱"}
            <ShareAltOutlined style={{ marginLeft: 4 }} />
          </Button>
        </div>
      </div>
    ) : null;

    const triggerStyle: React.CSSProperties = triggerRect
      ? {
          position: "fixed",
          left: triggerRect.left,
          top: triggerRect.top,
          width: Math.max(triggerRect.width, 1),
          height: Math.max(triggerRect.height, 1),
          pointerEvents: "none",
          zIndex: -1,
        }
      : { display: "none" };

    return (
      <Popover
        open={visible}
        onOpenChange={(open) => {
          if (!open) {
            setVisible(false);
            setTriggerRect(null);
          }
        }}
        placement="bottomLeft"
        trigger="click"
        content={content}
        classNames={{ root: "!p-0" }}
      >
        <span style={triggerStyle} />
      </Popover>
    );
  }
);

Graph.displayName = "Graph";

export default Graph;
