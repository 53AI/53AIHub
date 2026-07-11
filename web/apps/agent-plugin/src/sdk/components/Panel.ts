/**
 * Panel - Floating panel containing iframe with agent-plugin app
 */
import type { SDKConfig } from '../types';
import { buildUrl } from '../utils/dom';

export interface PanelOptions {
  config: SDKConfig;
  onClose: () => void;
}

export function createPanel(options: PanelOptions): {
  element: HTMLDivElement;
  iframe: HTMLIFrameElement;
  setOpen: (isOpen: boolean) => void;
  setLoading: (isLoading: boolean) => void;
} {
  const { config, onClose } = options;
  const position = config.position || 'bottom-right';
  const width = config.width || '440px';
  const height = config.height || '100vh';
  const name = config.name || 'Agent Chat';
  const bgColor = config.theme?.backgroundColor || '#ffffff';

  // Main panel container
  const panel = document.createElement('div');
  panel.className = `agent-plugin-sdk-panel ${position === 'bottom-left' ? 'left' : 'right'} hidden`;
  panel.style.width = width;
  panel.style.height = height;

  // Loading indicator
  const loading = document.createElement('div');
  loading.className = 'agent-plugin-sdk-loading';
  loading.style.display = 'flex';

  const spinner = document.createElement('div');
  spinner.className = 'agent-plugin-sdk-spinner';
  loading.appendChild(spinner);

  // Iframe container
  const iframeContainer = document.createElement('div');
  iframeContainer.className = 'agent-plugin-sdk-iframe-container';

  // Iframe
  const iframe = document.createElement('iframe');
  iframe.className = 'agent-plugin-sdk-iframe';
  iframe.setAttribute('allow', 'microphone; camera; clipboard-write');
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('title', name);

  // Build iframe URL with token and optional SSO params
  const urlParams: Record<string, string | number | boolean> = {
    token: config.token,
    embed: 'true',
  };

  // Add SSO params if provided
  if (config.username) {
    urlParams.username = config.username;
    if (config.timestamp) {
      urlParams.timestamp = config.timestamp;
    }
    if (config.sign) {
      urlParams.sign = config.sign;
    }
  }

  // Use fixed /agentplugin path
  const baseUrl = config.agentUrl || '';
  const agentPluginUrl = baseUrl.endsWith('/')
    ? `${baseUrl}agentplugin`
    : `${baseUrl}/agentplugin`;
  const iframeUrl = buildUrl(agentPluginUrl, urlParams);
  iframe.src = iframeUrl;

  // Hide loading when iframe is loaded
  iframe.addEventListener('load', () => {
    loading.style.display = 'none';
  });

  iframeContainer.appendChild(iframe);

  // Assemble panel
  panel.appendChild(loading);
  panel.appendChild(iframeContainer);

  function setOpen(isOpen: boolean): void {
    if (isOpen) {
      panel.classList.remove('hidden');
      panel.style.display = 'flex';
    } else {
      panel.classList.add('hidden');
      panel.style.display = 'none';
    }
  }

  function setLoading(isLoading: boolean): void {
    loading.style.display = isLoading ? 'flex' : 'none';
  }

  return { element: panel, iframe, setOpen, setLoading };
}