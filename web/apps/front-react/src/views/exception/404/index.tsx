import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, message } from 'antd'
import { t } from '@/locales'

export default function NotFound() {
  const navigate = useNavigate()

  const goHome = () => {
    navigate('/')
  }

  useEffect(() => {
    message.warning(t('no_permission_tip'), 0)
  }, [t])

  return (
    <div className="flex h-full">
      <div className="px-4 m-auto space-y-4 text-center max-[400px]">
        <h1 className="text-4xl text-slate-800 dark:text-neutral-200">
          {t('not_found_tip')}
        </h1>
        <div className="flex-center text-center">
          <div className="w-[300px]">
            {/* SvgIcon would be rendered here */}
            <svg width="300" height="225" viewBox="0 0 300 225">
              <text x="150" y="112" textAnchor="middle" fontSize="48" fill="#999">404</text>
            </svg>
          </div>
        </div>
        <Button type="primary" onClick={goHome}>
          {t('go_home')}
        </Button>
      </div>
    </div>
  )
}
