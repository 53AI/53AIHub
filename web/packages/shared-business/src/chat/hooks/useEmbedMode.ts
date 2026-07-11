import { useMemo, useCallback } from 'react';

export interface UseEmbedModeReturn {
  isEmbedMode: boolean;
  notifyReady: () => void;
  requestClose: () => void;
}

/**
 * 获取父窗口的 origin
 */
function getParentOrigin(): string {
  try {
    if (document.referrer) {
      return new URL(document.referrer).origin;
    }
  } catch {
    // ignore
  }
  return '*';
}

/**
 * 检测并处理 embed 模式（iframe 嵌入）
 */
export function useEmbedMode(): UseEmbedModeReturn {
  const isEmbedMode = useMemo(() => {
    return window !== window.top ||
      new URLSearchParams(window.location.search).get('embed') === 'true';
  }, []);

  const parentOrigin = useMemo(() => getParentOrigin(), []);

  const notifyReady = useCallback(() => {
    if (isEmbedMode && window.parent) {
      window.parent.postMessage({ type: 'READY' }, parentOrigin);
    }
  }, [isEmbedMode, parentOrigin]);

  const requestClose = useCallback(() => {
    if (isEmbedMode && window.parent) {
      window.parent.postMessage({ type: 'CLOSE_REQUEST' }, parentOrigin);
    }
  }, [isEmbedMode, parentOrigin]);

  return { isEmbedMode, notifyReady, requestClose };
}
