import { Button } from 'antd'
import { useNavigate } from 'react-router-dom'
import { SvgIcon } from '@km/shared-components-react'

export function ServerError() {
  const navigate = useNavigate()

  const goHome = () => {
    navigate('/')
  }

  return (
    <div className="flex h-full dark:bg-neutral-800">
      <div className="px-4 m-auto space-y-4 text-center max-w-[400px]">
        <header className="space-y-2">
          <h2 className="text-2xl font-bold text-center text-slate-800 dark:text-neutral-200">
            500
          </h2>
          <p className="text-base text-center text-slate-500 dark:text-slate-500">
            Server error
          </p>
          <div className="flex items-center justify-center text-center">
            <div className="w-[300px] text-[#142D6E] dark:text-[#3a71ff]">
              <SvgIcon name="500" width="300px" height="225px" />
            </div>
          </div>
        </header>
        <Button type="primary" onClick={goHome}>
          Go to Home
        </Button>
      </div>
    </div>
  )
}

export default ServerError
