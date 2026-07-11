import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    createSvgIconsPlugin({
      iconDirs: [path.resolve(process.cwd(), '..', '..', 'packages', 'shared-public', 'icons')],
      symbolId: 'icon-[name]'
    }),
  ],
  base: '/agentplugin',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@km/hub-ui-x-react': path.resolve(process.cwd(), '..', '..', 'packages', 'hub-ui-x-react', 'packages'),
      '@km/shared-business': path.resolve(process.cwd(), '..', '..', 'packages', 'shared-business', 'src'),
      '@km/shared-components-react': path.resolve(process.cwd(), '..', '..', 'packages', 'shared-components-react', 'src'),
      '@km/shared-utils': path.resolve(process.cwd(), '..', '..', 'packages', 'shared-utils', 'src'),
    },
    dedupe: ['react', 'react-dom']
  },
  server: {
    host: '0.0.0.0',
    port: 3001,
    allowedHosts: ['wescrm.kmtest.53ai.com']
  }
})
