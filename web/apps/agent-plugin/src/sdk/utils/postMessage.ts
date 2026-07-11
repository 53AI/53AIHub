/**
 * postMessage communication handling for SDK
 */

import type { SDKToIframeMessage, IframeToSDKMessage, SDKConfig } from '../types';

type MessageHandler = (payload: unknown) => void;

export interface PostMessageHandlers {
  onReady?: () => void;
  onResize?: (size: { width: number; height: number }) => void;
  onNewMessage?: (count: number) => void;
  onError?: (message: string) => void;
  onAuthRequired?: () => void;
  onCloseRequest?: () => void;
}

/**
 * Create a postMessage listener for iframe communication
 */
export function createPostMessageListener(
  allowedOrigin: string,
  handlers: PostMessageHandlers
): { listener: (event: MessageEvent) => void; cleanup: () => void } {
  const listener = (event: MessageEvent) => {
    if (event.origin !== allowedOrigin) return;

    const { type, payload } = (event.data || {}) as IframeToSDKMessage;
    if (!type) return;

    switch (type) {
      case 'READY':
        handlers.onReady?.();
        break;
      case 'RESIZE':
        handlers.onResize?.(payload as { width: number; height: number });
        break;
      case 'NEW_MESSAGE':
        handlers.onNewMessage?.((payload as { count: number }).count);
        break;
      case 'ERROR':
        handlers.onError?.((payload as { message: string }).message);
        break;
      case 'AUTH_REQUIRED':
        handlers.onAuthRequired?.();
        break;
      case 'CLOSE_REQUEST':
        handlers.onCloseRequest?.();
        break;
    }
  };

  window.addEventListener('message', listener);

  const cleanup = () => {
    window.removeEventListener('message', listener);
  };

  return { listener, cleanup };
}

/**
 * Send message to iframe
 */
export function sendMessageToIframe(
  iframe: HTMLIFrameElement,
  message: SDKToIframeMessage,
  targetOrigin: string
): void {
  iframe.contentWindow?.postMessage(message, targetOrigin);
}

/**
 * Initialize iframe with config
 */
export function initIframe(
  iframe: HTMLIFrameElement,
  config: SDKConfig,
  targetOrigin: string
): void {
  sendMessageToIframe(iframe, {
    type: 'INIT',
    payload: {
      token: config.token,
      config: {
        theme: config.theme,
        name: config.name,
      },
    },
  }, targetOrigin);
}

/**
 * Set authentication token in iframe
 */
export function setIframeToken(
  iframe: HTMLIFrameElement,
  token: string,
  targetOrigin: string
): void {
  sendMessageToIframe(iframe, {
    type: 'SET_TOKEN',
    payload: { token },
  }, targetOrigin);
}

/**
 * Notify iframe of panel open/close
 */
export function notifyIframeState(
  iframe: HTMLIFrameElement,
  isOpen: boolean,
  targetOrigin: string
): void {
  sendMessageToIframe(iframe, {
    type: isOpen ? 'OPEN' : 'CLOSE',
  }, targetOrigin);
}
