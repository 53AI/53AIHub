import { useState, forwardRef, useImperativeHandle, useCallback } from "react";
import { Popover, Empty, Modal, message } from "antd";
import { useNavigate } from "react-router-dom";
import { SvgIcon } from "@km/shared-components-react";
import { useLibraryStore, formatLibrary } from "@/stores/modules/library";
import librariesApi from "@/api/modules/libraries";
import { t } from "@/locales";
import { getPublicPath } from "@/utils/config";

interface LibraryItem {
  id: string;
  name: string;
  icon: string;
}

export interface LibrarySelectorRef {
  hide: () => void;
}

export const LibrarySelector = forwardRef<
  LibrarySelectorRef,
  {
    trigger?: React.ReactNode;
    reference?: React.ReactNode;
  }
>(({ trigger, reference }, ref) => {
  const navigate = useNavigate();
  const libraryStore = useLibraryStore();
  const [visible, setVisible] = useState(false);
  const [recentlyLibrary, setRecentlyLibrary] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadRecentlyLibrary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await librariesApi.recently();
      const formatted = res
        .slice(0, 4)
        .map(formatLibrary)
        .filter((item: any) => item.id !== libraryStore.library?.id);
      setRecentlyLibrary(formatted);
    } finally {
      setLoading(false);
    }
  }, [libraryStore.library?.id]);

  const handleShow = useCallback(() => {
    loadRecentlyLibrary();
  }, [loadRecentlyLibrary]);

  const handleHide = useCallback(() => {
    setLoading(true);
  }, []);

  const handleBeforeJump = useCallback(
    (to: any) => {
      // 如果有正在上传的文件，弹出确认弹窗
      if (libraryStore.uploadingUploads().length > 0) {
        Modal.confirm({
          title: t("el.messagebox.title"),
          content: t("el.messagebox.uploadingTip"),
          okText: t("el.messagebox.confirmLeave"),
          cancelText: t("el.messagebox.cancel"),
          onOk: () => {
            libraryStore.uploadQueue.forEach((item: any) => {
              if (item.abortController) {
                item.abortController.abort();
              }
            });
            navigate(to);
            setVisible(false);
          },
        });
      } else {
        navigate(to);
        setVisible(false);
      }
    },
    [libraryStore, navigate, t],
  );

  const handleNavigate = useCallback(
    (to: any) => {
      handleBeforeJump(to);
    },
    [handleBeforeJump],
  );

  useImperativeHandle(ref, () => ({
    hide: () => setVisible(false),
  }));

  const content = (
    <div className="min-w-[200px]" style={{ padding: "0" }}>
      {libraryStore.space && (
        <div
          className="h-9 px-3 flex items-center gap-2 cursor-pointer hover:bg-[#EEEFF0] rounded"
          onClick={() => handleNavigate(`/knowledge/${libraryStore.space?.id}`)}
        >
          <SvgIcon name="arrow-right-up" size={16} />
          <p className="flex-1 text-sm text-[#1D1E1F] truncate">
            返回"{libraryStore.space?.name}"
          </p>
        </div>
      )}
      <div className="border-b my-2.5" />
      <div className="flex flex-col gap-1 px-1">
        <div
          className="h-9 flex items-center gap-2 pl-2 rounded cursor-pointer hover:bg-[#EEEFF0]"
          onClick={() => handleNavigate("/")}
        >
          <div className="size-5 flex items-center justify-center text-[#979799]">
            <SvgIcon name="folder-minus-fill" size={20} />
          </div>
          <p className="flex-1 text-sm text-[#1D1E1F]">{t("module.index")}</p>
        </div>
        <div
          className="h-10 flex items-center gap-2 pl-2 rounded cursor-pointer hover:bg-[#EEEFF0]"
          onClick={() => handleNavigate("/mine")}
        >
          <div className="size-5 flex items-center justify-center text-[#979799]">
            <SvgIcon name="member" size={18} />
          </div>
          <p className="flex-1 text-sm text-[#1D1E1F]">{t("module.mine")}</p>
        </div>
      </div>
      <div className="border-b my-2.5" />
      <div className="h-9 px-3 flex items-center">
        <p className="text-xs text-[#9A9A9A]">最近知识库</p>
      </div>
      <div className="flex flex-col gap-1">
        {recentlyLibrary.map((item) => (
          <div
            key={item.id}
            className="h-9 px-3 flex items-center gap-2 cursor-pointer hover:bg-[#EEEFF0] rounded"
            onClick={() => handleNavigate(`/library/${item.id}`)}
          >
            <div className="size-5">
              <img
                src={item.icon || getPublicPath("/images/library.png")}
                className="size-5 rounded"
                alt=""
              />
            </div>
            <p className="flex-1 text-sm text-[#1D1E1F] truncate">
              {item.name}
            </p>
          </div>
        ))}
        {!loading && recentlyLibrary.length === 0 && (
          <Empty
            description={t("common.no_data")}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ margin: "0 auto" }}
          />
        )}
      </div>
    </div>
  );

  return (
    <Popover
      open={visible}
      content={content}
      trigger="hover"
      placement="bottomLeft"
      styles={{ root: { width: 240 } }}
      getPopupContainer={() => document.body}
      onOpenChange={(v) => {
        setVisible(v);
        if (v) handleShow();
        else handleHide();
      }}
    >
      {reference || trigger}
    </Popover>
  );
});

LibrarySelector.displayName = "LibrarySelector";

export default LibrarySelector;
