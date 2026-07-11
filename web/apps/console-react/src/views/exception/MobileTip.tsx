import { Button, message } from 'antd'
import { useEffect, useState } from 'react'
import { copyToClip } from '@km/shared-utils'

export function MobileTip() {
  const [url, setUrl] = useState('')

  useEffect(() => {
    setUrl(sessionStorage.getItem('mobile_tip_url') || '')
  }, [])

  const handleCopy = () => {
    if (!url) return
    copyToClip(url).then(() => {
      message.success('已复制')
    })
  }

  return (
    <div className="w-full h-full overflow-y-auto overflow-x-hidden flex flex-col items-center justify-center bg-[#FCFDFF]">
      <div
        className="w-[244px] h-[195px]"
        style={{
          backgroundImage: "url('/images/mobile_tip.png')",
          backgroundSize: '100% 100%',
        }}
      />
      <div className="mt-6 text-sm text-dark">请前往pc端查看文档详情</div>
      <div
        className="w-[85%] mt-4 py-3 px-3 box-border text-sm text-wrap break-words text-[#BA8550] border border-solid border-[#EBEEF5] bg-white"
      >
        {url || ''}
      </div>
      {url && (
        <Button className="mt-4" type="primary" onClick={handleCopy}>
          复制链接
        </Button>
      )}
    </div>
  )
}

export default MobileTip
