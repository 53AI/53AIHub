/**
 * SDK Configuration Interface
 */
export interface SDKConfig {
  /** agent-plugin application URL (optional: auto-detected from script src) */
  agentUrl?: string;
  /** H5 fixed token for authentication */
  token: string;
  /** Agent name (default: 'Agent Chat') */
  name?: string;
  /** Agent logo image URL (default: built-in icon) */
  logo?: string;
  /** Button position (default: 'bottom-right') */
  position?: 'bottom-right' | 'bottom-left';
  /** Theme configuration */
  theme?: {
    primaryColor?: string;    // default: #2563EB
    backgroundColor?: string; // default: #ffffff
  };
  /** Panel width (default: '400px') */
  width?: string;
  /** Panel height (default: '600px') */
  height?: string;
  /** Offset from edges */
  offset?: {
    bottom?: string; // default: '24px'
    right?: string;  // default: '24px'
    left?: string;   // for bottom-left position
  };
  /** Auto-open on load (default: false) */
  autoOpen?: boolean;
  /** Persist open/close state (default: true) */
  persistState?: boolean;
  /** SSO username for identity binding */
  username?: string;
  /** SSO timestamp */
  timestamp?: number;
  /** SSO sign (md5 of timestamp&username + secret) */
  sign?: string;
}

/**
 * SDK Internal State
 */
export interface SDKState {
  isOpen: boolean;
  isReady: boolean;
}

/**
 * postMessage Protocol - SDK to Iframe
 */
export interface SDKToIframeMessage {
  type: 'INIT' | 'SET_TOKEN' | 'OPEN' | 'CLOSE' | 'RESIZE';
  payload?: Record<string, unknown>;
}

/**
 * postMessage Protocol - Iframe to SDK
 */
export interface IframeToSDKMessage {
  type: 'READY' | 'RESIZE' | 'NEW_MESSAGE' | 'ERROR' | 'AUTH_REQUIRED' | 'CLOSE_REQUEST';
  payload?: Record<string, unknown>;
}

/**
 * Global SDK API
 */
export interface AgentPluginSDKAPI {
  init: (config: Partial<SDKConfig>) => SDKInstance;
  version: string;
}

/**
 * SDK Instance Interface
 */
export interface SDKInstance {
  open: () => void;
  close: () => void;
  toggle: () => void;
  destroy: () => void;
  getState: () => SDKState;
}

/**
 * Global Window Extensions
 */
declare global {
  interface Window {
    AgentPluginSDK: AgentPluginSDKAPI;
    __AGENT_PLUGIN_SDK_CONFIG__?: Partial<SDKConfig>;
  }
}