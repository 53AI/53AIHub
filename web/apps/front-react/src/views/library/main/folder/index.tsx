import { useState, useEffect, useMemo, useContext } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Empty, Spin } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { MoreDropdown, type MenuItem } from "@/components/MoreDropdown";
import { useLibraryStore } from "@/stores/modules/library";
import { getPublicPath } from "@/utils/config";
import { LibraryHeader } from "../../components/header";
import PermissionSetting from "../components/permission-setting";
import {
  PERMISSION_TYPE,
  RESOURCE_TYPE,
} from "@/components/KMPermission/constant";
import { PermissionFrame } from "@/components/KMPermission/frame";
import { EntityDisplay } from "@/components/EntityDisplay";
import FilePermission from "../../components/permission/File";
import { canEdit, useInlineEdit } from "../../composables/useInlineEdit";
import { CatalogDropdown } from "../components/catalog/dropdown";
import LibraryFav from "../../components/fav";
import { t } from "@/locales";
import type { FileItem } from "@/api/modules/files/types";
import { CatalogRefContext } from "../index";

export function LibraryFolderView() {
  const { id, fid } = useParams<{ id: string; fid: string }>();
  const navigate = useNavigate();
  const libraryStore = useLibraryStore();
  const catalogRefContext = useContext(CatalogRefContext);

  const [loading, setLoading] = useState(true);
  const [showPermission, setShowPermission] = useState(false);

  const {
    handleClick: handleInlineClick,
    handleBlur: handleInlineBlur,
    handleKeydown: handleInlineKeydown,
    handlePaste: handleInlinePaste,
  } = useInlineEdit();

  const currentFile = libraryStore.currentFile();

  // 获取当前文件夹及其子项
  const folder = useMemo(() => {
    return libraryStore.findNodeInPath(
      currentFile?.path || "",
      libraryStore.treeFiles(),
    );
  }, [currentFile?.path, libraryStore]);
  const fileList = useMemo(() => {
    if (!folder || !folder.children) {
      return [];
    }
    return folder.children.filter((item) => item.isfile);
  }, [folder]);

  const folderList = useMemo(() => {
    if (!folder || !folder.children) {
      return [];
    }
    return folder.children.filter((item) => item.isfolder);
  }, [folder]);

  // Inline editing handlers for header (h3)
  const handleClickHeader = (e: React.MouseEvent<HTMLElement>) => {
    if (!currentFile) return;
    handleInlineClick(e, {
      file: {
        id: currentFile.id,
        name: currentFile.name,
        base_path: currentFile.base_path || "",
        isfile: false,
        file_ext: currentFile.file_ext,
      },
      isFile: false,
      permission: currentFile.permission,
    });
  };

  const handleBlurHeader = (e: React.FocusEvent<HTMLElement>) => {
    if (!currentFile) return;
    handleInlineBlur(e, {
      file: {
        id: currentFile.id,
        name: currentFile.name,
        base_path: currentFile.base_path || "",
        isfile: false,
        file_ext: currentFile.file_ext,
      },
      isFile: false,
      permission: currentFile.permission,
    });
  };

  // Inline editing handlers for content (h4)
  const handleClickContent = (e: React.MouseEvent<HTMLElement>) => {
    if (!currentFile) return;
    handleInlineClick(e, {
      file: {
        id: currentFile.id,
        name: currentFile.name,
        base_path: currentFile.base_path || "",
        isfile: false,
        file_ext: currentFile.file_ext,
      },
      isFile: false,
      permission: currentFile.permission,
    });
  };

  const handleBlurContent = (e: React.FocusEvent<HTMLElement>) => {
    if (!currentFile) return;
    handleInlineBlur(e, {
      file: {
        id: currentFile.id,
        name: currentFile.name,
        base_path: currentFile.base_path || "",
        isfile: false,
        file_ext: currentFile.file_ext,
      },
      isFile: false,
      permission: currentFile.permission,
    });
  };

  const handleView = (item: FileItem) => {
    catalogRefContext?.current?.router(item);
  };

  const handleMore = (command: string, item: FileItem) => {
    switch (command) {
      case "new-tab":
        catalogRefContext?.current?.newTab(item);
        break;
      case "rename":
        catalogRefContext?.current?.renameFile(item);
        break;
      case "delete":
        catalogRefContext?.current?.deleteFile(item);
        break;
      case "permission":
        setShowPermission(true);
        break;
    }
  };

  const handleCommand = (command: string) => {
    catalogRefContext?.current?.command(command, currentFile as FileItem);
  };

  const onFavorite = (value: boolean) => {
    if (currentFile) {
      libraryStore.updateFile({
        id: currentFile.id,
        is_favorite: value,
      });
    }
  };

  // 获取更多菜单项（当前文件夹），按权限收起重命名/权限/删除
  const getCurrentFileMoreMenuItems = (): MenuItem[] => [
    {
      key: "new-tab",
      icon: "arrow-right-up",
      label: t("action.tab_open"),
    },
    {
      key: "rename",
      icon: "edit",
      label: t("action.rename"),
      wrapper: (children) => (
        <FilePermission required={PERMISSION_TYPE.edit_all}>
          {children}
        </FilePermission>
      ),
    },
    {
      key: "permission",
      icon: "peoples",
      label: "成员与权限",
      wrapper: (children) => (
        <FilePermission required={PERMISSION_TYPE.manage}>
          {children}
        </FilePermission>
      ),
    },
    {
      key: "delete",
      icon: "del",
      iconClass: "text-[#FA5151]",
      label: t("action.del"),
      danger: true,
      wrapper: (children) => (
        <FilePermission required={PERMISSION_TYPE.edit_all}>
          {children}
        </FilePermission>
      ),
    },
  ];

  // 获取子项的更多菜单，重命名/删除按子项自身权限收起
  const getChildMoreMenuItems = (item: FileItem): MenuItem[] => [
    {
      key: "new-tab",
      icon: "arrow-right-up",
      label: t("action.tab_open"),
    },
    { key: "divider", divided: true },
    {
      key: "rename",
      icon: "edit",
      label: t("action.rename"),
      wrapper: (children) => (
        <FilePermission
          permission={item.permission}
          required={PERMISSION_TYPE.edit_all}
        >
          {children}
        </FilePermission>
      ),
    },
    {
      key: "delete",
      icon: "del",
      iconClass: "text-[#FA5151]",
      label: t("action.del"),
      danger: true,
      wrapper: (children) => (
        <FilePermission
          permission={item.permission}
          required={PERMISSION_TYPE.edit_all}
        >
          {children}
        </FilePermission>
      ),
    },
  ];

  const handleCurrentFileMoreClick = (key: string) => {
    if (currentFile) {
      handleMore(key, currentFile);
    }
  };

  useEffect(() => {
    const loadFolder = async () => {
      if (!id || !fid) return;

      setLoading(true);
      libraryStore.setLibraryId(id);
      await libraryStore.setCurrentFileId(fid);
      setLoading(false);
    };

    loadFolder();
  }, [id, fid]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <PermissionFrame>
      <div className="flex-1 flex flex-col overflow-hidden">
        <LibraryHeader
          footer={
            !loading && currentFile ? (
              <div className="flex items-center gap-2">
                {currentFile && (
                  <LibraryFav
                    is_favorite={currentFile.is_favorite || false}
                    resource_type={RESOURCE_TYPE.file}
                    resource_id={String(currentFile.id)}
                    onChange={onFavorite}
                  />
                )}

                <MoreDropdown
                  placement="bottomRight"
                  trigger={["click"]}
                  items={getCurrentFileMoreMenuItems()}
                  onCommand={(key) => handleCurrentFileMoreClick(String(key))}
                />
              </div>
            ) : null
          }
        >
          {currentFile && (
            <div className="flex-1 overflow-hidden">
              <h3
                className={`text-base text-[#1D1E1F] truncate ${canEdit(currentFile.permission) ? "inline-editable" : ""}`}
                onClick={handleClickHeader}
                onBlur={handleBlurHeader}
                onKeyDown={handleInlineKeydown}
                onPaste={handleInlinePaste}
                title={currentFile.name}
              >
                {currentFile.name}
              </h3>
              <p className="text-xs text-[#9A9A9A]">
                {t("common.recently_edit")}：{currentFile.updated_at}
              </p>
            </div>
          )}
        </LibraryHeader>

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <div className="w-4/5 mx-auto py-9">
              <div className="flex items-center gap-4">
                <img
                  className="size-12"
                  src={getPublicPath("/images/file/folder.png")}
                  alt="folder"
                />
                <div className="flex-1 overflow-hidden">
                  <h4
                    className={`text-lg font-medium text-[#1D1E1F] truncate ${canEdit(currentFile?.permission || 0) ? "inline-editable" : ""}`}
                    onClick={handleClickContent}
                    onBlur={handleBlurContent}
                    onKeyDown={handleInlineKeydown}
                    onPaste={handleInlinePaste}
                    title={currentFile?.name}
                  >
                    {currentFile?.name}
                  </h4>
                  <p className="text-sm text-[#9A9A9A]">
                    {t("library.number", {
                      document_num: fileList.length,
                      folder_num: folderList.length,
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <FilePermission
                    permission={currentFile?.permission}
                    required={PERMISSION_TYPE.edit_knowledge}
                  >
                    <CatalogDropdown filter="create" onCommand={handleCommand}>
                      <Button
                        color="primary"
                        variant="filled"
                        className="!border-none"
                      >
                        <SvgIcon name="plus" className="mr-1" /> 新建
                      </Button>
                    </CatalogDropdown>
                  </FilePermission>
                  <FilePermission
                    permission={currentFile?.permission}
                    required={PERMISSION_TYPE.edit_knowledge}
                  >
                    <CatalogDropdown filter="upload" onCommand={handleCommand}>
                      <Button
                        color="primary"
                        variant="filled"
                        className="!border-none"
                      >
                        <SvgIcon name="download" className="mr-1" /> 导入
                      </Button>
                    </CatalogDropdown>
                  </FilePermission>
                </div>
              </div>

              {loading ? null : folder &&
                folder.children &&
                folder.children.length > 0 ? (
                <>
                  <div className="flex items-center gap-2 h-9 mt-9 text-sm text-[#4F5052]">
                    <div className="flex-1">{t("form.name")}</div>
                    <div className="w-20 text-center text-[#9A9A9A]">
                      {t("form.creator")}
                    </div>
                    <div className="w-1/5 text-right text-[#9A9A9A]">
                      {t("common.updated_time")}
                    </div>
                  </div>
                  <div className="flex flex-col gap-0.5 mt-0.5">
                    {folder.children.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-2 h-11 px-1.5 rounded-lg cursor-pointer group hover:bg-[#eeeff0]"
                        onClick={() => handleView(item)}
                      >
                        <div className="flex-1 flex items-center gap-2 overflow-hidden">
                          <img className="size-6" src={item.icon} alt="" />
                          <span className="flex-1 text-sm text-[#1D1E1F] truncate">
                            {item.name}
                          </span>
                          <MoreDropdown
                            trigger={["click"]}
                            triggerElement={
                              <div
                                className="size-6 rounded bg-[#f5f5f5] flex items-center justify-center cursor-pointer invisible group-hover:visible"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <SvgIcon name="more-h" />
                              </div>
                            }
                            items={getChildMoreMenuItems(item)}
                            onCommand={(key) => handleMore(String(key), item)}
                          />
                        </div>
                        <div className="w-20 text-center text-sm text-[#9A9A9A]">
                          <EntityDisplay type="user" id={item.user_id} mode="name" />
                        </div>
                        <div className="w-1/5 text-right text-sm text-[#9A9A9A]">
                          {item.updated_at}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <Empty
                  description={t("status.no_file")}
                  className="mt-[100px]"
                />
              )}
            </div>
          </div>

          {showPermission && (
            <PermissionSetting
              className="w-[320px] flex-none border-l"
              onClose={() => setShowPermission(false)}
            />
          )}
        </div>
      </div>
    </PermissionFrame>
  );
}

export default LibraryFolderView;
