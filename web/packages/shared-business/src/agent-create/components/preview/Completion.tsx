import { Button, Form, Input, InputNumber, Select, Upload, message } from 'antd'
import { PlusOutlined, CloseOutlined, LoadingOutlined, WarningOutlined } from '@ant-design/icons'
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { useAgentCreateAdapter } from '../../adapters'
import { useAgentFormStore } from '../../store'
import { generateRandomId } from '@km/shared-utils'
import { isUrl } from '@km/shared-utils'
import { PromptInput } from '@km/shared-components-react'

// 默认输出字段属性
const defaultOutputField = {
  id: '',
  variable: '',
  label: '',
  type: 'text',
  desc: '',
  required: false,
  max_length: 0,
  is_system: false,
  options: [],
  date_format: '',
  multiple: false,
  show_word_limit: false,
  file_type: 'all',
  file_accept: [],
  file_limit: 1,
  file_size: 30,
}

interface FormItem {
  id: string
  variable: string
  label: string
  type: string
  required: boolean
  value: any
  options?: { label: string; value: string }[]
  multiple?: boolean
  max_length?: number
  show_word_limit?: boolean
  desc?: string
  file_limit?: number
  file_size?: number
  file_accept?: string[]
  date_format?: string
  temp?: string
  focus?: boolean
}

interface CompletionProps {
  className?: string
}

interface ResultItem {
  id: string
  type: string
  value: any
  label?: string
  variable?: string
}

export interface CompletionRef {
  restart: () => void
}

export const Completion = forwardRef<CompletionRef, CompletionProps>(({ className }, ref) => {
  const adapter = useAgentCreateAdapter()
  const t = adapter.t || ((key: string) => key)

  const store = useAgentFormStore()
  // 使用 selector 确保正确订阅 output_fields 的变化
  const outputFields = useAgentFormStore((state) => state.form_data.settings.output_fields)
  const inputFields = useAgentFormStore((state) => state.form_data.settings.input_fields)
  const agentId = useAgentFormStore((state) => state.agent_data.agent_id)
  const agentType = useAgentFormStore((state) => state.agent_type)

  const [form] = Form.useForm()

  const [loading, setLoading] = useState(false)
  const [showResult, setShowResult] = useState(false)
  const [showError, setShowError] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [result, setResult] = useState<ResultItem[]>([])
  const [resultString, setResultString] = useState('')
  const [formItems, setFormItems] = useState<FormItem[]>([])
  const [initialHasOutputFields, setInitialHasOutputFields] = useState(false)

  const abortControllerRef = useRef<AbortController | null>(null)
  const Bubble = adapter.BubbleComponents

  const setFormatForm = () => {
    setInitialHasOutputFields(outputFields.length > 0)
    const items: FormItem[] = (inputFields || []).map((item: any) => {
      if (['tag', 'file', 'array_image', 'array_audio', 'array_video', 'array_file'].includes(item.type)) {
        return {
          ...item,
          value: [],
        }
      }
      if (item.type === 'array_text') {
        return {
          ...item,
          value: [''],
        }
      }
      return {
        ...item,
        value: item.type === 'select' && item.multiple ? [] : '',
      }
    })
    setFormItems(items)
  }

  useEffect(() => {
    setFormatForm()
  }, [inputFields, outputFields])

  const handleFocusTag = (_item: FormItem, index: number) => {
    const newItems = [...formItems]
    newItems[index].temp = ''
    newItems[index].focus = true
    setFormItems(newItems)
  }

  const handleAddTag = (_item: FormItem, index: number) => {
    const newItems = [...formItems]
    const temp = newItems[index].temp?.trim()
    if (temp) {
      newItems[index].value = [temp, ...newItems[index].value]
      newItems[index].temp = ''
    }
    newItems[index].focus = false
    setFormItems(newItems)
  }

  const handleDelTag = (itemIndex: number, tagIndex: number) => {
    const newItems = [...formItems]
    newItems[itemIndex].value = newItems[itemIndex].value.filter((_: any, i: number) => i !== tagIndex)
    setFormItems(newItems)
  }

  const handleArrayTextAdd = (itemIndex: number) => {
    const newItems = [...formItems]
    newItems[itemIndex].value = [...newItems[itemIndex].value, '']
    setFormItems(newItems)
  }

  const handleArrayTextDelete = (itemIndex: number, textIndex: number) => {
    const newItems = [...formItems]
    if (newItems[itemIndex].value.length === 1) {
      newItems[itemIndex].value = ['']
    } else {
      newItems[itemIndex].value = newItems[itemIndex].value.filter((_: any, i: number) => i !== textIndex)
    }
    setFormItems(newItems)
  }

  const handleViewFile = (file: any) => {
    window.open(file.url, '_blank')
  }

  const handleDelFile = (file: any, itemIndex: number) => {
    const newItems = [...formItems]
    newItems[itemIndex].value = newItems[itemIndex].value.filter((f: any) => f.id !== file.id && f.uid !== file.uid)
    setFormItems(newItems)
  }

  const handleFileChange = (itemIndex: number, fileList: any[]) => {
    const newItems = [...formItems]
    newItems[itemIndex].value = fileList
    setFormItems(newItems)
  }

  // 文件大小验证
  const beforeUpload = (file: any, item: FormItem) => {
    const sizeMB = file.size / 1024 / 1024
    if (item.file_size && sizeMB > item.file_size) {
      message.error(`File size exceeds ${item.file_size}MB`)
      return Upload.LIST_IGNORE
    }
    return true
  }

  // 自定义文件上传请求
  const customUploadRequest = async (options: any) => {
    const { file, onSuccess, onError } = options
    if (!adapter.uploadFile) {
      onError?.(new Error('uploadFile not configured'))
      return
    }
    try {
      const result = await adapter.uploadFile(file)
      // 将服务器返回的 id 设置到文件对象
      file.id = result.id
      file.url = result.url
      onSuccess?.(result, file)
    } catch (error) {
      onError?.(error)
    }
  }

  const getInputs = () => {
    const inputs: Record<string, any> = {}
    const AGENT_TYPES = adapter.AGENT_TYPES || {}

    formItems.forEach(item => {
      if (item.value?.toString() === '') return

      if (item.type === 'file') {
        if (agentType !== AGENT_TYPES.COZE_WORKFLOW_CN) {
          inputs[item.variable] = Array.isArray(item.value)
            ? item.value.map((f: any) => `file_id:${f.id || f.uid}`).join(',')
            : `file_id:${item.value?.id || item.value?.uid || item.value}`
        } else {
          inputs[item.variable] = `file_id:${item.value[0]?.id || item.value[0]?.uid}`
        }
      } else if (['array_image', 'array_audio', 'array_video', 'array_file'].includes(item.type)) {
        inputs[item.variable] = item.value.map((f: any) => `file_id:${f.id || f.uid}`)
      } else if (item.type === 'array_text') {
        inputs[item.variable] = item.value
      } else {
        inputs[item.variable] = item.type === 'select' && !item.multiple
          ? item.value
          : Array.isArray(item.value)
            ? item.value.join(',')
            : String(item.value)
      }
    })

    return inputs
  }

  const getQuestion = (inputs: Record<string, any>) => {
    const keys = Object.keys(inputs)
    for (const key of keys) {
      const value = inputs[key]
      if (value === undefined) continue

      if (typeof value === 'string' && value.includes('file_id:')) {
        return 'image'
      }
      if (value !== undefined) {
        return String(value).slice(0, 20)
      }
    }
    return ''
  }

  const handleStartRunning = async () => {
    try {
      await form.validateFields()
    } catch {
      return
    }

    if (!agentId) {
      message.warning(t('agent.preview_publish_first'))
      return
    }

    if (!adapter.createConversation || !adapter.runWorkflow) {
      message.warning('createConversation or runWorkflow not configured')
      return
    }

    const inputs = getInputs()
    setLoading(true)
    setShowError(false)
    setErrorMessage('')

    try {
      const conv = await adapter.createConversation({
        agent_id: agentId,
        title: getQuestion(inputs),
      })

      const data = {
        conversation_id: conv.conversation_id,
        model: `agent-${agentId}`,
        parameters: inputs,
        stream: true,
      }

      abortControllerRef.current = new AbortController()
      setShowResult(true)

      const response = await adapter.runWorkflow(data, {
        responseType: 'stream',
        signal: abortControllerRef.current.signal,
      })

      const res = JSON.parse(response)

      if (outputFields.length > 0) {
        const output: ResultItem[] = outputFields
          .filter((item: any) => res.data?.workflow_output_data?.[item.variable])
          .map((item: any) => ({
            id: item.id,
            label: item.label,
            type: item.type,
            variable: item.variable,
            value: res.data.workflow_output_data[item.variable] || '',
          }))
        setResult(output)
      } else {
        setResultString(JSON.stringify(res.data.workflow_output_data || {}, null, 2))
      }
    } catch (error: any) {
      console.error('Run error:', error)
      setShowError(true)
      try {
        const resData = JSON.parse(error.response?.data || '{}')
        setErrorMessage(resData.message || t('error.unknown'))
      } catch {
        setErrorMessage(t('error.unknown'))
      }
    } finally {
      setLoading(false)
      abortControllerRef.current = null
    }
  }

  const handleSyncVariables = () => {
    if (!resultString) return

    let resultData: Record<string, any>
    try {
      resultData = JSON.parse(resultString)
    } catch (e) {
      console.error('Parse result error:', e)
      return
    }

    const fields = Object.keys(resultData).map(key => ({
      ...defaultOutputField,
      id: generateRandomId(10),
      variable: key,
      label: key,
      type: 'textarea',
    }))

    // 使用 store 的 updateOutputFields 方法触发状态更新
    store.updateOutputFields(fields)

    // 同步后重置表单，回到输入状态
    setFormatForm()
    setShowResult(false)
    setLoading(false)
    setResult([])
    setResultString('')
    setShowError(false)
    setErrorMessage('')
  }

  const handleRestart = () => {
    setFormatForm()
    setShowResult(false)
    setLoading(false)
    setResult([])
    setResultString('')
    setShowError(false)
    setErrorMessage('')

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }

  const getSrc = (value: any, id: string) => {
    if (typeof value === 'object' && value !== null) {
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const val = value[key]
          if (typeof val === 'string' && isUrl(val)) {
            return val
          }
        }
      }
      setResult(prev => prev.filter(item => item.id !== id))
      message.error(t('error.not_found_url'))
    }
    return value
  }

  useImperativeHandle(ref, () => ({
    restart: handleRestart,
  }))

  const renderFormItem = (item: FormItem, index: number) => {
    switch (item.type) {
      case 'text':
        return (
          <div>
            <Input
              value={item.value}
              onChange={(e) => {
                const newItems = [...formItems]
                newItems[index].value = e.target.value
                setFormItems(newItems)
              }}
              placeholder={t('form.input_placeholder')}
              maxLength={item.max_length || undefined}
              showCount={item.show_word_limit}
            />
            {item.desc && (
              <div className="text-xs text-[#182b50] opacity-30 mt-1">{item.desc}</div>
            )}
          </div>
        )

      case 'textarea':
        return (
          <div>
            <Input.TextArea
              value={item.value}
              onChange={(e) => {
                const newItems = [...formItems]
                newItems[index].value = e.target.value
                setFormItems(newItems)
              }}
              rows={4}
              style={{ resize: 'none' }}
              placeholder={t('form.input_placeholder')}
              maxLength={item.max_length || undefined}
              showCount={item.show_word_limit}
            />
            {item.desc && (
              <div className="text-xs text-[#182b50] opacity-30 mt-1">{item.desc}</div>
            )}
          </div>
        )

      case 'inputNumber':
        return (
          <div>
            <InputNumber
              value={item.value}
              onChange={(val) => {
                const newItems = [...formItems]
                newItems[index].value = val
                setFormItems(newItems)
              }}
              min={1}
              className="w-full"
              placeholder={t('form.input_placeholder')}
            />
            {item.desc && (
              <div className="text-xs text-[#182b50] opacity-30 mt-1">{item.desc}</div>
            )}
          </div>
        )

      case 'select':
        return (
          <div>
            <Select
              value={item.value}
              onChange={(val) => {
                const newItems = [...formItems]
                newItems[index].value = val
                setFormItems(newItems)
              }}
              mode={item.multiple ? 'multiple' : undefined}
              placeholder={t('form.select_placeholder')}
              options={item.options?.map(opt => ({ label: opt.label, value: opt.label }))}
              className="w-full"
            />
            {item.desc && (
              <div className="text-xs text-[#182b50] opacity-30 mt-1">{item.desc}</div>
            )}
          </div>
        )

      case 'tag':
        return (
          <div>
            <div className="flex flex-wrap gap-3">
              {item.value.map((tag: string, tagIndex: number) => (
                <div
                  key={tagIndex}
                  className="border border-[#B0B7C3] rounded-sm min-h-[32px] inline-flex items-center px-3 py-1 text-xs text-[#182B50] opacity-80 break-all"
                >
                  {tag}
                  <CloseOutlined
                    className="cursor-pointer ml-1 text-[#d2d5dc] hover:text-[#182B50]"
                    onClick={() => handleDelTag(index, tagIndex)}
                  />
                </div>
              ))}
              {item.focus ? (
                <Input
                  autoFocus
                  style={{ width: 104 }}
                  className="h-8"
                  value={item.temp}
                  onChange={(e) => {
                    const newItems = [...formItems]
                    newItems[index].temp = e.target.value
                    setFormItems(newItems)
                  }}
                  onPressEnter={() => handleAddTag(item, index)}
                  onBlur={() => handleAddTag(item, index)}
                  placeholder={t('form.input_placeholder')}
                />
              ) : (
                <div
                  className="border border-[#B0B7C3] border-dashed rounded-sm h-8 inline-flex items-center px-3 cursor-pointer"
                  onClick={() => handleFocusTag(item, index)}
                >
                  <span className="text-xs text-[#182B50] opacity-80">+ {t('action.add')}</span>
                </div>
              )}
            </div>
            {item.desc && (
              <div className="text-xs text-[#182b50] opacity-30 mt-1">{item.desc}</div>
            )}
          </div>
        )

      case 'file':
      case 'array_image':
      case 'array_audio':
      case 'array_video':
      case 'array_file':
        return (
          <div className="w-full">
            <div style={{ display: item.file_limit !== item.value.length ? 'block' : 'none' }}>
              <Upload
                fileList={item.value}
                onChange={({ fileList }) => handleFileChange(index, fileList)}
                beforeUpload={(file) => beforeUpload(file, item)}
                customRequest={customUploadRequest}
                accept={item.file_accept?.map((ext: string) => `.${ext}`).join(',')}
                maxCount={item.file_limit}
                multiple={item.file_limit !== 1}
                showUploadList={false}
              >
                <div className="w-20 h-20 border border-dashed rounded-sm flex items-center justify-center flex-col">
                  <div className="text-xs text-[#182B50]/40 mt-2">{t('agent.click_upload')}</div>
                </div>
              </Upload>
            </div>
            {item.value.map((file: any) => (
              <div key={file.uid} className="h-9 px-2 border rounded mt-3 flex items-center gap-2">
                <div className="flex-1 text-sm text-[#182B50] truncate">
                  {file.name}
                </div>
                {file.status === 'done' ? (
                  <div className="flex items-center">
                    <Button type="link" size="small" onClick={() => handleViewFile(file)}>{t('agent.view')}</Button>
                    <div className="w-px h-4 mx-1 bg-[#E3E5EA]" />
                    <Button type="link" size="small" danger onClick={() => handleDelFile(file, index)}>{t('agent.delete')}</Button>
                  </div>
                ) : (
                  <div className="flex items-center">
                    <LoadingOutlined className="animate-spin" />
                  </div>
                )}
              </div>
            ))}
            <div className="flex items-center gap-1 mt-2">
              <WarningOutlined style={{ color: '#182B50', fontSize: 14 }} />
              <span className="text-xs text-[#182B50]/80">{t('agent.file_size_tip', { size: item.file_size })}</span>
            </div>
            <div>
              <span className="text-xs text-[#182B50]/80">{t('agent.support_format', { formats: item.file_accept?.join('、') })}</span>
            </div>
          </div>
        )

      case 'array_text':
        return (
          <div>
            {item.value.map((text: string, textIndex: number) => (
              <div key={textIndex} className="relative mb-2">
                <Form.Item
                  label={textIndex === 0 ? item.label : ''}
                  required={item.required}
                  className="mb-0"
                >
                  <Input
                    value={text}
                    onChange={(e) => {
                      const newItems = [...formItems]
                      newItems[index].value[textIndex] = e.target.value
                      setFormItems(newItems)
                    }}
                    placeholder={t('form.input_placeholder')}
                    maxLength={item.max_length || undefined}
                    showCount={item.show_word_limit}
                    suffix={
                      <CloseOutlined
                        className="cursor-pointer hover:opacity-60"
                        onClick={() => handleArrayTextDelete(index, textIndex)}
                        style={{ width: 16, height: 16 }}
                      />
                    }
                  />
                </Form.Item>
                {textIndex === 0 && (
                  <Button
                    type="link"
                    size="small"
                    className="absolute -top-7 right-0"
                    onClick={() => handleArrayTextAdd(index)}
                  >
                    <PlusOutlined className="mr-1" />
                    {t('action.add')}
                  </Button>
                )}
              </div>
            ))}
            {item.desc && (
              <div className="text-xs text-[#182b50] opacity-30 mt-1">{item.desc}</div>
            )}
          </div>
        )

      default:
        return (
          <Input
            value={item.value}
            onChange={(e) => {
              const newItems = [...formItems]
              newItems[index].value = e.target.value
              setFormItems(newItems)
            }}
            placeholder={t('form.input_placeholder')}
          />
        )
    }
  }

  const renderResultItem = (item: ResultItem) => {
    switch (item.type) {
      case 'markdown':
        return Bubble ? (
          <Bubble.XBubbleAssistant content={item.value} streaming={loading} />
        ) : (
          <div className="prose prose-sm max-w-none">{item.value}</div>
        )

      case 'image':
      case 'array_image':
        const images = Array.isArray(item.value) ? item.value : [item.value]
        return (
          <div className="overflow-hidden flex flex-col gap-5">
            {images.map((src: string, i: number) => (
              <img key={i} src={src} className="max-w-full h-auto object-contain rounded" alt="" />
            ))}
          </div>
        )

      case 'video':
      case 'array_video':
        const videos = Array.isArray(item.value) ? item.value : [item.value]
        return (
          <div className="overflow-hidden flex flex-col gap-5">
            {videos.map((src: string, i: number) => (
              <video key={i} src={getSrc(src, item.id)} controls className="max-w-full h-auto" />
            ))}
          </div>
        )

      case 'audio':
      case 'array_audio':
        const audios = Array.isArray(item.value) ? item.value : [item.value]
        return (
          <div className="overflow-hidden flex flex-col gap-5">
            {audios.map((src: string, i: number) => (
              <audio key={i} src={getSrc(src, item.id)} controls className="max-w-full" />
            ))}
          </div>
        )

      case 'text':
      case 'textarea':
      case 'array_text':
        const texts = Array.isArray(item.value) ? item.value : [item.value]
        return (
          <div>
            {texts.map((text: string, i: number) => (
              <p key={i} className="whitespace-pre-wrap break-all">
                {text}
              </p>
            ))}
          </div>
        )

      default:
        const defaultTexts = Array.isArray(item.value) ? item.value : [item.value]
        return (
          <div>
            {defaultTexts.map((text: string, i: number) => (
              <p key={i} className="whitespace-pre-wrap break-all">
                {text}
              </p>
            ))}
          </div>
        )
    }
  }

  return (
    <div className={`flex flex-col px-4 ${className || ''}`}>
      <div className="flex-1 overflow-y-auto">
        {showError && (
          <div className="flex flex-col items-center gap-4">
            <div className="text-sm text-[#1D1E1F] mx-10 text-center">
              {errorMessage}
            </div>
          </div>
        )}

        {showResult && !showError && (
          <div>
            {Bubble && (
              <Bubble.XBubbleAssistant className="!mb-0" streaming={loading}></Bubble.XBubbleAssistant>
            )}
            {outputFields.length === 0 && !loading && !initialHasOutputFields ? (
              <div className="flex flex-col items-center">
                <div className="border rounded w-full h-full flex flex-col !bg-[#F8F9FA] relative overflow-y-auto">
                  <div className="min-h-10 pl-3 pr-2 border-b flex items-center justify-between rounded-t bg-[#F8F9FA]">
                    <div className="flex-1 text-sm text-[#4F5052] truncate">JSON</div>
                  </div>
                  <PromptInput
                    value={resultString}
                    onChange={(val) => setResultString(val)}
                    style={{ flex: 'none', height: 'max-content' }}
                    showLine
                    wordWrap
                    t={t}
                  />
                </div>
                <Button type="primary" className="mt-8" onClick={handleSyncVariables}>
                  {t('term.sync_output_variable')}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {result.map(item => (
                  <div key={item.id} className="text-sm text-[#1D1E1F] mt-2">
                    {item.type === 'markdown' && Bubble ? (
                      <Bubble.XBubbleAssistant content={item.value} streaming={loading} />
                    ) : (
                      renderResultItem(item)
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!showResult && !showError && (
          <>
            <Form form={form} layout="vertical" requiredMark="optional">
              {formItems.map((item, index) => (
                <Form.Item
                  key={item.id}
                  label={item.label}
                  required={item.required}
                  rules={[{ required: item.required, message: t('form.input_placeholder') + item.label }]}
                >
                  {renderFormItem(item, index)}
                </Form.Item>
              ))}
            </Form>
            <div className="mt-5">
              <Button type="primary" onClick={handleStartRunning} loading={loading}>
                {t('term.start_running')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
})

Completion.displayName = 'Completion'

export default Completion
