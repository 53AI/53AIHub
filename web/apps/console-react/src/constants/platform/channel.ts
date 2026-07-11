import { CHANNEL_TYPE_VALUE_MAP, channels, models } from './config'

// 平台介入，通用大模型需要
export const CHANNEL_TYPE = Object.fromEntries(
  [...Object.entries(channels), ...Object.entries(models)].map(([key, value]) => [
    key.toUpperCase(),
    key,
  ])
) as Record<string, string>

export type ChannelType = (typeof CHANNEL_TYPE)[keyof typeof CHANNEL_TYPE]

export const CHANNEL_TYPE_LABEL_MAP = new Map<string, string>(
  [...Object.entries(models), ...Object.entries(channels)].map(([key, value]) => [
    value.channelType,
    value.label,
  ])
)
export const CHANNEL_TYPE_ICON_MAP = new Map<number, string>(
  [...Object.entries(models), ...Object.entries(channels)].map(([key, value]) => [
    value.channelType,
    value.icon,
  ])
)

export const CHANNEL_TYPE_OPTIONS = [
  CHANNEL_TYPE.SILICONFLOW,
  CHANNEL_TYPE.DEEPSEEK,
  CHANNEL_TYPE.OPENAI,
  CHANNEL_TYPE.AZURE,
  CHANNEL_TYPE.DARK_MOON,
  CHANNEL_TYPE.ZHIPU,
].map(value => {
  const channel_type = CHANNEL_TYPE_VALUE_MAP.get(value)
  return {
    value,
    channel_type,
    label: CHANNEL_TYPE_LABEL_MAP.get(channel_type),
    icon: CHANNEL_TYPE_ICON_MAP.get(channel_type),
    is_add: false,
    add_visible: [
      CHANNEL_TYPE.SILICONFLOW,
      CHANNEL_TYPE.DEEPSEEK,
      CHANNEL_TYPE.OPENAI,
      CHANNEL_TYPE.AZURE,
    ].includes(value),
  }
})
export { CHANNEL_TYPE_VALUE_MAP }
