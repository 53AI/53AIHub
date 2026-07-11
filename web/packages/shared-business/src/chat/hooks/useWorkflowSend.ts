import { useState, useCallback, useRef } from 'react'
import { isUrl } from '@km/shared-utils'
import { useChatAdapters } from '../i18n'

/**
 * Workflow 运行 Hook
 *
 * 依赖拆分：
 * - 平台工具（createConversation / t / showWarning）来自 `IChatAdapters.platform`
 * - 权限工具（checkPermission）来自 `IChatAdapters.permission`
 * - workflow 实际 `run` 来自 `IChatAdapters.workflowApi`
 *
 * ```tsx
 * <ChatConfigProvider adapters={{ platform, permission, workflowApi }}>
 *   <YourComponent />
 * </ChatConfigProvider>
 * ```
 *
 * 闭包与竞态：
 * - adapter 字段在每次 callback 内通过 `adapters.platform` 等读取，避免 hook 入口
 *   destructure 在 locale/auth 切换时持有 stale 引用。
 * - `requestIdRef` 用于在用户连续点击"运行"时忽略旧请求的响应（与 useChatSend 同款）。
 */
export function useWorkflowSend() {
  const adapters = useChatAdapters()

  const abortControllerRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const [loading, setLoading] = useState(false)
  const [, setShowOutput] = useState(false)
  const [result, setResult] = useState<any[]>([])
  const [resultStr, setResultStr] = useState('')

  const getInputs = useCallback((inputForm: any[]): Record<string, string> => {
    const inputs = inputForm.reduce(
      (result, item) => {
        if (item.value.toString() === '') return result
        if (item.type === 'file') {
          result[`${item.variable}`] = item.value.map((item: any) => `file_id:${item.id}`).join(',')
        } else if (['array_image', 'array_audio', 'array_video', 'array_file'].includes(item.type)) {
          result[`${item.variable}`] = item.value.map((item: any) => `file_id:${item.id}`)
        } else if (item.type === 'array_text') {
          result[`${item.variable}`] = item.value
        } else {
          result[`${item.variable}`] =
            item.type === 'select' && !item.multiple ? item.value : Array.isArray(item.value) ? item.value.join(',') : String(item.value)
        }
        return result
      },
      {} as Record<string, string>
    )
    Object.keys(inputs).forEach((key) => {
      if (inputs[key] === '' || inputs[key] === null) {
        delete inputs[key]
      }
    })
    return inputs
  }, [])

  const getQuestion = useCallback((inputs: Record<string, string>): string => {
    let question = ''
    let index = 0
    const keys = Object.keys(inputs)
    if (keys.length === 0) return ''
    while (!question) {
      const value = inputs[keys[index]]
      if (value) {
        question = String(question).slice(0, 20)
        return question
      }
      index++
    }
    return ''
  }, [])

  const workflowRun = useCallback(async (currentAgent: any, file_id: string, inputData?: any) => {
    // 每次调用都从最新的 adapters 读取，避免闭包持有旧引用（unify-chat-adapters #7）
    const platform = adapters?.platform
    const workflowRunApi = adapters?.workflowApi?.run

    if (!platform?.createConversation || !workflowRunApi) {
      throw new Error(
        'useWorkflowSend requires platform.createConversation and workflowApi.run in ChatConfigProvider.'
      )
    }

    const { settings_obj, agent_id } = currentAgent
    setResult([])
    setResultStr('')
    let inputs = inputData
    if (!inputData) {
      inputs = getInputs(inputData)
    }

    const conversation = await platform.createConversation(agent_id, getQuestion(inputs), file_id)
    const data = {
      conversation_id: conversation.conversation_id,
      model: `agent-${agent_id}`,
      parameters: inputs,
      stream: true
    }

    // 守卫：递增 requestId，后续旧请求响应被丢弃（unify-chat-adapters #4 race）
    const requestId = ++requestIdRef.current
    const isStale = () => requestId !== requestIdRef.current

    setLoading(true)
    abortControllerRef.current = new AbortController()
    setShowOutput(true)

    try {
      const response: any = await workflowRunApi(data, {
        onDownloadProgress: (e: any) => {
          console.log(e)
        },
        responseType: 'stream',
        signal: abortControllerRef.current?.signal
      })
      if (isStale()) return
      const res = JSON.parse(response)
      const output = settings_obj.output_fields.reduce((result: any[], item: any) => {
        if (!res.data.workflow_output_data[item.variable]) return result
        result.push({
          id: item.id,
          label: item.label,
          type: item.type,
          variable: item.variable,
          value: res.data.workflow_output_data[item.variable] || ''
        })
        return result
      }, [])
      setResult(output)
      setResultStr(output.map((item: any) => `${item.value}`).join('\n'))
    } catch (err: any) {
      if (isStale() || err?.message === 'canceled' || err?.code === 'ERR_CANCELED') return
      throw err
    } finally {
      if (!isStale()) {
        setLoading(false)
      }
    }
  }, [adapters, getInputs, getQuestion])

  const handleRun = useCallback(async (currentAgent: any, file_id: string, inputForm: any) => {
    const permission = adapters?.permission
    const platform = adapters?.platform
    if (!permission?.checkPermission || !platform) {
      throw new Error('useWorkflowSend requires permission.checkPermission and platform in ChatConfigProvider.')
    }
    const { user_group_ids, agent_id } = currentAgent

    permission.checkPermission({
      groupIds: user_group_ids,
      onClick: async () => {
        if (!agent_id) {
          platform.showWarning?.(platform.t?.('chat.no_available_agent') || 'chat.no_available_agent')
          return
        }
        workflowRun(currentAgent, file_id, inputForm)
      }
    })
  }, [adapters, workflowRun])

  // 从对象中获取url
  const getSrc = useCallback((value: any, id: string) => {
    const platform = adapters?.platform
    if (typeof value === 'object' && value !== null) {
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const val = value[key]
          if (typeof val === 'string' && isUrl(val)) {
            return val
          }
        }
      }
      setResult(prev => prev.filter((item) => item.id !== id))
      platform?.showWarning?.(platform.t?.('chat.not_found_url') || 'chat.not_found_url')
    }
    return value
  }, [adapters])

  return {
    getInputs,
    getQuestion,
    workflowRun,
    handleRun,
    getSrc,
    result,
    resultStr,
    loading
  }
}

export default useWorkflowSend
