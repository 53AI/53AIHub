/**
 * Playwright E2E 测试配置
 */
import { defineConfig, devices } from '@playwright/test'

// 前端应用地址
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:8003/console'

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
  // 不自动启动服务器，使用已运行的服务器
  // webServer: {
  //   command: 'pnpm dev',
  //   url: 'http://localhost:8004/console',
  //   reuseExistingServer: true,
  //   timeout: 120 * 1000,
  // },
})
