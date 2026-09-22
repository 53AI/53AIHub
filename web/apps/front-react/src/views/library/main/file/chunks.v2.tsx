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
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useLibraryStore } from "@/stores/modules/library";
import { spacesApi } from "@/api/modules/spaces";
import { LibraryHeader } from "../../components/header";
import PermissionSetting from "../components/permission-setting";
import FileShare from "./components/share";
import FileFav from "./components/fav";
import FileMore from "./components/more";
import FileStatus from "../components/status/file";
import { SvgIcon } from "@km/shared-components-react";
import {
  canEdit,
  getDisplayName,
  useInlineEdit,
} from "../../composables/useInlineEdit";
import { t } from "@/locales";
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

/**
 * Chunks v2 view - main container for chunk views
 * 1:1 migration from chunks.v2.vue
 */
export function ChunksV2View() {
  const navigate = useNavigate();
  const { id, fid } = useParams<{ id: string; fid: string }>();
  const [searchParams] = useSearchParams();
  const catalogRef = useContext(CatalogRefContext);

  // Subscribe to store state correctly
  const files = useLibraryStore((state) => state.files);
  const currentFileId = useLibraryStore((state) => state.currentFileId);
  const loadFile = useLibraryStore((state) => state.loadFile);
  const currentFile = files.find((item) => item.id === currentFileId);

  const [viewType, setViewType] = useState("metadata");
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

  // Fall back to another view if the graph tab is no longer allowed
  useEffect(() => {
    if (viewType === "graph" && graphConfigLoaded && !graphVisible) {
      setViewType("metadata");
    }
  }, [viewType, graphConfigLoaded, graphVisible]);

  const {
    handleClick: handleInlineClick,
    handleBlur: handleInlineBlur,
    handleKeydown: handleInlineKeydown,
    handlePaste: handleInlinePaste,
  } = useInlineEdit();

  // Initialize view type from URL query
  useEffect(() => {
    const view = searchParams.get("view");
    if (view && ["metadata", "view", "slice", "graph"].includes(view)) {
      setViewType(view);
    }
  }, [searchParams]);

  // Handle toggle pipeline
  const handleTogglePipeline = () => {
    setShowPipeline(!showPipeline);
  };

  // Handle close pipeline
  const handleClosePipeline = () => {
    setShowPipeline(false);
  };

  // Handle slice status change
  const handleSliceStatusChange = useCallback(() => {
    setPipelineRefreshKey((prev) => prev + 1);
  }, []);

  // Inline edit handlers
  const handleClickTitle = (e: React.MouseEvent<HTMLElement>) => {
    if (!currentFile) return;
    handleInlineClick(e, {
      file: {
        id: currentFile.id,
        name: currentFile.name,
        base_path: currentFile.base_path || "",
        isfile: true,
        file_ext: currentFile.file_ext,
      },
      isFile: true,
      permission: currentFile.permission,
    });
  };

  const handleBlurTitle = (e: React.FocusEvent<HTMLElement>) => {
    if (!currentFile) return;
    handleInlineBlur(e, {
      file: {
        id: currentFile.id,
        name: currentFile.name,
        base_path: currentFile.base_path || "",
        isfile: true,
        file_ext: currentFile.file_ext,
      },
      isFile: true,
      permission: currentFile.permission,
    });
  };

  // Get display name
  const displayName = useMemo(() => {
    if (!currentFile) return "";
    return getDisplayName(currentFile.name, true, currentFile.file_ext);
  }, [currentFile]);

  // Render current view component
  const renderView = () => {
    switch (viewType) {
      case "metadata":
        return <MetadataView />;
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
                {displayName}
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
            <div className="flex items-center gap-0.5 p-1 rounded-xl bg-[#F7F7F9] w-fit">
              {visibleMenuItems.map((item) => (
                <div
                  key={item.value}
                  className={`h-8 px-4 rounded-lg flex items-center justify-center gap-1 cursor-pointer ${
                    item.value === viewType
                      ? "text-[#2563EB] bg-[#FFFFFF]"
                      : "text-[#999999]"
                  }`}
                  onClick={() => setViewType(item.value)}
                >
                  <SvgIcon name={item.icon} size={16} />
                  <div className="text-base">{item.label}</div>
                </div>
              ))}
            </div>

            {/* File Status */}
            <div className="flex items-center gap-2">
              <FileStatus
                status={currentFile?.cleaning_info?.status}
                stepKey={currentFile?.cleaning_info?.step_key}
                stepMode={currentFile?.cleaning_info?.step_mode}
                afterSlot={
                  <Button
                    type="link"
                    className="px-0"
                    onClick={handleTogglePipeline}
                  >
                    查看
                  </Button>
                }
              >
                <div className="flex-none h-8 flex items-center gap-2 rounded px-2.5 bg-[#EBFFF4] text-[#07C160]">
                  <div className="flex-none size-4 flex items-center justify-center">
                    <SvgIcon name="check-one" size={16} />
                  </div>
                  <span className="text-sm">已完成</span>
                  <Button
                    type="link"
                    className="px-0"
                    onClick={handleTogglePipeline}
                  >
                    查看
                  </Button>
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
              onClose={handleClosePipeline}
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
