import { useRef, useCallback, useEffect, useState } from 'react';

export interface UseChatTimeoutOptions {
  timeout: number;
  enabled?: boolean;
  onTimeout?: () => void;
}

export interface UseChatTimeoutReturn {
  lastMessageTime: number;
  resetTimer: () => void;
  hasTimedOut: boolean;
  pauseCheck: () => void;
  resumeCheck: () => void;
  setLastMessageTime: (time: number) => void;
}

const CHECK_INTERVAL = 5000;

/**
 * 聊天超时检测 hook
 * 使用 ref 避免 stale closure 问题
 */
export function useChatTimeout(options: UseChatTimeoutOptions): UseChatTimeoutReturn {
  const { timeout, enabled = true, onTimeout } = options;

  // 使用 ref 存储值，避免 stale closure
  const lastMessageTimeRef = useRef<number>(0);
  const hasTimedOutRef = useRef<boolean>(false);
  const pausedRef = useRef<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTimeoutRef = useRef<(() => void) | undefined>(onTimeout);

  // 响应式状态（仅用于 UI 渲染）
  const [lastMessageTime, setLastMessageTimeState] = useState(0);
  const [hasTimedOut, setHasTimedOutState] = useState(false);

  // 保持 onTimeout 最新
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  // 检查超时逻辑（不依赖闭包中的 state）
  const checkTimeout = useCallback(() => {
    if (pausedRef.current) {
      timerRef.current = setTimeout(checkTimeout, CHECK_INTERVAL);
      return;
    }

    const currentTime = lastMessageTimeRef.current;
    if (currentTime > 0) {
      const elapsed = Date.now() - currentTime;
      const timeoutMs = timeout * 1000;

      if (elapsed > timeoutMs && !hasTimedOutRef.current) {
        hasTimedOutRef.current = true;
        setHasTimedOutState(true);
        onTimeoutRef.current?.();
        return;
      }
    }

    timerRef.current = setTimeout(checkTimeout, CHECK_INTERVAL);
  }, [timeout]);

  const resetTimer = useCallback(() => {
    lastMessageTimeRef.current = 0;
    hasTimedOutRef.current = false;
    setLastMessageTimeState(0);
    setHasTimedOutState(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const pauseCheck = useCallback(() => {
    pausedRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resumeCheck = useCallback(() => {
    pausedRef.current = false;
    // 恢复后立即启动检查
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(checkTimeout, 1000);
  }, [checkTimeout]);

  const setLastMessageTime = useCallback((time: number) => {
    lastMessageTimeRef.current = time;
    hasTimedOutRef.current = false;
    setLastMessageTimeState(time);
    setHasTimedOutState(false);
    // 确保定时器在运行
    if (!timerRef.current && enabled && timeout > 0) {
      timerRef.current = setTimeout(checkTimeout, CHECK_INTERVAL);
    }
  }, [checkTimeout, enabled, timeout]);

  // 启动/停止定时器
  useEffect(() => {
    if (!enabled || timeout <= 0) return;

    timerRef.current = setTimeout(checkTimeout, CHECK_INTERVAL);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, timeout, checkTimeout]);

  return {
    lastMessageTime,
    resetTimer,
    hasTimedOut,
    pauseCheck,
    resumeCheck,
    setLastMessageTime,
  };
}