import service from '../config'
import { handleError } from '../error-handler'
import { WEBSITE_STYLE, type WebsiteStyle } from '@/constants/enterprise'

export interface TemplateStyleForm {
  style_type: WebsiteStyle
  theme_color: string
  text_color: string
  nav_bg_color: string
  nav_text_color: string
  page_footer_bg_color: string
  page_footer_text_color: string
  icp_license: string
}

export const defaultForm = {
  style_type: WEBSITE_STYLE.SOFTWARE,
  theme_color: '#2563eb',
  text_color: '#333333',
  nav_bg_color: '#ffffff',
  nav_text_color: '#333333',
  page_footer_bg_color: '#18191f',
  page_footer_text_color: '#f2f2f2',
  icp_license: '',
}

export const templateStyleApi = {
  async getTemplateStyle() {
    const res = await service
      .get('/api/enterprises/template_type')
      .catch(handleError) as any
    const dataWrap = res?.data ?? {}
    let template_type = dataWrap.template_type ?? '{}'
    let data: Partial<TemplateStyleForm> = defaultForm
    try {
      data = JSON.parse(template_type)
    } catch {
      data = {}
    }
    return { ...defaultForm, ...data }
  },
  async saveTemplateStyle(data: {
    style_type: string
    theme_color: string
    text_color: string
    nav_bg_color: string
    nav_text_color: string
    page_footer_bg_color: string
    page_footer_text_color: string
    icp_license: string
  }) {
    return service
      .put('/api/enterprises/template_type', { template_type: JSON.stringify(data) })
      .catch(handleError)
  },
}

export default templateStyleApi
