import React, {
  useState,
  useEffect,
  useCallback,
  lazy,
  Suspense,
  useMemo,
  useContext,
} from "react";
import { Button, Spin } from "antd";
import { useSearchParams } from "react-router-dom";
import { useLibraryStore } from "@/stores/modules/library";
import { spacesApi } from "@/api/modules/spaces";
import { LibraryHeader } from "../../components/header";
import PermissionSetting from "../components/permission-setting";
import FileShare from "./components/share";
import FileFav from "./components/fav";
import FileMore from "./components/more";
import FileStatus from "../components/status/file";
import { SvgIcon, Tabs } from "@km/shared-components-react";
import {
  canEdit,
  getDisplayName,
  useInlineEdit,
} from "../../composables/useInlineEdit";
import { FileMetaLine } from "./components/file-meta";
import { CatalogRefContext } from "../index";

// Lazy load chunk views
const MetadataView = lazy(() => import("./chunks/metadata"));
const DocumentView = lazy(() => import("./chunks/view"));
const SliceView = lazy(() => import("./chunks/slice"));
const ChunksPipeline = lazy(() => import("./chunks/pipeline"));

// Menu items
const menuItems = [
  { icon: "file-code", label: "元数据", value: "metadata" },
  { icon: "notes", label: "文档解析", value: "view" },
  { icon: "paragraph-round", label: "语料切片", value: "slice" },
];

// Valid view values (for parsing the URL query)
const validViews = menuItems.map((item) => item.value);

/**
 * Chunks v2 view - main container for chunk views
 * 1:1 migration from chunks.v2.vue
 */
function ChunksV2View() {
  const [searchParams, setSearchParams] = useSearchParams();
  const catalogRef = useContext(CatalogRefContext);

  // Subscribe to store state correctly
  const files = useLibraryStore((state) => state.files);
  const currentFileId = useLibraryStore((state) => state.currentFileId);
  const currentFile = files.find((item) => item.id === currentFileId);

  const [showPermission, setShowPermission] = useState(false);
  const [showPipeline, setShowPipeline] = useState(false);
  const [pipelineRefreshKey, setPipelineRefreshKey] = useState(0);

  // Space knowledge-graph config: controls whether the "知识图谱" tab is shown.
  const spaceId = useLibraryStore((state) => state.space_id);
  const libraryId = useLibraryStore((state) => state.library_id);
  const [graphEnabled, setGraphEnabled] = useState(true);
  const [graphLibraryIds, setGraphLibraryIds] = useState<string[]>([]);
  const [graphConfigLoaded, setGraphConfigLoaded] = useState(false);

  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    spacesApi
      .getKnowledgeGraph(spaceId)
      .then((config) => {
        if (cancelled) return;
        setGraphEnabled(config.enable_knowledge_graph);
        setGraphLibraryIds(config.library_ids ?? []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setGraphConfigLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  const graphVisible = useMemo(() => {
    // Keep hidden until the space config arrives, then reveal only if allowed.
    if (!graphConfigLoaded) return false;
    return (
      graphEnabled &&
      (graphLibraryIds.length === 0 || graphLibraryIds.includes(libraryId))
    );
  }, [graphConfigLoaded, graphEnabled, graphLibraryIds, libraryId]);

  const visibleMenuItems = useMemo(
    () => menuItems.filter((item) => item.value !== "graph" || graphVisible),
    [graphVisible]
  );

  // The URL query is the single source of truth for the active view,
  // so switching tabs and refreshing always stay in sync.
  const viewParam = searchParams.get("view");
  const viewType =
    viewParam && validViews.includes(viewParam) ? viewParam : "metadata";

  // Switch view type by updating the URL query
  const handleSwitchView = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("view", value);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  // Fall back to metadata if the knowledge graph tab is not enabled
  useEffect(() => {
    if (viewType === "graph" && graphConfigLoaded && !graphVisible) {
      handleSwitchView("metadata");
    }
  }, [viewType, graphConfigLoaded, graphVisible, handleSwitchView]);

  const {
    handleClick: handleInlineClick,
    handleBlur: handleInlineBlur,
    handleKeydown: handleInlineKeydown,
    handlePaste: handleInlinePaste,
  } = useInlineEdit();

  // Handle toggle pipeline
  const handleTogglePipeline = () => {
    setShowPipeline((prev) => !prev);
  };

  // Handle slice status change
  const handleSliceStatusChange = useCallback(() => {
    setPipelineRefreshKey((prev) => prev + 1);
  }, []);

  // Shared "查看" trigger for the pipeline panel
  const pipelineTrigger = (
    <Button type="link" className="px-0" onClick={handleTogglePipeline}>
      查看
    </Button>
  );

  // Shared inline-edit options for the title element
  const inlineEditOptions = useMemo(() => {
    if (!currentFile) return null;
    return {
      file: {
        id: currentFile.id,
        name: currentFile.name,
        base_path: currentFile.base_path || "",
        isfile: true,
        file_ext: currentFile.file_ext,
      },
      isFile: true,
      permission: currentFile.permission,
    };
  }, [currentFile]);

  const handleClickTitle = (e: React.MouseEvent<HTMLElement>) => {
    if (inlineEditOptions) handleInlineClick(e, inlineEditOptions);
  };

  const handleBlurTitle = (e: React.FocusEvent<HTMLElement>) => {
    if (inlineEditOptions) handleInlineBlur(e, inlineEditOptions);
  };

  // Render current view component
  const renderView = () => {
    // Never render the graph view unless it is confirmed to be enabled
    const view =
      viewType === "graph" && !graphVisible ? "metadata" : viewType;
    switch (view) {
      case "view":
        return <DocumentView />;
      case "slice":
        return <SliceView onStatusChange={handleSliceStatusChange} />;

      default:
        return <MetadataView />;
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden relative">
      <LibraryHeader
        footer={
          currentFile ? (
            <>
              <FileShare fileId={currentFile.id} fileName={currentFile.name} />
              <FileFav />
              <FileMore
                mode="chunk"
                catalogRef={catalogRef?.current}
                onPermission={() => setShowPermission(true)}
              />
            </>
          ) : null
        }
      >
        {currentFile && (
          <div className="flex-1 flex items-center gap-2 overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <h3
                className={`py-0.5 text-base text-[#1D1E1F] truncate ${canEdit(currentFile.permission) ? "inline-editable" : ""}`}
                title={currentFile.name}
                onClick={handleClickTitle}
                onBlur={handleBlurTitle}
                onKeyDown={handleInlineKeydown}
                onPaste={handleInlinePaste}
              >
                {getDisplayName(currentFile.name, true, currentFile.file_ext)}
              </h3>

              <FileMetaLine file={currentFile} />
            </div>
          </div>
        )}
      </LibraryHeader>

      <div className="flex-1 overflow-hidden flex">
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* View Type Tabs */}
          <div className="flex-none px-5 py-2 border-b flex items-center justify-between">
            <Tabs
              variant="segmented"
              items={visibleMenuItems.map((item) => ({
                key: item.value,
                label: (
                  <span className="flex items-center gap-1">
                    <SvgIcon name={item.icon} size={16} />
                    {item.label}
                  </span>
                ),
              }))}
              activeKey={viewType}
              onChange={handleSwitchView}
            />

            {/* File Status */}
            <div className="flex items-center gap-2">
              <FileStatus
                status={currentFile?.cleaning_info?.status}
                stepKey={currentFile?.cleaning_info?.step_key}
                stepMode={currentFile?.cleaning_info?.step_mode}
                afterSlot={pipelineTrigger}
              >
                <div className="flex-none h-8 flex items-center gap-2 rounded px-2.5 bg-[#EBFFF4] text-[#07C160]">
                  <div className="flex-none size-4 flex items-center justify-center">
                    <SvgIcon name="check-one" size={16} />
                  </div>
                  <span className="text-sm">已完成</span>
                  {pipelineTrigger}
                </div>
              </FileStatus>
            </div>
          </div>

          {/* View Content */}
          <Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center">
                <Spin size="large" />
              </div>
            }
          >
            {renderView()}
          </Suspense>
        </div>

        {/* Pipeline Panel */}
        {showPipeline && currentFile && (
          <Suspense
            fallback={
              <div className="w-[420px] flex-none border-l flex items-center justify-center">
                <Spin size="large" />
              </div>
            }
          >
            <ChunksPipeline
              fileId={currentFile.id}
              cleaningInfo={currentFile.cleaning_info}
              permission={currentFile.permission}
              refreshKey={pipelineRefreshKey}
              onClose={() => setShowPipeline(false)}
            />
          </Suspense>
        )}

        {/* Permission Panel */}
        {showPermission && (
          <PermissionSetting
            className="w-[320px] flex-none border-l"
            onClose={() => setShowPermission(false)}
          />
        )}
      </div>
    </div>
  );
}

export default ChunksV2View;
