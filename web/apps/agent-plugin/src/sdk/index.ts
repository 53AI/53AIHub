/**
 * Agent Plugin SDK - IIFE Entry Point
 *
 * Usage:
 * 1. Declarative (auto-init):
 *    <script>
 *      window.__AGENT_PLUGIN_SDK_CONFIG__ = { token: 'your-h5-token-here', name: 'AI 助手' };
 *    </script>
 *    <script src="https://chat.example.com/agent-plugin-sdk.iife.js"></script>
 *
 * 2. Programmatic (manual init):
 *    <script src="https://chat.example.com/agent-plugin-sdk.iife.js"></script>
 *    <script>
 *      AgentPluginSDK.init({ token: 'your-h5-token-here', name: 'AI 助手' });
 *    </script>
 */
import { AgentPluginSDK } from './SDK';
import type { SDKConfig, SDKInstance, AgentPluginSDKAPI } from './types';

// SDK version
const VERSION = '1.0.0';

// Track initialized instance
let instance: SDKInstance | null = null;

/**
 * Initialize the SDK
 */
function init(config: Partial<SDKConfig>): SDKInstance {
  if (instance) {
    console.warn('AgentPluginSDK: Already initialized. Returning existing instance.');
    return instance;
  }

  instance = new AgentPluginSDK(config);
  return instance;
}

/**
 * Get current instance
 */
function getInstance(): SDKInstance | null {
  return instance;
}

// Create global API
const api: AgentPluginSDKAPI = {
  init,
  version: VERSION,
};

// Expose to global scope
(window as any).AgentPluginSDK = api;

// Auto-initialize if config is provided via global variable
if ((window as any).__AGENT_PLUGIN_SDK_CONFIG__) {
  try {
    init((window as any).__AGENT_PLUGIN_SDK_CONFIG__);
  } catch (error) {
    console.error('AgentPluginSDK: Failed to auto-initialize:', error);
  }
}

// Export for module usage (when not using IIFE build)
export { AgentPluginSDK, init, VERSION };
export type { SDKConfig, SDKInstance, AgentPluginSDKAPI };
