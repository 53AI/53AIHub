// Global type declarations for the React app

// Navigation types
declare namespace Navigation {
  interface Content {
    html_content?: string
    [key: string]: any
  }

  interface State {
    navigation_id: string | number
    name: string
    icon: string
    jump_path: string
    menu_path: string
    url: string
    type: number
    target: number
    status: number
    sort: number
    config: any
    content?: Content
  }
}

// Enterprise types
declare namespace Enterprise {
  interface State {
    id: number
    type: string
    banner: string
    timezone: string
    domain: string
    slogan: string
    status: number
    template_type: string
    layout_type: string
    created_time: number
    updated_time: number
    logo: string
    ico: string
    display_name: string
    language: string
    copyright: string
    keywords: string[]
    description: string
    banner_info: {
      url_list: string[]
      interval: string
    }
    template_style_info: {
      style_type: 'website' | 'software'
      theme_color?: string
      text_color?: string
      nav_bg_color?: string
      nav_text_color?: string
      page_footer_bg_color?: string
      page_footer_text_color?: string
    }
    is_independent: boolean
    is_enterprise: boolean
    is_industry: boolean
    is_install_wecom: boolean
    version: number
    features: Record<string, { max: number }>
  }
}

// Subscription types
declare namespace Subscription {
  interface State {
    group_id: number
    group_name: string
    logo_url: string
    is_default: boolean
  }
}

// User types
declare namespace User {
  interface LoginForm {
    username: string
    password: string
  }

  interface SmsLoginForm {
    mobile: string
    verify_code: string
  }

  interface BindWechatForm {
    mobile: string
    verify_code: string
    openid?: string
    unionid?: string
    nickname?: string
  }

  interface RegisterForm {
    username: string
    password: string
    verify_code?: string
    nickname?: string
  }

  interface ResetPasswordForm {
    password?: string
    verify_code: string
    new_password?: string
    confirm_password?: string
    email?: string
    mobile?: string
  }

  interface ChangeMobileForm {
    mobile: string
    verify_code: string
  }
}

// Agent types
declare namespace Agent {
  interface State {
    agent_id: string
    name: string
    logo: string
    description?: string
    configs?: string
    custom_config?: string
    custom_config_obj?: Record<string, any>
    settings?: string
    settings_obj?: Record<string, any>
    agent_usage?: number
    [key: string]: any
  }
}

// Conversation types
declare namespace Conversation {
  interface Info {
    agent_id: string
    conversation_id: string
    created_time: number
    deleted_time: number
    eid: number
    last_message: string
    quota: number
    status: number
    title: string
    total_tokens: number
    updated_time: number
    user_id: number
    // 针对于虚拟会话
    virtual_id: string
    created_at: string
    updated_at: string
    top: number
    is_valid: number
    agent?: Agent.State
    [key: string]: any
  }

  interface UserFile {
    type: 'image'
    content: string
    filename: string
    size: number
    mime_type: string
    url: string
  }

  interface Message {
    agent_id: string
    answer: string
    channel: number
    completion_tokens: number
    conversation_id: string
    created_time: number
    eid: number
    elapsed_time: number
    id: number
    is_stream: true
    message: string
    model_name: string
    prompt_tokens: number
    quota: number
    quota_content: string
    request_id: string
    total_tokens: number
    updated_time: number
    user_id: number
    query: string
    loading?: boolean
    user_files: UserFile[]
    reasoning_content?: string
    reasoning_expanded?: boolean
  }

  interface Sender {
    conversation_id: string
    frequency_penalty: number
    messages: {
      content: string
      role: 'user' | 'assistant'
    }[]
    model: string
    presence_penalty: number
    stream: boolean
    temperature: number
    top_p: number
  }

  interface NextAgentPrepare {
    agent_id: string
    is_workflow: boolean
    execution_rule: 'auto' | 'manual'
    parameters: Record<string, any>
    file_id?: string
    library_id?: string
    [key: string]: any
  }
}

// Library types
declare namespace Library {
  /**
   * 文件类型枚举
   */
  enum FileType {
    /** 文件夹类型 */
    Folder = 0,
    /** 文件类型 */
    File = 1,
  }

  /**
   * 文件接口定义
   */
  interface File {
    id: never
    sort: number
    path: string
    name: string
    extension: string
    isfolder: boolean
    isfile: boolean
    type: FileType.File | FileType.Folder
    base_path: string
    base_path_hash: string
    created_time: number
    updated_time: number
    updated_at: string
    created_at: string
  }

  /**
   * 格式化后的文件接口
   */
  interface FormattedFile {
    id: string
    name: string
    icon: string
    isfolder: boolean
    isfile: boolean
    base_path: string
    extension: string
    created_at: string
    updated_at: string
    library_id: string
    path: string
    sort: number
    type: number
    file_mime: string
    file_url: string
    is_favorite: boolean
    permission: number
    last_body_time: string
    parse_type: string
    parsing_status: number
    cleaning_info?: RunInfo
    [key: string]: any
  }

  /**
   * 格式化后的图书馆接口
   */
  interface FormattedLibrary {
    id: string
    name: string
    icon: string
    description: string
    visibility: number
    created_time: number
    updated_time: number
    updated_at: string
    updated_date: string
    is_favorite: boolean
    space_id: string
    permission: number
    recent: Array<{
      id: number
      name: string
      icon: string
      description: string
    }>
    [key: string]: any
  }
}

// Run status type
type RunStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

interface RunInfo {
  status: RunStatus
  progress?: number
  error?: string
  started_at?: number
  completed_at?: number
}

// Category types
declare namespace Category {
  interface State {
    group_id: number
    group_name: string
    [key: string]: any
  }
}

// Raw User Info from API
interface RawUserInfo {
  access_token: string
  user_id: string
  eid: string | number
  openid?: string
  username: string
  nickname: string
  avatar: string
  email: string
  role: number
  mobile: string
  group_id: number
  group_ids: number[]
  group_name: string
  group_icon: string
  group_expire_day: number
  group_isexpired: boolean
  group_expire_time: string
  is_internal: boolean
  [key: string]: any
}

// Window extensions
interface Window {
  $t: (key: string, options?: any) => string
  $vars: {
    includeKm: boolean
    isOpLocalEnv: boolean
    isPrivatePremEnv: boolean
  }
  $getPublicPath: (path: string) => string
  $chat53ai?: {
    $win: (data: any) => void
  }
  electron?: boolean
  isWorkEnv?: boolean
  isDevEnv?: boolean
  isRcEnv?: boolean
}

// Re-export from individual type files
export * from './agent'
export * from './conversation'
export * from './enterprise'
export * from './library'
export * from './prompt'
export * from './user'
export * from './entity'

export {
  Navigation,
  Enterprise,
  Subscription,
  User,
  Agent,
  Conversation,
  Category,
  Library,
  RawUserInfo,
  RunStatus,
  RunInfo
}
