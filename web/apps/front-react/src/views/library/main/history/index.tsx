import {
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useRef,
} from "react";
import {
  Drawer,
  Button,
  Checkbox,
  Tag,
  Empty,
  Spin,
  message,
  Modal,
} from "antd";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { useLibraryStore } from "@/stores/modules/library";
import { t } from "@/locales";
import {
  fileBodiesApi,
  HistoryItem,
  VersionItem,
} from "@/api/modules/file-bodies";
import { debounce, getSimpleDateFormatString } from "@km/shared-utils";
import { LibraryHeader } from "@/views/library/components/header";
import { ChunkView } from "@/components/Markdown";
import { getPublicPath } from "@/utils/config";
import { UIDialog, UIDialogRef } from "@/components/UI/Dialog";

const HISTORY_VIEW = {
  ALL: "all",
  VERSION: "version",
} as const;

type HistoryViewType = (typeof HISTORY_VIEW)[keyof typeof HISTORY_VIEW];

export interface HistoryDrawerRef {
  open: () => Promise<void>;
}

interface HistoryDrawerProps {
  onRestore?: (content: string) => void;
}

export const HistoryDrawer = forwardRef<HistoryDrawerRef, HistoryDrawerProps>(
  ({ onRestore }, ref) => {
    const libraryStore = useLibraryStore();
    const dialogRef = useRef<UIDialogRef>(null);
    const pendingVersionActionRef = useRef<{
      type: "create" | "edit";
      item?: VersionItem;
    } | null>(null);

    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(true);
    const [showPublished, setShowPublished] = useState(false);
    const [currentHistory, setCurrentHistory] = useState<HistoryItem | null>(
      null,
    );
    const [historyView, setHistoryView] = useState<HistoryViewType>(
      HISTORY_VIEW.ALL,
    );
    const [historyList, setHistoryList] = useState<HistoryItem[]>([]);
    const [versionList, setVersionList] = useState<VersionItem[]>([]);
    const [previewContent, setPreviewContent] = useState("");

    // View options
    const viewOptions = [
      { value: HISTORY_VIEW.ALL, label: "history.all_record" },
      { value: HISTORY_VIEW.VERSION, label: "history.version" },
    ];

    // Current version
    const currentVersion =
      versionList.find((item) => item.file_body_id === currentHistory?.id)
        ?.version || "";

    // Check if item is published
    const isPublished = (item: HistoryItem): boolean => {
      return !!versionList.find((v) => v.file_body_id === item.id);
    };

    // Filtered history list
    const showHistoryList = historyList.filter((item) => {
      if (showPublished) {
        return isPublished(item);
      }
      return true;
    });

    // Load preview content with debounce
    const loadPreviewContent = useCallback(
      debounce((id: string) => {
        const currentFile = libraryStore.currentFile();
        fileBodiesApi.versions
          .preview(id, currentFile?.name || "")
          .then((res) => {
            setPreviewContent(res);
          });
      }, 300),
      [],
    );

    // Handle select history
    const handleSelectHistory = (item: HistoryItem) => {
      setCurrentHistory(item);
      setPreviewContent("");
      loadPreviewContent(item.id);
    };

    // Handle select version
    const handleSelectVersion = (item: VersionItem) => {
      setCurrentHistory(item?.file_body || null);
      setPreviewContent("");
      loadPreviewContent(item.file_body_id);
    };

    // Handle history view change
    const handleHistoryView = (view: HistoryViewType) => {
      if (historyView === view) return;

      setHistoryView(view);

      if (view === HISTORY_VIEW.ALL && historyList.length > 0) {
        handleSelectHistory(historyList[0]);
      } else if (view === HISTORY_VIEW.VERSION && versionList.length > 0) {
        handleSelectVersion(versionList[0]);
      }
    };

    // Handle close
    const handleClose = () => {
      setVisible(false);
    };

    // Handle restore
    const handleRestore = () => {
      onRestore?.(previewContent || "");
      handleClose();
    };

    // Load history
    const loadHistory = async () => {
      const fileId = libraryStore.currentFile()?.id;
      if (!fileId) return;

      try {
        const res = await fileBodiesApi.history(fileId, {
          offset: 0,
          limit: 1000,
        });
        setHistoryList(res);
        if (res.length > 0) {
          handleSelectHistory(res[0]);
        }
      } catch (error) {
        console.error("加载历史记录失败:", error);
      }
    };

    // Load versions
    const loadVersion = async () => {
      const fileId = libraryStore.currentFile()?.id;
      if (!fileId) return;

      try {
        const res = await fileBodiesApi.versions.list(fileId, {
          offset: 0,
          limit: 1000,
        });
        setVersionList(res);
      } catch (error) {
        console.error("加载版本数据失败:", error);
      }
    };

    // Handle open version
    const handleOpenVersion = () => {
      if (!currentHistory?.id) return;
      pendingVersionActionRef.current = { type: "create" };
      dialogRef.current?.open({
        title: t("history.save_version_title"),
        label: t("history.save_version_label"),
        content: "",
      });
    };

    // Handle edit version
    const handleEditVersion = (item: VersionItem) => {
      pendingVersionActionRef.current = { type: "edit", item };
      dialogRef.current?.open({
        title: t("history.edit_version_title"),
        label: t("history.save_version_label"),
        content: item.version,
      });
    };

    // Handle dialog confirm
    const handleDialogConfirm = async (data: { content: string }) => {
      const action = pendingVersionActionRef.current;
      if (!action) return;

      try {
        if (action.type === "create") {
          await fileBodiesApi.versions.create(currentHistory!.id, {
            version: data.content,
          });
          await loadVersion();
        } else if (action.type === "edit" && action.item) {
          await fileBodiesApi.versions.update(action.item.id, {
            version: data.content,
          });
          setVersionList(
            versionList.map((v) =>
              v.id === action.item!.id ? { ...v, version: data.content } : v,
            ),
          );
        }
        message.success(t("status.success"));
      } catch (error) {
        console.error("版本操作失败:", error);
      } finally {
        pendingVersionActionRef.current = null;
      }
    };

    // Handle delete version
    async function handleDeleteVersion(item: VersionItem) {
      Modal.confirm({
        title: t("common.tip"),
        content: t("history.delete_version_confirm"),
        okText: t("action.confirm"),
        cancelText: t("action.cancel"),
        onOk: async () => {
          await fileBodiesApi.versions.delete(item.id);
          setVersionList(versionList.filter((v) => v.id !== item.id));

          if (currentHistory?.id === item.file_body_id) {
            setCurrentHistory(null);
          }
          message.success(t("status.success"));
        },
      });
    }

    // Version actions - 定义在函数之后
    const versionActions = [
      {
        type: "edit",
        icon: <EditOutlined />,
        handler: handleEditVersion,
      },
      {
        type: "delete",
        icon: <DeleteOutlined />,
        handler: handleDeleteVersion,
      },
    ];

    // Open drawer
    const open = async () => {
      setVisible(true);
      setLoading(true);

      try {
        await Promise.all([loadHistory(), loadVersion()]);
      } finally {
        setLoading(false);
      }
    };

    useImperativeHandle(ref, () => ({
      open,
    }));

    return (
      <Drawer
        open={visible}
        onClose={handleClose}
        title={null}
        styles={{ wrapper: { width: "100%" }, body: { padding: 0 } }}
        closable={false}
        className="history-drawer"
      >
        <Spin
          spinning={loading}
          classNames={{
            root: "h-full",
            container: "h-full flex flex-col  overflow-hidden",
          }}
        >
          {/* Header */}
          <LibraryHeader showBack backProxy={handleClose}>
            <h3 className="text-base text-[#1D1E1F]">{t("history.title")}</h3>
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              {historyView === "all" && (
                <>
                  {currentVersion && (
                    <p className="text-sm text-[#999999] mr-2">
                      {t("history.saved_version_tip", {
                        version: currentVersion,
                      })}
                    </p>
                  )}
                  {!currentVersion && currentHistory && (
                    <Button onClick={handleOpenVersion}>
                      {t("history.save_version")}
                    </Button>
                  )}
                </>
              )}
              <Button
                type="primary"
                disabled={!currentHistory}
                onClick={debounce(handleRestore, 300)}
              >
                {historyView === "version"
                  ? t("history.restore_version")
                  : t("history.restore_record")}
              </Button>
            </div>
          </LibraryHeader>

          {/* Main Content */}
          <div className="flex-1 overflow-hidden flex">
            {/* Preview Area */}
            <div className="flex-1 overflow-hidden" key={currentHistory?.id}>
              <ChunkView
                content={previewContent}
                showDisplayMode={false}
                outlinePosition="relative"
              />
            </div>

            {/* History List */}
            <div className="flex-none w-[320px] h-full bg-white border-l flex flex-col">
              {/* Title Bar */}
              <div className="h-14 px-4 flex items-center justify-between border-b">
                <h3 className="text-base text-[#1D1E1F]">
                  {t("history.title")}
                </h3>
              </div>

              {/* View Tabs */}
              <div className="h-14 px-4 flex items-center border-b">
                {viewOptions.map((view) => (
                  <div
                    key={view.value}
                    className={`flex-1 h-14 cursor-pointer flex items-center justify-center text-sm hover:text-[#2563EB] border-b-2 ${historyView === view.value ? "border-[#2563EB] text-[#2563EB]" : "border-transparent text-[#4F5052]"}`}
                    onClick={() => handleHistoryView(view.value)}
                  >
                    {t(view.label)}
                  </div>
                ))}
              </div>

              {/* Filter Checkbox */}
              {historyView === "all" && (
                <label className="h-12 px-4 flex items-center gap-2 text-sm text-[#4F5052]">
                  <Checkbox
                    checked={showPublished}
                    onChange={(e) => setShowPublished(e.target.checked)}
                  />
                  <span>{t("history.only_show_published")}</span>
                </label>
              )}

              {/* History List */}
              {historyView === "all" && (
                <div className="flex-1 overflow-y-auto">
                  {showHistoryList.map((item) => (
                    <div
                      key={item.id}
                      className={`h-16 px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-[#F4F5F7] ${currentHistory?.id === item.id ? "bg-[#F4F5F7]" : ""}`}
                      onClick={() => handleSelectHistory(item)}
                    >
                      <div className="flex-1">
                        <div className="text-sm text-[#1D1E1F] font-semibold">
                          {getSimpleDateFormatString({ date: item.created_time })}
                        </div>
                        <p className="text-xs text-[#999999] mt-1">
                          {item.user?.nickname || "--"}
                        </p>
                      </div>
                      {isPublished(item) && (
                        <Tag type="default">{t("history.published")}</Tag>
                      )}
                    </div>
                  ))}
                  {historyList.length === 0 && (
                    <div className="flex-center">
                      <Empty
                        image={getPublicPath("/images/empty.png")}
                        description={t("history.empty_record")}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Version List */}
              {historyView === "version" && (
                <div className="flex-1 overflow-y-auto">
                  {versionList.map((item) => (
                    <div
                      key={item.id}
                      className={`h-[88px] px-4 py-3 cursor-pointer hover:bg-[#F4F5F7] group ${currentHistory?.id === item.file_body_id ? "bg-[#F4F5F7]" : ""}`}
                      onClick={() => handleSelectVersion(item)}
                    >
                      <div className="text-sm text-[#1D1E1F] font-semibold">
                        {item.version}
                      </div>
                      <p className="text-xs text-[#999999] mt-1">
                        {getSimpleDateFormatString({ date: item.created_time })}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 text-sm text-[#1D1E1F] text-opacity-60 truncate">
                          {item.file_body?.user?.nickname || "--"}
                        </div>
                        {/* Action buttons */}
                        {versionActions.map((action) => (
                          <div
                            key={action.type}
                            className="size-5 flex items-center justify-center cursor-pointer hover:bg-[#F4F5F7] rounded"
                            onClick={(e) => {
                              e.stopPropagation();
                              action.handler(item);
                            }}
                          >
                            <span className="size-5 cursor-pointer opacity-0 group-hover:opacity-100">
                              {action.icon}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {versionList.length === 0 && (
                    <div className="flex-center">
                      <Empty
                        image={getPublicPath("/images/empty.png")}
                        description={t("history.empty_version")}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </Spin>

        {/* Version Dialog */}
        <UIDialog ref={dialogRef} onConfirm={handleDialogConfirm} />
      </Drawer>
    );
  },
);

export default HistoryDrawer;
