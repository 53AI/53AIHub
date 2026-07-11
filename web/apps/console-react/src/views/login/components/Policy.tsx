import { useEffect, useState } from 'react'
import { t } from '@/locales'
import { useEnv } from '@/hooks'
import enterpriseApi from '@/api/modules/enterprise'

type PolicyLink = {
  enabled: boolean
  url: string
}

type PolicyInfo = {
  terms_of_service: PolicyLink
  privacy_policy: PolicyLink
  ai_privacy_policy: PolicyLink
}

interface PolicyProps {
  className?: string
}

export function Policy(props: PolicyProps) {
  const { className = '' } = props
  const { isPrivatePremEnv } = useEnv()
  const [policyInfo, setPolicyInfo] = useState<PolicyInfo>({
    terms_of_service: { enabled: false, url: '' },
    privacy_policy: { enabled: false, url: '' },
    ai_privacy_policy: { enabled: false, url: '' },
  })

  useEffect(() => {
    if (!isPrivatePremEnv) return
    enterpriseApi
      .policy_info()
      .then((res: any) => {
        const { terms_of_service, privacy_policy, ai_privacy_policy } = res || {}
        setPolicyInfo({
          terms_of_service: terms_of_service || { enabled: false, url: '' },
          privacy_policy: privacy_policy || { enabled: false, url: '' },
          ai_privacy_policy: ai_privacy_policy || { enabled: false, url: '' },
        })
      })
      .catch(() => {
        // ignore
      })
  }, [isPrivatePremEnv])

  if (!isPrivatePremEnv) {
    return (
      <div className={`text-xs text-disabled ${className}`}>
        {t('login.agree_tip')}{' '}
        <a
          href={encodeURI('https://doc.53ai.com/入门/服务协议.html')}
          target="_blank"
          rel="noreferrer"
          className="text-secondary cursor-pointer underline"
        >
          {t('login.agree')}
        </a>{' '}
        {t('login.and')}{' '}
        <a
          href={encodeURI('https://doc.53ai.com/入门/AI隐私条款.html')}
          target="_blank"
          rel="noreferrer"
          className="text-secondary cursor-pointer underline"
        >
          {t('login.policy')}
        </a>
      </div>
    )
  }

  const { terms_of_service, privacy_policy, ai_privacy_policy } = policyInfo
  if (!terms_of_service.enabled && !privacy_policy.enabled && !ai_privacy_policy.enabled) {
    return null
  }

  return (
    <div className={`text-xs text-disabled ${className}`}>
      {t('login.agree_tip')}{' '}
      {terms_of_service.enabled && (
        <>
          <a
            href={terms_of_service.url}
            target="_blank"
            rel="noreferrer"
            className="text-secondary cursor-pointer underline"
          >
            {t('login.service_agreement')}
          </a>
          {privacy_policy.enabled && ai_privacy_policy.enabled && ` ${t('login.and_character')} `}
          {(privacy_policy.enabled || ai_privacy_policy.enabled) &&
            !(privacy_policy.enabled && ai_privacy_policy.enabled) &&
            ` ${t('login.and')} `}
        </>
      )}
      {privacy_policy.enabled && (
        <>
          <a
            href={privacy_policy.url}
            target="_blank"
            rel="noreferrer"
            className="text-secondary cursor-pointer underline pr-[2px]"
          >
            {t('login.privacy_policy')}
          </a>
          {ai_privacy_policy.enabled && ` ${t('login.and')} `}
        </>
      )}
      {ai_privacy_policy.enabled && (
        <a
          href={ai_privacy_policy.url}
          target="_blank"
          rel="noreferrer"
          className="text-secondary cursor-pointer underline pl-[2px]"
        >
          {t('login.ai_privacy_policy')}
        </a>
      )}
    </div>
  )
}

