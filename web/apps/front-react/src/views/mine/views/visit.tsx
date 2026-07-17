import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Empty, Spin, message, Button } from "antd";
import { Dropdown } from "@km/shared-components-react";
import type { MenuProps } from "antd";
import mySpaceApi from "@/api/modules/my-space";
import filesApi from "@/api/modules/files";
import favoritesApi from "@/api/modules/favorites";
import { formatFile } from "@/api/modules/files/transform";
import { checkVersion } from "@/utils/version";
import { VERSION_MODULE } from "@/constants/enterprise";
import { formatLibrary } from "@/stores/modules/library";
import { VirtualLogo } from "@/components";
import { SvgIcon } from "@km/shared-components-react";
import { MoreDropdown } from "@/components/MoreDropdown";
import { getPublicPath } from "@/utils/config";
import { t } from "@/locales";
import { buildUrl } from "@/utils/router";
import { getFormatTimeStamp } from "@km/shared-utils";
import type { FilterType } from "../types";
import "../mine.css";

interface VisitItem {
  type: "library" | "file";
  id: string;
  name: string;
  icon: string;
  position: string;
  owner: string;
  isFavorite: boolean;
  isfolder?: boolean;
  recentTime: string;
  libraryId?: string;
  rawData: any;
}

interface VisitViewProps {
  keyword?: string;
  onPreview?: (file: any, content?: string) => void;
  refreshKey?: number;
}

const PAGE_SIZE = 30;

export default function VisitView({ keyword = "", onPreview, refreshKey }: VisitViewProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [items, setItems] = useState<VisitItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(false);
  // 解析 includes，构建 lookup map
  const parseResponse = useCallback((data: any) => {
    const includes = data.includes || {};
    const librariesMap: Record<string, any> = includes.libraries || {};
    const spacesMap: Record<string, any> = includes.spaces || {};
    const usersMap: Record<string, any> = includes.users || {};

    return (data.items || []).map((item: any) => {
      const isFile = item.resource_type === 2;
      const library = item.library_id ? librariesMap[item.library_id] : null;
      const space = item.space_id ? spacesMap[item.space_id] : null;
      const creator = item.creator_id ? usersMap[item.creator_id] : null;

      if (isFile) {
        const formattedFile = formatFile(item.file || {});
        const position =
          space && library ? `${space.name}/${library.name}` : "--";
        return {
          type: "file" as const,
          id: item.resource_id,
          name: formattedFile.name,
          icon: item.file.origin_source === 'recording' || item.file.origin_source === 'recording_import' ? getPublicPath("/images/file/recrod.png"):  formattedFile.icon,
          position,
          owner: creator?.nickname || creator?.username || "",
          isFavorite: item.is_favorite ?? false,
          isfolder: formattedFile.isfolder,
          recentTime: getFormatTimeStamp(item.recent_time),
          libraryId: item.library_id,
          rawData: {
            file: item.file,
            library,
            space,
            recent_time: item.recent_time,
          },
        };
      } else {
        const formattedLib = formatLibrary(library || {});
        const position = space ? space.name : "--";
        return {
          type: "library" as const,
          id: item.resource_id,
          name: formattedLib.name,
          icon: formattedLib.icon,
          position,
          owner: creator?.nickname || creator?.username || "",
          isFavorite: item.is_favorite ?? false,
          recentTime: getFormatTimeStamp(item.recent_time),
          rawData: { library, space, recent_time: item.recent_time },
        };
      }
    });
  }, []);

  const loadRecently = useCallback(
    async (kw?: string, startOffset: number = 0, append: boolean = false) => {
      if (loadingRef.current) return;
      loadingRef.current = true;

      if (startOffset === 0) setLoading(true);
      else setLoadingMore(true);

      try {
        const params: any = {
          offset: startOffset,
          limit: PAGE_SIZE,
          keyword: kw || undefined,
        };
        if (filterType !== "all") {
          params.resource_type = filterType === "library" ? 1 : 2;
        }

        const res = await mySpaceApi.getRecently(params);
        const parsed = parseResponse(res);

        if (append) {
          setItems((prev) => [...prev, ...parsed]);
        } else {
          setItems(parsed);
        }

        setHasMore(parsed.length >= PAGE_SIZE);
        setOffset(startOffset + parsed.length);
      } catch (error) {
        console.error("Failed to load recently:", error);
        if (!append) setItems([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
        loadingRef.current = false;
      }
    },
    [filterType, parseResponse],
  );

  // 初始加载 & keyword/filterType 变化时重新加载
  useEffect(() => {
    loadRecently(keyword, 0, false);
  }, [keyword, filterType]);

  // refreshKey 变化时刷新列表
  useEffect(() => {
    if (refreshKey && refreshKey > 0) {
      loadRecently(keyword, 0, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // 加载更多
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    await loadRecently(keyword, offset, true);
  }, [loadingMore, hasMore, keyword, offset, loadRecently]);

  // Handle favorite toggle
  const handleToggleFavorite = async (
    type: "library" | "file",
    resourceId: string,
    isFavorite: boolean,
  ) => {
    try {
      await favoritesApi.toggle({
        resource_type: type === "library" ? 1 : 2,
        resource_id: resourceId,
      });
      message.success(isFavorite ? '已取消' : '已收藏')
      loadRecently(keyword, 0, false);
    } catch (error) {
      message.error("操作失败");
    }
  };

  // Handle open in new tab
  const handleOpenNewTab = (url: string) => {
    window.open(url, "_blank");
  };

  // Handle row click
  const handleRowClick = async (item: VisitItem) => {
    if (item.type === "library") {
      navigate(`/library/${item.id}`);
    } else {
      if (item.position === "--") {
        try {
          const fileData = await filesApi.get(item.id);
          const formattedFile = formatFile(fileData);
          if (onPreview) {
            onPreview(
              {
                id: formattedFile.id,
                name: formattedFile.name,
                icon: formattedFile.icon,
                file_url: formattedFile.file_url,
                file_ext: formattedFile.file_ext,
                file_mime: formattedFile.file_mime,
                library_id: formattedFile.library_id,
                updated_time: getFormatTimeStamp(formattedFile.updated_time),
                isFavorite: item.isFavorite,
                isfolder: formattedFile.isfolder,
                rawData: fileData,
              },
              "",
            );
          }
        } catch (error) {
          console.error("Failed to load file details:", error);
        }
      } else {
        if (item.isfolder) {
          navigate(`/library/${item.libraryId}/folder/${item.id}`);
        } else {
          navigate(`/library/${item.libraryId}/file/${item.id}`);
        }
      }
    }
  };

  // Filter dropdown items
  const filterMenuItems: MenuProps["items"] = [
    {
      key: "all",
      label: "全部",
      onClick: (e) => {
        e.domEvent.stopPropagation();
        setFilterType("all");
      },
    },
    {
      key: "library",
      label: "知识库",
      onClick: (e) => {
        e.domEvent.stopPropagation();
        setFilterType("library");
      },
    },
    {
      key: "file",
      label: "知识",
      onClick: (e) => {
        e.domEvent.stopPropagation();
        setFilterType("file");
      },
    },
  ];

  const getFilterLabel = () => {
    switch (filterType) {
      case "library":
        return "知识库";
      case "file":
        return "知识";
      default:
        return "全部";
    }
  };

  // 知识库功能关闭时，过滤掉位置不为 '--' 的条目
  const displayItems = useMemo(() => {
    if (checkVersion(VERSION_MODULE.KNOWLEDGE_BASE)) return items;
    return items.filter((item) => item.position === "--");
  }, [items]);

  const isEmpty = displayItems.length === 0;

  // 筛选后为空时仍保留表头，方便重新筛选
  const showTable = !isEmpty || filterType !== "all";

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="flex-1">
      {showTable && (
        <div className="bg-white rounded-lg border border-gray-200 mt-4">
          <div className="h-12 flex items-center gap-2 px-4 border-b border-gray-100">
            {/* 全部列 - 带下拉筛选 */}
            <div className="flex-1 min-w-0">
              <Dropdown menu={{ items: filterMenuItems }} trigger={["click"]}>
                <Button
                  type="text"
                  className="p-0 h-auto font-medium text-sm text-[#4F5052]"
                >
                  {getFilterLabel()}{" "}
                  <SvgIcon name="down-one-filled" size={18} />
                </Button>
              </Dropdown>
            </div>

            {/* 位置列 */}
            <div className="w-[160px] flex-shrink-0 text-sm text-[#4F5052] font-medium">
              位置
            </div>

            {/* 所有人列 */}
            <div className="w-[100px] flex-shrink-0 text-sm text-[#4F5052] font-medium">
              所有人
            </div>

            {/* 访问时间列 */}
            <div className="w-[140px] flex-shrink-0 text-sm text-[#4F5052] font-medium text-right">
              访问时间
            </div>

            {/* 操作列 */}
            <div className="w-[48px] flex-shrink-0"></div>
          </div>

          {/* Table Content */}
          {!isEmpty && (
            <div className="flex flex-col">
              {displayItems.map((item) => {
                const url =
                  item.type === "library"
                    ? buildUrl(`/library/${item.id}`)
                    : item.position === "--"
                      ? buildUrl(`/mine?tab=visit&preview=${item.id}`)
                      : item.isfolder
                        ? buildUrl(
                            `/library/${item.libraryId}/folder/${item.id}`,
                          )
                        : buildUrl(
                            `/library/${item.libraryId}/file/${item.id}`,
                          );

                return (
                  <div
                    key={`${item.type}-${item.id}`}
                    className="resource-item-row h-12 flex items-center gap-2 px-4"
                    onClick={() => handleRowClick(item)}
                  >
                    {/* 名称列 */}
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      {item.type === "library" ? (
                        <VirtualLogo
                          text={item.name}
                          src={getPublicPath("/images/default_popover_img.png")}
                          size={26}
                        />
                      ) : (
                        <img
                          className="flex-none w-6 h-6"
                          src={item.icon}
                          alt=""
                        />
                      )}
                      <span className="text-sm text-primary truncate">
                        {item.name}
                      </span>
                      {item.isFavorite && (
                        <SvgIcon
                          name="star-filled"
                          color="#FFB300"
                          className="text-[#FFB300] flex-shrink-0"
                          size="14"
                        />
                      )}
                    </div>

                    {/* 位置列 */}
                    <div className="w-[160px] flex-shrink-0 text-sm text-placeholder truncate">
                      {item.position}
                    </div>

                    {/* 所有人列 */}
                    <div className="w-[100px] flex-shrink-0 text-sm text-placeholder truncate">
                      {item.owner}
                    </div>

                    {/* 访问时间列 */}
                    <div className="w-[140px] flex-shrink-0 text-sm text-placeholder text-right">
                      {item.recentTime}
                    </div>

                    {/* 操作列 */}
                    <div className="w-[48px] flex-shrink-0 flex justify-end more-actions">
                      <MoreDropdown
                        size="28px"
                        icon="more-h"
                        iconSize={16}
                        backgroundColor="#F5F6F7"
                        items={[
                          {
                            key: "new-tab",
                            icon: "arrow-right-up",
                            label: t("common.new_tab_page") + t("action.open"),
                          },
                          { key: "divider", divided: true },
                          {
                            key: "favorite",
                            icon: item.isFavorite ? "star-cancel" : "star",
                            label: item.isFavorite ? "取消收藏" : "收藏",
                          },
                        ]}
                        onCommand={(cmd) => {
                          if (cmd === "new-tab") {
                            handleOpenNewTab(url);
                          } else if (cmd === "favorite") {
                            handleToggleFavorite(
                              item.type,
                              item.id,
                              item.isFavorite,
                            );
                          }
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 加载更多 sentinel */}
          {hasMore && !loading && !isEmpty && (
            <div
              className="flex justify-center py-4"
              ref={(el) => {
                if (el) {
                  const observer = new IntersectionObserver(
                    (entries) => {
                      if (entries[0].isIntersecting) {
                        loadMore();
                      }
                    },
                    { threshold: 0.1 },
                  );
                  observer.observe(el);
                  return () => observer.disconnect();
                }
              }}
            >
              {loadingMore && <Spin size="small" />}
            </div>
          )}
        </div>
      )}
      {/* 初始就为空时显示空状态，筛选后为空时不显示 */}
      {isEmpty && filterType === "all" && (
        <div className="mt-[200px]">
          <Empty
            styles={{ image: { height: 100 } }}
            image={getPublicPath("/images/empty.png")}
            description="暂无最近访问文档"
          />
        </div>
      )}
    </div>
  );
}
