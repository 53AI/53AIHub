/**
 * DOM manipulation utilities for SDK
 */

/**
 * Create an HTML element with optional styles and attributes
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: {
    className?: string;
    style?: Partial<CSSStyleDeclaration>;
    attributes?: Record<string, string>;
    innerHTML?: string;
    textContent?: string;
  }
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);

  if (options?.className) {
    element.className = options.className;
  }

  if (options?.style) {
    Object.assign(element.style, options.style);
  }

  if (options?.attributes) {
    for (const [key, value] of Object.entries(options.attributes)) {
      element.setAttribute(key, value);
    }
  }

  if (options?.innerHTML) {
    element.innerHTML = options.innerHTML;
  }

  if (options?.textContent) {
    element.textContent = options.textContent;
  }

  return element;
}

/**
 * Apply styles to an element
 */
export function applyStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, styles);
}

/**
 * Create a container element with Shadow DOM
 */
export function createShadowContainer(id: string): { container: HTMLDivElement; shadowRoot: ShadowRoot } {
  const container = createElement('div', {
    attributes: { id },
  });
  const shadowRoot = container.attachShadow({ mode: 'open' });
  return { container, shadowRoot };
}

/**
 * Inject CSS styles into Shadow DOM
 */
export function injectStyles(shadowRoot: ShadowRoot, css: string): void {
  const style = document.createElement('style');
  style.textContent = css;
  shadowRoot.appendChild(style);
}

/**
 * Parse URL and append query params
 */
export function buildUrl(baseUrl: string, params: Record<string, string | number | boolean>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * LocalStorage helpers for state persistence
 */
const STORAGE_KEY_PREFIX = 'agent-plugin-sdk-';

export function saveToStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage might be unavailable or quota exceeded
  }
}

export function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_PREFIX + key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function removeFromStorage(key: string): void {
  try {
    localStorage.removeItem(STORAGE_KEY_PREFIX + key);
  } catch {
    // Storage might be unavailable
  }
}
