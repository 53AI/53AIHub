import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Empty, Spin, message, Button } from "antd";
import { Dropdown } from "@km/shared-components-react";
import type { MenuProps } from "antd";
import favoritesApi from "@/api/modules/favorites";
import mySpaceApi from "@/api/modules/my-space";
import filesApi from "@/api/modules/files";
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
import { useFolderNavigation } from "../useFolderNavigation";
import { FolderBrowser } from "../FolderBrowser";
import type { FilterType } from "../types";
import "../mine.css";

interface FavItem {
  type: "library" | "file";
  id: string;
  name: string;
  icon: string;
  position: string;
  owner: string;
  favoriteTime: string;
  isFavorite: boolean;
  isfolder?: boolean;
  libraryId?: string;
  rawData: any;
}

interface FavViewProps {
  keyword?: string;
  onPreview?: (file: any, content?: string) => void;
  refreshKey?: number;
}

interface InternalUser {
  user_id: number;
  nickname: string;
  username: string;
}

const PAGE_SIZE = 30;

export default function FavView({ keyword = "", onPreview, refreshKey }: FavViewProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [items, setItems] = useState<FavItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [userMap, setUserMap] = useState<Map<string, string>>(new Map());

  const prevKeywordRef = useRef(keyword);
  const loadingRef = useRef(false);

  const {
    currentPath,
    breadcrumb,
    dirList,
    fileList,
    dirLoading,
    fileLoading,
    dirError,
    fileError,
    enterFolder,
    goToPath,
    refreshDirs,
    refreshFiles,
  } = useFolderNavigation("全部收藏");

  // 解析 includes，构建 lookup map
  const parseResponse = useCallback((data: any) => {
    const includes = data.includes || {};
    const librariesMap: Record<string, any> = includes.libraries || {};
    const spacesMap: Record<string, any> = includes.spaces || {};
    const usersMapFromIncludes: Record<string, any> = includes.users || {};

    return (data.items || []).map((item: any) => {
      const isFile = item.resource_type === 2;
      const library = item.library_id ? librariesMap[item.library_id] : null;
      const space = item.space_id ? spacesMap[item.space_id] : null;
      const creatorFromIncludes = item.creator_id
        ? usersMapFromIncludes[item.creator_id]
        : null;
      const owner =
        creatorFromIncludes?.nickname || creatorFromIncludes?.username;

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
          owner,
          favoriteTime: getFormatTimeStamp(item.recent_time),
          isFavorite: item.is_favorite ?? true,
          isfolder: formattedFile.isfolder,
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
          owner,
          favoriteTime: getFormatTimeStamp(item.recent_time),
          isFavorite: item.is_favorite ?? true,
          rawData: { library, space, recent_time: item.recent_time },
        };
      }
    });
  }, []);

  const loadFavorites = useCallback(
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

        const res = await mySpaceApi.getFavorites(params);
        const parsed = parseResponse(res);

        if (append) {
          setItems((prev) => [...prev, ...parsed]);
        } else {
          setItems(parsed);
        }

        setHasMore(parsed.length >= PAGE_SIZE);
        setOffset(startOffset + parsed.length);
      } catch (error) {
        console.error("Failed to load favorites:", error);
        if (!append) setItems([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
        loadingRef.current = false;
      }
    },
    [filterType, parseResponse],
  );

  // 初始加载 & keyword/filterType 变化时重新加载（仅在根路径）
  useEffect(() => {
    if (currentPath === "/") {
      loadFavorites(keyword, 0, false);
    }
  }, [keyword, filterType, currentPath]);

  // refreshKey 变化时刷新列表
  useEffect(() => {
    if (refreshKey && refreshKey > 0) {
      if (currentPath === "/") {
        loadFavorites(keyword, 0, false);
      } else {
        refreshDirs();
        refreshFiles();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // keyword 变化时跟踪
  useEffect(() => {
    prevKeywordRef.current = keyword;
  }, [keyword]);

  // 加载更多
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    await loadFavorites(keyword, offset, true);
  }, [loadingMore, hasMore, keyword, offset, loadFavorites]);

  // Handle unfavorite
  const handleToggleFavorite = async (
    type: "library" | "file",
    resourceId: string,
  ) => {
    try {
      await favoritesApi.toggle({
        resource_type: type === "library" ? 1 : 2,
        resource_id: resourceId,
      });
      message.success("已取消");
      if (currentPath === "/") {
        loadFavorites(keyword, 0, false);
      } else {
        refreshFiles();
      }
    } catch (error) {
      message.error("操作失败");
    }
  };

  // Handle open in new tab
  const handleOpenNewTab = (url: string) => {
    window.open(url, "_blank");
  };

  // Handle row click
  const handleRowClick = async (item: FavItem) => {
    if (item.type === "library") {
      navigate(`/library/${item.id}`);
    } else {
      if (item.position === "--") {
        try {
          const fileData = await filesApi.get(item.id);
          const formattedFile = formatFile(fileData);
          // if (formattedFile.isfolder) {
          //   const folderPath = formattedFile.path?.startsWith('/') ? formattedFile.path : `/${formattedFile.path}`
          //   enterFolder(folderPath)
          // } else
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
                isfolder: false,
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

  const isEmpty =
    currentPath === "/"
      ? displayItems.length === 0
      : dirList.length === 0 &&
        fileList.length === 0 &&
        !dirError &&
        !fileError;

  if (loading && currentPath === "/") {
    return (
      <div className="flex justify-center py-8">
        <Spin size="large" />
      </div>
    );
  }

  // 文件夹浏览模式
  if (currentPath !== "/") {
    return (
      <div>
        <FolderBrowser
          breadcrumb={breadcrumb}
          dirList={dirList}
          fileList={fileList}
          dirLoading={dirLoading}
          fileLoading={fileLoading}
          dirError={dirError}
          fileError={fileError}
          onBreadcrumbClick={(index) => goToPath(breadcrumb[index].path)}
          onPreview={onPreview}
          onEnterFolder={enterFolder}
          onRefreshDirs={refreshDirs}
          onRefreshFiles={refreshFiles}
        />
        {isEmpty && (
          <div className="mt-8 flex justify-center">
            <Empty
              styles={{ image: { height: 100 } }}
              image={getPublicPath("/images/empty.png")}
              description="暂无内容"
            />
          </div>
        )}
      </div>
    );
  }

  // 筛选后为空时仍保留表头，方便重新筛选
  const showTable = !isEmpty || filterType !== "all";

  // 收藏列表模式
  return (
    <div className="flex-1">
      {showTable && (
        <div className="bg-white rounded-lg border border-gray-200 mt-4">
          <div className="h-12 flex items-center gap-2 px-4 border-b border-gray-100">
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

            <div className="w-[160px] flex-shrink-0 text-sm text-[#4F5052] font-medium">
              位置
            </div>
            <div className="w-[100px] flex-shrink-0 text-sm text-[#4F5052] font-medium">
              所有人
            </div>
            <div className="w-[140px] flex-shrink-0 text-sm text-[#4F5052] font-medium text-right">
              收藏时间
            </div>
            <div className="w-[48px] flex-shrink-0"></div>
          </div>

          <div className="flex flex-col">
            {displayItems.map((item, index) => {
              const url =
                item.type === "library"
                  ? buildUrl(`/library/${item.id}`)
                  : item.position === "--"
                    ? buildUrl(`/mine?tab=fav&preview=${item.id}`)
                    : item.isfolder
                      ? buildUrl(`/library/${item.libraryId}/folder/${item.id}`)
                      : buildUrl(`/library/${item.libraryId}/file/${item.id}`);

              return (
                <div
                  key={`${item.type}-${item.id}-${index}`}
                  className="resource-item-row h-12 flex items-center gap-2 px-4"
                  onClick={() => handleRowClick(item)}
                >
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
                    <SvgIcon
                      name="star-filled"
                      color="#FFB300"
                      className="text-[#FFB300] flex-shrink-0"
                      size="14"
                    />
                  </div>

                  <div className="w-[160px] flex-shrink-0 text-sm text-placeholder truncate">
                    {item.position}
                  </div>
                  <div className="w-[100px] flex-shrink-0 text-sm text-placeholder truncate">
                    {item.owner}
                  </div>
                  <div className="w-[140px] flex-shrink-0 text-sm text-placeholder text-right">
                    {item.favoriteTime}
                  </div>

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
                          key: "unfavorite",
                          icon: "star-cancel",
                          label: "取消收藏",
                        },
                      ]}
                      onCommand={(cmd) => {
                        if (cmd === "new-tab") handleOpenNewTab(url);
                        else if (cmd === "unfavorite")
                          handleToggleFavorite(item.type, item.id);
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {hasMore && !loading && (
            <div
              className="flex justify-center py-4"
              ref={(el) => {
                if (el) {
                  const observer = new IntersectionObserver(
                    (entries) => {
                      if (entries[0].isIntersecting) loadMore();
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

      {/* 初始就为空时显示空状态，筛选后为空时在表格内不显示额外空状态 */}
      {isEmpty && filterType === "all" && (
        <div className="mt-[200px]">
          <Empty
            styles={{ image: { height: 100 } }}
            image={getPublicPath("/images/empty.png")}
            description="暂无收藏的文档"
          />
        </div>
      )}
    </div>
  );
}
