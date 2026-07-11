import { Modal, Button, Empty, message } from "antd";
import { ThunderboltOutlined } from "@ant-design/icons";
import {
    useState,
    useRef,
    useCallback,
    forwardRef,
    useImperativeHandle,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import Paragraph from "@tiptap/extension-paragraph";
import History from "@tiptap/extension-history";
import Placeholder from "@tiptap/extension-placeholder";
import PromptInput from "./input";
import LinkNode from "./test";
import { t } from "@/locales";
// import api from '@/api'

interface PromptGenerateRef {
  open: () => void;
}

interface PromptGenerateProps {
  onConfirm?: (text: string) => void;
  onGenerate?: (prompt: string) => Promise<string>;
}

const menuList = [
  {
    type: "custom",
    icon: "magic-stick",
    title: t("custom") || "自定义",
    content: "",
  },
  {
    type: "server",
    icon: "service",
    title: t("smart_service") || "智能客服",
    content:
      '<p>创建一个<link value="房地产" defaultValue="房地产"></link>行业的<link value="售后客服" defaultValue="售后客服"></link></p>',
  },
  {
    type: "expert",
    icon: "people-safe",
    title: t("expert_advisor") || "专家顾问",
    content:
      '<p>创建一个拥有十年经验的<link value="人力资源" defaultValue="人力资源"></link>行业的<link value="专家顾问" defaultValue="专家顾问"></link></p>',
  },
  {
    type: "creator",
    icon: "edit",
    title: t("content_creation") || "内容创作",
    content:
      '<p>创建一个<link value="小红书文案" defaultValue="小红书文案" type="creator"></link>的<link value="编写" defaultValue="编写"></link>专家，目的是<link value="提炼产品卖点，提高市场营销效果" defaultValue="提炼产品卖点，提高市场营销效果"></link></p>',
  },
];

function jsonToString(jsonArray: any[]): string {
  return jsonArray
    .map((item) => {
      if (item.type === "paragraph") {
        if (!item.content) return "";
        return item.content
          .map((contentItem: any) => {
            if (contentItem.type === "text") return contentItem.text;
            if (contentItem.type === "link")
              return (
                contentItem.attrs?.value || contentItem.attrs?.defaultValue
              );
            return "";
          })
          .join("");
      }
      return "";
    })
    .join("\n");
}

const PromptGenerateInner = forwardRef<PromptGenerateRef, PromptGenerateProps>(
  (props, ref) => {
    const { onConfirm, onGenerate } = props;

    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState("");
    const [selectedType, setSelectedType] = useState("custom");
    const [promptText, setPromptText] = useState("");
    const resultRef = useRef<any>(null);
    const controllerRef = useRef<AbortController | null>(null);

    const editor = useEditor({
      extensions: [
        Document,
        Text,
        Paragraph,
        History,
        LinkNode,
        Placeholder.configure({
          placeholder:
            t("generate_placeholder") ||
            "创建一个广告文案的编写专家，目的是提炼产品价值，创造营销效果",
        }),
      ],
      content: "",
      editable: true,
      onUpdate: ({ editor }) => {
        const json = editor.getJSON();
        setPromptText(jsonToString(json.content as any[]));
      },
    });

    const open = useCallback(() => {
      setVisible(true);
      setResult("");
      setPromptText("");
      setSelectedType("custom");
      setTimeout(() => {
        editor?.commands.setContent("");
      }, 0);
    }, [editor]);

    const close = useCallback(() => {
      if (controllerRef.current) {
        controllerRef.current.abort();
      }
      setVisible(false);
    }, []);

    const handleGenerate = useCallback(async () => {
      const prompt = promptText.trim();
      if (!prompt) {
        message.warning(t("form_input_placeholder") || "请先填写指令");
        return;
      }

      setLoading(true);
      setResult("");
      controllerRef.current = new AbortController();

      try {
        // 如果父组件提供了 onGenerate，使用它
        if (onGenerate) {
          const generatedText = await onGenerate(prompt);
          setResult(
            generatedText.replace(/```markdown/g, "").replace(/```/g, ""),
          );
        } else {
          // 否则使用内置 API 调用（与 Vue 版本一致）
          // await api.console.apps.prompt_optimise(
          //   {
          //     prompt,
          //     prompt_action: 'generate',
          //   },
          //   {
          //     hideError: true,
          //     signal: controllerRef.current.signal,
          //     onDownloadProgress: (progressResult: any) => {
          //       const list = stream(progressResult)
          //       const data = formatNormal(list, { answerKey: 'answer', textKey: 'text' })
          //       const generatedText = data.answer.replace(/```markdown/g, '').replace(/```/g, '')
          //       setResult(generatedText)
          //       resultRef.current?.scrollToBottom?.()
          //     },
          //   }
          // )
        }
      } catch (error) {
        console.error("Generate error:", error);
        message.error(t("generate_failed") || "生成失败");
      } finally {
        setLoading(false);
        controllerRef.current = null;
      }
    }, [promptText, onGenerate]);

    const handleUse = useCallback(() => {
      onConfirm?.(result);
      close();
    }, [result, onConfirm, close]);

    const handleExample = useCallback(
      (item: (typeof menuList)[0]) => {
        setSelectedType(item.type);
        editor?.commands.setContent(item.content);
      },
      [editor],
    );

    useImperativeHandle(ref, () => ({
      open,
    }));

    return (
      <Modal
        title={t("generate_title") || "角色指令自动生成"}
        open={visible}
        onCancel={close}
        width={1100}
        styles={{ body: { padding: 0 } }}
        footer={
          result && !loading ? (
            <div className="flex justify-end gap-2">
              <Button onClick={close}>{t("action_cancel") || "取消"}</Button>
              <Button type="primary" onClick={handleUse}>
                {t("action_use") || "使用"}
              </Button>
            </div>
          ) : null
        }
        destroyOnHidden
      >
        <div className="h-[450px] flex">
          {/* Left side - Input */}
          <div className="flex-1 px-7 py-5">
            <div className="flex-none text-sm text-dark">
              {t("reference_example") || "参考示例"}
            </div>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {menuList.map((item) => (
                <div
                  key={item.type}
                  className={`h-8 rounded px-3 flex items-center gap-1 cursor-pointer border ${
                    selectedType === item.type
                      ? "border-[#2563EB] text-brand bg-[#F4F7FD]"
                      : "border-[#F3F3F4] text-dark bg-[#F3F3F4]"
                  }`}
                  onClick={() => handleExample(item)}
                >
                  <svg-icon name={item.icon} width="18px" />
                  {item.title}
                </div>
              ))}
            </div>
            <div className="h-[162px] overflow-y-auto rounded border border-[#EBEEF5] mt-3">
              <EditorContent editor={editor} className="h-full" />
            </div>
            <Button
              disabled={!promptText.trim()}
              loading={loading}
              className="mt-5"
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={handleGenerate}
            >
              {t("smart_generate") || "智能生成"}
            </Button>
          </div>

          {/* Right side - Result */}
          <div className="flex-1 px-7 py-5 border-l flex flex-col overflow-hidden">
            {result || loading ? (
              <>
                <div className="flex-none text-sm text-dark">
                  {t("generated_prompt") || "生成的角色指令"}
                </div>
                <div className="flex-1 border rounded bg-[#F9FAFB] mt-3 flex flex-col overflow-hidden">
                  <div className="flex-none h-10 px-5 flex items-center text-sm text-[#182B5099] border-b">
                    *
                    {t("role_instruction_desc") ||
                      "用于对 AI 的回复做出一系列指令和约束"}
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    <PromptInput
                      ref={resultRef}
                      value={result}
                      onChange={setResult}
                      wordWrap
                      disabled={loading}
                      placeholder={
                        loading
                          ? t("generating") || "生成中..."
                          : t("form_input_placeholder") || "请输入"
                      }
                      showLine
                      style={{ height: "100%" }}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center">
                <Empty
                  image="/images/prompt-empty.png"
                  description={
                    t("generate_empty_desc") || "生成后的角色指令将会显示在这里"
                  }
                />
              </div>
            )}
          </div>
        </div>
      </Modal>
    );
  },
);

PromptGenerateInner.displayName = "PromptGenerate";

export const PromptGenerate = PromptGenerateInner;

export default PromptGenerate;
