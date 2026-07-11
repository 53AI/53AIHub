import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Spin, Empty, message } from "antd";
import ChunkView from "@/components/Markdown/ChunkView";
import { fileBodiesApi } from "@/api/modules/file-bodies";
import { copyToClip, getSimpleDateFormatString } from "@km/shared-utils";
import { getPublicPath } from "@/utils/config";
import { t } from "@/locales";
import { MoreDropdown } from "@/components/MoreDropdown";

export function LibraryShareView() {
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();

  const [file, setFile] = useState({
    name: "",
    updated_at: "",
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [type] = useState("source");
  const [currentFileBody, setCurrentFileBody] = useState("");

  const [viewMode, setViewMode] = useState<"web" | "pdf">("web");

  const handleMore = (command: string) => {
    if (command === "share") {
      copyToClip(window.location.href).then(() => {
        message.success(t("status.copy_link"));
      });
    }
  };

  useEffect(() => {
    const id = params.id;
    const name = searchParams.get("name") || "";
    setFile((prev) => ({
      ...prev,
      name: decodeURIComponent(name),
    }));

    if (id) {
      setLoading(true);
      setError(false);
      fileBodiesApi
        .find(id)
        .then((res) => {
          setCurrentFileBody(res.content);
          setFile((prev) => ({
            ...prev,
            updated_at: getSimpleDateFormatString({
              date: res.updated_time,
              format: "YYYY-MM-DD hh:mm:ss",
            }),
          }));
        })
        .catch(() => {
          setError(true);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [params.id, searchParams]);

  return (
    <div
      className={`h-full flex flex-col overflow-hidden ${type === "edit" ? "fixed inset-0 z-10" : ""}`}
    >
      <div className="flex-none h-17 px-5 flex items-center gap-3 bg-[#FAFAFA]">
        <div className="flex items-center gap-2">
          {/* 动态显示文件类型图标 */}
          <img
            className="size-5"
            src={getPublicPath("/images/file/md.png")}
            alt=""
          />
          {file && (
            <div className="flex-1">
              <h3 className="text-base text-[#1D1E1F]">{file.name}</h3>
              <p className="text-xs text-[#9A9A9A]">
                {t("common.recently_edit")}：{file.updated_at}
              </p>
            </div>
          )}
        </div>

        <div className="flex-1" />
        {type === "source" && !loading && (
          <div className="flex-center gap-2">
            <MoreDropdown
              size="32px"
              icon="more-h"
              tooltip={t("action.more")}
              backgroundColor="#F2F6FE"
              items={[
                {
                  key: "share",
                  icon: "share",
                  label: t("action.share"),
                },
              ]}
              onCommand={handleMore}
            />
          </div>
        )}
      </div>
      {loading && (
        <div className="h-[calc(100vh-17px)] flex-center">
          <Spin />
        </div>
      )}
      {error && !loading && (
        <div className="h-[calc(100vh-17px)] flex-center flex-col">
          <Empty description={t("status.load_fail")} />
        </div>
      )}

      {!loading && !error && (
        <ChunkView content={currentFileBody} mode={viewMode} />
      )}

      <div className="flex-none h-10 px-4 py-2 flex items-center justify-between gap-1.5 bg-[#F5F5F5] border-t">
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <div
            className={`h-6 rounded flex-center gap-2 px-2.5 cursor-pointer ${viewMode === "pdf" ? "text-[#2563EB] bg-[#E5EAF5] shadow" : "text-[#4F5052]"}`}
            onClick={() => setViewMode("pdf")}
          >
            <span className="text-sm">{t("library.document")}</span>
          </div>
          <div
            className={`h-6 rounded flex-center gap-2 px-2.5 cursor-pointer ${viewMode === "web" ? "text-[#2563EB] bg-[#E5EAF5] shadow" : "text-[#4F5052]"}`}
            onClick={() => setViewMode("web")}
          >
            <span className="text-sm">Web</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LibraryShareView;
