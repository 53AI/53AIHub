/**
 * AgentPluginSDK - Main SDK class
 */
import type { SDKConfig, SDKInstance, SDKState } from './types';
import { createFloatingButton } from './components/FloatingButton';
import { createPanel } from './components/Panel';
import { createPostMessageListener, initIframe, notifyIframeState } from './utils/postMessage';
import { createShadowContainer, injectStyles, saveToStorage, loadFromStorage, removeFromStorage } from './utils/dom';

import styles from './styles/sdk.css?raw';

const STORAGE_KEY = 'sdk-state';
const DEFAULT_CONFIG: Partial<SDKConfig> = {
  position: 'bottom-right',
  width: '400px',
  height: '100vh',
  name: 'Agent Chat',
  autoOpen: false,
  persistState: true,
  theme: {
    primaryColor: '#2563EB',
    backgroundColor: '#ffffff',
  },
  offset: {
    bottom: '24px',
    right: '24px',
  },
};

/**
 * Get SDK base URL from script src
 */
function getSDKBaseUrl(): string {
  if (typeof document === 'undefined') return '';

  // Find the script tag that loaded this SDK
  const scripts = document.querySelectorAll('script[src*="agent-plugin-sdk"]');
  for (const script of scripts) {
    const src = script.getAttribute('src');
    if (src) {
      try {
        const url = new URL(src, document.baseURI);
        // Return origin + pathname (without the filename)
        const pathParts = url.pathname.split('/');
        pathParts.pop(); // Remove filename
        return url.origin + pathParts.join('/');
      } catch {
        continue;
      }
    }
  }

  // Fallback to current origin
  return window.location.origin;
}

export class AgentPluginSDK implements SDKInstance {
  private config: SDKConfig;
  private container: HTMLDivElement;
  private shadowRoot: ShadowRoot;
  private floatingButton: ReturnType<typeof createFloatingButton>;
  private panel: ReturnType<typeof createPanel>;
  private isOpen: boolean = false;
  private isReady: boolean = false;
  private cleanup: (() => void) | null = null;
  private messageListenerCleanup: (() => void) | null = null;

  constructor(userConfig: Partial<SDKConfig>) {
    this.config = this.mergeConfig(userConfig);
    this.validateConfig();
    this.init();
  }

  private mergeConfig(userConfig: Partial<SDKConfig>): SDKConfig {
    // Auto-detect agentUrl from script src if not provided
    const agentUrl = userConfig.agentUrl || getSDKBaseUrl();

    return {
      ...DEFAULT_CONFIG,
      ...userConfig,
      agentUrl,
      theme: {
        ...DEFAULT_CONFIG.theme!,
        ...userConfig.theme,
      },
      offset: {
        ...DEFAULT_CONFIG.offset!,
        ...userConfig.offset,
      },
    } as SDKConfig;
  }

  private validateConfig(): void {
    if (!this.config.agentUrl) {
      throw new Error('AgentPluginSDK: agentUrl is required');
    }
    if (!this.config.token) {
      throw new Error('AgentPluginSDK: token is required');
    }
  }

  private init(): void {
    this.createContainer();
    this.setupPostMessageListener();
    this.render();
    this.restoreState();

    if (this.config.autoOpen) {
      this.open();
    }
  }

  private createContainer(): void {
    const result = createShadowContainer('agent-plugin-sdk');
    this.container = result.container;
    this.shadowRoot = result.shadowRoot;

    injectStyles(this.shadowRoot, styles);

    document.body.appendChild(this.container);
  }

  private setupPostMessageListener(): void {
    const allowedOrigin = new URL(this.config.agentUrl).origin;

    const { cleanup } = createPostMessageListener(allowedOrigin, {
      onReady: () => {
        this.isReady = true;
        this.panel.setLoading(false);
        initIframe(this.panel.iframe, this.config, allowedOrigin);
      },
      onResize: (size) => {
        console.log('Iframe resize requested:', size);
      },
      onError: (message) => {
        console.error('Iframe error:', message);
      },
      onAuthRequired: () => {
        console.warn('Authentication required');
      },
      onCloseRequest: () => {
        this.close();
      },
    });

    this.messageListenerCleanup = cleanup;
  }

  private render(): void {
    this.floatingButton = createFloatingButton({
      config: this.config,
      onClick: () => this.toggle(),
    });

    this.panel = createPanel({
      config: this.config,
      onClose: () => this.close(),
    });

    this.shadowRoot.appendChild(this.floatingButton.element);
    this.shadowRoot.appendChild(this.panel.element);
  }

  private restoreState(): void {
    if (this.config.persistState) {
      const state = loadFromStorage<SDKState>(STORAGE_KEY, { isOpen: false, isReady: false });
      if (state.isOpen) {
        this.open();
      }
    }
  }

  private saveState(): void {
    if (this.config.persistState) {
      saveToStorage(STORAGE_KEY, { isOpen: this.isOpen, isReady: this.isReady });
    }
  }

  public open(): void {
    this.isOpen = true;
    this.floatingButton.setOpen(true);
    this.panel.setOpen(true);

    const allowedOrigin = new URL(this.config.agentUrl).origin;
    notifyIframeState(this.panel.iframe, true, allowedOrigin);

    this.saveState();
  }

  public close(): void {
    this.isOpen = false;
    this.floatingButton.setOpen(false);
    this.panel.setOpen(false);

    const allowedOrigin = new URL(this.config.agentUrl).origin;
    notifyIframeState(this.panel.iframe, false, allowedOrigin);

    this.saveState();
  }

  public toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  public destroy(): void {
    this.close();
    this.messageListenerCleanup?.();
    removeFromStorage(STORAGE_KEY);
    document.body.removeChild(this.container);
  }

  public getState(): SDKState {
    return {
      isOpen: this.isOpen,
      isReady: this.isReady,
    };
  }
}