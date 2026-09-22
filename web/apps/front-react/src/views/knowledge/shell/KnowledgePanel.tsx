import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  lazy,
  Suspense,
} from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { Dropdown, Input, Skeleton, Spin } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { SafeImage, Search, SvgIcon, Tabs } from "@km/shared-components-react";
import type { MenuProps } from "antd";
import { useUserStore, useIsAdmin } from "@/stores/modules/user";
import { useSpaceStore } from "@/stores/modules/space";
import { useIsSoftStyle } from "@/stores/modules/enterprise";
import { EntityDisplay } from "@/components/EntityDisplay";
import Header from "@/components/Layout/Header";
import { MoreDropdown, type MenuItem } from "@/components/MoreDropdown";
import {
  PERMISSION_TYPE,
  RESOURCE_TYPE,
  type PermissionType,
} from "@/components/KMPermission/constant";
import permissionsApi from "@/api/modules/permissions";
import wikiApi from "@/api/modules/wiki";
import type { WikiCategory, WikiStatsResponse } from "@/api/modules/wiki";
import { checkHasKMPermission } from "@/utils/km-permission";
import { t } from "@/locales";
import type { SortOrder } from "../types";
import { InfoSaveDialog, type InfoSaveDialogRef } from "../library/InfoSaveDialog";
import List from "../library/List";
import { admin_url } from "@/utils/config";

const GlobalSearch = lazy(() =>
  import("@/components/GlobalSearch").then((m) => ({ default: m.GlobalSearch })),
);


interface KnowledgePanelProps {
  stickyOffset?: number;
  spaceId?: string;
}

export function KnowledgePanel({
  stickyOffset = 0,
  spaceId: propSpaceId,
}: KnowledgePanelProps) {
  const isSoftStyle = useIsSoftStyle();

  const userStore = useUserStore();
  const params = useParams<{ space_id: string }>();
  const [searchParams] = useSearchParams();
  const infoSaveDialogRef = useRef<InfoSaveDialogRef>(null);

  // 使用 Zustand 选择器模式订阅状态
  const spaceList = useSpaceStore((state) => state.spaceList);
  const loadSpaceList = useSpaceStore((state) => state.loadSpaceList);
  const currentSpace = useSpaceStore((state) => state.currentSpace);
  const setSpaceId = useSpaceStore((state) => state.setSpaceId);

  const [activeSpaceId, setActiveSpaceId] = useState(
    propSpaceId || params.space_id || searchParams.get("space_id") || "",
  );
  const [, setSearchParams] = useSearchParams();
  const [keyword, setKeyword] = useState("");
  const [spacePermission, setSpacePermission] = useState<PermissionType>(
    PERMISSION_TYPE.viewer,
  );
  const [loading, setLoading] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>("updated_time");
  const [wikiStats, setWikiStats] = useState<WikiStatsResponse | null>(null);
  const [wikiCategories, setWikiCategories] = useState<WikiCategory[]>([]);
  // 权限与所属空间绑定：spaceId 不匹配当前空间时视为无权限，
  // 避免切换空间瞬间沿用旧空间权限，导致 stats/categories 请求被误发
  const [wikiPermission, setWikiPermission] = useState<{
    spaceId: string;
    permission: PermissionType;
  }>({ spaceId: "", permission: PERMISSION_TYPE.none });

  // 用于滚动到选中项
  const selectedSpaceRef = useRef<HTMLDivElement>(null);
  const initialScrollDoneRef = useRef(false);


  // 加载空间权限
  const loadSpacePermission = useCallback(async (spaceId: string) => {
    try {
      const res = await permissionsApi.my({
        resource_type: RESOURCE_TYPE.space,
        resource_id: spaceId,
      });
      setSpacePermission(res.max_permission);
      return res.max_permission;
    } catch {
      return PERMISSION_TYPE.none;
    }
  }, []);

  // 排序处理
  const handleSortOrder = useCallback((order: SortOrder) => {
    setSortOrder(order);
  }, []);

  // 跳转到管理后台（参考 ProfilePopover 的 handleJumpToAdmin）
  // console-react 使用 HashRouter：特定路由必须挂在 # 之后，否则会被当成服务器路径返回 404。
  // 同时 index.html 脚本通过 location.search 读取 access_token，因此 query 参数必须保持在 # 之前。
  const buildAdminUrl = useCallback(
    (path = "") => {
      const params = new URLSearchParams({
        access_token: userStore.info.access_token,
        eid: userStore.info.eid,
        from_origin: window.location.origin,
      });
      const query = params.toString();
      return path
        ? `${admin_url}?${query}#${path}`
        : `${admin_url}?${query}`;
    },
    [userStore.info.access_token, userStore.info.eid],
  );

  const handleJumpToAdmin = useCallback(() => {
    if (!activeSpaceId) return;
    const url = buildAdminUrl(`/knowledge?spaceId=${activeSpaceId}&tab=basic-info`);
    window.open(url, "_blank");
  }, [buildAdminUrl, activeSpaceId]);

  // 跳转到空间成员与权限管理页（console-react: #/space?spaceId=...&tab=members）
  const handleJumpToSpaceMembers = useCallback(() => {
    if (!activeSpaceId) return;
    const url = buildAdminUrl(`/knowledge?spaceId=${activeSpaceId}&tab=members`);
    window.open(url, "_blank");
  }, [buildAdminUrl, activeSpaceId]);

  // 是否为管理员（与 ProfilePopover 中的判断保持一致，集中到 userStore.useIsAdmin）
  const isAdmin = useIsAdmin();

  // MoreDropdown 菜单项：仅管理员可见
  const moreItems: MenuItem[] = [
    {
      key: "member-permission",
      icon: "peoples",
      label: t("permission.member_and_role"),
      disabled: !activeSpaceId,
    },
    {
      key: "manage",
      icon: "setting2",
      label: t("action.manage"),
    },
  ];

  // 处理 MoreDropdown 点击
  const handleMore = useCallback(
    (command: string | number) => {
      switch (command) {
        case "manage":
          handleJumpToAdmin();
          break;
        case "member-permission":
          handleJumpToSpaceMembers();
          break;
        default:
          break;
      }
    },
    [handleJumpToAdmin, handleJumpToSpaceMembers],
  );

  // 排序菜单
  const sortMenuItems: MenuProps["items"] = [
    {
      key: "updated_time",
      label: t("agent.sort_by_updated_time"),
    },
    {
      key: "created_time",
      label: t("agent.sort_by_created_time"),
    },
  ];

  // 当前排序标签
  const currentSortLabel =
    sortMenuItems?.find((item) => item?.key === sortOrder)?.label ??
    t("space.team");

  const builtSortMenuItems: MenuProps["items"] = sortMenuItems?.map((item) => ({
    ...item,
    label: (
      <div className="min-w-[120px] text-sm">
        {item?.label as string}
      </div>
    ),
  }));

  // 动态知识开关：开启时在列表上方显示 wiki 入口
  const dynamicEnabled = currentSpace?.enable_wiki_dynamic_knowledge === true;
  // 除开关外，还需当前用户对空间级 Wiki（resource_type=4）具备查看权限
  const showDynamicEntry =
    dynamicEnabled &&
    wikiPermission.spaceId === activeSpaceId &&
    checkHasKMPermission(wikiPermission.permission, PERMISSION_TYPE.viewer);
  const wikiUrl = activeSpaceId
    ? `/knowledge/wiki?space_id=${activeSpaceId}`
    : "/knowledge/wiki";
  // 分类卡片跳转链接：落到 wiki 页签的分类筛选列表
  const wikiCategoryUrl = (categoryId: string) =>
    activeSpaceId
      ? `/knowledge/wiki?space_id=${activeSpaceId}&sub=list&category_id=${categoryId}`
      : `/knowledge/wiki?sub=list&category_id=${categoryId}`;

  // 数字格式化：>999 加千分位，未加载时显示 0 占位
  const formatStatNumber = (n: number | undefined) => {
    if (n === undefined || n === null) return "0";
    return n.toLocaleString("en-US");
  };

  // 只在 space_id 变化时才重新初始化，避免刷新整个 panel
  const urlSpaceId = searchParams.get("space_id");

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      setLoading(true);
      try {
        const list = await loadSpaceList();
        if (!mounted) return;

        const targetSpaceId =
          propSpaceId || params.space_id || urlSpaceId;
        let selectedSpaceId = "";

        if (targetSpaceId && list.find((item) => item.id === targetSpaceId)) {
          selectedSpaceId = targetSpaceId;
        } else if (list.length > 0) {
          selectedSpaceId = list[0].id;
        }

        setActiveSpaceId(selectedSpaceId);

        if (selectedSpaceId) {
          setSpaceId(selectedSpaceId);
          await loadSpacePermission(selectedSpaceId);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    init();

    return () => {
      mounted = false;
    };
  }, [
    propSpaceId,
    params.space_id,
    urlSpaceId,
    loadSpaceList,
    setSpaceId,
    loadSpacePermission,
  ]);

  // 当 activeSpaceId 变化时更新权限
  useEffect(() => {
    if (activeSpaceId && isSoftStyle) {
      setSpaceId(activeSpaceId);
      loadSpacePermission(activeSpaceId);
    }
  }, [activeSpaceId, isSoftStyle, setSpaceId, loadSpacePermission]);

  // 动态知识入口查看权限：请求当前用户对空间级 Wiki（resource_type=4，resource_id=空间 id）的最大权限
  // fail-closed：权限只在与 spaceId 匹配时生效，新空间权限返回前 showDynamicEntry 恒为 false
  useEffect(() => {
    let mounted = true;
    if (!activeSpaceId) {
      setWikiPermission({ spaceId: "", permission: PERMISSION_TYPE.none });
      return;
    }
    permissionsApi
      .my({
        resource_type: RESOURCE_TYPE.wiki,
        resource_id: activeSpaceId,
      })
      .then((res) => {
        if (mounted)
          setWikiPermission({
            spaceId: activeSpaceId,
            permission: res.max_permission,
          });
      })
      .catch(() => {
        if (mounted)
          setWikiPermission({
            spaceId: activeSpaceId,
            permission: PERMISSION_TYPE.none,
          });
      });
    return () => {
      mounted = false;
    };
  }, [activeSpaceId]);

  // 加载 wiki 统计（仅在开启动态知识时）
  useEffect(() => {
    let mounted = true;
    if (!activeSpaceId || !showDynamicEntry) {
      setWikiStats(null);
      return;
    }
    wikiApi
      .stats(activeSpaceId)
      .then((data) => {
        if (mounted) setWikiStats(data);
      })
      .catch(() => {
        if (mounted) setWikiStats(null);
      });
    return () => {
      mounted = false;
    };
  }, [activeSpaceId, showDynamicEntry]);

  // 加载 wiki 分类列表（仅在开启动态知识时）
  useEffect(() => {
    let mounted = true;
    if (!activeSpaceId || !showDynamicEntry) {
      setWikiCategories([]);
      return;
    }
    wikiApi
      .categories(activeSpaceId)
      .then((data) => {
        if (mounted) {
          setWikiCategories(Array.isArray(data) ? data : data?.items ?? []);
        }
      })
      .catch(() => {
        if (mounted) setWikiCategories([]);
      });
    return () => {
      mounted = false;
    };
  }, [activeSpaceId, showDynamicEntry]);

  // 滚动到选中的空间（仅首次加载时）
  useEffect(() => {
    if (
      isSoftStyle &&
      activeSpaceId &&
      spaceList.length > 0 &&
      !initialScrollDoneRef.current
    ) {
      initialScrollDoneRef.current = true;
      setTimeout(() => {
        selectedSpaceRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }, 100);
    }
  }, [isSoftStyle, activeSpaceId, spaceList.length]);

  const handleSpaceClick = (spaceId: string) => {
    setActiveSpaceId(spaceId);
    setSearchParams({ space_id: spaceId }, { replace: true });
  };

  const handleTabChange = (key: string) => {
    setActiveSpaceId(key);
    setSearchParams({ space_id: key }, { replace: true });
  };

  const tabItems = useMemo(() => {
    return spaceList.map((item) => ({
      key: item.id,
      label: item.name,
    }));
  }, [spaceList]);

  // 软件模式：两列布局（左侧空间侧边栏 + 右侧内容）
  if (isSoftStyle) {
    // 只有一个空间时没有可切换项，整列不占位。
    const showSpaceSidebar = spaceList.length > 1;
    return (
      <div className="flex h-full">
        {/* 左侧：空间侧边栏 */}
        {showSpaceSidebar && (
          <div className="w-[280px] h-full py-3 bg-white border-r border-[#E5E7EB] flex flex-col shrink-0">
            <div className="h-9 px-5 flex items-center">
              <div className="flex-1 text-sm text-[#1D1E1F]">
                {t("module.space")}
              </div>
            </div>
            {userStore.info.is_internal && (
              <div className="px-2 mt-2">
                <Suspense fallback={<Skeleton.Input active size="small" block />}>
                  <GlobalSearch />
                </Suspense>
              </div>
            )}

            <nav className="p-2 space-y-1 flex-1 overflow-y-auto">
              {spaceList.map((item) => (
                <div
                  key={item.id}
                  ref={activeSpaceId === item.id ? selectedSpaceRef : null}
                  onClick={() => handleSpaceClick(item.id)}
                  className={`flex items-center gap-2.5 p-3 rounded-xl cursor-pointer transition-colors ${
                    activeSpaceId === item.id
                      ? "bg-[#F0F5FF]"
                      : "hover:bg-[#F0F5FF] "
                  }`}
                >
                  <div className="size-9 rounded-full overflow-hidden bg-white">
                    <SafeImage src={item.icon} alt={item.name} className="size-10" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <p className="flex-1 text-sm text-primary truncate">
                        {item.name}
                      </p>
                      <span className="text-xs text-[#9CA3AF]">
                        {item.library_count}
                      </span>
                    </div>
                    <p className="text-xs text-[#888994]  mt-0.5">
                      {item.owner_id ? (
                        <EntityDisplay type="user" id={item.owner_id} mode="name" />
                      ) : (
                        t("common.system")
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </nav>
          </div>
        )}
        {/* 右侧：知识库列表 */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-white overflow-y-auto">
          {isSoftStyle && (
            <Header
              title={t("module.index")}
              border={false}
              sticky
              after={isAdmin ? <MoreDropdown items={moreItems} onCommand={handleMore} placement="bottomRight" /> : undefined}
            />
          )}
          <div className="flex-1 min-h-0">
            <div className="h-full flex flex-col">
              {loading ? (
                <div className="h-full flex items-center justify-center">
                  <Spin size="large" />
                </div>
              ) : (
                <div className="w-11/12 md:w-4/5 max-w-[1200px] mx-auto py-4">
                  {showDynamicEntry && (
                    <div className="mb-8">
                      <div className="text-xl font-medium">{t('dynamic_knowledge.label')}</div>
                      <div className="border p-4 rounded-xl mt-5 flex flex-wrap items-center gap-3">
                        {wikiCategories.slice(0, 3).map((cat, idx) => {
                          // 沿用原摘要/实体/概念三张图标，按顺序分配给前三个分类
                          const icon = ["summary", "entity", "concept"][idx] ?? "summary";
                          return (
                            <Link
                              key={cat.id}
                              to={wikiCategoryUrl(cat.id)}
                              className="flex-1 min-w-[200px] bg-[#F8F9FA] rounded-xl p-4 flex items-center gap-2 overflow-hidden group hover:bg-[#F0F5FF] transition-colors"
                            >
                              <div className="size-12 bg-[#E6EEFF] rounded-xl flex-shrink-0 flex items-center justify-center">
                                <SafeImage className="size-[22px]" src={`/images/wiki/${icon}.png`} alt={cat.name} />
                              </div>
                              <div className="flex-1 overflow-hidden">
                                <h4 className="flex-1 text-base text-primary truncate">{cat.name}
                                  <span className="ml-1.5 bg-[#F2F2F2] px-2 py-0.5 text-xs text-[#9CA3AF] rounded-full">{formatStatNumber(cat.page_count)}</span>
                                </h4>
                                {cat.description && (
                                  <p className="text-xs text-[#939499] line-clamp-1">{cat.description}</p>
                                )}
                              </div>
                            </Link>
                          );
                        })}
                        <Link
                          to={wikiUrl}
                          className="flex-1 min-w-[200px] bg-[#F8F9FA] rounded-xl p-4 flex items-center gap-2 overflow-hidden hover:bg-[#F0F5FF] transition-colors"
                        >
                          <div className="flex-1 flex flex-col text-center">
                            <h5 className="text-2xl text-primary">{formatStatNumber(wikiStats?.month_new_docs)}</h5>
                            <p className="text-xs text-[#373A3D]">{t('dynamic_knowledge.month_new_docs')}</p>
                          </div>
                          <div className="border-l h-4"></div>
                          <div className="flex-1 flex flex-col text-center">
                            <h5 className="text-2xl text-primary">{formatStatNumber(wikiStats?.wiki_compiled_docs)}</h5>
                            <p className="text-xs text-[#373A3D]">{t('dynamic_knowledge.wiki_compiled_docs')}</p>
                          </div>
                        </Link>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between mb-5">
                    <div className="text-xl font-medium">{t('module.knowledge')}</div>
                    <div className="flex items-center gap-1">
                      <p className="text-base text-[#1D1E1F]">
                        {currentSortLabel}
                      </p>
                      <Dropdown
                        menu={{
                          items: builtSortMenuItems,
                          onClick: ({ key }) =>
                            handleSortOrder(key as SortOrder),
                        }}
                        trigger={["click"]}
                        placement="bottomLeft"
                      >
                        <div className="size-6 text-[#4F5052] flex items-center justify-center rounded hover:border cursor-pointer">
                          <SvgIcon name="sort-one" />
                        </div>
                      </Dropdown>
                    </div>
                  </div>

                  {activeSpaceId && (
                    <List
                      spaceId={activeSpaceId}
                      keyword={keyword}
                      sortOrder={sortOrder}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Dialog */}
        <InfoSaveDialog
          ref={infoSaveDialogRef}
          spaceId={activeSpaceId}
          onSuccess={() => {}}
        />
      </div>
    );
  }

  // 网站模式：顶部空间 Tabs + 内容
  return (
    <div className="h-full flex flex-col">
      <div
        className="sticky z-[100] bg-white"
        style={{ top: stickyOffset }}
      >
        <div className="flex md:flex-row flex-col-reverse gap-5 items-stretch md:items-center justify-between bg-white py-2 overflow-hidden">
          <Tabs
            activeKey={activeSpaceId}
            onChange={handleTabChange}
            className="flex-1 min-w-0 max-w-full overflow-hidden [&_.flex]:flex-nowrap"
            items={tabItems}
          />
          <div className="w-full md:w-auto flex items-center gap-2">
            <Search
              value={keyword}
              onDebouncedChange={setKeyword}
              placeholder={t("action.search") + t("module.knowledge")}
              className="hidden md:flex"
            />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              size="large"
              className="w-full md:hidden"
              placeholder={t("toolbox.search_placeholder")}
              prefix={<SearchOutlined />}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {showDynamicEntry && (
          <div className="px-6 pt-4">
            <Link
              to={wikiUrl}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#E5E7EB] bg-white text-sm text-main hover:border-blue-500 hover:bg-[#F2F6FF] transition-colors"
            >
              <SvgIcon name="bill" size={16} className="text-[#2563EB]" />
              <span>{t("dynamic_knowledge.label")}</span>
              <span className="text-xs text-[#9CA3AF]">›</span>
            </Link>
          </div>
        )}
        {activeSpaceId ? (
          <List
            spaceId={activeSpaceId}
            keyword={keyword}
            sortOrder={sortOrder}
          />
        ) : null}
      </div>
    </div>
  );
}

export default KnowledgePanel;
