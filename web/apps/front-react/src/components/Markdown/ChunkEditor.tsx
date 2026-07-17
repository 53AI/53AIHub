import {
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Spin } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import loadLib from "@/utils/loadLib";
import { API_HOST } from "@/api/host";
import { t } from "@/locales";

interface EditConfig {
  name: string;
  value: string;
  type: "ir" | "sv" | "wysiwyg";
  mode: "editor" | "both";
}

interface ChunkEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  height?: string;
}

export interface ChunkEditorRef {
  setEditMode: (type: string, mode: string) => void;
  getValue: () => string;
}

const EDIT_MODES: EditConfig[] = [
  {
    name: t("common.rendering"),
    value: "edit-one",
    type: "ir",
    mode: "editor",
  },
  {
    name: t("common.source"),
    value: "code",
    type: "sv",
    mode: "editor",
  },
];

const ChunkEditor = forwardRef<ChunkEditorRef, ChunkEditorProps>(
  ({ value = "", onChange, height = "500px" }, ref) => {
    const vditorRef = useRef<HTMLDivElement>(null);
    const vditor = useRef<any>(null);

    const [loading, setLoading] = useState(false);
    const [type, setType] = useState<"ir" | "sv" | "wysiwyg">("wysiwyg");
    const [mode, setMode] = useState("");

    const getUploadConfig = () => {
      return {
        url: `${API_HOST}/api/upload`,
        multiple: false,
        fieldName: "file",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token")}`,
        },
        filename(name: string) {
          return name.replace(/[:/\\?*|"<>]/g, "").replace(/\s/g, "_");
        },
        format(files: File[], response: string) {
          const result = JSON.parse(response);
          return JSON.stringify({
            msg: "",
            code: 0,
            data: {
              errFiles: [],
              succMap: {
                [`${files[0].name}`]: `${API_HOST}/api/preview/${result.data.preview_key}`,
              },
            },
          });
        },
      };
    };

    const setVditor = async () => {
      if (vditor.current) {
        vditor.current.destroy();
      }

      setLoading(true);

      try {
        await loadLib("vditor");

        // 声明 Vditor 构造函数类型
        const Vditor = (window as any).Vditor;

        const options: any = {
          height: height,
          cache: {
            enable: false,
          },
          cdn: window.$getPublicPath("/js/vditor"),
          toolbar: [
            "undo",
            "redo",
            "|",
            {
              name: "insert",
              toolbar: [
                "image",
                "upload",
                "table",
                "link",
                "video",
                "code",
                "inline-code",
                "line",
                "insert-before",
                "insert-after",
                "-",
                "echarts",
                "math",
                "mermaid",
                "mindmap",
                "mermaid-sequence",
                "mermaid-gantt",
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
            "edit-mode",
            "fullscreen",
          ],
          toolbarConfig: {
            hide: false,
            pin: true,
          },
          plain: true,
          after: () => {
            setLoading(false);
            if (vditor.current) {
              vditor.current.setValue(value || "");
            }
          },
          input: (val: string) => {
            onChange?.(val);
          },
          upload: getUploadConfig(),
          image: {
            accept: "image/*",
            ...getUploadConfig(),
          },
          video: {
            accept: "video/*",
            ...getUploadConfig(),
          },
          mode: type,
          preview: {
            mode: mode,
            actions: [],
            math: {
              engine: "MathJax",
              inlineDigit: true,
            },
          },
        };

        // 使用 requestAnimationFrame 优化 DOM 操作时机
        requestAnimationFrame(() => {
          if (vditorRef.current) {
            vditor.current = new Vditor(vditorRef.current, options);
          }
        });
      } catch (error) {
        console.error("Failed to initialize Vditor:", error);
        setLoading(false);
      }
    };

    const handleEditMode = (item: EditConfig) => {
      setType(item.type);
      setMode(item.mode);
      vditor.current?.setEditMode(item.type, item.mode);
    };

    // 监听外部传入的值变化
    useEffect(() => {
      if (vditor.current && value !== vditor.current.getValue()) {
        vditor.current.setValue(value);
      }
    }, [value]);

    useEffect(() => {
      setVditor();
      return () => {
        if (vditor.current) {
          vditor.current.destroy();
        }
      };
    }, []);

    useImperativeHandle(ref, () => ({
      setEditMode(editType: string, editMode: string) {
        if (vditor.current) {
          vditor.current?.setEditMode(editType, editMode);
        }
      },
      getValue() {
        return vditor.current?.getValue() || '';
      },
    }));

    return (
      <div className="flex flex-col" style={{ height }}>
        <Spin
          spinning={loading}
          classNames={{ root: "h-full", container: "h-full" }}
        >
          <div ref={vditorRef} className="w-full flex-1 vditor-custom" />
        </Spin>

        {false && (
          <div className="flex-none px-4 h-10 flex items-center justify-between gap-2 border-t">
            <div className="flex items-center gap-1.5">
              {EDIT_MODES.map((item) => (
                <div
                  key={item.value}
                  className={`w-[94px] h-6 flex items-center justify-center gap-1.5 cursor-pointer ${
                    item.type === type
                      ? "text-[#2563EB] bg-[#EEF3FE] shadow"
                      : "text-[#4F5052]"
                  }`}
                  onClick={() => handleEditMode(item)}
                >
                  <SvgIcon name={item.value} />
                  <span className="text-sm">{item.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  },
);

ChunkEditor.displayName = "ChunkEditor";

export default ChunkEditor;
