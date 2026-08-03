import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle, useMemo } from 'react';
import { Button, Form, Input, InputNumber, Select, Upload, message, Empty } from 'antd';
import { PlusOutlined, CloseOutlined, WarningOutlined, CopyOutlined, DownloadOutlined, LoadingOutlined } from '@ant-design/icons';
import { BubbleAssistant } from '@km/hub-ui-x-react';
import { isUrl, copyToClip, downloadFile } from '@km/shared-utils';
import { useTranslation, useChatAdapters, type IChatAdapters } from '../../i18n';
import { useConversationStore } from '../../stores';
import { useEmbedMode } from '../../hooks';
import { UsageGuide, LoadingState } from '../index';
import { RelatedScene } from '../related-scene';
import ChatHeader from '../ChatView/ChatHeader';
import type { IAgentInfo } from '../../adapters/types';
import type {
  HeaderSlotProps,
  LanguageSwitcherFeature,
  GuideFeature,
  PermissionFeature,
  CompletionFeature,
} from '../ChatView/types';
import type { AgentRecommendFeature } from '../../types/features';

interface FormItem {
  id: string;
  variable: string;
  label: string;
  type: string;
  required: boolean;
  value: any;
  options?: { label: string; value: string }[];
  multiple?: boolean;
  max_length?: number;
  show_word_limit?: boolean;
  desc?: string;
  file_limit?: number;
  file_size?: number;
  file_accept?: string[];
  date_format?: string;
  temp?: string;
  focus?: boolean;
}

interface ResultItem {
  id: string;
  type: string;
  value: any;
  label: string;
  variable: string;
}

export interface CompletionViewProps {
  // === 核心 ===
  /** Agent ID - 内部通过 API 获取 agentInfo */
  agentId?: string;
  /** Agent 信息 - 可直接传入，或通过 agentId 加载 */
  agentInfo?: IAgentInfo;

  // === UI 插槽 ===
  slots?: {
    /** 自定义 Header */
    header?: (props: HeaderSlotProps) => React.ReactNode;
  };

  // === 功能分组 ===
  /** 语言切换 */
  languageSwitcher?: LanguageSwitcherFeature;
  /** 使用指引 */
  guide?: GuideFeature;
  /** 智能体推荐与跳转 */
  agentRecommend?: AgentRecommendFeature;
  /** 权限检查 */
  permission?: PermissionFeature;
  /** 完成回调 */
  completion?: CompletionFeature;
}

export interface CompletionViewRef {
  restart: () => void;
}

const DEFAULTS = {
  languageSwitcher: { enabled: true },
  guide: { enabled: true },
  agentRecommend: { showRelatedScene: true },
} as const;

export const CompletionView = forwardRef<CompletionViewRef, CompletionViewProps>(
  (props, ref) => {
    const {
      agentId,
      agentInfo: agentInfoProp,
      slots,
      languageSwitcher,
      guide,
      agentRecommend,
      permission,
      completion,
    } = props;

    const languageSwitcherEnabled = languageSwitcher?.enabled ?? DEFAULTS.languageSwitcher.enabled;
    const guideEnabled = guide?.enabled ?? DEFAULTS.guide.enabled;
    const showRelatedScene = agentRecommend?.showRelatedScene ?? DEFAULTS.agentRecommend.showRelatedScene;
    const { t, lang, setLang } = useTranslation();
    const [form] = Form.useForm();
    const adapters = useChatAdapters() as IChatAdapters & Required<Pick<IChatAdapters, 'agentApi' | 'conversationApi' | 'workflowApi'>>;
    const workflowApi = adapters.workflowApi;
    const embedMode = useEmbedMode();
    const createConversation = useConversationStore((state) => state.createConversation);
    const addConversation = useConversationStore((state) => state.addConversation);
    const setCurrentState = useConversationStore((state) => state.setCurrentState);
    const currentConversationId = useConversationStore((state) => state.current_conversationid);
    const nextAgentPrepare = useConversationStore((state) => state.next_agent_prepare);
    const setNextAgentPrepare = useConversationStore((state) => state.setNextAgentPrepare);

    // Agent 状态
    const [agentInfo, setAgentInfo] = useState<IAgentInfo | null>(agentInfoProp || null);
    const [agentLoading, setAgentLoading] = useState(!agentInfoProp && !!agentId);
    const [showGuide, setShowGuide] = useState(false);

    const [loading, setLoading] = useState(false);
    const [showResult, setShowResult] = useState(false);
    const [result, setResult] = useState<ResultItem[]>([]);
    const [resultString, setResultString] = useState('');
    const [formItems, setFormItems] = useState<FormItem[]>([]);

    const abortControllerRef = useRef<AbortController | null>(null);

    // Load agent info when agentId is provided
    useEffect(() => {
      if (agentInfoProp) {
        setAgentInfo(agentInfoProp);
        setAgentLoading(false);
        return;
      }
      if (!agentId) {
        setAgentInfo(null);
        setAgentLoading(false);
        return;
      }

      setAgentLoading(true);
      adapters.agentApi
        .detail(agentId)
        .then((agent: IAgentInfo) => {
          setAgentInfo(agent);
        })
        .catch((err) => {
          console.error("Failed to load agent:", err);
          setAgentInfo(null);
        })
        .finally(() => {
          setAgentLoading(false);
        });
    }, [agentId, agentInfoProp, adapters.agentApi]);

    const inputFields = useMemo(
      () => agentInfo?.settings_obj?.input_fields || [],
      [agentInfo?.settings_obj?.input_fields]
    );
    const outputFields = useMemo(
      () => agentInfo?.settings_obj?.output_fields || [],
      [agentInfo?.settings_obj?.output_fields]
    );

    const initForm = useCallback(() => {
      const items: FormItem[] = inputFields.map((item: any) => {
        if (['tag', 'file', 'array_image', 'array_audio', 'array_video', 'array_file'].includes(item.type)) {
          return { ...item, value: [] };
        }
        if (item.type === 'array_text') {
          return { ...item, value: [''] };
        }
        return {
          ...item,
          value: item.type === 'select' && item.multiple ? [] : '',
        };
      });
      setFormItems(items);
      setShowResult(false);
      setResult([]);
      setResultString('');
    }, [inputFields]);

    // Initialize form when inputFields changes
    useEffect(() => {
      if (inputFields.length > 0) {
        initForm();
      }
    }, [inputFields, initForm]);

    useEffect(() => {
      // 当会话变化时，加载历史数据或重置表单状态
      if (!currentConversationId || currentConversationId === 0) {
        // 新会话，重置表单和结果状态
        initForm();
        setShowResult(false);
        setResult([]);
        setResultString('');
        return;
      }

      // 加载历史数据
      const loadHistory = async () => {
        try {
          const response = await adapters.conversationApi.messages(String(currentConversationId), { limit: 10 });
          const messages = response?.data?.messages || response?.messages || [];

          if (messages.length === 0) {
            initForm();
            return;
          }

          // 查找最后一条用户消息和助手消息
          const lastAssistantMessage = [...messages].reverse().find((m: any) =>
            m.role === 'assistant' || m.answer
          );

          let inputParams: Record<string, any> = {};
          const parsedMessage = lastAssistantMessage?.parsed_message;

          if (parsedMessage && typeof parsedMessage === 'object' && !Array.isArray(parsedMessage)) {
            inputParams = parsedMessage;
          }

          // 恢复表单状态 - 使用 inputFields 而不是 formItems
          if (Object.keys(inputParams).length > 0 && inputFields.length > 0) {
            const newItems = inputFields.map((item: any) => {
              const value = inputParams[item.label] ?? inputParams[item.variable];
              // 根据类型初始化默认值
              let defaultValue: any;
              if (['tag', 'file', 'array_image', 'array_audio', 'array_video', 'array_file'].includes(item.type)) {
                defaultValue = [];
              } else if (item.type === 'array_text') {
                defaultValue = [''];
              } else {
                defaultValue = item.type === 'select' && item.multiple ? [] : '';
              }

              if (value !== undefined) {
                if (Array.isArray(defaultValue)) {
                  return { ...item, value: typeof value === 'string' ? value.split(',') : value };
                }
                return { ...item, value };
              }
              return { ...item, value: defaultValue };
            });
            setFormItems(newItems);
          }

          if (lastAssistantMessage) {
            const parsedAnswer = lastAssistantMessage.parsed_answer;
            let outputData: Record<string, any> = {};
            if (parsedAnswer && typeof parsedAnswer === 'object') {
              // 对于 workflow 模式，parsed_answer 可能直接包含输出变量
              const metadataKeys = ['created_at', 'message_id', 'mode', 'text', 'updated_at', 'conversation_id'];
              for (const key of Object.keys(parsedAnswer)) {
                if (!metadataKeys.includes(key)) {
                  outputData[key] = parsedAnswer[key];
                }
              }

              // 如果没有其他输出字段，使用 text 作为结果
              if (Object.keys(outputData).length === 0 && parsedAnswer.text) {
                outputData = { text: parsedAnswer.text };
              }
            }

            // 恢复结果显示
            if (Object.keys(outputData).length > 0) {
              const output: ResultItem[] = outputFields
                .filter((item: any) => outputData[item.variable])
                .map((item: any) => ({
                  id: item.id,
                  label: item.label || '',
                  type: item.type,
                  variable: item.variable || '',
                  value: outputData[item.variable] || '',
                }));

              if (output.length > 0) {
                setResult(output);
                const resultStr = output.map((item) => String(item.value)).join('\n');
                setResultString(resultStr);
                setShowResult(true);
              } else if (parsedAnswer?.text) {
                // 如果没有匹配的输出字段，显示 text
                setResult([]);
                setResultString(parsedAnswer.text);
                setShowResult(true);
              }
            } else if (lastAssistantMessage.answer) {
              // 兜底：使用 answer 字段
              setResult([]);
              setResultString(lastAssistantMessage.answer);
              setShowResult(true);
            }
          }
        } catch (error) {
          console.error('Failed to load history:', error);
          initForm();
        }
      };

      void loadHistory();
    }, [currentConversationId, adapters.conversationApi, inputFields, outputFields, initForm]);

    // Handle next_agent_prepare - 预填充表单参数
    useEffect(() => {
      if (!nextAgentPrepare?.agent_id || !agentInfo?.agent_id) return;
      if (String(nextAgentPrepare.agent_id) !== String(agentInfo.agent_id)) return;
      if (formItems.length === 0) return;

      // 预填充表单
      const prepareParams = nextAgentPrepare.parameters || {};
      const newItems = formItems.map((item) => {
        const value = prepareParams[item.id];
        if (value !== undefined) {
          if (Array.isArray(item.value)) {
            return { ...item, value: typeof value === 'string' ? value.split(',') : value };
          }
          return { ...item, value };
        }
        return item;
      });
      setFormItems(newItems);

      // 自动执行
      if (nextAgentPrepare.execution_rule === 'auto') {
        setTimeout(() => {
          handleStartRunning();
        }, 100);
      }

      // 清空 next_agent_prepare
      setNextAgentPrepare({});
    }, [nextAgentPrepare, agentInfo?.agent_id, formItems.length]);

    const handleFocusTag = (index: number) => {
      const newItems = [...formItems];
      newItems[index].temp = '';
      newItems[index].focus = true;
      setFormItems(newItems);
    };

    const handleAddTag = (index: number) => {
      const newItems = [...formItems];
      const temp = newItems[index].temp?.trim();
      if (temp) {
        newItems[index].value = [temp, ...newItems[index].value];
        newItems[index].temp = '';
      }
      newItems[index].focus = false;
      setFormItems(newItems);
    };

    const handleDelTag = (itemIndex: number, tagIndex: number) => {
      const newItems = [...formItems];
      newItems[itemIndex].value = newItems[itemIndex].value.filter((_: any, i: number) => i !== tagIndex);
      setFormItems(newItems);
    };

    const handleArrayTextAdd = (itemIndex: number) => {
      const newItems = [...formItems];
      newItems[itemIndex].value = [...newItems[itemIndex].value, ''];
      setFormItems(newItems);
    };

    const handleArrayTextDelete = (itemIndex: number, textIndex: number) => {
      const newItems = [...formItems];
      if (newItems[itemIndex].value.length === 1) {
        newItems[itemIndex].value = [''];
      } else {
        newItems[itemIndex].value = newItems[itemIndex].value.filter((_: any, i: number) => i !== textIndex);
      }
      setFormItems(newItems);
    };

    const handleFileChange = (itemIndex: number, fileList: any[]) => {
      const newItems = [...formItems];
      newItems[itemIndex].value = fileList;
      setFormItems(newItems);
    };

    const handleViewFile = (file: any) => {
      window.open(file.url, '_blank');
    };

    const handleDelFile = (file: any, itemIndex: number) => {
      const newItems = [...formItems];
      newItems[itemIndex].value = newItems[itemIndex].value.filter((f: any) => f.uid !== file.uid);
      setFormItems(newItems);
    };

    const getInputs = () => {
      const inputs: Record<string, any> = {};
      formItems.forEach((item) => {
        if (item.value?.toString() === '') return;

        if (item.type === 'file') {
          inputs[item.variable] = Array.isArray(item.value)
            ? item.value.map((f: any) => `file_id:${f.uid}`).join(',')
            : `file_id:${item.value}`;
        } else if (['array_image', 'array_audio', 'array_video', 'array_file'].includes(item.type)) {
          inputs[item.variable] = item.value.map((f: any) => `file_id:${f.uid}`);
        } else if (item.type === 'array_text') {
          inputs[item.variable] = item.value;
        } else {
          inputs[item.variable] =
            item.type === 'select' && !item.multiple
              ? item.value
              : Array.isArray(item.value)
                ? item.value.join(',')
                : String(item.value);
        }
      });
      return inputs;
    };

    const getQuestion = (inputs: Record<string, any>) => {
      const keys = Object.keys(inputs);
      for (const key of keys) {
        const value = inputs[key];
        if (value === undefined) continue;
        if (typeof value === 'string' && value.includes('file_id:')) {
          return 'image';
        }
        if (value !== undefined) {
          return String(value).slice(0, 20);
        }
      }
      return '';
    };

    const handleStartRunning = async () => {
      try {
        await form.validateFields();
      } catch {
        return;
      }

      const agentId = agentInfo?.agent_id;
      if (!agentId) {
        message.warning(t('chat.no_available_agent') || 'No available agent');
        return;
      }

      // 权限校验
      if (permission?.checkAccess) {
        const hasPermission = await permission.checkAccess(agentId);
        if (!hasPermission) {
          return;
        }
      }

      const inputs = getInputs();
      setLoading(true);

      try {
        const conv = await createConversation(agentId, getQuestion(inputs));
        addConversation({
          ...conv,
          virtual_id: Date.now().toString(),
        });
        setCurrentState(agentId, conv.conversation_id);

        const data = {
          conversation_id: conv.conversation_id,
          model: `agent-${agentId}`,
          parameters: inputs,
          stream: true,
        };

        abortControllerRef.current = new AbortController();

        const response = await workflowApi.run(data, {
          signal: abortControllerRef.current.signal,
        });

        // response 可能是 AxiosResponse 对象或已解析的数据
        // AxiosResponse: { data: { data: { workflow_output_data: {...} } } }
        // 已解析: { data: { workflow_output_data: {...} } }
        let resData: any = response;
        if (typeof response === 'object' && response !== null) {
          // 如果是 AxiosResponse，取 response.data
          if ('status' in response && 'headers' in response) {
            resData = response.data;
          }
          // 再取内部的 data 属性
          if (resData && 'data' in resData) {
            resData = resData.data;
          }
        }
        const workflowOutputData = resData?.workflow_output_data || {};

        // 按照所有 output_fields 构建结果
        const output: ResultItem[] = outputFields
          .filter((item: any) => workflowOutputData[item.variable])
          .map((item: any) => ({
            id: item.id,
            label: item.label || '',
            type: item.type,
            variable: item.variable || '',
            value: workflowOutputData[item.variable] || '',
          }));
        setResult(output);

        // 拼接结果字符串用于复制和下载
        const resultStr = output.map((item) => String(item.value)).join('\n');
        setResultString(resultStr || JSON.stringify(workflowOutputData, null, 2));

        setShowResult(true);
        completion?.onComplete?.();
      } catch (error: any) {
        console.error('Run error:', error);
        // 显示错误消息，不切换界面
        try {
          const resData = JSON.parse(error.response?.data || '{}');
          message.error(resData.message || t('chat.workflow_error') || 'Workflow error');
        } catch {
        }
      } finally {
        setLoading(false);
        abortControllerRef.current = null;
      }
    };

    const handleRestart = () => {
      initForm();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };

    const handleCopy = () => {
      const text = result.map((item) => item.value).join('\n');
      copyToClip(text);
      message.success(t('action.copied') || 'Copied');
    };

    const handleDownload = () => {
      downloadFile(result, `result_output_${Date.now()}.json`);
    };

    // 检查是否存在必填项为空
    const hasRequiredEmpty = useMemo(() => {
      return formItems.some(item =>
        item.required &&
        (item.value === '' ||
         item.value === undefined ||
         item.value === null ||
         (Array.isArray(item.value) && item.value.length === 0))
      );
    }, [formItems]);

    useImperativeHandle(ref, () => ({
      restart: handleRestart,
    }));

    const getSrc = (value: any, id: string) => {
      if (typeof value === 'object' && value !== null) {
        for (const key in value) {
          if (Object.prototype.hasOwnProperty.call(value, key)) {
            const val = value[key];
            if (typeof val === 'string' && isUrl(val)) {
              return val;
            }
          }
        }
        setResult((prev) => prev.filter((item) => item.id !== id));
        message.error(t('error.not_found_url') || 'URL not found');
      }
      return value;
    };

    const renderFormItem = (item: FormItem, index: number) => {
      switch (item.type) {
        case 'text':
          return (
            <Form.Item
              label={item.label}
              required={item.required}
              rules={[{ required: item.required, message: (t('form.input_placeholder') || 'Please input') + item.label }]}
            >
              <Input
                value={item.value}
                onChange={(e) => {
                  const newItems = [...formItems];
                  newItems[index].value = e.target.value;
                  setFormItems(newItems);
                }}
                placeholder={t('form.input_placeholder') || 'Please input'}
                maxLength={item.max_length || undefined}
                showCount={item.show_word_limit}
              />
              {item.desc && <div className="text-xs text-gray-400 mt-1">{item.desc}</div>}
            </Form.Item>
          );

        case 'textarea':
          return (
            <Form.Item
              label={item.label}
              required={item.required}
              rules={[{ required: item.required, message: (t('form.input_placeholder') || 'Please input') + item.label }]}
            >
              <Input.TextArea
                value={item.value}
                onChange={(e) => {
                  const newItems = [...formItems];
                  newItems[index].value = e.target.value;
                  setFormItems(newItems);
                }}
                rows={4}
                style={{ resize: 'none' }}
                placeholder={t('form.input_placeholder') || 'Please input'}
                maxLength={item.max_length || undefined}
                showCount={item.show_word_limit}
              />
              {item.desc && <div className="text-xs text-gray-400 mt-1">{item.desc}</div>}
            </Form.Item>
          );

        case 'inputNumber':
          return (
            <Form.Item
              label={item.label}
              required={item.required}
              rules={[{ required: item.required, message: (t('form.input_placeholder') || 'Please input') + item.label }]}
            >
              <InputNumber
                value={item.value}
                onChange={(val) => {
                  const newItems = [...formItems];
                  newItems[index].value = val;
                  setFormItems(newItems);
                }}
                min={1}
                className="w-full"
                placeholder={t('form.input_placeholder') || 'Please input'}
              />
              {item.desc && <div className="text-xs text-gray-400 mt-1">{item.desc}</div>}
            </Form.Item>
          );

        case 'select':
          return (
            <Form.Item
              label={item.label}
              required={item.required}
              rules={[{ required: item.required, message: (t('form.select_placeholder') || 'Please select') + item.label }]}
            >
              <Select
                value={item.value}
                onChange={(val) => {
                  const newItems = [...formItems];
                  newItems[index].value = val;
                  setFormItems(newItems);
                }}
                mode={item.multiple ? 'multiple' : undefined}
                placeholder={t('form.select_placeholder') || 'Please select'}
                options={item.options}
                className="w-full"
              />
              {item.desc && <div className="text-xs text-gray-400 mt-1">{item.desc}</div>}
            </Form.Item>
          );

        case 'tag':
          return (
            <Form.Item
              label={item.label}
              required={item.required}
              rules={[{ required: item.required, message: (t('form.input_placeholder') || 'Please input') + item.label }]}
            >
              <div className="flex flex-wrap gap-3">
                {item.value.map((tag: string, tagIndex: number) => (
                  <div
                    key={tagIndex}
                    className="border border-[#B0B7C3] rounded min-h-[32px] inline-flex items-center px-3 py-1 text-xs text-[#182B50] opacity-80 break-all"
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
                      const newItems = [...formItems];
                      newItems[index].temp = e.target.value;
                      setFormItems(newItems);
                    }}
                    onPressEnter={() => handleAddTag(index)}
                    onBlur={() => handleAddTag(index)}
                    placeholder={t('form.input_placeholder') || 'Please input'}
                  />
                ) : (
                  <div
                    className="border border-[#B0B7C3] border-dashed rounded h-8 inline-flex items-center px-3 cursor-pointer"
                    onClick={() => handleFocusTag(index)}
                  >
                    <span className="text-xs text-[#182B50] opacity-80">+ {t('action.add') || 'Add'}</span>
                  </div>
                )}
              </div>
              {item.desc && <div className="text-xs text-[#182b50] opacity-30 mt-1">{item.desc}</div>}
            </Form.Item>
          );

        case 'file':
        case 'array_image':
        case 'array_audio':
        case 'array_video':
        case 'array_file':
          return (
            <Form.Item
              label={item.label}
              required={item.required}
              rules={[{ required: item.required, message: (t('form.input_placeholder') || 'Please input') + item.label }]}
            >
              <div className="w-full">
                <div style={{ display: item.file_limit !== item.value.length ? 'block' : 'none' }}>
                  <Upload
                    fileList={item.value}
                    onChange={({ fileList }) => handleFileChange(index, fileList)}
                    accept={item.file_accept?.map((ext) => `.${ext}`).join(',')}
                    maxCount={item.file_limit}
                    multiple={item.file_limit !== 1}
                    showUploadList={false}
                  >
                    <div className="w-20 h-20 border border-dashed rounded flex items-center justify-center flex-col cursor-pointer">
                      <div className="text-xs text-[#182B50]/40 mt-2">{t('action.click_upload') || 'Upload'}</div>
                    </div>
                  </Upload>
                </div>
                {item.value.map((file: any) => (
                  <div key={file.uid} className="h-9 px-2 border rounded mt-3 flex items-center gap-2">
                    <div className="flex-1 text-sm text-[#182B50] truncate">{file.name}</div>
                    {file.status === 'done' ? (
                      <div className="flex items-center">
                        <Button type="link" size="small" onClick={() => handleViewFile(file)}>
                          {t('action.view') || 'View'}
                        </Button>
                        <div className="w-px h-4 mx-1 bg-[#E3E5EA]" />
                        <Button type="link" size="small" danger onClick={() => handleDelFile(file, index)}>
                          {t('action.delete') || 'Delete'}
                        </Button>
                      </div>
                    ) : (
                      <LoadingOutlined className="animate-spin" />
                    )}
                  </div>
                ))}
                <div className="flex items-center gap-1 mt-2">
                  <WarningOutlined style={{ color: '#182B50', fontSize: 14 }} />
                  <span className="text-xs text-[#182B50]/80">
                    {t('file.file_size', { size: item.file_size ?? '' }) || `Max file size: ${item.file_size}MB`}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-[#182B50]/80">
                    {t('file.file_format', { format: item.file_accept?.join('、') ?? '' }) || `Format: ${item.file_accept?.join(', ')}`}
                  </span>
                </div>
              </div>
            </Form.Item>
          );

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
                        const newItems = [...formItems];
                        newItems[index].value[textIndex] = e.target.value;
                        setFormItems(newItems);
                      }}
                      placeholder={t('form.input_placeholder') || 'Please input'}
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
                      {t('action.add') || 'Add'}
                    </Button>
                  )}
                </div>
              ))}
              {item.desc && <div className="text-xs text-[#182b50] opacity-30 mt-1">{item.desc}</div>}
            </div>
          );

        default:
          return (
            <Form.Item
              label={item.label}
              required={item.required}
              rules={[{ required: item.required, message: (t('form.input_placeholder') || 'Please input') + item.label }]}
            >
              <Input
                value={item.value}
                onChange={(e) => {
                  const newItems = [...formItems];
                  newItems[index].value = e.target.value;
                  setFormItems(newItems);
                }}
                placeholder={t('form.input_placeholder') || 'Please input'}
              />
            </Form.Item>
          );
      }
    };

    const renderResultItem = (item: ResultItem) => {
      switch (item.type) {
        case 'markdown':
          return <BubbleAssistant content={item.value} streaming={loading} />;

        case 'image':
        case 'array_image': {
          const images = Array.isArray(item.value) ? item.value : [item.value];
          return (
            <div className="overflow-hidden flex flex-col gap-5">
              {images.map((src: string, i: number) => (
                <img key={i} src={src} className="max-w-full h-auto object-contain rounded" alt="" />
              ))}
            </div>
          );
        }

        case 'video':
        case 'array_video': {
          const videos = Array.isArray(item.value) ? item.value : [item.value];
          return (
            <div className="overflow-hidden flex flex-col gap-5">
              {videos.map((src: string, i: number) => (
                <video key={i} src={getSrc(src, item.id)} controls className="max-w-full h-auto" />
              ))}
            </div>
          );
        }

        case 'audio':
        case 'array_audio': {
          const audios = Array.isArray(item.value) ? item.value : [item.value];
          return (
            <div className="overflow-hidden flex flex-col gap-5">
              {audios.map((src: string, i: number) => (
                <audio key={i} src={getSrc(src, item.id)} controls className="max-w-full" />
              ))}
            </div>
          );
        }

        default: {
          const texts = Array.isArray(item.value) ? item.value : [item.value];
          return (
            <div className="whitespace-pre-wrap break-all">
              {texts.map((text: string, i: number) => (
                <p key={i}>{text}</p>
              ))}
            </div>
          );
        }
      }
    };

    // Usage Guide Panel - 右侧固定宽度面板
    const guidePanel = showGuide && guideEnabled && (
      <div className="flex-none w-[450px] h-full flex flex-col bg-white overflow-hidden">
        <div className="h-15 flex items-center justify-between px-5 border-b">
          <h4 className="text-lg text-[#1F2123]">{t('chat.usage_guide')}</h4>
          <div
            className="flex items-center justify-center size-6 rounded cursor-pointer hover:bg-[#ECEDEE]"
            onClick={() => setShowGuide(false)}
          >
            <CloseOutlined />
          </div>
        </div>
        <UsageGuide useCases={agentInfo?.use_cases} />
      </div>
    );

    // Agent Loading State
    if (agentLoading) {
      return <LoadingState />;
    }

    // No Agent State
    if (!agentInfo) {
      const noAgentHeader = slots?.header
        ? slots.header({
            agentInfo: {} as IAgentInfo,
            lang,
            setLang,
            showGuide,
            onGuideChange: setShowGuide,
          })
        : (
          <ChatHeader
            agentInfo={{} as IAgentInfo}
            lang={lang}
            setLang={setLang}
            showGuide={showGuide}
            onGuideChange={setShowGuide}
            isEmbedMode={embedMode.isEmbedMode}
            features={{
              languageSwitcher: languageSwitcherEnabled,
              guide: guideEnabled,
              share: false,
            }}
          />
        );
      return (
        <div className={`flex h-full ${showGuide ? "gap-0" : ""}`}>
          <div className={`flex-1 flex flex-col h-full bg-white ${showGuide ? 'border-r' : ''}`}>
            {noAgentHeader}
            <div className="flex-1 flex items-center justify-center">
              <Empty description={t('chat.no_available_agent') || 'No available agent'} />
            </div>
          </div>
          {guidePanel}
        </div>
      );
    }

    // Main Content Wrapper
    const contentWrapper = (
      <div className="flex-1 flex flex-col md:flex-row gap-3 p-3 overflow-y-auto bg-[#F5F6F7]">
        {showResult ? (
          <>
            {/* Input Summary */}
            <div className="w-full lg:w-2/5 md:w-2/5 md:h-full bg-white rounded flex flex-col mb-3 md:mb-0">
              <h3 className="flex-none h-14 flex items-center px-4 md:px-7 text-base text-[#1D1E1F] border-b">
                {t('chat.input') || 'Input'}
              </h3>
              <div className="flex-1 p-4 overflow-y-auto">
                <div className="text-sm text-gray-600">
                  {formItems.map((item) => (
                    <div key={item.id} className="mb-3">
                      <div className="text-gray-400 text-xs mb-1">{item.label}</div>
                      <div className="text-[#1D1E1F]">
                        {Array.isArray(item.value) ? item.value.join(', ') : String(item.value || '-')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t px-4 py-4">
                <Button type="primary" size="large" className="w-full" onClick={handleRestart}>
                  {t('action.restart') || 'Restart'}
                </Button>
              </div>
            </div>

            {/* Output */}
            <div className="flex-1 md:h-full bg-white rounded flex flex-col">
              <h3 className="flex-none h-14 flex items-center px-4 md:px-7 text-base text-[#1D1E1F] border-b">
                {t('chat.output') || 'Output'}
                {!loading && result.length > 0 && (
                  <div className="ml-auto flex gap-2">
                    <Button type="link" size="small" icon={<CopyOutlined />} onClick={handleCopy} />
                    <Button type="link" size="small" icon={<DownloadOutlined />} onClick={handleDownload} />
                  </div>
                )}
              </h3>
              <div className="flex-1 px-4 md:px-7 py-6 overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center h-32">
                    <BubbleAssistant content="" streaming={true} />
                  </div>
                ) : result.length > 0 ? (
                  <div className="text-sm text-[#1D1E1F]">
                    {result.map((item) => (
                      <div key={item.id} className="mb-4">
                        {renderResultItem(item)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap break-all text-sm text-[#1D1E1F]">
                    {resultString}
                  </div>
                )}
              </div>
              {/* RelatedScene - 显示关联智能体 */}
              {showRelatedScene && Boolean(agentInfo?.settings_obj?.relate_agents?.length) && showResult && !loading && (
                <div className="sticky bottom-0 px-4 pb-2">
                  <RelatedScene
                    isWorkflow={true}
                    output={result}
                    relateAgents={agentInfo.settings_obj?.relate_agents || []}
                    currentAgentId={agentInfo.agent_id}
                    onNextAgent={agentRecommend?.onNavigateNext}
                    onInitAgent={agentRecommend?.onRefresh}
                  />
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Input Form */}
            <div className="w-full lg:w-2/5 md:w-2/5 md:h-full bg-white rounded flex flex-col mb-3 md:mb-0">
              <h3 className="flex-none h-14 flex items-center px-4 md:px-7 text-base text-[#1D1E1F] border-b">
                {t('chat.input') || 'Input'}
              </h3>
              <div className="flex-1 p-4 overflow-y-auto">
                <Form form={form}>
                  {formItems.map((item, index) => (
                    <div key={item.id || item.variable || index} className="mb-4">
                      {renderFormItem(item, index)}
                    </div>
                  ))}
                </Form>
              </div>
              <div className="border-t px-4 md:px-7 py-4 md:py-5">
                <Button
                  type="primary"
                  className="w-full"
                  size="large"
                  loading={loading}
                  disabled={hasRequiredEmpty}
                  onClick={handleStartRunning}
                >
                  {t('chat.start_generate') || 'Start Generate'}
                </Button>
              </div>
            </div>

            {/* Output */}
            <div className="flex-1 md:h-full bg-white rounded flex flex-col">
              <h3 className="flex-none h-14 flex items-center px-4 md:px-7 text-base text-[#1D1E1F] border-b">
                {t('chat.output') || 'Output'}
              </h3>
              <div className="flex-1 px-4 md:px-7 py-6 flex items-center justify-center">
                {loading ? (
                  <BubbleAssistant content="" streaming={true} />
                ) : (
                  <Empty
                    description={t('chat.completion_empty_desc') || 'Run to see results'}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );

    // 渲染 header
    const header = slots?.header
      ? slots.header({
          agentInfo,
          lang,
          setLang,
          showGuide,
          onGuideChange: setShowGuide,
        })
      : (
        <ChatHeader
          agentInfo={agentInfo}
          lang={lang}
          setLang={setLang}
          showGuide={showGuide}
          onGuideChange={setShowGuide}
          isEmbedMode={embedMode.isEmbedMode}
          onClose={embedMode.requestClose}
          features={{
            languageSwitcher: languageSwitcherEnabled,
            guide: guideEnabled,
            share: false,
          }}
        />
      );

    return (
      <div className={`flex h-full ${showGuide ? "gap-0" : ""}`}>
        {/* 主内容区域 */}
        <div className={`flex-1 flex flex-col h-full bg-white ${showGuide ? 'border-r' : ''}`}>
          {header}
          {contentWrapper}
        </div>
        {/* 使用指引右侧面板 */}
        {guidePanel}
      </div>
    );
  }
);

CompletionView.displayName = 'CompletionView';
