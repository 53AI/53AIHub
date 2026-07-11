import { memo } from "react";
import { CloseOutlined } from "@ant-design/icons";
import { Dropdown, Tooltip } from "antd";
import type { MenuProps } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { useTranslation, type Lang } from "../../i18n";
import type { IAgentInfo } from "../../adapters/types";

export interface ChatHeaderProps {
  agentInfo: IAgentInfo;
  lang: Lang;
  setLang: (lang: Lang) => void;
  showGuide: boolean;
  onGuideChange: (show: boolean) => void;
  isEmbedMode: boolean;
  onClose?: () => void;
  /** 消息数量，用于判断是否显示分享按钮 */
  messageCount?: number;
  /** 分享按钮点击回调 */
  onShare?: () => void;
  features?: {
    languageSwitcher?: boolean;
    guide?: boolean;
    share?: boolean;
  };
}

const LANG_OPTIONS: { key: Lang; label: string }[] = [
  { key: "zh-cn", label: "简体中文" },
  { key: "zh-tw", label: "繁體中文" },
  { key: "en", label: "English" },
  { key: "ja", label: "日本語" },
];

function ChatHeaderInner({
  agentInfo,
  lang,
  setLang,
  showGuide,
  onGuideChange,
  isEmbedMode,
  onClose,
  messageCount = 0,
  onShare,
  features = {},
}: ChatHeaderProps) {
  const { t } = useTranslation();
  const { languageSwitcher = true, guide = true, share = false } = features;

  const menuItems: MenuProps["items"] = LANG_OPTIONS.map((item) => ({
    key: item.key,
    label: item.label,
    onClick: () => setLang(item.key),
  }));

  return (
    <header className="flex-none h-[68px] border-b sticky top-0 z-10 bg-white">
      <div className="mx-auto px-4 flex items-center justify-between h-full relative">
        <div></div>
        <div className="absolute left-[120px] right-[120px] top-0 bottom-0 flex items-center justify-center overflow-hidden">
          <div className="flex gap-2 overflow-hidden">
            {agentInfo?.logo && (
              <img
                src={agentInfo.logo}
                alt={agentInfo?.name || "Agent"}
                className="w-5 h-5 rounded-full object-cover"
              />
            )}
            <span className="text-sm text-[#1D1E1F] line-clamp-1">
              {agentInfo?.name || "Agent"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {share && !isEmbedMode && messageCount > 0 && onShare && (
            <Tooltip title={t("action.share")}>
              <div
                className="h-6 px-1 rounded flex items-center justify-center gap-1 cursor-pointer hover:bg-[#E1E2E3] text-[#4F5052]"
                onClick={onShare}
              >
                <SvgIcon name="share-two" size={18} color="#4F5052" stroke />
              </div>
            </Tooltip>
          )}

          {guide && (
            <Tooltip title={t("chat.usage_guide")}>
              <div
                className="h-6 px-1 rounded flex items-center justify-center gap-1 cursor-pointer hover:bg-[#E1E2E3]"
                onClick={() => onGuideChange(!showGuide)}
              >
                <SvgIcon name="layout-split" size={18} />
              </div>
            </Tooltip>
          )}

          {languageSwitcher && (
            <Dropdown
              menu={{ items: menuItems, selectedKeys: [lang] }}
              trigger={["click"]}
            >
              <div className="h-6 px-2 rounded flex items-center justify-center gap-1 cursor-pointer hover:bg-[#E1E2E3] text-sm">
                <SvgIcon name="language" size={16} />
                <span>{t("common.language")}</span>
              </div>
            </Dropdown>
          )}

          {isEmbedMode && onClose && (
            <div
              className="h-6 w-6 rounded flex items-center justify-center cursor-pointer hover:bg-[#E1E2E3]"
              onClick={onClose}
            >
              <CloseOutlined />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

const ChatHeader = memo(ChatHeaderInner);
ChatHeader.displayName = "ChatHeader";

export default ChatHeader;
