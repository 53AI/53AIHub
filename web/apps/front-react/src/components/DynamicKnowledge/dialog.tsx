import { useState, forwardRef, useImperativeHandle, useMemo, useCallback, useEffect } from "react";
import { Modal, Button, Input, Spin, Empty } from "antd";
import { SearchOutlined, RightOutlined, CheckCircleFilled } from "@ant-design/icons";
import { useSpaceStore } from "@/stores/modules/space";
import { useWikiStore } from "@/stores/modules/wiki";
import type { WikiPageItem, WikiPageType } from "@/api/modules/wiki";
import recentUsedApi from "@/api/modules/recent-used";
import type { RecentUsedItem } from "@/api/modules/recent-used/types";
import { RECENT_USED_RESOURCE_TYPE } from "@/constants/recent-used";
import { getPublicPath } from "@/utils/config";
import { SvgIcon } from '@km/shared-components-react';
import { t } from "@/locales";

export interface DynamicKnowledgeDialogRef {
  open: () => void;
}

export interface DynamicKnowledgeDialogProps {
  onConfirm?: (page: WikiPageItem) => void;
}

const PAGE_TYPE_I18N_KEY: Record<WikiPageType, string> = {
  concept: "wiki.page_type.concept",
  entity: "wiki.page_type.entity",
  index: "wiki.page_type.index",
  summary: "wiki.page_type.summary",
};

const KNOWN_PAGE_TYPES: WikiPageType[] = ["concept", "entity", "index", "summary"];

export const DynamicKnowledgeDialog = forwardRef<DynamicKnowledgeDialogRef, DynamicKnowledgeDialogProps>(
  ({ onConfirm }, ref) => {
    const [visible, setVisible] = useState(false);
    const [searchText, setSearchText] = useState("");
    const [activePageType, setActivePageType] = useState<WikiPageType>(KNOWN_PAGE_TYPES[0]);
    const [selectedPage, setSelectedPage] = useState<WikiPageItem | RecentUsedItem | null>(null);
    const [activeTab, setActiveTab] = useState<"recent" | "directory">("directory");
    const [recentRefreshKey, setRecentRefreshKey] = useState(0);
    const [recentItems, setRecentItems] = useState<RecentUsedItem[]>([]);
    const [recentLoading, setRecentLoading] = useState(false);

    const spaceId = useSpaceStore((state) => state.spaceId);
    const currentSpace = useSpaceStore((state) => state.currentSpace);
    const pageList = useWikiStore((state) => state.pagesData);
    const loading = useWikiStore((state) => state.pagesLoading);
    const loadPages = useWikiStore((state) => state.loadPages);

    // 加载页面列表
    useEffect(() => {
      if (visible && spaceId && pageList.length === 0 && !loading) {
        loadPages(spaceId);
      }
    }, [visible, spaceId, pageList.length, loading, loadPages]);

    // 计算标签统计
    const pageTypeCounts = useMemo(() => {
      const counts: Record<WikiPageType, number> = { concept: 0, entity: 0, index: 0, summary: 0 };
      for (const item of pageList) {
        if (KNOWN_PAGE_TYPES.includes(item.page_type)) {
          counts[item.page_type]++;
        }
      }
      return counts;
    }, [pageList]);

    // 标签列表
    const tags = useMemo(() => {
      return KNOWN_PAGE_TYPES.map((k) => ({
        name: t(PAGE_TYPE_I18N_KEY[k]),
        count: pageTypeCounts[k] ?? 0,
        key: k,
      }));
    }, [pageTypeCounts]);

    // 加载最近使用列表（Wiki 页面，按当前空间过滤）
    useEffect(() => {
      if (!visible || !spaceId) return;
      setRecentLoading(true);
      recentUsedApi
        .list({ space_id: spaceId, resource_type: RECENT_USED_RESOURCE_TYPE.WIKI_PAGE })
        .then((items) => setRecentItems(items))
        .catch(() => setRecentItems([]))
        .finally(() => setRecentLoading(false));
    }, [visible, recentRefreshKey, spaceId]);


    // 搜索过滤（忽略分类，直接全量搜索）
    const searchResults = useMemo(() => {
      const kw = searchText.trim().toLowerCase();
      if (!kw) return [];
      return pageList
        .filter((item) => {
          const inTitle = item.title.toLowerCase().includes(kw);
          const inAlias = (item.aliases ?? []).some((a) => a.toLowerCase().includes(kw));
          return inTitle || inAlias;
        })
        .sort((a, b) =>
          a.title.localeCompare(b.title, "zh-Hans-CN", { sensitivity: "base" }),
        );
    }, [pageList, searchText]);

    // 分类目录列表（无搜索时使用）
    const filteredList = useMemo(() => {
      const list = pageList.filter((item) => item.page_type === activePageType);

      return [...list].sort((a, b) =>
        a.title.localeCompare(b.title, "zh-Hans-CN", { sensitivity: "base" }),
      );
    }, [pageList, activePageType]);


    const handleSelectPage = useCallback((page: WikiPageItem | RecentUsedItem) => {
      setSelectedPage(page);
    }, []);

    const handleConfirm = useCallback(() => {
      if (!selectedPage) return;

      // 目录 tab 选中的是 WikiPageItem；最近使用 tab 选中的是 RecentUsedItem（无 title 字段）。
      // 下游 onConfirm 期望 WikiPageItem，在这里做适配，避免污染 selectedPage 导致勾选态丢失。
      let page: WikiPageItem;
      if ("page_type" in selectedPage) {
        page = selectedPage;
      } else {
        page =
          pageList.find((p) => p.slug === selectedPage.slug) ??
          ({
            id: selectedPage.id,
            slug: selectedPage.slug ?? "",
            title: selectedPage.name,
          } as WikiPageItem);
      }

      // 最近使用记录由 EditMode 保存成功后写入后端，
      // 这里不再本地记录，避免与后端去重逻辑冲突。
      setVisible(false);
      onConfirm?.(page);
    }, [selectedPage, pageList, onConfirm]);

    const handleClose = useCallback(() => {
      setVisible(false);
    }, []);

    useImperativeHandle(ref, () => ({
      open: () => {
        setSearchText("");
        setActivePageType(KNOWN_PAGE_TYPES[0]);
        setSelectedPage(null);
        setActiveTab("directory");
        setRecentRefreshKey((k) => k + 1);
        setVisible(true);
      },
    }));

    const spaceName = currentSpace?.name || spaceId || t("dynamic_knowledge.current_space");
    const spaceIcon = currentSpace?.icon;

    return (
      <Modal
        open={visible}
        title={t("space.select_more")}
        width={1006}
        onCancel={handleClose}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button onClick={handleClose}>{t("action.cancel")}</Button>
            <Button type="primary" onClick={handleConfirm} disabled={!selectedPage}>
              {t("action.confirm")}
            </Button>
          </div>
        }
      >
        <>
          {/* Tab 切换 + 搜索 */}
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1 bg-[#F5F5F5] p-1 rounded-xl">
              {[
                { key: "recent", label: t("dynamic_knowledge.tab_recent") },
                { key: "directory", label: t("module.dynamic_knowledge") },
              ].map((tab) => (
                <div
                  key={tab.key}
                  className={`px-4 h-[30px] flex-center text-sm cursor-pointer transition-colors ${
                    activeTab === tab.key
                      ? "text-[#1D1E1F] font-medium bg-white rounded-md"
                      : "text-[#9A9A9A] hover:text-[#666]"
                  }`}
                  onClick={() => {
                    setActiveTab(tab.key as "recent" | "directory");
                    setSelectedPage(null);
                  }}
                >
                  {tab.label}
                </div>
              ))}
            </div>
            <div>
              <Input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={t("dynamic_knowledge.search_placeholder")}
                prefix={<SearchOutlined />}
                allowClear
                style={{ width: 220 }}
              />
            </div>
          </div>

          {searchText.trim() ? (
            // 搜索结果：独立列表
            <div className="h-[500px] overflow-y-auto border rounded-xl px-2 py-1">
              {loading && pageList.length === 0 ? (
                <div className="flex justify-center py-10">
                  <Spin />
                </div>
              ) : searchResults.length === 0 ? (
                <Empty
                  image={getPublicPath("/images/empty.png")}
                  description={t("dynamic_knowledge.no_match_results")}
                  className="py-20"
                />
              ) : (
                <div>
                  <div className="h-9 px-2 flex items-center text-sm text-secondary">
                    {t("dynamic_knowledge.label")} ({searchResults.length})
                  </div>
                  <div className="space-y-1">
                    {searchResults.map((item) => {
                      const isSelected = selectedPage?.id === item.id;
                      return (
                        <div
                          key={item.id}
                          onClick={() => handleSelectPage(item)}
                          className={`flex items-center gap-2 px-3 py-2 cursor-pointer rounded hover:bg-[#F2F3F5] ${
                            isSelected ? "bg-[#EDF3FF] hover:bg-[#EDF3FF]" : ""
                          }`}
                        >
                          <h3 className="flex-1 text-sm text-[#1D1E1F] truncate">
                            {item.title}
                          </h3>
                          {isSelected && (
                            <CheckCircleFilled style={{ color: "#2563EB" }} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === "recent" ? (
            <div className="h-[500px] overflow-y-auto border rounded-xl px-2 py-1">
              {recentLoading || (loading && recentItems.length === 0) ? (
                <div className="flex justify-center py-10">
                  <Spin />
                </div>
              ) : recentItems.length === 0 ? (
                <Empty
                  image={getPublicPath("/images/empty.png")}
                  description={t("dynamic_knowledge.no_recent_records")}
                  className="py-20"
                />
              ) : (
                <div>
                  <div className="h-9 px-2 flex items-center text-sm text-secondary">
                    {t("dynamic_knowledge.label")}
                  </div>
                  <div className="space-y-1">
                    {recentItems.map((item) => {
                      const isSelected = selectedPage?.id === item.id;
                      return (
                        <div
                          key={item.id}
                          onClick={() => handleSelectPage(item)}
                          className={`flex items-center gap-2 px-3 py-2 cursor-pointer rounded hover:bg-[#F2F3F5] ${
                            isSelected ? "bg-[#EDF3FF] hover:bg-[#EDF3FF]" : ""
                          }`}
                        >
                          <div className="size-6 flex-shrink-0 rounded bg-[#EDF3FF] flex items-center justify-center text-[#2563EB]">
                            <SvgIcon name="doc-detail" size={16} />
                          </div>
                          <span className="flex-1 text-sm text-[#1D1E1F] truncate">
                            {item.name}
                          </span>
                          {isSelected && (
                            <CheckCircleFilled style={{ color: "#2563EB" }} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-[500px] flex overflow-hidden border rounded-xl">
              {/* 第一列：空间（只展示当前空间） */}
              <div className="flex-none w-[216px] py-1 border-r flex flex-col overflow-hidden">
                <div className="h-9 px-4 flex items-center text-sm text-secondary">
                  {t("dynamic_knowledge.current_space")}
                </div>
                <div className="flex-1 px-2 space-y-1 overflow-y-auto">
                  <div className="h-9 flex items-center gap-2 px-2 mb-1 rounded cursor-pointer text-[#1D1E1F] bg-[#EDF3FF] hover:bg-[#EDF3FF]">
                    {spaceIcon && (
                      <img src={spaceIcon} className="size-5" alt="" />
                    )}
                    <span className="flex-1 text-sm truncate">{spaceName}</span>
                    <RightOutlined className="text-xs text-[#999]" />
                  </div>
                </div>
              </div>

              {/* 第二列：分类 */}
              <div className="flex-none w-[216px] py-1 border-r flex flex-col overflow-hidden">
                <div className="h-9 px-4 flex items-center text-sm text-secondary">
                  {t("dynamic_knowledge.category_label")}
                </div>
                <div className="flex-1 px-2 space-y-1 overflow-y-auto">
                  {/* 各分类 */}
                  {tags.map((tag) => (
                    <div
                      key={tag.key}
                      onClick={() => setActivePageType(tag.key)}
                      className={`h-9 flex items-center gap-2 px-2 mb-1 rounded cursor-pointer text-[#1D1E1F] ${
                        activePageType === tag.key
                          ? "bg-[#EDF3FF] hover:bg-[#EDF3FF]"
                          : "hover:bg-[#F2F3F5]"
                      }`}
                    >
                      <span className="flex-1 text-sm">{tag.name}</span>
                      {activePageType === tag.key && (
                        <RightOutlined className="text-xs text-[#999]" />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 第三列：动态知识列表 */}
              <div className="flex-1 overflow-y-auto">
                <div className="h-9 px-4 flex items-center text-sm text-secondary">
                  {t("dynamic_knowledge.label")}
                </div>
                {loading && pageList.length === 0 ? (
                  <div className="flex justify-center py-8">
                    <Spin />
                  </div>
                ) : filteredList.length === 0 ? (
                  <Empty
                    image={getPublicPath("/images/empty.png")}
                    description={t("dynamic_knowledge.empty_data")}
                    className="py-20"
                  />
                ) : (
                  <div className="px-2 py-1 space-y-1">
                    {filteredList.map((item) => {
                      const isSelected = selectedPage?.id === item.id;
                      return (
                        <div
                          key={item.id}
                          onClick={() => handleSelectPage(item)}
                          className={`flex items-center gap-2 px-3 py-2 cursor-pointer rounded hover:bg-[#F2F3F5] ${
                            isSelected ? "bg-[#EDF3FF] hover:bg-[#EDF3FF]" : ""
                          }`}
                        >
                          <h3 className="flex-1 text-sm text-primary truncate">
                            {item.title}
                          </h3>
                          {isSelected && (
                            <CheckCircleFilled style={{ color: "#2563EB" }} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      </Modal>
    );
  },
);

DynamicKnowledgeDialog.displayName = "DynamicKnowledgeDialog";

export default DynamicKnowledgeDialog;
