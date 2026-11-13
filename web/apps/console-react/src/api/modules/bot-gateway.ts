import service from '../config'
import { handleError } from '../error-handler'

/**
 * bot-gateway 机器人接入接口
 *
 * 对接文档：src/views/agent/create-v2/components/integrate/20260921-bot-gateway前端对接.md
 * 前端只调用 AgentHub 管理 API，不直接接触 bot-gateway（网关地址与 ADMIN_TOKEN 由后端持有）。
 *
 * 通用约定：
 * - 响应统一包裹 {"code":0,"message":"ok","data":{...}}，非 0 即错误，message 可直接提示
 * - id / agent_id 为 hashids 字符串，原样回传，不做数字处理
 * - bot_token 严禁前端存储；登录 / 退出一律以绑定 id 为凭证
 */

/** 接入渠道：wework=企业微信 wechat=个人微信 */
export type BotGatewayProvider = 'wework' | 'wechat'

/** 个微设备形态：ipad=IOS 人脸认证 mac=自动认证 */
export type BotDeviceType = 'ipad' | 'mac'

/** 新建绑定请求 */
export interface CreateBotBindParams {
  /** 智能体 ID（hashids） */
  agent_id: string
  /** saas 平台 Token */
  token: string
  /** 接入渠道 */
  provider: BotGatewayProvider
  /** 同一 bot 已绑定时替换旧绑定 */
  replace?: boolean
}

/** 新建绑定响应；conflict=true 表示已绑定其它接入（HTTP 200），确认后需带 replace=true 重试 */
export interface CreateBotBindResult {
  /** 绑定 ID（hashids） */
  id?: string
  /** 可能为空（尚未登录/回调回填），展示时显示「待识别」 */
  bot_id?: string
  provider?: BotGatewayProvider
  agent_id?: string
  /** 仅建绑响应返回，不落前端持久化 */
  bot_token?: string
  /** 展示给用户复制，填入 saas 平台后台的回调配置（已内嵌 bot_token） */
  platform_callback_url?: string
  /** replace=true 替换成功时为 true */
  replaced?: boolean
  /** 冲突标记（HTTP 200，不要当错误处理） */
  conflict?: boolean
  /** 冲突说明，可直接提示 */
  message?: string
}

/** 绑定记录 */
export interface BotBindItem {
  /** 绑定 ID（hashids） */
  id: string
  bot_id: string
  provider: BotGatewayProvider
  agent_id: string
  platform_callback_url: string
  enabled: boolean
  /** 毫秒时间戳 */
  created_time: number
}

/** 机器人列表项；online 三态：true 在线 / false 确认离线 / null 未检测（切忌当离线） */
export interface BotGatewayBotItem {
  botId: string
  name?: string
  online: boolean | null
  status?: string
}

/** 机器人详情 */
export interface BotGatewayBotDetail {
  botId: string
  nickname?: string
  avatar?: string
  online: boolean
}

/** 登录地区选项 */
export interface BotLoginRegionItem {
  code: string
  name: string
  is_default?: boolean
}

/** 登录地区列表响应；hint 需展示在下拉框旁 */
export interface BotLoginRegionsResult {
  provider: BotGatewayProvider
  param_key: string
  hint?: string
  list: BotLoginRegionItem[]
}

/** 取码参数 */
export interface BotLoginQrcodeParams {
  /** 绑定 ID（hashids），登录 / 退出的法定凭证 */
  id: string
  /** 地区代码（企微 areaCode / 个微 regionId），须与手机端所在省一致 */
  region?: string
  /** 个微设备形态（个微必传） */
  type?: BotDeviceType
  /** 强制新建设备（换设备）；当前号在线时须先退出登录，否则平台报超限 */
  force_new?: boolean
  /** 显式指定设备（日常留空，后端回退到绑定已持久化设备） */
  device_id?: string
  /** 个微独立代理（格式 socks5://user:pass@ip:port） */
  proxy_ip?: string
  /** 个微代理本机标识 */
  ttuid?: string
}

/** 扫码登录二维码 */
export interface BotLoginQrcodeResult {
  /** data:image/...;base64，直接赋给 <img src> */
  qrImgBase64: string
  /** 二维码原始链接（自渲染 / 复制用，企微一般为空） */
  qrUrl?: string
  /** 平台设备 ID（企微 guid / 个微 appId） */
  deviceId?: string
  /** 个微专用：本次二维码会话 ID */
  uuid?: string
  /** 是否复用已有设备（false = 新建 / 重建了设备，前端无需特殊处理） */
  reuse?: boolean
  /** 传入 region 是否真正下发（等于 !reuse） */
  regionApplied?: boolean
}

/** 登录轮询结果 */
export interface BotLoginPollResult {
  isLogin: boolean
  /** 企微：2 成功 10 待验证码 1 已扫码 0 待扫码 -1 失效 4 取消 3 失败；个微：2 成功 1 已扫码 0 待扫码 4 取消 */
  status: number
  botId?: string
  nickname?: string
  corpName?: string
  /** 个微：需 App 扫码完成图形验证（status=1 时靠此字段区分） */
  needAppVerify?: boolean
  appVerifyUrl?: string
}

/**
 * 解包 {code, message, data} 响应。
 * code 非 0 时 reject（结构对齐 handleError 的 ErrorResponse），由外层 .catch(handleError) 统一提示。
 */
function unwrap<T>(res: unknown): Promise<T> {
  const wrapper = res as { code?: number; data?: T } | null
  if (wrapper && typeof wrapper === 'object' && wrapper.code !== undefined) {
    if (wrapper.code !== 0) {
      return Promise.reject({ response: { data: wrapper } })
    }
    return Promise.resolve((wrapper.data ?? {}) as T)
  }
  return Promise.resolve(res as T)
}

export const botGatewayApi = {
  /** 机器人列表（online 为实时在线状态） */
  getBots(): Promise<{ list: BotGatewayBotItem[] }> {
    return service.get('/api/bot-gateway/bots').then(unwrap).catch(handleError)
  },

  /** 绑定列表；传 agentId 只看该 agent 关联的全部机器人 */
  getBinds(agentId?: string): Promise<{ list: BotBindItem[] }> {
    return service
      .get('/api/bot-gateway/binds', { params: agentId ? { agent_id: agentId } : undefined })
      .then(unwrap)
      .catch(handleError)
  },

  /** 新建绑定；token 优先，无需先扫码拿到 botId 即可建绑 */
  createBind(data: CreateBotBindParams): Promise<CreateBotBindResult> {
    return service.post('/api/bot-gateway/binds', data).then(unwrap).catch(handleError)
  },

  /** 启停绑定；停用立即生效，停用期间该 bot 上行消息静默丢弃 */
  updateBind(id: string, data: { enabled: boolean }): Promise<{ id: string; enabled: boolean }> {
    return service.patch(`/api/bot-gateway/binds/${id}`, data).then(unwrap).catch(handleError)
  },

  /** 删除绑定（best-effort：网关侧不可达时仍删本地记录） */
  deleteBind(id: string): Promise<unknown> {
    return service.delete(`/api/bot-gateway/binds/${id}`).then(unwrap).catch(handleError)
  },

  /** 机器人实时在线状态 */
  getBotOnline(botId: string): Promise<{ bot_id: string; online: boolean }> {
    return service.get(`/api/bot-gateway/bots/${botId}/online`).then(unwrap).catch(handleError)
  },

  /** 机器人详情（昵称 / 头像） */
  getBotDetail(botId: string): Promise<BotGatewayBotDetail> {
    return service.get(`/api/bot-gateway/bots/${botId}/detail`).then(unwrap).catch(handleError)
  },

  /** 登录地区列表（打开扫码弹窗时拉取；传 id 时后端自动推断 provider） */
  loginRegions(params: { id?: string; provider?: BotGatewayProvider }): Promise<BotLoginRegionsResult> {
    return service.get('/api/bot-gateway/login/regions', { params }).then(unwrap).catch(handleError)
  },

  /** 完整回调地址（未脱敏；仅用户点击复制时调用，严禁前端持久化） */
  getCallbackUrl(id: string): Promise<{ id: string; bot_id: string; platform_callback_url: string }> {
    return service.get(`/api/bot-gateway/binds/${id}/callback-url`).then(unwrap).catch(handleError)
  },

  /**
   * 扫码登录取码。每次调用作废旧码，同设备取码有平台节流，
   * 调用方需做冷却限制（建议 2s）。
   */
  loginQrcode(data: BotLoginQrcodeParams): Promise<BotLoginQrcodeResult> {
    return service.post('/api/bot-gateway/login/qrcode', data).then(unwrap).catch(handleError)
  },

  /**
   * 登录轮询（企微 3s / 个微 5s 一次，二维码 120s 有效）。
   * 轮询中的临时错误不弹全局提示，由调用方决定重试 / 终止。
   */
  loginPoll(data: {
    id: string
    device_id?: string
    uuid?: string
    /** 个微数字验证码（只能随轮询提交，企微走 loginVerify） */
    captch_code?: string
    type?: BotDeviceType
  }): Promise<BotLoginPollResult> {
    return service.post('/api/bot-gateway/login/poll', data).then(unwrap)
  },

  /** 提交企微辅助验证码（仅企微 status=10 时；成功后须立即恢复轮询） */
  loginVerify(data: { id: string; device_id: string; code: string }): Promise<unknown> {
    return service.post('/api/bot-gateway/login/verify', data).then(unwrap).catch(handleError)
  },

  /** 退出登录（后端自动使用该绑定已持久化的设备） */
  loginLogout(data: { id: string }): Promise<unknown> {
    return service.post('/api/bot-gateway/login/logout', data).then(unwrap).catch(handleError)
  },

  /** 联系人反查（仅个微 wechat；企微通道网关会返回明确错误，前端按通道禁用入口） */
  contactsDetail(data: { bot_id: string; wxids: string[] }): Promise<unknown> {
    return service.post('/api/bot-gateway/contacts/detail', data).then(unwrap).catch(handleError)
  },
}

export default botGatewayApi
