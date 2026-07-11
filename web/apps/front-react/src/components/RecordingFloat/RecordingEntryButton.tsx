import { Button } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { useRecordingPage } from "@/hooks/useRecordingPage";
import { checkPermission } from "@/utils/permission";
import RecordingFloat from "./index";

export interface RecordingEntryButtonProps {
  /** 录音中时展示的模式：inline（收缩条）或 full（完整卡片） */
  mode?: "inline" | "full";
  /** idle 状态下按钮的文本，默认"安心录" */
  idleText?: string;
  /** idle 状态下按钮的图标名，默认"voice" */
  idleIcon?: string;
  /** idle 状态下按钮类型 */
  buttonType?: "primary" | "default" | "link";
  /** 启动录音时是否显示全局浮层，默认 false（页面自行展示状态） */
  showFloatOnStart?: boolean;
}

export function RecordingEntryButton({
  mode = "inline",
  idleText = "安心录",
  idleIcon = "voice",
  buttonType = "link",
  showFloatOnStart = false,
}: RecordingEntryButtonProps) {
  const { isRecording, startRecording } = useRecordingPage({
    showFloatOnStart,
  });

  if (isRecording) {
    if (mode === "full") {
      return <RecordingFloat full />;
    }
    return <RecordingFloat floating={false} expanded />;
  }

  const handleStartRecording = () => {
    checkPermission({
      onClick: () => {
        startRecording();
      }
    })
  }

  return (
    <Button
      color={buttonType === "link" ? "default" : undefined}
      type={buttonType === "primary" ? "primary" : undefined}
      variant={buttonType === "link" ? "link" : undefined}
      icon={<SvgIcon name={idleIcon} size={16} />}
      onClick={handleStartRecording}
    >
      {idleText}
    </Button>
  );
}

export default RecordingEntryButton;
