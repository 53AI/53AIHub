import { Sender } from '@km/hub-ui-x-react'
import { message } from 'antd'
import { useState } from 'react'
import { usePromptFormDataStore } from '../store'
import { t } from '@/locales'

export function PromptPreview() {
  const [prompt, setPrompt] = useState('')
  const formData = usePromptFormDataStore((state) => state.formData)

  const handleSend = () => {
    if (!prompt.trim()) return
    message.info(t('common.feature_coming_soon'))
    setPrompt('')
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 气泡列表区域 */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4">
        {formData.logo && (
          <img
            src={formData.logo}
            alt={formData.name || 'Prompt'}
            className="w-14 h-14 rounded-xl object-cover"
          />
        )}
        {formData.name && (
          <span className="text-lg text-primary">
            {formData.name}
          </span>
        )}
      </div>

      {/* 发送区域 */}
      <div className="px-4 py-3">
        <Sender
          value={prompt}
          onChange={setPrompt}
          onSend={handleSend}
          placeholder={t('prompt.input_placeholder')}
          sendOnEnter={true}
        />
      </div>
    </div>
  )
}

export default PromptPreview
