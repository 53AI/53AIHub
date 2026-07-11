const createScript = (data: { src: string, id: string }) => {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = data.src
    script.id = data.id
    if (data.src.endsWith('.mjs')) script.type = 'module'
    script.onload = () => {
      setTimeout(() => {
        resolve()
      }, 100)
    }
    script.onerror = reject
    document.body.appendChild(script)
  })
}

const createStyle = (data: { src: string, id: string }) => {
  return new Promise((resolve, reject) => {
    const style = document.createElement('link')
    style.rel = 'stylesheet'
    style.href = data.src
    style.id = data.id
    style.onload = () => {
      setTimeout(() => {
        resolve()
      }, 100)
    }
    style.onerror = reject
    document.head.appendChild(style)
  })
}

interface LibConfig {
  id: string
  src: string
  callback?: () => void
  preload?: () => Promise<any>
  _promise?: Promise<void>
}

/**
 * 第三方库配置对象 - 预定义的第三方库加载配置
 *
 * 支持的库：
 * - vditor: Markdown编辑器
 * - epub: EPUB阅读器
 * - weboffice: Web Office
 * - g6: AntV G6 图可视化
 * - highlighter: 代码高亮
 */
const libs: Record<string, LibConfig> = {
  /**
   * Vditor Markdown编辑器配置
   */
  vditor: {
    id: 'vditor-lib',
    src: window.$getPublicPath?.(`/js/vditor/dist/index.min.js`) || '/js/vditor/dist/index.min.js',
    callback() {
      createStyle({
        id: 'vditor-css',
        src: window.$getPublicPath?.(`/js/vditor/dist/index.css`) || '/js/vditor/dist/index.css',
      })
    }
  },
  /**
   * EPUB阅读器配置
   */
  epub: {
    id: 'epub-lib',
    src: window.$getPublicPath?.(`/js/epub/epub.min.js`) || '/js/epub/epub.min.js',
    preload() {
      return Promise.all([
        createScript({
          id: 'epub-jszip',
          src: window.$getPublicPath?.(`/js/epub/jszip.min.js`) || '/js/epub/jszip.min.js',
        }),
        createScript({
          id: 'epub-localforage',
          src: window.$getPublicPath?.(`/js/epub/localforage.min.js`) || '/js/epub/localforage.min.js',
        }),
        createScript({
          id: 'epub-marked',
          src: window.$getPublicPath?.(`/js/epub/marked.min.js`) || '/js/epub/marked.min.js',
        })
      ])
    },
    callback() {
      // EPUB库加载完成后的回调
    }
  },
  /**
   * Web Office 配置
   */
  weboffice: {
    id: 'weboffice-lib',
    src: window.$getPublicPath?.(`/js/weboffice/web-office-sdk-solution-v2.0.7.umd.js`) || '/js/weboffice/web-office-sdk-solution-v2.0.7.umd.js',
  },
  /**
   * AntV G6 图可视化配置
   */
  g6: {
    id: 'g6-lib',
    src: window.$getPublicPath?.(`/js/antv/g6.min.js`) || '/js/antv/g6.min.js',
  },
  /**
   * 代码高亮配置
   */
  highlighter: {
    id: 'highlighter-lib',
    src: window.$getPublicPath?.(`/js/highlighter/index.js`) || '/js/highlighter/index.js',
    preload() {
      return Promise.all([
        createStyle({
          id: 'highlighter-css',
          src: window.$getPublicPath?.(`/js/highlighter/index.css`) || '/js/highlighter/index.css',
        })
      ])
    }
  }
} as const

type LibName = keyof typeof libs

/**
 * 动态加载第三方库 - 按需加载预配置的第三方JavaScript库
 *
 * 该函数具有以下特性：
 * - 防重复加载：同一个库只会加载一次
 * - Promise缓存：多次调用返回同一个Promise
 * - 自动回调：加载完成后自动执行配置的回调函数
 * - 模块支持：自动识别.mjs文件并设置正确的type属性
 * - 错误处理：加载失败时Promise会被reject
 *
 * @param name - 要加载的库名称，必须是预定义的库名
 * @returns Promise<void> - 加载完成的Promise
 */
const loadLib = (name: LibName): Promise<void> => {
  if (!libs[name]) return Promise.reject(new Error(`Library ${name} not found`))

  if (!libs[name]._promise) {
    libs[name]._promise = new Promise((resolve, reject) => {
      const { src, id, callback, preload } = libs[name]
      Promise.all([
        preload?.(),
        createScript({ src, id })
          .then(() => {
            callback && callback()
            resolve()
          }, reject)
      ])
    })
  }

  return libs[name]._promise!
}

export default loadLib
export type { LibName }
