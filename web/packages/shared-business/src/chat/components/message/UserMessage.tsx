// packages/shared-business/src/chat/components/message/UserMessage.tsx

import { memo, useCallback, useMemo } from "react";
import { Checkbox } from "antd";
import { getSimpleDateFormatString } from "@km/shared-utils";
import { BubbleUser } from "@km/hub-ui-x-react";
import { MessageMenu } from "../MessageMenu";
import { SpecifiedFiles } from "../source";
import type { Message, ChatMessagesFeatures, FileItem } from "../../types/message";
import type { FileActionFeature, ChatMessagesSlots } from "../ChatMessages/types";

// === Main Props ===

export interface UserMessageProps {
  // === 核心 ===
  /** 消息数据 */
  message: Message;
  /** 用户头像 URL（与 agent 头像不同来源） */
  userAvatar?: string;
  /** 功能开关 */
  features?: ChatMessagesFeatures;

  // === 功能分组 ===
  /** 分享模式 */
  isShareMode?: boolean;
  /** 是否被选中（分享模式） */
  isSelected?: boolean;

  // === 回调分组 ===
  /** 文件操作回调 */
  fileAction?: FileActionFeature;

  // === UI 插槽 ===
  slots?: ChatMessagesSlots;

  // === 其他 ===
  /** 自定义类名 */
  className?: string;
  /** 自定义样式 */
  style?: React.CSSProperties;
}

/**
 * 解析消息内容
 * 支持 JSON 格式的 question (如 [{type: "text", content: "..."}])
 * 支持技能前缀移除 (如 "/skill_name actual_question")
 */
function parseMessageContent(msg: Message): string {
  let content = "";
  const rawContent = msg.original_question || msg.question || "";

  // 尝试解析 JSON 格式
  try {
    const question = JSON.parse(rawContent);
    if (question && Array.isArray(question)) {
      const textItem = question.find((item: any) => item.type === "text");
      if (textItem?.content) {
        content = textItem.content;
      }
    } else {
      content = rawContent;
    }
  } catch {
    // Not JSON format, use raw string
    content = rawContent;
  }

  // Strip skill prefix if skill info is available
  // Format: "/skill_name actual_question"
  if (msg.skill?.skill_name && content.startsWith(`/${msg.skill.skill_name} `)) {
    content = content.substring(msg.skill.skill_name.length + 2);
  }

  return content;
}

function UserMessageInner({
  message,
  userAvatar,
  features,
  isShareMode = false,
  isSelected = false,
  fileAction,
  slots,
  className,
  style,
}: UserMessageProps) {
  const handleSelect = useCallback(() => {
    if (isShareMode && fileAction) {
      // 分享模式下点击选择消息
    }
  }, [isShareMode, fileAction]);

  const handleFileClick = useCallback((file: FileItem) => {
    fileAction?.onClick?.(file);
  }, [fileAction]);

  // 解析后的内容
  const parsedContent = useMemo(() => parseMessageContent(message), [message]);

  // 合并 specified_files 和 uploaded_files
  const specifiedFiles = useMemo(() => {
    const files = [
      ...(message.specified_files || []),
      ...(message.uploaded_files || []),
    ];
    return files;
  }, [message.specified_files, message.uploaded_files]);

  // 渲染技能标签（数据驱动：有 skill 数据就显示）
  const renderSkillTag = () => {
    if (!message.skill?.display_name) return null;
    return (
      <span className="bg-[#e6e9f2] rounded py-1 px-2 text-sm mr-2">
        {message.skill.display_name}
      </span>
    );
  };

  // 渲染指定文件头部（数据驱动：有文件数据就显示）
  // SpecifiedFiles 会根据 renderLink 和 fileLink adapter 自动推断跳转模式
  const renderSpecifiedFilesHeader = () => {
    if (!specifiedFiles.length) return undefined;

    return (
      <SpecifiedFiles
        files={specifiedFiles}
        onFileClick={handleFileClick}
        renderLink={slots?.fileLink ? (file, children) => slots.fileLink!({ file, children }) : undefined}
      />
    );
  };

  // 格式化时间显示
  const formattedTime = useMemo(() => {
    if (!message.showTime || !message.created_time) return null;
    return getSimpleDateFormatString({
      date: message.created_time,
      format: 'YYYY-MM-DD hh:mm:ss',
    });
  }, [message.showTime, message.created_time]);

  return (
    <div
      className={`flex items-center gap-5 rounded-xl ${isShareMode ? "mb-4 px-3 py-4 bg-[#F5F5F5]" : ""}`}
      onClick={handleSelect}
    >
      {isShareMode && <Checkbox checked={isSelected} />}

      <div className="flex-1 overflow-hidden">
        {/* 时间显示（仅历史数据显示） */}
        {formattedTime && (
          <div className="flex items-center justify-center mb-2">
            <span className="text-xs text-gray-400">{formattedTime}</span>
          </div>
        )}

        <BubbleUser
          content={parsedContent}
          files={message.uploaded_files}
          avatar={userAvatar}
          className={className}
          style={{
            "--hubx-color-bg-message": "#EBF1FF",
            ...style,
          } as React.CSSProperties}
          header={renderSpecifiedFilesHeader()}
          contentBefore={renderSkillTag()}
          menu={
            !isShareMode && features?.menu?.copy !== false ? (
              <MessageMenu
                type="user"
                content={parsedContent}
                features={{ copy: features?.menu?.copy ?? true }}
              />
            ) : undefined
          }
        />
      </div>
    </div>
  );
}

const UserMessage = memo(UserMessageInner);
UserMessage.displayName = "UserMessage";

export default UserMessage;
