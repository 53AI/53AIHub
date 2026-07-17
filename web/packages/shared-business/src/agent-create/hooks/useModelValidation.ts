/**
 * 模型配置验证工具
 */

import { message } from 'antd'

/** 模型配置接口 */
export interface ModelConfig {
  channel_id?: number
  model_name?: string
  channel_type?: number
  enable?: boolean
  temperature?: number
}

/** 验证选项 */
export interface ValidateModelOptions {
  /** 模型配置对象 */
  config: ModelConfig | undefined
  /** 模型名称标签（用于错误提示） */
  label: string
  /** 翻译函数 */
  t: (key: string) => string
  /** 是否必须验证（即使 enable=false） */
  required?: boolean
}

/**
 * 验证模型配置是否有效
 *
 * @returns true 表示验证通过，false 表示验证失败
 *
 * @example
 * validateModelConfig({
 *   config: { channel_id: 123, model_name: "gpt-4" },
 *   label: "快速推理模型",
 *   t: (key) => key,
 * })
 * // => true
 */
export function validateModelConfig(options: ValidateModelOptions): boolean {
  const { config, label, t, required = true } = options

  // 如果不是必须且未启用，跳过验证
  if (!required && !config?.enable) {
    return true
  }

  if (!config?.channel_id || !config?.model_name) {
    message.error(t('form_select_placeholder') + label)
    return false
  }

  return true
}