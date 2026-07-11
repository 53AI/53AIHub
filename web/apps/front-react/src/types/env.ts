/// <reference types="vite/client" />

// 多语言 CSV 源文件（?raw 导入为字符串）
declare module '*.csv?raw' {
  const src: string
  export default src
}

export {}
