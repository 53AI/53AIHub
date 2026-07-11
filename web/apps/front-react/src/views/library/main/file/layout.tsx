import { useEffect, useState, useMemo } from "react";
import { useParams, useLocation, Outlet } from "react-router-dom";
import { Spin, message } from "antd";
import { useLibraryStore } from "@/stores/modules/library";
import { PermissionFrame } from "@/components/KMPermission/frame";
import { PERMISSION_TYPE, PermissionType } from "@/components/KMPermission/constant";

export function LibraryFileLayout() {
  const { fid } = useParams<{ fid: string }>();
  const location = useLocation();
  const libraryStore = useLibraryStore();
  const [isLoading, setIsLoading] = useState(true);

  const requiredPermission = useMemo<PermissionType>(() => {
    const path = location.pathname;
    if (path.includes("/chunks-edit")) {
      return PERMISSION_TYPE.edit_knowledge;
    }
    if (path.includes("/source-edit")) {
      return PERMISSION_TYPE.edit_knowledge;
    }
    if (path.includes("/chunks")) {
      return PERMISSION_TYPE.edit_all;
    }
    return PERMISSION_TYPE.viewer;
  }, [location.pathname]);

  useEffect(() => {
    const init = async () => {
      if (!fid) return;

      try {
        setIsLoading(true);
        await libraryStore.setCurrentFileId(fid);

        const path = location.pathname;
        if (path.includes("/chunks")) {
          libraryStore.setLibraryType("chunk");
        } else {
          libraryStore.setLibraryType("preview");
        }
      } catch (error) {
        console.error("初始化失败:", error);
        message.error("文件加载失败，请刷新页面重试");
      } finally {
        setIsLoading(false);
      }
    };

    init();

    return () => {
      libraryStore.clearChunks();
      useLibraryStore.setState({ currentFileId: '' });
    };
  }, [fid, location.pathname]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <PermissionFrame required={requiredPermission}>
        <Outlet />
      </PermissionFrame>
    </div>
  );
}

export default LibraryFileLayout;
