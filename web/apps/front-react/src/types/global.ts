// 全局类型声明

declare global {
  interface Window {
    $t: (key: string, ...args: unknown[]) => string
    $getPublicPath: (url?: string) => string
    agenthub: {
      dialog: (options: { title: string; label: string; content: string }) => Promise<{ content: string }>
    }
    admin_url: string
    $chat53ai?: any
    electron?: any
    $isElectron?: boolean
  }
}

export {}
