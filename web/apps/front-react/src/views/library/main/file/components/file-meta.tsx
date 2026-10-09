import { EntityDisplay } from "@/components/EntityDisplay";
import type { FileItem } from "@/api/modules/files/types";
import { t } from "@/locales";

/**
 * 文件头部元信息行：创建人 | 创建时间 | 最近编辑
 * created_at / updated_at 都由 formatFile 统一格式化为 YYYY-MM-DD hh:mm，直接渲染即可
 */
export function FileMetaLine({ file }: { file: FileItem }) {
  return (
    <p className="text-xs text-[#9A9A9A] flex items-center whitespace-nowrap">
      {t("form.creator")}：
      <EntityDisplay type="user" id={file.user_id ?? 0} mode="name" />
      <span className="text-[#D9D9D9] mx-1">|</span>
      {t("common.create_time")}：{file.created_at}
      <span className="text-[#D9D9D9] mx-1">|</span>
      {t("common.recently_edit")}：{file.updated_at}
    </p>
  );
}
