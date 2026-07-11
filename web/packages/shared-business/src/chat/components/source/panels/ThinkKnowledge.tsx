// packages/shared-business/src/chat/components/source/panels/ThinkKnowledge.tsx

import {
  useState,
  useImperativeHandle,
  forwardRef,
  useRef,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import { CloseOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import { useTranslation } from "../../../i18n";

export interface SearchResultItem {
  file_id?: string;
  file_name?: string;
  file_icon?: string;
  file_path?: string;
  content?: string;
  library_id?: string;
  library_name?: string;
  library_icon?: string;
  space_name?: string;
  created_at?: string;
  chunk_type?: string;
  graph?: {
    entities?: any[];
    relations?: any[];
  };
  chunk_id?: string;
}

interface DrawerComponentProps {
  onClose?: () => void;
}

interface KnowledgeViewDrawerRef {
  open: (params: { file_id: string }) => void;
  close?: () => void;
}

interface KnowledgeGraphDrawerRef {
  open: (params: { graph: any }) => void;
  close?: () => void;
}

export interface ThinkKnowledgeProps {
  onClose?: () => void;
  onItemClick?: (item: SearchResultItem, index: number) => void;
  /** slots - 传递特定平台的 Drawer 组件 */
  slots?: {
    KnowledgeViewDrawer?: React.ComponentType<DrawerComponentProps & { ref?: React.Ref<KnowledgeViewDrawerRef> }>;
    KnowledgeGraphDrawer?: React.ComponentType<DrawerComponentProps & { ref?: React.Ref<KnowledgeGraphDrawerRef> }>;
  };
  /** adapter - 获取静态资源路径 */
  getPublicPath?: (path: string) => string;
}

export interface ThinkKnowledgeRef {
  updateResults: (results: SearchResultItem[]) => void;
  selectItem: (libraryInfo: SearchResultItem) => void;
}

const isGraphSearch = (chunkType?: string) => chunkType === "graph_result";
const isRagSearch = (chunkType?: string) =>
  !["web_search", "web_page"].includes(chunkType || "");

export const ThinkKnowledge = forwardRef<
  ThinkKnowledgeRef,
  ThinkKnowledgeProps
>(({ onClose, onItemClick, slots, getPublicPath }, ref) => {
  const { t } = useTranslation();
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // 同步 searchResults 到 ref，供 imperative handle 同步读取最新值
  const searchResultsRef = useRef<SearchResultItem[]>(searchResults);
  useEffect(() => {
    searchResultsRef.current = searchResults;
  }, [searchResults]);

  // Drawer refs - 使用 slot 组件
  const knowledgeViewDrawerRef = useRef<KnowledgeViewDrawerRef>(null);
  const knowledgeGraphDrawerRef = useRef<KnowledgeGraphDrawerRef>(null);

  const KnowledgeViewDrawer = slots?.KnowledgeViewDrawer;
  const KnowledgeGraphDrawer = slots?.KnowledgeGraphDrawer;

  const handleClose = useCallback(() => {
    setSelectedIndex(-1);
    onClose?.();
  }, [onClose]);

  const onViewDrawer = useCallback(() => {
    setSelectedIndex(-1);
  }, []);

  const handleItemClick = useCallback(
    (item: SearchResultItem, index: number) => {
      if (isGraphSearch(item.chunk_type)) {
        knowledgeViewDrawerRef.current?.close?.();
        knowledgeGraphDrawerRef.current?.open({ graph: item.graph });
      } else if (isRagSearch(item.chunk_type)) {
        knowledgeGraphDrawerRef.current?.close?.();
        knowledgeViewDrawerRef.current?.open({ file_id: item.file_id! });
      } else {
        window.open(item.file_path, "_blank");
      }
      setSelectedIndex(index);
      onItemClick?.(item, index);
    },
    [onItemClick],
  );

  useImperativeHandle(
    ref,
    () => ({
      updateResults: (results: SearchResultItem[]) => {
        setSearchResults(results);
        setSelectedIndex(-1);
      },
      selectItem: (libraryInfo: SearchResultItem) => {
        if (!libraryInfo) return;
        // 同步从 ref 读取最新 searchResults，避免 setTimeout(0) stale-closure
        const latestResults = searchResultsRef.current;

        // 先检查是否是 graph_result 类型
        const graphIndex = latestResults.findIndex(
          (item: SearchResultItem) =>
            item.chunk_type === "graph_result" &&
            item.graph &&
            libraryInfo.graph &&
            (item.chunk_id === libraryInfo.chunk_id ||
              JSON.stringify(item.graph?.entities) ===
                JSON.stringify(libraryInfo.graph?.entities)),
        );
        if (graphIndex !== -1) {
          setSelectedIndex(graphIndex);
          handleItemClick(latestResults[graphIndex], graphIndex);
          return;
        }
        // 对于普通 source，通过 chunk_id 或 file_id 查找
        const sourceIndex = latestResults.findIndex(
          (item: SearchResultItem) =>
            (libraryInfo.chunk_id && item.chunk_id === libraryInfo.chunk_id) ||
            (libraryInfo.file_id && item.file_id === libraryInfo.file_id),
        );
        if (sourceIndex !== -1) {
          setSelectedIndex(sourceIndex);
          handleItemClick(latestResults[sourceIndex], sourceIndex);
        }
      },
    }),
    [handleItemClick],
  );

  // 提取图谱结果
  const graphResults = useMemo(() => {
    return searchResults.filter((item) => item.chunk_type === "graph_result");
  }, [searchResults]);

  // 计算图谱统计
  const graphStats = useMemo(() => {
    let entityCount = 0;
    let relationCount = 0;
    const entityIds = new Set<string>();

    graphResults.forEach((item) => {
      const entities = item.graph?.entities || [];
      const relations = item.graph?.relations || [];
      // 统计实体（去重）
      entities.forEach((e: any) => {
        if (e.id) entityIds.add(e.id);
      });
      relationCount += relations.length;
    });
    entityCount = entityIds.size;

    return { entityCount, relationCount };
  }, [graphResults]);

  // 默认的 getPublicPath 函数
  const getAssetPath = useCallback(
    (path: string) => {
      if (getPublicPath) {
        return getPublicPath(path);
      }
      // 默认返回相对路径
      return path;
    },
    [getPublicPath],
  );

  return (
    <div className="h-full bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-5">
        <h2 className="text-base font-semibold text-[#1D1E1F]">
          {t("source.knowledge_search_data")}
        </h2>
        <button
          onClick={handleClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <CloseOutlined />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4">
        {/* Empty state */}
        {searchResults.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <svg
              className="w-16 h-16 mb-4 text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              ></path>
            </svg>
            <p className="text-lg font-medium mb-2">
              {t("source.no_search_results")}
            </p>
          </div>
        )}

        {/* Search results list */}
        {searchResults.length > 0 && (
          <div className="space-y-4">
            {/* 知识图谱 - 从 graph_result 提取 */}
            {graphResults.length > 0 &&
              (() => {
                const graphIndex = searchResults.findIndex(
                  (item) => item === graphResults[0],
                );
                const isSelected = graphIndex === selectedIndex;
                return (
                  <div
                    className={`h-[220px] px-4 py-3 rounded flex flex-col cursor-pointer ${
                      isSelected
                        ? "bg-[#DCE6FF]"
                        : "bg-[#F8F8F8] hover:bg-[#DCE6FF]"
                    }`}
                    onClick={() => {
                      if (graphIndex !== -1) {
                        handleItemClick(graphResults[0], graphIndex);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="size-5 rounded flex items-center justify-center bg-[#145CF7] text-white">
                        <SvgIcon name="six-points" />
                      </div>
                      <span
                        className={`text-sm ${isSelected ? "text-[#2563EB]" : "text-[#1D1E1F]"}`}
                      >
                        {t("source.knowledge_graph")}
                      </span>
                    </div>
                    <div className="flex-1 flex-center">
                      <img
                        className="w-[220px]"
                        src={getAssetPath("/images/chat/graph_placeholder.png")}
                        alt={t("source.knowledge_graph")}
                      />
                    </div>
                    <div className="flex items-center text-xs text-[#999999]">
                      {t("source.entity_relation")}：{graphStats.relationCount}{" "}
                      {t("source.associated_corpus")}：{graphStats.entityCount}
                    </div>
                  </div>
                );
              })()}
            {searchResults
              .filter((item) => item.chunk_type !== "graph_result")
              .map((item, index) => {
                // 计算原始索引
                const originalIndex = searchResults.indexOf(item);
                return (
                  <div
                    key={originalIndex}
                    className={` rounded-lg p-3 hover:bg-[#DCE6FF] cursor-pointer group ${originalIndex === selectedIndex ? "bg-[#DCE6FF]" : "bg-[#F8F8F8]"}`}
                    onClick={() => handleItemClick(item, originalIndex)}
                  >
                    {isRagSearch(item.chunk_type) ? (
                      <>
                        <div className="flex items-start gap-2">
                          <div className="flex-shrink-0">
                            <img
                              className="size-5"
                              src={item.file_icon}
                              alt=""
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3
                              className={`text-sm font-medium truncate ${originalIndex === selectedIndex ? "text-[#2563EB]" : "text-[#1D1E1F]"}`}
                            >
                              {item.file_name}
                            </h3>
                          </div>
                        </div>
                        {item.content && (
                          <p className="text-sm text-[#4F5052] mt-2 line-clamp-2">
                            {item.content}
                          </p>
                        )}
                        <div className="flex items-center justify-between text-xs text-[#999999] mt-2">
                          <span>
                            {item.space_name && `${item.space_name}/`}
                            {item.library_name}
                          </span>
                          {item.created_at && <span>{item.created_at}</span>}
                        </div>
                      </>
                    ) : (
                      <>
                        <h3 className="text-sm font-medium truncate text-[#2563EB]">
                          {index + 1}. {item.file_name || item.chunk_type}
                        </h3>
                        {item.library_icon && (
                          <div className="flex items-center gap-2 mt-2">
                            <div className="flex-shrink-0">
                              <img
                                className="size-4"
                                src={item.library_icon}
                                alt=""
                              />
                            </div>
                            <div className="flex-1 min-w-0 text-xs text-[#1D1E1F]">
                              {item.library_name}
                            </div>
                          </div>
                        )}
                        {item.file_name && item.content && (
                          <p className="text-sm text-[#4F5052] mt-2 line-clamp-2">
                            {item.content}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Drawer components - 通过 slots 传递 */}
      {KnowledgeViewDrawer && (
        <KnowledgeViewDrawer
          ref={knowledgeViewDrawerRef as any}
          onClose={onViewDrawer}
        />
      )}
      {KnowledgeGraphDrawer && (
        <KnowledgeGraphDrawer
          ref={knowledgeGraphDrawerRef as any}
          onClose={onViewDrawer}
        />
      )}
    </div>
  );
});

ThinkKnowledge.displayName = "ThinkKnowledge";

export default ThinkKnowledge;
