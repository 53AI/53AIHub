// packages/index.ts
import "./index.css";

// 首先导入 Icon，确保它是第一个被初始化的
import Icon from "./components/Icon/index";

// 然后导入其他组件
import FileIcon from "./components/FileIcon/index";
import Tooltip from "./components/Tooltip/index";
import Action from "./components/Action/index";
import BubbleUser from "./components/Bubble/user";
import BubbleAssistant from "./components/Bubble/assistant";
import BubbleList from "./components/Bubble/list";
import Sender from "./components/Sender/index";
import MdRenderer from "./components/Markdown/renderer";

import { changeHubxLanguage } from "./locale/index";

// 支持的语言类型
export type Lang = 'zh-cn' | 'zh-tw' | 'en' | 'jp';

// 设置语言的方法
export const setLang = (lang: Lang) => {
  changeHubxLanguage(lang);
};

// 导出所有组件 - Icon 第一个
export {
  Icon,
  FileIcon,
  Tooltip,
  Action,
  BubbleUser,
  BubbleAssistant,
  BubbleList,
  Sender,
  MdRenderer
};

// 导出别名（带 X 前缀，保持兼容）
export {
  Icon as XIcon,
  FileIcon as XFileIcon,
  Tooltip as XTooltip,
  Action as XAction,
  BubbleUser as XBubbleUser,
  BubbleAssistant as XBubbleAssistant,
  BubbleList as XBubbleList,
  Sender as XSender,
  MdRenderer as XMdRenderer
};

// 导出类型
export type { SenderRef, SenderProps, SenderSendData } from "./components/Sender/types";
export type {
  UploadFile,
  FileUploadResult,
  MentionDocItem,
  MentionLinkItem,
  SkillItem,
  InputStateFeature,
  FileUploadFeature,
  MentionFeature,
  SkillFeature,
  UIConfig,
  SenderSlots,
  MentionDropdownSlotProps,
  SkillDropdownSlotProps,
  FileListSlotProps,
  LinkListSlotProps,
} from "./components/Sender/types";
export type { BubbleListRef } from "./components/Bubble/list";

// 导出 Props 类型（解决 DTS 构建错误）
export type { BubbleUserProps } from "./components/Bubble/user";
export type { BubbleAssistantProps } from "./components/Bubble/assistant";
export type { BubbleListProps } from "./components/Bubble/list";
export type { MdRendererProps } from "./components/Markdown/renderer";
export type { TooltipProps } from "./components/Tooltip";

// 默认导出
export default {
  Icon,
  FileIcon,
  Tooltip,
  Action,
  BubbleUser,
  BubbleAssistant,
  BubbleList,
  Sender,
  MdRenderer,
  setLang
};
