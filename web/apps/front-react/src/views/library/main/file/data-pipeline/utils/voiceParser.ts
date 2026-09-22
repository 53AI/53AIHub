import platformSettingsApi from '@/api/modules/platform-settings'
import { transformPlatformSetting } from '@/api/modules/platform-settings/transform'
import channelApi, { transformChannelData } from '@/api/modules/channel'

// 语音模型类型（与后台 custom_config[model] 约定一致）
const VOICE_MODEL_TYPE = '4'

export interface VoiceParserInfo {
  showVoice: boolean
  /** 语音识别模型名称 */
  voiceName: string
  /** 语音识别模型图标 */
  voiceIcon: string
}

/**
 * 检查是否配置了录音识别模型，并返回语音模型名称与图标。
 * 语音识别配置来自平台设置 /api/platform-settings 的 recording_voice（setting 为
 * { voice_model_id: 渠道ID, voice_model_name: 模型ID }）。
 */
export async function getVoiceParserInfo(): Promise<VoiceParserInfo> {
  let showVoice = false
  let voiceName = ''
  let voiceIcon = ''
  try {
    const list = await platformSettingsApi.find({ platform_key: 'recording_voice' })
    const item = list.find((s) => s.platform_key === 'recording_voice') || list[0]
    const setting = item ? transformPlatformSetting(item).setting : {}
    const modelName = setting.voice_model_name || ''
    const channelId = setting.voice_model_id
    showVoice = !!(modelName && channelId)

    if (showVoice) {
      const channelList = await channelApi.listv2()
      const matched = channelList.find((raw: any) => String(raw.channel_id) === String(channelId))
      if (matched) {
        const channel = transformChannelData(matched)
        const voiceModel = channel.options.find(
          (opt: any) => String(opt.modelType) === VOICE_MODEL_TYPE && opt.value === modelName,
        )
        if (voiceModel) {
          const voiceCfg = channel.custom_config?.voice_models?.[modelName]
          voiceName = voiceCfg?.display_name || voiceModel.label || modelName
          voiceIcon = voiceModel.icon || ''
        }
      }
      // 未匹配到模型时，至少回退展示模型ID
      if (!voiceName) voiceName = modelName
    }
  } catch {
    // 获取失败时默认不展示语音解析
  }
  return { showVoice, voiceName, voiceIcon }
}
