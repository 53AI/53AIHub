import {
  useState, useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle
} from "react";
import { useNavigate } from "react-router-dom";
import {
  Form,
  Input,
  InputNumber,
  Select,
  DatePicker,
  Button,
  Empty,
  Tooltip,
  Upload,
  message,
  Image,
} from "antd";
import {
  LeftOutlined,
  CloseOutlined,
  CopyOutlined,
  DownloadOutlined,
  PlusOutlined,
  LoadingOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import { useConversationStore } from "@/stores/modules/conversation";
import { useCurrentAgent } from "@/stores/modules/agent";
import { useEnterpriseStore } from "@/stores/modules/enterprise";
import { t } from "@/locales";
import { checkPermission } from "@/utils/permission";
import chatApi from "@/api/modules/chat";
import { downloadFile, copyToClip, isUrl } from "@km/shared-utils";
import { getPublicPath } from "@/utils/config";
import ChatHelper from "../helper";
import RelatedScene from "@/components/RelatedScene";
import { BubbleAssistant } from "@km/hub-ui-x-react";
import "./Completion.css";

const DEFAULT_IMG = "/images/default_agent.png";

const { TextArea } = Input;
const { RangePicker } = DatePicker;

interface CompletionProps {
  hideMenuHeader?: boolean;
  useCaseFixed?: boolean;
}

export interface CompletionRef {
  showUseCase: () => void;
  hideUseCase: () => void;
}

interface InputField {
  id: string;
  type: string;
  label: string;
  variable: string;
  required: boolean;
  desc?: string;
  max_length?: number;
  show_word_limit?: boolean;
  multiple?: boolean;
  options?: { label: string; value: string }[];
  date_format?: string;
  file_accept?: string[];
  file_limit?: number;
  file_size?: number;
  limit?: number;
  value: any;
  temp?: string;
  focus?: boolean;
}

interface OutputField {
  id: string;
  label: string;
  type: string;
  variable: string;
  value: any;
}

const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  const target = e.target as HTMLImageElement;
  const fallback = getPublicPath(DEFAULT_IMG);
  if (target.src.endsWith(fallback)) return;
  target.src = fallback;
};

const Completion = forwardRef<CompletionRef, CompletionProps>(
  ({ hideMenuHeader = false, useCaseFixed = false }, ref) => {
    const navigate = useNavigate();
    const convStore = useConversationStore();
    const enterpriseStore = useEnterpriseStore();

    const currentAgent = useCurrentAgent();
    const [inputForm, setInputForm] = useState<InputField[]>([]);
    const [loading, setLoading] = useState(false);
    const [showOutput, setShowOutput] = useState(false);
    const [result, setResult] = useState<OutputField[]>([]);
    const [resultStr, setResultStr] = useState("");
    const [showHelper, setShowHelper] = useState(false);
    const [imageVisible, setImageVisible] = useState(false);
    const [imageFile, setImageFile] = useState("");
    const abortControllerRef = useRef<AbortController | null>(null);
    const handleRunRef = useRef<() => Promise<void>>(() => Promise.resolve());

    // Debounce helper
    const debounce = useCallback((fn: Function, delay: number) => {
      let timer: NodeJS.Timeout;
      return (...args: any[]) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
      };
    }, []);

    // Validator for array fields
    const validator = useCallback((item: InputField) => {
      return (_rule: any, _value: any, callback: (error?: string) => void) => {
        if (item.required) {
          const hasVal = item.value?.some((v: string) => v?.trim());
          if (hasVal) callback();
          else callback(t("chat.form_required_add", { label: item.label }));
        } else {
          callback();
        }
      };
    }, []);

    // Get URL from object
    const getSrc = useCallback((value: any, id: string) => {
      if (typeof value === "object" && value !== null) {
        for (const key in value) {
          if (Object.prototype.hasOwnProperty.call(value, key)) {
            const val = value[key];
            if (typeof val === "string" && isUrl(val)) {
              return val;
            }
          }
        }
        setResult((prev) => prev.filter((item) => item.id !== id));
        message.error(t("chat.not_found_url"));
      }
      return value;
    }, []);

    // Tag handlers
    const handleFocusTag = useCallback((item: InputField) => {
      setInputForm((prev) =>
        prev.map((f) =>
          f.id === item.id ? { ...f, temp: "", focus: true } : f,
        ),
      );
    }, []);

    const handleAddTag = useCallback((item: InputField) => {
      const temp = item.temp?.trim();
      if (temp) {
        setInputForm((prev) =>
          prev.map((f) =>
            f.id === item.id
              ? { ...f, value: [temp, ...f.value], temp: "", focus: false }
              : f,
          ),
        );
      } else {
        setInputForm((prev) =>
          prev.map((f) => (f.id === item.id ? { ...f, focus: false } : f)),
        );
      }
    }, []);

    const handleDelTag = useCallback((item: InputField, index: number) => {
      setInputForm((prev) =>
        prev.map((f) =>
          f.id === item.id
            ? {
                ...f,
                value: f.value.filter((_: any, i: number) => i !== index),
              }
            : f,
        ),
      );
    }, []);

    // Array text handlers
    const handleArrayTextAdd = useCallback((item: InputField) => {
      setInputForm((prev) =>
        prev.map((f) =>
          f.id === item.id ? { ...f, value: [...f.value, ""] } : f,
        ),
      );
    }, []);

    const handleArrayTextDelete = useCallback(
      (item: InputField, index: number) => {
        setInputForm((prev) =>
          prev.map((f) => {
            if (f.id === item.id) {
              if (f.value.length === 1) {
                return { ...f, value: [""] };
              }
              return {
                ...f,
                value: f.value.filter((_: any, i: number) => i !== index),
              };
            }
            return f;
          }),
        );
      },
      [],
    );

    // File handlers
    const handleViewFile = useCallback((file: any) => {
      setImageVisible(true);
      setImageFile(file?.url);
    }, []);

    const handleDelFile = useCallback((file: any, item: InputField) => {
      setInputForm((prev) =>
        prev.map((f) =>
          f.id === item.id
            ? {
                ...f,
                value: f.value.filter((item: any) => item.id !== file.id),
              }
            : f,
        ),
      );
    }, []);

    // Download result
    const handleDownload = useCallback(() => {
      downloadFile(result, `result_output_${Date.now()}.json`);
    }, [result]);

    // Get inputs from form
    const getInputs = useCallback(() => {
      const inputs = inputForm.reduce(
        (result, item) => {
          if (item.value?.toString() === "") return result;
          if (item.type === "file") {
            result[`${item.variable}`] = item.value
              .map((f: any) => `file_id:${f.id}`)
              .join(",");
          } else if (
            [
              "array_image",
              "array_audio",
              "array_video",
              "array_file",
            ].includes(item.type)
          ) {
            result[`${item.variable}`] = item.value.map(
              (f: any) => `file_id:${f.id}`,
            );
          } else if (item.type === "array_text") {
            result[`${item.variable}`] = item.value;
          } else {
            result[`${item.variable}`] =
              item.type === "select" && !item.multiple
                ? item.value
                : Array.isArray(item.value)
                  ? item.value.join(",")
                  : String(item.value);
          }
          return result;
        },
        {} as Record<string, any>,
      );
      Object.keys(inputs).forEach((key) => {
        if (inputs[key] === "" || inputs[key] === null) {
          delete inputs[key];
        }
      });
      return inputs;
    }, [inputForm]);

    // Get question from inputs
    const getQuestion = useCallback((inputs: Record<string, any>): string => {
      let question = "";
      let index = 0;
      const keys = Object.keys(inputs);
      if (keys.length === 0) return "";
      while (!question) {
        const value = inputs[keys[index]];
        if (value) {
          question = String(value).slice(0, 20);
          return question;
        }
        index++;
      }
      return "";
    }, []);

    // Run workflow
    const workflowRun = useCallback(async () => {
      setResult([]);
      setResultStr("");
      const { agent_id } = currentAgent;
      const inputs = getInputs();
      const conversation = await convStore.createConversation(
        agent_id,
        getQuestion(inputs),
      );

      const data = {
        conversation_id: conversation.conversation_id,
        model: `agent-${agent_id}`,
        parameters: inputs,
        stream: true,
      };
      setLoading(true);
      abortControllerRef.current = new AbortController();
      setShowOutput(true);

      try {
        const response = await chatApi.workflow.run(data, {
          onDownloadProgress: (e) => {
            console.log("Workflow progress:", e);
          },
          responseType: "stream",
          signal: abortControllerRef.current?.signal,
        });

        const res = JSON.parse(response as any);
        const output = (currentAgent?.settings_obj?.output_fields || []).reduce(
          (result: OutputField[], item: any) => {
            if (!res.data?.workflow_output_data?.[item.variable]) return result;
            result.push({
              id: item.id,
              label: item.label,
              type: item.type,
              variable: item.variable,
              value: res.data.workflow_output_data[item.variable] || "",
            });
            return result;
          },
          [],
        );
        setResult(output);
        setResultStr(output.map((item) => `${item.value}`).join("\n"));
      } catch (err) {
        console.error("Workflow error:", err);
        message.error(t("chat.workflow_error"));
      } finally {
        setLoading(false);
      }
    }, [currentAgent, convStore, getInputs, getQuestion]);

    // Handle run
    const handleRun = useCallback(async () => {
      try {
        // Validate form
        for (const item of inputForm) {
          if (item.required) {
            if (
              [
                "tag",
                "file",
                "array_image",
                "array_audio",
                "array_video",
                "array_file",
              ].includes(item.type)
            ) {
              if (
                !item.value?.length ||
                !item.value.some((v: any) => v?.toString().trim())
              ) {
                message.error(
                  t("chat.form_required_add", { label: item.label }),
                );
                return;
              }
            } else if (item.type === "array_text") {
              if (!item.value?.some((v: string) => v?.trim())) {
                message.error(
                  t("chat.form_required_add", { label: item.label }),
                );
                return;
              }
            } else if (!item.value?.toString().trim()) {
              message.error(t("form.input_placeholder") + item.label);
              return;
            }
          }
        }

        checkPermission({
          groupIds: currentAgent?.user_group_ids || [],
          onClick: async () => {
            const { agent_id } = currentAgent;
            if (!agent_id) {
              message.warning(t("chat.no_available_agent"));
              return;
            }
            await workflowRun();
            return true;
          },
        });
      } catch (err) {
        console.error("Form validation error:", err);
      }
    }, [inputForm, currentAgent, workflowRun]);

    // Keep ref updated for use in initForm
    useEffect(() => {
      handleRunRef.current = handleRun;
    }, [handleRun]);

    // Initialize form
    const initForm = useCallback(() => {
      const fields = (currentAgent?.settings_obj?.input_fields || []).map(
        (item: any) => {
          let value: any;
          if (
            [
              "tag",
              "file",
              "array_image",
              "array_audio",
              "array_video",
              "array_file",
            ].includes(item.type)
          ) {
            value = [];
          } else if (item.type === "select" && item.multiple) {
            value = [];
          } else if (item.type === "array_text") {
            value = [""];
          } else {
            value = "";
          }
          return {
            ...item,
            temp: "",
            value,
          };
        },
      );

      // Handle next_agent_prepare
      const prepare = convStore.next_agent_prepare;
      if (prepare.agent_id) {
        const mappedFields = fields.map((item: any) => {
          const value = prepare.parameters?.[item.id];
          if (value) {
            if (Array.isArray(item.value)) {
              return { ...item, value: value.split(",") || [] };
            }
            return { ...item, value: value || "" };
          }
          return item;
        });
        setInputForm(mappedFields);
        if (prepare.execution_rule === "auto") {
          setTimeout(() => handleRunRef.current(), 100);
        }
        convStore.setNextAgentPrepare({});
      } else {
        setInputForm(fields);
      }
    }, [currentAgent, convStore]);

    // Effects
    useEffect(() => {
      const agent_id = convStore.current_agentid;
      if (agent_id) {
        initForm();
      }
    }, [convStore.current_agentid, initForm]);

    const handleToggleGuide = useCallback(() => {
      setShowHelper((prev) => !prev);
    }, []);

    // Expose methods via ref
    useImperativeHandle(
      ref,
      () => ({
        showUseCase: () => setShowHelper(true),
        hideUseCase: () => setShowHelper(false),
      }),
      [],
    );

    return (
      <div className="h-full bg-[#F5F6F7] flex flex-col">
        {/* Header */}
        {!hideMenuHeader && (
          <header className="flex-none h-[70px] border-b sticky top-0 z-10 bg-white">
            <div className="mx-auto px-4 flex items-center justify-between h-full">
              <div className="flex-1 flex items-center gap-2 overflow-hidden">
                <Tooltip title={t("action.back")}>
                  <div
                    className="flex-none size-7 rounded-md flex-center cursor-pointer max-md:hidden hover:bg-[#ECEDEE]"
                    onClick={() => navigate("/agent")}
                  >
                    <LeftOutlined className="text-regular cursor-pointer" />
                  </div>
                </Tooltip>
                <div
                  className="text-base text-primary line-clamp-1 max-md:flex-1 max-md:text-center"
                  title={currentAgent?.name || ""}
                >
                  {currentAgent?.name || ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Mobile back button */}
                <span
                  className="flex items-center gap-1 text-sm cursor-pointer md:hidden"
                  onClick={() => navigate(-1)}
                >
                  <SvgIcon name="return" size={18} stroke />
                </span>
                <Tooltip title={t("chat.usage_guide")}>
                  <div
                    className="h-6 px-2 rounded-full flex-center gap-1 text-sm text-primary cursor-pointer hover:bg-[#E1E2E3]"
                    onClick={handleToggleGuide}
                  >
                    <SvgIcon name="layout-split" size={18} />
                  </div>
                </Tooltip>
              </div>
            </div>
          </header>
        )}

        <div className="h-full flex-1 flex flex-col md:flex-row gap-3 p-3 overflow-y-auto">
          {/* Input Form */}
          <div className="w-full lg:w-2/5 md:w-2/5 md:h-full bg-white rounded flex flex-col mb-3 md:mb-0">
            <h3 className="flex-none h-14 flex items-center px-4 md:px-7 text-base text-[#1D1E1F] border-b">
              {t("chat.input")}
            </h3>
            <div className="flex-1 p-4 overflow-y-auto">
              {inputForm.map((item, index) => (
                <div key={item.id} className="mb-4">
                  {/* Text Input */}
                  {item.type === "text" && (
                    <Form.Item
                      label={item.label}
                      required={item.required}
                      rules={[
                        {
                          required: item.required,
                          message: t("form.input_placeholder") + item.label,
                        },
                      ]}
                    >
                      <Input
                        value={item.value}
                        onChange={(e) => {
                          const newValue = e.target.value;
                          setInputForm((prev) =>
                            prev.map((f) =>
                              f.id === item.id ? { ...f, value: newValue } : f,
                            ),
                          );
                        }}
                        placeholder={t("form.input_placeholder")}
                        maxLength={item.max_length || undefined}
                        showCount={item.show_word_limit}
                      />
                      {item.desc && (
                        <div className="text-xs text-gray-400 mt-1">
                          {item.desc}
                        </div>
                      )}
                    </Form.Item>
                  )}

                  {/* Textarea */}
                  {item.type === "textarea" && (
                    <Form.Item
                      label={item.label}
                      required={item.required}
                      rules={[
                        {
                          required: item.required,
                          message: t("form.input_placeholder") + item.label,
                        },
                      ]}
                    >
                      <TextArea
                        value={item.value}
                        onChange={(e) => {
                          const newValue = e.target.value;
                          setInputForm((prev) =>
                            prev.map((f) =>
                              f.id === item.id ? { ...f, value: newValue } : f,
                            ),
                          );
                        }}
                        placeholder={t("form.input_placeholder")}
                        rows={4}
                        maxLength={item.max_length || undefined}
                        showCount={item.show_word_limit}
                      />
                      {item.desc && (
                        <div className="text-xs text-gray-400 mt-1">
                          {item.desc}
                        </div>
                      )}
                    </Form.Item>
                  )}

                  {/* InputNumber */}
                  {item.type === "inputNumber" && (
                    <Form.Item
                      label={item.label}
                      required={item.required}
                      rules={[
                        {
                          required: item.required,
                          message: t("form.input_placeholder") + item.label,
                        },
                      ]}
                    >
                      <InputNumber
                        value={item.value}
                        onChange={(newValue) => {
                          setInputForm((prev) =>
                            prev.map((f) =>
                              f.id === item.id ? { ...f, value: newValue } : f,
                            ),
                          );
                        }}
                        placeholder={t("form.input_placeholder")}
                        min={1}
                      />
                      {item.desc && (
                        <div className="text-xs text-gray-400 mt-1">
                          {item.desc}
                        </div>
                      )}
                    </Form.Item>
                  )}

                  {/* Select */}
                  {item.type === "select" && (
                    <Form.Item
                      label={item.label}
                      required={item.required}
                      rules={[
                        {
                          required: item.required,
                          message: t("form.select_placeholder") + item.label,
                        },
                      ]}
                    >
                      <Select
                        value={item.value}
                        onChange={(newValue) => {
                          setInputForm((prev) =>
                            prev.map((f) =>
                              f.id === item.id ? { ...f, value: newValue } : f,
                            ),
                          );
                        }}
                        mode={item.multiple ? "multiple" : undefined}
                        placeholder={t("form.select_placeholder")}
                        options={item.options}
                      />
                      {item.desc && (
                        <div className="text-xs text-gray-400 mt-1">
                          {item.desc}
                        </div>
                      )}
                    </Form.Item>
                  )}

                  {/* Date */}
                  {item.type === "date" && (
                    <Form.Item
                      label={item.label}
                      required={item.required}
                      rules={[
                        {
                          required: item.required,
                          message: t("form.select_placeholder"),
                        },
                      ]}
                    >
                      {item.date_format === "h-m" && (
                        <DatePicker.TimePicker
                          value={item.value}
                          onChange={(newValue) => {
                            setInputForm((prev) =>
                              prev.map((f) =>
                                f.id === item.id
                                  ? { ...f, value: newValue }
                                  : f,
                              ),
                            );
                          }}
                          format="HH:mm"
                          placeholder={t("form.select_placeholder")}
                        />
                      )}
                      {item.date_format === "y" && (
                        <DatePicker
                          value={item.value}
                          onChange={(newValue) => {
                            setInputForm((prev) =>
                              prev.map((f) =>
                                f.id === item.id
                                  ? { ...f, value: newValue }
                                  : f,
                              ),
                            );
                          }}
                          picker="year"
                          placeholder={t("form.select_placeholder")}
                        />
                      )}
                      {item.date_format === "y-m" && (
                        <DatePicker
                          value={item.value}
                          onChange={(newValue) => {
                            setInputForm((prev) =>
                              prev.map((f) =>
                                f.id === item.id
                                  ? { ...f, value: newValue }
                                  : f,
                              ),
                            );
                          }}
                          picker="month"
                          placeholder={t("form.select_placeholder")}
                        />
                      )}
                      {item.date_format === "y-m-d" && (
                        <DatePicker
                          value={item.value}
                          onChange={(newValue) => {
                            setInputForm((prev) =>
                              prev.map((f) =>
                                f.id === item.id
                                  ? { ...f, value: newValue }
                                  : f,
                              ),
                            );
                          }}
                          placeholder={t("form.select_placeholder")}
                        />
                      )}
                      {item.date_format === "y-m-d-h" && (
                        <DatePicker
                          value={item.value}
                          onChange={(newValue) => {
                            setInputForm((prev) =>
                              prev.map((f) =>
                                f.id === item.id
                                  ? { ...f, value: newValue }
                                  : f,
                              ),
                            );
                          }}
                          showTime
                          format="YYYY-MM-DD HH"
                          placeholder={t("form.select_placeholder")}
                        />
                      )}
                      {item.date_format === "daterange" && (
                        <RangePicker
                          value={item.value}
                          onChange={(newValue) => {
                            setInputForm((prev) =>
                              prev.map((f) =>
                                f.id === item.id
                                  ? { ...f, value: newValue }
                                  : f,
                              ),
                            );
                          }}
                          placeholder={[
                            t("form.select_placeholder"),
                            t("form.select_placeholder"),
                          ]}
                        />
                      )}
                      {item.desc && (
                        <div className="text-xs text-gray-400 mt-1">
                          {item.desc}
                        </div>
                      )}
                    </Form.Item>
                  )}

                  {/* Tag */}
                  {item.type === "tag" && (
                    <Form.Item
                      label={item.label}
                      required={item.required}
                      rules={[
                        { validator: validator(item), trigger: "change" },
                      ]}
                    >
                      <div className="flex flex-wrap gap-3">
                        {item.value.map((tag: string, childIndex: number) => (
                          <div
                            key={childIndex}
                            className="border border-[#B0B7C3] rounded min-h-[32px] inline-flex items-center px-3 py-1 text-xs text-gray-600"
                          >
                            {tag}
                            <CloseOutlined
                              className="cursor-pointer ml-1 text-gray-400"
                              onClick={() => handleDelTag(item, childIndex)}
                            />
                          </div>
                        ))}
                        {item.focus ? (
                          <Input
                            value={item.temp}
                            onChange={(e) => {
                              setInputForm((prev) =>
                                prev.map((f) =>
                                  f.id === item.id
                                    ? { ...f, temp: e.target.value }
                                    : f,
                                ),
                              );
                            }}
                            autoFocus
                            style={{ width: 104 }}
                            placeholder={t("form.input_placeholder")}
                            onPressEnter={() => handleAddTag(item)}
                            onBlur={() => handleAddTag(item)}
                          />
                        ) : (
                          <div
                            className="border border-[#B0B7C3] border-dashed rounded h-8 inline-flex items-center px-3 cursor-pointer"
                            onClick={() => handleFocusTag(item)}
                          >
                            <span className="text-xs text-gray-600">
                              + {t("action.add")}
                            </span>
                          </div>
                        )}
                      </div>
                      {item.desc && (
                        <div className="text-xs text-gray-400 mt-1">
                          {item.desc}
                        </div>
                      )}
                    </Form.Item>
                  )}

                  {/* File types */}
                  {[
                    "file",
                    "array_image",
                    "array_audio",
                    "array_video",
                    "array_file",
                  ].includes(item.type) && (
                    <Form.Item
                      label={item.label}
                      required={item.required}
                      rules={[
                        {
                          validator: validator(item),
                          trigger: ["change", "blur"],
                        },
                      ]}
                    >
                      <div className="w-full">
                        {item.limit !== item.value?.length && (
                          <Upload
                            accept={item.file_accept
                              ?.map((ext) => `.${ext}`)
                              .join(",")}
                            multiple={item.file_limit !== 1}
                            showUploadList={false}
                            beforeUpload={(file) => {
                              // TODO: Implement file upload with httpRequest
                              console.log("Upload file:", file);
                              return false;
                            }}
                          >
                            <div className="w-20 h-20 border border-dashed rounded flex-center flex-col cursor-pointer">
                              <div className="text-xs text-gray-400">
                                {t("action.click_upload")}
                              </div>
                            </div>
                          </Upload>
                        )}
                        {item.value?.map((file: any) => (
                          <div
                            key={file.uid}
                            className="h-9 px-2 border rounded mt-3 flex items-center gap-2"
                          >
                            <div className="flex-1 text-sm text-gray-600 truncate">
                              {file.name}
                            </div>
                            {file.status === "done" && (
                              <div className="flex items-center">
                                <Button
                                  type="link"
                                  onClick={() => handleViewFile(file)}
                                >
                                  {t("action.view")}
                                </Button>
                                <div className="w-px h-4 mx-1 bg-gray-200" />
                                <Button
                                  type="link"
                                  danger
                                  onClick={() => handleDelFile(file, item)}
                                >
                                  {t("action.delete")}
                                </Button>
                              </div>
                            )}
                            {file.status === "uploading" && <LoadingOutlined />}
                          </div>
                        ))}
                        <div className="flex items-center gap-1 mt-2">
                          <WarningOutlined style={{ color: "#182B50" }} />
                          <span className="text-xs text-gray-500">
                            {t("file.file_size", { size: item.file_size })}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">
                          {t("file.file_format", {
                            format: item.file_accept?.join("、"),
                          })}
                        </p>
                      </div>
                    </Form.Item>
                  )}

                  {/* Array Text */}
                  {item.type === "array_text" && (
                    <>
                      {item.value.map((text: string, inputIndex: number) => (
                        <Form.Item
                          key={inputIndex}
                          label={inputIndex === 0 ? item.label : ""}
                          required={item.required}
                          rules={[
                            {
                              required: item.required,
                              message: t("form.input_placeholder") + item.label,
                            },
                          ]}
                          className="relative"
                        >
                          <Input
                            value={text}
                            onChange={(e) => {
                              const newValue = [...item.value];
                              newValue[inputIndex] = e.target.value;
                              setInputForm((prev) =>
                                prev.map((f) =>
                                  f.id === item.id
                                    ? { ...f, value: newValue }
                                    : f,
                                ),
                              );
                            }}
                            placeholder={t("form.input_placeholder")}
                            maxLength={item.max_length || undefined}
                            suffix={
                              <SvgIcon
                                name="del"
                                width={16}
                                className="cursor-pointer hover:opacity-60"
                                onClick={() =>
                                  handleArrayTextDelete(item, inputIndex)
                                }
                              />
                            }
                          />
                          {item.desc && (
                            <div className="text-xs text-gray-400 mt-1">
                              {item.desc}
                            </div>
                          )}
                          {inputIndex === 0 && (
                            <Button
                              type="link"
                              className="absolute -top-7 right-0"
                              onClick={() => handleArrayTextAdd(item)}
                            >
                              <PlusOutlined /> {t("action.add")}
                            </Button>
                          )}
                        </Form.Item>
                      ))}
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="border-t px-4 md:px-7 py-4 md:py-5">
              <Button
                type="primary"
                className="w-full"
                size="large"
                loading={loading}
                onClick={debounce(handleRun, 300)}
              >
                {t("chat.start_generate")}
              </Button>
            </div>
          </div>

          {/* Output Area */}
          <div className="flex-1 md:h-full bg-white rounded flex flex-col">
            <h3 className="flex-none h-14 flex items-center px-4 md:px-7 text-base text-[#1D1E1F] border-b">
              {t("chat.output")}
            </h3>
            <div className="flex-1 px-4 p-6 overflow-y-auto relative">
              {showOutput && !loading && (
                <div className="absolute right-1 top-2 flex items-center z-10">
                  <div
                    className="px-2 rounded flex-center gap-1 text-sm text-[#1D1E1F] cursor-pointer"
                    onClick={() => copyToClip(resultStr)}
                  >
                    <CopyOutlined />
                    {t("action.copy")}
                  </div>
                  <div
                    className="px-2 rounded flex-center gap-1 text-sm text-[#1D1E1F] cursor-pointer"
                    onClick={debounce(handleDownload, 300)}
                  >
                    <DownloadOutlined />
                    {t("action.download")}
                  </div>
                </div>
              )}

              {!showOutput ? (
                <Empty
                  image={getPublicPath("/images/chat/completion_empty.png")}
                  description={t("chat.completion_empty_desc")}
                />
              ) : (
                <div className="text-sm text-[#1D1E1F]">
                  {result.map((item) => (
                    <div key={item.id} className="mt-2">
                      {item.type === "markdown" && (
                        <BubbleAssistant
                          content={item.value}
                          streaming={loading}
                        />
                      )}
                      {item.type?.includes("image") && (
                        <div className="overflow-hidden flex flex-col gap-5">
                          {(Array.isArray(item.value)
                            ? item.value
                            : [item.value]
                          ).map((src: string, idx: number) => (
                            <img
                              key={idx}
                              src={src}
                              className="max-w-full h-auto object-contain rounded"
                              alt=""
                            />
                          ))}
                        </div>
                      )}
                      {item.type?.includes("video") && (
                        <div className="overflow-hidden flex flex-col gap-5">
                          {(Array.isArray(item.value)
                            ? item.value
                            : [item.value]
                          ).map((src: string, idx: number) => (
                            <video
                              key={idx}
                              src={getSrc(src, item.id)}
                              controls
                              className="max-w-full h-auto"
                            />
                          ))}
                        </div>
                      )}
                      {item.type?.includes("audio") && (
                        <div className="overflow-hidden flex flex-col gap-5">
                          {(Array.isArray(item.value)
                            ? item.value
                            : [item.value]
                          ).map((src: string, idx: number) => (
                            <audio
                              key={idx}
                              src={getSrc(src, item.id)}
                              controls
                              className="max-w-full"
                            />
                          ))}
                        </div>
                      )}
                      {item.type?.includes("text") && (
                        <div className="whitespace-pre-wrap break-all">
                          {(Array.isArray(item.value)
                            ? item.value
                            : [item.value]
                          ).map((text: string, idx: number) => (
                            <p key={idx}>{text}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Related Agents */}
            {!!(currentAgent?.settings_obj?.relate_agents?.length) &&
              showOutput &&
              !loading && (
                <div className="sticky top-[100%] pb-2">
                  <RelatedScene isWorkflow output={result} />
                </div>
              )}
          </div>
        </div>

        {/* Image Preview */}
        {imageVisible && (
          <Image.PreviewGroup
            preview={{
              visible: imageVisible,
              onVisibleChange: (vis) => setImageVisible(vis),
            }}
          >
            <Image src={imageFile} style={{ display: "none" }} />
          </Image.PreviewGroup>
        )}

        {/* Helper Panel */}
        {!!showHelper && (
          <div
            className={`border-l bg-white left-0 right-0 top-0 bottom-0 z-10 ${useCaseFixed ? "fixed" : "absolute"}`}
          >
            <div className="h-[70px] flex-center border-b relative">
              <h4 className="text-lg text-primary">{t("chat.usage_guide")}</h4>
              <div
                className="flex-center size-6 absolute right-2 top-1/2 -translate-y-1/2 rounded cursor-pointer hover:bg-[#ECEDEE]"
                onClick={handleToggleGuide}
              >
                <CloseOutlined />
              </div>
            </div>
            <ChatHelper agent={currentAgent} />
          </div>
        )}
      </div>
    );
  },
);

Completion.displayName = "Completion";

export default Completion;
