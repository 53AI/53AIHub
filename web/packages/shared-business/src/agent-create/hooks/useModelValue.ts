/**
 * 模型值编码/解码工具
 *
 * 用于处理模型选择器中 channel_id、model_name、channel_type 的编码值
 */

import { MODEL_VALUE_SEPARATOR } from '../constants'

/** 模型值解析后的结构 */
export interface ModelValueParts {
  channel_id: number
  model_name: string
  channel_type: number
}

/**
 * 解析模型值字符串
 *
 * @example
 * parseModelValue("123_53aikm_gpt-4_53aikm_0")
 * // => { channel_id: 123, model_name: "gpt-4", channel_type: 0 }
 */
export function parseModelValue(value: string): ModelValueParts {
  const [channel_id, model_name, channel_type] = value.split(MODEL_VALUE_SEPARATOR)
  return {
    channel_id: Number(channel_id),
    model_name,
    channel_type: Number(channel_type),
  }
}

/**
 * 编码模型值字符串
 *
 * @example
 * encodeModelValue({ channel_id: 123, model_name: "gpt-4", channel_type: 0 })
 * // => "123_53aikm_gpt-4_53aikm_0"
 */
export function encodeModelValue(parts: ModelValueParts): string {
  return `${parts.channel_id}${MODEL_VALUE_SEPARATOR}${parts.model_name}${MODEL_VALUE_SEPARATOR}${parts.channel_type}`
}

/**
 * 判断模型值是否为空
 *
 * @example
 * isModelValueEmpty("") // => true
 * isModelValueEmpty("123_53aikm_gpt-4_53aikm_0") // => false
 */
export function isModelValueEmpty(value: string): boolean {
  return !value || value.split(MODEL_VALUE_SEPARATOR).length < 3
}