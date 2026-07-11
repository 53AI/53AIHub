import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

const SHARED_PREFIXES = ['/images/', '/js/', '/UEditor/']
/** 构建时从 shared-public 拷贝到 outDir 的子目录（不包含 icons，icons 由 vite-plugin-svg-icons 打包） */
const BUILD_COPY_DIRS = ['images', 'js', 'UEditor']

function isSharedPath(urlPath: string): boolean {
  const normalized = urlPath.replace(/^\/+/, '/')
  return SHARED_PREFIXES.some((p) => normalized.startsWith(p))
}

function stripBase(urlPath: string, base: string): string {
  const b = base.endsWith('/') ? base : base + '/'
  if (b === '/') return urlPath.replace(/^\/+/, '/')
  if (urlPath.startsWith(b)) return '/' + urlPath.slice(b.length)
  return urlPath
}

export type MergePublicPluginOptions = {
  /** 共享 public 目录的绝对路径，如 packages/shared-public */
  sharedPublicPath: string
}

/**
 * Vite 插件：在开发与构建时合并「共享 public」到当前应用的 public。
 * - 开发：对 /images、/js、/UEditor 请求，先查应用 public，没有再从 sharedPublicPath 提供。
 * - 构建：在输出目录中合并拷贝 sharedPublicPath 内容，直接覆盖（减少存在检查以提升性能）。
 */
export function mergePublicPlugin(options: MergePublicPluginOptions): Plugin {
  const sharedPublicPath = path.resolve(options.sharedPublicPath)
  if (!fs.existsSync(sharedPublicPath)) {
    throw new Error(`[vite-plugin-merge-public] sharedPublicPath does not exist: ${sharedPublicPath}`)
  }

  return {
    name: 'vite-plugin-merge-public',
    apply: 'serve',
    configureServer(server) {
      const base = server.config.base ?? '/'
      const root = server.config.root ?? process.cwd()
      const publicDir = path.resolve(root, server.config.publicDir ?? 'public')

      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next()
        const urlPath = stripBase(req.url ?? '', base).split('?')[0]
        if (!isSharedPath(urlPath)) return next()

        const relativePath = urlPath.replace(/^\/+/, '')
        const appFile = path.join(publicDir, relativePath)
        try {
          if (fs.statSync(appFile).isFile()) return next()
        } catch {
          /* 应用 public 无此文件，继续用共享目录 */
        }

        const sharedFile = path.join(sharedPublicPath, relativePath)
        try {
          if (!fs.statSync(sharedFile).isFile()) return next()
        } catch {
          return next()
        }

        const stream = fs.createReadStream(sharedFile)
        const ext = path.extname(sharedFile).toLowerCase()
        const mime: Record<string, string> = {
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.html': 'text/html',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2',
        }
        const contentType = mime[ext] ?? 'application/octet-stream'
        res.setHeader('Content-Type', contentType)
        stream.pipe(res)
      })
    },
  }
}

/**
 * 构建阶段：将 sharedPublicPath 下指定子目录（images、js、UEditor）拷贝到 outDir，不拷贝 icons。
 * icons 由 vite-plugin-svg-icons 按需打包，无需复制到 public。
 */
export function mergePublicBuildPlugin(options: MergePublicPluginOptions): Plugin {
  const sharedPublicPath = path.resolve(options.sharedPublicPath)
  if (!fs.existsSync(sharedPublicPath)) {
    throw new Error(`[vite-plugin-merge-public] sharedPublicPath does not exist: ${sharedPublicPath}`)
  }

  let outPath: string | undefined
  return {
    name: 'vite-plugin-merge-public-build',
    apply: 'build',
    configResolved(config) {
      outPath = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      if (!outPath) return
      for (const dir of BUILD_COPY_DIRS) {
        const src = path.join(sharedPublicPath, dir)
        if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
          fs.cpSync(src, path.join(outPath!, dir), { recursive: true, force: true })
        }
      }
    },
  }
}

/** 同时启用 dev 与 build 的合并逻辑 */
export function mergePublic(options: MergePublicPluginOptions): Plugin[] {
  return [mergePublicPlugin(options), mergePublicBuildPlugin(options)]
}
