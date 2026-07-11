import { useState } from "react";
import { Tooltip, message, Dropdown } from "antd";
import {
  CopyOutlined,
  ReloadOutlined,
  DownOutlined,
  UpOutlined,
  FileAddOutlined,
  ShareAltOutlined,
} from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import { copyToClip } from "@km/shared-utils";
import type { MenuProps } from "antd";
import { useTranslation } from "../i18n";

export interface MessageMenuFeatures {
  /** 复制功能 - 默认 true */
  copy?: boolean;
  /** 重新生成功能 - 默认 true */
  regenerate?: boolean;
  /** 分享功能 - 默认 false */
  share?: boolean;
  /** 反馈功能 - 默认 false */
  feedback?: boolean;
  /** 添加为文件功能 - 默认 false */
  addAsFile?: boolean;
}

export interface MessageMenuProps {
  /** 消息类型 */
  type: "user" | "assistant";
  /** 消息内容 */
  content: string;
  /** 功能开关 */
  features?: MessageMenuFeatures;
  /** 反馈类型 */
  feedbackType?: "satisfied" | "unsatisfied" | "";
  /** 重新生成回调 */
  onRegenerate?: () => void;
  /** 分享回调 */
  onShare?: () => void;
  /** 反馈回调 */
  onFeedback?: (type: "satisfied" | "unsatisfied") => void;
  /** 添加为文件回调 */
  onAddAsFile?: () => void;
}

const DEFAULT_FEATURES: MessageMenuFeatures = {
  copy: true,
  regenerate: true,
  share: false,
  feedback: false,
  addAsFile: false,
};

export function MessageMenu({
  type,
  content,
  features: userFeatures,
  feedbackType = "",
  onRegenerate,
  onShare,
  onFeedback,
  onAddAsFile,
}: MessageMenuProps) {
  const { t } = useTranslation();
  const features = { ...DEFAULT_FEATURES, ...userFeatures };
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

  // User message menu - only copy
  if (type === "user") {
    if (!features.copy) return null;

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
    <div className="flex items-center gap-1">
      {/* Add as file */}
      {features.addAsFile && onAddAsFile && (
        <div
          className="h-6 px-1 rounded flex items-center justify-center gap-1 cursor-pointer hover:bg-[#E1E2E3] text-[#9B9B9B]"
          onClick={onAddAsFile}
        >
          <FileAddOutlined style={{ color: "#9B9B9B", fontSize: 14 }} />
          <span className="text-sm text-[#939499]">
            {t("action.add_as_file")}
          </span>
        </div>
      )}

      {/* Copy with dropdown */}
      {features.copy && (
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
      )}

      {/* Regenerate */}
      {features.regenerate && onRegenerate && (
        <div
          className="h-6 px-1 rounded flex items-center justify-center cursor-pointer hover:bg-[#E1E2E3]"
          onClick={onRegenerate}
        >
          <Tooltip title={t("chat.regenerate")}>
            <ReloadOutlined style={{ color: "#9B9B9B", fontSize: 14 }} />
          </Tooltip>
        </div>
      )}

      {/* Share */}
      {features.share && onShare && (
        <div
          className="h-6 px-1 rounded flex items-center justify-center gap-1 cursor-pointer hover:bg-[#E1E2E3] text-[#9B9B9B]"
          onClick={onShare}
        >
          <ShareAltOutlined style={{ color: "#9B9B9B", fontSize: 14 }} />
          <span className="text-sm text-[#939499]">{t("action.share")}</span>
        </div>
      )}

      {/* Feedback - Satisfied */}
      {features.feedback && onFeedback && (
        <div
          className="h-6 px-1 rounded flex items-center justify-center cursor-pointer hover:bg-[#E1E2E3]"
          onClick={() => onFeedback("satisfied")}
        >
          <Tooltip title={t("chat.satisfied")}>
            <SvgIcon
              size={feedbackType === "satisfied" ? 16 : 18}
              name={feedbackType === "satisfied" ? "like-selected" : "like"}
              color="#9B9B9B"
            />
          </Tooltip>
        </div>
      )}

      {/* Feedback - Unsatisfied */}
      {features.feedback && onFeedback && (
        <div
          className="h-6 px-1 rounded flex items-center justify-center cursor-pointer hover:bg-[#E1E2E3]"
          onClick={() => onFeedback("unsatisfied")}
        >
          <Tooltip title={t("chat.unsatisfied")}>
            <SvgIcon
              size={feedbackType === "unsatisfied" ? 16 : 18}
              name={feedbackType === "unsatisfied" ? "dislike-selected" : "dislike"}
              color="#9B9B9B"
            />
          </Tooltip>
        </div>
      )}
    </div>
  );
}

export default MessageMenu;
