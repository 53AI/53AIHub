import { useState } from "react";
import { Tooltip, message } from "antd";
import { Dropdown } from "@km/shared-components-react";
import {
  CopyOutlined,
  ReloadOutlined,
  DownOutlined,
  UpOutlined,
  FileAddOutlined,
  ShareAltOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { copyToClip } from "@km/shared-utils";
import { t } from "@/locales";

interface MessageMenuProps {
  type: "user" | "assistant";
  content: string;
  feedbackType?: "satisfied" | "unsatisfied" | "";
  showShare?: boolean;
  showAddMd?: boolean;
  showFeedback?: boolean;
  onRegenerate?: () => void;
  onShare?: () => void;
  onFeedback?: (type: "satisfied" | "unsatisfied") => void;
  onAddAsMd?: () => void;
}

export function MessageMenu({
  type,
  content,
  feedbackType = "",
  showShare = false,
  showAddMd = true,
  showFeedback = true,
  onRegenerate,
  onShare,
  onFeedback,
  onAddAsMd,
}: MessageMenuProps) {
  const [showCopyMenu, setShowCopyMenu] = useState(false);

  const handleCopy = async (text: string) => {
    const success = await copyToClip(text);
    if (success) {
      message.success(t("action.copy_success") || "已复制");
    }
  };

  const copyMenuItems: MenuProps["items"] = [
    {
      key: "markdown",
      label: t("action.copy_markdown"),
      onClick: () => {
        handleCopy(content);
        setShowCopyMenu(false);
      },
    },
    {
      key: "text",
      label: t("action.copy_text"),
      onClick: () => {
        const plainText = content.replace(/[#*`_\[\]]/g, "");
        handleCopy(plainText);
        setShowCopyMenu(false);
      },
    },
  ];

  // User message menu
  if (type === "user") {
    return (
      <div
        className="h-6 px-1 rounded flex items-center justify-center cursor-pointer hover:bg-[#E1E2E3]"
        onClick={() => handleCopy(content)}
      >
        <Tooltip title={t("action.copy")}>
          <CopyOutlined style={{ color: "#9B9B9B", fontSize: 14 }} />
        </Tooltip>
      </div>
    );
  }

  // Assistant message menu
  return (
    <>
      {showAddMd && (
        <div
          className="h-6 px-1 rounded flex items-center justify-center gap-1 cursor-pointer hover:bg-[#E1E2E3] text-[#9B9B9B]"
          onClick={onAddAsMd}
        >
          <FileAddOutlined style={{ color: "#9B9B9B", fontSize: 14 }} />
          <span className="text-sm text-[#939499]">
            {t("action.add_as_file")}
          </span>
        </div>
      )}
      <Dropdown
        open={showCopyMenu}
        menu={{ items: copyMenuItems }}
        trigger={["click"]}
        placement="bottomLeft"
        onOpenChange={setShowCopyMenu}
      >
        <div className="h-6 px-1 rounded flex items-center justify-center cursor-pointer hover:bg-[#E1E2E3]">
          <Tooltip title={t("action.copy")}>
            <CopyOutlined style={{ color: "#9B9B9B", fontSize: 14 }} />
          </Tooltip>
          {showCopyMenu ? (
            <UpOutlined style={{ color: "#808080", fontSize: 12 }} />
          ) : (
            <DownOutlined style={{ color: "#808080", fontSize: 12 }} />
          )}
        </div>
      </Dropdown>
      <div
        className="h-6 px-1 rounded flex items-center justify-center cursor-pointer hover:bg-[#E1E2E3]"
        onClick={onRegenerate}
      >
        <Tooltip title={t("chat.regenerate")}>
          <ReloadOutlined style={{ color: "#9B9B9B", fontSize: 14 }} />
        </Tooltip>
      </div>
      {showShare && (
        <div
          className="h-6 px-1 rounded flex items-center justify-center gap-1 cursor-pointer hover:bg-[#E1E2E3] text-[#9B9B9B]"
          onClick={onShare}
        >
          <ShareAltOutlined style={{ color: "#9B9B9B" }} />
          <span className="text-sm text-[#939499]">{t("action.share")}</span>
        </div>
      )}
      {showFeedback && (
        <>
          <div
            className="h-6 px-1 rounded flex items-center justify-center cursor-pointer hover:bg-[#E1E2E3]"
            onClick={() => onFeedback?.("satisfied")}
          >
            <Tooltip title={t("chat.satisfied")}>
              <SvgIcon
                size={feedbackType === "satisfied" ? 16 : 18}
                name={feedbackType === "satisfied" ? "like-selected" : "like"}
                color="#9B9B9B"
              />
            </Tooltip>
          </div>
          <div
            className="h-6 px-1 rounded flex items-center justify-center cursor-pointer hover:bg-[#E1E2E3]"
            onClick={() => onFeedback?.("unsatisfied")}
          >
            <Tooltip title={t("chat.unsatisfied")}>
              <SvgIcon
                size={feedbackType === "unsatisfied" ? 16 : 18}
                name={
                  feedbackType === "unsatisfied"
                    ? "dislike-selected"
                    : "dislike"
                }
                color="#9B9B9B"
              />
            </Tooltip>
          </div>
        </>
      )}
    </>
  );
}

export default MessageMenu;
