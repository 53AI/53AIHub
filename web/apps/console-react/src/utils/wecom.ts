/**
 * 企微 JSSDK 初始化
 * 依赖 wecomApi 与 wx 全局对象
 */
import { loadScript, sleep } from '@km/shared-utils'
import { wecomApi } from '@/api/modules/wecom'
import { suite_id } from '@/utils/config'

const userAgent = navigator.userAgent.toLowerCase()
const isInQw = /wxwork|micromessenger/im.test(userAgent)

const openTagList = ['wx-open-launch-weapp']
const jsApiList = ['agentConfig', 'openEnterpriseChat', 'selectEnterpriseContact']

// 企微需要用到
const agentApiList = [
  'getContext',
  'selectExternalContact',
  'openUserProfile',
  'sendChatMessage',
  'getCurExternalContact',
  'getCurExternalChat',
  'shareAppMessage',
  'openEnterpriseChat',
  'openAppManage',
  'openAppPurchase',
  'openThirdAppServiceChat',
  'shareAppMessage',
  'shareWechatMessage',
  'shareToExternalContact',
  'shareToExternalChat',
  'shareToExternalMoments',
]

const jssdk = {
  loadScript() {
    return sleep(2).then(() => {
      return Promise.all([
        loadScript('//res.wx.qq.com/open/js/jweixin-1.2.0.js'),
        loadScript('//open.work.weixin.qq.com/wwopen/js/jwxwork-1.0.0.js'),
      ])
    })
  },
  /**
   * 初始化sdk配置
   */
  getConfig() {
    const { origin, pathname, search } = window.location
    const url = `${origin}${pathname}${search}`
    return wecomApi.jssdk_config(suite_id, { url }).then((res: any) => res.data)
  },

  /**
   * 初始化jssdk
   */
  initConfig(data: any) {
    return new Promise<void>((resolve, reject) => {
      const params = data.corp || data
      const config = {
        openTagList,
        jsApiList,
        debug: false,
        beta: true,
        appId: params.app_id,
        timestamp: params.timestamp,
        nonceStr: params.nonce_str,
        signature: params.signature,
      }
      console.log('jssdk init start')
      ;(window as any).wx.config(config)
      ;(window as any).wx.ready(() => {
        console.log('jssdk init success!!')
        resolve()
      })
      ;(window as any).wx.error((err: any) => {
        console.log('jssdk init error')
        console.error(err)
        reject()
      })
    })
  },

  /**
   * agentConfig注入的是应用的身份与权限。
   */
  agentConfig(agent: any) {
    return new Promise<void>((resolve, reject) => {
      console.log('jssdk agentconfig init start!!', agent)
      ;(window as any).wx.agentConfig({
        corpid: agent.app_id,
        agentid: agent.agent_id,
        timestamp: agent.timestamp,
        nonceStr: agent.nonce_str,
        signature: agent.signature,
        jsApiList: agentApiList,
        success() {
          console.log('jssdk agentconfig init success!!')
          resolve()
        },
        fail(err: any) {
          if (err.errMsg.includes('function not exist')) alert('企业微信版本过低请升级')
          else reject()
          console.error(err)
        },
      })
    })
  },
}

let instance: Promise<void> | undefined

export default function getWecomInstance(reset = false): Promise<void> {
  if (reset) instance = undefined

  if (!instance) {
    instance = new Promise((resolve) => {
      const fail = () => {
        instance = undefined
      }
      const task = jssdk.loadScript()
      task
        .then(() => jssdk.getConfig())
        .then((data) => {
          if (isInQw) return jssdk.initConfig(data.corp_config).then(() => data)
          return data
        })
        .then((data) => {
          return jssdk.agentConfig(data.agent_config)
        })
        .then(() => resolve())
        .catch(() => fail())
    })
  }
  return instance
}
