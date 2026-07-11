import { Button, Form, Input, InputNumber, Select, DatePicker, Upload, message } from 'antd'
import { PlusOutlined, CloseOutlined, LoadingOutlined, WarningOutlined } from '@ant-design/icons'
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { t } from '@/locales'
import { conversationApi } from '@/api/modules/conversation'
import { useConversationStore } from '@/stores'
import { useAgentFormStore } from '../store'
import { generateRandomId } from '@/utils'
import { outputDefaultField } from '@/constants/agent'
import { AGENT_TYPES } from '@/constants/platform/config'
import type { UploadFile } from 'antd/es/upload/interface'
import dayjs from 'dayjs'
import { getRealPath } from '@/utils/config'
import { isUrl } from '@km/shared-utils'
import { XBubbleAssistant } from '@km/hub-ui-x-react'
import PromptInput from '@/components/Prompt/input'

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
  const store = useAgentFormStore()
  const conversationStore = useConversationStore()
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

  // Initialize form items from input_fields - equivalent to setFormatForm in Vue
  const setFormatForm = () => {
    setInitialHasOutputFields(store.form_data.settings.output_fields.length > 0)
    const items: FormItem[] = (store.form_data.settings.input_fields || []).map((item: any) => {
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

  // Initialize form items on mount and when input_fields change
  useEffect(() => {
    setFormatForm()
  }, [store.form_data.settings.input_fields])

  // Handle tag operations
  const handleFocusTag = (item: FormItem, index: number) => {
    const newItems = [...formItems]
    newItems[index].temp = ''
    newItems[index].focus = true
    setFormItems(newItems)
  }

  const handleAddTag = (item: FormItem, index: number) => {
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

  // Handle array text operations
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

  // Handle file operations
  const handleViewFile = (file: any) => {
    window.open(file.url, '_blank')
  }

  const handleDelFile = (file: any, itemIndex: number) => {
    const newItems = [...formItems]
    newItems[itemIndex].value = newItems[itemIndex].value.filter((f: UploadFile) => f.uid !== file.uid)
    setFormItems(newItems)
  }

  const handleFileChange = (itemIndex: number, fileList: UploadFile[]) => {
    const newItems = [...formItems]
    newItems[itemIndex].value = fileList
    setFormItems(newItems)
  }

  // Get inputs for API call
  const getInputs = () => {
    const inputs: Record<string, any> = {}

    formItems.forEach(item => {
      if (item.value?.toString() === '') return

      if (item.type === 'file') {
        if (store.agent_type !== AGENT_TYPES.COZE_WORKFLOW_CN) {
          inputs[item.variable] = Array.isArray(item.value)
            ? item.value.map((f: UploadFile) => `file_id:${f.uid}`).join(',')
            : `file_id:${item.value}`
        } else {
          inputs[item.variable] = `file_id:${item.value[0]?.uid}`
        }
      } else if (['array_image', 'array_audio', 'array_video', 'array_file'].includes(item.type)) {
        inputs[item.variable] = item.value.map((f: UploadFile) => `file_id:${f.uid}`)
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

  // Get question for conversation title
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

  // Handle start running
  const handleStartRunning = async () => {
    try {
      await form.validateFields()
    } catch {
      return
    }

    const inputs = getInputs()
    setLoading(true)
    setShowError(false)
    setErrorMessage('')

    try {
      const conv = await conversationStore.save({
        data: {
          agent_id: store.agent_data.agent_id,
          title: getQuestion(inputs)
        },
      })

      const data = {
        conversation_id: conv.conversation_id,
        model: `agent-${store.agent_data.agent_id}`,
        parameters: inputs,
        stream: true,
      }

      abortControllerRef.current = new AbortController()
      setShowResult(true)

      const response = await conversationApi.workflow.run(data, {
        responseType: 'stream',
        signal: abortControllerRef.current.signal,
      })

      const res = JSON.parse(response)
      const outputFields = store.form_data.settings.output_fields || []

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

  // Handle sync variables
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
      ...outputDefaultField,
      id: generateRandomId(10),
      variable: key,
      label: key,
      type: 'textarea',
    }))

    // Update store output_fields
    store.form_data.settings.output_fields = fields

    // Reset and re-run
    setShowResult(false)
    setTimeout(() => {
      setShowResult(true)
      handleRestart()
    }, 0)
  }

  // Handle restart
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

  // Get src from object value (for video/audio)
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
      message.error(t('not_found_url'))
    }
    return value
  }

  // Expose restart method via ref
  useImperativeHandle(ref, () => ({
    restart: handleRestart,
  }))

  // Render form item by type
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
              <div className="text-xs text-dark opacity-30 mt-1">{item.desc}</div>
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
              resize="none"
              placeholder={t('form.input_placeholder')}
              maxLength={item.max_length || undefined}
              showCount={item.show_word_limit}
            />
            {item.desc && (
              <div className="text-xs text-dark opacity-30 mt-1">{item.desc}</div>
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
              <div className="text-xs text-dark opacity-30 mt-1">{item.desc}</div>
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
              <div className="text-xs text-dark opacity-30 mt-1">{item.desc}</div>
            )}
          </div>
        )

      case 'date':
        return (
          <div>
            {item.date_format === 'h-m' ? (
              <DatePicker
                value={item.value ? dayjs(item.value, 'HH:mm') : null}
                onChange={(date) => {
                  const newItems = [...formItems]
                  newItems[index].value = date?.format('HH:mm') || ''
                  setFormItems(newItems)
                }}
                format="HH:mm"
                placeholder={t('form.select_placeholder')}
                className="w-full"
                picker="time"
              />
            ) : item.date_format === 'y' ? (
              <DatePicker
                value={item.value ? dayjs(item.value, 'YYYY') : null}
                onChange={(date) => {
                  const newItems = [...formItems]
                  newItems[index].value = date?.format('YYYY') || ''
                  setFormItems(newItems)
                }}
                format="YYYY"
                placeholder={t('form.select_placeholder')}
                className="w-full"
                picker="year"
              />
            ) : item.date_format === 'y-m' ? (
              <DatePicker
                value={item.value ? dayjs(item.value, 'YYYY-MM') : null}
                onChange={(date) => {
                  const newItems = [...formItems]
                  newItems[index].value = date?.format('YYYY-MM') || ''
                  setFormItems(newItems)
                }}
                format="YYYY-MM"
                placeholder={t('form.select_placeholder')}
                className="w-full"
                picker="month"
              />
            ) : item.date_format === 'y-m-d' ? (
              <DatePicker
                value={item.value ? dayjs(item.value, 'YYYY-MM-DD') : null}
                onChange={(date) => {
                  const newItems = [...formItems]
                  newItems[index].value = date?.format('YYYY-MM-DD') || ''
                  setFormItems(newItems)
                }}
                format="YYYY-MM-DD"
                placeholder={t('form.select_placeholder')}
                className="w-full"
              />
            ) : item.date_format === 'y-m-d-h' ? (
              <DatePicker
                value={item.value ? dayjs(item.value, 'YYYY-MM-DD HH') : null}
                onChange={(date) => {
                  const newItems = [...formItems]
                  newItems[index].value = date?.format('YYYY-MM-DD HH') || ''
                  setFormItems(newItems)
                }}
                format="YYYY-MM-DD HH"
                showTime={{ format: 'HH' }}
                placeholder={t('form.select_placeholder')}
                className="w-full"
              />
            ) : item.date_format === 'daterange' ? (
              <DatePicker.RangePicker
                value={item.value ? [dayjs(item.value[0], 'YYYY-MM-DD HH:mm'), dayjs(item.value[1], 'YYYY-MM-DD HH:mm')] : null}
                onChange={(dates) => {
                  const newItems = [...formItems]
                  newItems[index].value = dates?.map(d => d?.format('YYYY-MM-DD HH:mm') || '') || []
                  setFormItems(newItems)
                }}
                format="YYYY-MM-DD HH:mm"
                className="w-full"
              />
            ) : (
              <DatePicker
                value={item.value ? dayjs(item.value) : null}
                onChange={(date) => {
                  const newItems = [...formItems]
                  newItems[index].value = date?.format('YYYY-MM-DD') || ''
                  setFormItems(newItems)
                }}
                placeholder={t('form.select_placeholder')}
                className="w-full"
              />
            )}
            {item.desc && (
              <div className="text-xs text-dark opacity-30 mt-1">{item.desc}</div>
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
                  className="border border-[#B0B7C3] rounded-sm min-h-[32px] inline-flex items-center px-3 py-1 text-xs text-dark opacity-80 break-all"
                >
                  {tag}
                  <CloseOutlined
                    className="cursor-pointer ml-1 text-[#d2d5dc] hover:text-dark"
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
                  placeholder={t('form_input_placeholder')}
                />
              ) : (
                <div
                  className="border border-[#B0B7C3] border-dashed rounded-sm h-8 inline-flex items-center px-3 cursor-pointer"
                  onClick={() => handleFocusTag(item, index)}
                >
                  <span className="text-xs text-dark opacity-80">+ {t('action_add')}</span>
                </div>
              )}
            </div>
            {item.desc && (
              <div className="text-xs text-dark opacity-30 mt-1">{item.desc}</div>
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
                accept={item.file_accept?.map((ext: string) => `.${ext}`).join(',')}
                maxCount={item.file_limit}
                multiple={item.file_limit !== 1}
                showUploadList={false}
              >
                <div className="w-20 h-20 border border-dashed rounded-sm flex items-center justify-center flex-col">
                  <div className="text-xs text-dark/40 mt-2">点击上传</div>
                </div>
              </Upload>
            </div>
            {item.value.map((file: UploadFile) => (
              <div key={file.uid} className="h-9 px-2 border rounded mt-3 flex items-center gap-2">
                <div className="flex-1 text-sm text-dark truncate">
                  {file.name}
                </div>
                {file.status === 'done' ? (
                  <div className="flex items-center">
                    <Button type="link" size="small" onClick={() => handleViewFile(file)}>查看</Button>
                    <div className="w-px h-4 mx-1 bg-[#E3E5EA]" />
                    <Button type="link" size="small" danger onClick={() => handleDelFile(file, index)}>删除</Button>
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
              <span className="text-xs text-dark/80">单个文件大小不超过{item.file_size}MB</span>
            </div>
            <div>
              <span className="text-xs text-dark/80">支持格式：{item.file_accept?.join('、')}</span>
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
                    {t('action_add')}
                  </Button>
                )}
              </div>
            ))}
            {item.desc && (
              <div className="text-xs text-dark opacity-30 mt-1">{item.desc}</div>
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

  // Render result item
  const renderResultItem = (item: ResultItem) => {
    switch (item.type) {
      case 'markdown':
        return <div className="prose prose-sm max-w-none">{item.value}</div>

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

      default:
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
    }
  }

  return (
    <div className={`flex flex-col px-4 ${className || ''}`}>
      <div className="flex-1 overflow-y-auto">
        {/* Error state */}
        {showError && (
          <div className="flex flex-col items-center gap-4">
            <img src={getRealPath('/images/chat/test_error.png')} className="w-10" alt="error" />
            <p className="text-sm text-primary mx-10 text-center">
              {errorMessage}
            </p>
          </div>
        )}

        {/* Result state */}
        {showResult && !showError && (
          <div>
            <XBubbleAssistant className="!mb-0" streaming={loading}></XBubbleAssistant>
            {store.form_data.settings.output_fields.length === 0 && !loading && !initialHasOutputFields ? (
              <div className="flex flex-col items-center">
                <div className="border rounded w-full h-full flex flex-col !bg-[#F8F9FA] relative overflow-y-auto prompt-input-wrapper">
                  <div className="min-h-10 pl-3 pr-2 border-b flex items-center justify-between rounded-t bg-[#F8F9FA]">
                    <div className="flex-1 text-sm text-secondary truncate">JSON</div>
                  </div>
                  <PromptInput
                    value={resultString}
                    onChange={(val) => setResultString(val)}
                    style={{ flex: 'none', minHeight: '40vh', height: 'max-content' }}
                    showLine
                    showToken
                    wordWrap
                  />
                </div>
                <Button type="primary" className="mt-8" onClick={handleSyncVariables}>
                  {t('sync_output_variable')}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {result.map(item => (
                  <div key={item.id} className="text-sm text-primary mt-2">
                    {item.type === 'markdown' ? (
                      <XBubbleAssistant content={item.value} streaming={loading} />
                    ) : (
                      renderResultItem(item)
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Form state */}
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
                {t('start_running')}
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
