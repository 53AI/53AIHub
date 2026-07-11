import { useCallback, useEffect } from "react";
import { useRecordingStore } from "@/stores/modules/recording";

export interface UseRecordingPageOptions {
  /** 启动录音时是否显示全局浮层，默认 true */
  showFloatOnStart?: boolean;
}

export function useRecordingPage(options: UseRecordingPageOptions = {}) {
  const { showFloatOnStart = true } = options;

  const status = useRecordingStore((s) => s.status);
  const start = useRecordingStore((s) => s.start);
  const hideFloat = useRecordingStore((s) => s.hideFloat);
  const showFloat = useRecordingStore((s) => s.showFloat);

  // Page close protection is handled globally in layout.tsx

  // Hide global float when this page is active, restore when leaving
  useEffect(() => {
    hideFloat();
    return () => {
      showFloat();
    };
  }, [hideFloat, showFloat]);

  const startRecording = useCallback(async () => {
    try {
      await start(showFloatOnStart);
    } catch (error) {
      console.error("启动录音失败:", error);
    }
  }, [start, showFloatOnStart]);

  return {
    status,
    isRecording: status !== "idle",
    startRecording,
  } as const;
}

export default useRecordingPage;
