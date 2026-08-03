import { transformChannelData } from '@/api/modules/channel'
import { MODEL_USE_TYPE } from '@/constants/platform/config'
import recordingApi from '@/api/modules/recording'
import channelApi from '@/api/modules/channel'

export interface VoiceParserInfo {
  showVoice: boolean
  voiceName: string
  voiceIcon: string
}

/**
 * 检查安心录是否启用，语音识别模型是否仍有效，并获取语音模型名称和图标
 * parser_platform 格式为 voice:{channel_type}:{model_name}
 */
export async function getVoiceParserInfo(): Promise<VoiceParserInfo> {
  let recordingEnabled = false
  let parserPlatformValid = false
  let voiceName = ''
  let voiceIcon = ''

  try {
    const config = await recordingApi.getConfig()
    recordingEnabled = config?.enabled ?? false

    if (recordingEnabled && config?.parser_platform) {
      const modelName = config.parser_platform.split(':').pop() || ''
      const list = await channelApi.listv2()
      const seen = new Set<string>()

      list.forEach((raw: any) => {
        const channel = transformChannelData(raw)
        const voiceModelsConfig = channel.custom_config?.voice_models || {}
        channel.options.forEach((opt: any) => {
          if (String(opt.modelType) === MODEL_USE_TYPE.VOICE) {
            seen.add(opt.value)
            if (opt.value === modelName) {
              const voiceCfg = voiceModelsConfig[opt.value]
              voiceName = voiceCfg?.display_name || opt.label || opt.value
              voiceIcon = opt.icon || ''
            }
          }
        })
      })

      parserPlatformValid = seen.has(modelName)
    }
  } catch {
    // 获取失败时默认不展示语音解析
  }

  return {
    showVoice: recordingEnabled && parserPlatformValid,
    voiceName,
    voiceIcon,
  }
}