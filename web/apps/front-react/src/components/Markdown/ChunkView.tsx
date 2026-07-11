import { useState, useMemo, useRef, useCallback } from "react";
import { Tree } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { markdownPreview } from "./helper";
import VirtualList from "@/components/VirtualList";
import { t } from "@/locales";
import "./chunk-view.css";

interface ChunkItem {
  id: number;
  content: string;
}

interface OutlineNode {
  text: string;
  level: number;
  children: OutlineNode[];
  chunkIndex: number;
  id: string;
}

interface ChunkViewProps {
  className?: string;
  chunks?: ChunkItem[];
  content?: string;
  outlinePosition?: "absolute" | "relative";
  showDisplayMode?: boolean;
  showOutline?: boolean;
  mode?: "pdf" | "web";
}

const PREVIEW_MODE = {
  pdf: "pdf",
  web: "web",
} as const;

// 生成标题的唯一标识符，格式: chunkIndex-headingIndex
const generateHeadingId = (chunkIndex: number, headingIndex: number): string => {
  return `heading-${chunkIndex}-${headingIndex}`;
};

export default function ChunkView({
  className = "",
  chunks = [],
  content = "",
  outlinePosition = "relative",
  showDisplayMode = true,
  showOutline = true,
  mode,
}: ChunkViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const virtualListRef = useRef<any>(null);

  const [outlineVisible, setOutlineVisible] = useState(false);
  const [displayMode, setDisplayMode] = useState<"pdf" | "web">(
    mode || PREVIEW_MODE.web,
  );

  const finalChunks = useMemo(() => {
    if (content !== undefined && content !== null && content !== "") {
      return [{ id: -1, content }];
    }
    return chunks || [];
  }, [content, chunks]);

  const parseMarkdown = (): OutlineNode[] => {
    const tree: OutlineNode[] = [];
    const stack: OutlineNode[] = [];

    finalChunks.forEach((chunk, chunkIndex) => {
      if (typeof chunk.content !== "string") return;
      const lines = chunk.content.split("\n");
      let inCodeBlock = false;
      let headingIndex = 0; // 每个 chunk 内的标题序号

      for (const line of lines) {
        const codeBlockMatch = line.match(/^```(\w*)/);
        if (codeBlockMatch) {
          inCodeBlock = !inCodeBlock;
          continue;
        }

        if (inCodeBlock) continue;

        const match = line.match(/^(#{1,6})\s+(.+)$/);
        if (!match) continue;

        const level = match[1].length;
        const text = match[2].trim();

        // 生成唯一标识符用于跳转定位
        const id = generateHeadingId(chunkIndex, headingIndex++);

        const node: OutlineNode = {
          text,
          level,
          children: [],
          chunkIndex,
          id,
        };

        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
          stack.pop();
        }

        if (stack.length === 0) {
          tree.push(node);
        } else {
          stack[stack.length - 1].children.push(node);
        }

        stack.push(node);
      }
    });

    return tree;
  };

  const outline = useMemo(() => parseMarkdown(), [finalChunks]);

  const handleNodeClick = async (data: OutlineNode) => {
    // 通过 ID 直查 heading，不再用文本匹配
    const findHeading = (): Element | null => {
      return rootRef.current?.querySelector(`#${CSS.escape(data.id)}`) || null;
    };

    // 如果标题已渲染，直接滚动
    const heading = findHeading();
    if (heading) {
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    // 标题未渲染，使用 finder 函数在加载完成后自动定位
    await virtualListRef.current?.scrollToIndex(data.chunkIndex, "auto", findHeading);
  };

  const handleItemVisible = (
    index: number,
    item: ChunkItem,
    done: () => void,
  ) => {
    const node = rootRef.current?.querySelector(
      `.preview-${item.id}`,
    ) as HTMLDivElement;
    if (!node) return;

    const itemContent = String(item.content).replace(
      /(\n\s*<[^>]*>)/g,
      (match) => {
        return `${match.trim()}\n`;
      },
    );

    // markdownPreview is async due to loadLib, but the callback handles completion
    void markdownPreview(node, itemContent, {
      after() {
        // 渲染完成后，覆盖 vditor 生成的 heading ID，与 outline 的 ID 格式对齐
        const headings = node.querySelectorAll("h1, h2, h3, h4, h5, h6");
        let headingIndex = 0;
        headings.forEach((heading) => {
          heading.id = generateHeadingId(index, headingIndex++);
        });
        setTimeout(() => done(), 200);
      },
    });
  };

  const handleItemHidden = (index: number, item: unknown) => {
    // 空函数，与 Vue 版本一致
  };

  const handleToggleOutline = () => {
    setOutlineVisible(!outlineVisible);
  };

  return (
    <div
      ref={rootRef}
      className={`h-full w-full overflow-hidden relative flex ${className}`}
    >
      {/* Outline Toggle Button */}
      {!outlineVisible && showOutline && (
        <div
          className="flex-none w-9 h-15 px-3 rounded-r bg-[#EEEEF0] flex-center cursor-pointer text-sm text-[#4F5052] z-[9] absolute left-0 top-28 hover:shadow"
          onClick={handleToggleOutline}
        >
          {t("common.outline")}
        </div>
      )}

      {/* Outline Panel with Slide Transition */}
      {outlineVisible && (
        <div
          className={`flex-none w-[220px] bg-white h-full overflow-hidden flex flex-col border-r ${
            outlinePosition === "absolute"
              ? "absolute left-0 top-0 bottom-0 z-[5]"
              : "relative"
          }`}
        >
          <div className="flex-none h-14 px-5 border-b flex items-center justify-between">
            <h4 className="text-sm text-[#4F5052]">{t("common.outline")}</h4>
            <CloseOutlined
              className="cursor-pointer"
              onClick={handleToggleOutline}
            />
          </div>
          <div className="p-5 flex-1 overflow-y-auto">
            <Tree
              treeData={outline}
              defaultExpandAll
              fieldNames={{ title: "text", key: "id", children: "children" }}
              onSelect={(keys, info: any) => {
                if (info.node) {
                  handleNodeClick(info.node);
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Content Panel */}
      <div className="flex-1 flex flex-col overflow-hidden py-5">
        <VirtualList
          ref={virtualListRef}
          items={finalChunks}
          itemHeight={100}
          buffer={8}
          visibleDelay={150}
          sequential={false}
          className="flex-1 vditor-reset"
          wrapperClass={`p-16 bg-white mx-auto ${displayMode === PREVIEW_MODE.pdf ? "max-w-4xl" : ""}`}
          onItemVisible={handleItemVisible}
          onItemHidden={handleItemHidden}
          renderItem={(item: ChunkItem) => (
            <div className={`preview-${item.id}`} />
          )}
        />

        {/* Display Mode Toggle */}
        {showDisplayMode && (
          <div className="flex-none px-4 py-2 flex justify-end gap-1.5 bg-[#F5F5F5] border-t">
            <div className="flex items-center gap-1.5">
              <div
                className={`h-6 rounded flex-center gap-2 px-2.5 cursor-pointer ${
                  displayMode === PREVIEW_MODE.pdf
                    ? "text-[#2563EB] bg-[#E5EAF5] shadow"
                    : "text-[#4F5052]"
                }`}
                onClick={() => setDisplayMode(PREVIEW_MODE.pdf)}
              >
                <span className="text-sm">{t("library.document")}</span>
              </div>
              <div
                className={`h-6 rounded flex-center gap-2 px-2.5 cursor-pointer ${
                  displayMode === PREVIEW_MODE.web
                    ? "text-[#2563EB] bg-[#E5EAF5] shadow"
                    : "text-[#4F5052]"
                }`}
                onClick={() => setDisplayMode(PREVIEW_MODE.web)}
              >
                <span className="text-sm">Web</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
