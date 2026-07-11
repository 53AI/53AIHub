import { useState, useCallback, useRef } from 'react'
import { message } from 'antd'
import chatApi from '@/api/modules/chat'
import { checkPermission } from '@/utils/permission'
import { useConversationStore } from '@/stores/modules/conversation'
import { t } from '@/locales'

export const useWorkflowSend = () => {
  const convStore = useConversationStore()
  const abortControllerRef = useRef<AbortController | null>(null)
  const [loading, setLoading] = useState(false)
  const [showOutput, setShowOutput] = useState(false)
  const [result, setResult] = useState<any[]>([])
  const [resultStr, setResultStr] = useState('')

  const getInputs = useCallback((inputForm: any[]): Record<string, string> => {
    const inputs = inputForm.reduce(
      (result, item) => {
        if (item.value.toString() === '') return result
        if (item.type === 'file') {
          result[`${item.variable}`] = item.value.map((item) => `file_id:${item.id}`).join(',')
        } else if (['array_image', 'array_audio', 'array_video', 'array_file'].includes(item.type)) {
          result[`${item.variable}`] = item.value.map((item) => `file_id:${item.id}`)
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
    const { settings_obj, agent_id } = currentAgent
    setResult([])
    setResultStr('')
    let inputs = inputData
    if(!inputData) {
      inputs = getInputs(inputData)
    }
    const conversation = await convStore.createConversation(agent_id, getQuestion(inputs), file_id)
    const data = {
      conversation_id: conversation.conversation_id,
      model: `agent-${agent_id}`,
      parameters: inputs,
      stream: true
    }
    setLoading(true)
    abortControllerRef.current = new AbortController()
    setShowOutput(true)
    chatApi.workflow
      .run(data, {
        onDownloadProgress: (e) => {
          console.log(e)
        },
        responseType: 'stream',
        signal: abortControllerRef.current?.signal
      })
      .then((response) => {
        const res = JSON.parse(response)
        const output = settings_obj.output_fields.reduce((result, item) => {
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
        setResultStr(output.map((item) => `${item.value}`).join('\n'))
      })
      .finally(() => {
        setLoading(false)
      })
  }, [convStore, getInputs, getQuestion])

  const handleRun = useCallback(async (currentAgent: any, file_id: string, inputForm: any) => {
    const { user_group_ids, agent_id } = currentAgent
    checkPermission({
      groupIds: user_group_ids,
      onClick: async () => {
        if (!agent_id) return message.warning(t('chat.no_available_agent'))
        workflowRun(currentAgent, file_id, inputForm)
        return true
      }
    })
  }, [workflowRun])

  // 从对象中获取url
  const getSrc = useCallback((value: any, id: string) => {
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
      message.error(t('chat.not_found_url'))
    }
    return value
  }, [])

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

// Helper function for URL validation
function isUrl(str: string): boolean {
  try {
    new URL(str)
    return true
  } catch {
    return false
  }
}