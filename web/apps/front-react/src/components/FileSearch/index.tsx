import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Input, Tooltip, Spin } from "antd";
import { SearchOutlined, CloseCircleFilled } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { filesApi } from "@/api/modules/files";
import type { FileSearchParams } from "@/api/modules/files/types";
import { formatFileInfo } from "@/api/modules/files/transform";
import { debounce, getSimpleDateFormatString } from "@km/shared-utils";
import { checkPermission } from "@/utils/permission";

interface FileSearchItem {
  name: string;
  icon: string;
  location: string;
  lastUpdated: string;
  creator_name: string;
  file_id: number;
  library_id: string | number;
  library_name: string;
  space_name: string;
  path: string;
  isfolder: boolean;
}

interface FileSearchProps {
  className?: string;
  placeholder?: string;
  libraryId?: string;
  onSelect?: (item: FileSearchItem) => void;
  onSearch?: (query: string) => void;
}

export interface FileSearchRef {
  focus: () => void;
  clear: () => void;
}

// Custom hook for click outside detection
function useClickAway<T extends HTMLElement>(
  ref: React.RefObject<T>,
  handler: () => void,
) {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      const el = ref?.current;
      if (!el || el.contains(event.target as Node)) {
        return;
      }
      handler();
    };

    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);

    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, handler]);
}

export const FileSearch = forwardRef<FileSearchRef, FileSearchProps>(
  function FileSearch(
    {
      placeholder = "搜索",
      libraryId = "",
      onSelect,
      onSearch,
      className = "",
    }: FileSearchProps,
    ref,
  ) {
    const navigate = useNavigate();
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

    const [searchQuery, setSearchQuery] = useState("");
    const [showPanel, setShowPanel] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [searchError, setSearchError] = useState("");
    const [searchResults, setSearchResults] = useState<FileSearchItem[]>([]);
    const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 });

    const abortControllerRef = useRef<AbortController | null>(null);

    // Calculate panel position
    const calculatePanelPosition = useCallback(() => {
      const inputRect = containerRef.current?.getBoundingClientRect();
      if (inputRect) {
        setPanelPosition({
          top: inputRect.bottom + 6,
          left: inputRect.left,
        });
      }
    }, []);

    // Perform search
    const performSearch = useCallback(
      async (query: string) => {
        if (!query.trim()) {
          setSearchResults([]);
          return;
        }

        // Cancel previous request
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }

        abortControllerRef.current = new AbortController();

        try {
          setIsLoading(true);
          setSearchError("");

          const params: FileSearchParams = {
            query: query.trim(),
            top_k: 20,
            case_sensitive: false,
          };
          if (libraryId) {
            params.library_ids = [libraryId];
          }

          const response = await filesApi.search(params);

          const results = (response.results || []).map((item) => {
            const isfolder = item.type === 0;
            const data = formatFileInfo(item.path, isfolder);
            return {
              ...item,
              name: data.fname,
              icon: data.icon,
              isfolder,
              location: `${item.space_name}/${item.library_name}`,
              lastUpdated: getSimpleDateFormatString({
                date: item.latest_file_body_update_time,
              }),
            };
          });

          setSearchResults(results);
          setShowPanel(true);
          calculatePanelPosition();
          setSelectedIndex(0);
        } catch (error: any) {
          if (error.name !== "AbortError" && error.code !== "ERR_CANCELED") {
            console.error("搜索失败:", error);
            setSearchError("搜索失败，请稍后重试");
            setSearchResults([]);
          }
        } finally {
          setIsLoading(false);
          abortControllerRef.current = null;
        }
      },
      [libraryId, calculatePanelPosition],
    );

    // Debounced search
    const debouncedSearch = useMemo(
      () =>
        debounce((query: string) => {
          checkPermission({
            checkInternal: true,
            onClick: () => {
              performSearch(query);
            },
            onFailed: () => {
              inputRef.current?.blur();
            },
          });
        }, 300),
      [performSearch],
    );

    // Handle input change
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newQuery = e.target.value;
      setSearchQuery(newQuery);

      if (newQuery.trim()) {
        debouncedSearch(newQuery);
      } else {
        setShowPanel(false);
        setSearchResults([]);
        setSearchError("");
      }
    };

    // Scroll to selected item
    const scrollToSelectedItem = useCallback(() => {
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

    // Select item and navigate
    const selectItem = useCallback(
      (item: FileSearchItem) => {
        const path = item.isfolder
          ? `/library/${item.library_id}/folder/${item.file_id}`
          : `/library/${item.library_id}/file/${item.file_id}`;

        navigate(path);
        setShowPanel(false);
        setSearchQuery("");
        setSelectedIndex(0);
        onSelect?.(item);
      },
      [navigate, onSelect],
    );

    // Handle keyboard navigation
    const handleKeydown = useCallback(
      (event: React.KeyboardEvent) => {
        if (!showPanel) {
          if (event.key === "Enter" && searchQuery.trim()) {
            event.preventDefault();
            debouncedSearch(searchQuery);
            onSearch?.(searchQuery);
          } else if (event.key === "Escape") {
            event.preventDefault();
            inputRef.current?.blur();
          }
          return;
        }

        switch (event.key) {
          case "Enter":
            event.preventDefault();
            if (searchResults.length > 0) {
              const selectedItem = searchResults[selectedIndex];
              if (selectedItem) {
                selectItem(selectedItem);
              }
            }
            break;
          case "ArrowDown":
            event.preventDefault();
            if (searchResults.length > 0) {
              setSelectedIndex((prev) =>
                Math.min(prev + 1, searchResults.length - 1),
              );
            }
            break;
          case "ArrowUp":
            event.preventDefault();
            if (searchResults.length > 0) {
              setSelectedIndex((prev) => Math.max(prev - 1, 0));
            }
            break;
          case "Escape":
            event.preventDefault();
            setShowPanel(false);
            inputRef.current?.blur();
            break;
        }
      },
      [
        showPanel,
        searchQuery,
        searchResults,
        selectedIndex,
        selectItem,
        debouncedSearch,
        onSearch,
      ],
    );

    // Scroll when selected index changes
    useEffect(() => {
      scrollToSelectedItem();
    }, [selectedIndex, scrollToSelectedItem]);

    // Handle focus
    const handleFocus = () => {
      if (searchQuery.trim()) {
        if (searchResults.length > 0) {
          setShowPanel(true);
          calculatePanelPosition();
        } else {
          debouncedSearch(searchQuery);
        }
      }
    };

    // Handle clear
    const handleClear = () => {
      setShowPanel(false);
      setSelectedIndex(0);
      setSearchResults([]);
      setSearchError("");

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      debouncedSearch.cancel();
    };

    // Click outside to close panel
    useClickAway(containerRef, () => {
      setShowPanel(false);
    });

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      focus: () => {
        inputRef.current?.focus();
      },
      clear: () => {
        setSearchQuery("");
        setSelectedIndex(0);
        setShowPanel(false);
        setSearchResults([]);
        setSearchError("");

        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }

        debouncedSearch.cancel();
      },
    }));

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        debouncedSearch.cancel();
      };
    }, [debouncedSearch]);

    // Highlight text helper
    const highlightText = (text: string, query: string) => {
      if (!query) return text;
      const regex = new RegExp(
        `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
        "gi",
      );
      return text.replace(
        regex,
        '<span class="text-blue-600 font-medium">$1</span>',
      );
    };

    return (
      <div
        ref={containerRef}
        className={`relative ${className}`}
        onKeyDown={handleKeydown}
      >
        <Input
          ref={inputRef as any}
          value={searchQuery}
          onChange={handleInputChange}
          onFocus={handleFocus}
          placeholder={placeholder}
          prefix={<SearchOutlined className="search-icon" />}
          allowClear={{ clearIcon: <CloseCircleFilled /> }}
          onClear={handleClear}
          className="w-full rounded-lg bg-[#EDEFF2] border-transparent hover:bg-white hover:border-gray-200 focus:bg-white focus:border-gray-200"
        />

        {/* Search Results Panel */}
        {showPanel && (
          <div
            className="fixed z-[101] w-[480px] bg-white border border-gray-200 rounded-md shadow-lg"
            style={{
              top: `${panelPosition.top}px`,
              left: `${panelPosition.left}px`,
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="max-h-96 flex flex-col">
              {/* Loading State */}
              {isLoading && (
                <div className="flex-1 px-4 py-8 flex items-center justify-center">
                  <div className="flex items-center space-x-2 text-gray-500">
                    <Spin size="small" />
                    <span>搜索中...</span>
                  </div>
                </div>
              )}

              {/* Error State */}
              {!isLoading && searchError && (
                <div className="flex-1 px-4 py-8">
                  <div className="text-center text-red-500">
                    <p>{searchError}</p>
                  </div>
                </div>
              )}

              {/* Search Results */}
              {!isLoading && !searchError && searchResults.length > 0 && (
                <div
                  ref={scrollContainerRef}
                  className="flex-1 px-2.5 py-1 overflow-y-auto"
                >
                  {searchResults.map((item, index) => (
                    <Tooltip
                      key={item.file_id}
                      title={item.name}
                      placement="topLeft"
                      mouseEnterDelay={0.5}
                    >
                      <div
                        ref={(el) => {
                          if (el) itemRefs.current.set(index, el);
                        }}
                        className={`px-2 py-3 rounded cursor-pointer transition-colors duration-150 hover:bg-[#F5F6F7] ${
                          selectedIndex === index ? "bg-[#F5F6F7]" : ""
                        }`}
                        onClick={() => selectItem(item)}
                        onMouseEnter={() => setSelectedIndex(index)}
                      >
                        <div className="flex items-start space-x-2">
                          {/* File Icon */}
                          <div className="flex-shrink-0">
                            <img className="size-5" src={item.icon} alt="" />
                          </div>

                          {/* File Info */}
                          <div className="flex-1 min-w-0">
                            <div
                              className="text-sm font-medium text-gray-900 truncate"
                              dangerouslySetInnerHTML={{
                                __html: highlightText(item.name, searchQuery),
                              }}
                            />
                            <div className="text-xs text-gray-500 mt-1">
                              <span>{item.location}</span>
                              <span className="mx-1">·</span>
                              <span>最近更新: {item.lastUpdated}</span>
                              <span className="mx-1">·</span>
                              <span>{item.creator_name}创建</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Tooltip>
                  ))}
                </div>
              )}

              {/* Empty State */}
              {!isLoading &&
                !searchError &&
                searchQuery &&
                searchResults.length === 0 && (
                  <div className="p-4">
                    <div className="text-sm text-center text-gray-500">
                      <p>未找到相关文档</p>
                    </div>
                  </div>
                )}

              {/* Keyboard Hint */}
              {!isLoading && !searchError && searchResults.length > 0 && (
                <div className="h-8 flex-none flex items-center px-4 bg-[#F2F3F5] text-xs text-[#999999]">
                  支持↑↓键选择、Enter键打开
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  },
);

export default FileSearch;
