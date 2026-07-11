/**
 * FloatingButton - 头像 + 标签按钮样式（参考 53ai 设计）
 * 点击后保持原样，不切换关闭样式
 */
import type { SDKConfig } from '../types';

const DEFAULT_AVATAR = `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="24" cy="24" r="24" fill="#2563EB"/>
  <path d="M32 18H16C14.9 18 14 18.9 14 20V36L18 32H32C33.1 32 34 31.1 34 30V20C34 18.9 33.1 18 32 18ZM32 30H18L16 32V20H32V30Z" fill="white"/>
  <path d="M19 23H29V25H19V23ZM19 20H26V22H19V20Z" fill="white"/>
</svg>`;

export interface FloatingButtonOptions {
  config: SDKConfig;
  onClick: () => void;
}

export function createFloatingButton(options: FloatingButtonOptions): {
  element: HTMLDivElement;
  setOpen: (isOpen: boolean) => void;
  setBadge: (count: number) => void;
} {
  const { config, onClick } = options;
  const position = config.position || 'bottom-right';
  const primaryColor = config.theme?.primaryColor || '#2563EB';
  const name = config.name || 'AI Assistant';

  // 主容器（参考 53ai 结构）
  const container = document.createElement('div');
  container.className = `agent-plugin-sdk-button ${position}`;
  container.setAttribute('role', 'button');
  container.setAttribute('aria-label', 'Open chat');
  container.setAttribute('tabindex', '0');

  // 头像容器（圆形，90x90px）- order: 1
  const avatarContainer = document.createElement('div');
  avatarContainer.className = 'agent-plugin-sdk-button-avatar';

  if (config.logo) {
    const img = document.createElement('img');
    img.src = config.logo;
    img.alt = 'Chat avatar';
    avatarContainer.appendChild(img);
  } else {
    avatarContainer.innerHTML = DEFAULT_AVATAR;
  }

  // 标签容器（胶囊形状，显示名称）- order: 2
  const labelContainer = document.createElement('div');
  labelContainer.className = 'agent-plugin-sdk-button-label';
  labelContainer.textContent = name;
  labelContainer.style.color = primaryColor;
  labelContainer.style.background = 'rgba(255, 255, 255, 1)';
  labelContainer.style.boxShadow = `0px 2px 4px rgba(37, 99, 235, 0.6)`;

  // Badge for unread messages
  const badge = document.createElement('span');
  badge.className = 'agent-plugin-sdk-badge hidden';
  avatarContainer.appendChild(badge);

  // 组装：先 label 再 avatar，用 CSS order 控制视觉顺序
  container.appendChild(avatarContainer);
  container.appendChild(labelContainer);

  // Click handler
  container.addEventListener('click', onClick);

  // Keyboard accessibility
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  });

  function setOpen(_isOpen: boolean): void {
    // 不切换样式，始终保持头像+标题
  }

  function setBadge(count: number): void {
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  return { element: container, setOpen, setBadge };
}