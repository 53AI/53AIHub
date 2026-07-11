import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'

/**
 * Vitest 配置文件
 * 用于 console-react 项目的单元测试和集成测试
 */
export default defineConfig({
  plugins: [react()],
  css: {
    // 在测试中禁用 PostCSS 处理，避免 tailwindcss 依赖问题
    postcss: false,
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache', 'e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/coverage/**',
        'src/test-utils/**',
        'src/__mocks__/**',
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@km/hub-ui-x-react': resolve(__dirname, '../../packages/hub-ui-x-react/packages'),
      '@km/shared-business': resolve(__dirname, '../../packages/shared-business/src'),
      '@km/shared-components-react': resolve(__dirname, '../../packages/shared-components-react/src'),
      '@km/shared-utils': resolve(__dirname, '../../packages/shared-utils/src'),
    },
  },
})
