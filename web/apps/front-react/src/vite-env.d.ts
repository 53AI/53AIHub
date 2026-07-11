/// <reference types="vite/client" />

// Declare virtual module for vite-plugin-svg-icons
declare module 'virtual:svg-icons-register' {
  const content: string
  export default content
}

interface ImportMetaEnv {
  readonly VITE_PLATFORM: string
  readonly VITE_INCLUDE_KM: string
  readonly VITE_PRIVATE_PREM: string
  readonly VITE_BASE_PATH: string
  readonly VITE_GLOB_AUTH_KEY: string
  readonly VITE_GLOB_SUITEID: string
  readonly VITE_GLOB_OFFICIALID: string
  readonly VITE_GLOB_API_HOST: string
  readonly VITE_GLOB_ADMIN_URL: string
  readonly VITE_GLOB_KKFILEVIEW_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
