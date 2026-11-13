import { create } from 'zustand'
import enterpriseApi from '@/api/modules/enterprise/index'
import { cacheManager as cache } from '@km/shared-utils'
import licenseApi from '@/api/modules/license'
import { APP_TEMPLATE, getAppTemplate, isRecordingEntry } from '@/constants/app-template'
import { VERSION_MODULE } from '@/constants/enterprise'
import { resolveAssetUrl } from '@km/shared-utils'

const getDefaultLogo = () => '/images/default_logo.png'

const CACHE_KEYS = {
  ENTERPRISE_INFO: 'enterprise_info',
  IS_SAAS: 'is_saas',
  VERSION_INFO: 'version_info',
  LICENSE_INFO: 'license_info'
}

interface EnterpriseState extends Enterprise.State {
  // Actions
  initTemplateStyle: () => void
  setMetaDescription: (description?: string) => void
  setMetaKeywords: (keywords?: string[]) => void
  setDocumentTitleAndIcon: (title: string, iconUrl: string) => void
  setAppLanguage: (language: string) => void
  saveToStorage: () => void
  loadFromStorage: () => Promise<Enterprise.State>
  loadLicenseInfo: () => Promise<void>
  loadVersionInfo: () => Promise<void>
  loadSaasInfo: () => Promise<void>
  loadInfo: () => Promise<Enterprise.State>
  /** 失效企业信息缓存后重新拉取：供企业信息被修改后调用，避免拿到旧缓存。 */
  refreshInfo: () => Promise<Enterprise.State>
}

const initialState: Enterprise.State = {
  id: '',
  type: '',
  banner: '',
  timezone: '',
  domain: '',
  slogan: '',
  status: 0,
  template_type: '',
  layout_type: '',
  created_time: 0,
  updated_time: 0,
  logo: getDefaultLogo(),
  ico: getDefaultLogo(),
  industry: '',
  full_name: '',
  display_name: '',
  language: 'zh-cn',
  copyright: '',
  keywords: [],
  description: '',
  banner_info: {
    url_list: [],
    interval: ''
  },
  template_style_info: {
    style_type: 'software'
  },
  is_independent: false,
  is_enterprise: false,
  is_industry: false,
  is_install_wecom: false,
  version: 0,
  features: {}
}

export const useEnterpriseStore = create<EnterpriseState>((set, get) => ({
  ...initialState,

  initTemplateStyle: () => {
    const state = get()
    let {
      theme_color,
      text_color,
      nav_bg_color,
      nav_text_color,
      page_footer_bg_color,
      page_footer_text_color
    } = state.template_style_info

    theme_color = theme_color || '#2563eb'
    text_color = text_color || '#333333'
    nav_bg_color = nav_bg_color || '#ffffff'
    nav_text_color = nav_text_color || '#333333'
    page_footer_bg_color = page_footer_bg_color || '#18191f'
    page_footer_text_color = page_footer_text_color || '#f2f2f2'

    // Set CSS variables (Ant Design compatible)
    document.documentElement.style.setProperty('--primary-color', theme_color)
    document.documentElement.style.setProperty('--text-color-primary', text_color)
    document.documentElement.style.setProperty('--text-color-secondary', `${text_color}99`)
    document.documentElement.style.setProperty('--nav-bg-color', nav_bg_color)
    document.documentElement.style.setProperty('--nav-text-color', nav_text_color)
    document.documentElement.style.setProperty('--page-footer-bg-color', page_footer_bg_color)
    document.documentElement.style.setProperty('--page-footer-text-color', page_footer_text_color)
  },

  setMetaDescription: (description: string = '') => {
    set({ description })
    if (!description) return
    const meta = document.querySelector('meta[name="description"]')
    if (meta) {
      meta.setAttribute('content', description)
    } else {
      const newMeta = document.createElement('meta')
      newMeta.setAttribute('name', 'description')
      newMeta.setAttribute('content', description)
      document.head.appendChild(newMeta)
    }
  },

  setMetaKeywords: (keywords: string[] = []) => {
    set({ keywords })
    if (!keywords.length) return
    const meta = document.querySelector('meta[name="keywords"]')
    if (meta) {
      meta.setAttribute('content', keywords.join(', '))
    } else {
      const newMeta = document.createElement('meta')
      newMeta.setAttribute('name', 'keywords')
      newMeta.setAttribute('content', keywords.join(', '))
      document.head.appendChild(newMeta)
    }
  },

  setDocumentTitleAndIcon: (title: string, iconUrl: string) => {
    document.title = title
    const link = document.querySelector('link[rel="icon"]') || document.createElement('link')
    link.setAttribute('rel', 'icon')
    link.setAttribute('href', iconUrl || resolveAssetUrl(getDefaultLogo()))
    if (!document.querySelector('link[rel="icon"]')) {
      document.head.appendChild(link)
    }
  },

  setAppLanguage: (language: string) => {
    const lang = (language === 'En' ? 'en' : language) as 'zh-cn' | 'en' | 'zh-tw' | 'ja'
    set({ language: lang })
    // 同步到 localStorage，让 locales 的 t() 函数能读取
    localStorage.setItem('default_lang', lang)
  },

  saveToStorage: () => {
    const { logo, display_name, language } = get()
    localStorage.setItem(
      'enterprise',
      JSON.stringify({
        logo,
        display_name,
        language
      })
    )
  },

  loadFromStorage: async () => {
    const storedEnterprise = localStorage.getItem('enterprise')
    if (storedEnterprise) {
      try {
        const parsedEnterprise = JSON.parse(storedEnterprise)
        set({
          logo: parsedEnterprise.logo || getDefaultLogo(),
          display_name: parsedEnterprise.display_name
        })
        get().setDocumentTitleAndIcon(parsedEnterprise.display_name, parsedEnterprise.logo)
        get().setAppLanguage(parsedEnterprise.language)
      } catch (error) {
        console.error('解析localStorage中的企业信息失败', error)
      }
    }
    return get()
  },

  loadLicenseInfo: async () => {
    const list = await cache.getOrFetch(CACHE_KEYS.LICENSE_INFO, licenseApi.features)
    const features = list.reduce((acc, item) => {
      acc[item.feature_key] = {
        max: typeof item.value === 'boolean' ? +item.value : (item.value === -1 ? 99999 : item.value)
      }
      return acc
    }, {} as Record<string, { max: number }>)
    set({ features })
  },

  loadVersionInfo: async () => {
    const list = await cache.getOrFetch(CACHE_KEYS.VERSION_INFO, enterpriseApi.features)
    const features = list.reduce((acc, item) => {
      acc[item.feature_key] = {
        max: typeof item.value === 'boolean' ? +item.value : item.value === -1 ? 99999 : item.value
      }
      return acc
    }, {} as Record<string, { max: number }>)
    set({ features })
  },

  loadSaasInfo: async () => {
    if (window.$vars?.isOpLocalEnv) {
      set({ features: {} })
    } else if (window.$vars?.isPrivatePremEnv) {
      await get().loadLicenseInfo()
    } else {
      await get().loadVersionInfo()
    }
  },

  refreshInfo: async () => {
    await cache.delete(CACHE_KEYS.ENTERPRISE_INFO)
    return get().loadInfo()
  },

  loadInfo: async () => {
    const fetchInfo = async () => {
      const res = await enterpriseApi.current()
      return {
        enterprise: res.enterprise,
        version: +res.version || 1
      }
    }

    try {
      const info = await cache.getOrFetch(CACHE_KEYS.ENTERPRISE_INFO, fetchInfo)
      const {
        id,
        full_name,
        industry,
        display_name,
        logo,
        language,
        copyright,
        ico,
        keywords,
        description,
        banner,
        template_type,
        type,
        wecom_install_info
      } = info.enterprise || {}

      const parsedLogo = logo || getDefaultLogo()
      const parsedIco = ico || getDefaultLogo()

      let parsedKeywords: string[] = []
      try {
        parsedKeywords = JSON.parse(keywords || '[]')
      } catch {
        parsedKeywords = []
      }

      let banner_info = { url_list: [], interval: '' }
      try {
        banner_info = JSON.parse(banner || '{}')
      } catch {
        banner_info = { url_list: [], interval: '' }
      }

      let template_style_info = { style_type: 'software' }
      try {
        template_style_info = JSON.parse(template_type || '{ "style_type": "software" }')
      } catch {
        template_style_info = { style_type: 'software' }
      }

      const search = window.location.search
      if (!['website', 'software', 'recording'].includes(template_style_info.style_type)) {
        template_style_info.style_type = 'website'
      }

      // 先加载版本特性（失败不阻塞企业信息应用）：
      // 安心录模块关闭后，企业配置的安心录模板风格回退为软件模式
      await get().loadSaasInfo().catch(() => undefined)
      if (
        template_style_info.style_type === 'recording' &&
        get().features[VERSION_MODULE.RECORDING]?.max === 0
      ) {
        template_style_info.style_type = 'software'
      }
      if (search.includes('style_type=software')) {
        template_style_info.style_type = 'software'
      }
      if (search.includes('style_type=website')) {
        template_style_info.style_type = 'website'
      }

      const isMobile = window.innerWidth < 768 || !!(window as any).electron
      // 移动端仅网站布局不可用；安心录模式基于软件布局，保持不变
      if (isMobile && template_style_info.style_type === 'website') {
        template_style_info.style_type = 'software'
      }

      // 入口模板强制风格（website.html / client.html / erhao.html），优先级最高：
      // 模板入口面向特定部署场景（网站门户、客户端外壳、安心录设备），
      // 不应被企业配置、URL 参数或移动端检测覆盖
      const appTemplate = getAppTemplate()
      if (appTemplate === APP_TEMPLATE.WEBSITE) {
        template_style_info.style_type = 'website'
      } else if (appTemplate === APP_TEMPLATE.CLIENT || appTemplate === APP_TEMPLATE.RECORDING) {
        template_style_info.style_type = 'software'
      }

      const is_independent = type === 'independent'
      const is_enterprise = type === 'enterprise'
      const is_industry = type === 'industry'

      set({
        id,
        version: info.version,
        logo: parsedLogo,
        ico: parsedIco,
        full_name,
        industry,
        display_name,
        copyright,
        description: description || '',
        is_independent: is_independent || (!is_independent && !is_enterprise && !is_industry),
        is_enterprise,
        is_industry,
        is_install_wecom: wecom_install_info?.install_wecom_app || false,
        keywords: parsedKeywords,
        banner_info,
        template_style_info
      })

      get().setAppLanguage(language)
      get().setDocumentTitleAndIcon(display_name, parsedIco)
      get().setMetaKeywords(parsedKeywords)
      get().setMetaDescription(description || '')
      get().saveToStorage()
      get().initTemplateStyle()
    } catch (error) {
      console.error('获取企业信息失败', error)
    }
    return get()
  }
}))

// Computed getter for isSoftStyle（软件布局：软件模式 + 安心录模式）
export const useIsSoftStyle = () => {
  const template_style_info = useEnterpriseStore((state) => state.template_style_info)
  const style = template_style_info.style_type
  return style === 'software' || style === 'recording'
}

// Computed getter for 安心录模式：erhao.html 模板入口，
// 或企业配置 style_type = 'recording'（后台“模板风格”设为安心录风格）
export const useIsRecordOnly = () => {
  const isTemplateEntry = isRecordingEntry()
  const template_style_info = useEnterpriseStore((state) => state.template_style_info)
  return isTemplateEntry || template_style_info.style_type === 'recording'
}

// Computed getter for enterprise type
export const useEnterpriseType = () => {
  const is_independent = useEnterpriseStore((state) => state.is_independent)
  const is_enterprise = useEnterpriseStore((state) => state.is_enterprise)
  const is_industry = useEnterpriseStore((state) => state.is_industry)
  return {
    isIndependent: is_independent || is_industry,
    isEnterprise: is_enterprise || is_industry
  }
}
