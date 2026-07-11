import { lib_host } from './config'

type LibItem = {
  id: string
  src: string
  callback: () => void
  _promise?: Promise<void>
}

const libs: Record<string, LibItem> = {
  vditor: {
    id: 'vditor-lib',
    src: `${lib_host}/js/vditor/dist/index.min.js`,
    callback() {
      const css = document.createElement('link')
      css.rel = 'stylesheet'
      css.href = `${lib_host}/js/vditor/dist/index.css`
      document.head.appendChild(css)
    },
  },
  ueditor: {
    id: 'ueditor-lib',
    src: `${lib_host}/js/UEditor/ueditor.all.min.js`,
    callback() {
      const script = document.createElement('script')
      script.src = `${lib_host}/js/UEditor/ueditor.config.js`
      script.id = 'ueditor-config'
      document.head.appendChild(script)
    },
  },
  highlighter: {
    id: 'highlighter-lib',
    src: `${lib_host}/js/text-highlighter/dist/index.min.js`,
    callback() {
      // TextHighlighter initialization callback if needed
    },
  },
} as const

export type LibName = keyof typeof libs

export const LIB_NAME = Object.keys(libs) as LibName[]

export default function loadLib(name: LibName): Promise<void> {
  if (!libs[name]) return Promise.reject(new Error(`Library ${name} not found`))

  if (!libs[name]._promise) {
    libs[name]._promise = new Promise<void>((resolve, reject) => {
      const { src, id, callback } = libs[name]
      const script = document.createElement('script')
      script.src = src
      script.id = id
      if (src.endsWith('.mjs')) script.type = 'module'
      script.onload = () => {
        if (callback) callback()
        setTimeout(() => resolve(), 100)
      }
      script.onerror = () => reject(new Error(`Failed to load library ${name}`))
      document.body.appendChild(script)
    })
  }
  return libs[name]._promise!
}
