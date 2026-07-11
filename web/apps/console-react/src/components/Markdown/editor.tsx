import {
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from "react";
import { Spin } from "antd";
import loadLib from "@/utils/loadLib";
import { lib_host, api_host } from "@/utils/config";

export interface MarkdownEditorProps {
  className?: string;
  value?: string;
  height?: string;
  maxlength?: number;
  showWordLimit?: boolean;
  preview?: boolean;
  bgColor?: string;
  type?: "full" | "simple";
  onChange?: (value: string) => void;
}

export interface MarkdownEditorRef {
  getValue: () => string;
  setValue: (value: string) => void;
  focus: () => void;
  destroy: () => void;
}

const getUploadConfig = () => {
  const accessToken = localStorage.getItem("access_token") || "";
  return {
    url: `${api_host}/api/upload`,
    multiple: false,
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    max: 15 * 1024 * 1024,
    fieldName: "file",
    filename: (name: string) => name,
    format: (files: File[], response: string) => {
      const result = JSON.parse(response);
      const data = result.data || {};
      return JSON.stringify({
        msg: "",
        code: 0,
        data: {
          errFiles: [],
          succMap: {
            [`${files[0].name}`]: `${api_host}/api/preview/${data.preview_key || ""}`,
          },
        },
      });
    },
  };
};

// 保存 onChange 回调的 ref，避免作为 useEffect 依赖
function useStableCallback<T extends (...args: any[]) => any>(
  callback?: T,
): React.MutableRefObject<T | undefined> {
  const callbackRef = useRef<T | undefined>(callback);
  callbackRef.current = callback;
  return callbackRef;
}

const getToolbar = (type: "full" | "simple") => {
  if (type === "full") {
    return [
      "undo",
      "redo",
      "|",
      {
        name: "insert",
        toolbar: [
          "image",
          "link",
          "code",
          "inline-code",
          "line",
          "insert-before",
          "insert-after",
        ],
      },
      "|",
      "headings",
      "bold",
      "italic",
      "strike",
      "|",
      "list",
      "ordered-list",
      "outdent",
      "indent",
      "|",
      "quote",
      "|",
      "copy",
      "edit-mode",
      "fullscreen",
    ];
  }
  return [
    {
      name: "insert",
      toolbar: [
        "image",
        "link",
        "code",
        "inline-code",
        "line",
        "insert-before",
        "insert-after",
      ],
    },
    "|",
    "headings",
    "bold",
    "italic",
    "strike",
    "|",
    "list",
    "ordered-list",
    "quote",
    "|",
    "copy",
    "fullscreen",
  ];
};

export const MarkdownEditor = forwardRef<
  MarkdownEditorRef,
  MarkdownEditorProps
>(
  (
    {
      className = "",
      value = "",
      height = "300px",
      maxlength,
      showWordLimit = false,
      preview = false,
      bgColor = "#fff",
      type = "full",
      onChange,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState(false);
    const vditorRef = useRef<any>(null);
    const [wordCount, setWordCount] = useState(0);
    // 使用 ref 保存 onChange，避免作为 useEffect 依赖
    const onChangeRef = useStableCallback(onChange);
    // 保存初始 value，避免 value 变化导致重新初始化
    const initialValueRef = useRef(value);

    const initVditor = useCallback(async () => {
      if (vditorRef.current) {
        try {
          vditorRef.current.destroy();
        } catch (e) {
          console.warn("Vditor destroy error:", e);
        }
        vditorRef.current = null;
      }

      setLoading(true);

      try {
        await loadLib("vditor");

        if (!containerRef.current) return;

        const uploadConfig = getUploadConfig();

        const vditorInstance = new window.Vditor(containerRef.current, {
          height,
          value: initialValueRef.current,
          mode: "wysiwyg",
          theme: "classic",
          cache: {
            enable: false,
          },
          cdn: `${lib_host}/js/vditor`,
          toolbar: getToolbar(type),
          toolbarConfig: {
            hide: preview,
          },
          upload: uploadConfig,
          image: {
            accept: "image/*",
            ...uploadConfig,
          },
          video: {
            accept: "video/*",
            ...uploadConfig,
          },
          counter: {
            enable: !!maxlength,
            max: maxlength,
          },
          preview: {
            markdown: {
              toc: true,
              mark: true,
              footnotes: true,
              autoSpace: true,
            },
            math: {
              engine: "MathJax",
              inlineDigit: true,
            },
            actions: [],
          },
          after: () => {
            vditorRef.current?.setValue(initialValueRef.current);
          },
          input: (val: string) => {
            setWordCount(val.length);
            onChangeRef.current?.(val);
          },
          blur: (val: string) => {
            onChangeRef.current?.(val);
          },
        });

        vditorRef.current = vditorInstance;
      } catch (error) {
        console.error("Failed to load Vditor:", error);
      } finally {
        setLoading(false);
      }
    }, [height, type, preview, maxlength]); // 移除 value, onChange 依赖

    useEffect(() => {
      initVditor();

      return () => {
        if (vditorRef.current) {
          try {
            vditorRef.current.destroy();
          } catch (e) {
            console.warn("Vditor destroy error:", e);
          }
          vditorRef.current = null;
        }
      };
    }, [initVditor]);

    // Update value from props
    useEffect(() => {
      if (vditorRef.current && value !== vditorRef.current.getValue()) {
        vditorRef.current.setValue(value);
      }
    }, [value]);

    // Expose methods
    useImperativeHandle(ref, () => ({
      getValue: () => vditorRef.current?.getValue() || "",
      setValue: (val: string) => vditorRef.current?.setValue(val),
      focus: () => vditorRef.current?.focus(),
      destroy: () => {
        if (vditorRef.current) {
          try {
            vditorRef.current.destroy();
          } catch (e) {
            console.warn("Vditor destroy error:", e);
          }
          vditorRef.current = null;
        }
      },
    }));

    return (
      <div className={`relative ${className}`}>
        <Spin
          spinning={loading}
          classNames={{
            root: "w-full h-full",
            container: "w-full h-full",
          }}
        >
          <div
            ref={containerRef}
            className={`w-full vditor-custom ${preview ? "vditor-preview !border-none !bg-transparent" : ""}`}
            style={{
              height,
              backgroundColor: preview ? "transparent" : bgColor,
              "--panel-background-color": bgColor,
            }}
          />
        </Spin>
        {showWordLimit && (
          <div className="text-right text-xs text-gray-500 mt-1">
            {wordCount} {maxlength ? `/ ${maxlength}` : "字符"}
          </div>
        )}
        <style>{`
          .vditor-custom .vditor-toolbar {
            padding-left: 0 !important;
          }
          .vditor-custom .vditor-reset {
            padding: 10px 30px !important;
          }
          .vditor-custom .vditor-toolbar--hide {
            display: none;
          }
          .vditor-preview .vditor-reset {
            padding: 0 !important;
            overflow: hidden;
            text-overflow: ellipsis;
            display: -webkit-box;
            -webkit-box-orient: vertical;
          }
        `}</style>
      </div>
    );
  },
);

MarkdownEditor.displayName = "MarkdownEditor";

export default MarkdownEditor;
