import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useMemo,
} from "react";
import { Tooltip } from "antd";
import { Dropdown, Search } from "@km/shared-components-react";
import type { MenuProps } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { getPublicPath } from "@/utils/config";
import loadLib from "@/utils/loadLib";
import "./GraphViewerWidget.css";

// Types
type GraphNode = Record<string, any>;
type GraphEdge = Record<string, any>;
type GraphClickPayload = {
  targetType: "node" | "edge";
  targetId: string;
  data: any;
};

// Original entity data type
type EntityItem = {
  id: string;
  name: string;
  type?: string;
  properties?: Record<string, any>;
  chunk_ids?: string[];
  created_time?: number;
};

// Original relation data type
type RelationItem = {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  predicate?: string;
  chunk_ids?: string[];
  created_time?: number;
};

// Graph data type
type GraphData = {
  entities?: EntityItem[];
  relations?: RelationItem[];
};

// Fixed 60 colors
const ENTITY_COLORS = [
  "#0EBB80", "#F49E0B", "#5C61FF", "#E74C3C", "#3498DB",
  "#9B59B6", "#1ABC9C", "#E67E22", "#2ECC71", "#34495E",
  "#16A085", "#27AE60", "#2980B9", "#8E44AD", "#2C3E50",
  "#F39C12", "#D35400", "#C0392B", "#BDC3C7", "#7F8C8D",
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7",
  "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9",
  "#F8B500", "#00CED1", "#FF69B4", "#32CD32", "#FFD700",
  "#FF4500", "#1E90FF", "#00FA9A", "#FF1493", "#00BFFF",
  "#ADFF2F", "#FF6347", "#40E0D0", "#EE82EE", "#F0E68C",
  "#ADD8E6", "#90EE90", "#FFB6C1", "#20B2AA", "#87CEEB",
  "#778899", "#B0C4DE", "#FFFFE0", "#00FF00", "#FF00FF",
  "#00FFFF", "#FF0000", "#0000FF", "#008000", "#800080",
];

interface GraphViewerWidgetProps {
  keyword?: string;
  isSupportSearch?: boolean;
  loading?: boolean;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  minZoom?: number;
  maxZoom?: number;
  zoomStep?: number;
  zoomRange?: number[];
  onKeywordChange?: (value: string) => void;
  onSearch?: (value: string) => void;
  onGraphReady?: (graph: any) => void;
  onZoomChange?: (zoom: number) => void;
  onElementClick?: (payload: GraphClickPayload) => void;
}

export interface GraphViewerWidgetRef {
  fitView: () => void;
  zoomTo: (zoom: number) => void;
  getGraph: () => any;
  render: () => void;
  setGraphData: (data: GraphData) => Promise<void>;
}

export const GraphViewerWidget = forwardRef<GraphViewerWidgetRef, GraphViewerWidgetProps>(
  (
    {
      keyword = "",
      isSupportSearch = false,
      loading = false,
      empty = false,
      emptyTitle = "暂无知识图谱数据",
      emptyDescription = "请先对文档进行知识图谱抽取",
      minZoom = 0.2,
      maxZoom = 3,
      zoomStep = 0.1,
      zoomRange = [3, 1.5, 1, 0.5, 0.2],
      onKeywordChange,
      onSearch,
      onGraphReady,
      onZoomChange,
      onElementClick,
    },
    ref
  ) => {
    const graphContainer = useRef<HTMLDivElement>(null);
    const graphInstance = useRef<any>(null);
    const [currentZoom, setCurrentZoom] = useState(1);
    const [isReady, setIsReady] = useState(false);
    const [hiddenEntityTypes, setHiddenEntityTypes] = useState<Set<string>>(new Set());
    const [keywordValue, setKeywordValue] = useState(keyword);
    const [internalEntities, setInternalEntities] = useState<EntityItem[]>([]);
    const [internalRelations, setInternalRelations] = useState<RelationItem[]>([]);

    // Sync keyword prop
    useEffect(() => {
      setKeywordValue(keyword);
    }, [keyword]);

    // Transform entity data to node data
    const transformEntityDataToNodeData = useCallback((entities: EntityItem[]) => {
      const entityMap = new Map<string, EntityItem>();
      entities.forEach((entity) => {
        entityMap.set(entity.id, entity);
      });

      const typeColorMap = new Map<string, string>();
      const uniqueTypes = [...new Set(entities.map((e) => e.type || "未分类"))];
      uniqueTypes.forEach((type, index) => {
        typeColorMap.set(type, ENTITY_COLORS[index % ENTITY_COLORS.length]);
      });

      return Array.from(entityMap.values()).map((entity) => {
        const entityType = entity.type || "未分类";
        const color = typeColorMap.get(entityType) || ENTITY_COLORS[0];
        const isHidden = hiddenEntityTypes.has(entityType);

        const fillColor = color + "1A";
        const strokeColor = color + "4D";
        const labelColor = color;

        return {
          id: entity.id,
          data: {
            name: entity.name,
            properties: entity.properties,
            chunk_ids: entity.chunk_ids,
            type: entity.type,
          },
          style: {
            size: 80,
            fill: fillColor,
            stroke: strokeColor,
            lineWidth: 1.5,
            labelText: entity.name,
            labelPlacement: "center" as const,
            labelFontSize: 12,
            labelMaxWidth: 60,
            labelFontWeight: 500,
            labelTextOverflow: "ellipsis",
            labelWordWrap: true,
            labelFill: labelColor,
          },
          state: {
            active: {
              stroke: color,
              fill: color + "80",
              halo: false,
              lineWidth: 1.5,
            },
            selected: {
              halo: true,
              labelFill: "#FFF",
              fill: color,
              haloLineWidth: 12,
              stroke: color,
              haloStrokeOpacity: 1,
              haloStroke: color + "33",
            },
          },
        };
      });
    }, [hiddenEntityTypes]);

    // Transform relation data to edge data
    const transformRelationDataToEdgeData = useCallback(
      (relations: RelationItem[], entities: EntityItem[]) => {
        return relations.map((relation) => {
          const sourceName =
            entities.find((e) => e.id === relation.source_entity_id)?.name || "";
          const targetName =
            entities.find((e) => e.id === relation.target_entity_id)?.name || "";

          return {
            id: relation.id,
            source: relation.source_entity_id,
            target: relation.target_entity_id,
            data: {
              source: sourceName,
              target: targetName,
              chunk_ids: relation.chunk_ids,
              predicate: relation.predicate,
            },
            style: {
              curveOffset: 30,
              stroke: "#C5CBD6",
              lineWidth: 1,
              lineDash: [5, 2],
              labelText: relation.predicate,
              labelMaxWidth: "30%",
              labelPadding: [3, 12, 3, 12],
              labelWordWrap: true,
              labelFontSize: 10,
              labelFontWeight: 400,
              labelFill: "#495366",
              labelTextOverflow: "ellipsis",
              endArrow: true,
              endArrowType: "triangle" as const,
              labelBackground: true,
              labelBackgroundLineWidth: 1,
              labelBackgroundRadius: 100,
              labelBackgroundStroke: "#C5CBD6",
              labelBackgroundFill: "#FFF",
              labelBackgroundOpacity: 1,
            },
            state: {
              active: {
                labelFontSize: 10,
                labelFontWeight: 400,
                labelFill: "#000",
                lineWidth: 1,
                halo: false,
                stroke: "#333AFF",
                labelBackgroundStroke: "#333AFF",
              },
              selected: {
                labelFontSize: 10,
                labelFontWeight: 500,
                labelFill: "#000",
                lineWidth: 1,
                halo: false,
                stroke: "#333AFF",
                labelBackgroundStroke: "#333AFF",
              },
            },
          };
        });
      },
      []
    );

    // Computed nodes and edges
    const computedNodes = useMemo(() => {
      return transformEntityDataToNodeData(internalEntities);
    }, [internalEntities, transformEntityDataToNodeData]);

    const computedEdges = useMemo(() => {
      return transformRelationDataToEdgeData(internalRelations, internalEntities);
    }, [internalRelations, internalEntities, transformRelationDataToEdgeData]);

    // Get graph options
    const getOptions = useCallback(() => {
      return {
        data: {
          nodes: computedNodes || [],
          edges: computedEdges || [],
        },
        layout: {
          type: "d3-force",
          nodeSize: 80,
          link: { distance: 150 },
          manyBody: { strength: -30 },
          collide: { radius: 70, strength: 0.7 },
          center: { strength: 0.05 },
        },
        edge: {
          type: "quadratic",
        },
        plugins: [
          {
            type: "background",
            backgroundImage: `url(${window.location.origin + getPublicPath("/images/library/graph_bg.png")})`,
          },
        ],
        behaviors: [
          "drag-canvas",
          "hover-activate",
          {
            type: "drag-element-force",
            fixed: true,
          },
          {
            type: "zoom-canvas",
            onFinish: () => {
              if (!graphInstance.current) return;
              const zoom = graphInstance.current.getZoom();
              if (zoom !== undefined && zoom !== null) {
                setCurrentZoom(zoom);
                onZoomChange?.(zoom);
              }
            },
          },
          {
            type: "click-select",
            degree: 1,
            unselectedState: "inactive",
            onClick: (e: any) => {
              if (!graphInstance.current || !e?.target?.id || !e?.targetType) return;
              const targetType = e.targetType;
              const targetId = e.target.id;
              if (targetType === "node") {
                const node = graphInstance.current.getNodeData(targetId);
                if (!node) return;
                onElementClick?.({ targetType: "node", targetId, data: node });
              }
              if (targetType === "edge") {
                const edge = graphInstance.current.getEdgeData(targetId);
                if (!edge) return;
                onElementClick?.({ targetType: "edge", targetId, data: edge });
              }
            },
          },
        ],
      };
    }, [computedNodes, computedEdges, onZoomChange, onElementClick]);

    // Render graph
    const renderGraph = useCallback(async () => {
      if (!isReady || !graphContainer.current) return;

      // Destroy graph instance if no data
      const nodes = computedNodes || [];
      const edges = computedEdges || [];
      if (nodes.length === 0) {
        if (graphInstance.current) {
          graphInstance.current.destroy();
          graphInstance.current = null;
        }
        return;
      }

      if (!graphInstance.current) {
        const graph = new (window as any).G6.Graph({
          container: graphContainer.current,
          width: graphContainer.current.clientWidth,
          height: graphContainer.current.clientHeight || 600,
          autoFit: "center",
          autoResize: true,
          zoomRange: [minZoom, maxZoom],
          ...getOptions(),
        });
        graph.render();
        graph.fitView();
        setCurrentZoom(1);
        graphInstance.current = graph;
        onGraphReady?.(graph);
        return;
      }

      graphInstance.current.setData({
        nodes,
        edges,
      });
      graphInstance.current.render();
      graphInstance.current.fitView();
      const zoom = graphInstance.current.getZoom();
      setCurrentZoom(zoom || 1);
      onZoomChange?.(zoom || 1);
    }, [isReady, computedNodes, computedEdges, minZoom, maxZoom, getOptions, onGraphReady, onZoomChange]);

    // Zoom functions
    const zoomTo = useCallback(
      (zoom: number) => {
        if (!graphInstance.current) return;
        graphInstance.current.zoomTo(zoom);
        setCurrentZoom(zoom);
        onZoomChange?.(zoom);
      },
      [onZoomChange]
    );

    const handleZoomOut = useCallback(() => {
      if (currentZoom >= maxZoom) return;
      const nextZoom = Math.min(currentZoom + zoomStep, maxZoom);
      zoomTo(nextZoom);
    }, [currentZoom, maxZoom, zoomStep, zoomTo]);

    const handleZoomIn = useCallback(() => {
      if (currentZoom <= minZoom) return;
      const nextZoom = Math.max(currentZoom - zoomStep, minZoom);
      zoomTo(nextZoom);
    }, [currentZoom, minZoom, zoomStep, zoomTo]);

    const handleZoomSelect = useCallback(
      (zoom: number) => {
        zoomTo(Number(zoom));
      },
      [zoomTo]
    );

    const handleFitView = useCallback(() => {
      if (!graphInstance.current) return;
      graphInstance.current.fitView();
      const zoom = graphInstance.current.getZoom();
      if (zoom !== undefined && zoom !== null) {
        setCurrentZoom(zoom);
        onZoomChange?.(zoom);
      }
    }, [onZoomChange]);

    // Handle search
    const handleKeywordChange = useCallback(
      (value: string) => {
        setKeywordValue(value);
        onKeywordChange?.(value);
      },
      [onKeywordChange]
    );

    // Initialize G6 library
    useEffect(() => {
      const initG6 = async () => {
        await loadLib("g6");
        setIsReady(true);
      };
      initG6();
    }, []);

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        if (graphInstance.current) {
          graphInstance.current.destroy();
          graphInstance.current = null;
        }
      };
    }, []);

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      fitView: handleFitView,
      zoomTo,
      getGraph: () => graphInstance.current,
      render: renderGraph,
      setGraphData: async (data: GraphData) => {
        // Ensure G6 is loaded
        if (!isReady) {
          await loadLib("g6");
          setIsReady(true);
        }
        setInternalEntities(data.entities || []);
        setInternalRelations(data.relations || []);
      },
    }));

    // Render graph when data changes
    useEffect(() => {
      if (isReady) {
        renderGraph();
      }
    }, [isReady, renderGraph]);

    // Zoom dropdown menu items
    const zoomMenuItems: MenuProps["items"] = zoomRange.map((zoom) => ({
      key: String(zoom),
      label: `${Math.floor(zoom * 100)}%`,
    }));

    return (
      <div className="relative w-full h-full overflow-hidden bg-[#F5F6FA]">
        <div ref={graphContainer} className="w-full h-full" />

        {/* Bottom controls */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-3">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-white shadow">
            {isSupportSearch && (
              <>
                <Search
                  mode="expanded"
                  value={keywordValue}
                  disabled={loading}
                  placeholder="请输入实体名称"
                  className="search-input"
                  onInput={handleKeywordChange}
                  onDebouncedChange={(val) => onSearch?.(val)}
                />
                <div className="w-px h-[14px] bg-[#E6E8EB]" />
              </>
            )}

            <div
              className={`action-btn ${currentZoom >= maxZoom ? "action-btn-disabled" : ""}`}
              onClick={handleZoomIn}
            >
              <SvgIcon name="zoom-out" width={16} height={16} />
            </div>
            <Dropdown
              menu={{ items: zoomMenuItems, onClick: ({ key }) => handleZoomSelect(Number(key)) }}
              trigger={["click"]}
            >
              <div className="zoom-dropdown">{Math.floor(currentZoom * 100)}%</div>
            </Dropdown>
            <div
              className={`action-btn ${currentZoom <= minZoom ? "action-btn-disabled" : ""}`}
              onClick={handleZoomOut}
            >
              <SvgIcon name="zoom-in" width={16} height={16} />
            </div>

            <Tooltip title="自适应" placement="top">
              <div className="action-btn" onClick={handleFitView}>
                <SvgIcon name="screenshot-one" width={16} height={16} />
              </div>
            </Tooltip>
          </div>
        </div>

        {/* Empty state */}
        {empty && (
          <div className="absolute inset-0 z-10 bg-[#F5F6FA] flex flex-col items-center justify-center">
            <img
              src={getPublicPath("/images/library/graph_empty.png")}
              alt=""
              className="w-[480px]"
            />
            <p className="text-base text-[#1D1E1F] mt-6 mb-2">{emptyTitle}</p>
            <p className="text-sm text-[#9A9A9A]">{emptyDescription}</p>
          </div>
        )}
      </div>
    );
  }
);

GraphViewerWidget.displayName = "GraphViewerWidget";

export default GraphViewerWidget;
