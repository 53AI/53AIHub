import { memo } from "react";
import { Checkbox } from "antd";
import { CloseOutlined, LinkOutlined } from "@ant-design/icons";
import { useTranslation } from "../../i18n";

export interface ShareHeaderProps {
  /** 选中的消息数量 */
  selectedCount: number;
  /** 是否全选 */
  selectAll: boolean;
  /** 全选回调 */
  onSelectAll: () => void;
  /** 创建分享回调 */
  onCreateShare: () => Promise<void>;
  /** 取消分享回调 */
  onCancel: () => void;
}

function ShareHeaderInner({
  selectedCount,
  selectAll,
  onSelectAll,
  onCreateShare,
  onCancel,
}: ShareHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="flex-none sticky top-0 z-10 bg-white border-b">
      <div className="h-[70px] px-4 flex items-center justify-between">
        <Checkbox checked={selectAll} onChange={onSelectAll}>
          {selectAll ? (t("action.unselect_all") || "取消全选") : (t("action.select_all") || "全选")}
        </Checkbox>
        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <div
              className="h-8 flex items-center gap-1 px-2 rounded-md bg-[#F5F5F7] cursor-pointer hover:bg-[#E1E2E3] text-[#2563EB]"
              onClick={onCreateShare}
            >
              <LinkOutlined style={{ fontSize: 16 }} />
              <span className="text-sm">{t("action.copy_link") || "复制链接"}</span>
            </div>
          )}
          <div
            className="size-8 flex items-center justify-center rounded-md bg-[#F5F5F7] cursor-pointer hover:bg-[#E1E2E3]"
            onClick={onCancel}
          >
            <CloseOutlined />
          </div>
        </div>
      </div>
    </header>
  );
}

const ShareHeader = memo(ShareHeaderInner);
ShareHeader.displayName = "ShareHeader";

export default ShareHeader;