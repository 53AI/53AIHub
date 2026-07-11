import { Modal, Button, Empty, Input, Form, message } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import {
  useState,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import PromptInput from "./input";
import { t } from "@/locales";
// import api from '@/api'

interface PromptOptimizeRef {
  open: (prompt?: string) => void;
}

interface PromptOptimizeProps {
  onConfirm?: (text: string) => void;
}

const PromptOptimizeInner = forwardRef<PromptOptimizeRef, PromptOptimizeProps>(
  (props, ref) => {
    const { onConfirm } = props;

    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [result, setResult] = useState("");
    const [mode, setMode] = useState<"initial" | "suggestion" | "result">(
      "initial",
    );
    const [expect, setExpect] = useState("");
    const [unexpect, setUnexpect] = useState("");
    const resultRef = useRef<any>(null);
    const controllerRef = useRef<AbortController | null>(null);

    const open = useCallback((initialPrompt = "") => {
      setPrompt(initialPrompt);
      setResult("");
      setExpect("");
      setUnexpect("");
      setMode("initial");
      setVisible(true);
    }, []);

    const close = useCallback(() => {
      if (controllerRef.current) {
        controllerRef.current.abort();
      }
      setVisible(false);
    }, []);

    const optimize = useCallback(
      async (promptText: string) => {
        if (!promptText.trim()) {
          message.warning(t("form_input_placeholder") || "请先填写指令");
          return;
        }

        setLoading(true);
        controllerRef.current = new AbortController();
        setResult("");
        setMode("result");

        try {
          // await api.console.apps.prompt_optimise(
          //   {
          //     prompt: promptText.trim(),
          //     prompt_action: 'optimise',
          //     unexpect,
          //     expect,
          //   },
          //   {
          //     hideError: true,
          //     signal: controllerRef.current.signal,
          //     onDownloadProgress: (progressResult: any) => {
          //       const list = stream(progressResult)
          //       const data = formatNormal(list, { answerKey: 'answer', textKey: 'text' })
          //       const optimizedText = data.answer.replace(/```markdown/g, '').replace(/```/g, '')
          //       setResult(optimizedText)
          //       resultRef.current?.scrollToBottom?.()
          //     },
          //   }
          // )
        } catch (error) {
          console.error("Optimize error:", error);
        } finally {
          setLoading(false);
          controllerRef.current = null;
          setExpect("");
          setUnexpect("");
        }
      },
      [expect, unexpect],
    );

    const handleOptimize = useCallback(() => {
      optimize(prompt);
    }, [prompt, optimize]);

    const handleSuggest = useCallback(() => {
      optimize(result || prompt);
    }, [result, prompt, optimize]);

    const handleResultOptimize = useCallback(() => {
      const text = (result || prompt).trim();
      if (!text) {
        message.warning(t("form_input_placeholder") || "请先填写指令");
        return;
      }
      setMode("suggestion");
    }, [result, prompt]);

    const handleBack = useCallback(() => {
      setMode("initial");
    }, []);

    const handleUse = useCallback(() => {
      onConfirm?.(result);
      close();
    }, [result, onConfirm, close]);

    useImperativeHandle(ref, () => ({
      open,
    }));

    return (
      <Modal
        title={t("prompt.optimize_title") || "角色指令自动优化"}
        open={visible}
        onCancel={close}
        width={1100}
        styles={{ body: { padding: 0 } }}
        footer={
          <div className="flex items-center justify-between mt-5">
            <div>
              <Button loading={loading} type="default" onClick={handleOptimize}>
                <span className="flex items-center gap-1">
                  <svg-icon name="hglt" width="18px" />
                  {t("auto_optimize") || "自动优化"}
                </span>
              </Button>
              <Button
                loading={loading}
                type="default"
                className="ml-2"
                onClick={handleResultOptimize}
              >
                <span className="flex items-center gap-1">
                  <svg-icon name="hglt2" width="18px" />
                  {t("debug_optimize") || "根据调试结果优化"}
                </span>
              </Button>
            </div>
            {result && !loading ? (
              <div className="flex gap-2">
                <Button onClick={close}>{t("action_cancel") || "取消"}</Button>
                <Button type="primary" onClick={handleUse}>
                  {t("action_use") || "使用"}
                </Button>
              </div>
            ) : null}
          </div>
        }
        destroyOnHidden
      >
        <div className="h-[450px] flex border-b">
          {/* Left side - Current */}
          <div className="flex-1 px-7 py-5 flex flex-col overflow-hidden">
            <div className="flex-none text-sm text-dark">
              {t("current") || "当前："}
            </div>
            <div className="flex-1 border rounded bg-[#F9FAFB] mt-3 flex flex-col overflow-hidden">
              <div className="flex-none h-10 px-5 flex items-center text-sm text-[#182B5099] border-b">
                *
                {t("role_instruction_desc") ||
                  "用于对 AI 的回复做出一系列指令和约束"}
              </div>
              <div className="flex-1 overflow-y-auto">
                <PromptInput
                  value={prompt}
                  onChange={setPrompt}
                  wordWrap
                  showLine
                  style={{ height: "100%" }}
                />
              </div>
            </div>
          </div>

          {/* Right side - Result/Suggestion */}
          <div className="flex-1 px-7 py-5 border-l flex flex-col overflow-hidden">
            {mode === "suggestion" ? (
              <div>
                <div className="flex items-center gap-2">
                  <ArrowLeftOutlined
                    className="cursor-pointer"
                    onClick={handleBack}
                  />
                  <span className="text-sm text-dark">
                    {t("debug_result_optimize") || "根据调试结果优化："}
                  </span>
                </div>
                <Form layout="vertical" className="mt-4">
                  <Form.Item
                    label={t("unexpected") || "不符合预期的地方"}
                    required
                  >
                    <Input
                      value={unexpect}
                      onChange={(e) => setUnexpect(e.target.value)}
                      placeholder={
                        t("unexpected_placeholder") ||
                        "请输入智能体表现哪里不符合预期"
                      }
                    />
                  </Form.Item>
                  <Form.Item
                    label={t("expectation") || "您的预期是什么"}
                    required
                  >
                    <Input
                      value={expect}
                      onChange={(e) => setExpect(e.target.value)}
                      placeholder={
                        t("expectation_placeholder") ||
                        "说说您的预期，我来帮您优化"
                      }
                    />
                  </Form.Item>
                </Form>
                <Button
                  disabled={!(unexpect.trim() && expect.trim())}
                  type="primary"
                  onClick={handleSuggest}
                >
                  {t("start_optimize") || "开始优化"}
                </Button>
              </div>
            ) : mode === "result" ? (
              <>
                <div className="flex-none text-sm text-dark">
                  {t("optimized") || "优化后："}
                </div>
                <div className="flex-1 border rounded bg-[#F9FAFB] mt-3 flex flex-col overflow-hidden">
                  <div className="flex-none h-10 px-5 flex items-center text-sm text-[#182B5099] border-b">
                    *
                    {t("role_instruction_desc") ||
                      "用于对 AI 的回复做出一系列指令和约束"}
                  </div>
                  <div className="flex-1 overflow-hidden">
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
                    t("optimize_empty_desc") || "优化后的角色指令将会显示在这里"
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

PromptOptimizeInner.displayName = "PromptOptimize";

export const PromptOptimize = PromptOptimizeInner;

export default PromptOptimize;
