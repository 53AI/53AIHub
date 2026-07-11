import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'agent-create/index': 'src/agent-create/index.ts',
    'chat/index': 'src/chat/index.ts',
    'auth/index': 'src/auth/index.ts',
    'knowledge-pipeline/index': 'src/knowledge-pipeline/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom', 'react-router-dom', 'antd', '@ant-design/icons', 'zustand', 'i18next', 'react-i18next', '@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
  treeshake: true,
})
