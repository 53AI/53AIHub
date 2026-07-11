import { useState, useEffect, useCallback, useRef } from "react";
import { Button, message } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { PERMISSION_TYPE } from "@/components/KMPermission/constant";
import { useFileMode } from "@/hooks/useFileMode";
import filesApi from "@/api/modules/files";
import type { FileItem } from "@/api/modules/files/types";
import PermissionFile from "../../../components/permission/File";
import { t } from "@/locales";
import { debounce } from "@/utils";

interface EditBtnProps {
  file: FileItem;
  isSourceEdit?: boolean;
  link?: boolean;
  children?: React.ReactNode;
  onEdit?: () => void;
}

export function EditBtn({
  file,
  isSourceEdit = false,
  link = false,
  children,
  onEdit,
}: EditBtnProps) {
  const [showEditBtn, setShowEditBtn] = useState(false);
  const [editMessage, setEditMessage] = useState("");
  const [showEditMessage, setShowEditMessage] = useState(false);

  const { getFileExt, getFileSetting } = useFileMode();
  const lockTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showEditMessageWithTimer = useCallback((msg: string) => {
    setEditMessage(msg);
    setShowEditMessage(true);
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
    }
    lockTimerRef.current = setTimeout(() => {
      lockTimerRef.current = null;
      setShowEditMessage(false);
    }, 3000);
  }, []);

  const handleEdit = () => {
    return filesApi
      .lock(file.id || "", { action: "add" })
      .then((res) => {
        if (res.success) {
          onEdit?.();
        } else {
          showEditMessageWithTimer(res.message);
        }
      })
      .catch((err) => {
        showEditMessageWithTimer(
          err?.response?.data?.data?.message || "添加文件锁失败",
        );
      });
  };

  const debouncedHandleEdit = useCallback(debounce(handleEdit, 300), [
    file.id,
    onEdit,
  ]);

  useEffect(() => {
    const init = async () => {
      if (!isSourceEdit) {
        setShowEditBtn(true);
        return;
      }
      const ext = await getFileExt(file.file_mime);
      getFileSetting(file.library_id).then((res) => {
        if (ext === "mp3" || ext === "mp4") {
          setShowEditBtn(false);
        } else if (ext === "md") {
          setShowEditBtn(true);
        } else {
          const way = res.editor?.[ext] || "default";
          setShowEditBtn(way !== "default");
        }
      });
    };
    init();

    return () => {
      if (lockTimerRef.current) {
        clearTimeout(lockTimerRef.current);
      }
    };
  }, [file, isSourceEdit, getFileExt, getFileSetting]);

  if (!showEditBtn) {
    return null;
  }

  return (
    <PermissionFile required={PERMISSION_TYPE.edit_knowledge}>
      <div className="inline-flex relative">
        <div className="inline-flex items-center" onClick={debouncedHandleEdit}>
          {children || (
            <Button type={link ? "link" : "primary"}>{t("action.edit")}</Button>
          )}
        </div>
        {showEditMessage && (
          <div className="h-full px-2 flex items-center absolute top-10 right-0 z-10 bg-white rounded-md border shadow-lg">
            <SvgIcon name="warning" className="mr-1 text-[#F0A105]" />
            <span className="flex-1 truncate text-sm text-[#1D1E1F] whitespace-nowrap">
              {editMessage}
            </span>
          </div>
        )}
      </div>
    </PermissionFile>
  );
}

export default EditBtn;
