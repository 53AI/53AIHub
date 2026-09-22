import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Input, Spin, Checkbox, Tooltip, Select, Button } from "antd";
import { SearchOutlined, CloseOutlined, PlusOutlined } from "@ant-design/icons";
import { debounce } from "@km/shared-utils";
import { t } from "@/locales";
import { DeptMemberPicker } from "@/components/DeptMemberPicker";
import { globalSearchApi } from "@/api/modules/global-search";
import type {
  GlobalSearchSpace,
  GlobalSearchLibrary,
  TimeRangeValue,
  DocTypeValue,
} from "@/api/modules/global-search/types";
import type { UserInfo } from "@/api/modules/user/types";
import { useFilterItem } from "../hooks/useFilterItem";
import type { FilterState } from "../types";
import { DEFAULT_FILTER_STATE, filterStateToParams } from "../utils/filter";
import "../index.css";

// ==================== 类型定义 ====================

interface FilterProps {
  /** 受控状态 */
  value: FilterState;
  /** 状态变化回调 */
  onChange: (state: FilterState) => void;
  /** 用于重置的 key，改变时重置内部状态 */
  resetKey?: number;
  /** 筛选维度：full=全部维度；compact=仅知识空间/创建时间/更新时间（动态知识） */
  variant?: "full" | "compact";
}

// ==================== 工具函数 ====================
const getSpaceId = (item: GlobalSearchSpace) => item.id;
const getLibraryId = (item: GlobalSearchLibrary) => item.id;
const getCreatorId = (item: UserInfo) => item.user_id;

// ==================== 子组件 ====================
function AddedItemList<T, IdType extends string | number>({
  items,
  checkedIds,
  onRemove,
  onToggleCheck,
  getId,
  getLabel,
}: {
  items: T[];
  checkedIds: Set<IdType>;
  onRemove: (id: IdType) => void;
  onToggleCheck: (id: IdType) => void;
  getId: (item: T) => IdType;
  getLabel: (item: T) => string;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mb-2 rounded overflow-hidden">
      {items.map((item) => {
        const id = getId(item);
        const label = getLabel(item);
        const isChecked = checkedIds.has(id);

        return (
          <div
            key={id as React.Key}
            className="h-9 flex items-center justify-between px-2 hover:bg-[#F2F3F5]"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Checkbox checked={isChecked} onChange={() => onToggleCheck(id)} />
              <Tooltip title={label}>
                <span className="text-sm text-[#1D1E1F] truncate">{label}</span>
              </Tooltip>
            </div>
            <Button
              type="text"
              icon={<CloseOutlined />}
              onClick={() => onRemove(id)}
              size="small"
              className="text-secondary cursor-pointer text-xs"
            />
          </div>
        );
      })}
    </div>
  );
}

function SelectInput({
  placeholder,
  selectedValue,
  options,
  onSelect,
}: {
  placeholder: string;
  selectedValue: string;
  options: Array<{ label: string; value: string }>;
  onSelect: (value: string) => void;
}) {
  return (
    <Select
      placeholder={placeholder}
      value={selectedValue}
      onChange={onSelect}
      className="w-full rounded"
      options={options}
    />
  );
}

function SearchInput<T, IdType extends string | number>({
  type,
  placeholder,
  addedItems,
  checkedIds,
  options,
  isLoading,
  isDropdownVisible,
  onSearch,
  onAdd,
  onRemove,
  onToggleCheck,
  onDropdownVisibleChange,
  getId,
  getLabel,
  getIcon,
}: {
  type: "space" | "library";
  placeholder: string;
  addedItems: T[];
  checkedIds: Set<IdType>;
  options: T[];
  isLoading: boolean;
  isDropdownVisible: boolean;
  onSearch: (query: string) => void;
  onAdd: (item: T) => void;
  onRemove: (id: IdType) => void;
  onToggleCheck: (id: IdType) => void;
  onDropdownVisibleChange: (visible: boolean) => void;
  getId: (item: T) => IdType;
  getLabel: (item: T) => string;
  getIcon: (item: T) => string | undefined;
}) {
  const [inputValue, setInputValue] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onDropdownVisibleChange(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onDropdownVisibleChange]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    onSearch(value);
  };

  const handleAddItem = (item: T) => {
    onAdd(item);
    setInputValue("");
    onDropdownVisibleChange(false);
  };

  const isAdded = (item: T) => addedItems.some((added) => getId(added) === getId(item));

  return (
    <div ref={containerRef} className="relative">
      <AddedItemList
        items={addedItems}
        checkedIds={checkedIds}
        onRemove={onRemove}
        onToggleCheck={onToggleCheck}
        getId={getId}
        getLabel={getLabel}
      />

      <Input
        placeholder={placeholder}
        prefix={<SearchOutlined className="text-gray-400" />}
        value={inputValue}
        onChange={handleInputChange}
        onFocus={() => onDropdownVisibleChange(true)}
        className="rounded"
        allowClear
      />

      {isDropdownVisible && inputValue.trim() && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg z-10 max-h-60 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-4"><Spin /></div>
          ) : options.length > 0 ? (
            options.map((item) => {
              const id = getId(item);
              const added = isAdded(item);
              const icon = getIcon(item);
              const label = getLabel(item);

              return (
                <div
                  key={id as React.Key}
                  className={`h-8 flex items-center gap-2 px-2 mb-1 rounded cursor-pointer text-[#1D1E1F] ${added ? "bg-[#EDF3FF]" : "hover:bg-[#F2F3F5]"}`}
                  onClick={() => handleAddItem(item)}
                >
                  {icon && <img src={icon} className="size-5" alt="" />}
                  <Tooltip title={label}>
                    <span className="flex-1 text-sm truncate">{label}</span>
                  </Tooltip>
                </div>
              );
            })
          ) : (
            <div className="px-3 py-4 text-sm text-gray-500 text-center">{t("chat.mention.search_no_result")}</div>
          )}
        </div>
      )}
    </div>
  );
}

function CreatorPicker({
  addedItems,
  checkedIds,
  onAdd,
  onRemove,
  onToggleCheck,
}: {
  addedItems: UserInfo[];
  checkedIds: Set<number>;
  onAdd: (creators: UserInfo[]) => void;
  onRemove: (id: number) => void;
  onToggleCheck: (id: number) => void;
}) {
  const pickerRef = useRef<{ open: () => void; close: () => void }>(null);

  const handleConfirm = (selectedItems: any[]) => {
    const existingIds = new Set(addedItems.map((c) => c.user_id));
    const newCreators = selectedItems
      .filter((item) => item.user_id && !existingIds.has(item.user_id || item.value))
      .map((item) => ({
        ...item,
        user_id: item.user_id || item.value,
        name: item.nickname || item.name,
        nickname: item.nickname || item.name,
      }));
    if (newCreators.length > 0) onAdd(newCreators);
  };

  return (
    <div>
      <AddedItemList
        items={addedItems}
        checkedIds={checkedIds}
        onRemove={onRemove}
        onToggleCheck={onToggleCheck}
        getId={getCreatorId}
        getLabel={(item: UserInfo) => item.nickname || ""}
      />
      <div className="creator-dept-member-picker">
        <DeptMemberPicker
          ref={pickerRef}
          type="user"
          showGroup={false}
          defaultFirstValue={false}
          multiple={true}
          value={addedItems.map((item) => ({
            value: item.user_id,
            label: item.nickname,
            user_id: item.user_id,
          }))}
          onConfirm={handleConfirm}
          trigger={
            <Input
              placeholder={t("action.add")}
              prefix={<PlusOutlined className="text-gray-400" />}
              className="rounded w-full"
              readOnly
              onClick={() => pickerRef.current?.open()}
            />
          }
        />
      </div>
    </div>
  );
}

// ==================== 主组件 ====================
export function Filter({ value, onChange, resetKey, variant = "full" }: FilterProps) {
  // 监听 resetKey 变化，重置内部状态
  useEffect(() => {
    if (resetKey !== undefined && resetKey > 0) {
      spaceFilter.reset();
      libraryFilter.reset();
      creatorFilter.reset();
      onChange(DEFAULT_FILTER_STATE);
    }
  }, [resetKey]);

  // 单选筛选项
  const [selectedCreatedTime, setSelectedCreatedTime] = useState<TimeRangeValue>(value.selectedCreatedTime);
  const [selectedUpdatedTime, setSelectedUpdatedTime] = useState<TimeRangeValue>(value.selectedUpdatedTime);
  const [selectedDocType, setSelectedDocType] = useState<DocTypeValue>(value.selectedDocType);

  const timeRangeOptions = useMemo<{ label: string; value: TimeRangeValue }[]>(
    () => [
      { label: t("common.all"), value: "all" },
      { label: t("global_search.time_7d"), value: "7d" },
      { label: t("global_search.time_30d"), value: "30d" },
      { label: t("global_search.time_180d"), value: "180d" },
      { label: t("global_search.time_365d"), value: "365d" },
    ],
    [],
  );

  const docTypeOptions = useMemo<{ label: string; value: DocTypeValue }[]>(
    () => [
      { label: t("common.all"), value: "all" },
      { label: "PDF", value: "pdf" },
      { label: "TXT", value: "txt" },
      { label: "Markdown", value: "markdown" },
      { label: "Word", value: "word" },
      { label: "Excel", value: "excel" },
      { label: "PowerPoint", value: "powerpoint" },
      { label: "Epub", value: "epub" },
      { label: t("global_search.type_webpage"), value: "webpage" },
      { label: t("global_search.type_audio"), value: "audio" },
    ],
    [],
  );

  // 知识空间筛选
  const spaceFilter = useFilterItem<GlobalSearchSpace, string>({
    getId: getSpaceId,
    initialItems: value.selectedSpaces,
  });
  const [spaceOptions, setSpaceOptions] = useState<GlobalSearchSpace[]>([]);
  const [isSpaceLoading, setIsSpaceLoading] = useState(false);
  const [isSpaceDropdownVisible, setIsSpaceDropdownVisible] = useState(false);
  const spaceAbortRef = useRef<AbortController | null>(null);

  // 知识库筛选
  const libraryFilter = useFilterItem<GlobalSearchLibrary, string>({
    getId: getLibraryId,
    initialItems: value.selectedLibraries,
  });
  const [libraryOptions, setLibraryOptions] = useState<GlobalSearchLibrary[]>([]);
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);
  const [isLibraryDropdownVisible, setIsLibraryDropdownVisible] = useState(false);
  const libraryAbortRef = useRef<AbortController | null>(null);

  // 创建人筛选
  const creatorFilter = useFilterItem<UserInfo, number>({
    getId: getCreatorId,
    initialItems: value.selectedCreators as UserInfo[],
  });

  // 搜索知识空间
  const searchSpaces = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSpaceOptions([]);
      return;
    }
    spaceAbortRef.current?.abort();
    spaceAbortRef.current = new AbortController();
    setIsSpaceLoading(true);
    try {
      const res = await globalSearchApi.spaces({ keyword: query });
      setSpaceOptions(res || []);
    } catch (e: any) {
      if (e.name !== "AbortError" && e.code !== "ERR_CANCELED") {
        console.error("搜索知识空间失败:", e);
        setSpaceOptions([]);
      }
    } finally {
      setIsSpaceLoading(false);
    }
  }, []);

  // 搜索知识库
  const searchLibraries = useCallback(async (query: string) => {
    if (!query.trim()) {
      setLibraryOptions([]);
      return;
    }
    libraryAbortRef.current?.abort();
    libraryAbortRef.current = new AbortController();
    setIsLibraryLoading(true);
    try {
      const res = await globalSearchApi.libraries({ keyword: query });
      setLibraryOptions(res || []);
    } catch (e: any) {
      if (e.name !== "AbortError" && e.code !== "ERR_CANCELED") {
        console.error("搜索知识库失败:", e);
        setLibraryOptions([]);
      }
    } finally {
      setIsLibraryLoading(false);
    }
  }, []);

  // 防抖搜索
  const debouncedSearchSpaces = useRef(debounce(searchSpaces, 300)).current;
  const debouncedSearchLibraries = useRef(debounce(searchLibraries, 300)).current;

  // 当筛选状态变化时，通知父组件
  useEffect(() => {
    const newState: FilterState = {
      selectedSpaces: spaceFilter.getCheckedItems(),
      selectedLibraries: libraryFilter.getCheckedItems(),
      selectedCreators: creatorFilter.getCheckedItems(),
      selectedCreatedTime,
      selectedUpdatedTime,
      selectedDocType,
    };
    onChange(newState);
  }, [
    spaceFilter.addedItems,
    spaceFilter.checkedIds,
    libraryFilter.addedItems,
    libraryFilter.checkedIds,
    creatorFilter.addedItems,
    creatorFilter.checkedIds,
    selectedCreatedTime,
    selectedUpdatedTime,
    selectedDocType,
    onChange,
  ]);

  return (
    <div className="p-4">
      <div className="mb-4">
        <div className="text-sm mb-2">{t("module.space")}</div>
        <SearchInput
          type="space"
          placeholder={t("global_search.search_space_name")}
          addedItems={spaceFilter.addedItems}
          checkedIds={spaceFilter.checkedIds}
          options={spaceOptions}
          isLoading={isSpaceLoading}
          isDropdownVisible={isSpaceDropdownVisible}
          onSearch={debouncedSearchSpaces}
          onAdd={spaceFilter.addItem}
          onRemove={spaceFilter.removeItem}
          onToggleCheck={spaceFilter.toggleCheck}
          onDropdownVisibleChange={setIsSpaceDropdownVisible}
          getId={getSpaceId}
          getLabel={(item) => item.name || ""}
          getIcon={(item) => item.icon}
        />
      </div>

      {variant === "full" && (
        <>
          <div className="mb-4">
            <div className="text-sm mb-2">{t("library.name")}</div>
            <SearchInput
              type="library"
              placeholder={t("global_search.search_library_name")}
              addedItems={libraryFilter.addedItems}
              checkedIds={libraryFilter.checkedIds}
              options={libraryOptions}
              isLoading={isLibraryLoading}
              isDropdownVisible={isLibraryDropdownVisible}
              onSearch={debouncedSearchLibraries}
              onAdd={libraryFilter.addItem}
              onRemove={libraryFilter.removeItem}
              onToggleCheck={libraryFilter.toggleCheck}
              onDropdownVisibleChange={setIsLibraryDropdownVisible}
              getId={getLibraryId}
              getLabel={(item) => item.name || ""}
              getIcon={(item) => item.icon}
            />
          </div>

          <div className="mb-4">
            <div className="text-sm mb-2">{t("form.creator")}</div>
            <CreatorPicker
              addedItems={creatorFilter.addedItems}
              checkedIds={creatorFilter.checkedIds}
              onAdd={creatorFilter.addItems}
              onRemove={creatorFilter.removeItem}
              onToggleCheck={creatorFilter.toggleCheck}
            />
          </div>
        </>
      )}

      <div className="mb-4">
        <div className="text-sm mb-2">{t("common.create_time")}</div>
        <SelectInput
          placeholder={t("global_search.select_time_range")}
          selectedValue={selectedCreatedTime}
          options={timeRangeOptions}
          onSelect={(val) => setSelectedCreatedTime(val as TimeRangeValue)}
        />
      </div>

      <div className="mb-4">
        <div className="text-sm mb-2">{t("common.update_time")}</div>
        <SelectInput
          placeholder={t("global_search.select_time_range")}
          selectedValue={selectedUpdatedTime}
          options={timeRangeOptions}
          onSelect={(val) => setSelectedUpdatedTime(val as TimeRangeValue)}
        />
      </div>

      {variant === "full" && (
        <div className="mb-4">
          <div className="text-sm mb-2">{t("global_search.doc_type")}</div>
          <SelectInput
            placeholder={t("global_search.select_doc_type")}
            selectedValue={selectedDocType}
            options={docTypeOptions}
            onSelect={(val) => setSelectedDocType(val as DocTypeValue)}
          />
        </div>
      )}
    </div>
  );
}

export default Filter;