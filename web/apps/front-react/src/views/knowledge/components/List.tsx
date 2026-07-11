import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useNavigate } from "react-router-dom";
import { Button, Spin, message } from "antd";
import { ClockCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import { useSpaceStore } from "@/stores/modules/space";
import { t } from "@/locales";
import { librariesApi, type LibraryItem } from "@/api/modules/libraries";
import permissionsApi from "@/api/modules/permissions";
import { PermissionEmpty } from "@/components/KMPermission";
import { checkHasKMPermission } from "@/utils/km-permission";
import {
  PERMISSION_TYPE,
  RESOURCE_TYPE,
  type PermissionType,
} from "@/components/KMPermission/constant";
import {
  ApplyDialog,
  type ApplyDialogRef,
} from "@/views/library/components/apply";
import { InfoSaveDialog, type InfoSaveDialogRef } from "./InfoSaveDialog";
import VirtualLogo from "@/components/VirtualLogo";
import { EntityDisplay } from "@/components/EntityDisplay";
import { useAbortController } from "@/hooks/useAbortController";
import { checkVersion } from "@/utils/version";
import { VERSION_MODULE } from "@/constants/enterprise";
import { getFormatTimeStamp } from "@km/shared-utils";
import type { SortOrder } from "./GroupList";
import "./List.css";

interface LibraryDisplayItem extends LibraryItem {
  permission: PermissionType;
  visible: boolean;
  user_group_ids?: string[];
}

interface ListProps {
  spaceId: string;
  keyword?: string;
  sortOrder?: SortOrder;
}

export interface ListRef {
  search: (keyword: string) => void;
}

export const List = forwardRef<ListRef, ListProps>(({ spaceId, keyword = "", sortOrder = 'updated_time' }, ref) => {
  const navigate = useNavigate();
  const spaceStore = useSpaceStore();
  useAbortController();

  const applyDialogRef = useRef<ApplyDialogRef>(null);
  const infoSaveDialogRef = useRef<InfoSaveDialogRef>(null);

  const [loading, setLoading] = useState(false);
  const [libraryList, setLibraryList] = useState<LibraryDisplayItem[]>([]);
  const [spacePermission, setSpacePermission] = useState<PermissionType>(
    PERMISSION_TYPE.viewer,
  );

  const hasManagePermission = useMemo(() => {
    return checkHasKMPermission(spacePermission, PERMISSION_TYPE.manage);
  }, [spacePermission]);

  const hasViewPermission = useMemo(() => {
    return spaceStore.currentSpace?.visibility
      ? true
      : checkHasKMPermission(spacePermission, PERMISSION_TYPE.viewer);
  }, [spacePermission, spaceStore.currentSpace?.visibility]);

  // 前端排序
  const sortedLibraries = useMemo(() => {
    const sortKey = sortOrder as keyof LibraryItem;
    return [...libraryList].sort((a, b) => {
      const aVal = (a[sortKey] as number) || 0;
      const bVal = (b[sortKey] as number) || 0;
      return bVal - aVal; // 降序：最新的在前
    });
  }, [libraryList, sortOrder]);

  // 根据关键词过滤列表
  const visibleLibraries = useMemo(() => {
    if (!keyword) return sortedLibraries;
    return sortedLibraries.filter((item) => item.name.includes(keyword));
  }, [sortedLibraries, keyword]);

  const loadLibraryList = useCallback(async () => {
    const list = await librariesApi.list({
      space_id: spaceId,
      with_file_count: 1,
      limit: 100,
    });

    const realItems: LibraryDisplayItem[] = list.map((item) => ({
      ...item,
      visible: true,
    }));

    setLibraryList(realItems);

    if (realItems.length > 0) {
      try {
        const permissionMap = await permissionsApi.myBatch({
          resource_type: RESOURCE_TYPE.library,
          resource_ids: realItems.map((item) => item.id),
        });
        setLibraryList((prev) =>
          prev.map((lib) => {
            const key = `${RESOURCE_TYPE.library}:${lib.id}`;
            // 如果 myBatch 没有返回权限，使用 list 返回的原始权限（继承权限）
            const batchPermission = permissionMap[key];
            const originalItem = list.find(item => item.id === lib.id);
            const originalPermission = originalItem?.permission ?? PERMISSION_TYPE.none;
            const permission = batchPermission !== undefined ? batchPermission : originalPermission;
            return { ...lib, permission };
          }),
        );
      } catch (error) {
        console.error("Failed to load library permissions:", error);
      }
    }
  }, [spaceId]);

  const loadSpacePermission = async () => {
    const res = await permissionsApi.my({
      resource_type: RESOURCE_TYPE.space,
      resource_id: spaceId,
    });
    setSpacePermission(res.max_permission);
  };

  const handleCreate = () => {
    if (!checkVersion(VERSION_MODULE.LIBRARY_COUNT)) {
      message.warning(
        t("common.feature_over_limit", { functionName: t("library.name") }),
      );
      return;
    }
    infoSaveDialogRef.current?.open();
  };

  const handleOpenLibrary = (item: LibraryDisplayItem) => {
    if (
      [PERMISSION_TYPE.loading, PERMISSION_TYPE.none].includes(
        item.permission as any,
      )
    )
      return;
    navigate(`/library/${item.id}`);
  };

  const handleApplyOpen = (item: LibraryDisplayItem) => {
    applyDialogRef.current?.open({
      permission: PERMISSION_TYPE.viewer,
      resource: item,
      resourceType: RESOURCE_TYPE.library,
    });
  };

  const search = (kw: string) => {
    if (kw === keyword) return;
  };

  useImperativeHandle(ref, () => ({
    search,
  }));

  useEffect(() => {
    if (!spaceId) return;

    setLoading(true);
    loadSpacePermission()
      .then(() => {
        if (
          spaceStore.currentSpace?.visibility ||
          spacePermission >= PERMISSION_TYPE.viewer
        ) {
          return loadLibraryList();
        }
      })
      .finally(() => {
        setLoading(false);
      });

    spaceStore.setSpaceId(spaceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  return (
    <div className="min-h-[60vh]">
      {loading ? (
        <div className="min-h-[60vh] flex justify-center items-center">
          <Spin size="large" />
        </div>
      ) : !hasViewPermission ? (
        <div className="min-h-[60vh]">
          <PermissionEmpty>
            <Button type="primary" onClick={() => navigate("/")}>
              {t("common.back_home")}
            </Button>
          </PermissionEmpty>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-4 max-md:grid-cols-2">
          {/* Library cards */}
          
          {/* Create library button */}
          {hasManagePermission && (
            <div
              className="h-[118px] rounded-lg border border-[#E8EEFA] bg-[#F7FAFF] flex justify-center items-center cursor-pointer transition-all duration-300 relative ease-linear hover:shadow-lg"
              onClick={handleCreate}
            >
              <div className="size-10 rounded-lg bg-[#E6EEFF] flex items-center justify-center mr-2">
                <PlusOutlined style={{ fontSize: "16px", color: "#2563EB" }} />
              </div>
              <div className="text-sm text-[#2563EB]">
                {t("action.create")}
                {t("module.library")}
              </div>
            </div>
          )}
          {visibleLibraries.map((item) => {
            return (
              <div
                key={item.id}
                className="h-[118px] bg-[#fff] rounded-lg p-5 border transition-all duration-300 ease-linear flex flex-col justify-between relative cursor-pointer hover:shadow-lg"
                onClick={() => handleOpenLibrary(item)}
              >
                <div
                  className={`flex-none h-9 flex items-center justify-between ${item.permission === PERMISSION_TYPE.none ? "blur-[2px]" : ""}`}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <VirtualLogo text={item.name} src={item.icon} size={48} />
                    <div className="flex-1 overflow-hidden">
                      <p className="whitespace-nowrap text-base text-primary truncate">
                        {item.name}
                      </p>
                      <p className="whitespace-nowrap text-xs text-placeholder truncate mt-1">
                        {item.description || "--"}
                      </p>
                    </div>
                  </div>
                </div>

                <div
                  className={`flex items-center justify-between text-xs text-placeholder ${item.permission === PERMISSION_TYPE.none ? "blur-[2px]" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <SvgIcon name="book-one" />
                      <span>
                        {t("library.docs_count", {
                          count: item.file_count || 0,
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <SvgIcon name="people" />
                      <EntityDisplay
                        type="user"
                        id={item.creator_id}
                        mode="name"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    <ClockCircleOutlined style={{ fontSize: "14px" }} />
                    <span>
                      {getFormatTimeStamp(item.updated_time, "YYYY-MM-DD")}
                    </span>
                  </div>
                </div>

                {/* Permission overlay */}
                {item.permission === PERMISSION_TYPE.none && (
                  <div className="absolute inset-0 flex justify-center items-center">
                    <div className="absolute inset-0 bg-[#999999] opacity-20" />
                    <Button
                      type="primary"
                      ghost
                      className="relative !bg-white border-none"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleApplyOpen(item);
                      }}
                    >
                      <SvgIcon name="lock" size={14} className="mr-1" />
                      {t("library.apply_permission_unlock")}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ApplyDialog ref={applyDialogRef} />
      <InfoSaveDialog
        ref={infoSaveDialogRef}
        spaceId={spaceId}
        onSuccess={loadLibraryList}
      />
    </div>
  );
});

List.displayName = "List";

export default List;
