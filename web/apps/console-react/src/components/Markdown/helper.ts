import loadLib from '@/utils/loadLib'
import { lib_host } from '@/utils/config'

declare global {
  interface Window {
    Vditor: any
  }
}

// Vditor options type
interface IVditorOptions {
  mode?: string
  hljs?: {
    lineNumber?: boolean
    style?: string
  }
  math?: {
    inlineDigit?: boolean
    macros?: Record<string, any>
  }
  cdn?: string
  [key: string]: any
}

/**
 * Initialize markdown editor with Vditor
 */
export const markdownEditor = async (element: HTMLDivElement | null): Promise<any> => {
  await loadLib('vditor')
  if (!element) element = document.createElement('div')

  if (!window.Vditor) {
    console.error('Vditor not loaded')
    return null
  }

  return new window.Vditor(element, {
    preview: {},
    cache: {
      enable: false,
    },
    cdn: `${lib_host}/js/vditor`,
  })
}

/**
 * Render markdown preview with Vditor
 */
export const markdownPreview = async (
  element: HTMLDivElement | null,
  content = '',
  options: Partial<IVditorOptions> = {},
): Promise<void> => {
  await loadLib('vditor')
  if (!element) element = document.createElement('div')

  if (!window.Vditor) {
    console.error('Vditor not loaded')
    // Fallback: render as plain text
    element.innerHTML = `<pre style="white-space: pre-wrap;">${content}</pre>`
    return
  }

  window.Vditor.preview(element, content, {
    mode: 'light',
    hljs: {
      lineNumber: true,
      style: 'github',
    },
    math: {
      inlineDigit: true,
      macros: {},
    },
    cdn: `${lib_host}/js/vditor`,
    ...options,
  })
}

/**
 * Parse markdown to HTML
 */
export const markdownToHtml = async (content: string): Promise<string> => {
  await loadLib('vditor')

  if (!window.Vditor) {
    return content
  }

  const div = document.createElement('div')
  await markdownPreview(div, content)
  return div.innerHTML
}

export default {
  markdownEditor,
  markdownPreview,
  markdownToHtml,
}