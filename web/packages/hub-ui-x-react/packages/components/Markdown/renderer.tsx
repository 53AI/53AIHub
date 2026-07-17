import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import MarkdownIt from "markdown-it";
import mk from "@vscode/markdown-it-katex";
// 按需加载 highlight.js - 只加载最常用语言
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import plaintext from "highlight.js/lib/languages/plaintext";
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
import { Typewriter } from "../../utils/typewriter";
import { markdownItFixPlugin } from "../../utils/markdown-fix";
import { fixTableColumns } from "./markdown-fix-table";
import Code from "./components/code";
import Mermaid from "./components/mermaid";
import Mindmap from "./components/mindmap";
import Echarts from "./components/echarts";
import Chart from "./components/chart";
import { copyToClip } from "../../utils/copy";

// 注册语言
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("python", python);
hljs.registerLanguage("plaintext", plaintext);

const md = new MarkdownIt({
  html: true,
  breaks: true,
  linkify: true,
  typographer: true,
})
  .use(mk, {
    throwOnError: false,
  })
  .use(markdownItFixPlugin, {
    heading: true,
    list: true,
    table: true,
    codeBlock: true,
    link: true,
    image: true,
  });

export interface MdRendererProps {
  content: string;
  streaming?: boolean;
  renderSource?: (sourceType: string, sourceNumber: string) => string;
  sourceEnabled?: boolean;
  sourceRegex?: RegExp | string;
  mermaidClickable?: boolean;
  viewerClass?: string;
  viewerStyle?: React.CSSProperties;
  className?: string;
  /** 图片点击是否可预览 */
  imagePreview?: boolean;
  /** 图片点击回调 */
  onImageClick?: (src: string, alt: string) => void;
  onSourceReferenceClick?: (data: any) => void;
  onMermaidClick?: (data: any) => void;
  onRendered?: () => void;
}

const tolerantSourceRegex =
  /\[\s*(?:source|引用|ref)\s*[:：]+\s*(\d+)\s*[-–—~]\s*(\d+)\s*\]/gi;
const legacySourceRegex = /\[Source[:_]([A-Za-z0-9]+)[_-]([A-Za-z0-9-]+)\]/g;

// 图片预览弹窗样式常量（避免每次渲染创建新对象）
const PREVIEW_OVERLAY_STYLE: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0, 0, 0, 0.8)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  cursor: "zoom-out",
};

const PREVIEW_IMAGE_STYLE: React.CSSProperties = {
  maxWidth: "90%",
  maxHeight: "90%",
  objectFit: "contain",
};

const PREVIEW_CLOSE_BTN_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 20,
  right: 20,
  width: 40,
  height: 40,
  borderRadius: "50%",
  backgroundColor: "rgba(255, 255, 255, 0.2)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  fontSize: 24,
  color: "#fff",
};

// tagMap 提取为常量（避免每次 renderTokens 都创建）
const TAG_MAP: Record<string, string> = {
  paragraph_open: "p",
  bullet_list_open: "ul",
  ordered_list_open: "ol",
  list_item_open: "li",
  image: "img",
  link_open: "a",
  code_inline: "code",
  strong_open: "strong",
  em_open: "em",
  del_open: "del",
  blockquote_open: "blockquote",
  table_open: "table",
  thead_open: "thead",
  tbody_open: "tbody",
  tr_open: "tr",
  th_open: "th",
  td_open: "td",
  hr: "hr",
  fence: "pre",
  hardbreak: "br",
  inline: "span",
  text: "span",
  math_block: "div",
};

// fixTableColumns 抽到 ./markdown-fix-table，可单测且无灾难性回溯。
// 原内联版本在分隔行 |---...---|---...---| 上会触发 (\s*[-:]+)* 的
// 灾难性回溯，让 chat 渲染 test.txt 类的内容时主线程死锁 15+ 秒。
// 见 markdown-fix-table.test.ts 的回归测试。

const buildSourceRegex = (sourceRegex?: RegExp | string) => {
  if (!sourceRegex) return tolerantSourceRegex;
  if (sourceRegex instanceof RegExp) {
    const flags = sourceRegex.flags.includes("g")
      ? sourceRegex.flags
      : `${sourceRegex.flags}g`;
    return new RegExp(sourceRegex.source, flags);
  }
  return new RegExp(sourceRegex, "g");
};

const renderSourceMarkup = (
  text: string,
  renderSource?: (sourceType: string, sourceNumber: string) => string,
  sourceRegex?: RegExp | string,
) => {
  const regex = buildSourceRegex(sourceRegex);

  const replaceWithMarkup = (input: string, matcher: RegExp) => {
    return input.replace(matcher, (...args) => {
      const matchGroups = args.slice(1, -2);
      const sourceType = String(matchGroups[0] ?? "").trim();
      const sourceNumberRaw = String(matchGroups[1] ?? "").trim();
      const sourceNumber = sourceNumberRaw.includes("-")
        ? sourceNumberRaw.split("-").pop() || sourceNumberRaw
        : sourceNumberRaw;
      const display = renderSource
        ? renderSource(sourceType, sourceNumberRaw)
        : sourceType;
      const content = display == null ? sourceType : String(display);

      return `<span class="source-reference" data-source-type="${sourceType}" data-source-number="${sourceNumberRaw}">${content}</span>`;
    });
  };

  // 先用 tolerantSourceRegex（或传入的 sourceRegex）替换
  let result = replaceWithMarkup(text, regex);
  // 再用 legacySourceRegex 替换（处理未被第一种正则匹配的格式，如 [Source:G-1])
  result = replaceWithMarkup(result, legacySourceRegex);
  return result;
};

const applySourceReferences = (
  content: string,
  renderSource?: (sourceType: string, sourceNumber: string) => string,
  sourceRegex?: RegExp | string,
) => {
  const fenceRegex = /```[\s\S]*?```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const chunks: string[] = [];

  while ((match = fenceRegex.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    chunks.push(renderSourceMarkup(before, renderSource, sourceRegex));
    chunks.push(match[0]);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    chunks.push(
      renderSourceMarkup(content.slice(lastIndex), renderSource, sourceRegex),
    );
  }

  return chunks.join("");
};

const normalizeSkillRunItem = (it: any) => {
  if (!it || typeof it !== "object")
    return { type: "script", title: "", bash: "", output: "" };
  if (it.type === "skill") {
    return {
      type: "skill",
      title: String(it.title ?? ""),
      status: it.status ?? "pending",
      skillName: it.skillName != null ? String(it.skillName) : undefined,
      intentData:
        it.intentData && typeof it.intentData === "object"
          ? it.intentData
          : undefined,
      messages: Array.isArray(it.messages) ? it.messages : undefined,
    };
  }
  const type =
    it.type === "search" || it.type === "web_search" ? "search" : "script";
  if (type === "search") {
    const rawSources = Array.isArray(it.sources) ? it.sources : [];
    return {
      type: "search",
      title: String(it.title ?? ""),
      icon: it.icon != null ? String(it.icon) : "",
      sourceCount:
        typeof it.sourceCount === "number" ? it.sourceCount : undefined,
      tags: Array.isArray(it.tags) ? it.tags : [],
      sources: rawSources.map((s: any) => ({
        icon: s.icon != null ? String(s.icon) : "",
        title: String(s.title ?? ""),
        url: s.url != null ? String(s.url) : "",
      })),
    };
  }
  return {
    type: "script",
    title: String(it.title ?? ""),
    bash: String(it.bash ?? ""),
    output: String(it.output ?? ""),
  };
};

const MdRenderer: React.FC<MdRendererProps> = ({
  content,
  streaming = false,
  className = "",
  renderSource,
  sourceEnabled = false,
  sourceRegex,
  viewerClass = "",
  viewerStyle,
  mermaidClickable = false,
  imagePreview = true,
  onImageClick,
  onSourceReferenceClick,
  onMermaidClick,
  onRendered,
}) => {
  const [displayContent, setDisplayContent] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [renderKey, setRenderKey] = useState(0);
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const typewriterRef = useRef<Typewriter | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const highlightCacheRef = useRef<Map<string, string>>(new Map());
  const displayContentRef = useRef("");

  // 图片点击处理
  const handleImageClick = useCallback(
    (src: string, alt: string) => {
      if (onImageClick) {
        onImageClick(src, alt);
      } else if (imagePreview) {
        setPreviewImage({ src, alt });
      }
    },
    [onImageClick, imagePreview],
  );

  // 关闭图片预览
  const closeImagePreview = useCallback(() => {
    setPreviewImage(null);
  }, []);

  // Simple hash for quick comparison
  const simpleHash = useCallback((str: string) => {
    let hash = 0;
    if (str.length === 0) return hash.toString();
    for (let i = 0; i < str.length; i += 1) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString();
  }, []);

  // Async code highlighting
  const highlightCodeAsync = useCallback(
    async (codeContent: string, language: string) => {
      const cacheKey = `${language || "auto"}:${codeContent}`;

      if (highlightCacheRef.current.has(cacheKey)) {
        return highlightCacheRef.current.get(cacheKey)!;
      }

      return new Promise<string>((resolve) => {
        const doHighlight = () => {
          try {
            let highlighted: string;
            if (language) {
              highlighted = hljs.highlight(codeContent, { language }).value;
            } else {
              highlighted = hljs.highlightAuto(codeContent).value;
            }

            // Cache result (limit cache size)
            if (highlightCacheRef.current.size > 100) {
              const firstKey = highlightCacheRef.current.keys().next().value;
              highlightCacheRef.current.delete(firstKey);
            }
            highlightCacheRef.current.set(cacheKey, highlighted);
            resolve(highlighted);
          } catch {
            const highlighted = hljs.highlightAuto(codeContent).value;
            highlightCacheRef.current.set(cacheKey, highlighted);
            resolve(highlighted);
          }
        };

        if (typeof requestIdleCallback !== "undefined") {
          requestIdleCallback(doHighlight, { timeout: 100 });
        } else {
          setTimeout(doHighlight, 0);
        }
      });
    },
    [],
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => setIsDarkMode(mediaQuery.matches);
    updateTheme();
    mediaQuery.addEventListener("change", updateTheme);
    return () => {
      mediaQuery.removeEventListener("change", updateTheme);
    };
  }, []);

  const lastContentRef = useRef("");

  useEffect(() => {
    if (streaming) {
      // 计算新增的内容（基于 lastContentRef，而不是 displayContentRef）
      const lastProcessed = lastContentRef.current;
      if (content.startsWith(lastProcessed)) {
        // 正常追加场景
        const diff = content.slice(lastProcessed.length);
        if (diff) {
          if (!typewriterRef.current) {
            typewriterRef.current = new Typewriter((str) => {
              displayContentRef.current += str;
              setDisplayContent((prev) => prev + str);
            });
          }
          lastContentRef.current = content;
          typewriterRef.current.add(diff);
          typewriterRef.current.start();
        }
      } else {
        // 内容被重置或不匹配，清空队列并直接替换
        typewriterRef.current?.stop();
        displayContentRef.current = content;
        lastContentRef.current = content;
        setDisplayContent(content);
      }
    } else {
      // 非流式输出，清理 typewriter 并直接设置
      typewriterRef.current?.stop();
      displayContentRef.current = content;
      lastContentRef.current = content;
      setDisplayContent(content);
    }
  }, [content, streaming]);

  // 组件卸载时清理资源
  useEffect(() => {
    return () => {
      // 清理 typewriter
      typewriterRef.current?.stop();
      typewriterRef.current = null;
      // 清理缓存
      highlightCacheRef.current.clear();
      // 清理 debounce timer
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      // 重置引用
      displayContentRef.current = "";
      lastContentRef.current = "";
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target || !target.classList.contains("source-reference")) return;
      onSourceReferenceClick?.({
        sourceType: target.dataset.sourceType,
        sourceNumber: target.dataset.sourceNumber,
        element: target,
      });
    };

    container.addEventListener("click", handleClick);

    return () => {
      container.removeEventListener("click", handleClick);
    };
  }, [onSourceReferenceClick]);

  const processedContent = useMemo(() => {
    // 流式输出时跳过表格修复（性能优化）
    if (streaming) {
      return displayContent;
    }
    return fixTableColumns(content);
  }, [content, displayContent, streaming]);

  // 解析 tokens
  const tokens = useMemo(() => {
    return md.parse(processedContent, {});
  }, [processedContent]);

  // 优化 onRendered 回调，流式输出时减少调用频率
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;

  useEffect(() => {
    if (streaming) {
      // 流式输出时，每 200ms 最多调用一次
      const timer = setTimeout(() => {
        onRenderedRef.current?.();
      }, 200);
      return () => clearTimeout(timer);
    }
    onRenderedRef.current?.();
  }, [processedContent, streaming]);

  const renderTokens = (
    tokenList: any[],
    keyPrefix = "",
  ): React.ReactNode[] => {
    const result: React.ReactNode[] = [];
    const stack: { token: any; children: React.ReactNode[] }[] = [];

    for (let i = 0; i < tokenList.length; i += 1) {
      const token = tokenList[i];
      if (!token) continue;

      if (token.type === "link_open") {
        const linkTokens: any[] = [];
        let j = i;
        while (j < tokenList.length) {
          if (tokenList[j].type === "link_open") {
            if (!tokenList[j].attrs) {
              tokenList[j].attrs = [];
            }
            tokenList[j].attrs.push(["target", "_blank"]);
          }
          linkTokens.push(tokenList[j]);
          if (tokenList[j].type === "link_close") break;
          j += 1;
        }
        const html = md.renderer.render(linkTokens, md.options, {});
        const vnode = (
          <span
            key={`${keyPrefix}-link-${i}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
        if (stack.length) {
          stack[stack.length - 1].children.push(vnode);
        } else {
          result.push(vnode);
        }
        i = j;
        continue;
      }

      if (token.type === "fence") {
        const language = token.info || "";
        if (language === "mermaid") {
          const vnode = (
            <Mermaid
              key={`${keyPrefix}-mermaid-${i}`}
              value={token.content}
              clickable={mermaidClickable}
              onNodeClick={onMermaidClick}
              viewerClass={viewerClass}
              viewerStyle={viewerStyle}
            />
          );
          if (stack.length) {
            stack[stack.length - 1].children.push(vnode);
          } else {
            result.push(vnode);
          }
        } else if (language === "mindmap") {
          const vnode = (
            <Mindmap
              key={`${keyPrefix}-mindmap-${i}`}
              value={token.content}
              clickable={mermaidClickable}
              viewerClass={viewerClass}
              viewerStyle={viewerStyle}
              onNodeClick={onMermaidClick}
            />
          );
          if (stack.length) {
            stack[stack.length - 1].children.push(vnode);
          } else {
            result.push(vnode);
          }
        } else if (language === "echarts") {
          const vnode = (
            <Echarts key={`${keyPrefix}-echarts-${i}`} value={token.content} />
          );
          if (stack.length) {
            stack[stack.length - 1].children.push(vnode);
          } else {
            result.push(vnode);
          }
        } else if (language === "chart") {
          const vnode = (
            <Chart key={`${keyPrefix}-chart-${i}`} value={token.content} />
          );
          if (stack.length) {
            stack[stack.length - 1].children.push(vnode);
          } else {
            result.push(vnode);
          }
        } else {
          const cacheKey = `${language || "auto"}:${token.content}`;
          let value = "";

          // Check cache first
          if (highlightCacheRef.current.has(cacheKey)) {
            value = highlightCacheRef.current.get(cacheKey)!;
          } else if (token.content.length < 1000) {
            // Small code blocks: sync highlight
            try {
              if (language) {
                if (!hljs.getLanguage(language)) {
                  value = hljs.highlightAuto(token.content).value;
                } else {
                  value = hljs.highlight(token.content, { language }).value;
                }
              } else {
                value = hljs.highlightAuto(token.content).value;
              }
              // Cache result
              if (highlightCacheRef.current.size > 100) {
                const firstKey = highlightCacheRef.current.keys().next().value;
                highlightCacheRef.current.delete(firstKey);
              }
              highlightCacheRef.current.set(cacheKey, value);
            } catch {
              value = hljs.highlightAuto(token.content).value;
              highlightCacheRef.current.set(cacheKey, value);
            }
          } else {
            // Large code blocks: async highlight
            value = hljs.highlightAuto(token.content).value;
            highlightCodeAsync(token.content, language)
              .then((highlighted) => {
                highlightCacheRef.current.set(cacheKey, highlighted);
                setRenderKey((k) => k + 1);
              })
              .catch(() => {});
          }

          const vnode = (
            <Code
              key={`${keyPrefix}-code-${i}`}
              value={token.content}
              html={value}
              language={language}
              onCopy={(val) => {
                copyToClip(val);
              }}
            />
          );

          if (stack.length) {
            stack[stack.length - 1].children.push(vnode);
          } else {
            result.push(vnode);
          }
        }
        continue;
      }

      if (
        token.type === "math_block" ||
        token.type === "math_inline" ||
        token.type === "html_inline"
      ) {
        const html = md.renderer.render([token], md.options, {});
        const vnode = (
          <span
            key={`${keyPrefix}-${token.type}-${i}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
        if (stack.length) {
          stack[stack.length - 1].children.push(vnode);
        } else {
          result.push(vnode);
        }
        continue;
      }

      if (/_open$/.test(token.type)) {
        stack.push({ token, children: [] });
        continue;
      }

      if (/_close$/.test(token.type)) {
        const { token: openToken, children } = stack.length
          ? stack.pop()!
          : { token: null, children: [] };
        let tag = openToken?.tag || TAG_MAP[openToken?.type] || "div";
        if (openToken?.type === "heading_open" && openToken.tag) {
          tag = openToken.tag;
        }

        const attrs: Record<string, any> = {};
        if (openToken?.attrs) {
          openToken.attrs.forEach(([k, v]: [string, string]) => {
            // 将字符串 style 转换为对象（React 要求）
            if (k === "style" && typeof v === "string") {
              const styleObj: Record<string, string> = {};
              v.split(";").forEach((pair) => {
                const [key, value] = pair.split(":").map((s) => s.trim());
                if (key && value) {
                  // 转换 kebab-case 到 camelCase
                  const camelKey = key.replace(/-([a-z])/g, (_, c) =>
                    c.toUpperCase(),
                  );
                  styleObj[camelKey] = value;
                }
              });
              attrs[k] = styleObj;
            } else {
              attrs[k] = v;
            }
          });
        }

        const vnode = React.createElement(
          tag,
          { key: `${keyPrefix}-${i}`, ...attrs },
          children,
        );
        if (stack.length) {
          stack[stack.length - 1].children.push(vnode);
        } else {
          result.push(vnode);
        }
        continue;
      }

      if (token.type === "inline") {
        const children = renderTokens(
          token.children || [],
          `${keyPrefix}-inline-${i}`,
        );
        if (stack.length) {
          stack[stack.length - 1].children.push(...children);
        } else {
          result.push(...children);
        }
        continue;
      }

      if (token.type === "text") {
        if (sourceEnabled) {
          const processedHtml = applySourceReferences(
            token.content,
            renderSource,
            sourceRegex,
          );
          const vnode = (
            <span
              key={`${keyPrefix}-text-${i}`}
              dangerouslySetInnerHTML={{ __html: processedHtml }}
            />
          );
          if (stack.length) {
            stack[stack.length - 1].children.push(vnode);
          } else {
            result.push(vnode);
          }
        } else {
          const vnode = token.content;
          if (stack.length) {
            stack[stack.length - 1].children.push(vnode);
          } else {
            result.push(vnode);
          }
        }
        continue;
      }

      const tag = token.tag || TAG_MAP[token.type] || "span";
      const attrs: Record<string, any> = {};
      if (token.attrs) {
        token.attrs.forEach(([k, v]: [string, string]) => {
          // 将字符串 style 转换为对象（React 要求）
          if (k === "style" && typeof v === "string") {
            const styleObj: Record<string, string> = {};
            v.split(";").forEach((pair) => {
              const [key, value] = pair.split(":").map((s) => s.trim());
              if (key && value) {
                // 转换 kebab-case 到 camelCase
                const camelKey = key.replace(/-([a-z])/g, (_, c) =>
                  c.toUpperCase(),
                );
                styleObj[camelKey] = value;
              }
            });
            attrs[k] = styleObj;
          } else {
            attrs[k] = v;
          }
        });
      }

      const voidTags = new Set(["br", "hr", "img", "input", "meta", "link"]);
      const children = voidTags.has(tag) ? null : token.content || [];

      // 图片添加预览点击事件
      let imgOnClick: (() => void) | undefined;
      if (tag === "img" && imagePreview) {
        const src = attrs.src || "";
        const alt = attrs.alt || "";
        imgOnClick = () => handleImageClick(src, alt);
        attrs.style = {
          ...(typeof attrs.style === "object" ? attrs.style : {}),
          cursor: "pointer",
        };
        attrs.onClick = imgOnClick;
      }

      const vnode = React.createElement(
        tag,
        { key: `${keyPrefix}-${i}`, ...attrs },
        children,
      );

      if (stack.length) {
        stack[stack.length - 1].children.push(vnode);
      } else {
        result.push(vnode);
      }
    }

    return result;
  };

  // 把 renderTokens 的输出用 useMemo 缓存。tokens 不变（或影响渲染的 props 不变）
  // 时直接复用上一次结果，避免每次 MdRenderer 渲染都重新构造 ~260 个 vnode，
  // 对结构化 markdown 表格是主要的性能瓶颈。
  const renderedNodes = useMemo(
    () => renderTokens(tokens),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      tokens,
      sourceEnabled,
      sourceRegex,
      renderSource,
      mermaidClickable,
      viewerClass,
      viewerStyle,
      imagePreview,
      onImageClick,
      onMermaidClick,
    ],
  );

  const mergedClassName = useMemo(() => {
    const base = ["markdown-body", className, viewerClass];
    if (isDarkMode) base.push("dark-mode");
    return base.filter(Boolean).join(" ");
  }, [className, viewerClass, isDarkMode]);

  return (
    <>
      <div
        ref={containerRef}
        className={mergedClassName}
        style={viewerStyle}
        key={renderKey}
      >
        {renderedNodes}
      </div>

      {/* 图片预览弹窗 */}
      {previewImage && (
        <div
          className="markdown-image-preview"
          onClick={closeImagePreview}
          style={PREVIEW_OVERLAY_STYLE}
        >
          <img
            src={previewImage.src}
            alt={previewImage.alt}
            style={PREVIEW_IMAGE_STYLE}
            onClick={(e) => e.stopPropagation()}
          />
          {/* 关闭按钮 */}
          <div onClick={closeImagePreview} style={PREVIEW_CLOSE_BTN_STYLE}>
            ×
          </div>
        </div>
      )}
    </>
  );
};

MdRenderer.displayName = "XMdRenderer";

export default MdRenderer;
