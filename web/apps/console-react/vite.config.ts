import path from 'path'
import fs from 'fs'
import https from 'https'
import type { PluginOption } from 'vite'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons'
import AutoImport from 'unplugin-auto-import/vite'

import { mergePublic } from '../../packages/vite-plugins/merge-public'
import conditionalCompilation from '../../packages/vite-plugins/conditional-compilation'
import { vitePluginMock } from '../../packages/vite-plugin-mock/src/index'

// 读取 package.json 作为备用版本号
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf-8'))
const fallbackVersion = packageJson.version

// 从 API 接口获取版本号
async function getVersionFromAPI(): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = 'https://kmapirc.53ai.com/api/version'
    https
      .get(url, res => {
        let data = ''
        res.on('data', chunk => {
          data += chunk
        })
        res.on('end', () => {
          try {
            const response = JSON.parse(data)
            const version =
              response.version ||
              response.data?.version ||
              (typeof response === 'string' ? response : null)
            if (typeof version === 'string' && version.trim()) {
              resolve(version.trim())
            } else {
              reject(new Error('Invalid version format from API'))
            }
          } catch (error) {
            reject(error)
          }
        })
      })
      .on('error', error => {
        reject(error)
      })
  })
}

// 创建生成 version.txt 的插件
const versionPlugin = () => {
  return {
    name: 'version-txt',
    writeBundle: {
      sequential: true,
      order: 'post',
      handler: async (options: { dir?: string }) => {
        const outDir = options.dir || 'dist'
        try {
          const latestVersion = await getVersionFromAPI()
          fs.writeFileSync(path.join(outDir, 'version.txt'), latestVersion)
          console.log(`✓ 版本文件已写入: ${latestVersion}`)
        } catch (error: any) {
          fs.writeFileSync(path.join(outDir, 'version.txt'), fallbackVersion)
          console.warn(`⚠ 无法从 API 获取版本号，使用 package.json 版本: ${fallbackVersion}`, error.message)
        }
      },
    },
  }
}

function setupPlugins(env: ImportMetaEnv): PluginOption[] {
  const isMock = env.VITE_MOCK === 'true'
  return [
    conditionalCompilation({
      platform: env.VITE_PLATFORM,
      debug: true,
    }),
    react(),
    AutoImport({
      imports: [
        {
          '@km/shared-components-react': ['OverflowTooltip'],
        },
      ],
      dts: 'src/auto-imports.d.ts',
    }),
    createSvgIconsPlugin({
      iconDirs: [path.resolve(process.cwd(), '..', '..', 'packages', 'shared-public', 'icons')],
      symbolId: 'icon-[name]',
    }),
    versionPlugin(),
    ...mergePublic({
      sharedPublicPath: path.resolve(process.cwd(), '..', '..', 'packages', 'shared-public'),
    }),
    vitePluginMock({ enabled: isMock, verbose: true }),
  ]
}

export default defineConfig(env => {
  const viteEnv = loadEnv(env.mode, process.cwd()) as unknown as ImportMetaEnv
  return {
    base: viteEnv.VITE_BASE_PATH || '/console-react',
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), 'src'),
        '@km/hub-ui-x-react': path.resolve(process.cwd(), '..', '..', 'packages', 'hub-ui-x-react', 'packages'),
        '@km/shared-business': path.resolve(process.cwd(), '..', '..', 'packages', 'shared-business', 'src'),
        '@km/shared-components-react': path.resolve(process.cwd(), '..', '..', 'packages', 'shared-components-react', 'src'),
        '@km/shared-utils': path.resolve(process.cwd(), '..', '..', 'packages', 'shared-utils', 'src'),
      },
    },
    plugins: setupPlugins(viteEnv),
    server: {
      host: '0.0.0.0',
      port: 8003,
      open: false,
      allowedHosts: ['hubtest.53ai.com', 'hub.53ai.com', 'kmtest.53ai.com', 'km.53ai.com'],
    },
    build: {
      outDir: 'dist',
      reportCompressedSize: false,
      sourcemap: false,
      assetsDir: 'static/images/',
      rollupOptions: {
        output: {
          chunkFileNames: 'static/js/[name]-[hash].js',
          entryFileNames: 'static/js/[name]-[hash].js',
          assetFileNames: 'static/[ext]/[name]-[hash].[ext]',
        },
      },
    },
  }
})

