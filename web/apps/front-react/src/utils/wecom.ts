import { loadScript, sleep } from '@km/shared-utils'
import wecomApi from '@/api/modules/wecom'
import { suite_id } from '@/utils/config'

/**
 * 用户代理字符串（小写）
 */
const userAgent = navigator.userAgent.toLowerCase()

/**
 * 检测是否在企业微信或微信环境中
 */
const isInQw = /wxwork|micromessenger/im.test(userAgent)

/**
 * 开放标签列表
 */
const openTagList = ['wx-open-launch-weapp']

/**
 * JS-SDK API列表
 */
const jsApiList = [
  'agentConfig',
  'openEnterpriseChat',
  'selectEnterpriseContact',
]

/**
 * 企业微信应用级API列表
 */
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
  'shareWechatMessage',
  'shareToExternalContact',
  'shareToExternalChat',
  'shareToExternalMoments',
]

/**
 * 企业微信JSSDK工具对象
 */
const jssdk = {
  loadScript() {
    return sleep(2).then(() => {
      return Promise.all([
        loadScript('//res.wx.qq.com/open/js/jweixin-1.2.0.js'),
        loadScript('//open.work.weixin.qq.com/wwopen/js/jwxwork-1.0.0.js'),
      ])
    })
  },

  getConfig() {
    const { origin, pathname, search } = window.location
    const url = `${origin}${pathname}${search}`
    return wecomApi.jssdk_config(suite_id, { url })
      .then(res => res.data)
  },

  initConfig(data: any): Promise<void> {
    return new Promise((resolve, reject) => {
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

  agentConfig(agent: any): Promise<void> {
    return new Promise((resolve, reject) => {
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
          if (err.errMsg.includes('function not exist'))
            alert('企业微信版本过低请升级')
          else
            reject()
          console.error(err)
        },
      })
    })
  },
}

/**
 * 企业微信JSSDK单例实例
 */
let instance: any

/**
 * 初始化企业微信JSSDK
 */
const initWecom = (reset = false): Promise<void> => {
  if (reset)
    instance = undefined

  if (!instance) {
    instance = new Promise((resolve) => {
      const fail = () => {
        instance = undefined
      }
      const task = jssdk.loadScript()
      task
        .then(() => jssdk.getConfig())
        .then((data) => {
          if (isInQw)
            return jssdk.initConfig(data.corp_config).then(() => data)
          else
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

export default initWecom
export { isInQw, jssdk }
