import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Modal, Input, Tabs, Button } from "antd";
import { SearchOutlined, CloseOutlined, FilterOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { t } from "@/locales";
import { useResponsive } from "@/hooks/useResponsive";
import { Filter } from "./components/Filter";
import { KnowledgeTab } from "./components/KnowledgeTab";
import { DynamicTab } from "./components/DynamicTab";
import { useGlobalSearch } from "./hooks/useGlobalSearch";
import type { GlobalSearchFile } from "./utils/transform";
import type { FilterState } from "./types";
import { DEFAULT_FILTER_STATE, filterStateToParams } from "./utils/filter";
import "./index.css";

/** 预置选中的知识库（结构对应 FilterState.selectedLibraries 单项） */
interface GlobalSearchDefaultLibrary {
  id: string;
  name: string;
  icon: string;
  space_id: string;
}

interface GlobalSearchProps {
  className?: string;
  placeholder?: string;
  /** 打开时默认选中的知识库（库内入口预置当前库筛选） */
  defaultLibrary?: GlobalSearchDefaultLibrary;
  onSelect?: (item: GlobalSearchFile) => void;
  onSearch?: (query: string) => void;
}

export interface GlobalSearchRef {
  focus: () => void;
  clear: () => void;
}

export const GlobalSearch = forwardRef<GlobalSearchRef, GlobalSearchProps>(
  function GlobalSearch(
    {
      placeholder = t("action.search"),
      defaultLibrary,
      onSelect,
      className = "",
    }: GlobalSearchProps,
    ref,
  ) {
    const navigate = useNavigate();
    const containerRef = useRef<HTMLDivElement>(null);
    const modalInputRef = useRef<HTMLInputElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [activeTab, setActiveTab] = useState("knowledge");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterKey, setFilterKey] = useState(0);  // 用于重置 Filter 组件
    const [filterOpen, setFilterOpen] = useState(false); // 移动端筛选面板展开状态

    const { isMobile } = useResponsive();

    // 默认筛选：传入 defaultLibrary 时预置当前知识库（每次打开默认选中）
    const defaultKnowledgeFilter = useMemo<FilterState>(() => {
      if (defaultLibrary?.id) {
        return {
          ...DEFAULT_FILTER_STATE,
          selectedLibraries: [defaultLibrary],
        };
      }
      return DEFAULT_FILTER_STATE;
    }, [defaultLibrary]);

    // 筛选状态（按 Tab 独立）
    const [knowledgeFilter, setKnowledgeFilter] = useState<FilterState>(defaultKnowledgeFilter);
    const [dynamicFilter, setDynamicFilter] = useState<FilterState>(DEFAULT_FILTER_STATE);

    const activeFilter = activeTab === "dynamic" ? dynamicFilter : knowledgeFilter;

    // 已激活的筛选维度数量（移动端筛选按钮徽标）
    const activeFilterCount = useMemo(() => {
      let count = 0;
      if (activeFilter.selectedSpaces.length) count++;
      if (activeFilter.selectedLibraries.length) count++;
      if (activeFilter.selectedCreators.length) count++;
      if (activeFilter.selectedCreatedTime !== "all") count++;
      if (activeFilter.selectedUpdatedTime !== "all") count++;
      if (activeFilter.selectedDocType !== "all") count++;
      return count;
    }, [activeFilter]);

    // 将两个 Tab 的 FilterState 转换为 FilterParams
    const knowledgeFilterParams = useMemo(() => filterStateToParams(knowledgeFilter), [knowledgeFilter]);
    const dynamicFilterParams = useMemo(() => filterStateToParams(dynamicFilter), [dynamicFilter]);

    // 使用全局搜索 hook（唯一数据层）
    const {
      spaces,
      libraries,
      files,
      loading,
      loadingMore,
      hasMore,
      loadMore,
      mode,
      setMode,
      isSearchMode,
      searchTotal,
      searchLoading,
      refresh,
      reset,
    } = useGlobalSearch(searchQuery, knowledgeFilterParams, activeTab === "knowledge");

    // 打开 Modal
    const openModal = useCallback(() => {
      setIsModalOpen(true);
      refresh(); // Modal 打开时加载数据
    }, [refresh]);

    // 关闭 Modal
    const closeModal = useCallback(() => {
      setIsModalOpen(false);
      setSearchQuery("");
      setSelectedIndex(0);
      setActiveTab("knowledge");
      setFilterOpen(false); // 收起移动端筛选面板
      setFilterKey(prev => prev + 1);  // 重置 Filter 组件
      setKnowledgeFilter(defaultKnowledgeFilter);  // 重置为默认筛选（含预置知识库）
      setDynamicFilter(DEFAULT_FILTER_STATE);
      reset(); // 关闭时重置缓存
    }, [reset, defaultKnowledgeFilter]);

    // 选择文档并跳转
    const selectItem = useCallback(
      (item: GlobalSearchFile) => {
        const path = item.isfolder
          ? `/library/${item.library_id}/folder/${item.file_id}`
          : `/library/${item.library_id}/file/${item.file_id}`;
        navigate(path);
        closeModal();
        onSelect?.(item);
      },
      [navigate, closeModal, onSelect],
    );

    // 处理搜索输入
    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value);
        setSelectedIndex(0);
      },
      [],
    );

    // 清除搜索
    const handleClear = useCallback(() => {
      setSearchQuery("");
      setSelectedIndex(0);
    }, []);

    // 处理键盘导航
    const handleKeydown = useCallback(
      (event: React.KeyboardEvent) => {
        if (!isModalOpen) return;

        if (event.key === "Escape") {
          event.preventDefault();
          closeModal();
          return;
        }
      },
      [isModalOpen, closeModal],
    );

    // 处理筛选状态变化（写入当前 Tab 对应的状态）
    const handleFilterChange = useCallback((state: FilterState) => {
      if (activeTab === "dynamic") {
        setDynamicFilter(state);
      } else {
        setKnowledgeFilter(state);
      }
    }, [activeTab]);

    // 滚动到选中项
    useEffect(() => {
      const selectedItem = itemRefs.current.get(selectedIndex);
      const container = scrollContainerRef.current;
      if (selectedItem && container) {
        selectedItem.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
      }
    }, [selectedIndex]);

    // 暴露方法给 ref
    useImperativeHandle(ref, () => ({
      focus: openModal,
      clear: closeModal,
    }));

    // Modal 打开后自动聚焦搜索框
    useEffect(() => {
      if (isModalOpen) {
        const timer = setTimeout(() => {
          modalInputRef.current?.focus();
        }, 150);
        return () => clearTimeout(timer);
      }
    }, [isModalOpen]);

    return (
      <div ref={containerRef} className={`relative ${className}`}>
        {/* 触发器 Input */}
        <Input
          placeholder={placeholder}
          prefix={<SearchOutlined className="search-icon" />}
          className="w-full rounded-lg bg-[#EDEFF2] border-transparent hover:bg-white hover:border-gray-200 focus:bg-white focus:border-gray-200 cursor-pointer"
          onClick={openModal}
          readOnly
        />

        {/* Modal 弹窗 */}
        <Modal
          open={isModalOpen}
          onCancel={closeModal}
          footer={null}
          width={1280}
          destroyOnClose={false}
          closable={false}
          className="global-search-modal"
          styles={{ container: { padding: 0 }, body: { padding: 0 } }}
        >
          <div className="flex flex-col h-[680px] max-md:h-[calc(100vh-120px)]">
            {/* 搜索框 */}
            <div className="border-b border-gray-200 h-[56px] flex items-center px-6 max-md:px-4 gap-3 flex-shrink-0">
              <SearchOutlined className="text-gray-400 text-xl" />
              <input
                ref={modalInputRef}
                value={searchQuery}
                onChange={handleInputChange}
                onKeyDown={handleKeydown}
                placeholder={placeholder}
                className="flex-1 bg-transparent border-none outline-none text-sm max-md:text-base text-[#1D1E1F] placeholder:text-secondary"
                autoFocus
              />
              {searchQuery && (
                <>
                  <button
                    className="text-sm text-secondary bg-transparent pr-[5px] border-none cursor-pointer flex-shrink-0 transition-colors"
                    onClick={handleClear}
                  >
                    {t("global_search.clear")}
                  </button>
                  <div className="w-px h-4 bg-[#E5E6EB]" />
                </>
              )}
              <Button
                type="text"
                icon={<CloseOutlined />}
                onClick={closeModal}
                size="small"
              />
            </div>

            {/* Tab 标签 + 移动端筛选入口 */}
            <div className="px-6 max-md:px-4 flex-shrink-0 flex items-center gap-2">
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[
                  { key: "knowledge", label: t("knowledge.document_file") },
                  { key: "dynamic", label: t("global_search.dynamic_tab") },
                ]}
                className="global-search-tabs min-w-0 flex-1"
              />
              {isMobile && (
                <Button
                  size="small"
                  type={filterOpen ? "primary" : "default"}
                  icon={<FilterOutlined />}
                  onClick={() => setFilterOpen((v) => !v)}
                  className="flex-shrink-0"
                >
                  {activeFilterCount > 0
                    ? `${t("global_search.filter")} ${activeFilterCount}`
                    : t("global_search.filter")}
                </Button>
              )}
            </div>

            {/* 内容区：桌面左右布局，移动端上下堆叠 */}
            <div className="flex flex-1 min-h-0 max-md:flex-col">
              {/* 移动端筛选面板（点击筛选按钮展开，限高内部滚动） */}
              {isMobile && filterOpen && (
                <div className="flex-shrink-0 max-h-[45%] overflow-y-auto border-b border-gray-100">
                  <Filter
                    key={`${filterKey}-${activeTab}`}
                    value={activeFilter}
                    onChange={handleFilterChange}
                    resetKey={filterKey}
                    variant={activeTab === "dynamic" ? "compact" : "full"}
                  />
                </div>
              )}
              {/* 左侧内容 */}
              <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4 max-md:px-2">
                {activeTab === "knowledge" && (
                  <KnowledgeTab
                    searchQuery={searchQuery}
                    selectedIndex={selectedIndex}
                    onSelectedIndexChange={setSelectedIndex}
                    itemRefs={itemRefs}
                    scrollContainerRef={scrollContainerRef}
                    onSelectItem={selectItem}
                    onCloseModal={closeModal}
                    // 统一数据（hook 根据模式自动切换）
                    mode={mode}
                    onModeChange={setMode}
                    spaces={spaces}
                    libraries={libraries}
                    files={files}
                    loading={loading}
                    loadingMore={loadingMore}
                    hasMore={hasMore}
                    onLoadMore={loadMore}
                    // 搜索模式相关
                    isSearchMode={isSearchMode}
                    searchTotal={searchTotal}
                    searchLoading={searchLoading}
                  />
                )}
                {activeTab === "dynamic" && (
                  <DynamicTab
                    searchQuery={searchQuery}
                    filterParams={dynamicFilterParams}
                    onCloseModal={closeModal}
                  />
                )}
              </div>

              {/* 桌面端右侧筛选面板 */}
              {!isMobile && (
                <div className="w-[287px] flex-shrink-0 border-l border-gray-100 overflow-y-auto">
                  <Filter
                    key={`${filterKey}-${activeTab}`}
                    value={activeFilter}
                    onChange={handleFilterChange}
                    resetKey={filterKey}
                    variant={activeTab === "dynamic" ? "compact" : "full"}
                  />
                </div>
              )}
            </div>
          </div>
        </Modal>
      </div>
    );
  },
);

GlobalSearch.displayName = "GlobalSearch";

export default GlobalSearch;
