import loadLib from '@/utils/loadLib'

// 声明全局 Vditor 类型
declare global {
  interface Window {
    Vditor: any
  }
}

// Vditor 选项类型
interface IVditorOptions {
  mode?: string
  hljs?: {
    lineNumber?: boolean
    style?: string
  }
  math?: {
    engine?: 'KaTeX' | 'MathJax'
    inlineDigit?: boolean
    macros?: Record<string, any>
  }
  markdown?: {
    toc?: boolean
    mark?: boolean
    footnotes?: boolean
    autoSpace?: boolean
  }
  cdn?: string
  anchor?: number
  after?: () => void
  [key: string]: any
}

/**
 * 创建 Markdown 编辑器实例
 * @param element 目标 DOM 元素
 * @returns Vditor 实例
 */
export const markdownEditor = async (element: HTMLDivElement | null) => {
  await loadLib('vditor')
  if (!element) element = document.createElement('div')

  return new window.Vditor(element, {
    preview: {
      math: {
        engine: 'MathJax',
        inlineDigit: true,
      },
    },
    cache: {
      enable: false
    },
    cdn: window.$getPublicPath('/js/vditor')
  })
}

/**
 * 渲染 Markdown 预览
 * @param element 目标 DOM 元素
 * @param content Markdown 内容
 * @param options Vditor 预览选项
 * @returns Promise，在渲染完成后 resolve
 */
export const markdownPreview = (
  element: HTMLDivElement | null,
  content = '',
  options: Partial<IVditorOptions> = {}
): Promise<void> => {
  return new Promise(async (resolve) => {
    await loadLib('vditor')
    if (!element) element = document.createElement('div')

    const originalAfter = options.after

    window.Vditor.preview(element, content, {
      mode: 'light',
      hljs: {
        lineNumber: true,
        style: 'github'
      },
      math: {
        engine: 'MathJax',
        inlineDigit: true,
        macros: {}
      },
      markdown: {
        toc: false,
        mark: true,
        footnotes: true,
        autoSpace: true
      },
      cdn: window.$getPublicPath('/js/vditor'),
      ...options,
      after: () => {
        originalAfter?.()
        resolve()
      }
    })
  })
}
