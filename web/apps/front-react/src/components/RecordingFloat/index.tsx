import { useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Tooltip, Spin } from "antd";
import { useRecordingStore } from "@/stores/modules/recording";
import { SvgIcon } from "@km/shared-components-react";
import { AudioWave } from "@/components/AudioWave";
import { useDraggable } from "@/hooks/useDraggable";
import { MAX_RECORDING_DURATION_SEC } from "@/constants/recording";

interface RecordingFloatProps {
  /** 是否悬浮定位（默认 true） */
  floating?: boolean;
  /** 是否展开操作按钮（默认 false，由 hover 控制） */
  expanded?: boolean;
  /** 是否展示完整版界面（优先级最高） */
  full?: boolean;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `00:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function RecordingFloat({
  floating = true,
  expanded = false,
  full = false,
}: RecordingFloatProps) {
  const navigate = useNavigate();
  const {
    status,
    duration,
    floatVisible,
    interruptedJob,
    networkOffline,
    heartbeatError,
    isTransitioning,
    pause,
    resume,
    finish,
    hideFloat,
    recoverInterrupted,
  } = useRecordingStore();
  const [isHovered, setIsHovered] = useState(false);

  // Status flags (define early for useDraggable)
  const isRecording = status === "recording";
  const isPaused = status === "paused";
  const isInterrupted = status === "interrupted";
  const isFinalizing = status === "finalizing";

  const handleFloatClick = useCallback(() => {
    navigate("/mine?tab=audio");
    hideFloat();
  }, [navigate, hideFloat]);

  // Draggable hook for floating mode
  const {
    position: dragPosition,
    isDragging,
    handleDragStart,
  } = useDraggable({
    initialSide: "right",
    initialTop: 40,
    onClick: floating && !isFinalizing ? handleFloatClick : undefined,
  });

  const isExpanded = expanded || isHovered;

  const formattedTime = useMemo(() => formatDuration(duration), [duration]);

  // Disable buttons during transition
  const isDisabled = isTransitioning || isFinalizing;

  // Network and heartbeat error
  const hasNetworkError = networkOffline || heartbeatError;

  // Duration warning (7.5 hours)
  const WARNING_DURATION = 7.5 * 60 * 60;
  const showDurationWarning = duration >= WARNING_DURATION && !isFinalizing;

  // Status text
  const statusText = isFinalizing
    ? "正在处理"
    : isInterrupted
      ? "录音中断"
      : isPaused
        ? "已暂停"
        : "录音中";

  if (status === "idle") return null;
  if (!full && floating && !floatVisible) return null;

  const handleButtonClick = (e: React.MouseEvent, action: (showFloat: boolean) => void) => {
    e.stopPropagation();
    action(floating ? true : false);
  };

  const handleRecover = async (e: React.MouseEvent) => {
    e.stopPropagation();
    recoverInterrupted(floating ? true : false);
  };

  // Prevent mousedown from triggering drag start on action buttons
  const handleActionMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  if (full) {
    return (
      <div className="flex flex-col justify-between w-full h-[120px] bg-[#FAFCFF] border border-[#E6E8EB] rounded-lg p-4 relative">
        {/* Network Error Banner */}
        {hasNetworkError && (
          <div className="absolute top-0 left-0 right-0 h-6 bg-orange-500 text-white text-xs flex items-center justify-center rounded-t-xl">
            {networkOffline
              ? "网络已断开，正在重连..."
              : "心跳异常，正在重试..."}
          </div>
        )}

        {/* Duration Warning Banner */}
        {showDurationWarning && (
          <div className="absolute top-0 left-0 right-0 h-6 bg-yellow-500 text-white text-xs flex items-center justify-center rounded-t-xl">
            录音时长即将达到上限，请尽快结束
          </div>
        )}

        {/* Top Row */}
        <div
          className={`flex items-center gap-2 ${hasNetworkError || showDurationWarning ? "mt-6" : ""}`}
        >
          <div className="flex items-center justify-center w-5 h-5 text-[#2563EB]">
            {isFinalizing ? (
              <Spin size="small" />
            ) : isInterrupted ? (
              <SvgIcon name="waves-left" size={20} color="#f97316" />
            ) : (
              <AudioWave
                size={20}
                color={isPaused ? "#9ca3af" : "#2563EB"}
                active={isRecording}
              />
            )}
          </div>
          <span className="text-sm text-gray-800 font-medium">
            {statusText}
          </span>
        </div>

        {/* Bottom Row */}
        <div className="flex items-center justify-between mt-auto">
          {/* Left: Time */}
          <div className="text-sm ">
            <span className="text-gray-800">{formattedTime}</span>
            <span className="text-gray-400">
              {" "}
              / {formatDuration(MAX_RECORDING_DURATION_SEC)}
            </span>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            {isDisabled ? (
              // Disabled: show disabled buttons
              <>
                <button
                  disabled
                  className="flex items-center justify-center gap-1.5 h-[34px] px-4 rounded-lg bg-gray-100 text-[13px] text-gray-400 cursor-not-allowed"
                >
                  <SvgIcon name="pause" size={14} />
                  <span>暂停</span>
                </button>
                <button
                  disabled
                  className="flex items-center justify-center gap-1.5 h-[34px] px-4 rounded-lg bg-gray-100 text-[13px] text-gray-400 cursor-not-allowed"
                >
                  <SvgIcon name="power" size={14} />
                  <span>结束</span>
                </button>
              </>
            ) : isInterrupted ? (
              // Interrupted state: show recover button
              <button
                className="flex items-center justify-center gap-1.5 h-[34px] px-4 rounded-lg bg-white border border-gray-200 text-[13px] text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                onClick={handleRecover}
              >
                <SvgIcon name="play-one" size={14}  />
                <span>恢复</span>
              </button>
            ) : isRecording ? (
              <button
                className="flex items-center justify-center gap-1.5 h-[34px] px-4 rounded-lg bg-white border border-gray-200 text-[13px] text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                onClick={(e) => handleButtonClick(e, pause)}
              >
                <SvgIcon name="pause" size={14} />
                <span>暂停</span>
              </button>
            ) : (
              <button
                className="flex items-center justify-center gap-1.5 h-[34px] px-4 rounded-lg bg-white border border-gray-200 text-[13px] text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                onClick={(e) => handleButtonClick(e, resume)}
              >
                <SvgIcon name="play-one" size={14} />
                <span>继续</span>
              </button>
            )}
            {!isDisabled && (
              <button
                className="flex items-center justify-center gap-1.5 h-[34px] px-4 rounded-lg bg-[#ff4d4f] text-[13px] text-white hover:bg-red-500 transition-colors shadow-sm border border-transparent"
                onClick={(e) => handleButtonClick(e, finish)}
              >
                <SvgIcon name="power" size={14} color="#ffffff" />
                <span>结束</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const wrapperClass = floating
    ? `fixed z-[999] h-11 ${
        isDragging ? "" : "transition-all duration-300 ease-in-out"
      } ${dragPosition.side === "left" ? "left-0" : "right-0"}`
    : "h-9 relative inline-block";

  const containerClass = `h-full flex items-center bg-[#FAFBFC] shadow-[0_4px_16px_rgba(0,0,0,0.08)] ${
    isDragging ? "cursor-grabbing" : "cursor-pointer"
  } transition-all duration-300 overflow-hidden ${
    !floating || isExpanded
      ? `${floating ? "" : "rounded-full"} px-3 gap-2`
      : "rounded-l-lg px-3 gap-2"
  }`;

  return (
    <div
      className={wrapperClass}
      style={floating ? { top: `${dragPosition.top}px` } : undefined}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={floating ? handleDragStart : undefined}
      onTouchStart={floating ? handleDragStart : undefined}
    >
      {/* Network Error Banner - floating mode */}
      {hasNetworkError && (
        <div className="absolute -top-4 left-0 right-0 h-6 bg-orange-500 text-white text-xs flex items-center justify-center rounded-t-lg">
          {networkOffline ? "网络已断开" : "心跳异常"}
        </div>
      )}

      {/* Duration Warning Banner - floating mode */}
      {showDurationWarning && (
        <div className="absolute -top-6 left-0 right-0 h-6 bg-yellow-500 text-white text-xs flex items-center justify-center rounded-t-lg">
          录音即将达上限
        </div>
      )}

      <div
        className={containerClass}
      >
        {/* Icon */}
        <div className="flex items-center justify-center w-5 h-5">
          {isFinalizing ? (
            <Spin size="small" />
          ) : isInterrupted ? (
            <SvgIcon name="waves-left" size={16} color="#f97316" />
          ) : (
            <AudioWave
              size={16}
              color={isPaused ? "#9ca3af" : "#2563EB"}
              active={isRecording}
            />
          )}
        </div>

        {/* Text and Time */}
        <div className="flex items-center text-sm text-gray-800 whitespace-nowrap ">
          {isExpanded ? (
            <span className="ml-1.5 font-mono">{formattedTime}</span>
          ) : (
            <span className="ml-1.5">
              {isFinalizing
                ? "处理中"
                : isInterrupted
                  ? "录音中断"
                  : isPaused
                    ? "已暂停"
                    : "录音中"}
            </span>
          )}
        </div>

        {/* Actions (Only visible when expanded) */}
        {isExpanded && (
          <>
            <div className="w-px h-3 bg-gray-200 mx-1.5" />
            <div className="flex items-center gap-1.5">
              {isDisabled ? (
                // Disabled: show disabled buttons
                <>
                  <div className="flex items-center justify-center w-6 h-6 bg-gray-100 rounded-md text-gray-300 cursor-not-allowed">
                    <SvgIcon name="pause" size={16} />
                  </div>
                  <div className="flex items-center justify-center w-6 h-6 bg-gray-100 rounded-md text-gray-300 cursor-not-allowed">
                    <SvgIcon name="power" size={16} />
                  </div>
                </>
              ) : isInterrupted ? (
                // Interrupted: show recover button
                <Tooltip
                  title="恢复录音"
                  placement="bottomRight"
                >
                  <div
                    className="flex items-center justify-center w-6 h-6 bg-white rounded-md text-gray-700 hover:bg-gray-100 transition-colors"
                    onMouseDown={handleActionMouseDown}
                    onClick={handleRecover}
                  >
                    <SvgIcon name="play-one" size={16} />
                  </div>
                </Tooltip>
              ) : isRecording ? (
                <Tooltip title="暂停录音" placement="bottomRight">
                  <div
                    className="flex items-center justify-center w-6 h-6 bg-white rounded-md text-gray-700 hover:bg-gray-100 transition-colors"
                    onMouseDown={handleActionMouseDown}
                    onClick={(e) => handleButtonClick(e, pause)}
                  >
                    <SvgIcon name="pause" size={16} />
                  </div>
                </Tooltip>
              ) : (
                <Tooltip title="继续录音" placement="bottomRight">
                  <div
                    className="flex items-center justify-center w-6 h-6 bg-white rounded-md text-gray-700 hover:bg-gray-100 transition-colors"
                    onMouseDown={handleActionMouseDown}
                    onClick={(e) => handleButtonClick(e, resume)}
                  >
                    <SvgIcon name="play-one" size={16} />
                  </div>
                </Tooltip>
              )}
              {!isDisabled && (
                <Tooltip title="结束录音" placement="bottomRight">
                  <div
                    className="flex items-center justify-center w-6 h-6 bg-white rounded-md hover:bg-gray-100 transition-colors"
                    onMouseDown={handleActionMouseDown}
                    onClick={(e) => handleButtonClick(e, finish)}
                  >
                    <SvgIcon name="power" size={16} color="#ef4444" />
                  </div>
                </Tooltip>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default RecordingFloat;
