import React, {
    useState,
    useRef,
    useCallback,
    useEffect,
    useMemo,
    forwardRef,
    useImperativeHandle
} from "react";
import { Button, Tooltip, message } from "antd";
import {
    CloseOutlined,
    FileOutlined,
    ArrowRightOutlined,
    MoreOutlined,
    LoadingOutlined,
    PaperClipOutlined,
} from "@ant-design/icons";
import { SvgIcon, Search } from "@km/shared-components-react";
import { filesApi } from "@/api";
import { formatFile } from "@/api/modules/files/transform";
import { skillApi } from "@/api/modules/skill";
import { SkillMyItem } from "@/api/modules/skill/types";
import {
    FileSelectDialog,
    FileSelectDialogRef,
} from "@/components/Space/FileSelectDialog";
import type { FileItem } from "@/api/modules/files/types";
import type { LibraryItem } from "@/api/modules/libraries/types";
import "./Sender.scss";

// ============ 自定义 Hook: useDebounce ============

function useDebounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      fnRef.current(...args);
    }, delay);
  }, [delay]);
}

// ============ 类型定义 ============

interface LinkItem {
  id: string | number;
  name: string;
  icon: string;
  library_id?: string | number;
  isfolder?: boolean;
  file_size?: number;
  file_mime?: string;
}

interface UploadFile {
  raw: File;
  id?: string;
  name: string;
  size: number;
  mime_type: string;
  status: "uploading" | "done" | "error";
  preview_key?: string;
  url?: string;
}

interface SkillItem {
  label: string;
  img: string;
}

interface SenderProps {
  value?: object;
  library?: LibraryItem;
  disabledAt?: boolean;
  showAt?: boolean;
  showSkill?: boolean;
  disabled?: boolean;
  loading?: boolean;
  maxAt?: number;
  createLinkInEditor?: boolean;
  isMobile?: boolean;
  atCode?: string;
  atToolTip?: string;
  skillCode?: string;
  skillToolTip?: string;
  showCaret?: boolean;
  atPlaceholder?: string;
  placeholder?: string;
  canBlur?: boolean;
  placeholderStyle?: React.CSSProperties;
  atPlaceholderStyle?: string;
  device?: object;
  simpleMode?: boolean;
  needFixPositionWhenFocus?: boolean;
  customActionsClass?: string;
  enhancedMention?: boolean;
  selectedSkills?: string[];
  enableUpload?: boolean;
  acceptTypes?: string;
  allowMultiple?: boolean;
  enableDragUpload?: boolean;
  httpRequest?: (file: File) => Promise<any>;
  allowSendWithFiles?: boolean;
  actionPosition?: "actions" | "extras";
  onInput?: (data: any) => void;
  onPost?: () => void;
  onMFocus?: () => void;
  onMBlur?: () => void;
  onQuery?: (query: string) => void;
  onAfterCalloutMentionInput?: () => void;
  onStop?: () => void;
  onSend?: (data: {
    textContent: string;
    atList: LinkItem[];
    files: UploadFile[];
    skillList?: string[];
  }) => void;
  onSelectSkill?: (skill: SkillItem) => void;
  onRemoveSkill?: () => void;
  onUploadAttachment?: () => void;
  onFileChange?: (files: UploadFile[]) => void;
  onOpenSkillLibrary?: () => void;
  renderHeader?: () => React.ReactNode;
  renderExtras?: () => React.ReactNode;
  renderActions?: () => React.ReactNode;
}

export interface SenderRef {
  insertText: (text: string) => void;
  post: () => void;
  forceFocus: (moveEnd?: boolean) => void;
  clear: () => void;
  clearLinks: () => void;
  clearEditorOnly: () => void;
  insertSkill: (skill: SkillItem) => void;
  clearSkillTags: () => void;
  clearUploadFiles: () => void;
}

// ============ 工具函数 ============

function moveCursorToElementEnd(el: Node | null) {
  if (!el) return;
  const sel = document.getSelection();
  const range = document.createRange();
  if (
    (el.childNodes && el.childNodes.length > 0) ||
    el.nodeType === Node.TEXT_NODE
  ) {
    range.selectNodeContents(el);
    range.collapse(false);
  } else {
    range.setStart(el, 0);
    range.setEnd(el, 0);
  }
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function moveCursorTo(el: Node, offset: number) {
  const sel = document.getSelection();
  const range = document.createRange();
  range.setStart(el, offset);
  range.setEnd(el, offset);
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function hasClassName(el: Node | null, cls: string): boolean {
  return !!(el as Element)?.classList?.contains(cls);
}

function findParent(el: Node | null, check: (n: Node) => boolean): Node | null {
  if (!el) return null;
  return check(el) ? el : findParent(el.parentNode, check);
}

function findParentInEditorHasClass(el: Node | null, cls: string) {
  return findParent(el, (n) => hasClassName(n, cls));
}

function createSpace(n = 1) {
  const text = new Array(n + 1).join(" ");
  return document.createTextNode(text);
}

function isSpaceChar(text: string | null | undefined) {
  return text?.trim && text.trim().length === 0 && text.length === 1;
}

function splitTextNode(node: Text, offset: number) {
  if (offset === 0 || offset >= (node.textContent || "").length) return node;
  const text = node.textContent || "";
  const fragment = document.createDocumentFragment();
  const part1 = document.createTextNode(text.slice(0, offset));
  const part2 = document.createTextNode(text.slice(offset));
  fragment.appendChild(part1);
  fragment.appendChild(part2);
  node.replaceWith(fragment);
  return part1;
}

function insertToTextNode(newNode: Node, textNode: Text, offset: number) {
  if (offset === textNode.textContent?.length) {
    textNode.after(newNode);
  } else if (offset === 0) {
    textNode.before(newNode);
  } else {
    splitTextNode(textNode, offset).after(newNode);
  }
}

function createMentionInput(placeholder: string, atCode: string) {
  const text = document.createTextNode(atCode);
  const span = document.createElement("span");
  span.appendChild(text);
  span.className = "mention-line-block mention-input empty";
  if (placeholder) span.setAttribute("placeholder", placeholder);
  return span;
}

function createSkillInput(placeholder: string, skillCode: string) {
  const text = document.createTextNode(skillCode);
  const span = document.createElement("span");
  span.appendChild(text);
  span.className = "mention-line-block skill-input empty";
  if (placeholder) span.setAttribute("placeholder", placeholder);
  return span;
}

function createMentionLink(data: any) {
  if (!data) return null;
  const a = document.createElement("a");
  if (data) a.setAttribute("data-json", JSON.stringify(data));

  const iconSpan = document.createElement("span");
  iconSpan.className = "svg-sprite-icon link-icon";
  iconSpan.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="1em" height="1em"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>`;

  const textSpan = document.createElement("span");
  textSpan.className = "text";
  textSpan.textContent = data.name;

  const closeSpan = document.createElement("span");
  closeSpan.className = "svg-sprite-icon close-icon";
  closeSpan.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/></svg>`;

  a.appendChild(iconSpan);
  a.appendChild(textSpan);
  a.appendChild(closeSpan);

  a.setAttribute("target", "_blank");
  a.setAttribute("href", "");
  a.setAttribute("contenteditable", "false");
  a.setAttribute("class", "mention-link mention-line-block");

  return a;
}

function createSkillTag(skill: SkillItem, onRemove: () => void) {
  const span = document.createElement("span");
  span.className = "mention-line-block skill-tag";
  span.setAttribute("data-skill", skill.label);
  span.setAttribute("contenteditable", "false");

  const textSpan = document.createElement("span");
  textSpan.className = "text";
  textSpan.textContent = skill.label;

  const closeSpan = document.createElement("span");
  closeSpan.className = "close-icon";
  closeSpan.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

  closeSpan.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    span.remove();
    onRemove();
  };

  span.appendChild(textSpan);
  span.appendChild(closeSpan);

  return span;
}

function offsetBlock(el: HTMLElement) {
  const blocks = el.querySelectorAll(".mention-line-block");
  if (blocks.length !== 0) {
    blocks.forEach((b) => {
      const prev = b.previousSibling;
      const next = b.nextSibling;
      if (prev) {
        const text = prev.textContent;
        const isText = prev.nodeType === Node.TEXT_NODE;
        const isEmpty = isText && text?.trim().length === 0;
        const isNotSpace = isText && !isEmpty && !isSpaceChar(text?.slice(-1));
        const isBlock = hasClassName(prev as HTMLElement, "mention-line-block");
        if (isNotSpace || isBlock) b.before(createSpace(1));
      }
      if (next) {
        const isNotSpace =
          next.nodeType === Node.TEXT_NODE &&
          !isSpaceChar(next.textContent?.slice(0, 1));
        const isBlock = hasClassName(next as HTMLElement, "mention-line-block");
        if (isNotSpace || isBlock) b.after(createSpace(1));
      }
    });
  }
}

function removeChar(str: string, index: number) {
  return str.length < index ? str : str.slice(0, index - 1) + str.slice(index);
}

function removeAtCodeAndFixCaret(el: Node, offset: number) {
  if (el.nodeType === Node.TEXT_NODE) {
    el.textContent = removeChar(el.textContent || "", offset);
    moveCursorTo(el, offset - 1);
  } else {
    moveCursorToElementEnd(el);
  }
}

function transformMentionInputToText(el: HTMLElement) {
  if (!el) return null;
  const text = document.createTextNode(el.textContent || "");
  el.replaceWith(text);
  return text;
}

function getPuretext(node: Node): string {
  if (!node) return "";
  let text = "";
  if (node.nodeName === "BR") {
    text += "\n";
  } else if (node.childNodes && node.nodeName !== "#text") {
    node.childNodes.forEach((child) => {
      text += getPuretext(child);
    });
  } else {
    text += node.textContent || "";
  }
  return text;
}

// ============ 主组件 ============

const SenderInner = forwardRef<SenderRef, SenderProps>((props, ref) => {
  const {
    library,
    disabledAt = false,
    showAt = true,
    showSkill = false,
    disabled = false,
    loading = false,
    maxAt = 20,
    createLinkInEditor = false,
    isMobile = false,
    atCode = "@",
    atToolTip = "指定任意文件问答",
    skillCode = "/",
    skillToolTip = "选择技能",
    showCaret = true,
    atPlaceholder = "指定文档",
    placeholder = "请输入你想提问的问题，shift+enter换行",
    canBlur = true,
    placeholderStyle,
    enhancedMention = false,
    needFixPositionWhenFocus = true,
    selectedSkills = [],
    enableUpload = false,
    acceptTypes = ".pdf,.doc,.docx,.txt,.md,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.zip,.rar",
    allowMultiple = true,
    httpRequest,
    allowSendWithFiles = true,
    actionPosition = "actions",
    onInput,
    onStop,
    onSend,
    onSelectSkill,
    onRemoveSkill,
    onOpenSkillLibrary,
    onFileChange,
    onAfterCalloutMentionInput,
    renderHeader,
    renderExtras,
    renderActions,
  } = props;

  // Refs
  const editorRef = useRef<HTMLDivElement>(null);
  const mentionWrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileSelectDialogRef = useRef<FileSelectDialogRef>(null);
  const skillButtonRef = useRef<HTMLButtonElement>(null);

  // State
  const [isComposing, setIsComposing] = useState(false);
  const [composingEndTime, setComposingEndTime] = useState(0);

  // Safari 兼容：compositionend 后短时间内仍视为 composing
  const isComposingRigorous = useCallback(() => {
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    return isSafari ? isComposing || (Date.now() - composingEndTime < 20) : isComposing;
  }, [isComposing, composingEndTime]);
  const [lastCursor, setLastCursor] = useState<{
    element: Node;
    cursorPos: number;
    range?: Range;
  } | null>(null);
  const [queryText, setQueryText] = useState("");
  const [atRect, setAtRect] = useState<DOMRect | null>(null);
  const [canShowSelect, setCanShowSelect] = useState(false);
  const [hasSelectAfterOpen, setHasSelectAfterOpen] = useState(false);
  const [isShowPlaceholder, setIsShowPlaceholder] = useState(true);
  const [isEmptyInput, setIsEmptyInput] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [knowledgeList, setKnowledgeList] = useState<FileItem[]>([]);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [activeTab, setActiveTab] = useState<"knowledge" | "skill">(
    "knowledge",
  );
  const [searchLoading, setSearchLoading] = useState(false);
  const [knowledgeSearchResults, setKnowledgeSearchResults] = useState<
    FileItem[]
  >([]);
  const [skillSearchResults, setSkillSearchResults] = useState<SkillItem[]>([]);
  const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([]);
  const [currentSkill, setCurrentSkill] = useState<SkillItem | null>(null);
  const [isBackspace, setIsBackspace] = useState(false);

  // 技能下拉框控制
  const [canShowSkillSelect, setCanShowSkillSelect] = useState(false);
  const [skillSearchKeyword, setSkillSearchKeyword] = useState("");
  const [skillButtonRect, setSkillButtonRect] = useState<DOMRect | null>(null);
  const [mySkillList, setMySkillList] = useState<SkillMyItem[]>([]);
  const [mySkillLoading, setMySkillLoading] = useState(false);

  // 技能列表
  const skillList: SkillItem[] = [
    { label: "测试代码生成", img: "skill1" },
    { label: "录音转文字", img: "skill2" },
    { label: "天气查询", img: "skill3" },
  ];

  // 过滤后的知识列表
  const filteredKnowledge = useMemo(() => {
    const keyword = searchKeyword.trim();
    if (keyword) {
      return knowledgeSearchResults;
    }
    return knowledgeList.slice(0, 5);
  }, [searchKeyword, knowledgeList, knowledgeSearchResults]);

  // 过滤后的技能列表
  const filteredSkillList = useMemo(() => {
    const keyword = searchKeyword.trim();
    if (keyword) {
      return skillSearchResults;
    }
    return skillList.slice(0, 5);
  }, [searchKeyword, skillSearchResults]);

  // 有上传中的文件
  const hasUploadingFile = useMemo(() => {
    return uploadFileList.some((f) => f.status === "uploading");
  }, [uploadFileList]);

  // 是否可发送
  const canSend = useMemo(() => {
    if (loading) return false;
    if (hasUploadingFile) return false;
    if (isShowPlaceholder) return false;
    if (isEmptyInput) return false;
    return true;
  }, [loading, hasUploadingFile, isShowPlaceholder, isEmptyInput]);

  // 计算弹窗位置
  const popupStyle = useMemo((): React.CSSProperties => {
    if (!atRect || !mentionWrapperRef.current) {
      return {
        top: "100%",
        left: "0",
      };
    }

    const wrapperRect = mentionWrapperRef.current.getBoundingClientRect();
    const inputRect = atRect;
    const left = inputRect.left - wrapperRect.left;
    const POPUP_HEIGHT_ESTIMATE = 340;
    const spaceBelow = window.innerHeight - inputRect.bottom;
    const showAbove = spaceBelow < POPUP_HEIGHT_ESTIMATE;

    if (showAbove) {
      const bottom = wrapperRect.bottom - inputRect.top + 4;
      return {
        bottom: `${bottom}px`,
        left: `${left}px`,
        position: "absolute",
      };
    }

    const top = inputRect.bottom - wrapperRect.top;
    return {
      top: `${top + 4}px`,
      left: `${left}px`,
      position: "absolute",
    };
  }, [atRect]);

  // 技能下拉框样式 - 相对于按钮定位
  const skillPopupStyle = useMemo((): React.CSSProperties => {
    // 通过 / 触发时（存在 skill-input 元素），使用相对于 mentionWrapperRef 的绝对定位
    const skillInput = editorRef.current?.querySelector(".skill-input") as HTMLElement | null;
    if (skillInput && mentionWrapperRef.current) {
      const wrapperRect = mentionWrapperRef.current.getBoundingClientRect();
      const inputRect = skillInput.getBoundingClientRect();

      const left = inputRect.left - wrapperRect.left;
      const POPUP_HEIGHT_ESTIMATE = 334;
      const spaceBelow = window.innerHeight - inputRect.bottom;
      const showAbove = spaceBelow < POPUP_HEIGHT_ESTIMATE;

      if (showAbove) {
        const bottom = wrapperRect.bottom - inputRect.top + 4;
        return {
          bottom: `${bottom}px`,
          left: `${left}px`,
          position: "absolute" as const,
        };
      }

      const top = inputRect.bottom - wrapperRect.top;
      return {
        top: `${top + 4}px`,
        left: `${left}px`,
        position: "absolute" as const,
      };
    }

    // 通过按钮触发时，使用 fixed 定位
    if (!skillButtonRect) {
      return {
        top: "100%",
        left: "0",
      };
    }

    const buttonRect = skillButtonRect;
    const POPUP_HEIGHT_ESTIMATE = 340;
    const spaceBelow = window.innerHeight - buttonRect.bottom;

    if (spaceBelow < POPUP_HEIGHT_ESTIMATE) {
      return {
        bottom: `${window.innerHeight - buttonRect.top + 4}px`,
        left: `${buttonRect.left}px`,
        position: "fixed" as const,
      };
    }

    return {
      top: `${buttonRect.bottom + 4}px`,
      left: `${buttonRect.left}px`,
      position: "fixed" as const,
    };
  }, [atRect, skillButtonRect]);

  // 启用的技能列表
  const enabledMySkills = useMemo(() => {
    return mySkillList.filter((s) => s.binding_status === "enabled");
  }, [mySkillList]);

  const filteredMySkills = useMemo(() => {
    if (!skillSearchKeyword.trim()) return enabledMySkills;
    const keyword = skillSearchKeyword.toLowerCase();
    return enabledMySkills.filter((s) =>
      s.display_name?.toLowerCase().includes(keyword) ||
      s.skill_name?.toLowerCase().includes(keyword) ||
      s.description?.toLowerCase().includes(keyword),
    );
  }, [skillSearchKeyword, enabledMySkills]);

  // 显示的 placeholder
  const showPlaceholderText = useMemo(() => {
    return links.length > 0 ? "基于指定文件提问" : placeholder;
  }, [links.length, placeholder]);

  // 加载最近文件
  const loadRecentlyFiles = useCallback(async () => {
    try {
      const res = await filesApi.recently();
      setKnowledgeList(res.map(formatFile));
    } catch (err) {
      console.error("加载最近文件失败:", err);
    }
  }, []);

  // 搜索知识（带防抖）
  const searchKnowledgeRaw = useCallback(async (keyword: string) => {
    if (!keyword.trim()) {
      setKnowledgeSearchResults([]);
      return;
    }
    setSearchLoading(true);
    try {
      const res = await filesApi.search({ query: keyword, top_k: 10 });
      const files =
        res.results?.map((item: any) => item.file || item).flat() || [];
      setKnowledgeSearchResults(files.map(formatFile));
    } catch (err) {
      console.error("搜索知识失败:", err);
      setKnowledgeSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const searchKnowledge = useDebounce(searchKnowledgeRaw, 300);

  // 搜索技能
  const searchSkills = useCallback((keyword: string) => {
    if (!keyword.trim()) {
      setSkillSearchResults([]);
      return;
    }
    const filtered = skillList.filter((item) =>
      item.label.toLowerCase().includes(keyword.toLowerCase()),
    );
    setSkillSearchResults(filtered);
  }, []);

  // 加载技能列表
  const loadMySkillList = useCallback(async () => {
    if (mySkillList.length > 0) return;
    setMySkillLoading(true);
    try {
      const res = await skillApi.getMyList({ limit: 100 });
      setMySkillList(res?.items || []);
    } catch (err) {
      console.error("加载技能列表失败:", err);
    } finally {
      setMySkillLoading(false);
    }
  }, [mySkillList]);

  // 关闭技能选择弹窗
  const closeSkillSelect = useCallback(() => {
    setCanShowSkillSelect(false);
  }, []);

  // 从下拉框选择技能
  const handleSelectSkillFromDropdown = useCallback(
    (skill: SkillMyItem) => {
      // 删除 skill-input 元素
      const skillInput = editorRef.current?.querySelector(".skill-input");
      if (skillInput) {
        skillInput.remove();
      }
      handleSelectSkill({
        label: skill.display_name,
        img: skill.icon || "skill",
      });
      closeSkillSelect();
    },
    [closeSkillSelect],
  );

  const handleGoToSkillLibrary = useCallback(() => {
    setCanShowSkillSelect(false);
    onOpenSkillLibrary?.();
  }, [onOpenSkillLibrary]);

  // 获取光标
  const getCursor = useCallback(() => {
    const sel = document.getSelection();
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const element = range.startContainer;
    const offset = range.startOffset || 0;
    const char = element.textContent?.slice(offset - 1, offset) || "";
    return {
      cursorChar: char,
      cursorPos: offset,
      range,
      element,
    };
  }, []);

  // 获取编辑器内的光标
  const getEditorCursor = useCallback(() => {
    const c = getCursor();
    return c?.element && editorRef.current?.contains(c.element) ? c : null;
  }, [getCursor]);

  // 查找 mention input
  const findMentionInputFromCursor = useCallback(
    (el?: Node | null) => {
      const element = el || getCursor()?.element;
      return findParentInEditorHasClass(
        element,
        "mention-input",
      ) as HTMLElement | null;
    },
    [getCursor],
  );

  // 查找 skill input
  const findSkillInputFromCursor = useCallback(
    (el?: Node | null) => {
      const element = el || getCursor()?.element;
      return findParentInEditorHasClass(
        element,
        "skill-input",
      ) as HTMLElement | null;
    },
    [getCursor],
  );

  // 获取当前 mention input
  const getCurrentMentionInput = useCallback(() => {
    return editorRef.current?.querySelector(
      ".mention-input",
    ) as HTMLElement | null;
  }, []);

  // 获取当前 skill input
  const getSkillInput = useCallback(() => {
    return editorRef.current?.querySelector(
      ".skill-input",
    ) as HTMLElement | null;
  }, []);

  // 插入节点
  const insertNode = useCallback(
    (node: Node, cursor?: any) => {
      const c = cursor || getEditorCursor();

      if (c && !c.range.collapsed) {
        c.range.deleteContents();
      }

      const editor = editorRef.current;
      if (!c) {
        const lastChild = editor?.lastChild;
        if (lastChild && (lastChild as HTMLElement).tagName === "BR") {
          lastChild.before(node);
        } else {
          editor?.appendChild(node);
        }
        offsetBlock(editor!);
        return;
      }
      const { element, cursorPos } = c;
      if (element === editor) {
        const lastChild = editor?.lastChild;
        if (lastChild && (lastChild as HTMLElement).tagName === "BR") {
          lastChild.before(node);
        } else {
          editor?.appendChild(node);
        }
        offsetBlock(editor!);
        return;
      }
      if (
        (element as HTMLElement).tagName === "BR" &&
        element === editor?.lastChild
      ) {
        element.before(node);
        offsetBlock(editor!);
        return;
      }
      insertToTextNode(node, element as Text, cursorPos);
      offsetBlock(editor!);
    },
    [getEditorCursor],
  );

  // 激活 mention input
  const activeMentionInput = useCallback(
    (cursor?: any) => {
      if (getCurrentMentionInput()) return;
      const input = createMentionInput(atPlaceholder, atCode);
      insertNode(input, cursor);
      requestAnimationFrame(() => {
        moveCursorToElementEnd(input);
        setAtRect(input.getBoundingClientRect());
      });
      setCanShowSelect(true);
    },
    [atPlaceholder, atCode, getCurrentMentionInput, insertNode],
  );

  // 激活 skill input
  const activeSkillInput = useCallback(
    (cursor?: any) => {
      if (getSkillInput()) return;
      const input = createSkillInput(skillToolTip, skillCode);
      insertNode(input, cursor);
      requestAnimationFrame(() => {
        moveCursorToElementEnd(input);
        setAtRect(input.getBoundingClientRect());
      });
      // 加载技能列表并显示技能弹窗
      loadMySkillList();
      setSkillSearchKeyword("");
      setCanShowSkillSelect(true);
    },
    [skillToolTip, skillCode, getSkillInput, insertNode, loadMySkillList],
  );

  // 切换技能下拉框显示
  const toggleSkillSelect = useCallback(() => {
    if (canShowSkillSelect) {
      closeSkillSelect();
      return;
    }
    // 关闭知识选择下拉框
    setCanShowSelect(false);

    // 设置按钮位置（用于 fixed 定位弹窗）
    if (skillButtonRef.current) {
      const rect = skillButtonRef.current.getBoundingClientRect();
      setSkillButtonRect(rect);
    }

    // 如果没有 skill-input 元素，创建一个（与输入 / 行为一致）
    if (!editorRef.current?.querySelector(".skill-input")) {
      editorRef.current?.focus();
      // 创建 skill-input 元素
      activeSkillInput();
    } else {
      // 已有 skill-input，加载技能列表并显示弹窗
      loadMySkillList();
      setSkillSearchKeyword("");
      setCanShowSkillSelect(true);
    }
  }, [canShowSkillSelect, closeSkillSelect, loadMySkillList, activeSkillInput]);

  // 退出 mention input
  const quitMentionInput = useCallback(
    (input?: HTMLElement, force = false) => {
      if (hasSelectAfterOpen || force) {
        const el = input || editorRef.current?.querySelector(".mention-input");
        if (el) el.remove();
        moveCursorToElementEnd(editorRef.current!);
      } else {
        const el = input || editorRef.current?.querySelector(".mention-input");
        if (el) {
          const text = transformMentionInputToText(el);
          if (text) moveCursorToElementEnd(text);
        }
        setIsComposing(false);
      }
      setCanShowSelect(false);
    },
    [hasSelectAfterOpen],
  );

  // 切换 placeholder
  const togglePlaceHolder = useCallback(() => {
    const text = editorRef.current?.textContent?.trim();
    const skillText =
      editorRef.current?.querySelector(".skill-tag")?.innerText?.trim() || "";
    setIsShowPlaceholder(
      text.length === 0 &&
        !editorRef.current?.querySelector(".mention-line-block"),
    );
    setIsEmptyInput(!text.replace(skillText, "").trim());
  }, []);

  // 是否为空编辑器
  const isEmptyEditor = useCallback(() => {
    return (
      editorRef.current?.textContent?.trim().length === 0 &&
      !editorRef.current?.querySelector(".mention-line-block")
    );
  }, []);

  // 设置编辑器内容
  const setEditor = useCallback((html: string) => {
    if (editorRef.current) editorRef.current.innerHTML = html;
  }, []);

  // 清空并重置
  const checkAndRemoveOnlySpace = useCallback(
    (forceClear = false) => {
      if (isEmptyEditor()) {
        if (forceClear) setEditor("");
        else {
          setEditor(isMobile ? "<br />" : "");
        }
        togglePlaceHolder();
      }
    },
    [isEmptyEditor, isMobile, setEditor, togglePlaceHolder],
  );

  // 移除输入中的 mention
  const removeInputingMention = useCallback((removeSpace = false) => {
    const input = editorRef.current?.querySelector(".mention-input");
    if (input) {
      input.remove();
    }
  }, []);

  // 获取存活的最后光标
  const getAliveLastCursor = useCallback(() => {
    const cursor = lastCursor;
    return cursor &&
      cursor.element &&
      editorRef.current?.contains(cursor.element)
      ? cursor
      : null;
  }, [lastCursor]);

  // 移动光标到编辑器末尾
  const moveCursorToEditorEnd = useCallback(() => {
    moveCursorToElementEnd(editorRef.current!);
  }, []);

  // 重置最后光标
  const resetLastCursor = useCallback(() => {
    const c = getEditorCursor();
    setLastCursor(c);
  }, [getEditorCursor]);

  // 延迟重置最后光标
  const lazyResetLastCursor = useCallback(() => {
    setTimeout(() => {
      const c = getEditorCursor();
      setLastCursor(c);
    }, 30);
  }, [getEditorCursor]);

  // 添加链接
  const addLink = useCallback(
    async (data: any) => {
      setHasSelectAfterOpen(true);

      if (createLinkInEditor) {
        const input = getCurrentMentionInput();
        const link = createMentionLink(data);
        if (!link) return;
        const space = createSpace(1);
        if (input) {
          input.replaceWith(link);
          link.after(space);
          moveCursorToElementEnd(space);
        }
        return;
      }

      // Outside link mode
      if (links.length >= maxAt) {
        message.warning(`最多指定${maxAt}个文件`);
      } else {
        setLinks((prev) => [...prev, data]);
      }
    },
    [createLinkInEditor, getCurrentMentionInput, links.length, maxAt],
  );

  // 处理选中
  const onSingleSelected = useCallback(
    async (item: any) => {
      if (isComposingRigorous() || !item) return;
      const input = getCurrentMentionInput();
      if (!input && createLinkInEditor) return;

      if (links.some((l) => l.id === item.id)) {
        setHasSelectAfterOpen(true);
        return;
      }

      await addLink(item);

      if (!isMobile) {
        if (input && !createLinkInEditor) {
          removeInputingMention(true);
        }
        moveCursorToEditorEnd();
        resetLastCursor();
      }
    },
    [
      isComposing,
      getCurrentMentionInput,
      createLinkInEditor,
      links,
      addLink,
      isMobile,
      removeInputingMention,
      moveCursorToEditorEnd,
      resetLastCursor,
    ],
  );

  // 处理技能选择
  const handleSelectSkill = useCallback(
    (skill: SkillItem) => {
      // 移除已有的技能标签
      const existingSkills = editorRef.current?.querySelectorAll(".skill-tag");
      existingSkills?.forEach((tag) => tag.remove());

      // 移除 mention input
      const input = editorRef.current?.querySelector(
        ".mention-input",
      ) as HTMLElement;
      if (input) {
        input.remove();
      }

      // 移除 skill input
      const skillInput = editorRef.current?.querySelector(
        ".skill-input",
      ) as HTMLElement;
      if (skillInput) {
        skillInput.remove();
      }

      // 创建技能标签
      const skillTag = createSkillTag(skill, () => {
        onRemoveSkill?.();
      });

      // 插入到编辑器开头
      editorRef.current?.prepend(skillTag);
      moveCursorToElementEnd(skillTag);

      onSelectSkill?.(skill);
      setCurrentSkill(skill);
      setCanShowSelect(false);
      setCanShowSkillSelect(false);
      togglePlaceHolder();
    },
    [onSelectSkill, onRemoveSkill, togglePlaceHolder],
  );

  // 转换 HTML 为数据
  const transformHtmlToData = useCallback(() => {
    if (!editorRef.current) return null;
    const clone = editorRef.current.cloneNode(true) as HTMLElement;
    const atList: any[] = [];
    const skillList: string[] = [];
    let pureText = "";

    const traverse = (node: Node) => {
      node.childNodes.forEach((child) => {
        if (
          hasClassName(child as HTMLElement, "mention-link") &&
          createLinkInEditor
        ) {
          const json = (child as HTMLElement).getAttribute("data-json");
          if (json) {
            try {
              atList.push(JSON.parse(json));
            } catch (err) {
              console.error(err);
            }
          }
        } else if (
          (child as HTMLElement).querySelector?.(".mention-link") &&
          createLinkInEditor
        ) {
          traverse(child);
        } else if (hasClassName(child as HTMLElement, "skill-tag")) {
          const skillLabel = (child as HTMLElement).getAttribute("data-skill");
          if (skillLabel) skillList.push(skillLabel);
        } else {
          if (!hasClassName(child as HTMLElement, "mention-line-block")) {
            pureText += getPuretext(child);
          }
        }
      });
    };
    traverse(clone);
    if (pureText === "\n") pureText = "";

    return {
      innerHTML: clone.innerHTML,
      textContent: pureText.trim() || "",
      atList: createLinkInEditor ? atList : links,
      skillList,
      pureTextContent: pureText,
    };
  }, [createLinkInEditor, links]);

  // 立即触发 input
  const emitInputImmediately = useCallback(() => {
    const data = transformHtmlToData();
    if (data) {
      togglePlaceHolder();
      onInput?.(data);
    }
  }, [transformHtmlToData, togglePlaceHolder, onInput]);

  // 处理 input
  const handleInput = useCallback(() => {
    const cursor = getCursor();
    if (!cursor || !cursor.element) return;

    lazyResetLastCursor();

    const { element } = cursor;
    const mentionInput = findMentionInputFromCursor(element);
    const skillInput = findSkillInputFromCursor(element);

    if (mentionInput) {
      setAtRect(mentionInput.getBoundingClientRect());
      setCanShowSelect(true);
      const text = element.textContent || "";
      const q = text.startsWith(atCode) ? text.slice(1) : text;
      setQueryText(q);
      return;
    }

    if (skillInput) {
      setAtRect(skillInput.getBoundingClientRect());
      setCanShowSkillSelect(true);
      return;
    }

    // 检查光标后面是否有技能标签
    if (!isBackspace) {
      const range = cursor.range;
      if (range) {
        let nextNode = element.nextSibling;
        while (nextNode) {
          if ((nextNode as HTMLElement).classList?.contains("skill-tag")) {
            nextNode.remove();
            onRemoveSkill?.();
            break;
          }
          nextNode = nextNode.nextSibling;
        }
        const parentNext = element.parentElement?.nextSibling;
        if (
          parentNext &&
          (parentNext as HTMLElement).classList?.contains("skill-tag")
        ) {
          parentNext.remove();
          onRemoveSkill?.();
        }
      }
    }

    const isAt = cursor.cursorChar === atCode;
    const isSkillTrigger = cursor.cursorChar === skillCode;
    const hasInput = !!getCurrentMentionInput();
    const hasSkillInput = !!getSkillInput();
    if (isAt && showAt && !disabledAt && !hasInput && !isBackspace) {
      removeAtCodeAndFixCaret(element, cursor.cursorPos);
      activeMentionInput();
    }
    // 检测 / 触发技能选择弹窗
    if (isSkillTrigger && showSkill && !hasSkillInput && !isBackspace) {
      removeAtCodeAndFixCaret(element, cursor.cursorPos);
      activeSkillInput();
    }
    togglePlaceHolder();
  }, [
    getCursor,
    lazyResetLastCursor,
    findMentionInputFromCursor,
    findSkillInputFromCursor,
    atCode,
    skillCode,
    isBackspace,
    onRemoveSkill,
    showAt,
    showSkill,
    disabledAt,
    getCurrentMentionInput,
    getSkillInput,
    activeMentionInput,
    activeSkillInput,
    togglePlaceHolder,
  ]);

  // 处理 keydown
  const handleKeydown = useCallback(
    (evt: React.KeyboardEvent) => {
      const cursor = getCursor();
      if (!cursor) return;
      const { element } = cursor;
      const mentionInput = findMentionInputFromCursor(element);

      lazyResetLastCursor();
      setIsBackspace(evt.key === "Backspace");

      if (evt.key !== "Backspace") {
        if (evt.key === "Enter" && !evt.shiftKey) {
          if (isComposingRigorous()) return;
          if (canShowSelect && mentionInput) {
            evt.preventDefault();
            return;
          }
          if (!canShowSelect) {
            evt.preventDefault();
            handleSend();
            return;
          }
        }
        if (evt.key === "Escape" && mentionInput) {
          setCanShowSelect(false);
          return;
        }
        if (
          (evt.key === "ArrowLeft" || evt.key === "ArrowRight") &&
          mentionInput
        ) {
          if (evt.key === "ArrowLeft" && cursor.cursorPos <= 1) {
            evt.preventDefault();
          }
        }
      } else {
        const { element: el } = cursor;
        if (
          el &&
          isSpaceChar(el.textContent) &&
          hasClassName(el.previousSibling as HTMLElement, "mention-line-block")
        ) {
          const prev = el.previousSibling as HTMLElement;
          prev?.remove();
          removeInputingMention();
        }
        if (hasClassName(el as HTMLElement, "mention-link")) {
          (el as HTMLElement).remove();
          evt.preventDefault();
        }
      }

      // 处理下拉选择框的键盘导航
      if (canShowSelect && mentionInput) {
        const items = filteredKnowledge;
        if (evt.key === "ArrowDown") {
          evt.preventDefault();
          setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
          return;
        }
        if (evt.key === "ArrowUp") {
          evt.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
          return;
        }
        if (evt.key === "Enter" && !evt.shiftKey) {
          evt.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < items.length) {
            const selectedItem = items[selectedIndex];
            if (selectedItem) {
              onSingleSelected(selectedItem);
              setCanShowSelect(false);
            }
          }
          return;
        }
      }
    },
    [
      getCursor,
      findMentionInputFromCursor,
      lazyResetLastCursor,
      isComposing,
      canShowSelect,
      filteredKnowledge,
      selectedIndex,
      onSingleSelected,
      removeInputingMention,
    ],
  );

  // 处理 paste
  const handlePaste = useCallback(
    (evt: React.ClipboardEvent) => {
      evt.preventDefault();
      const clipboardData = evt.clipboardData;
      const text = clipboardData?.getData("text/plain") || "";
      const cleanText = findMentionInputFromCursor()
        ? text.replace(/\n/gi, "")
        : text;
      insertText(cleanText);
    },
    [findMentionInputFromCursor],
  );

  // 处理 click
  const handleClick = useCallback(
    (evt: React.MouseEvent) => {
      resetLastCursor();
      const target = evt.target as HTMLElement;
      if (!target) return;
      const mentionInput = findMentionInputFromCursor(target);
      const skillInputEl = findSkillInputFromCursor(target);
      const closeIcon = findParentInEditorHasClass(target, "close-icon");

      if (!isMobile && closeIcon) {
        const link = findParentInEditorHasClass(target, "mention-link");
        if (link) {
          evt.preventDefault();
          evt.stopPropagation();
          link.remove();
          emitInputImmediately();
        }
      }

      setCanShowSelect(!!mentionInput);

      // 处理点击 skill-input：打开技能弹窗
      if (skillInputEl && showSkill) {
        loadMySkillList();
        setSkillSearchKeyword("");
        setCanShowSkillSelect(true);
        requestAnimationFrame(() => moveCursorToEditorEnd());
      }

      if (getCurrentMentionInput() && !createLinkInEditor && !mentionInput) {
        quitMentionInput();
        emitInputImmediately();
      } else if (mentionInput) {
        requestAnimationFrame(() => moveCursorToEditorEnd());
      }
    },
    [
      resetLastCursor,
      findMentionInputFromCursor,
      findSkillInputFromCursor,
      isMobile,
      showSkill,
      loadMySkillList,
      moveCursorToEditorEnd,
      getCurrentMentionInput,
      createLinkInEditor,
      quitMentionInput,
      emitInputImmediately,
    ],
  );

  // 处理 composition start
  const handleCompositionStart = useCallback(() => {
    setIsComposing(true);
  }, []);

  // 处理 composition end
  const handleCompositionEnd = useCallback(() => {
    setIsComposing(false);
    setComposingEndTime(Date.now());
    emitInputImmediately();
  }, [emitInputImmediately]);

  // 处理 blur
  const handleBlur = useCallback(async () => {
    if (editorRef.current && canBlur) {
      emitInputImmediately();
      checkAndRemoveOnlySpace();
    }
  }, [canBlur, emitInputImmediately, checkAndRemoveOnlySpace]);

  // 处理 focus
  const handleFocus = useCallback(() => {
    // 可扩展
  }, []);

  // 插入文本
  const insertText = useCallback(
    (text: string) => {
      if (!text?.length) return;
      const textNode = document.createTextNode(text);
      insertNode(textNode);
      moveCursorToElementEnd(textNode);
      emitInputImmediately();
    },
    [insertNode, emitInputImmediately],
  );

  // 发送消息
  const handleSend = useCallback(() => {
    if (!canSend) return;

    const data = transformHtmlToData();
    const hasText = data && data.pureTextContent?.trim().length !== 0;
    const hasUploadingFiles = uploadFileList.some(
      (f) => f.status === "uploading",
    );

    if (hasUploadingFiles) {
      message.info("文件正在上传中...");
      return;
    }

    const hasFiles =
      allowSendWithFiles &&
      uploadFileList.some((f) => f.status === "done" && f.id);

    if (hasText || hasFiles) {
      const uploadedFiles = uploadFileList
        .filter((f) => f.status === "done" && f.id)
        .map((f) => ({
          id: f.id!,
          name: f.name,
          size: f.size,
          mime_type: f.mime_type,
          preview_key: f.preview_key,
        }));

      onSend?.({
        ...data,
        files: uploadedFiles,
      });

      // 清空编辑器和链接
      if (editorRef.current) editorRef.current.innerHTML = "";
      setUploadFileList([]);
      setLinks([]);
      togglePlaceHolder();
      emitInputImmediately();
    } else {
      message.info("请输入你想询问的问题");
    }
  }, [
    canSend,
    transformHtmlToData,
    uploadFileList,
    allowSendWithFiles,
    onSend,
    togglePlaceHolder,
    emitInputImmediately,
  ]);

  // 停止生成
  const handleStop = useCallback(() => {
    onStop?.();
  }, [onStop]);

  // 触发 mention
  const triggerMention = useCallback(
    async (e?: React.MouseEvent) => {
      e?.preventDefault();
      await new Promise((resolve) => setTimeout(resolve, 30));
      onAfterCalloutMentionInput?.();

      const cursor = getAliveLastCursor();
      activeMentionInput(cursor);
      togglePlaceHolder();
    },
    [getAliveLastCursor, activeMentionInput, togglePlaceHolder, onAfterCalloutMentionInput],
  );

  // 选择文档
  const handleSelectDoc = useCallback(
    (item: FileItem) => {
      onSingleSelected(item);
      setCanShowSelect(false);
    },
    [onSingleSelected],
  );

  // 打开知识库
  const handleOpenLibrary = useCallback(() => {
    fileSelectDialogRef.current?.open(links, library);
  }, [links, library]);

  // 选择文件
  const handleSelectFiles = useCallback(
    (files: FileItem[]) => {
      setLinks([]);
      files.forEach((file) => {
        onSingleSelected(file);
      });
    },
    [onSingleSelected],
  );

  // 移除链接
  const handleRemoveLink = useCallback((link: LinkItem) => {
    setLinks((prev) => prev.filter((l) => l.id !== link.id));
  }, []);

  // 关闭知识库选择
  const handleCloseKnowledge = useCallback(() => {
    setCanShowSelect(false);
    setQueryText("");
    setCanShowSelect(false);
    togglePlaceHolder();
  }, [togglePlaceHolder]);

  // 文件选择变化
  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const target = event.target;
      const files = target.files;
      if (!files || files.length === 0) return;

      const newFiles: UploadFile[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const maxSize = 50 * 1024 * 1024;
        if (file.size > maxSize) {
          message.warning(`文件 ${file.name} 超过 50MB 限制`);
          continue;
        }
        const uploadFile: UploadFile = {
          raw: file,
          name: file.name,
          size: file.size,
          mime_type: file.type,
          status: "uploading",
        };
        newFiles.push(uploadFile);
        setUploadFileList((prev) => [...prev, uploadFile]);
      }

      target.value = "";

      if (httpRequest && newFiles.length > 0) {
        for (const uploadFile of newFiles) {
          try {
            const res: any = await httpRequest(uploadFile.raw);
            setUploadFileList((prev) =>
              prev.map((f) =>
                f === uploadFile
                  ? {
                      ...uploadFile,
                      id: res.id,
                      preview_key: res.preview_key,
                      url: res.url,
                      status: "done",
                    }
                  : f,
              ),
            );
          } catch (err: any) {
            message.error(`上传文件 ${uploadFile.name} 失败`);
            setUploadFileList((prev) => prev.filter((f) => f !== uploadFile));
          }
        }
      }

      onFileChange?.(uploadFileList);
    },
    [httpRequest, onFileChange, uploadFileList],
  );

  // 移除上传的文件
  const removeUploadFile = useCallback(
    (index: number) => {
      setUploadFileList((prev) => prev.filter((_, i) => i !== index));
      onFileChange?.(uploadFileList.filter((_, i) => i !== index));
    },
    [onFileChange, uploadFileList],
  );

  // 清空上传文件列表
  const clearUploadFiles = useCallback(() => {
    setUploadFileList([]);
  }, []);

  // 暴露方法
  useImperativeHandle(
    ref,
    () => ({
      insertText,
      post: handleSend,
      forceFocus: (moveEnd = false) => {
        if (!editorRef.current) return;
        editorRef.current.focus();
        if (moveEnd) moveCursorToEditorEnd();

        if (needFixPositionWhenFocus && mentionWrapperRef.current) {
          const { scrollTop } = mentionWrapperRef.current;
          setTimeout(() => {
            if (mentionWrapperRef.current) mentionWrapperRef.current.scrollTop = scrollTop;
          }, 200);
        }
      },
      clear: () => {
        if (editorRef.current) editorRef.current.innerHTML = "";
        setLinks([]);
        togglePlaceHolder();
        emitInputImmediately();
      },
      clearLinks: () => {
        setLinks([]);
        quitMentionInput();
        togglePlaceHolder();
        emitInputImmediately();
      },
      clearEditorOnly: () => {
        if (editorRef.current) editorRef.current.innerHTML = "";
        togglePlaceHolder();
        emitInputImmediately();
      },
      insertSkill: (skill: SkillItem) => {
        const existingSkill = editorRef.current?.querySelector(
          `.skill-tag[data-skill="${skill.label}"]`,
        );
        if (existingSkill) return;

        const skillTag = createSkillTag(skill, () => {
          onRemoveSkill?.();
        });

        if (editorRef.current) {
          editorRef.current.prepend(skillTag);
          moveCursorToElementEnd(editorRef.current);
          togglePlaceHolder();
          emitInputImmediately();
          onSelectSkill?.(skill);
        }
      },
      clearSkillTags: () => {
        if (editorRef.current) {
          const skillTags = editorRef.current.querySelectorAll(".skill-tag");
          skillTags.forEach((tag) => tag.remove());
          togglePlaceHolder();
          emitInputImmediately();
        }
      },
      clearUploadFiles,
    }),
    [
      insertText,
      handleSend,
      moveCursorToEditorEnd,
      togglePlaceHolder,
      emitInputImmediately,
      quitMentionInput,
      onSelectSkill,
      onRemoveSkill,
      clearUploadFiles,
    ],
  );

  // 监听搜索关键词
  useEffect(() => {
    if (activeTab === "knowledge") {
      searchKnowledge(searchKeyword);
    } else {
      searchSkills(searchKeyword);
    }
  }, [searchKeyword, activeTab, searchKnowledge, searchSkills]);

  // 监听下拉框显示，重置选中索引
  useEffect(() => {
    if (canShowSelect) {
      setSelectedIndex(-1);
    }
  }, [canShowSelect]);

  useEffect(() => {
    setSelectedIndex(-1);
  }, [queryText]);

  // 点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        canShowSelect &&
        mentionWrapperRef.current &&
        !mentionWrapperRef.current.contains(e.target as Node)
      ) {
        setCanShowSelect(false);
      }
      if (
        canShowSkillSelect &&
        mentionWrapperRef.current &&
        !mentionWrapperRef.current.contains(e.target as Node)
      ) {
        setCanShowSkillSelect(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [canShowSelect, canShowSkillSelect]);

  // 初始化
  useEffect(() => {
    if (showAt) {
      loadRecentlyFiles();
    }
    setIsShowPlaceholder(true);
    setIsEmptyInput(true);
  }, [showAt, loadRecentlyFiles]);

  return (
    <div>
      {/* 已上传文件列表 */}
      {uploadFileList.length > 0 && enableUpload && (
        <div className="flex flex-wrap gap-2 mb-2">
          {uploadFileList.map((file, index) => (
            <div
              key={index}
              className="max-w-40 h-7 px-2 rounded-lg cursor-pointer text-secondary bg-[#F8F9FA] hover:bg-[#E1E2E3] inline-flex items-center gap-1 relative group"
            >
              <FileOutlined />
              <span className="text-sm truncate">{file.name}</span>
              <CloseOutlined
                className="absolute -top-1 -right-1 size-4 border rounded-full bg-white flex-center opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => removeUploadFile(index)}
              />
            </div>
          ))}
        </div>
      )}

      <div className="relative rounded-lg border border-[#E3E8FF] bg-white px-3 py-3 shadow-lg">
        {/* 隐藏的文件输入框 */}
        {enableUpload && (
          <input
            ref={fileInputRef}
            type="file"
            multiple={allowMultiple}
            className="hidden"
            accept={acceptTypes}
            onChange={handleFileChange}
          />
        )}

        {/* 已选链接列表 */}
        {links.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap overflow-x-auto overflow-y-hidden mb-1.5">
            {links.map((link) => (
              <div
                key={link.id}
                className="h-6 px-1.5 rounded bg-[#F3F3F5] flex items-center text-sm text-tertiary group cursor-pointer relative whitespace-nowrap"
              >
                <div className="size-4 rounded mr-1">
                  <img src={link.icon} className="size-4" alt="" />
                </div>
                <span className="truncate">{link.name}</span>
                <div
                  className="group-hover:block hidden absolute right-0 size-4 border rounded-full bg-white"
                  onClick={() => handleRemoveLink(link)}
                >
                  <CloseOutlined style={{ fontSize: 14, color: "#B8B8B8" }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Header slot */}
        {renderHeader?.()}

        <div ref={mentionWrapperRef} className="relative">
          {/* 可编辑区域 */}
          <div
            ref={editorRef}
            contentEditable={!disabled && !loading}
            className="h-20 overflow-y-auto w-full text-sm leading-relaxed text-primary focus:outline-none transition"
            style={{ ...(showCaret ? {} : { caretColor: "transparent" }) }}
            spellCheck={false}
            onInput={handleInput}
            onKeyDown={handleKeydown}
            onPaste={handlePaste}
            onClick={handleClick}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onBlur={handleBlur}
            onFocus={handleFocus}
          />

          {/* Placeholder */}
          {isShowPlaceholder && (
            <span
              className="pointer-events-none absolute inset-0 px-0 py-0 text-sm leading-relaxed text-hint"
              style={placeholderStyle}
            >
              {showPlaceholderText}
            </span>
          )}

          {/* 下拉选择框（普通模式） */}
          {canShowSelect && !enhancedMention && (
            <div
              className="pointer-events-auto absolute z-20 max-h-[334px] w-[300px] px-2 py-1.5 overflow-hidden rounded-xl shadow-[0_3px_8px_rgba(0,0,0,0.15)] bg-white"
              style={popupStyle}
            >
              <div className="h-9 flex items-center justify-between px-2 text-xs text-placeholder">
                <span>最近访问</span>
                <Button
                  type="link"
                  icon={<CloseOutlined />}
                  onClick={handleCloseKnowledge}
                />
              </div>
              <div className="space-y-1 mention-dropdown-list">
                {filteredKnowledge.map((doc, index) => (
                  <div
                    key={doc.id}
                    className={`mention-dropdown-item w-full h-8 flex items-center px-2.5 rounded transition cursor-pointer ${selectedIndex === index ? "bg-[#EBF1FF]" : "hover:bg-[#EBF1FF]"}`}
                    onClick={() => handleSelectDoc(doc)}
                  >
                    <div className="flex items-center gap-3 cursor-pointer overflow-hidden">
                      <div className="size-4 rounded">
                        <img src={doc.icon} className="size-4" alt="" />
                      </div>
                      <p className="flex-1 text-sm text-primary truncate">
                        {doc.name}
                      </p>
                    </div>
                  </div>
                ))}
                {filteredKnowledge.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-light">
                    没有匹配项，试试更换关键词
                  </div>
                )}
              </div>
              <div
                className="h-8 rounded flex items-center gap-2 px-2 text-sm mt-1 cursor-pointer hover:bg-[#F2F3F5]"
                onClick={handleOpenLibrary}
              >
                <div className="size-4 border rounded-full flex-center">
                  <MoreOutlined style={{ color: "#999999" }} />
                </div>
                <span className="flex-1 text-placeholder">查看更多</span>
                <ArrowRightOutlined />
              </div>
            </div>
          )}

          {/* 下拉选择框（增强模式 - 知识/技能） */}
          {canShowSelect && enhancedMention && (
            <div
              className="pointer-events-auto absolute z-20 max-h-[430px] w-[308px] px-3 py-1.5 overflow-hidden rounded-xl shadow-[0_3px_8px_rgba(0,0,0,0.15)] bg-white"
              style={popupStyle}
            >
              {/* 搜索框 */}
              <div className="py-3">
                <Search
                  mode="expanded"
                  placeholder="搜索知识"
                  value={searchKeyword}
                  onDebouncedChange={setSearchKeyword}
                />
              </div>

              {/* 知识/技能 Tab 切换已注释 */}
              {/* <div className="flex gap-3 mb-1">
                <div
                  className={`flex-1 w-1/2 py-[9px] rounded-lg text-center text-sm cursor-pointer transition-all ${activeTab === "knowledge" ? "bg-[#F2F3F5]" : ""}`}
                  onClick={() => setActiveTab("knowledge")}
                >
                  知识
                </div>
                <div
                  className={`flex-1 w-1/2 py-2.5 rounded-lg text-center text-sm cursor-pointer transition-all ${activeTab === "skill" ? "bg-[#F2F3F5]" : ""}`}
                  onClick={() => setActiveTab("skill")}
                >
                  技能
                </div>
              </div> */}

              {/* 知识列表 */}
              {activeTab === "knowledge" && (
                <div className="max-h-[280px] overflow-y-auto">
                  <div className="h-9 flex items-center text-xs text-placeholder px-2">
                    最近访问
                  </div>
                  <div className="space-y-1">
                    {filteredKnowledge.map((doc, index) => (
                      <div
                        key={doc.id}
                        className={`mention-dropdown-item w-full h-9 flex items-center px-2.5 rounded-lg transition cursor-pointer ${selectedIndex === index ? "bg-[#EBF1FF]" : "hover:bg-[#EBF1FF]"}`}
                        onClick={() => handleSelectDoc(doc)}
                      >
                        <div className="flex items-center gap-3 overflow-hidden flex-1">
                          <div className="size-5 rounded flex-center bg-[#F5F5F5]">
                            <img src={doc.icon} className="size-4" alt="" />
                          </div>
                          <p className="flex-1 text-sm text-primary truncate">
                            {doc.name}
                          </p>
                        </div>
                      </div>
                    ))}
                    {searchLoading && (
                      <div className="px-4 py-6 text-center text-xs text-light">
                        <LoadingOutlined />
                        搜索中...
                      </div>
                    )}
                    {!searchLoading && filteredKnowledge.length === 0 && (
                      <div className="px-4 py-6 text-center text-xs text-light">
                        {searchKeyword.trim()
                          ? "没有找到相关文件"
                          : "没有匹配项，试试更换关键词"}
                      </div>
                    )}
                  </div>
                  <div
                    className="h-8 rounded flex items-center gap-2 px-2.5 text-sm mt-1 cursor-pointer hover:bg-[#EBF1FF]"
                    onClick={handleOpenLibrary}
                  >
                    <span className="flex-1">@ 从知识库里选择更多</span>
                    <ArrowRightOutlined />
                  </div>
                </div>
              )}

              {/* 技能列表 */}
              {activeTab === "skill" && (
                <div className="max-h-[280px] overflow-y-auto">
                  <div className="h-9 flex items-center text-xs text-placeholder px-2">
                    最近访问
                  </div>
                  <div className="space-y-1">
                    {filteredSkillList.map((skill) => (
                      <div
                        key={skill.label}
                        className="h-9 px-2.5 rounded-lg flex items-center gap-3 cursor-pointer transition-all hover:bg-[#EBF1FF]"
                        onClick={() => handleSelectSkill(skill)}
                      >
                        <img
                          src={`/images/skill/${skill.img}.png`}
                          alt=""
                          className="size-6"
                        />
                        <span className="text-sm text-primary">
                          {skill.label}
                        </span>
                      </div>
                    ))}
                    {searchLoading && (
                      <div className="px-4 py-6 text-center text-xs text-light">
                        <LoadingOutlined />
                        搜索中...
                      </div>
                    )}
                    {!searchLoading && filteredSkillList.length === 0 && (
                      <div className="px-4 py-6 text-center text-xs text-light">
                        {searchKeyword.trim()
                          ? "没有找到相关技能"
                          : "没有匹配的技能"}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 技能选择下拉框 */}
          {canShowSkillSelect && (
            <div
              className="pointer-events-auto absolute z-20 max-h-[334px] w-[300px] px-3 py-3 overflow-hidden rounded-xl shadow-[0_3px_8px_rgba(0,0,0,0.15)] bg-white"
              style={skillPopupStyle}
            >
              {/* 搜索框 */}
              <div className="pb-3">
                <Search
                  mode="expanded"
                  placeholder="搜索技能"
                  value={skillSearchKeyword}
                  onDebouncedChange={setSkillSearchKeyword}
                />
              </div>

              {/* 技能列表 */}
              <div className="max-h-[220px] overflow-y-auto">
                {filteredMySkills.map((skill) => (
                  <div
                    key={skill.id}
                    className="w-full h-9 flex items-center px-2.5 rounded-lg cursor-pointer transition hover:bg-[#EBF1FF]"
                    onClick={() => handleSelectSkillFromDropdown(skill)}
                  >
                    <div className="flex items-center gap-3 overflow-hidden flex-1">
                      <div className="size-5 rounded flex items-center justify-center bg-[#F5F5F5]">
                        <SvgIcon name="skill" size="14" color="#2563EB" />
                      </div>
                      <p className="flex-1 text-sm text-primary truncate">
                        {skill.display_name}
                      </p>
                    </div>
                  </div>
                ))}
                {mySkillLoading && (
                  <div className="px-4 py-6 text-center text-xs text-light">
                    <LoadingOutlined />
                    加载中...
                  </div>
                )}
                {!mySkillLoading && filteredMySkills.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-light">
                    {skillSearchKeyword.trim()
                      ? "没有找到相关技能"
                      : "暂无可用技能"}
                  </div>
                )}
              </div>

              {/* 去技能库添加 */}
              {/* <div
                className="h-9 flex items-center gap-2 px-2.5 text-sm mt-2 cursor-pointer hover:bg-[#EBF1FF] rounded-lg"
                onClick={handleGoToSkillLibrary}
              >
                <SvgIcon name="skill" size="16" />
                <span className="flex-1">去技能库添加</span>
                <ArrowRightOutlined />
              </div> */}
            </div>
          )}
        </div>

        {/* 工具栏 */}
        <div className="flex items-center justify-between">
          {/* Extras slot */}
          {renderExtras?.() || <div />}

          {/* Actions slot */}
          {renderActions?.() || (
            <div className="flex items-center gap-3">
              {showAt && (
                <Tooltip
                  title={
                    disabledAt ? "需切换至【知识库】模式下才能使用" : atToolTip
                  }
                >
                  <Button
                    color="default"
                    variant="text"
                    disabled={disabledAt}
                    className="text-lg px-0"
                    onClick={(e) => {
                      e?.stopPropagation();
                      triggerMention();
                    }}
                  >
                    {atCode}
                  </Button>
                </Tooltip>
              )}
              {showSkill && (
                <Tooltip title="选择技能">
                  <Button
                    ref={skillButtonRef}
                    color="default"
                    variant="text"
                    className="text-lg px-0 ml-0"
                    onClick={(e) => {
                      e?.stopPropagation();
                      toggleSkillSelect();
                    }}
                  >
                    <SvgIcon name="skill" size="16" />
                  </Button>
                </Tooltip>
              )}
              {enableUpload && (
                <Tooltip title="上传附件">
                  <Button
                    color="default"
                    variant="text"
                    className="text-lg px-0"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <PaperClipOutlined />
                  </Button>
                </Tooltip>
              )}
              {loading ? (
                <div
                  className="size-8 rounded-full flex-center text-white bg-[#2563EB] cursor-pointer"
                  onClick={handleStop}
                >
                  <SvgIcon name="pause" />
                </div>
              ) : (
                <div className={showAt ? "flex" : "w-full flex justify-end"}>
                  <div
                    className={`size-8 ml-2 rounded-full flex-center text-white ${!canSend ? "bg-[#D3D4D9] cursor-not-allowed" : "bg-[#2563EB] cursor-pointer"}`}
                    onClick={handleSend}
                  >
                    <SvgIcon name="arrow-top" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 文件选择对话框 */}
      <FileSelectDialog
        ref={fileSelectDialogRef}
        onConfirm={handleSelectFiles}
      />
    </div>
  );
});

SenderInner.displayName = "Sender";

export const Sender = SenderInner;

export default Sender;
