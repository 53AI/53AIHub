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
import { SearchOutlined, CloseOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { Filter } from "./components/Filter";
import { KnowledgeTab } from "./components/KnowledgeTab";
import { useGlobalSearch, type GlobalSearchFile } from "./hooks/useGlobalSearch";
import type { FilterState } from "./types";
import { DEFAULT_FILTER_STATE, filterStateToParams } from "./utils/filter";
import "./index.css";

interface GlobalSearchProps {
  className?: string;
  placeholder?: string;
  libraryId?: string;
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
      placeholder = "搜索",
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

    // 筛选状态
    const [filterState, setFilterState] = useState<FilterState>(DEFAULT_FILTER_STATE);

    // 将 FilterState 转换为 FilterParams（用 useMemo 稳定引用）
    const filterParams = useMemo(() => filterStateToParams(filterState), [filterState]);

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
    } = useGlobalSearch(searchQuery, filterParams);

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
      setFilterKey(prev => prev + 1);  // 重置 Filter 组件
      setFilterState(DEFAULT_FILTER_STATE);  // 重置筛选状态
      reset(); // 关闭时重置缓存
    }, [reset]);

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

    // 处理筛选状态变化
    const handleFilterChange = useCallback((state: FilterState) => {
      setFilterState(state);
    }, []);

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
          <div className="flex flex-col h-[680px]">
            {/* 搜索框 */}
            <div className="border-b border-gray-200 h-[56px] flex items-center px-6 gap-3 flex-shrink-0">
              <SearchOutlined className="text-gray-400 text-xl" />
              <input
                ref={modalInputRef}
                value={searchQuery}
                onChange={handleInputChange}
                onKeyDown={handleKeydown}
                placeholder={placeholder}
                className="flex-1 bg-transparent border-none outline-none text-sm text-[#1D1E1F] placeholder:text-secondary"
                autoFocus
              />
              {searchQuery && (
                <>
                  <button
                    className="text-sm text-secondary bg-transparent pr-[5px] border-none cursor-pointer flex-shrink-0 transition-colors"
                    onClick={handleClear}
                  >
                    清除
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

            {/* Tab 标签 */}
            <div className="px-6 flex-shrink-0">
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[{ key: "knowledge", label: "知识文档" }]}
                className="global-search-tabs"
              />
            </div>

            {/* 内容区：左右布局 */}
            <div className="flex flex-1 min-h-0">
              {/* 左侧内容 */}
              <div className="flex-1 overflow-y-auto px-5 pb-4">
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
              </div>

              {/* 右侧筛选面板 */}
              <div className="w-[287px] flex-shrink-0 border-l border-gray-100 overflow-y-auto">
                <Filter
                  key={filterKey}
                  value={filterState}
                  onChange={handleFilterChange}
                  resetKey={filterKey}
                />
              </div>
            </div>
          </div>
        </Modal>
      </div>
    );
  },
);

GlobalSearch.displayName = "GlobalSearch";

export default GlobalSearch;
