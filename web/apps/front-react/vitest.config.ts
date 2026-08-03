import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      '../../packages/shared-business/src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      '../../packages/hub-ui-x-react/packages/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/components/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.{ts,tsx}']
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@km/hub-ui-x-react': path.resolve(__dirname, '../../packages/hub-ui-x-react/packages'),
      '@km/shared-business/chat': path.resolve(__dirname, '../../packages/shared-business/src/chat/index.ts'),
      '@km/shared-business': path.resolve(__dirname, '../../packages/shared-business/src'),
      '@km/shared-components-react': path.resolve(__dirname, '../../packages/shared-components-react/src'),
      '@km/shared-utils': path.resolve(__dirname, '../../packages/shared-utils/src'),
    }
  }
})
