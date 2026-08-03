import {
  useState,
  useEffect,
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
  Input,
} from "antd";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import { wikiApi } from "@/api/modules/wiki";
import { EntityDisplay } from "@/components/EntityDisplay";
import type {
  WikiPageType,
  WikiPageVersion,
  WikiVersionsListParams,
} from "@/api/modules/wiki/types";
import { debounce } from "@km/shared-utils";
import { getPublicPath } from "@/utils/config";
import { WikiPagePreview } from "./WikiPagePreview";

const HISTORY_VIEW = {
  ALL: "all",
  VERSION: "version",
} as const;

type HistoryViewType = (typeof HISTORY_VIEW)[keyof typeof HISTORY_VIEW];

const DEFAULT_PAGE_SIZE = 100;

export interface KnowledgeHistoryDrawerRef {
  open: () => Promise<void>;
}

interface KnowledgeHistoryDrawerProps {
  /** 页面 hashid（对应后端 :page_id） */
  pageId: string;
  /** 用于"保存为版本"时更新页面内容 */
  pageType: WikiPageType;
  pageTitle: string;
  onRestore?: (content: string, version: WikiPageVersion) => void;
}

export const KnowledgeHistoryDrawer = forwardRef<
  KnowledgeHistoryDrawerRef,
  KnowledgeHistoryDrawerProps
>(({ pageId, pageType, pageTitle, onRestore }, ref) => {
  const [visible, setVisible] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [showPublished, setShowPublished] = useState(false);
  const [historyView, setHistoryView] = useState<HistoryViewType>(
    HISTORY_VIEW.ALL,
  );
  const [versionList, setVersionList] = useState<WikiPageVersion[]>([]);
  const [currentVersion, setCurrentVersion] =
    useState<WikiPageVersion | null>(null);
  const [previewDetail, setPreviewDetail] =
    useState<WikiPageVersion | null>(null);

  const previewTokenRef = useRef(0);

  const viewOptions = [
    { value: HISTORY_VIEW.ALL, label: "history.all_record" },
    { value: HISTORY_VIEW.VERSION, label: "history.version" },
  ];

  const currentVersionTag = currentVersion
    ? currentVersion.version_tag
    : "";

  const filteredHistory = showPublished
    ? versionList.filter((v) => v.is_published)
    : versionList;

  // Version list: only show items with version_tag in "version" view
  const filteredVersionList = versionList.filter((v) => v.version_tag);

  useEffect(() => {
    if (!visible || !pageId) return;
    let cancelled = false;
    setListLoading(true);

    const params: WikiVersionsListParams = {
      offset: 0,
      limit: DEFAULT_PAGE_SIZE,
    };
    if (historyView === HISTORY_VIEW.VERSION) params.is_published = true;

    wikiApi.versions
      .list(pageId, params)
      .then((list) => {
        if (cancelled) return;
        setVersionList(list);
        setCurrentVersion(list[0] ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("加载历史记录失败:", err);
        setVersionList([]);
        setCurrentVersion(null);
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, pageId, historyView]);

  useEffect(() => {
    if (!currentVersion || !pageId) return;
    const token = ++previewTokenRef.current;
    setBodyLoading(true);
    setPreviewDetail(null);
    wikiApi.versions
      .detail(pageId, currentVersion.version_no)
      .then((detail) => {
        if (token !== previewTokenRef.current) return;
        setPreviewDetail(detail);
      })
      .catch((err) => {
        if (token !== previewTokenRef.current) return;
        console.error("加载版本正文失败:", err);
        // 详情失败时退回到列表项数据，保证至少能展示基础字段
        setPreviewDetail(currentVersion);
      })
      .finally(() => {
        if (token === previewTokenRef.current) setBodyLoading(false);
      });
  }, [currentVersion, pageId]);

  const handleSelectVersion = (version: WikiPageVersion) => {
    setCurrentVersion(version);
  };

  const handleHistoryView = (view: HistoryViewType) => {
    if (historyView === view) return;
    setHistoryView(view);
  };

  const handleClose = () => {
    setVisible(false);
  };

  const handleRestore = () => {
    if (!currentVersion || !previewDetail) return;
    onRestore?.(previewDetail.body ?? "", currentVersion);
    setVisible(false);
  };

  const handleOpenSaveVersion = () => {
    if (!currentVersion) return;
    openVersionTagModal({
      titleKey: "history.save_version_title",
      placeholderKey: "history.save_version_label",
      inputId: "save-version-input",
      initialValue: "",
      allowEmpty: false,
      errorPrefix: "保存版本",
    });
  };

  const handlePublishVersion = () => {
    if (!currentVersion) return;
    openVersionTagModal({
      titleKey: "history.publish_version_title",
      placeholderKey: "history.publish_version_label",
      inputId: "publish-version-input",
      initialValue: currentVersion.version_tag,
      allowEmpty: true,
      errorPrefix: "发布版本",
    });
  };

  const openVersionTagModal = ({
    titleKey,
    placeholderKey,
    inputId,
    initialValue,
    allowEmpty,
    errorPrefix,
  }: {
    titleKey: string;
    placeholderKey: string;
    inputId: string;
    initialValue: string;
    allowEmpty: boolean;
    errorPrefix: string;
  }) => {
    const versionNo = currentVersion!.version_no;
    Modal.confirm({
      title: t(titleKey),
      content: (
        <Input
          id={inputId}
          placeholder={t(placeholderKey)}
          defaultValue={initialValue}
        />
      ),
      okText: t("action.confirm"),
      cancelText: t("action.cancel"),
      onOk: async () => {
        const input = document.getElementById(inputId) as HTMLInputElement;
        const versionTag = input?.value?.trim() || (allowEmpty ? undefined : "");
        if (!allowEmpty && !versionTag) {
          message.error(t("history.version_tag_required"));
          return;
        }
        try {
          await wikiApi.versions.publish(pageId, versionNo, {
            version_tag: versionTag,
          });
          message.success(t("status.success"));
          // Optimistic update
          const updatedVersion: WikiPageVersion = {
            ...currentVersion!,
            version_no: versionNo,
            version_tag: versionTag ?? "",
          };
          setVersionList(
            versionList.map((v) =>
              v.version_no === versionNo ? updatedVersion : v,
            ),
          );
          setCurrentVersion(updatedVersion);
        } catch (error) {
          console.error(`${errorPrefix}失败:`, error);
        }
      },
    });
  };

  const handleEditVersionTag = (item: WikiPageVersion) => {
    Modal.confirm({
      title: t("history.edit_version_title"),
      content: (
        <Input
          id="edit-version-tag-input"
          placeholder={t("history.save_version_label")}
          defaultValue={item.version_tag}
        />
      ),
      okText: t("action.confirm"),
      cancelText: t("action.cancel"),
      onOk: async () => {
        const input = document.getElementById(
          "edit-version-tag-input",
        ) as HTMLInputElement;
        const versionTag = input?.value?.trim() || "";
        try {
          await wikiApi.versions.updateVersionTag(
            pageId,
            item.version_no,
            versionTag,
          );
          message.success(t("status.success"));
          setVersionList(
            versionList.map((v) =>
              v.version_no === item.version_no
                ? { ...v, version_tag: versionTag }
                : v,
            ),
          );
        } catch (error) {
          console.error("更新版本标签失败:", error);
        }
      },
    });
  };

  const handleDeleteVersionTag = (item: WikiPageVersion) => {
    Modal.confirm({
      title: t("common.tip"),
      content: t("history.delete_version_confirm"),
      okText: t("action.confirm"),
      cancelText: t("action.cancel"),
      onOk: async () => {
        try {
          await wikiApi.versions.updateVersionTag(pageId, item.version_no, "");
          message.success(t("status.success"));
          const remaining = versionList.filter((v) => v.version_no !== item.version_no);
          setVersionList(remaining);
          if (currentVersion?.version_no === item.version_no) {
            setCurrentVersion(remaining[0] ?? null);
          }
        } catch (error) {
          console.error("删除版本标签失败:", error);
        }
      },
    });
  };

  const versionActions = [
    {
      type: "edit",
      icon: <EditOutlined />,
      handler: handleEditVersionTag,
    },
    {
      type: "delete",
      icon: <DeleteOutlined />,
      handler: handleDeleteVersionTag,
    },
  ];

  const open = async () => {
    setVisible(true);
    setPreviewDetail(null);
    setCurrentVersion(null);
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
        spinning={listLoading && versionList.length === 0}
        classNames={{
          root: "h-full",
          container: "h-full flex flex-col overflow-hidden",
        }}
      >
        {/* Header */}
        <div className="flex-none h-[68px] px-8 flex items-center border-b">
          <div
            className="size-6 flex items-center justify-center cursor-pointer hover:bg-[#F0F2F5] rounded"
            onClick={handleClose}
          >
            <SvgIcon name="arrow-left" size={18} />
          </div>
          <h3 className="text-base text-[#1D1E1F] ml-3">
            {t("history.title")}
          </h3>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            {historyView === "all" && (
              <>
                {currentVersionTag ? (
                  <p className="text-sm text-[#999999] mr-2">
                    {t("history.saved_version_tip", {
                      version: currentVersionTag,
                    })}
                  </p>
                ) : (
                  <Button onClick={debounce(handleOpenSaveVersion, 300)}>
                    {t("history.save_version")}
                  </Button>
                )}
              </>
            )}
            <Button
              type="primary"
              disabled={!currentVersion}
              onClick={debounce(handleRestore, 300)}
            >
              {historyView === "version"
                ? t("history.restore_version")
                : t("history.restore_record")}
            </Button>
            {historyView === "version" && currentVersion && !currentVersion.is_published && (
              <Button onClick={debounce(handlePublishVersion, 300)}>
                {t("history.publish_version")}
              </Button>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-hidden flex bg-[#F5F5F5]">
          {/* Preview Area */}
          {(previewDetail || currentVersion) && (
            <div className="flex-1 overflow-hidden max-w-5xl my-5 mx-auto flex bg-white">
              <WikiPagePreview
                key={currentVersion?.version_no ?? "empty"}
                version={previewDetail ?? currentVersion!}
                loading={bodyLoading}
              />
            </div>
          )}

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

            {/* History List (all_record) */}
            {historyView === "all" && (
              <div className="flex-1 overflow-y-auto">
                {filteredHistory.map((item) => (
                  <div
                    key={item.id ?? item.version_no}
                    className={`h-16 px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-[#F4F5F7] ${currentVersion?.version_no === item.version_no ? "bg-[#F4F5F7]" : ""}`}
                    onClick={() => handleSelectVersion(item)}
                  >
                    <div className="flex-1">
                      <div className="text-sm text-[#1D1E1F] font-semibold">
                        {new Date(item.created_time,
                        ).toLocaleString()}
                      </div>
                      <p className="text-xs text-[#999999] mt-1">
                        <EntityDisplay type="user" id={item.editor_id} mode="name"></EntityDisplay>
                      </p>
                    </div>
                    {item.version_tag && (
                      <Tag>{t("history.published")}</Tag>
                    )}
                  </div>
                ))}
                {versionList.length === 0 && !listLoading && (
                  <div className="flex-center h-full">
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
                {filteredVersionList.map((item) => (
                  <div
                    key={item.id ?? item.version_no}
                    className={`h-[88px] px-4 py-3 cursor-pointer hover:bg-[#F4F5F7] group ${currentVersion?.version_no === item.version_no ? "bg-[#F4F5F7]" : ""}`}
                    onClick={() => handleSelectVersion(item)}
                  >
                    <div className="text-sm text-[#1D1E1F] font-semibold">
                      {item.version_tag}
                    </div>
                    <p className="text-xs text-[#999999] mt-1">
                      {new Date(item.published_time,
                      ).toLocaleString()}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-1 text-sm text-[#1D1E1F] text-opacity-60 truncate">
                        <EntityDisplay type="user" id={item.editor_id} mode="name"></EntityDisplay>
                      </div>
                      {/* Action buttons */}
                      {versionActions.map((action) => (
                        <div
                          key={action.type}
                          className="size-5 flex items-center justify-center cursor-pointer hover:bg-[#F0F2F5] rounded"
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
                {filteredVersionList.length === 0 && !listLoading && (
                  <div className="flex-center h-full">
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
    </Drawer>
  );
});

export default KnowledgeHistoryDrawer;
