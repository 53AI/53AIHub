import { useState, useEffect, useRef } from 'react'
import { Button, Spin } from 'antd'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { api_host, official_id, getPublicPath } from '@/utils/config'
import { t } from '@/locales'

interface WechatLoginProps {
  width?: string
  height?: string
  onSuccess?: (data: { openid: string; nickname: string; unionid: string; access_token?: string }) => void
}

export function WechatLogin({
  width = '100%',
  height = '280px',
  onSuccess
}: WechatLoginProps) {
  const { isInMobile } = useBasicLayout()
  const [loading, setLoading] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const WECHAT_LOGIN_URL = `https://work.wescrm.com/wechat_oauth_login.html?plain=1&height=280&appid=wxbe904d4182458106&suiteid=53aihub&api=${encodeURIComponent(api_host + '/api/saas/wechat/redirect')}&redirect_url=${encodeURIComponent(location.origin + '/oauth_login.html')}`

  useEffect(() => {
    if (!isInMobile) {
      setLoading(true)
      timerRef.current = setInterval(() => {
        // 处理某些浏览器中 contentWindow 是类数组对象的情况
        const iframeContentWindow = iframeRef.current?.contentWindow
        const contentWindow = (iframeContentWindow && (iframeContentWindow as any)[0]) || iframeContentWindow
        if (contentWindow) {
          try {
            const oauthLoginData = (contentWindow as Window).sessionStorage.getItem('oauth_login_data')
            if (oauthLoginData) {
              const data = JSON.parse(oauthLoginData)
              messageHandler({ data })
            }
          } catch (error) {
            // Ignore cross-origin errors
          }
        }
      }, 2000)
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [isInMobile])

  const messageHandler = (res: { data: any }) => {
    const data = res.data || {}
    const params = data.params || {}
    const from = data.from || params.from || ''
    const action = data.action || params.action || ''
    const state = data.state || params.state || ''
    const openid = data.openid || params.openid || ''
    const nickname = data.nickname || params.nickname || ''
    const unionid = data.unionid || params.unionid || ''
    const access_token = data.access_token || params.access_token || ''

    if (timerRef.current) {
      clearInterval(timerRef.current)
    }

    if (openid || access_token) {
      onSuccess?.({ openid, nickname, unionid, access_token })
    }
  }

  const handleLogin = () => {
    const redirect_url = 'https://api.ibos.cn' + `/v4/xbot/hubredirect?appid=${official_id}&state=wechat_redirect&redirecturl=${encodeURIComponent(location.origin + '/?login_way=wechat_login')}`
    window.location.href = redirect_url
  }

  const handleLoad = () => {
    setLoading(false)
  }

  if (isInMobile) {
    return (
      <div style={{ height, width }} className="flex flex-col justify-center items-center">
        <div className="w-[220px] h-[220px] border relative rounded-lg overflow-hidden">
          <img src={getPublicPath('/images/login/wecom_login.png')} alt="WeChat Login" />
          <div className="absolute inset-0 bg-white/90 flex justify-center items-center">
            <Button type="primary" danger onClick={handleLogin}>
              {t('login.immediate_login')}
            </Button>
          </div>
        </div>
        <p className="text-sm text-[#9A9A9A] mt-3">{t('login.login_by_wechat')}</p>
      </div>
    )
  }

  return (
    <div className="w-full relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80">
          <Spin />
        </div>
      )}
      <iframe
        ref={iframeRef}
        onLoad={handleLoad}
        className="-translate-x-1.5 scale-100 overflow-hidden"
        style={{ height, width }}
        scrolling="no"
        src={WECHAT_LOGIN_URL}
        frameBorder="0"
        title="WeChat Login"
      />
    </div>
  )
}

export default WechatLogin
