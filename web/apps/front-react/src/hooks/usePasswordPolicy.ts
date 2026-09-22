/**
 * 密码强度策略
 *
 * 企业策略存在通用设置 `password_security_policy` 里（后台「密码强度」页写入）。
 * 本模块把它读出来，并提供可直接挂到 Form.Item 的密码校验规则。
 *
 * 兜底：未配置 / 值不可解析 / 请求失败一律按 weak（与后台配置页「未配置」定义一致，允许简单密码）。
 */
import { useEffect, useMemo, useState } from 'react'

import { settingApi } from '@/api/modules/setting'
import { t } from '@/locales'
import { useEnterpriseStore } from '@/stores/modules/enterprise'
import {
  isPasswordStrength,
  validatePasswordByStrength,
  type PasswordFailure,
  type PasswordStrength,
} from '@km/shared-utils'

/** 未配置或读取失败时的兜底档位（后台「未配置」= weak） */
export const DEFAULT_PASSWORD_STRENGTH: PasswordStrength = 'weak'

const SETTING_KEY = 'password_security_policy'

interface CacheEntry {
  scope: string
  strength: PasswordStrength
}

let cache: CacheEntry | null = null
let inflight: Promise<PasswordStrength> | null = null

/** 缓存作用域：切换企业后不得复用上一个企业的强度 */
function getCacheScope(): string {
  try {
    return useEnterpriseStore.getState().id || 'default'
  } catch {
    return 'default'
  }
}

/** 取已缓存的强度（同企业），未命中返回 null */
export function peekCachedPasswordStrength(): PasswordStrength | null {
  return cache && cache.scope === getCacheScope() ? cache.strength : null
}

/** 清空缓存（登出 / 切换企业 / 测试） */
export function resetPasswordPolicyCache(): void {
  cache = null
  inflight = null
}

async function loadPasswordStrength(): Promise<PasswordStrength> {
  const scope = getCacheScope()
  try {
    const res = await settingApi.get(SETTING_KEY)
    const raw = res?.value || res?.data?.value
    const policy = typeof raw === 'string' ? JSON.parse(raw) : raw
    const strength = isPasswordStrength(policy?.strength)
      ? policy.strength
      : DEFAULT_PASSWORD_STRENGTH
    cache = { scope, strength }
    return strength
  } catch {
    // 静默失败：不缓存，让下一个入口有机会重试
    return DEFAULT_PASSWORD_STRENGTH
  }
}

/** 读取企业策略的强度（同一会话 / 同一企业只请求一次） */
export function fetchPasswordStrength(): Promise<PasswordStrength> {
  const cached = peekCachedPasswordStrength()
  if (cached) return Promise.resolve(cached)
  if (!inflight) {
    inflight = loadPasswordStrength().finally(() => {
      inflight = null
    })
  }
  return inflight
}

/** 组件用：当前强度，首帧为缓存值或兜底值，取到策略后触发重渲染 */
export function usePasswordPolicy(): { strength: PasswordStrength } {
  const [strength, setStrength] = useState<PasswordStrength>(
    () => peekCachedPasswordStrength() ?? DEFAULT_PASSWORD_STRENGTH
  )

  useEffect(() => {
    let alive = true
    fetchPasswordStrength().then((value) => {
      if (alive) setStrength(value)
    })
    return () => {
      alive = false
    }
  }, [])

  return { strength }
}

/** 把结构化失败原因翻译成当前语言的提示文案 */
export function getPasswordFailureMessage(failure: PasswordFailure): string {
  switch (failure.type) {
    case 'length':
      return t('form.password_length_range', { min: failure.min, max: failure.max })
    case 'classes':
      return t('form.password_mix_classes', { count: failure.required })
    case 'space':
      return t('form.password_no_space')
    case 'chinese':
      return t('form.password_no_chinese')
  }
}

/** 生成密码校验规则（空值放行，由 required 规则负责，避免一个字段两条提示） */
export function buildPasswordRule(strength: PasswordStrength) {
  return {
    validator: (_: unknown, value: unknown) => {
      const failure = validatePasswordByStrength(String(value ?? ''), strength)
      return failure
        ? Promise.reject(new Error(getPasswordFailureMessage(failure)))
        : Promise.resolve()
    },
    trigger: 'blur' as const,
  }
}

/** 组件用：按当前企业强度生成的密码校验规则 */
export function usePasswordRules() {
  const { strength } = usePasswordPolicy()
  const passwordRule = useMemo(() => buildPasswordRule(strength), [strength])
  return { strength, passwordRule }
}
