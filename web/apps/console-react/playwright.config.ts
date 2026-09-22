/**
 * Playwright E2E 测试配置
 */
import { defineConfig, devices } from '@playwright/test'

// 前端应用地址。默认是 E2E 专用 mock 端口（webServer 会自动起 dev:mock）；
// 设 E2E_BASE_URL 则指向外部服务（如真实后端）。需含 /console-react base 路径。
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:8163/console-react/'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    headless: false,
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // 忽略 HTTPS 错误
    ignoreHTTPSErrors: true,
    // 设置超时
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // 限制浏览器内存
        launchOptions: {
          args: ['--max-old-space-size=4096'],
        },
      },
    },
  ],
  // 默认自动启动 mock 模式 dev server（VITE_MOCK=true，无需真实后端），端口 8163。
  // 显式给了 E2E_BASE_URL 时视为外部已提供服务，不再自起，避免双开。
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm dev:mock --port 8163 --strictPort',
        url: BASE_URL,
        timeout: 120 * 1000,
      },
})
