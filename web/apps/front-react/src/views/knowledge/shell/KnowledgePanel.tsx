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
import { Search, SvgIcon, Tabs } from "@km/shared-components-react";
import type { MenuProps } from "antd";
import { useUserStore } from "@/stores/modules/user";
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
import type { WikiStatsResponse } from "@/api/modules/wiki";
import { t } from "@/locales";
import type { SortOrder } from "../types";
import { InfoSaveDialog, type InfoSaveDialogRef } from "../library/InfoSaveDialog";
import List from "../library/List";
import { getPublicPath, admin_url } from "@/utils/config";

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
    const url = buildAdminUrl(`/space/${activeSpaceId}/setting`);
    window.open(url, "_blank");
  }, [buildAdminUrl, activeSpaceId]);

  // 跳转到空间成员与权限管理页（console-react: #/space/:id/setting/members）
  const handleJumpToSpaceMembers = useCallback(() => {
    console.log(activeSpaceId)
    if (!activeSpaceId) return;
    const url = buildAdminUrl(`/space/${activeSpaceId}/setting/members`);
    window.open(url, "_blank");
  }, [buildAdminUrl, activeSpaceId]);

  // 是否为管理员（与 ProfilePopover 中的判断保持一致）
  const isAdmin = Boolean(userStore.info.role) && userStore.info.role > 1;

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
  const wikiUrl = activeSpaceId
    ? `/knowledge/wiki?space_id=${activeSpaceId}`
    : "/knowledge/wiki";
  // 摘要 / 实体 / 概念三个独立跳转链接，落到 wiki 页签上对应类型的列表
  const wikiTypeUrl = (pageType: "summary" | "entity" | "concept") =>
    activeSpaceId
      ? `/knowledge/wiki?space_id=${activeSpaceId}&sub=list&page_type=${pageType}`
      : `/knowledge/wiki?sub=list&page_type=${pageType}`;

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

  // 加载 wiki 统计（仅在开启动态知识时）
  useEffect(() => {
    let mounted = true;
    if (!activeSpaceId || !dynamicEnabled) {
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
  }, [activeSpaceId, dynamicEnabled]);

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
    return (
      <div className="flex h-full">
        {/* 左侧：空间侧边栏 */}
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
                  <img src={item.icon} alt={item.name} className="size-10" />
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
                  {dynamicEnabled && (
                    <div className="mb-8">
                      <div className="text-xl font-medium">{t('dynamic_knowledge.label')}</div>
                      <div className="border p-4  rounded-xl mt-5 flex items-center gap-3">
                        <Link
                          to={wikiTypeUrl('summary')}
                          className="flex-1 bg-[#F8F9FA] rounded-xl p-4 flex items-center gap-2 overflow-hidden group hover:bg-[#F0F5FF] transition-colors"
                        >
                          <div className="size-12 bg-[#E6EEFF] rounded-xl flex-shrink-0 flex items-center justify-center">
                            <img className="size-[22px]" src={getPublicPath('/images/wiki/summary.png')} />
                          </div>
                          <div className="flex-1 overflow-hidden">
                            <div className="flex items-center justify-between">
                              <h4 className="flex-1 text-base text-primary truncate">{t('dynamic_knowledge.summary')}
                                <span className="ml-1.5 bg-[#F2F2F2] px-2 py-0.5 text-xs text-[#9CA3AF] rounded-full">{formatStatNumber(wikiStats?.wiki_summary_count)}</span>
                                </h4>
                            </div>
                            <p className="text-xs text-[#939499] line-clamp-1">{t('dynamic_knowledge.summary_desc')}</p>
                          </div>
                        </Link>
                        <Link
                          to={wikiTypeUrl('entity')}
                          className="flex-1 bg-[#F8F9FA] rounded-xl p-4 flex items-center gap-2 overflow-hidden group hover:bg-[#F0F5FF] transition-colors"
                        >
                          <div className="size-12 bg-[#E6EEFF] rounded-xl flex-shrink-0 flex items-center justify-center">
                            <img className="size-[22px]" src={getPublicPath('/images/wiki/entity.png')} />
                          </div>
                          <div className="flex-1 overflow-hidden">
                            <div className="flex items-center justify-between">
                              <h4 className="flex-1 text-base text-primary truncate">{t('dynamic_knowledge.entity')}
                                <span className="ml-1.5 bg-[#F2F2F2] px-2 py-0.5 text-xs text-[#9CA3AF] rounded-full">{formatStatNumber(wikiStats?.wiki_entity_count)}</span>
                                </h4>
                            </div>
                            <p className="text-xs text-[#939499] line-clamp-1">{t('dynamic_knowledge.entity_desc')}</p>
                          </div>
                        </Link>
                        <Link
                          to={wikiTypeUrl('concept')}
                          className="flex-1 bg-[#F8F9FA] rounded-xl p-4 flex items-center gap-2 overflow-hidden group hover:bg-[#F0F5FF] transition-colors"
                        >
                          <div className="size-12 bg-[#E6EEFF] rounded-xl flex-shrink-0 flex items-center justify-center">
                            <img className="size-[22px]" src={getPublicPath('/images/wiki/concept.png')} />
                          </div>
                          <div className="flex-1 overflow-hidden">
                            <div className="flex items-center justify-between">
                              <h4 className="flex-1 text-base text-primary truncate">{t('dynamic_knowledge.concept')}
                                <span className="ml-1.5 bg-[#F2F2F2] px-2 py-0.5 text-xs text-[#9CA3AF] rounded-full">{formatStatNumber(wikiStats?.wiki_concept_count)}</span>
                                </h4>
                            </div>
                            <p className="text-xs text-[#939499] line-clamp-1">{t('dynamic_knowledge.concept_desc')}</p>
                          </div>
                        </Link>
                        <Link
                          to={wikiUrl}
                          className="flex-1 bg-[#F8F9FA] rounded-xl p-4 flex items-center gap-2 overflow-hidden hover:bg-[#F0F5FF] transition-colors"
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
        {dynamicEnabled && (
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
