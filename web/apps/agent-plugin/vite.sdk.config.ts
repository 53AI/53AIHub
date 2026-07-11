import { defineConfig } from 'vite'
import path from 'path'

/**
 * Vite config for SDK build (IIFE format)
 * The SDK is a vanilla JS library that can be embedded in any webpage
 */
export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/sdk/index.ts'),
      name: 'AgentPluginSDK',
      fileName: () => 'agent-plugin-sdk.iife.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        // No external dependencies - bundle everything
        inlineDynamicImports: true,
        // Add banner with version info
        banner: `/*! Agent Plugin SDK v1.0.0 */`,
      },
    },
    // Generate sourcemap for debugging
    sourcemap: true,
    // Output directory
    outDir: 'dist-sdk',
    // Minify for production
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false, // Keep console for debugging
      },
    },
    // Don't empty the output directory
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})