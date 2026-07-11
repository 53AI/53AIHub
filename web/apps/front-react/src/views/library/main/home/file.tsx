import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { Empty } from "antd";
import { useLibraryStore } from "@/stores/modules/library";
import { filesApi } from "@/api/modules/files";
import { formatFile } from "@/api/modules/files/transform";
import { EntityDisplay } from "@/components/EntityDisplay";
import VirtualLogo from "@/components/VirtualLogo";
import { getPublicPath } from "@/utils/config";
import { t } from "@/locales";

interface FormattedFile {
  id: string | number;
  name: string;
  icon: string;
  library_id: string;
  user_id: string;
  updated_at: string;
}

export function FileHomeView() {
  const params = useParams<{ id: string }>();
  const libraryStore = useLibraryStore();
  const fileRefreshKey = useLibraryStore((state) => state.fileRefreshKey);

  const [loading, setLoading] = useState(true);
  const [recentlyFiles, setRecentlyFiles] = useState<FormattedFile[]>([]);

  const libraryId = params.id;

  // Filter files that still exist in the library
  const showFiles = useMemo(() => {
    return recentlyFiles
      .filter((item) => libraryStore.files.find((file) => file.id === item.id))
      .slice(0, 10)
      .map(formatFile);
  }, [recentlyFiles, libraryStore.files]);

  // Load recently updated files
  const loadRecentlyFiles = async () => {
    if (!libraryId) return;

    try {
      const res = await filesApi.recentlyUpdated({ library_id: libraryId });
      setRecentlyFiles(res);
    } catch (error) {
      console.error("Failed to load recently files:", error);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadRecentlyFiles().finally(() => setLoading(false));
  }, [libraryId, fileRefreshKey]);

  return (
    <>
      {/* Library Info */}
      <div className="flex items-start gap-5">
        <div className="flex-shrink-0">
          <VirtualLogo
            text={libraryStore.library?.name || ""}
            src={libraryStore.library?.icon || ""}
            size={80}
          />
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="text-2xl text-[#1D1E1F] font-medium truncate mt-1">
            {libraryStore.library?.name}
          </div>
          <div className="text-sm text-[#939499] mt-1 mb-3 break-words whitespace-normal line-clamp-2">
            {libraryStore.library?.description}
          </div>
        </div>
      </div>

      {/* Recently Updated Header */}
      <div className="flex items-center justify-between mt-10">
        <h4 className="text-base text-[#1D1E1F]">最近更新</h4>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 mt-4">
        {/* Table Header */}
        <div className="h-12 flex items-center gap-2 px-4 border-b border-gray-100">
          <div className="flex-1 text-sm text-[#4F5052] font-medium">
            {t("common.title")}
          </div>
          <div className="flex-1 text-sm text-[#4F5052] font-medium">
            所有者
          </div>
          <div className="flex-1 text-sm text-[#4F5052] font-medium text-right">
            {t("common.update_time")}
          </div>
        </div>

        {/* Table Content */}
        <div className="flex flex-col gap-1">
          {showFiles.map((item) => (
            <Link
              key={item.id}
              to={`/library/${item.library_id}/file/${item.id}`}
              className="h-12 flex items-center gap-2 px-4 cursor-pointer hover:bg-[#EEEFF0]"
            >
              {/* Title Column */}
              <div className="flex-1 flex items-center gap-2 overflow-hidden">
                <img className="flex-none size-6" src={item.icon} alt="" />
                <p className="flex-1 text-sm text-[#1D1E1F] truncate">
                  {item.name}
                </p>
              </div>

              {/* Owner Column */}
              <div className="flex-1 text-sm text-[#1D1E1F] truncate">
                <EntityDisplay type="user" id={item.user_id} mode="name" />
              </div>

              {/* Update Time Column */}
              <div className="flex-1 text-sm text-[#9A9A9A] text-right">
                {item.updated_at}
              </div>
            </Link>
          ))}
        </div>

        {/* Empty State */}
        {!loading && showFiles.length === 0 && (
          <div className="py-6 flex-center">
            <Empty
              image={getPublicPath("/images/empty.png")}
              styles={{ image: { height: 100 } }}
            />
          </div>
        )}
      </div>
    </>
  );
}

export default FileHomeView;
