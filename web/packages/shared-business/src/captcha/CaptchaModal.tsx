import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal, Input, Button, Spin, message } from 'antd'
import type { InputRef } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import {
  CAPTCHA_TTL_MS,
  registerCaptchaModal,
  rejectPendingCaptcha,
  submitCaptcha,
  type CaptchaFailReason
} from './controller'

/** GET /api/captcha 返回的图形验证码数据 */
export interface CaptchaImageData {
  captcha_id: string
  image_base64: string
}

export interface CaptchaModalProps {
  /** 拉取一张图形验证码（GET /api/captcha），由应用注入自己的 API 封装 */
  fetchCaptcha: () => Promise<CaptchaImageData>
  /** 文案函数，需支持 captcha.* 键（见 ./locales，可传应用 t 或 createCaptchaT(lang)） */
  t: (key: string) => string
}

/**
 * 全局图形验证码弹窗（人机校验）。
 *
 * 在 App 根部挂载一次即可，业务侧统一通过 `runWithCaptcha()` 唤起，
 * 不需要各自渲染弹窗、也不需要各自维护 captcha_id。
 *
 * 交互要点：
 * - 发送短信接口报错时弹窗不关闭，只换图/提示，用户可直接重新输入；
 * - 图形验证码 5 分钟过期后，原图会被遮罩盖住，点击即可换一张。
 */
export function CaptchaModal({ fetchCaptcha, t }: CaptchaModalProps) {
  const [open, setOpen] = useState(false)
  const [image, setImage] = useState('')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [expired, setExpired] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [hint, setHint] = useState<CaptchaFailReason | ''>('')

  // 每次打开/换一张都会覆盖，保证不复用已作废的 captcha_id
  const captchaIdRef = useRef('')
  const inputRef = useRef<InputRef>(null)
  const expireTimerRef = useRef<number | null>(null)

  const clearExpireTimer = useCallback(() => {
    if (expireTimerRef.current !== null) {
      window.clearTimeout(expireTimerRef.current)
      expireTimerRef.current = null
    }
  }, [])

  /** 拉取一张全新的图形验证码，并启动 5 分钟过期计时 */
  const loadCaptcha = useCallback(async () => {
    clearExpireTimer()
    setLoading(true)
    setLoadFailed(false)
    setExpired(false)
    setImage('')
    captchaIdRef.current = ''
    try {
      const data = await fetchCaptcha()
      captchaIdRef.current = data.captcha_id
      setImage(data.image_base64)
      expireTimerRef.current = window.setTimeout(() => {
        expireTimerRef.current = null
        setExpired(true)
      }, CAPTCHA_TTL_MS)
    } catch (error) {
      console.error('获取图形验证码失败:', error)
      setLoadFailed(true)
      message.error(t('captcha.load_fail'))
    } finally {
      setLoading(false)
    }
  }, [clearExpireTimer, fetchCaptcha, t])

  useEffect(() => {
    registerCaptchaModal({
      open: () => {
        setAnswer('')
        setHint('')
        setSubmitting(false)
        setOpen(true)
        loadCaptcha()
        window.setTimeout(() => inputRef.current?.focus(), 100)
      },
      close: () => {
        clearExpireTimer()
        setOpen(false)
        setImage('')
        setAnswer('')
        setExpired(false)
        setLoadFailed(false)
        setSubmitting(false)
        setHint('')
        captchaIdRef.current = ''
      },
      fail: (reason) => {
        setHint(reason)
        if (reason === 'captcha') {
          // 阅后即焚：答错/过期都会让该 captcha_id 作废，必须换一张新图
          setAnswer('')
          loadCaptcha()
        }
      },
      setSubmitting
    })
    return () => {
      registerCaptchaModal(null)
      // 组件卸载时结束挂起的 Promise，避免调用方一直 await
      rejectPendingCaptcha()
      clearExpireTimer()
    }
  }, [loadCaptcha, clearExpireTimer])

  const handleCancel = () => {
    clearExpireTimer()
    setOpen(false)
    setImage('')
    rejectPendingCaptcha()
  }

  /** 换一张：图片过期、加载失败或用户主动点击图片时都走这里 */
  const handleRefresh = () => {
    if (submitting) return
    setAnswer('')
    loadCaptcha()
  }

  const handleConfirm = () => {
    if (submitting) return
    const value = answer.trim()
    if (!value) {
      message.warning(t('captcha.required'))
      return
    }
    if (expired) {
      message.warning(t('captcha.error'))
      handleRefresh()
      return
    }
    if (!captchaIdRef.current) {
      // 图片没拿到，重新拉一张再让用户输入
      handleRefresh()
      return
    }
    // 这里不关闭弹窗：发送成功由控制器关闭，失败则原地换图继续等用户输入
    submitCaptcha({ captcha_id: captchaIdRef.current, captcha_answer: value })
  }

  return (
    <Modal
      open={open}
      title={t('captcha.title')}
      onCancel={handleCancel}
      centered
      width={384}
      mask={{ closable: false }}
      /* 全局弹层统一路 2000（antd 静态弹层约定值）：
         高于普通/嵌套 Modal（根级无 z-index、嵌套 1200），
         低于 message 提示（2010），保证在任意业务弹窗之上且内部警告仍可见。
         否则：若验证码弹窗先于业务弹窗挂载（如短信登录后强制改密），
         会被后挂载的同层弹窗遮盖。 */
      zIndex={2000}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={handleCancel}>{t('captcha.cancel')}</Button>
          <Button type="primary" loading={submitting} onClick={handleConfirm}>
            {t('captcha.confirm')}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-[#4E4F51] mb-3">{t('captcha.tip')}</p>
      <div className="flex items-center gap-3">
        <Input
          ref={inputRef}
          size="large"
          maxLength={4}
          autoComplete="off"
          className="flex-1"
          disabled={submitting}
          value={answer}
          placeholder={t('captcha.placeholder')}
          onChange={(e) => {
            setAnswer(e.target.value)
            setHint('')
          }}
          onPressEnter={handleConfirm}
        />
        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading || submitting}
          title={t('captcha.refresh')}
          aria-label={t('captcha.refresh')}
          className="relative flex h-10 w-[112px] shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-[#E6E8EB] bg-[#F5F6F7] p-0"
        >
          {loading ? (
            <Spin size="small" />
          ) : (
            <>
              {image ? (
                <img
                  src={image}
                  alt="captcha"
                  className={`w-full object-cover${expired ? ' blur-[2px]' : ''}`}
                />
              ) : null}
              {expired || loadFailed || !image ? (
                <span className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-[10px] leading-[14px] text-white">
                  {expired ? <span>{t('captcha.expired')}</span> : null}
                  <span>{t('captcha.tap_refresh')}</span>
                </span>
              ) : null}
            </>
          )}
          <span className="absolute right-0 bottom-0 flex items-center justify-center rounded-tl bg-black/45 px-1 py-[1px] text-[10px] leading-[14px] text-white">
            <ReloadOutlined />
          </span>
        </button>
      </div>
      {hint ? (
        <p className="mt-2 text-xs text-[#E5484D]">
          {hint === 'captcha' ? t('captcha.error') : t('captcha.send_fail')}
        </p>
      ) : null}
    </Modal>
  )
}

export default CaptchaModal
