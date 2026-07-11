import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons'
import AutoImport from 'unplugin-auto-import/vite'
import path from 'path'
import fs from 'fs'
import https from 'https'

import { mergePublic } from '../../packages/vite-plugins/merge-public'
import { vitePluginMock } from '../../packages/vite-plugin-mock/src/index'

// 从 API 接口获取版本号
async function getVersionFromAPI(): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = 'https://kmapirc.53ai.com/api/version'

    https.get(url, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        try {
          const response = JSON.parse(data)
          // 假设 API 返回格式为 { version: 'x.x.x' } 或 { data: { version: 'x.x.x' } } 或直接返回版本号字符串
          const version = response.version || response.data?.version || (typeof response === 'string' ? response : null)
          if (typeof version === 'string' && version.trim()) {
            resolve(version.trim())
          } else {
            reject(new Error('Invalid version format from API'))
          }
        } catch (error) {
          reject(error)
        }
      })
    }).on('error', (error) => {
      reject(error)
    })
  })
}

// 读取 package.json 作为备用版本号
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf-8'))
const fallbackVersion = packageJson.version

// 创建生成 version.txt 的插件（仅在 build 时执行）
const versionPlugin = () => {
  return {
    name: 'version-txt',
    writeBundle: {
      sequential: true,
      order: 'post',
      handler: async (options: any) => {
        const outDir = options.dir || 'dist'
        // 仅在 build 时从 API 获取版本号
        try {
          const latestVersion = await getVersionFromAPI()
          fs.writeFileSync(path.join(outDir, 'version.txt'), latestVersion)
          console.log(`✓ 版本文件已写入: ${latestVersion}`)
        } catch (error: any) {
          // 如果获取失败，使用 package.json 中的版本号
          fs.writeFileSync(path.join(outDir, 'version.txt'), fallbackVersion)
          console.warn(`⚠ 无法从 API 获取版本号，使用 package.json 版本: ${fallbackVersion}`, error.message)
        }
      }
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isOpLocal = env.VITE_PLATFORM === 'op-local'
  const isPrivatePrem = env.VITE_PRIVATE_PREM === 'true'
  const useHashRouter = isOpLocal || isPrivatePrem
  const devServerPort = Number(env.VITE_PORT) || 80

  const isMock = env.VITE_MOCK === 'true'

  return {
    base: useHashRouter ? './' : '/',
    plugins: [
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
        symbolId: 'icon-[name]'
      }),
      versionPlugin(),
      ...mergePublic({
        sharedPublicPath: path.resolve(process.cwd(), '..', '..', 'packages', 'shared-public'),
      }),
      vitePluginMock({ enabled: isMock, verbose: true }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@km/hub-ui-x-react': path.resolve(process.cwd(), '..', '..', 'packages', 'hub-ui-x-react', 'packages'),
        '@km/shared-business': path.resolve(process.cwd(), '..', '..', 'packages', 'shared-business', 'src'),
        '@km/shared-components-react': path.resolve(process.cwd(), '..', '..', 'packages', 'shared-components-react', 'src'),
        '@km/shared-utils': path.resolve(process.cwd(), '..', '..', 'packages', 'shared-utils', 'src'),
      },
      dedupe: ['react', 'react-dom', 'react-router-dom']
    },
    server: {
      host: '0.0.0.0',
      port: devServerPort,
      allowedHosts: ['vevadob.kmtest.53ai.com','wescrm.kmtest.53ai.com', '352vtkg.kmtest.53ai.com', 'ct11fmn.kmtest.53ai.com']
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-antd': ['antd'],
            'vendor-i18n': ['i18next', 'react-i18next']
          }
        }
      }
    }
  }
})
