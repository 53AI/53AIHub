// Global type declarations

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

// Navigation types
declare namespace Navigation {
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
    is_system?: boolean
    [key: string]: any
  }
}

// Conversation types
declare namespace Conversation {
  interface Info {
    conversation_id: number | string
    title: string
    created_time: number
    updated_time: number
    created_at?: string
    updated_at?: string
    top: number
    is_valid: number
    virtual_id?: string
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

  interface Sender {
    conversation_id: number | string | null
    model: string
    messages: Array<{ content: string; role: string }>
    stream?: boolean
    enable_process_steps?: boolean
    frequency_penalty?: number
    temperature?: number
    top_p?: number
    presence_penalty?: number
    knowledge_base_ids?: number[]
    file_ids?: number[]
    space_ids?: number[]
    message_file_id?: number
    solo_file_mode?: boolean
    search_config?: Record<string, any>
    web_search_config?: Record<string, any>
    [key: string]: any
  }

  interface Message {
    id: string | number
    question?: string
    query?: string
    answer: string
    loading?: boolean
    agent_id?: string
    conversation_id?: number
    reasoning_content?: string
    reasoning_expanded?: boolean
    specified_files?: any[]
    specified_content?: string
    user_files?: UserFile[]
    parsed_message?: any[]
    rag_stats?: any
    rag_search_text?: string
    rag_temp?: { type: string; document_search?: any; document_quotations?: any; file_quotations?: any }
    skillRunItems?: any[]
    error?: boolean
    [key: string]: any
  }

  interface NextAgentPrepare {
    agent_id?: string
    file_id?: string
    library_id?: string
    execution_rule?: string
    is_workflow?: boolean
    parameters?: Record<string, any>
    [key: string]: any
  }
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

// This file contains global type declarations
// No exports needed for global declarations
