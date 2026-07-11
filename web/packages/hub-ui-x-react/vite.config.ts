import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: '0.0.0.0',
  },
  build: {
    lib: {
      entry: './packages/index.ts',
      name: 'HubUiX',
      fileName: (format) => `hub-ui-x.${format}.ts`,
      formats: ['umd']
    },
    rollupOptions: {
      external: ['react', 'react-dom'],
      output: {
        exports: 'named',
        inlineDynamicImports: true,
        manualChunks: undefined,
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM'
        }
      }
    }
  }
})
