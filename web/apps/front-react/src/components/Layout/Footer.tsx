import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useEnterpriseStore, useIsSoftStyle } from '@/stores/modules/enterprise'
import { getPublicPath } from '@/utils/config'
import { useResponsive } from '@/hooks/useResponsive'
import { t } from '@/locales'
import { SvgIcon } from '@km/shared-components-react'
import './Footer.css'

interface FooterItem {
  name: string
  title: string
  icon: string
  stroke?: boolean
}

export function Footer({ fixed = true }: { fixed?: boolean }) {
  const location = useLocation()
  const { isMobile } = useResponsive()

  const enterpriseStore = useEnterpriseStore()
  const isSoftStyle = useIsSoftStyle()

  // 移动端底部导航栏
  const [footerList] = useState<FooterItem[]>([
    { name: 'Agent', title: t('module.agent'), icon: 'agent', stroke: true },
    { name: 'Prompt', title: t('module.prompt'), icon: 'prompt', stroke: true },
    { name: 'Toolkit', title: t('module.toolbox'), icon: 'toolkit', stroke: true }
  ])

  const copyright = enterpriseStore.copyright?.toLowerCase()
  const icpLicense = enterpriseStore.template_style_info?.icp_license

  // 软件风格布局
  if (isSoftStyle) {
    return (
      <>
        {copyright !== 'true' && (
          <div className="mt-auto w-full flex justify-center items-center gap-1.5 text-xs text-[#999999] py-4">
            <span>本网站由</span>
            <div className="flex-none h-4 overflow-hidden">
              <img
                src={getPublicPath('/images/53ai-hub.png')}
                className="flex-none h-4 object-cover -translate-y-16"
                alt="53AI Hub"
                style={{ filter: 'drop-shadow(var(--el-text-color-placeholder, #999) 0 64px)' }}
              />
            </div>
            <span>提供技术支持</span>
          </div>
        )}
        {copyright === 'true' && <div className="h-12" />}
        {fixed && <div className="h-14 md:hidden" />}
        {isMobile && (
          <div
            className={`bg-white flex items-center border-t ${
              fixed ? 'fixed bottom-0 left-0 right-0 z-[9]' : ''
            }`}
          >
            {footerList.map((item) => (
              <div key={item.icon} className="flex-1 flex items-center justify-center">
                <Link
                  to={`/${item.name.toLowerCase()}`}
                  className={`h-14 px-2 flex flex-col items-center justify-center gap-1 cursor-pointer ${
                    location.pathname.startsWith(`/${item.name.toLowerCase()}`)
                      ? 'text-theme'
                      : 'text-primary'
                  }`}
                >
                  <SvgIcon name={item.icon} size={18} stroke={item.stroke} />
                  <p className="text-sm leading-none max-w-[100px] truncate">{item.title}</p>
                </Link>
              </div>
            ))}
          </div>
        )}
      </>
    )
  }

  // 网站风格布局
  return (
    <div className="mt-auto relative py-8 md:py-10 lg:py-12 footer-bg footer-text">
      <div className="w-11/12 lg:w-4/5 mx-auto max-w-[1200px] flex flex-col md:flex-row items-center">
        <div className="flex-1 w-full md:w-auto mb-6 md:mb-0">
          {/* 版权信息和ICP备案 */}
        </div>
      </div>
      <div className="w-full flex flex-col items-center absolute top-1/2 -translate-y-1/2 left-0 right-0">
        {icpLicense && <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer"><div className="text-sm mb-5">{icpLicense}</div></a>}
        {copyright !== 'true' && (
          <div className="flex items-center gap-1.5 text-xs">
            <span>本网站由</span>
            <img
              src={getPublicPath('/images/53ai-hub.png')}
              className="flex-none h-4 object-cover"
              alt="53AI Hub"
            />
            <span>提供技术支持</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default Footer
