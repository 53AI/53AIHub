import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Input, Spin, Skeleton } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { Search, Tabs, Dropdown, SvgIcon } from "@km/shared-components-react";
import type { MenuProps } from "antd";
import { useUserStore } from "@/stores/modules/user";
import { useSpaceStore } from "@/stores/modules/space";
import { useIsSoftStyle } from "@/stores/modules/enterprise";
import { InfoSaveDialog, type InfoSaveDialogRef } from "./InfoSaveDialog";
import { EntityDisplay } from "@/components/EntityDisplay";
import { PERMISSION_TYPE, RESOURCE_TYPE, type PermissionType } from "@/components/KMPermission/constant";
import { checkHasKMPermission } from "@/utils/km-permission";
import permissionsApi from "@/api/modules/permissions";
import { getFormatTimeStamp } from "@km/shared-utils";
import { t } from "@/locales";
import List from "./List";
import "./GroupList.css";


const FileSearch = lazy(() =>
  import("@/components/FileSearch").then((m) => ({ default: m.FileSearch })),
);

interface GroupListProps {
  stickyOffset?: number;
  spaceId?: string;
}

export type SortOrder = 'updated_time' | 'created_time';

export function GroupList({
  stickyOffset = 0,
  spaceId: propSpaceId,
}: GroupListProps) {
  const isSoftStyle = useIsSoftStyle();
  const navigate = useNavigate();
  
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
  const [keyword, setKeyword] = useState("");
  const [spacePermission, setSpacePermission] = useState<PermissionType>(PERMISSION_TYPE.viewer);
  const [loading, setLoading] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>('updated_time');

  // 用于滚动到选中项
  const selectedSpaceRef = useRef<HTMLDivElement>(null);
  const initialScrollDoneRef = useRef(false);

  // 权限判断
  const hasManagePermission = useMemo(() => {
    return checkHasKMPermission(spacePermission, PERMISSION_TYPE.manage);
  }, [spacePermission]);

  // 加载空间权限
  const loadSpacePermission = useCallback(async (spaceId: string) => {
    try {
      const res = await permissionsApi.my({
        resource_type: RESOURCE_TYPE.space,
        resource_id: spaceId
      });
      setSpacePermission(res.max_permission);
      return res.max_permission;
    } catch {
      return PERMISSION_TYPE.none;
    }
  }, []);

  // 创建知识库
  const handleCreate = useCallback(() => {
    if (!activeSpaceId) return;
    infoSaveDialogRef.current?.open();
  }, [activeSpaceId]);

  // 排序处理
  const handleSortOrder = useCallback((order: SortOrder) => {
    setSortOrder(order);
  }, []);

  // 排序菜单
  const sortMenuItems: MenuProps['items'] = [
    {
      key: 'updated_time',
      label: t('agent.sort_by_updated_time'),
    },
    {
      key: 'created_time',
      label: t('agent.sort_by_created_time'),
    },
  ];

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      setLoading(true);
      try {
        const list = await loadSpaceList();
        if (!mounted) return;

        const targetSpaceId = propSpaceId || params.space_id || searchParams.get("space_id");
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
  }, [propSpaceId, params.space_id, searchParams, loadSpaceList, setSpaceId, loadSpacePermission]);

  // 当 activeSpaceId 变化时更新权限
  useEffect(() => {
    if (activeSpaceId && isSoftStyle) {
      setSpaceId(activeSpaceId);
      loadSpacePermission(activeSpaceId);
    }
  }, [activeSpaceId, isSoftStyle, setSpaceId, loadSpacePermission]);

  // 滚动到选中的空间（仅首次加载时）
  useEffect(() => {
    if (isSoftStyle && activeSpaceId && spaceList.length > 0 && !initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      // 使用 setTimeout 确保 DOM 已渲染
      setTimeout(() => {
        selectedSpaceRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }, 100);
    }
  }, [isSoftStyle, activeSpaceId, spaceList.length]);

  const handleSpaceClick = (spaceId: string) => {
    setActiveSpaceId(spaceId);
    // 更新路由参数（查询参数形式）
    navigate(`/knowledge?space_id=${spaceId}`);
  };

  const handleTabChange = (key: string) => {
    setActiveSpaceId(key);
    // 更新路由参数（网站模式，查询参数形式）
    navigate(`/knowledge?space_id=${key}`);
  };

  const tabItems = useMemo(() => {
    return spaceList.map((item) => ({
      key: item.id,
      label: item.name,
    }));
  }, [spaceList]);

  // 软件模式：两列布局（左侧侧边栏 + 右侧内容）
  if (isSoftStyle) {
    return (
      <div className="flex h-full">
        {/* 左侧：空间侧边栏 */}
        <div className="w-[252px] h-full py-3 bg-white border-r border-[#E5E7EB] flex flex-col shrink-0">
          <div className="h-9 px-5 flex items-center">
            <div className="flex-1 text-sm text-[#1D1E1F]">{t('module.space')}</div>
          </div>
          {
            userStore.info.is_internal && (<Suspense
            fallback={<Skeleton.Input active size="small" block />}
          >
            <div className="px-2 mt-2">
              <FileSearch />
            </div>
          </Suspense>)
          }
          
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
                    <p className="flex-1 text-sm text-primary truncate">{item.name}</p>
                    <span className="text-xs text-[#9CA3AF]">
                      {
                        item.owner_id ? (<EntityDisplay
                          type="user"
                          id={item.owner_id}
                          mode="name"
                        />) : t("common.system")
                      }

                    </span>
                  </div>
                  <p className="text-xs text-[#888994]  mt-0.5">{getFormatTimeStamp(item.updated_time, "YYYY-MM-DD hh:ss")}</p>
                </div>
              </div>
            ))}
          </nav>
        </div>
        {/* 右侧：知识库列表 */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Header */}
          <div className="flex-none h-14"></div>

          {/* Content */}
          <div className="flex-1 pb-5 overflow-y-auto">
            <div className="w-11/12 lg:w-4/5 max-w-[1200px] mx-auto">
              {loading ? (
                <div className="h-full flex items-center justify-center">
                  <Spin size="large" />
                </div>
              ) : (
                <>
                  {/* Space Header */}
                  <div className="h-[120px] flex items-center gap-5 mt-10">
                    <div className="size-20 flex items-center justify-centerrounded-full">
                      {currentSpace?.icon ? (
                        <img
                          src={currentSpace.icon}
                          className="w-full h-full rounded-full object-cover"
                          alt=""
                        />
                      ) : (
                        <div className="w-full h-full rounded-full bg-blue-500 flex items-center justify-center text-white text-2xl font-medium">
                          {currentSpace?.name?.charAt(0) || 'S'}
                        </div>
                      )}
                    </div>
                    <p className="flex-1 text-3xl whitespace-nowrap overflow-hidden text-ellipsis">
                      {currentSpace?.name}
                    </p>
                    {hasManagePermission && (
                      <Button type="primary" ghost onClick={handleCreate} className="bg-white px-3">
                        <div className="flex items-center gap-1">
                          <SvgIcon name="plus" size={20} />
                          {t('action.create')}{t('module.library')}
                        </div>
                      </Button>
                    )}
                  </div>

                  {/* Library List Header */}
                  <div className="flex items-center gap-3 mt-9 mb-6">
                    <p className="text-base text-[#1D1E1F]">{t('space.team')}</p>
                    <Dropdown menu={{ items: sortMenuItems, onClick: ({ key }) => handleSortOrder(key as SortOrder) }} trigger={['click']} placement="bottomLeft">
                      <div className="size-6 text-[#4F5052] flex items-center justify-center rounded hover:border cursor-pointer">
                        <SvgIcon name="sort-one" />
                      </div>
                    </Dropdown>
                  </div>

                  {/* Library List */}
                  {activeSpaceId && (
                    <List
                      spaceId={activeSpaceId}
                      keyword={keyword}
                      sortOrder={sortOrder}
                    />
                  )}
                </>
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

  // 网站模式：保持原有样式
  return (
    <div className="group-list-container">
      <div className="group-list-header" style={{ top: stickyOffset }}>
        <div className="flex md:flex-row flex-col-reverse gap-5 items-stretch md:items-center justify-between bg-white py-2 overflow-hidden">
          <Tabs
            activeKey={activeSpaceId}
            onChange={handleTabChange}
            className="flex-1 min-w-0 group-list-tabs"
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

      {activeSpaceId && (
        <List spaceId={activeSpaceId} keyword={keyword} sortOrder={sortOrder} />
      )}
    </div>
  );
}

export default GroupList;
