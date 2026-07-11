import { create } from 'zustand'
import { promptApi } from '@/api/modules/prompt'
import { groupApi } from '@/api/modules/group'
import { settingApi, DefaultLinkItem } from '@/api/modules/setting'
import { GROUP_TYPE } from '@/constants/group'
import { useEnterpriseStore } from '@/stores'
import { api_host } from '@/utils/config'
import { t } from '@/locales'

interface AILink {
  ai_link: DefaultLinkItem
  delete: boolean
}

interface CustomConfig {
  use_cases: UseCase[]
}

interface UseCase {
  id?: string
  type?: 'case' | 'scene'
  scene?: string
  image?: string
  desc?: string
  input_text?: string
  output_text?: string
}

interface PromptFormData {
  prompt_id: number
  group_ids: number[]
  name: string
  description: string
  logo: string
  content: string
  subscription_group_ids: number[]
  user_group_ids: number[]
  sort: number
  status: number
  custom_config: CustomConfig
  ai_links: AILink[]
  updated_time?: number
}

// 获取默认 logo
const getDefaultLogo = () => `${api_host}/api/images/prompt/logo.png`

const DEFAULT_FORM_DATA: PromptFormData = {
  prompt_id: 0,
  group_ids: [],
  name: '',
  description: '',
  logo: '',
  content: '',
  subscription_group_ids: [],
  user_group_ids: [],
  sort: 0,
  status: 1,
  custom_config: {
    use_cases: [],
  },
  ai_links: [],
  updated_time: 0
}

interface PromptStore {
  formData: PromptFormData
  detailData: Partial<PromptFormData>
  submitting: boolean
  loading: boolean
  reset: () => Promise<void>
  clear: () => void  // Synchronous clear for unmount
  set: (data: Partial<PromptFormData>) => void
  get: () => PromptFormData
  save: (options?: { prompt_id?: number; hideToast?: boolean; formValues?: Partial<PromptFormData> }) => Promise<any>
  fetchDetail: (options?: { prompt_id?: string | number }) => Promise<void>
  formatFormData: (data?: any) => void
  loadDefaultLinks: () => Promise<void>
}

export const usePromptFormDataStore = create<PromptStore>((set, get) => ({
  formData: { ...DEFAULT_FORM_DATA },
  detailData: {},
  submitting: false,
  loading: false,

  reset: async () => {
    // 防止重复请求
    if (get().loading) return Promise.resolve()
    set({ loading: true })

    // 立即设置默认数据，包含动态获取的 logo 和默认 name
    const defaultLogo = getDefaultLogo()
    set({
      formData: {
        ...DEFAULT_FORM_DATA,
        logo: defaultLogo,
        name: t('prompt.default_name'),
      },
      detailData: {},
    })

    const enterpriseStore = useEnterpriseStore.getState()
    let subscriptionGroupIds: number[] = []
    let userGroupIds: number[] = []
    let groupIds: number[] = []

    // 获取分组列表，默认选择第一个
    try {
      const promptGroups = await groupApi.list({ params: { group_type: GROUP_TYPE.PROMPT } })
      if (promptGroups && promptGroups.length > 0) {
        groupIds = [(promptGroups as any[])[0].group_id]
      }
    } catch (error) {
      console.error('Load prompt groups error:', error)
    }

    if (enterpriseStore.info.is_enterprise || enterpriseStore.info.is_industry) {
      const list = await groupApi.list({ params: { group_type: GROUP_TYPE.INTERNAL_USER } })
      userGroupIds = list.map((item: any) => item.group_id)
    }
    if (enterpriseStore.info.is_independent || enterpriseStore.info.is_industry) {
      const list = await groupApi.list({ params: { group_type: GROUP_TYPE.USER } })
      subscriptionGroupIds = list.map((item: any) => item.group_id)
    }

    // 更新分组数据
    set({
      formData: {
        ...DEFAULT_FORM_DATA,
        logo: defaultLogo,
        name: t('prompt.default_name'),
        group_ids: groupIds,
        subscription_group_ids: subscriptionGroupIds,
        user_group_ids: userGroupIds,
      },
      loading: false,
    })
  },

  clear: () => {
    set({
      formData: { ...DEFAULT_FORM_DATA },
      detailData: {},
    })
  },

  set: (data) => {
    set((state) => ({
      formData: { ...state.formData, ...data },
    }))
  },

  get: () => get().formData,

  save: async (options = {}) => {
    const { prompt_id, hideToast = false } = options
    const state = get()
    const data = {
      ...state.formData,
      prompt_id: prompt_id || state.formData.prompt_id || state.detailData.prompt_id || 0,
      // Allow override with form values
      ...(options.formValues || {}),
    }
    set({ submitting: true })
    try {
      const res = await promptApi.save(data as any)
      if (!hideToast) {
        // Message handled by caller
      }
      return res
    } finally {
      set({ submitting: false })
    }
  },

  fetchDetail: async (options = {}) => {
    let prompt_id = options.prompt_id || get().formData.prompt_id
    if (!prompt_id) return

    set({ loading: true })
    try {
      const [data, promptGroups, userGroups, internalUserGroups] = await Promise.all([
        promptApi.detail({ prompt_id: Number(prompt_id) }),
        groupApi.list({ params: { group_type: GROUP_TYPE.PROMPT } }).catch(() => []),
        groupApi.list({ params: { group_type: GROUP_TYPE.USER } }).catch(() => []),
        groupApi.list({ params: { group_type: GROUP_TYPE.INTERNAL_USER } }).catch(() => []),
      ])

      // Parse custom_config
      try {
        data.custom_config = JSON.parse(data.custom_config)
      } catch {
        data.custom_config = {}
      }

      // Parse ai_links
      try {
        data.ai_links = JSON.parse(data.ai_links).map((item: any) => ({
          ai_link: { ...item },
          delete: false,
        }))
      } catch {
        data.ai_links = []
      }

      if (!data.custom_config) data.custom_config = {}
      if (!data.custom_config.use_cases) data.custom_config.use_cases = []

      // Filter group IDs
      const allGroupIds = data.group_ids || []
      data.group_ids = allGroupIds.filter((id: number) =>
        (promptGroups as any[]).some((g: any) => g.group_id === id)
      )
      data.subscription_group_ids = allGroupIds.filter((id: number) =>
        (userGroups as any[]).some((g: any) => g.group_id === id)
      )
      data.user_group_ids = allGroupIds.filter((id: number) =>
        (internalUserGroups as any[]).some((g: any) => g.group_id === id)
      )
      data.logo = data.logo || getDefaultLogo()
      set({ detailData: data })
      get().formatFormData(data)
    } finally {
      set({ loading: false })
    }
  },

  formatFormData: (data) => {
    data = data || get().detailData || {}
    get().set({
      prompt_id: data.prompt_id || 0,
      group_ids: data.group_ids || [],
      name: data.name || '',
      description: data.description || '',
      logo: data.logo || getDefaultLogo(),
      content: data.content || '',
      subscription_group_ids: data.subscription_group_ids || [],
      user_group_ids: data.user_group_ids || [],
      sort: data.sort || 0,
      status: data.status,
      custom_config: data.custom_config,
      ai_links: data.ai_links,
      updated_time: data.updated_time
    })
  },

  loadDefaultLinks: async () => {
    try {
      const { data } = (await settingApi.default_links.list()) as any
      get().set({
        ai_links: (data || []).map((item: DefaultLinkItem) => ({
          ai_link: { ...item },
          delete: false,
        })),
      })
    } catch (error) {
      console.error('Load default links error:', error)
    }
  },
}))

export default usePromptFormDataStore