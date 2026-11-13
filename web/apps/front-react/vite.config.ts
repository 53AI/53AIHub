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
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isOpLocal = env.VITE_PLATFORM === 'op-local'
  const isPrivatePrem = env.VITE_PRIVATE_PREM === 'true'
  // 桌面端（Tauri 壳 apps/desktop）已删除；hash 路由仅剩 op-local/私有化
  // （53ai-desktop Electron 壳是独立仓库，加载 web 部署产物，无需本仓适配）
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
      // 模板入口 history 路由开发态回退：/client.html/agent → /client.html
      // （生产环境由 nginx try_files 回退到对应入口页）
      {
        name: 'template-entry-history-fallback',
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            const match = req.url?.match(/^\/(website|client|erhao)\.html\//)
            if (match) req.url = `/${match[1]}.html`
            // 裸入口路径（/erhao、/client、/website）会被 Vite 的 html 回退补 .html
            // 后缀命中入口文件，入口以 basename 启动后与实际路径不匹配 → 整页白屏。
            // 这些路径不是任何前端路由，与生产 nginx 的 SPA 回退一致改走主入口。
            const bare = req.url?.match(/^(\/(?:website|client|erhao))\/?($|\?.*)$/)
            if (bare) req.url = `/index.html${bare[2] ?? ''}`
            next()
          })
        },
      },
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
      allowedHosts: ['vevadob.kmtest.53ai.com','wescrm.kmtest.53ai.com', '352vtkg.kmtest.53ai.com', 'ct11fmn.kmtest.53ai.com', 'testkmdomain.kmtest.53ai.com']
    },
    build: {
      rollupOptions: {
       /* # 模板入口 history 路由回退：入口文件名后的任意路径回退到对应入口页
        location /website.html/ { try_files $uri /website.html; }
        location /client.html/    { try_files $uri /client.html; }
        location /erhao.html/    { try_files $uri /erhao.html; } */ 
        // MPA 多入口：index.html 为主入口（跟随企业配置），
        // 其余为固定导航布局的模板入口（见 src/constants/app-template.ts）。
        // 注意：入口文件名不能与主入口的前端路由同名（如 recording.html 会与
        // /recording 路由碰撞，服务器回退时导致路由失配白屏），故安心录入口
        // 用 erhao.html 而非 recording.html。
        input: {
          main: path.resolve(__dirname, 'index.html'),
          website: path.resolve(__dirname, 'website.html'),
          client: path.resolve(__dirname, 'client.html'),
          erhao: path.resolve(__dirname, 'erhao.html')
        },
        output: {
          // 注意：勿改函数式 manualChunks——对象式 ['antd'] 会把 antd 全部依赖
          // （rc-*/@ant-design/cssinjs/dayjs）归并进同 chunk；函数式按路径匹配会
          // 漏依赖 → chunk 间循环依赖 → 线上 TDZ（Cannot access before initialization，实测踩坑）
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
