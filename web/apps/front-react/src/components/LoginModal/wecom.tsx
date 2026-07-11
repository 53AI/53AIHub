import { Button } from 'antd'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { suite_id } from '@/utils/config'
import { getPublicPath } from '@/utils/config'
import { t } from '@/locales'

interface WecomLoginProps {
  width?: string
  height?: string
}

export function WecomLogin({
  width = '100%',
  height = '280px'
}: WecomLoginProps) {
  const { isInMobile } = useBasicLayout()

  const handleLogin = () => {
    const redirect_url = encodeURIComponent(
      encodeURIComponent(`${window.location.origin}/?login_way=wecom_login`)
    )

    if (isInMobile) {
      // 移动端：跳转微信 OAuth 授权页面
      window.location.href = 'https://open.weixin.qq.com/connect/oauth2/authorize'
        .concat(`?appid=${suite_id}`)
        .concat('&response_type=code')
        .concat('&scope=snsapi_base')
        .concat('&state=1')
        .concat('#wechat_redirect')
        .concat(
          '&redirect_uri=' +
            `https%3A%2F%2Fhubapi.53ai.com%2Fapi%2Fsaas%2Fwecom%2Fcallback%2Flogin%3Fsuiteid%3D${suite_id}%26redirect_url%3D${redirect_url}`
        )
    } else {
      // 桌面端：跳转企业微信扫码登录页面
      window.location.href = 'https://login.work.weixin.qq.com/wwlogin/sso/login/'
        .concat('?login_type=ServiceApp')
        .concat('&appid=ww4f0a0a97cee0f030')
        .concat('&state=WWLogin')
        .concat('&redirect_type=callback')
        .concat(
          `&redirect_uri=https%3A%2F%2Fwork.wescrm.com%2F%3Fsuiteid%3D${suite_id}%26redirect_url%3D${redirect_url}`
        )
    }
  }

  return (
    <div style={{ height, width }} className="flex flex-col justify-center items-center">
      <div className="w-[220px] h-[220px] border relative rounded-lg overflow-hidden">
        <img src={getPublicPath('/images/login/wecom_login.png')} alt="WeCom Login" />
        <div className="absolute inset-0 bg-white/90 flex justify-center items-center">
          <Button type="primary" danger onClick={handleLogin}>
            {t('login.immediate_login')}
          </Button>
        </div>
      </div>
      <p className="text-sm text-[#9A9A9A] mt-3">{t('login.login_by_wecom')}</p>
    </div>
  )
}

export default WecomLogin
