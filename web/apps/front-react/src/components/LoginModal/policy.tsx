import { useState, useEffect } from 'react'
import { useEnv } from '@/hooks/useEnv'
import enterpriseApi from '@/api/modules/enterprise'
import { t } from '@/locales'

interface PolicyInfo {
  ai_privacy_policy: {
    enabled: boolean
    url: string
  }
  privacy_policy: {
    enabled: boolean
    url: string
  }
  terms_of_service: {
    enabled: boolean
    url: string
  }
}

const defaultPolicyInfo: PolicyInfo = {
  ai_privacy_policy: {
    enabled: false,
    url: ''
  },
  privacy_policy: {
    enabled: false,
    url: ''
  },
  terms_of_service: {
    enabled: false,
    url: ''
  }
}

export function Policy() {
  const { isPrivatePremEnv } = useEnv()
  const [policyInfo, setPolicyInfo] = useState<PolicyInfo>(defaultPolicyInfo)

  useEffect(() => {
    if (isPrivatePremEnv) {
      loadPolicyInfo()
    }
  }, [isPrivatePremEnv])

  const loadPolicyInfo = async () => {
    try {
      const { data } = await enterpriseApi.policy_info()
      if (data) {
        setPolicyInfo(data)
      }
    } catch (error) {
      console.error('Failed to load policy info:', error)
    }
  }

  // 非私有化环境：显示默认协议链接
  if (!isPrivatePremEnv) {
    return (
      <div className="text-xs text-[#9A9A9A]">
        {t('login.agree')}
        <a
          href={encodeURI('https://doc.53ai.com/入门/服务协议.html')}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#4F5052] cursor-pointer underline"
        >
          {t('login.terms_of_service')}
        </a>
        {t('action.and')}
        <a
          href={encodeURI('https://doc.53ai.com/入门/AI隐私条款.html')}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#4F5052] cursor-pointer underline"
        >
          {t('login.privacy_policy')}
        </a>
      </div>
    )
  }

  // 私有化环境：根据配置显示协议链接
  const hasTerms = policyInfo.terms_of_service.enabled
  const hasPrivacy = policyInfo.privacy_policy.enabled
  const hasAiPrivacy = policyInfo.ai_privacy_policy.enabled

  if (!hasTerms && !hasPrivacy && !hasAiPrivacy) {
    return null
  }

  return (
    <div className="text-xs text-[#9A9A9A]">
      {t('login.agree')}

      {/* 服务条款 */}
      {hasTerms && (
        <>
          <a
            href={policyInfo.terms_of_service.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#4F5052] cursor-pointer underline"
          >
            {t('login.local_terms_of_service')}
          </a>
          {hasPrivacy && hasAiPrivacy && t('action.and_character')}
          {(!hasPrivacy || !hasAiPrivacy) && (hasPrivacy || hasAiPrivacy) && t('action.and')}
        </>
      )}

      {/* 隐私政策 */}
      {hasPrivacy && (
        <>
          <a
            href={policyInfo.privacy_policy.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#4F5052] cursor-pointer underline pr-[2px]"
          >
            {t('login.local_privacy_policy')}
          </a>
          {hasAiPrivacy && t('action.and')}
        </>
      )}

      {/* AI 隐私条款 */}
      {hasAiPrivacy && (
        <a
          href={policyInfo.ai_privacy_policy.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#4F5052] cursor-pointer underline pl-[2px]"
        >
          {t('login.local_ai_privacy_policy')}
        </a>
      )}
    </div>
  )
}

export default Policy
