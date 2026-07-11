// packages/shared-business/src/chat/components/source/popups/GraphViewerWidget.tsx

import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Input, Tooltip } from 'antd';
import { Dropdown, SvgIcon } from '@km/shared-components-react';
import { useTranslation } from '../../../i18n';
import type { GraphData, GraphEntity, GraphRelation } from '../../../types/message';

// Re-export types for convenience
export type { GraphData, GraphEntity, GraphRelation };

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;
const ZOOM_RANGE = [3, 1.5, 1, 0.5, 0.2];

const ENTITY_COLORS = [
  '#0EBB80', '#F49E0B', '#5C61FF', '#E74C3C', '#3498DB',
  '#9B59B6', '#1ABC9C', '#E67E22', '#2ECC71', '#34495E',
  '#16A085', '#27AE60', '#2980B9', '#8E44AD', '#2C3E50',
  '#F39C12', '#D35400', '#C0392B', '#BDC3C7', '#7F8C8D',
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F8B500', '#00CED1', '#FF69B4', '#32CD32', '#FFD700',
  '#FF4500', '#1E90FF', '#00FA9A', '#FF1493', '#00BFFF',
  '#ADFF2F', '#FF6347', '#40E0D0', '#EE82EE', '#F0E68C',
  '#ADD8E6', '#90EE90', '#FFB6C1', '#20B2AA', '#87CEEB',
  '#778899', '#B0C4DE', '#FFFFE0', '#00FF00', '#FF00FF',
  '#00FFFF', '#FF0000', '#0000FF', '#008000', '#800080',
];

export interface GraphViewerWidgetRef {
  setGraphData: (data: GraphData) => void;
  fitView: () => void;
  zoomTo: (zoom: number) => void;
}

export interface GraphViewerWidgetProps {
  /** 是否显示空状态 */
  empty?: boolean;
  /** 空状态标题 */
  emptyTitle?: string;
  /** 空状态描述 */
  emptyDescription?: string;
  /** 是否支持搜索 */
  isSupportSearch?: boolean;
  /** 加载 G6 库的函数 */
  loadG6?: () => Promise<void>;
  /** 获取静态资源路径的函数 */
  getStaticPath?: (path: string) => string;
}

const DEFAULT_GET_STATIC_PATH = (path: string) => path;

export const GraphViewerWidget = forwardRef<GraphViewerWidgetRef, GraphViewerWidgetProps>(
  (
    {
      empty = false,
      emptyTitle,
      emptyDescription,
      isSupportSearch = false,
      loadG6: loadG6Prop,
      getStaticPath = DEFAULT_GET_STATIC_PATH,
    },
    ref
  ) => {
    const { t } = useTranslation();
    const graphContainerRef = useRef<HTMLDivElement>(null);
    const graphInstanceRef = useRef<any>(null);
    const isReadyRef = useRef(false);

    const [currentZoom, setCurrentZoom] = useState(1);
    const [internalEntities, setInternalEntities] = useState<GraphEntity[]>([]);
    const [internalRelations, setInternalRelations] = useState<GraphRelation[]>([]);
    const [keyword, setKeyword] = useState('');

    const finalEmptyTitle = emptyTitle || t('graph.no_data') || '暂无图谱数据';
    const finalEmptyDescription = emptyDescription || t('graph.extract_first') || '请先对文档进行知识图谱抽取';

    const transformEntityDataToNodeData = useCallback((entities: GraphEntity[]) => {
      const typeColorMap = new Map<string, string>();
      const uniqueTypes = [...new Set(entities.map(e => e.type || t('graph.uncategorized') || '未分类'))];
      uniqueTypes.forEach((type, index) => {
        typeColorMap.set(type, ENTITY_COLORS[index % ENTITY_COLORS.length]);
      });

      return entities.map((entity) => {
        const entityType = entity.type || t('graph.uncategorized') || '未分类';
        const color = typeColorMap.get(entityType) || ENTITY_COLORS[0];
        const fillColor = color + '1A';
        const strokeColor = color + '4D';

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
            labelPlacement: 'center' as const,
            labelFontSize: 12,
            labelMaxWidth: 60,
            labelFontWeight: 500,
            labelTextOverflow: 'ellipsis',
            labelWordWrap: true,
            labelFill: color,
          },
          state: {
            active: { stroke: color, fill: color + '80', halo: false, lineWidth: 1.5 },
            selected: {
              halo: true, labelFill: '#FFF', fill: color, haloLineWidth: 12,
              stroke: color, haloStrokeOpacity: 1, haloStroke: color + '33',
            },
          },
        };
      });
    }, [t]);

    const transformRelationDataToEdgeData = useCallback((relations: GraphRelation[], entities: GraphEntity[]) => {
      return relations.map((relation) => {
        const sourceName = entities.find(e => e.id === relation.source_entity_id)?.name || '';
        const targetName = entities.find(e => e.id === relation.target_entity_id)?.name || '';

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
            stroke: '#C5CBD6',
            lineWidth: 1,
            lineDash: [5, 2],
            labelText: relation.predicate,
            labelMaxWidth: '30%',
            labelPadding: [3, 12, 3, 12],
            labelWordWrap: true,
            labelFontSize: 10,
            labelFontWeight: 400,
            labelFill: '#495366',
            labelTextOverflow: 'ellipsis',
            endArrow: true,
            endArrowType: 'triangle' as const,
            labelBackground: true,
            labelBackgroundLineWidth: 1,
            labelBackgroundRadius: 100,
            labelBackgroundStroke: '#C5CBD6',
            labelBackgroundFill: '#FFF',
            labelBackgroundOpacity: 1,
          },
          state: {
            active: {
              labelFontSize: 10, labelFontWeight: 400, labelFill: '#000',
              lineWidth: 1, halo: false, stroke: '#333AFF', labelBackgroundStroke: '#333AFF',
            },
            selected: {
              labelFontSize: 10, labelFontWeight: 500, labelFill: '#000',
              lineWidth: 1, halo: false, stroke: '#333AFF', labelBackgroundStroke: '#333AFF',
            },
          },
        };
      });
    }, []);

    const renderGraph = useCallback(async (entities: GraphEntity[], relations: GraphRelation[]) => {
      if (!isReadyRef.current || !graphContainerRef.current) return;

      const nodes = transformEntityDataToNodeData(entities);
      const edges = transformRelationDataToEdgeData(relations, entities);

      if (nodes.length === 0) {
        if (graphInstanceRef.current) {
          graphInstanceRef.current.destroy();
          graphInstanceRef.current = null;
        }
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 0));

      const bgImagePath = getStaticPath('/images/library/graph_bg.png');
      const bgImageUrl = bgImagePath.startsWith('http')
        ? bgImagePath
        : `${window.location.origin}${bgImagePath}`;

      if (!graphInstanceRef.current) {
        const graph = new (window as any).G6.Graph({
          container: graphContainerRef.current,
          width: graphContainerRef.current.clientWidth,
          height: graphContainerRef.current.clientHeight || 600,
          autoFit: 'center',
          autoResize: true,
          zoomRange: [MIN_ZOOM, MAX_ZOOM],
          data: { nodes, edges },
          layout: {
            type: 'd3-force',
            nodeSize: 80,
            link: { distance: 150 },
            manyBody: { strength: -30 },
            collide: { radius: 70, strength: 0.7 },
            center: { strength: 0.05 },
          },
          edge: { type: 'quadratic' },
          plugins: [{
            type: 'background',
            backgroundImage: `url(${bgImageUrl})`,
          }],
          behaviors: [
            'drag-canvas',
            'hover-activate',
            { type: 'drag-element-force', fixed: true },
            {
              type: 'zoom-canvas',
              onFinish: () => {
                if (graphInstanceRef.current) {
                  const zoom = graphInstanceRef.current.getZoom();
                  if (zoom !== undefined) setCurrentZoom(zoom);
                }
              },
            },
            {
              type: 'click-select',
              degree: 1,
              unselectedState: 'inactive',
            },
          ],
        });
        graph.render();
        graph.fitView();
        setCurrentZoom(1);
        graphInstanceRef.current = graph;
        return;
      }

      graphInstanceRef.current.setData({ nodes, edges });
      graphInstanceRef.current.render();
      graphInstanceRef.current.fitView();
      const zoom = graphInstanceRef.current.getZoom();
      setCurrentZoom(zoom || 1);
    }, [transformEntityDataToNodeData, transformRelationDataToEdgeData, getStaticPath]);

    const zoomTo = useCallback((zoom: number) => {
      if (!graphInstanceRef.current) return;
      graphInstanceRef.current.zoomTo(zoom);
      setCurrentZoom(zoom);
    }, []);

    const handleZoomOut = useCallback(() => {
      if (currentZoom >= MAX_ZOOM) return;
      zoomTo(Math.min(currentZoom + ZOOM_STEP, MAX_ZOOM));
    }, [currentZoom, zoomTo]);

    const handleZoomIn = useCallback(() => {
      if (currentZoom <= MIN_ZOOM) return;
      zoomTo(Math.max(currentZoom - ZOOM_STEP, MIN_ZOOM));
    }, [currentZoom, zoomTo]);

    const handleZoomSelect = useCallback((zoom: number) => {
      zoomTo(Number(zoom));
    }, [zoomTo]);

    const handleFitView = useCallback(() => {
      if (!graphInstanceRef.current) return;
      graphInstanceRef.current.fitView();
      const zoom = graphInstanceRef.current.getZoom();
      if (zoom !== undefined) setCurrentZoom(zoom);
    }, []);

    const loadG6Lib = useCallback(async () => {
      if (loadG6Prop) {
        await loadG6Prop();
      } else {
        // 默认加载方式：假设 G6 已通过 script 标签加载或动态导入
        if (!(window as any).G6) {
          console.warn('G6 library not found. Please provide loadG6 prop or ensure G6 is loaded globally.');
          return;
        }
      }
      isReadyRef.current = true;
    }, [loadG6Prop]);

    useImperativeHandle(ref, () => ({
      setGraphData: async (data: GraphData) => {
        if (!isReadyRef.current) {
          await loadG6Lib();
        }
        const entities = data.entities || [];
        const relations = data.relations || [];
        setInternalEntities(entities);
        setInternalRelations(relations);
        renderGraph(entities, relations);
      },
      fitView: handleFitView,
      zoomTo,
    }));

    useEffect(() => {
      const init = async () => {
        await loadG6Lib();
      };
      init();

      return () => {
        if (graphInstanceRef.current) {
          graphInstanceRef.current.destroy();
          graphInstanceRef.current = null;
        }
      };
    }, [loadG6Lib]);

    useEffect(() => {
      if (internalEntities.length > 0 && isReadyRef.current) {
        renderGraph(internalEntities, internalRelations);
      }
    }, [internalEntities, internalRelations, renderGraph]);

    const zoomMenuItems = ZOOM_RANGE.map(zoom => ({
      key: zoom.toString(),
      label: `${Math.floor(zoom * 100)}%`,
    }));

    const emptyImagePath = getStaticPath('/images/library/graph_empty.png');

    return (
      <div className="relative w-full h-full overflow-hidden bg-[#F5F6FA]">
        <div ref={graphContainerRef} className="w-full h-full" />

        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-3">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-white shadow">
            {isSupportSearch && (
              <Input
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                placeholder={t('graph.search_entity') || '请输入实体名称'}
                allowClear
                style={{ width: 210, boxShadow: 'none' }}
              />
            )}
            {isSupportSearch && <div className="w-px h-[14px] bg-[#E6E8EB]" />}

            <div
              className={`flex items-center justify-center size-8 cursor-pointer rounded transition-colors hover:bg-gray-100 ${currentZoom <= MIN_ZOOM ? 'opacity-40 cursor-not-allowed' : ''}`}
              onClick={handleZoomIn}
            >
              <SvgIcon name="zoom-out" size={16} />
            </div>
            <Dropdown menu={{ items: zoomMenuItems, onClick: ({ key }) => handleZoomSelect(parseFloat(key)) }}>
              <div className="min-w-[60px] px-2 py-1 text-center cursor-pointer rounded hover:bg-gray-100 transition-colors">
                {Math.floor(currentZoom * 100)}%
              </div>
            </Dropdown>
            <div
              className={`flex items-center justify-center size-8 cursor-pointer rounded transition-colors hover:bg-gray-100 ${currentZoom >= MAX_ZOOM ? 'opacity-40 cursor-not-allowed' : ''}`}
              onClick={handleZoomOut}
            >
              <SvgIcon name="zoom-in" size={16} />
            </div>

            <Tooltip title={t('graph.fit_view') || '自适应'}>
              <div className="flex items-center justify-center size-8 cursor-pointer rounded hover:bg-gray-100 transition-colors" onClick={handleFitView}>
                <SvgIcon name="screenshot-one" size={16} />
              </div>
            </Tooltip>
          </div>
        </div>

        {empty && (
          <div className="absolute inset-0 z-10 bg-[#F5F6FA] flex flex-col items-center justify-center">
            <img src={emptyImagePath} alt="" className="w-[480px]" />
            <p className="text-base text-[#1D1E1F] mt-6 mb-2">{finalEmptyTitle}</p>
            <p className="text-sm text-[#9A9A9A]">{finalEmptyDescription}</p>
          </div>
        )}
      </div>
    );
  },
);

GraphViewerWidget.displayName = 'GraphViewerWidget';

export default GraphViewerWidget;
