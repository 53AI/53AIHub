import { useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { message } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { useLibraryStore } from "@/stores/modules/library";
import { useUserStore } from "@/stores/modules/user";
import { useShortcutsStore } from "@/stores/modules/shortcuts";
import { LibraryHeader } from "@/views/library/components/header";
import { LibraryFav } from "@/views/library/components/fav";
import { MoreDropdown } from "@/components/MoreDropdown";
import LibraryPermission from "@/views/library/components/permission/Library";
import {
  PERMISSION_TYPE,
  RESOURCE_TYPE,
} from "@/components/KMPermission/constant";
import { copyToClip, eventBus } from "@km/shared-utils";
import { checkKMPermission } from "@/utils/km-permission";
import { buildUrl } from "@/utils/router";
import { t } from "@/locales";
import { FileHomeView } from "./file";
import { ChunkHomeView } from "./chunk";

export function LibraryHomeView() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const library = useLibraryStore((state) => state.library);
  const libraryStore = useLibraryStore();
  const userStore = useUserStore();
  const shortcutsStore = useShortcutsStore();

  const libraryId = params.id || "";

  // Check if current library is a shortcut
  const isShortcut = useMemo(() => {
    if (!library?.id) return false;
    return shortcutsStore.isShortcut("library", library.id);
  }, [library?.id, shortcutsStore.shortcuts]);

  // Handle favorite change
  const handleFavoriteChange = useCallback(
    (value: boolean) => {
      useLibraryStore.setState((state) => ({
        library: state.library ? { ...state.library, is_favorite: value } : null
      }));
    },
    [],
  );

  // Handle share
  const handleShare = useCallback(() => {
    const url = buildUrl(
      `/library/${library?.id}?eid=${userStore.info?.eid}`,
    );
    copyToClip(url).then(() => {
      message.success(
        t("common.copied") + t("action.share") + t("common.link"),
      );
    });
  }, [library?.id, userStore.info?.eid]);

  // Handle more menu commands
  const handleMore = useCallback(
    async (command: string) => {
      if (command === "permission") {
        const stats = checkKMPermission(library?.permission, PERMISSION_TYPE.manage);
        if (!stats.hasPermission) {
          eventBus.emit("apply-open", {
            permission: PERMISSION_TYPE.manage,
            resource: { id: library?.id, icon: library?.icon, name: library?.name },
            resourceType: RESOURCE_TYPE.library,
          });
          return;
        }
        navigate(`/library/${library?.id}/setting/permission`);
      } else if (command === "manage") {
        const stats = checkKMPermission(library?.permission, PERMISSION_TYPE.manage);
        if (!stats.hasPermission) {
          eventBus.emit("apply-open", {
            permission: PERMISSION_TYPE.manage,
            resource: { id: library?.id, icon: library?.icon, name: library?.name },
            resourceType: RESOURCE_TYPE.library,
          });
          return;
        }
        navigate(`/library/${library?.id}/setting/info`);
      } else if (command === "add-shortcut") {
        if (!library?.id) return;
        try {
          await shortcutsStore.addShortcut("library", library.id);
        } catch (error) {
          message.error("添加失败，请重试");
        }
      } else if (command === "remove-shortcut") {
        if (!library?.id) return;
        try {
          await shortcutsStore.removeShortcut(
            "library",
            library.id,
          );
        } catch (error) {
          message.error(t("action.remove_failed"));
        }
      }
    },
    [navigate, library, shortcutsStore],
  );

  // Load shortcuts on mount if user is logged in
  useEffect(() => {
    if (userStore.is_login) {
      shortcutsStore.loadShortcuts();
    }
  }, [userStore.is_login]);

  // Dynamic component based on view type
  const Component =
    libraryStore.fileViewType === "chunk" ? ChunkHomeView : FileHomeView;

  // More dropdown items
  const moreItems = useMemo(() => {
    const items = [
      {
        key: isShortcut ? "remove-shortcut" : "add-shortcut",
        label: isShortcut ? t("shortcut.remove") : t("shortcut.add"),
        icon: isShortcut ? "delete-mode" : "add-mode",
      },
      { key: "divider", divided: true },
      {
        key: "permission",
        label: "成员与权限",
        icon: "peoples",
        wrapper: (children: React.ReactNode) => (
          <LibraryPermission required={PERMISSION_TYPE.manage} inline={false}>
            {children}
          </LibraryPermission>
        ),
      },
      {
        key: "manage",
        label: t("action.manage"),
        icon: "setting2",
        wrapper: (children: React.ReactNode) => (
          <LibraryPermission required={PERMISSION_TYPE.manage} inline={false}>
            {children}
          </LibraryPermission>
        ),
      },
    ];

    return items;
  }, [isShortcut]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <LibraryHeader
        className="border-none"
        footer={
          library && (
            <>
              <LibraryFav
                is_favorite={library.is_favorite || false}
                resource_type={RESOURCE_TYPE.library}
                resource_id={library.id}
                onChange={handleFavoriteChange}
              />

              <div
                className="size-8 rounded flex items-center justify-center cursor-pointer hover:bg-[#F0F0F0]"
                title="分享"
                onClick={handleShare}
              >
                <SvgIcon name="share-two" />
              </div>

              <MoreDropdown onCommand={handleMore} items={moreItems} />
            </>
          )
        }
      >
        {/* 文件信息 */}
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="max-w-[30vw] flex-1 overflow-hidden">
            <h3 className="text-base text-[#1D1E1F] truncate">知识库首页</h3>
          </div>
        </div>
      </LibraryHeader>

      <div
        className="flex-1 overflow-y-auto"
        style={{
          backgroundColor:
            libraryStore.fileViewType === "chunk" ? "#F8FAFC" : "",
        }}
      >
        <div className="w-11/12 2xl:w-4/5 mx-auto py-8">
          <Component />
        </div>
      </div>
    </div>
  );
}

export default LibraryHomeView;
