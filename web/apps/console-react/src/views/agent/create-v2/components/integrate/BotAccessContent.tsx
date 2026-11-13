import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Avatar, Button, Input, Modal, Select, Spin, Switch, Typography, message } from 'antd'
import { CameraOutlined, CopyOutlined, ReloadOutlined, RobotOutlined } from '@ant-design/icons'
import { t } from '@/locales'
import { copyToClip, getSimpleDateFormatString, sleep } from '@km/shared-utils'
import { SafeImage } from '@km/shared-components-react'
import botGatewayApi, {
  type BotBindItem,
  type BotDeviceType,
  type BotGatewayBotDetail,
  type BotGatewayBotItem,
  type BotGatewayProvider,
  type BotLoginRegionsResult,
} from '@/api/modules/bot-gateway'

interface BotAccessContentProps {
  agentId?: string | number
}

/** 二维码有效期（毫秒） */
const QR_EXPIRE_MS = 1000 * 120
/** 取码冷却（毫秒）：每次取码作废旧码且平台有节流，防手抖连点 */
const QR_COOLDOWN_MS = 2000
/** 连续轮询失败达到该次数后终止并提示 */
const MAX_POLL_FAILURES = 3
/** 建绑后列表同步：后端索引可能延迟，未出现新绑定时间隔重试（次数 × 间隔秒） */
const SYNC_MAX_ATTEMPTS = 3
const SYNC_RETRY_DELAY_S = 1.5

/** 轮询间隔：企微 3s / 个微 5s（对齐参考实现 wechat.vue） */
const POLL_INTERVAL = (provider?: BotGatewayProvider): number => (provider === 'wework' ? 3000 : 5000)

/** 个微设备形态选项（iPad 需 IOS 人脸认证 APP，Mac 自动认证） */
const DEVICE_OPTIONS: { value: BotDeviceType; labelKey: string; descKey: string }[] = [
  { value: 'ipad', labelKey: 'integrate.bot_access.device_ipad', descKey: 'integrate.bot_access.device_ipad_desc' },
  { value: 'mac', labelKey: 'integrate.bot_access.device_mac', descKey: 'integrate.bot_access.device_mac_desc' },
]

/** iPad 认证 APP 下载地址（参考实现固定外链） */
const IPAD_AUTH_APP_URL = 'https://www.pgyer.com/renzhengapp'

/** 扫码登录会话（取码响应回填；登录凭证一律用绑定 id，不存 bot_token） */
interface LoginContext {
  deviceId?: string
  uuid?: string
}

/** 始终读取最新值的 ref */
function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

/**
 * 拉取绑定列表；带 expectedBindId 时为建绑后同步——
 * 后端列表可能延迟，未出现新绑定时间隔重试，耗尽返回 null（调用方保留乐观数据）
 */
async function fetchBindsUntil(agentId: string, expectedBindId?: string): Promise<BotBindItem[] | null> {
  for (let attempt = 0; attempt < SYNC_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(SYNC_RETRY_DELAY_S)
    const res = await botGatewayApi.getBinds(agentId)
    const list = res?.list || []
    if (!expectedBindId || list.some((item) => item.id === expectedBindId)) return list
  }
  return null
}

/** 可复制的属性行（点击文字或图标复制；onFetch 用于复制前取完整值，如回调地址列表中已脱敏） */
function CopyRow({ label, value, onFetch }: { label: string; value: string; onFetch?: () => Promise<string> }) {
  const handleCopy = async (): Promise<void> => {
    let text = value
    if (onFetch) {
      // 失败已由 handleError 提示，拿到空值不复制
      text = await onFetch().catch(() => '')
      if (!text) return
    }
    if (!text) return
    const success = await copyToClip(text)
    if (success) message.success(t('action_copy_success'))
  }

  return (
    <div className="flex items-center h-7">
      <div className="text-sm text-secondary flex-none">{label}：</div>
      <Typography.Text
        className="flex-1 min-w-0 text-sm text-primary cursor-pointer"
        ellipsis={{ tooltip: value }}
        onClick={handleCopy}
      >
        {value || '--'}
      </Typography.Text>
      <CopyOutlined className="cursor-pointer ml-1 text-tertiary hover:text-brand flex-none" onClick={handleCopy} />
    </div>
  )
}

/** 只读属性行 */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center h-7">
      <div className="text-sm text-secondary flex-none">{label}：</div>
      <div className="text-sm text-primary truncate">{value || '--'}</div>
    </div>
  )
}

export const BotAccessContent = ({ agentId }: BotAccessContentProps) => {
  // ===== 绑定状态（无列表展示，只管理最新一条绑定） =====
  const [loading, setLoading] = useState(true)
  const [bind, setBind] = useState<BotBindItem | null>(null)
  /** 绑定机器人的实时信息（在线 / 名称，来自 bots 列表） */
  const [botInfo, setBotInfo] = useState<BotGatewayBotItem | null>(null)
  /** 绑定机器人详情（头像 / 昵称），在线时拉取，登录绑定区回显 */
  const [botDetail, setBotDetail] = useState<BotGatewayBotDetail | null>(null)

  // ===== 新建绑定表单 =====
  const [provider, setProvider] = useState<BotGatewayProvider>('wework')
  const [tokenInput, setTokenInput] = useState('')
  const [creating, setCreating] = useState(false)

  // ===== 扫码登录弹窗 =====
  const [qrVisible, setQrVisible] = useState(false)
  const [qrImg, setQrImg] = useState('')
  const [qrLoading, setQrLoading] = useState(false)
  const [qrExpired, setQrExpired] = useState(false)
  const [captcha, setCaptcha] = useState('') /** 个微数字验证码（随下次轮询提交） */
  const [verifyInput, setVerifyInput] = useState('') /** 企微辅助验证码（status=10 时提交） */
  /** 本次会话扫码登录成功后的账号信息 */
  const [loginUser, setLoginUser] = useState<{ nickname?: string; botId?: string } | null>(null)

  // ===== 弹窗表单（地区 / 设备形态） =====
  const [regions, setRegions] = useState<BotLoginRegionsResult | null>(null)
  const [region, setRegion] = useState('')
  const [deviceType, setDeviceType] = useState<BotDeviceType>('mac')

  // ===== 轮询中间态 =====
  /** 最近一次轮询 status：1=已扫码待确认（展示提示），0=等待扫码 */
  const [pollStatus, setPollStatus] = useState<number | null>(null)
  /** 个微：需 App 扫码完成图形验证 */
  const [needAppVerify, setNeedAppVerify] = useState(false)
  const [appVerifyUrl, setAppVerifyUrl] = useState('')
  /** 企微：status=10 需辅助验证码，暂停轮询等提交 */
  const [needVerify, setNeedVerify] = useState(false)

  const loginCtxRef = useRef<LoginContext | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const expireTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const pollFailCountRef = useRef(0)
  const qrCooldownRef = useRef(0)

  const captchaRef = useLatest(captcha)
  /** 轮询 / 取码回调中经 ref 读最新绑定（id 为登录凭证） */
  const bindRef = useLatest(bind)

  /** 渠道选项（渲染时取 t，跟随语言切换） */
  const providerOptions = [
    { value: 'wework' as BotGatewayProvider, label: t('integrate.bot_access.provider_wework') },
    { value: 'wechat' as BotGatewayProvider, label: t('integrate.bot_access.provider_wechat') },
  ]

  const providerLabel = (value: BotGatewayProvider): string =>
    value === 'wechat' ? t('integrate.bot_access.provider_wechat') : t('integrate.bot_access.provider_wework')

  // ===== 数据加载 =====
  const loadData = useCallback(async (options?: { expectedBindId?: string }): Promise<void> => {
    if (!agentId) {
      setLoading(false)
      return
    }
    const { expectedBindId } = options || {}
    // 建绑后同步：乐观数据已展示，静默拉取，不闪全局 loading
    if (!expectedBindId) setLoading(true)
    try {
      const [bindList, botsRes] = await Promise.all([
        fetchBindsUntil(String(agentId), expectedBindId),
        // 在线状态仅用于展示，失败不阻塞绑定信息
        botGatewayApi.getBots().catch(() => ({ list: [] as BotGatewayBotItem[] })),
      ])
      if (!bindList) {
        // 建绑同步重试耗尽：保留建绑响应的乐观数据，不回退表单
        return
      }
      const latest = bindList.length
        ? bindList.reduce((a, b) => (b.created_time > a.created_time ? b : a))
        : null
      setBind(latest)
      const matched = latest?.bot_id
        ? (botsRes?.list || []).find((bot) => bot.botId === latest.bot_id) || null
        : null
      setBotInfo(matched)
      setBotDetail(null)
      // 在线时拉取详情，回显登录账号头像 / 昵称（对齐 wechat.vue 刷新后的展示）
      if (matched?.online === true) {
        botGatewayApi
          .getBotDetail(matched.botId)
          .then((detail) => setBotDetail(detail?.botId ? detail : null))
          .catch(() => {})
      }
    } catch {
      // 错误已由 handleError 提示
    } finally {
      if (!expectedBindId) setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 卸载清理定时器
  useEffect(() => {
    return () => {
      clearTimeout(pollTimerRef.current)
      clearTimeout(expireTimerRef.current)
    }
  }, [])

  // ===== 新建绑定 =====
  const handleCreateBind = useCallback(
    async (replace = false): Promise<void> => {
      if (!agentId) {
        message.warning(t('integrate.please_save_agent'))
        return
      }
      const token = tokenInput.trim()
      if (!token) {
        message.warning(t('integrate.bot_access.token_required'))
        return
      }
      setCreating(true)
      try {
        const result = await botGatewayApi.createBind({
          agent_id: String(agentId),
          token,
          provider,
          replace,
        })
        if (result?.conflict) {
          // HTTP 200 且 conflict=true：走替换确认弹窗，不当错误处理
          Modal.confirm({
            title: t('integrate.bot_access.conflict_title'),
            content: result.message || t('integrate.bot_access.conflict_content'),
            okText: t('action_confirm'),
            cancelText: t('action_cancel'),
            onOk: () => handleCreateBind(true),
          })
          return
        }
        // 建绑成功：先以建绑响应乐观进入已绑定态（主操作 = 复制回调地址），再走 loadData 同步服务端数据
        setBind({
          id: result.id || '',
          bot_id: result.bot_id || '',
          provider: result.provider || provider,
          agent_id: String(agentId),
          platform_callback_url: result.platform_callback_url || '',
          enabled: true,
          created_time: Date.now(),
        })
        setBotInfo(null)
        setBotDetail(null)
        setLoginUser(null)
        setTokenInput('')
        // 后端列表可能延迟：loadData 内部会重试直到新绑定出现，耗尽则保留上面的乐观数据
        if (result.id) {
          loadData({ expectedBindId: result.id })
        }
      } catch {
        // 400 定位表单字段 / 502 网关冲突等，错误已由 handleError 提示
      } finally {
        setCreating(false)
      }
    },
    [agentId, tokenInput, provider, loadData],
  )

  // ===== 扫码登录 =====
  const stopLoginTimers = useCallback((): void => {
    clearTimeout(pollTimerRef.current)
    clearTimeout(expireTimerRef.current)
  }, [])

  /** 关闭扫码弹窗并清理全部会话状态（保留 loginUser） */
  const resetQrState = useCallback((): void => {
    stopLoginTimers()
    setQrVisible(false)
    setQrImg('')
    setQrExpired(false)
    setCaptcha('')
    setVerifyInput('')
    setNeedAppVerify(false)
    setAppVerifyUrl('')
    setNeedVerify(false)
    setPollStatus(null)
    loginCtxRef.current = null
  }, [stopLoginTimers])

  /** 轮询登录状态；immediate=true 时立即执行一次（如提交验证码后） */
  const pollLogin = useCallback(
    (immediate = false): void => {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = setTimeout(
        async () => {
          const currentBind = bindRef.current
          const ctx = loginCtxRef.current
          if (!currentBind || !ctx) return
          try {
            const data: { id: string; device_id?: string; uuid?: string; captch_code?: string } = {
              id: currentBind.id,
            }
            if (ctx.deviceId) data.device_id = ctx.deviceId
            if (ctx.uuid) data.uuid = ctx.uuid
            // 个微数字验证码只能随轮询提交；企微验证码走 loginVerify
            if (currentBind.provider === 'wechat') {
              const code = captchaRef.current.trim()
              if (code) data.captch_code = code
            }
            const res = await botGatewayApi.loginPoll(data)
            pollFailCountRef.current = 0
            if (res.isLogin) {
              setLoginUser({ nickname: res.nickname || res.corpName, botId: res.botId })
              message.success(t('integrate.bot_access.login_success'))
              resetQrState()
              loadData()
              return
            }
            setPollStatus(res.status)
            if (currentBind.provider === 'wework') {
              // 企微 7 状态码：10 暂停轮询等验证码；-1/4/3 终止并给出重试遮罩；0/1 继续轮询
              if (res.status === 10) {
                setNeedVerify(true)
                return
              }
              if (res.status === -1) {
                setQrExpired(true)
                return
              }
              if (res.status === 4) {
                message.info(t('integrate.bot_access.canceled_tip'))
                setQrExpired(true)
                return
              }
              if (res.status === 3) {
                message.error(t('integrate.bot_access.login_failed'))
                setQrExpired(true)
                return
              }
            } else {
              // 个微：needAppVerify 时继续轮询（等 App 完成验证），其余 status=1 中间态同样继续
              setNeedAppVerify(!!res.needAppVerify)
              setAppVerifyUrl(res.appVerifyUrl || '')
              if (res.status === 4) {
                message.info(t('integrate.bot_access.canceled_tip'))
                setQrExpired(true)
                return
              }
            }
            pollLogin()
          } catch {
            pollFailCountRef.current += 1
            if (pollFailCountRef.current >= MAX_POLL_FAILURES) {
              // 展示刷新遮罩，用户可点击重试
              setQrExpired(true)
              message.error(t('integrate.bot_access.login_failed'))
              return
            }
            pollLogin()
          }
        },
        immediate ? 0 : POLL_INTERVAL(bindRef.current?.provider),
      )
    },
    [captchaRef, resetQrState, loadData, bindRef],
  )

  /** 获取登录二维码并开始轮询（凭证为绑定 id；个微必传设备形态） */
  const fetchQrcode = useCallback(async (): Promise<void> => {
    const currentBind = bindRef.current
    if (!currentBind) return
    if (!region) {
      message.warning(t('integrate.bot_access.region_required'))
      return
    }
    const now = Date.now()
    if (now < qrCooldownRef.current) {
      message.warning(t('integrate.bot_access.too_frequent'))
      return
    }
    qrCooldownRef.current = now + QR_COOLDOWN_MS
    setQrLoading(true)
    setQrExpired(false)
    setNeedAppVerify(false)
    setAppVerifyUrl('')
    setNeedVerify(false)
    setPollStatus(null)
    pollFailCountRef.current = 0
    try {
      const res = await botGatewayApi.loginQrcode({
        id: currentBind.id,
        region: region || undefined,
        type: currentBind.provider === 'wechat' ? deviceType : undefined,
      })
      loginCtxRef.current = { deviceId: res.deviceId, uuid: res.uuid }
      setQrImg(res.qrImgBase64 || '')
      stopLoginTimers()
      pollLogin()
      expireTimerRef.current = setTimeout(() => {
        clearTimeout(pollTimerRef.current)
        setQrExpired(true)
      }, QR_EXPIRE_MS)
    } catch {
      // 错误已由 handleError 提示
    } finally {
      setQrLoading(false)
    }
  }, [region, deviceType, stopLoginTimers, pollLogin, bindRef])

  /** 登录入口：打开弹窗并拉取地区列表（传 id 后端自动推断 provider） */
  const handleLoginClick = useCallback((): void => {
    const currentBind = bindRef.current
    if (!currentBind) return
    resetQrState()
    setRegion('')
    setDeviceType('mac')
    setRegions(null)
    setQrVisible(true)
    botGatewayApi
      .loginRegions({ id: currentBind.id })
      .then((res) => {
        setRegions(res)
        setRegion(res.list.find((item) => item.is_default)?.code || '')
      })
      .catch(() => {
        // 错误已由 handleError 提示；地区仍可手动选择后重试
      })
  }, [resetQrState, bindRef])

  /** 已有二维码时切换地区 / 设备形态：作废当前码（每次取码作废旧码，避免扫了旧码） */
  const invalidateQrImage = useCallback((): void => {
    if (!qrImg) return
    stopLoginTimers()
    setQrImg('')
    setQrExpired(false)
    setNeedAppVerify(false)
    setAppVerifyUrl('')
    setNeedVerify(false)
    setPollStatus(null)
    loginCtxRef.current = null
    message.info(t('integrate.bot_access.region_changed'))
  }, [qrImg, stopLoginTimers])

  const handleRegionChange = (value: string): void => {
    setRegion(value)
    invalidateQrImage()
  }

  const handleDeviceTypeChange = (value: BotDeviceType): void => {
    setDeviceType(value)
    invalidateQrImage()
  }

  /** 提交企微辅助验证码（status=10），成功后立即恢复轮询 */
  const handleVerify = useCallback(async (): Promise<void> => {
    const currentBind = bindRef.current
    const ctx = loginCtxRef.current
    const code = verifyInput.trim()
    if (!currentBind || !ctx || !code) {
      message.warning(t('integrate.bot_access.verify_required'))
      return
    }
    try {
      await botGatewayApi.loginVerify({ id: currentBind.id, device_id: ctx.deviceId || '', code })
      message.success(t('integrate.bot_access.verify_success'))
      setVerifyInput('')
      setNeedVerify(false)
      pollLogin(true)
    } catch {
      // 错误已由 handleError 提示
    }
  }, [verifyInput, pollLogin, bindRef])

  /** 退出登录（凭证为绑定 id，后端自动使用已持久化设备） */
  const handleLogout = useCallback((): void => {
    const currentBind = bindRef.current
    if (!currentBind) return
    Modal.confirm({
      content: t('integrate.bot_access.logout_confirm'),
      okText: t('action_confirm'),
      cancelText: t('action_cancel'),
      onOk: async () => {
        await botGatewayApi.loginLogout({ id: currentBind.id })
        setLoginUser(null)
        message.success(t('integrate.bot_access.logout_success'))
        loadData()
      },
    })
  }, [loadData, bindRef])

  // ===== 启停 / 删除 =====
  const handleToggleEnabled = useCallback(
    (enabled: boolean): void => {
      if (!bind) return
      if (!enabled) {
        // 停用立即生效：上行消息静默丢弃，需明确提示
        Modal.confirm({
          content: t('integrate.bot_access.disable_confirm'),
          okText: t('action_confirm'),
          cancelText: t('action_cancel'),
          onOk: async () => {
            await botGatewayApi.updateBind(bind.id, { enabled: false })
            setBind({ ...bind, enabled: false })
          },
        })
        return
      }
      botGatewayApi
        .updateBind(bind.id, { enabled: true })
        .then(() => setBind({ ...bind, enabled: true }))
        .catch(() => {})
    },
    [bind],
  )

  const handleDeleteBind = useCallback((): void => {
    if (!bind) return
    Modal.confirm({
      content: t('integrate.bot_access.delete_confirm'),
      okText: t('action_confirm'),
      cancelText: t('action_cancel'),
      onOk: async () => {
        try {
          await botGatewayApi.deleteBind(bind.id)
        } catch {
          // 404=绑定不存在等，错误已提示；删除为 best-effort，无论成败都回到未绑定态
        }
        setBind(null)
        setBotInfo(null)
        setBotDetail(null)
        setLoginUser(null)
      },
    })
  }, [bind])

  // ===== 渲染 =====
  /** 登录绑定区展示名：扫码登录昵称 > 机器人详情昵称 > 网关机器人名 > 状态文案 */
  const isOnline = !!loginUser || botInfo?.online === true
  const loginSectionName = isOnline
    ? loginUser?.nickname || botDetail?.nickname || botInfo?.name || t('integrate.bot_access.online')
    : t('integrate.bot_access.not_logged_in')
  /** 扫码提示语按渠道区分（个微为分身号场景） */
  const scanTip = bind?.provider === 'wechat'
    ? t('integrate.bot_access.scan_tip_wechat')
    : t('integrate.bot_access.scan_tip_wework')
  const isWechat = bind?.provider === 'wechat'

  return (
    <Spin spinning={loading}>
      <div className="max-w-3xl">
        {/* 接入说明 */}
        <div className="text-base text-primary font-semibold">{t('integrate.bot_access.intro_title')}</div>

        <div className="border border-default rounded-lg mt-6 p-7">
          {!bind ? (
            <div>
              <div className="text-sm text-primary font-medium mb-4">{t('integrate.bot_access.create_bind')}</div>
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  className="w-[150px]"
                  value={provider}
                  options={providerOptions}
                  onChange={(value) => setProvider(value)}
                />
                <Input
                  className="w-[360px]"
                  value={tokenInput}
                  placeholder={t('integrate.bot_access.token_placeholder')}
                  onChange={(e) => setTokenInput(e.target.value)}
                />
                <Button
                  type="primary"
                  loading={creating}
                  disabled={!tokenInput.trim()}
                  onClick={() => handleCreateBind()}
                >
                  {t('integrate.bot_access.bind')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-sm">
              <div className="text-secondary">{t('integrate.bot_access.bind_info')}</div>
              <div className="mt-4">
                {/* 列表中的回调地址已脱敏，复制时调专用接口取完整地址 */}
                <CopyRow
                  label={t('integrate.bot_access.callback_url')}
                  value={bind.platform_callback_url}
                  onFetch={() =>
                    botGatewayApi
                      .getCallbackUrl(bind.id)
                      .then((res) => res.platform_callback_url || '')
                  }
                />
                <InfoRow
                  label={t('integrate.bot_access.bot_id_label')}
                  value={bind.bot_id || t('integrate.bot_access.bot_id_pending')}
                />
                <InfoRow label={t('integrate.bot_access.provider_col')} value={providerLabel(bind.provider)} />
                <InfoRow
                  label={t('integrate.bot_access.created_col')}
                  value={
                    bind.created_time
                      ? getSimpleDateFormatString({ date: bind.created_time, format: 'YYYY-MM-DD hh:mm' })
                      : ''
                  }
                />
              </div>

              {/* 登录绑定 */}
              <div className="border-t my-6" />
              <div className="text-sm text-secondary">{t('integrate.bot_access.qr_login')}</div>
              <div className="flex items-center gap-3 mt-4">
                <Avatar
                  size={40}
                  shape="square"
                  className="flex-none bg-brand-light"
                  icon={<RobotOutlined />}
                  src={botDetail?.avatar || undefined}
                />
                <div className="flex-1 text-primary text-sm truncate">{loginSectionName}</div>
                {isOnline ? (
                  <Button
                    type="text"
                    className="!px-0 text-secondary hover:!text-brand"
                    onClick={handleLogout}
                  >
                    {t('integrate.bot_access.logout')}
                  </Button>
                ) : (
                  <Button type="primary" onClick={handleLoginClick}>
                    {t('integrate.bot_access.qr_login')}
                  </Button>
                )}
              </div>

              {/* 启停 / 删除 */}
              <div className="border-t my-6" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-secondary">{t('integrate.bot_access.enabled_col')}</span>
                  <Switch checked={bind.enabled} onChange={handleToggleEnabled} />
                </div>
                <Button type="link" danger className="!px-0" onClick={handleDeleteBind}>
                  {t('integrate.bot_access.delete_bind')}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* 扫码登录弹窗（凭证为绑定 id；企微 / 个微按渠道渲染表单与状态分支） */}
        <Modal
          open={qrVisible}
          title={t('integrate.bot_access.qr_login')}
          width={640}
          onCancel={resetQrState}
          footer={[
            <Button key="cancel" onClick={resetQrState}>
              {t('action_cancel')}
            </Button>,
          ]}
        >
          <div className="py-2">
            {/* 设备地区（企微 areaCode 须与手机端所在省一致，跨省触发风控；hint 来自接口） */}
            <div className="flex items-start">
              <div className="w-[100px] flex-none text-sm text-secondary leading-8">
                {t('integrate.bot_access.region')}
              </div>
              <div className="flex-1 min-w-0">
                <Select
                  className="w-full"
                  value={region || undefined}
                  placeholder={t('integrate.bot_access.region_placeholder')}
                  options={(regions?.list || []).map((item) => ({ value: item.code, label: item.name }))}
                  onChange={handleRegionChange}
                />
                {regions?.hint && <div className="text-xs text-tertiary mt-1">{regions.hint}</div>}
              </div>
            </div>

            {/* 设备形态（仅个微：ipad 需 IOS 人脸认证，mac 自动认证） */}
            {isWechat && (
              <div className="flex items-start mt-4">
                <div className="w-[100px] flex-none text-sm text-secondary leading-8">
                  {t('integrate.bot_access.device_type')}
                </div>
                <div className="flex-1 flex gap-3">
                  {DEVICE_OPTIONS.map((opt) => (
                    <div
                      key={opt.value}
                      className={`flex-1 flex items-center cursor-pointer border rounded-lg px-4 py-3 select-none transition-colors ${
                        deviceType === opt.value ? 'border-brand bg-brand-light' : 'border-default hover:border-brand'
                      }`}
                      onClick={() => handleDeviceTypeChange(opt.value)}
                    >
                      <span
                        className={`mr-2 w-4 h-4 rounded-full border-2 flex-none inline-flex items-center justify-center ${
                          deviceType === opt.value ? 'border-brand' : 'border-[#C9CDD4]'
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${deviceType === opt.value ? 'bg-brand' : 'bg-transparent'}`}
                        />
                      </span>
                      <div>
                        <div
                          className={`text-sm font-medium ${deviceType === opt.value ? 'text-brand' : 'text-primary'}`}
                        >
                          {t(opt.labelKey)}
                        </div>
                        <div className="text-xs text-tertiary">{t(opt.descKey)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {isWechat && deviceType === 'ipad' && (
              <div className="mt-3 pl-[100px]">
                <Alert
                  type="warning"
                  showIcon
                  message={
                    <span className="text-xs">
                      {t('integrate.bot_access.ipad_tip')}
                      <a className="text-brand underline" href={IPAD_AUTH_APP_URL} target="_blank" rel="noreferrer">
                        {IPAD_AUTH_APP_URL}
                      </a>
                      {t('integrate.bot_access.ipad_tip_suffix')}
                    </span>
                  }
                />
              </div>
            )}

            {/* 扫码登录 */}
            <div className="flex items-start mt-4">
              <div className="w-[100px] flex-none text-sm text-secondary leading-8">
                {t('integrate.bot_access.qr_login')}
              </div>
              <div className="flex-1 min-w-0">
                {/* 提示 / 二维码 / 有效期整体居中（对齐参考实现 wechat.vue） */}
                <div className="w-[210px] mx-auto text-center">
                  <div className="text-sm text-primary">{scanTip}</div>
                  <div className="relative w-[200px] h-[200px] mx-auto my-2 border border-default rounded-lg bg-white p-2">
                    {qrLoading ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <Spin />
                      </div>
                    ) : (
                      qrImg && <SafeImage className="w-full h-full" src={qrImg} alt="" />
                    )}
                    {!qrLoading && !qrImg && (
                      <div
                        className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center cursor-pointer"
                        onClick={fetchQrcode}
                      >
                        <CameraOutlined className="text-2xl text-white" />
                        <div className="text-sm text-white mt-2">{t('integrate.bot_access.get_qrcode')}</div>
                      </div>
                    )}
                    {qrExpired && (
                      <div
                        className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center cursor-pointer"
                        onClick={fetchQrcode}
                      >
                        <ReloadOutlined className="text-2xl text-white" />
                        <div className="text-sm text-white mt-2">{t('integrate.bot_access.qr_expired')}</div>
                        <div className="text-sm text-brand">{t('integrate.bot_access.click_refresh')}</div>
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-brand">{t('integrate.bot_access.qr_valid_tip')}</div>
                  {qrImg && !qrExpired && (
                    <div className="text-xs text-tertiary mt-1">{t('integrate.bot_access.wait_detect_tip')}</div>
                  )}
                  {pollStatus === 1 && (
                    <div className="text-xs text-secondary mt-1">{t('integrate.bot_access.scanned_tip')}</div>
                  )}
                </div>
                {/* 个微：需 App 扫码完成图形验证，验证期间保持轮询 */}
                {needAppVerify && (
                  <Alert
                    className="mt-3"
                    type="warning"
                    showIcon
                    message={t('integrate.bot_access.need_app_verify')}
                    description={
                      appVerifyUrl ? (
                        <span className="text-xs break-all">
                          {t('integrate.bot_access.app_verify_tip')}
                          <a className="text-brand underline" href={appVerifyUrl} target="_blank" rel="noreferrer">
                            {appVerifyUrl}
                          </a>
                        </span>
                      ) : undefined
                    }
                  />
                )}
              </div>
            </div>

            {/* 数字验证码（仅个微 iPad：扫码后手机弹出 6 位码，随下次轮询提交） */}
            {isWechat && deviceType === 'ipad' && (
              <div className="flex items-center mt-4">
                <div className="w-[100px] flex-none text-sm text-secondary">
                  {t('integrate.bot_access.captcha')}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    className="w-[180px]"
                    maxLength={6}
                    value={captcha}
                    placeholder={t('integrate.bot_access.captcha_tip')}
                    onChange={(e) => setCaptcha(e.target.value)}
                  />
                  <Button disabled={!captcha.trim()} onClick={() => pollLogin(true)}>
                    {t('action_confirm')}
                  </Button>
                </div>
              </div>
            )}

            {/* 辅助验证码（仅企微 status=10：暂停轮询，提交后恢复） */}
            {!isWechat && needVerify && (
              <div className="flex items-start mt-4">
                <div className="w-[100px] flex-none text-sm text-secondary leading-8">
                  {t('integrate.bot_access.verify_code')}
                </div>
                <div className="flex-1 min-w-0">
                  <Alert type="warning" showIcon message={t('integrate.bot_access.need_verify_tip')} />
                  <div className="flex items-center gap-2 mt-3">
                    <Input
                      className="w-[240px]"
                      maxLength={6}
                      value={verifyInput}
                      placeholder={t('integrate.bot_access.verify_tip')}
                      onChange={(e) => setVerifyInput(e.target.value)}
                    />
                    <Button type="primary" disabled={!verifyInput.trim()} onClick={handleVerify}>
                      {t('action_confirm')}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Modal>
      </div>
    </Spin>
  )
}

export default BotAccessContent
