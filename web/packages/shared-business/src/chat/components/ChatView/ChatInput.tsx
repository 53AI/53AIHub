import { memo, useCallback } from "react";
import { Sender } from "@km/hub-ui-x-react";
import { SvgIcon } from "@km/shared-components-react";
import { useTranslation } from "../../i18n";
import type {
  ChatInputSlots,
  ChatInputProps,
  InputStateFeature,
  SendData,
} from "./types";

// 重新导出,保持 ChatInput.tsx 旧导入路径兼容
export type { ChatInputSlots, ChatInputProps, InputStateFeature, SendData };

const DEFAULTS = {
  history: { enabled: true },
  newConversation: { enabled: true },
  fileUpload: { enabled: false },
  inputState: { disabled: false, stopDisabled: false, disabledReason: undefined },
} as const;

function ChatInputInner({
  inputValue,
  onChange,
  onSend,
  onStop,
  isStreaming,
  slots,
  history,
  newConversation,
  fileUpload,
  inputState,
  mention,
  skill,
  actionPosition,
  senderPlaceholder,
  placeholder,
  boxClassName = "",
}: ChatInputProps) {
  const { t } = useTranslation();

  // 解构分组属性，提供默认值
  const historyEnabled = history?.enabled ?? DEFAULTS.history.enabled;
  const newConversationEnabled = newConversation?.enabled ?? DEFAULTS.newConversation.enabled;
  const fileUploadEnabled = fileUpload?.enabled ?? DEFAULTS.fileUpload.enabled;
  const {
    disabled = DEFAULTS.inputState.disabled,
    stopDisabled = DEFAULTS.inputState.stopDisabled,
    disabledReason,
  } = inputState ?? {};

  // 回调
  const onHistoryOpen = history?.onOpen;
  const onNewConversationClick = newConversation?.onCreate;

  // 文件上传配置
  const enableUpload = fileUploadEnabled;
  const enableDragUpload = fileUpload?.enableDrag;
  const allowMultiple = fileUpload?.allowMultiple;
  const allowSendWithFiles = fileUpload?.allowSendWithFiles;
  const acceptTypes = fileUpload?.acceptTypes;
  const maxFileSize = fileUpload?.maxFileSize;
  const httpRequest = fileUpload?.request;
  const enablePasteUpload = fileUpload?.enablePaste;

  // 插槽
  const renderLeftButtons = slots?.leftButtons;
  const renderLeftExtras = slots?.renderLeftExtras;
  const senderInnerSlots = slots?.senderSlots;

  const handleSend = useCallback(
    (data: SendData | string, files?: any[]) => {
      onSend(data, files);
    },
    [onSend]
  );

  // 合并 sender 内部 slots:调用方提供的 linkList / mentionDropdown / skillDropdown 等,
  // 与 ChatInput 自身的 renderLeftExtras 合并到 extrasLeft
  const mergedSenderSlots = {
    ...(senderInnerSlots ?? {}),
    extrasLeft: renderLeftExtras ?? senderInnerSlots?.extrasLeft,
  };

  return (
    <div className={`pb-5 sticky z-10 bottom-0 bg-white ${boxClassName || "w-11/12 md:w-4/5 max-w-[1200px]"} mx-auto`}>
      <div className="flex gap-2 mb-2.5">
        {renderLeftButtons?.()}

        <div className="flex-1"></div>

        {historyEnabled && onHistoryOpen && (
          <div
            className="h-8 px-2 rounded-full flex items-center gap-1.5 bg-[#F1F2F3] text-sm text-[#1F2123] cursor-pointer hover:bg-[#E1E2E3]"
            onClick={onHistoryOpen}
          >
            <SvgIcon name="history" size={16} />
            {t("chat.history_conversation")}
          </div>
        )}

        {newConversationEnabled && onNewConversationClick && (
          <div
            className="h-8 px-2 rounded-full flex items-center gap-1.5 bg-[#F1F2F3] text-sm text-[#1F2123] cursor-pointer hover:bg-[#E1E2E3]"
            onClick={onNewConversationClick}
          >
            <SvgIcon name="plus" size={16} />
            {t("chat.new_conversation")}
          </div>
        )}
      </div>

      <Sender
        value={inputValue}
        onChange={onChange}
        onSend={handleSend}
        onStop={onStop}
        loading={isStreaming}
        placeholder={(disabled && disabledReason) || senderPlaceholder || placeholder || t("chat.input_placeholder")}
        // 透传 mention / skill(由 ChatContainer 按 agent_usage 注入)
        mention={mention}
        skill={skill}
        // inputState 分组
        inputState={{
          disabled,
          stopDisabled,
          disabledReason,
        }}
        // fileUpload 分组
        fileUpload={{
          enabled: enableUpload,
          acceptTypes,
          maxFileSize,
          allowMultiple,
          allowSendWithFiles,
          enableDrag: enableDragUpload,
          enablePaste: enablePasteUpload,
          request: httpRequest,
        }}
        // ui 分组
        ui={actionPosition ? { actionPosition } : undefined}
        // 透传 Sender 内部 slot,合并 extrasLeft
        slots={mergedSenderSlots}
      />
      {/* {disabled && disabledReason && (
        <div className="mt-2 text-center text-xs text-[#E8A600]">
          {disabledReason}
        </div>
      )} */}
      <div className="text-center text-xs text-gray-400 mt-2">
        {t("chat.ai_disclaimer")}
      </div>
    </div>
  );
}

const ChatInput = memo(ChatInputInner);
ChatInput.displayName = "ChatInput";

export default ChatInput;
