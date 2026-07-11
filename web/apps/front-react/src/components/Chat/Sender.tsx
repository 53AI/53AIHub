import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useMemo,
} from "react";
import { Button, Tooltip, message, Input } from "antd";
import {
  CloseOutlined, RightOutlined,
  SearchOutlined,
  LoadingOutlined,
  PaperClipOutlined,
  FileOutlined
} from "@ant-design/icons";
import { SvgIcon, OverflowTooltip, Search } from "@km/shared-components-react";
import { useSkillsStore } from "@/stores/modules/skills";
import { type LibraryItem } from "@/api/modules/libraries";
import { type SpaceItem } from "@/api/modules/spaces";

import filesApi from "@/api/modules/files";
import { formatFile } from "@/api/modules/files/transform";
import { getPublicPath } from "@/utils/config";
import SpaceDialog from "@/components/Space/dialog";
import { MyFilesDialog } from "@/components/MyFilesDialog/dialog";
import type { MyFilesDialogRef } from "@/components/MyFilesDialog/types";
import { VERSION_MODULE } from "@/constants/enterprise";
import { checkVersion } from "@/utils/version";


// Debounce function to match Vue's useDebounceFn
function useDebounceFn<T extends (...args: any[]) => any>(
  fn: T,
  ms: number,
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn; // 每次渲染更新 fn 引用，但不触发 useCallback 重新创建

  return useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => fnRef.current(...args), ms);
    },
    [ms], // 只依赖 ms，不依赖 fn，确保返回稳定的函数引用
  ) as T;
}

// Types
interface DocItem {
  id: string;
  name: string;
  meta?: string;
  iconText?: string;
  url?: string;
  icon?: string;
  library_id?: string;
  upload_file_id?: number;
  file_size?: string;
  file_mime?: string;
  isfolder?: boolean;
  upload_file?: {
    size: number;
    mime_type: string;
  } | null;
}

interface LinkItem {
  id: string;
  name: string;
  icon?: string;
  ui?: { active: boolean };
  upload_file_id?: number;
  file_size?: number;
  file_mime?: string;
  library_id?: string;
  isfolder?: boolean;
  path?: string;
  rawData?: any;
  source?: string; // 文件来源：'knowledge' | 'uploads' | 'ai-generated' | 'recordings'
  islibrary?: boolean; // 标识是否为知识库
  isspace?: boolean; // 标识是否为空间
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
  img?: string;
}

interface SenderProps {
  className?: string;
  value?: object;
  library?: { id: string; space_id: string };
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
  placeholderStyle?: string | object;
  atPlaceholderStyle?: string;
  device?: object;
  needFixPositonWhenFocus?: boolean;
  customActionsClass?: string;
  enhancedMention?: boolean;
  actionPosition?: "actions" | "extras";
  hasKnowledgeBase?: boolean;
  /** 是否允许选择知识库（禁用后知识库列表项旁边不显示 checkbox） */
  allowSelectLibrary?: boolean;
  allowSelectSpace?: boolean;
  onInput?: (data: any) => void;
  onPost?: (data: any) => void;
  onMFocus?: () => void;
  onMBlur?: () => void;
  onQuery?: (query: string) => void;
  afterCalloutMentionInput?: () => void;
  onStop?: () => void;
  onSend?: (data: any) => void;
  header?: React.ReactNode;
  extras?: React.ReactNode;
  actions?: React.ReactNode;
  // 文件上传相关 props
  enableUpload?: boolean;
  acceptTypes?: string;
  httpRequest?: (file: File) => Promise<any>;
  allowSendWithFiles?: boolean;
  allowMultiple?: boolean;
  enableDragUpload?: boolean;
  onFileChange?: (files: UploadFile[]) => void;
  // 技能选择相关
  selectedSkills?: string[];
  onSelectSkill?: (skill: SkillItem) => void;
  onRemoveSkill?: () => void;
  onOpenSkillLibrary?: () => void;
  // 删除链接回调
  onRemoveLink?: (link: LinkItem) => void;
  // inputBefore slot
  inputBefore?: React.ReactNode;
  // 选择文件回调（从 Sender 内部的 SpaceDialog 选择时触发）
  onSelectFiles?: (files: DocItem[], libraries?: LibraryItem[], spaces?: SpaceItem[]) => void;
}

export interface SenderRef {
  insertText: (text: string) => void;
  post: () => void;
  forceFocus: (moveEnd?: boolean) => void;
  clear: () => void;
  clearLinks: () => void;
  setLinks: (links: LinkItem[]) => void;
  setPrompt: (text: string) => void;
  clearEditorOnly: () => void;
  clearUploadFiles: () => void;
  insertSkill: (skill: SkillItem) => void;
  clearSkillTags: () => void;
}

// 技能列表
const SKILL_LIST: SkillItem[] = [
  { label: "测试代码生成", img: "skill1" },
  { label: "录音转文字", img: "skill2" },
  { label: "天气查询", img: "skill3" },
];

export const Sender = forwardRef<SenderRef, SenderProps>(
  (
    {
      className = "",
      value,
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
      enableUpload = false,
      acceptTypes = ".pdf,.doc,.docx,.txt,.md,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.zip,.rar",
      httpRequest,
      allowSendWithFiles = true,
      allowMultiple = true,
      enableDragUpload = false,
      onFileChange,
      canBlur = true,
      placeholderStyle = "",
      atPlaceholderStyle = "",
      device = {},
      needFixPositonWhenFocus = true,
      customActionsClass = "",
      enhancedMention = false,
      actionPosition = "actions",
      hasKnowledgeBase = true,
      allowSelectLibrary = true,
      allowSelectSpace = true,
      onInput,
      onPost,
      onMFocus,
      onMBlur,
      onQuery,
      afterCalloutMentionInput,
      onStop,
      onSend,
      header,
      extras,
      actions,
      selectedSkills = [],
      onSelectSkill,
      onRemoveSkill,
      onOpenSkillLibrary,
      onRemoveLink,
      inputBefore,
      onSelectFiles,
    },
    ref,
  ) => {
    const senderRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<HTMLDivElement>(null);
    const mentionWrapperRef = useRef<HTMLDivElement>(null);
    const spaceDialogRef = useRef<{
      open: (files?: DocItem[], library?: any) => void;
    }>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isBackspaceRef = useRef(false);
    const uploadedDialogRef = useRef<MyFilesDialogRef>(null);
    const aiGeneratedDialogRef = useRef<MyFilesDialogRef>(null);
    const recordingsDialogRef = useRef<MyFilesDialogRef>(null);

    const [isComposing, setIsComposing] = useState(false);
    const [composingEndTime, setComposingEndTime] = useState(0);
    const [lastCursor, setLastCursor] = useState<{
      element: Node;
      cursorPos: number;
      range?: Range;
    } | null>(null);
    const [queryText, setQueryText] = useState("");
    const [atRect, setAtRect] = useState<DOMRect | null>(null);
    const [canShowSelect, setCanShowSelect] = useState(false);
    const [canShowSkillSelect, setCanShowSkillSelect] = useState(false);
    const [skillSearchKeyword, setSkillSearchKeyword] = useState("");
        const [hasSelectAfterOpen, setHasSelectAfterOpen] = useState(false);
    const [isShowPlaceholder, setIsShowPlaceholder] = useState(true);
    const [isEmptyInput, setIsEmptyInput] = useState(true);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [mentionLinkModel, setMentionLinkModel] = useState<{
      links: LinkItem[];
      collapsed: boolean;
    }>({
      links: [],
      collapsed: false,
    });
    const [knowledgeList, setKnowledgeList] = useState<DocItem[]>([]);
    const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([]);

    // 搜索相关状态
    const [searchKeyword, setSearchKeyword] = useState("");
    const [activeTab, setActiveTab] = useState<"knowledge" | "skill">(
      "knowledge",
    );
    const [searchLoading, setSearchLoading] = useState(false);
    const [knowledgeSearchResults, setKnowledgeSearchResults] = useState<
      DocItem[]
    >([]);
    const [skillSearchResults, setSkillSearchResults] = useState<SkillItem[]>(
      [],
    );

    const links = useMemo(
      () => mentionLinkModel.links,
      [mentionLinkModel.links],
    );

    const textareaStyle = useMemo(
      () => ({
        ...(showCaret ? {} : { caretColor: "transparent" }),
      }),
      [showCaret],
    );

    const showPlaceholder = useMemo(() => {
      return links.length > 0 ? "基于指定文件提问" : placeholder;
    }, [links, placeholder]);

    // 过滤后的知识列表
    const filteredKnowledge = useMemo(() => {
      const keyword = searchKeyword.trim();
      if (keyword) {
        return knowledgeSearchResults;
      }
      return knowledgeList.slice(0, 5);
    }, [searchKeyword, knowledgeSearchResults, knowledgeList]);

    // 过滤后的技能列表
    const filteredSkillList = useMemo(() => {
      const keyword = searchKeyword.trim();
      if (keyword) {
        return skillSearchResults;
      }
      return SKILL_LIST.slice(0, 5);
    }, [searchKeyword, skillSearchResults]);

    // 技能 Store
    const skillsStore = useSkillsStore();

    // 启用的我的技能列表
    const enabledMySkills = useMemo(() => {
      return skillsStore.mySkillList.filter((s: any) => s.binding_status === 'enabled');
    }, [skillsStore.mySkillList]);

    // 过滤后的我的技能列表
    const filteredMySkills = useMemo(() => {
      if (!skillSearchKeyword.trim()) return enabledMySkills;
      return enabledMySkills.filter((s: any) =>
        s.display_name.toLowerCase().includes(skillSearchKeyword) ||
        s.skill_name.toLowerCase().includes(skillSearchKeyword) ||
        s.description.toLowerCase().includes(skillSearchKeyword)
      );
    }, [enabledMySkills, skillSearchKeyword]);

    // 格式化文件，对录音文件使用 recrod.png 图标
    const formatFileWithRecordingIcon = useCallback((file: any) => {
      const formattedFile = formatFile(file);
      // 检查是否为录音来源
      const originSource = file.origin_source || file.file?.origin_source;
      if (originSource === 'recording' || originSource === 'recording_import') {
        formattedFile.icon = getPublicPath("/images/file/recrod.png");
      }
      return formattedFile;
    }, []);

    // 搜索知识
    const searchKnowledge = useDebounceFn(async (keyword: string) => {
      if (!keyword.trim()) {
        setKnowledgeSearchResults([]);
        return;
      }
      setSearchLoading(true);
      try {
        const res: any = await filesApi.search({ query: keyword, top_k: 10 });
        const files =
          res.results?.map((item: any) => item.file || item).flat() || [];
        setKnowledgeSearchResults(files.map(formatFileWithRecordingIcon));
      } catch (err) {
        console.error("搜索知识失败:", err);
        setKnowledgeSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);


    // Load recently accessed files
    const loadRecentlyFiles = useCallback(() => {
      filesApi.recently().then((res: any[]) => {
        setKnowledgeList(res.map(formatFileWithRecordingIcon));
      });
    }, []);

    // 标记是否已加载过最近文件
    const hasLoadedRecentlyFiles = useRef(false);

    // 延迟加载：只在用户第一次触发 @ 功能时加载
    const loadRecentlyFilesIfNeeded = useCallback(() => {
      if (hasLoadedRecentlyFiles.current) return;
      hasLoadedRecentlyFiles.current = true;
      loadRecentlyFiles();
    }, [loadRecentlyFiles]);

    // 组件挂载时不再自动加载，改为懒加载
    // useEffect(() => {
    //   if (showAt) {
    //     loadRecentlyFiles();
    //   }
    // }, [showAt, loadRecentlyFiles]);

    // Calculate popup position
    const popupStyle = useMemo(() => {
      if (!atRect || !mentionWrapperRef.current) {
        return { top: "100%", left: "0" };
      }
      const wrapperRect = mentionWrapperRef.current.getBoundingClientRect();
      const inputRect = atRect;
      const left = inputRect.left - wrapperRect.left;
      const POPUP_HEIGHT_ESTIMATE = enhancedMention ? 430 : 340;
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
    }, [atRect, enhancedMention]);

    // 技能下拉框样式
    const skillPopupStyle = useMemo(() => {
      // 通过 / 触发或按钮触发时，都使用 skill-input 元素的位置
      const skillInput = editorRef.current?.querySelector('.skill-input') as HTMLElement | null;
      if (skillInput && mentionWrapperRef.current) {
        const wrapperRect = mentionWrapperRef.current.getBoundingClientRect();
        const inputRect = skillInput.getBoundingClientRect();
        const left = inputRect.left - wrapperRect.left;
        const POPUP_HEIGHT_ESTIMATE = 334;
        const spaceBelow = window.innerHeight - inputRect.bottom;
        if (spaceBelow < POPUP_HEIGHT_ESTIMATE) {
          const bottom = wrapperRect.bottom - inputRect.top + 4;
          return { bottom: `${bottom}px`, left: `${left}px`, position: 'absolute' as const };
        }
        const top = inputRect.bottom - wrapperRect.top;
        return { top: `${top + 4}px`, left: `${left}px`, position: 'absolute' as const };
      }
      // 默认返回空样式（不应该到达这里，因为技能弹框只在有 skill-input 时显示）
      return { top: '100%', left: '0' };
    }, [atRect]);

    // Check if can send
    const hasUploadingFile = useMemo(() => {
      return uploadFileList.some((f) => f.status === "uploading");
    }, [uploadFileList]);

    const canSend = useMemo(() => {
      if (loading) return false;
      if (hasUploadingFile) return false;
      if (isShowPlaceholder) return false;
      if (isEmptyInput) return false;
      return true;
    }, [loading, hasUploadingFile, isShowPlaceholder, isEmptyInput]);

    // Helper functions
    const getCursor = useCallback(() => {
      const sel = document.getSelection();
      if (!sel?.rangeCount) return null;
      const range = sel.getRangeAt(0);
      const element = range.startContainer;
      const offset = range.startOffset || 0;
      const char = element.textContent?.slice(offset - 1, offset) || "";
      return { cursorChar: char, cursorPos: offset, range, element };
    }, []);

    const moveCursorToElementEnd = useCallback((el: Node) => {
      if (!el) return;
      const sel = document.getSelection();
      const range = document.createRange();
      if (
        (el as any).childNodes?.length > 0 ||
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
    }, []);

    const hasClassName = (el: Node | null, cls: string): boolean => {
      return !!(el as Element)?.classList?.contains(cls);
    };

    const findParent = (
      el: Node | null,
      check: (n: Node) => boolean,
    ): Node | null => {
      if (!el) return null;
      return check(el) ? el : findParent(el.parentNode, check);
    };

    const createSpace = (n = 1) => {
      const text = new Array(n + 1).join(" ");
      return document.createTextNode(text);
    };

    const isSpaceChar = (text: string | null | undefined) => {
      return text?.trim && text.trim().length === 0 && text.length === 1;
    };

    const moveCursorTo = useCallback((el: Node, offset: number) => {
      const sel = document.getSelection();
      const range = document.createRange();
      range.setStart(el, offset);
      range.setEnd(el, offset);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }, []);

    const splitTextNode = useCallback((node: Text, offset: number) => {
      if (offset === 0 || offset >= (node.textContent || "").length)
        return node;
      const text = node.textContent || "";
      const fragment = document.createDocumentFragment();
      const part1 = document.createTextNode(text.slice(0, offset));
      const part2 = document.createTextNode(text.slice(offset));
      fragment.appendChild(part1);
      fragment.appendChild(part2);
      node.replaceWith(fragment);
      return part1;
    }, []);

    const insertToTextNode = useCallback(
      (newNode: Node, textNode: Text, offset: number) => {
        if (offset === textNode.textContent?.length) {
          textNode.after(newNode);
        } else if (offset === 0) {
          textNode.before(newNode);
        } else {
          splitTextNode(textNode, offset).after(newNode);
        }
      },
      [splitTextNode],
    );

    const offsetBlock = useCallback((el: HTMLElement) => {
      const blocks = el.querySelectorAll(".mention-line-block");
      if (blocks.length !== 0) {
        blocks.forEach((b) => {
          const prev = b.previousSibling;
          const next = b.nextSibling;
          if (prev) {
            const text = prev.textContent;
            const isText = prev.nodeType === Node.TEXT_NODE;
            const isEmpty = isText && text?.trim().length === 0;
            const isNotSpace =
              isText && !isEmpty && !isSpaceChar(text?.slice(-1));
            const isBlock = hasClassName(prev, "mention-line-block");
            if (isNotSpace || isBlock) b.before(createSpace(1));
          }
          if (next) {
            const isNotSpace =
              next.nodeType === Node.TEXT_NODE &&
              !isSpaceChar(next.textContent?.slice(0, 1));
            const isBlock = hasClassName(next, "mention-line-block");
            if (isNotSpace || isBlock) b.after(createSpace(1));
          }
        });
      }
    }, []);

    const removeChar = useCallback((str: string, index: number) => {
      return str.length < index
        ? str
        : str.slice(0, index - 1) + str.slice(index);
    }, []);

    const removeAtCodeAndFixCaret = useCallback(
      (el: Node, offset: number) => {
        if (el.nodeType === Node.TEXT_NODE) {
          el.textContent = removeChar(el.textContent || "", offset);
          moveCursorTo(el, offset - 1);
        } else {
          moveCursorToElementEnd(el);
        }
      },
      [removeChar, moveCursorTo, moveCursorToElementEnd],
    );

    const transformMentionInputToText = useCallback((el: HTMLElement) => {
      if (!el) return null;
      const text = document.createTextNode(el.textContent || "");
      el.replaceWith(text);
      return text;
    }, []);

    const getPuretext = useCallback((node: Node): string => {
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
    }, []);

    const getEditorCursor = useCallback(() => {
      const c = getCursor();
      return c?.element && editorRef.current?.contains(c.element) ? c : null;
    }, [getCursor]);

    const getAliveLastCursor = useCallback(() => {
      const cursor = lastCursor;
      return cursor &&
        cursor.element &&
        editorRef.current?.contains(cursor.element)
        ? cursor
        : null;
    }, [lastCursor]);

    const findParentInEditorHasClass = useCallback(
      (el: Node | null, cls: string) => {
        return findParent(el, (n: any) => hasClassName(n, cls));
      },
      [],
    );

    const findMentionInputfromCursor = useCallback(
      (el?: Node | null) => {
        const element = el || getCursor()?.element;
        return findParentInEditorHasClass(
          element,
          "mention-input",
        ) as HTMLElement | null;
      },
      [getCursor, findParentInEditorHasClass],
    );

    const getCurrentMentionInput = useCallback(() => {
      return editorRef.current?.querySelector(
        ".mention-input",
      ) as HTMLElement | null;
    }, []);

    const findSkillInputfromCursor = useCallback(
      (el?: Node | null) => {
        const element = el || getCursor()?.element;
        return findParentInEditorHasClass(
          element,
          "skill-input",
        ) as HTMLElement | null;
      },
      [getCursor, findParentInEditorHasClass],
    );

    const getSkillInput = useCallback(() => {
      return editorRef.current?.querySelector(
        ".skill-input",
      ) as HTMLElement | null;
    }, []);

    const createMentionInput = useCallback(
      (placeholderText: string, code: string) => {
        const text = document.createTextNode(code);
        const span = document.createElement("span");
        span.appendChild(text);
        span.className = "mention-line-block mention-input empty";
        if (placeholderText) span.setAttribute("placeholder", placeholderText);
        return span;
      },
      [],
    );

    const createSkillInput = useCallback(
      (placeholderText: string, code: string) => {
        const text = document.createTextNode(code);
        const span = document.createElement("span");
        span.appendChild(text);
        span.className = "mention-line-block skill-input empty";
        if (placeholderText) span.setAttribute("placeholder", placeholderText);
        return span;
      },
      [],
    );

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
          if (editor) offsetBlock(editor);
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
          if (editor) offsetBlock(editor);
          return;
        }
        if (
          (element as HTMLElement).tagName === "BR" &&
          element === editor?.lastChild
        ) {
          element.before(node);
          if (editor) offsetBlock(editor);
          return;
        }
        if (element.nodeType === Node.TEXT_NODE && cursorPos !== undefined) {
          insertToTextNode(node, element as Text, cursorPos);
          if (editor) offsetBlock(editor);
        } else {
          element.after(node);
          if (editor) offsetBlock(editor);
        }
      },
      [getEditorCursor, insertToTextNode, offsetBlock],
    );

    const activeMentionInput = useCallback(
      (cursor?: any) => {
        if (getCurrentMentionInput()) return;
        const input = createMentionInput(atPlaceholder, atCode);
        insertNode(input, cursor);
        setTimeout(() => {
          moveCursorToElementEnd(input);
          setAtRect(input.getBoundingClientRect());
        }, 0);
        setCanShowSelect(true);
        // ✅ 懒加载：触发 @ 功能时才加载最近文件
        loadRecentlyFilesIfNeeded();
      },
      [
        atPlaceholder,
        atCode,
        createMentionInput,
        insertNode,
        moveCursorToElementEnd,
        getCurrentMentionInput,
        loadRecentlyFilesIfNeeded,
      ],
    );

    const activeSkillInput = useCallback(
      (cursor?: any) => {
        if (getSkillInput()) return;
        const input = createSkillInput(skillToolTip, skillCode);
        insertNode(input, cursor);
        setTimeout(() => {
          moveCursorToElementEnd(input);
          setAtRect(input.getBoundingClientRect());
        }, 0);
        setCanShowSkillSelect(true);
        setSearchKeyword("");
      },
      [
        skillToolTip,
        skillCode,
        createSkillInput,
        insertNode,
        moveCursorToElementEnd,
        getSkillInput,
      ],
    );

    const closeSkillSelect = useCallback(() => {
      setCanShowSkillSelect(false);
      setSkillSearchKeyword('');
    }, []);

    const closeSelectAndReset = useCallback((needClearQuery = true) => {
      if (needClearQuery) setQueryText("");
      setCanShowSelect(false);
    }, []);

    const togglePlaceHolder = useCallback(() => {
      const textContent = editorRef.current?.textContent?.trim();
      const skillText =
        editorRef.current?.querySelector(".skill-tag")?.textContent?.trim() ||
        "";
      const hasMentionBlock = editorRef.current?.querySelector(
        ".mention-line-block",
      );
      setIsShowPlaceholder(!textContent && !hasMentionBlock);
      setIsEmptyInput(!textContent?.replace(skillText, "").trim());
    }, []);

    const isEmptyEditor = useCallback(() => {
      const textContent = editorRef.current?.textContent?.trim();
      const hasMentionBlock = editorRef.current?.querySelector(
        ".mention-line-block",
      );
      return !textContent && !hasMentionBlock;
    }, []);

    const transformHtmlToData = useCallback(() => {
      if (!editorRef.current) return null;
      const clone = editorRef.current.cloneNode(true) as HTMLElement;
      const atList: any[] = [];
      const skillListData: string[] = [];
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
            const skillLabel = (child as HTMLElement).getAttribute(
              "data-skill",
            );
            if (skillLabel) skillListData.push(skillLabel);
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
        atList: createLinkInEditor
          ? atList
          : links.map((l) => ({
              id: l.id,
              name: l.name,
              icon: l.icon,
              upload_file_id: l.upload_file_id,
              file_size: l.file_size,
              file_mime: l.file_mime,
              library_id: l.library_id,
              isfolder: l.isfolder,
              islibrary: l.islibrary,
              isspace: l.isspace,
            })),
        skillList: skillListData,
        pureTextContent: pureText,
      };
    }, [createLinkInEditor, links, getPuretext]);

    const emitInputImmediately = useCallback(() => {
      const data = transformHtmlToData();
      if (data) {
        togglePlaceHolder();
        onInput?.(data);
      }
    }, [transformHtmlToData, togglePlaceHolder, onInput]);

    const removeInputingMention = useCallback((removeSpace = false) => {
      const input = editorRef.current?.querySelector(".mention-input");
      if (input) {
        input.remove();
      }
    }, []);

    const quitMentionInput = useCallback(
      (input?: HTMLElement, force = false) => {
        if (hasSelectAfterOpen || force) {
          const el =
            input || editorRef.current?.querySelector(".mention-input");
          if (el) el.remove();
          moveCursorToElementEnd(editorRef.current!);
        } else {
          const el =
            input || editorRef.current?.querySelector(".mention-input");
          if (el) {
            const text = document.createTextNode(el.textContent || "");
            el.replaceWith(text);
            moveCursorToElementEnd(text);
          }
          setIsComposing(false);
        }
        closeSelectAndReset();
      },
      [hasSelectAfterOpen, moveCursorToElementEnd, closeSelectAndReset],
    );

    const createSvgIcon = useCallback((name: string) => {
      const span = document.createElement("span");
      span.style.display = "inline-flex";
      span.style.alignItems = "center";
      span.style.justifyContent = "center";

      if (name === "common/at") {
        span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="1em" height="1em"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>`;
      } else if (name === "common/close-circle-fill") {
        span.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/></svg>`;
      }
      return span;
    }, []);

    const createMentionLinkElement = useCallback(
      (data: any) => {
        if (!data) return null;
        const a = document.createElement("a");
        a.setAttribute("data-json", JSON.stringify(data));

        const iconSpan = document.createElement("span");
        iconSpan.className = "svg-sprite-icon link-icon";
        iconSpan.appendChild(createSvgIcon("common/at"));

        const textSpan = document.createElement("span");
        textSpan.className = "text";
        textSpan.textContent = data.name;

        const closeSpan = document.createElement("span");
        closeSpan.className = "svg-sprite-icon close-icon";
        closeSpan.appendChild(createSvgIcon("common/close-circle-fill"));

        a.appendChild(iconSpan);
        a.appendChild(textSpan);
        a.appendChild(closeSpan);

        a.setAttribute("target", "_blank");
        a.setAttribute("href", "");
        a.setAttribute("contenteditable", "false");
        a.className = "mention-link mention-line-block";

        return a;
      },
      [createSvgIcon],
    );

    const createSkillTag = useCallback(
      (skill: SkillItem) => {
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
          onRemoveSkill?.();
          emitInputImmediately();
        };

        span.appendChild(textSpan);
        span.appendChild(closeSpan);

        return span;
      },
      [emitInputImmediately, onRemoveSkill],
    );

    const scrollTextareaToBottom = useCallback(() => {
      if (mentionWrapperRef.current)
        mentionWrapperRef.current.scrollTop =
          mentionWrapperRef.current.scrollHeight;
    }, []);

    const toggleOutSideLink = useCallback((collapsed: boolean) => {
      setMentionLinkModel((prev) => ({ ...prev, collapsed }));
    }, []);

    const removeOutsideLastLinkActiveStatus = useCallback(() => {
      if (links.length <= 0) return;
      const last = links[links.length - 1];
      if (last.ui?.active) {
        last.ui.active = false;
        setMentionLinkModel((prev) => ({ ...prev }));
      }
    }, [links]);

    const removeOutsideLastLink = useCallback(() => {
      if (links.length <= 0) return;
      setMentionLinkModel((prev) => ({ ...prev, collapsed: false }));
      const lastLink = links[links.length - 1];
      if (!lastLink.ui?.active) {
        lastLink.ui = { ...lastLink.ui, active: true };
        setMentionLinkModel((prev) => ({ ...prev }));
        return;
      }
      setMentionLinkModel((prev) => ({
        ...prev,
        links: prev.links.slice(0, -1),
      }));
      setTimeout(() => {
        setMentionLinkModel((prev) => {
          if (prev.links.length <= 0) return prev;
          const newLinks = [...prev.links];
          const newLast = newLinks[newLinks.length - 1];
          if (newLast) {
            newLast.ui = { ...newLast.ui, active: true };
          }
          return { ...prev, links: newLinks };
        });
      }, 0);
    }, [links]);

    const debouncedRemoveOutsideLastLink = useDebounceFn(
      removeOutsideLastLink,
      30,
    );

    const addLink = useCallback(
      async (data: any) => {
        setHasSelectAfterOpen(true);
        if (createLinkInEditor) {
          const input = getCurrentMentionInput();
          const link = createMentionLinkElement(data);
          if (!link) return;
          const space = createSpace(1);
          if (input) {
            input.replaceWith(link);
            link.after(space);
            moveCursorToElementEnd(space);
          }
          emitInputImmediately();
          return;
        }
        toggleOutSideLink(false);
        if (links.length >= maxAt) {
          message.warning(`最多指定${maxAt}个文件`);
        } else {
          setMentionLinkModel((prev) => ({
            ...prev,
            links: [
              ...prev.links,
              {
                id: data.id,
                name: data.name,
                icon: data.icon,
                ui: { active: true },
                upload_file_id: data.upload_file_id,
                file_size: data.upload_file?.size || 0,
                file_mime: data.upload_file?.mime_type || data.file_mime,
                library_id: data.library_id,
                isfolder: data.isfolder,
              },
            ],
          }));
          setTimeout(() => scrollTextareaToBottom(), 0);
          emitInputImmediately();
        }
      },
      [
        createLinkInEditor,
        createMentionLinkElement,
        maxAt,
        getCurrentMentionInput,
        moveCursorToElementEnd,
        emitInputImmediately,
        links,
        scrollTextareaToBottom,
        toggleOutSideLink,
      ],
    );

    const isComposingRigorous = useCallback(() => {
      const timeDiff = Date.now() - composingEndTime;
      const isSafari =
        /Safari/.test(navigator.userAgent) &&
        !/Chrome/.test(navigator.userAgent);
      return isSafari ? isComposing || timeDiff < 20 : isComposing;
    }, [isComposing, composingEndTime]);

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
          moveCursorToElementEnd(editorRef.current!);
          setLastCursor(null);
        }
      },
      [
        isComposingRigorous,
        getCurrentMentionInput,
        createLinkInEditor,
        links,
        addLink,
        isMobile,
        removeInputingMention,
        moveCursorToElementEnd,
      ],
    );

    const resetMentionRect = useCallback(
      (el: HTMLElement | null) => {
        if (isMobile || !el?.getBoundingClientRect) return;
        const rect = el.getBoundingClientRect();
        setAtRect(rect);
      },
      [isMobile],
    );

    const scrollToSelectedItem = useCallback(() => {
      if (selectedIndex < 0) return;
      setTimeout(() => {
        const dropdown = document.querySelector(".mention-dropdown-list");
        if (!dropdown) return;
        const items = dropdown.querySelectorAll(".mention-dropdown-item");
        const selectedItem = items[selectedIndex] as HTMLElement;
        if (selectedItem) {
          selectedItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }, 0);
    }, [selectedIndex]);

    const doIfRmoveMentionInput = useCallback(
      (el: HTMLElement) => {
        if (hasClassName(el, "mention-input")) closeSelectAndReset();
        if (hasClassName(el, "skill-input")) closeSkillSelect();
      },
      [closeSelectAndReset, closeSkillSelect],
    );

    const doIfHasNoMentionInput = useCallback(() => {
      const mentionInput = editorRef.current?.querySelector(".mention-input") as HTMLElement | null;
      const skillInput = editorRef.current?.querySelector(".skill-input") as HTMLElement | null;

      // 检查 mention-input 是否有效（内容以 @ 开头）
      if (mentionInput) {
        const text = mentionInput.textContent || "";
        if (!text.startsWith(atCode)) {
          // 内容不再以 @ 开头，转换为普通文字节点
          const textNode = document.createTextNode(text);
          mentionInput.replaceWith(textNode);
          closeSelectAndReset();
        }
      } else {
        closeSelectAndReset();
      }

      // 检查 skill-input 是否有效（内容以 / 开头）
      if (skillInput) {
        const text = skillInput.textContent || "";
        if (!text.startsWith(skillCode)) {
          const textNode = document.createTextNode(text);
          skillInput.replaceWith(textNode);
          closeSkillSelect();
        }
      } else {
        closeSkillSelect();
      }
    }, [closeSelectAndReset, closeSkillSelect, atCode, skillCode]);

    const checkAndRemoveOnlySpace = useCallback(
      (forceClear = false) => {
        if (isEmptyEditor()) {
          if (forceClear) {
            if (editorRef.current) editorRef.current.innerHTML = "";
          } else {
            if (editorRef.current)
              editorRef.current.innerHTML = isMobile ? "<br />" : "";
          }
          togglePlaceHolder();
        }
      },
      [isEmptyEditor, isMobile, togglePlaceHolder],
    );

    const onKeydownBackspaceInPC = useCallback(
      (e: KeyboardEvent, cursor: any) => {
        const { element } = cursor;
        if (!element) return;
        const prev = element.previousSibling;
        if (hasClassName(prev as HTMLElement, "mention-line-block")) {
          // In simple mode, we just let default backspace delete it or we handle it
        }
      },
      [],
    );

    const onKeydownArrowX = useCallback(
      (e: KeyboardEvent, cursor: any) => {
        const { element, cursorPos } = cursor;
        const input = findMentionInputfromCursor(element);
        if (input) {
          if (e.key === "ArrowLeft" && cursorPos <= 1) {
            e.preventDefault();
          }
        }
      },
      [findMentionInputfromCursor],
    );

    // Event handlers
    const onKeydown = useCallback(
      (evt: React.KeyboardEvent<HTMLDivElement>) => {
        const cursor = getCursor();
        if (!cursor) return;
        const { element } = cursor;
        const mentionInput = findMentionInputfromCursor(element);

        setLastCursor(cursor);
        isBackspaceRef.current = evt.key === "Backspace";

        // Handle dropdown keyboard navigation
        if (canShowSelect && mentionInput) {
          const items =
            activeTab === "knowledge" ? filteredKnowledge : filteredSkillList;
          if (evt.key === "ArrowDown") {
            evt.preventDefault();
            setSelectedIndex((prev) =>
              prev < items.length - 1 ? prev + 1 : 0,
            );
            scrollToSelectedItem();
            return;
          }
          if (evt.key === "ArrowUp") {
            evt.preventDefault();
            setSelectedIndex((prev) =>
              prev > 0 ? prev - 1 : items.length - 1,
            );
            scrollToSelectedItem();
            return;
          }
          if (evt.key === "Enter" && !evt.shiftKey) {
            evt.preventDefault();
            if (selectedIndex >= 0 && selectedIndex < items.length) {
              const selectedItem = items[selectedIndex];
              if (selectedItem) {
                if (activeTab === "knowledge") {
                  onSingleSelected(selectedItem);
                } else {
                  handleSelectSkill(selectedItem as SkillItem);
                }
                setCanShowSelect(false);
              }
            }
            return;
          }
        }

        if (evt.key !== "Backspace") {
          removeOutsideLastLinkActiveStatus();
          if (evt.key === "Enter" && !evt.shiftKey) {
            if (isComposingRigorous()) return;
            if (canShowSelect && mentionInput) {
              evt.preventDefault();
              return;
            }
            if (!canShowSelect) {
              evt.preventDefault();
              post();
              return;
            }
          }
          if (evt.key === "Escape" && mentionInput) {
            closeSelectAndReset();
            return;
          }
          if (
            (evt.key === "ArrowLeft" || evt.key === "ArrowRight") &&
            mentionInput
          ) {
            onKeydownArrowX(evt.nativeEvent, cursor);
          }
        } else {
          // Backspace handling
          const { element: el } = cursor;
          if (
            el &&
            isSpaceChar(el.textContent) &&
            hasClassName(
              el.previousSibling as HTMLElement,
              "mention-line-block",
            )
          ) {
            const prev = el.previousSibling as HTMLElement;
            prev?.remove();
            doIfRmoveMentionInput(prev);
          }
          if (hasClassName(el as HTMLElement, "mention-link")) {
            (el as HTMLElement).remove();
            evt.preventDefault();
          }
          onKeydownBackspaceInPC(evt.nativeEvent, cursor);
        }
      },
      [
        getCursor,
        findMentionInputfromCursor,
        canShowSelect,
        filteredKnowledge,
        filteredSkillList,
        activeTab,
        selectedIndex,
        onSingleSelected,
        links,
        isComposingRigorous,
        closeSelectAndReset,
        onKeydownArrowX,
        doIfRmoveMentionInput,
        onKeydownBackspaceInPC,
        scrollToSelectedItem,
        removeOutsideLastLinkActiveStatus,
      ],
    );

    const handleEditorInput = useCallback(() => {
      // 清理残留的样式标签（浏览器可能在删除 mention-input 后保留样式）
      const editor = editorRef.current;
      let needNormalize = false;

      if (editor) {
        // 检查是否有残留的蓝色字体标签
        const fontTags = editor.querySelectorAll('font[color="#2563eb"]');
        if (fontTags.length > 0) needNormalize = true;
        fontTags.forEach((font) => {
          const text = document.createTextNode(font.textContent || "");
          font.replaceWith(text);
        });

        // 检查是否有残留的灰色背景 span（不是 mention-input）
        const spans = editor.querySelectorAll('span[style*="background-color"]');
        let hasInvalidSpan = false;
        spans.forEach((span) => {
          if (!span.classList.contains('mention-line-block') &&
              !span.classList.contains('mention-input') &&
              !span.classList.contains('skill-input') &&
              !span.classList.contains('mention-link') &&
              !span.classList.contains('skill-tag')) {
            hasInvalidSpan = true;
            const text = document.createTextNode(span.textContent || "");
            span.replaceWith(text);
          }
        });
        if (hasInvalidSpan) needNormalize = true;

        // 如果清理过样式标签，需要规范化文本并移动光标到末尾
        if (needNormalize) {
          editor.normalize(); // 合并相邻的文本节点
          // 将光标移动到编辑器末尾
          const range = document.createRange();
          const sel = document.getSelection();
          if (editor.lastChild) {
            range.setStartAfter(editor.lastChild);
            range.setEndAfter(editor.lastChild);
          } else {
            range.setStart(editor, 0);
            range.setEnd(editor, 0);
          }
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }

      // 首先检查并处理空的 mention-input/skill-input（必须在 cursor 检查之前）
      doIfHasNoMentionInput();

      const cursor = getCursor();
      if (!cursor || !cursor.element) return;

      setTimeout(() => emitInputImmediately(), 100);

      const { element } = cursor;
      if (findMentionInputfromCursor(element)) {
        const input = findMentionInputfromCursor(element);
        if (input) resetMentionRect(input);
        setCanShowSelect(true);
        const text = element.textContent || "";
        const q = text.startsWith(atCode) ? text.slice(1) : text;
        setQueryText(q);
        setSearchKeyword(q);
        return;
      }

      // 如果用户输入普通文字，检查光标后面是否有技能标签，如果有则删除
      if (!isBackspaceRef.current) {
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
          const parentNext = (element as HTMLElement).parentElement
            ?.nextSibling;
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
      if (
        isAt &&
        (showAt ? !disabledAt : false) &&
        !hasInput &&
        !isBackspaceRef.current
      ) {
        // 如果存在 skill-input，先删除它
        if (hasSkillInput) {
          const skillInputEl = editorRef.current?.querySelector('.skill-input');
          if (skillInputEl) skillInputEl.remove();
          closeSkillSelect();
        }
        removeAtCodeAndFixCaret(element, cursor.cursorPos);
        activeMentionInput();
      }
      // 检测 / 触发技能选择弹窗
      if (
        isSkillTrigger &&
        showSkill &&
        !hasSkillInput &&
        !isBackspaceRef.current
      ) {
        // 如果存在 mention-input，先删除它
        if (hasInput) {
          const mentionInputEl = editorRef.current?.querySelector('.mention-input');
          if (mentionInputEl) mentionInputEl.remove();
          closeSelectAndReset();
        }
        removeAtCodeAndFixCaret(element, cursor.cursorPos);
        activeSkillInput();
      }
      togglePlaceHolder();
    }, [
      getCursor,
      doIfHasNoMentionInput,
      emitInputImmediately,
      findMentionInputfromCursor,
      resetMentionRect,
      atCode,
      skillCode,
      showAt,
      showSkill,
      disabledAt,
      getCurrentMentionInput,
      getSkillInput,
      activeMentionInput,
      activeSkillInput,
      togglePlaceHolder,
      removeAtCodeAndFixCaret,
      onRemoveSkill,
      moveCursorToElementEnd,
      closeSelectAndReset,
    ]);

    const onLinkCloseButtonClicked = useCallback(
      (e: MouseEvent, el: HTMLElement) => {
        e.preventDefault();
        e.stopPropagation();
        el.remove();
        emitInputImmediately();
      },
      [emitInputImmediately],
    );

    const onClick = useCallback(
      (evt: React.MouseEvent<HTMLDivElement>) => {
        setLastCursor(getEditorCursor());
        const target = evt.target as HTMLElement;
        if (!target) return;
        const mentionInput = findMentionInputfromCursor(target);
        const skillInput = findSkillInputfromCursor(target);
        const closeIcon = findParentInEditorHasClass(target, "close-icon");

        if (!isMobile && closeIcon) {
          const link = findParentInEditorHasClass(target, "mention-link");
          if (link)
            onLinkCloseButtonClicked(evt.nativeEvent, link as HTMLElement);
        }

        setCanShowSelect(!!mentionInput);

        // 处理点击 skill-input：打开技能弹窗
        if (skillInput && showSkill) {
          setCanShowSkillSelect(true);
          setSearchKeyword("");
          setTimeout(() => moveCursorToElementEnd(editorRef.current!), 0);
        }

        if (getCurrentMentionInput() && !createLinkInEditor && !mentionInput) {
          quitMentionInput();
          emitInputImmediately();
        } else if (mentionInput) {
          setTimeout(() => moveCursorToElementEnd(editorRef.current!), 0);
        }
        togglePlaceHolder();
      },
      [
        getEditorCursor,
        findMentionInputfromCursor,
        findSkillInputfromCursor,
        findParentInEditorHasClass,
        isMobile,
        showSkill,
        onLinkCloseButtonClicked,
        setCanShowSelect,
        getCurrentMentionInput,
        createLinkInEditor,
        quitMentionInput,
        emitInputImmediately,
        moveCursorToElementEnd,
        togglePlaceHolder,
      ],
    );

    const onCompositionstart = useCallback(() => {
      setIsComposing(true);
    }, []);

    const onCompositionend = useCallback(() => {
      setIsComposing(false);
      setComposingEndTime(Date.now());
      emitInputImmediately();
    }, [emitInputImmediately]);

    const onPaste = useCallback(
      (evt: React.ClipboardEvent<HTMLDivElement>) => {
        evt.preventDefault();
        const clipboardData =
          evt.clipboardData || (window as any).clipboardData;
        const text = clipboardData?.getData("text/plain") || "";
        const cleanText = findMentionInputfromCursor()
          ? text.replace(/\n/gi, "")
          : text;
        insertText(cleanText);
      },
      [findMentionInputfromCursor],
    );

    const onBlur = useCallback(async () => {
      if (editorRef.current && canBlur) {
        emitInputImmediately();
        checkAndRemoveOnlySpace();
      }
      onMBlur?.();
    }, [canBlur, emitInputImmediately, checkAndRemoveOnlySpace, onMBlur]);

    const onFocus = useCallback(() => {
      onMFocus?.();
    }, [onMFocus]);

    // Public methods
    const insertText = useCallback(
      (text: string) => {
        if (!text?.length) return;
        const textNode = document.createTextNode(text);
        insertNode(textNode);
        moveCursorToElementEnd(textNode);
        emitInputImmediately();
      },
      [insertNode, moveCursorToElementEnd, emitInputImmediately],
    );

    const post = useCallback(async () => {
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
            id: f.id,
            name: f.name,
            size: f.size,
            mime_type: f.mime_type,
            preview_key: f.preview_key,
          }));

        onSend?.({
          ...data,
          files: uploadedFiles,
        });

        if (editorRef.current) editorRef.current.innerHTML = "";
        setUploadFileList([]);
        togglePlaceHolder();
        emitInputImmediately();
      } else {
        message.info("请输入你想询问的问题");
      }
    }, [
      transformHtmlToData,
      onSend,
      togglePlaceHolder,
      emitInputImmediately,
      uploadFileList,
      allowSendWithFiles,
    ]);

    const forceFocus = useCallback(
      (moveEnd = false) => {
        if (!editorRef.current) return;
        editorRef.current.focus();
        if (moveEnd) moveCursorToElementEnd(editorRef.current);

        if (needFixPositonWhenFocus && mentionWrapperRef.current) {
          const { scrollTop } = mentionWrapperRef.current;
          setTimeout(() => {
            if (mentionWrapperRef.current)
              mentionWrapperRef.current.scrollTop = scrollTop;
          }, 200);
        }
      },
      [moveCursorToElementEnd, needFixPositonWhenFocus],
    );

    const clear = useCallback(() => {
      if (editorRef.current) editorRef.current.innerHTML = "";
      setMentionLinkModel({ links: [], collapsed: false });
      togglePlaceHolder();
      emitInputImmediately();
    }, [togglePlaceHolder, emitInputImmediately]);

    const clearLinks = useCallback(() => {
      setMentionLinkModel({ links: [], collapsed: false });
      quitMentionInput();
      togglePlaceHolder();
      emitInputImmediately();
    }, [quitMentionInput, togglePlaceHolder, emitInputImmediately]);

    const setLinks = useCallback(
      (newLinks: LinkItem[]) => {
        setMentionLinkModel({ links: newLinks, collapsed: false });
        togglePlaceHolder();
        emitInputImmediately();
      },
      [togglePlaceHolder, emitInputImmediately]
    );

    const clearEditorOnly = useCallback(() => {
      if (editorRef.current) editorRef.current.innerHTML = "";
      togglePlaceHolder();
      emitInputImmediately();
    }, [togglePlaceHolder, emitInputImmediately]);

    const setPrompt = useCallback(
      (text: string) => {
        if (editorRef.current) {
          editorRef.current.innerHTML = "";
          if (text) {
            insertText(text);
          }
          togglePlaceHolder();
        }
      },
      [insertText, togglePlaceHolder],
    );

    const clearUploadFiles = useCallback(() => {
      setUploadFileList([]);
    }, []);

    const insertSkill = useCallback(
      (skill: SkillItem) => {
        const existingSkill = editorRef.current?.querySelector(
          `.skill-tag[data-skill="${skill.label}"]`,
        );
        if (existingSkill) return;

        const skillTag = createSkillTag(skill);

        if (editorRef.current) {
          editorRef.current.prepend(skillTag);
          moveCursorToElementEnd(editorRef.current);
          togglePlaceHolder();
          emitInputImmediately();
          // 注意：不要在这里调用 onSelectSkill，否则会导致循环调用
          // onSelectSkill 只用于用户从 mention 弹窗选择技能时触发
        }
      },
      [createSkillTag, moveCursorToElementEnd, togglePlaceHolder, emitInputImmediately],
    );

    const clearSkillTags = useCallback(() => {
      if (editorRef.current) {
        const skillTags = editorRef.current.querySelectorAll(".skill-tag");
        skillTags.forEach((tag) => tag.remove());
        togglePlaceHolder();
        emitInputImmediately();
      }
    }, [togglePlaceHolder, emitInputImmediately]);

    // Expose methods
    useImperativeHandle(
      ref,
      () => ({
        insertText,
        post,
        forceFocus,
        clear,
        clearLinks,
        setLinks,
        setPrompt,
        clearEditorOnly,
        clearUploadFiles,
        insertSkill,
        clearSkillTags,
      }),
      [
        insertText,
        post,
        forceFocus,
        clear,
        clearLinks,
        setLinks,
        setPrompt,
        clearEditorOnly,
        clearUploadFiles,
        insertSkill,
        clearSkillTags,
      ],
    );

    // Event handlers for UI
    const triggerMention = useCallback(
      async (e?: React.MouseEvent) => {
        e?.preventDefault();
        await new Promise((resolve) => setTimeout(resolve, 30));
        afterCalloutMentionInput?.();

        const cursor = getAliveLastCursor();
        activeMentionInput(cursor);
        togglePlaceHolder();
      },
      [
        afterCalloutMentionInput,
        getAliveLastCursor,
        activeMentionInput,
        togglePlaceHolder,
      ],
    );

    const handleSelectDoc = useCallback(
      (item: DocItem) => {
        onSingleSelected(item);
        setCanShowSelect(false);
      },
      [onSingleSelected],
    );

    const handleSelectSkill = useCallback(
      (skill: SkillItem) => {
        const existingSkills =
          editorRef.current?.querySelectorAll(".skill-tag");
        existingSkills?.forEach((tag) => tag.remove());

        // 删除 mention-input 和 skill-input 元素
        const mentionInput = editorRef.current?.querySelector(
          ".mention-input",
        ) as HTMLElement;
        if (mentionInput) {
          mentionInput.remove();
        }

        const skillInput = editorRef.current?.querySelector(
          ".skill-input",
        ) as HTMLElement;
        if (skillInput) {
          skillInput.remove();
        }

        const skillTag = createSkillTag(skill);

        editorRef.current?.prepend(skillTag);
        moveCursorToElementEnd(skillTag);

        onSelectSkill?.(skill);
        closeSelectAndReset();
        closeSkillSelect();
        emitInputImmediately();
      },
      [
        createSkillTag,
        moveCursorToElementEnd,
        onSelectSkill,
        closeSelectAndReset,
        closeSkillSelect,
        emitInputImmediately,
      ],
    );

    // 清理输入元素和关闭下拉框
    const cleanupInputElements = useCallback(() => {
      // 删除 mention-input
      const mentionInput = editorRef.current?.querySelector('.mention-input');
      if (mentionInput) mentionInput.remove();
      // 删除 skill-input
      const skillInput = editorRef.current?.querySelector('.skill-input');
      if (skillInput) skillInput.remove();
      closeSelectAndReset();
      closeSkillSelect();
    }, [closeSelectAndReset, closeSkillSelect]);

    const handleOpenLibrary = useCallback(() => {
      cleanupInputElements();
      // 只传入知识库来源的文件作为默认选中
      const knowledgeLinks = links.filter((l) => l.source === 'knowledge' && !l.islibrary && !l.isspace).map((l) => ({
        id: l.id,
        name: l.name,
        icon: l.icon || "",
        iconText: "",
      }));
      const selectedLibraries = links.filter((l) => l.source === 'knowledge' && l.islibrary).map((l) => ({
        id: l.id,
        name: l.name,
        icon: l.icon || "",
      }));
      const selectedSpaces = links.filter((l) => l.source === 'knowledge' && l.isspace).map((l) => ({
        id: l.id,
        name: l.name,
        icon: l.icon || "",
      }));
      spaceDialogRef.current?.open(knowledgeLinks, selectedLibraries, undefined, selectedSpaces);
    }, [links, cleanupInputElements]);

    // 切换技能下拉框显示
    const skillButtonRef = useRef<any>(null);
    const toggleSkillSelect = useCallback(() => {
      if (canShowSkillSelect) {
        closeSkillSelect();
        return;
      }
      // 关闭知识选择下拉框
      setCanShowSelect(false);

      // 如果没有 skill-input 元素，创建一个（与输入 / 行为一致）
      if (!editorRef.current?.querySelector('.skill-input')) {
        editorRef.current?.focus();
        activeSkillInput();
      } else {
        // 已有 skill-input，加载技能列表并显示弹窗
        skillsStore.loadMySkillList();
        setSkillSearchKeyword('');
        setCanShowSkillSelect(true);
      }
    }, [canShowSkillSelect, closeSkillSelect, activeSkillInput, skillsStore]);

    // 从下拉框选择技能
    const handleSelectSkillFromDropdown = useCallback(
      (skill: any) => {
        // 删除 skill-input 元素
        const skillInput = editorRef.current?.querySelector('.skill-input');
        if (skillInput) {
          skillInput.remove();
        }
        handleSelectSkill({
          label: skill.display_name,
          img: skill.icon || 'skill',
        });
        closeSkillSelect();
      },
      [handleSelectSkill, closeSkillSelect],
    );

    // 去技能库添加
    const handleGoToSkillLibrary = useCallback(() => {
      closeSkillSelect();
      onOpenSkillLibrary?.();
    }, [closeSkillSelect, onOpenSkillLibrary]);

    const handleSelectFiles = useCallback(
      (files: DocItem[], libraries: LibraryItem[], spaces?: SpaceItem[]) => {
        // 构建新的 links 数组，添加 source 标识
        const newLinks = files.map((file) => ({
          id: file.id,
          name: file.name,
          icon: file.icon,
          ui: { active: true },
          upload_file_id: file.upload_file_id,
          file_size: file.upload_file?.size || 0,
          file_mime: file.upload_file?.mime_type || file.file_mime,
          library_id: file.library_id,
          isfolder: file.isfolder,
          source: 'knowledge', // 知识库来源
        }));
        const newLibraries = libraries.map((lib) => ({
          id: lib.id,
          name: lib.name,
          icon: lib.icon,
          islibrary: true,
          source: 'knowledge', // 知识库来源
        }));
        const newSpaces = (spaces || []).map((space) => ({
          id: space.id,
          name: space.name,
          icon: space.icon,
          isspace: true,
          source: 'knowledge', // 知识库来源
        }));
        // 替换同 source 类型的文件，保留其他 source 的文件
        setMentionLinkModel((prev) => {
          const otherLinks = prev.links.filter((l) => l.source !== 'knowledge');
          return { ...prev, links: [...otherLinks, ...newLinks, ...newLibraries, ...newSpaces], collapsed: false };
        });
        setHasSelectAfterOpen(true);

        // 通知父组件选择变化
        onSelectFiles?.(files, libraries, spaces);
      },
      [onSelectFiles],
    );

    // 将选中的文件转换为 links 格式（添加 source 标识）
    const convertFilesToLinks = useCallback((files: any[], source: string) => {
      return files.map((file) => ({
        id: file.id,
        name: file.name,
        icon: file.icon,
        ui: { active: true },
        upload_file_id: file.rawData?.upload_file_id,
        file_size: file.rawData?.upload_file?.size || 0,
        file_mime: file.rawData?.upload_file?.mime_type,
        library_id: file.rawData?.library_id,
        isfolder: file.isfolder,
        path: file.path || '',
        rawData: file.rawData,
        source, // 添加来源标识
      }));
    }, []);

    // 打开弹窗的通用方法（传入当前 source 类型的文件）
    const openMyFilesDialog = useCallback((dialogRef: React.RefObject<MyFilesDialogRef | null>, source: string) => {
      cleanupInputElements();
      // 只传入同 source 类型的已选文件
      const sourceFiles = links.filter((l) => l.source === source).map((l) => ({
        id: l.id,
        name: l.name,
        icon: l.icon || '',
        path: l.path || '',
        isfolder: l.isfolder || false,
        rawData: l.rawData,
      }));
      dialogRef.current?.open(sourceFiles);
    }, [cleanupInputElements, links]);

    // 选择文件确认的通用方法（根据 source 替换同类型文件）
    const handleSelectMyFiles = useCallback((files: any[], source: string) => {
      const newLinks = convertFilesToLinks(files, source);
      // 替换同 source 类型的文件，保留其他 source 的文件
      setMentionLinkModel((prev) => {
        const otherLinks = prev.links.filter((l) => l.source !== source);
        return { ...prev, links: [...otherLinks, ...newLinks], collapsed: false };
      });
      setHasSelectAfterOpen(true);
    }, [convertFilesToLinks]);

    const handleOpenUploadedDialog = useCallback(() => {
      openMyFilesDialog(uploadedDialogRef, 'uploads');
    }, [openMyFilesDialog]);

    const handleOpenAIGeneratedDialog = useCallback(() => {
      openMyFilesDialog(aiGeneratedDialogRef, 'ai-generated');
    }, [openMyFilesDialog]);

    const handleOpenRecordingsDialog = useCallback(() => {
      openMyFilesDialog(recordingsDialogRef, 'recordings');
    }, [openMyFilesDialog]);

    const handleSelectFromUploaded = useCallback((files: any[]) => {
      handleSelectMyFiles(files, 'uploads');
    }, [handleSelectMyFiles]);
    const handleSelectFromAIGenerated = useCallback((files: any[]) => {
      handleSelectMyFiles(files, 'ai-generated');
    }, [handleSelectMyFiles]);
    const handleSelectFromRecordings = useCallback((files: any[]) => {
      handleSelectMyFiles(files, 'recordings');
    }, [handleSelectMyFiles]);

    const handleRemoveLink = useCallback((link: LinkItem) => {
      setMentionLinkModel((prev) => ({
        ...prev,
        links: prev.links.filter((l) => {
          if (l.id !== link.id) return true;
          const lType = l.isspace ? 'space' : (l.islibrary ? 'library' : 'file');
          const linkType = (link as any).isspace ? 'space' : (link.islibrary ? 'library' : 'file');
          return lType !== linkType;
        }),
      }));
      onRemoveLink?.(link);
    }, [onRemoveLink]);

    const handleStop = useCallback(() => {
      onStop?.();
    }, [onStop]);

    const handleSend = useCallback(() => {
      if (!canSend) return;
      post();
    }, [canSend, post]);

    const handleCloseKnowledge = useCallback(() => {
      setCanShowSelect(false);
      setQueryText("");
      setSearchKeyword("");
      closeSelectAndReset();
      setLastCursor(null);
      setAtRect(null);
      togglePlaceHolder();
      setCanShowSelect(false);
      scrollTextareaToBottom();
    }, [closeSelectAndReset, togglePlaceHolder, scrollTextareaToBottom]);

    // 文件上传处理
    const handleUploadAttachment = useCallback(() => {
      fileInputRef.current?.click();
    }, []);

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
                        ...f,
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

    const removeUploadFile = useCallback(
      (index: number) => {
        setUploadFileList((prev) => prev.filter((_, i) => i !== index));
        onFileChange?.(uploadFileList.filter((_, i) => i !== index));
      },
      [onFileChange, uploadFileList],
    );

    // editMutationObserver
    const editMutationObserver = useCallback(
      (el: HTMLElement | null) => {
        if (!el) return;
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((m) => {
            if (m.type === "characterData") {
              const target = findParentInEditorHasClass(
                m.target,
                "mention-input",
              ) as HTMLElement | null;
              if (target) {
                if (target.textContent?.trim() === atCode)
                  target.classList.add("empty");
                else target.classList.remove("empty");
              }
            }
          });
          togglePlaceHolder();
        });
        observer.observe(el, {
          childList: true,
          subtree: true,
          characterData: true,
        });
        return () => observer.disconnect();
      },
      [findParentInEditorHasClass, atCode, togglePlaceHolder],
    );

    // Initialize
    useEffect(() => {
      let cleanup: (() => void) | undefined;
      if (editorRef.current) {
        cleanup = editMutationObserver(editorRef.current);
      }
      setIsShowPlaceholder(true);
      setIsEmptyInput(true);
      togglePlaceHolder();
      return cleanup;
    }, [editMutationObserver, togglePlaceHolder]);

    // ✅ 注释掉：改为懒加载，在用户触发 @ 功能时才加载
    // Load recently files on mount
    // useEffect(() => {
    //   if (showAt) {
    //     loadRecentlyFiles();
    //   }
    // }, [showAt, loadRecentlyFiles]);

    // Click outside handler
    useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        if (
          mentionWrapperRef.current &&
          !mentionWrapperRef.current.contains(e.target as Node)
        ) {
          if (canShowSelect) {
            closeSelectAndReset();
          }
          if (canShowSkillSelect) {
            closeSkillSelect();
          }
        }
      };
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }, [canShowSelect, canShowSkillSelect, closeSelectAndReset, closeSkillSelect]);

    // Watch canShowSelect to reset selectedIndex
    useEffect(() => {
      if (canShowSelect) {
        setSelectedIndex(-1);
      }
    }, [canShowSelect]);

    // Watch queryText/searchKeyword to reset selectedIndex and trigger search
    useEffect(() => {
      setSelectedIndex(-1);
    }, [queryText]);

    // enhancedMention 模式下只搜索知识
    useEffect(() => {
      searchKnowledge(searchKeyword);
    }, [searchKeyword, searchKnowledge]);

    // Watch links to emit input
    useEffect(() => {
      const timeoutId = setTimeout(() => {
        emitInputImmediately();
      }, 100);
      return () => clearTimeout(timeoutId);
    }, [links, emitInputImmediately]);

    // Check knowledge base version
    useEffect(() => {
      if (!checkVersion(VERSION_MODULE.KNOWLEDGE_BASE)) {
        setActiveTab("skill");
      }
    }, []);

    return (
      <div className={className} ref={senderRef}>
        {/* 已上传文件列表 */}
        {uploadFileList.length > 0 && enableUpload && (
          <div className="flex flex-wrap gap-2 mb-2">
            {uploadFileList.map((file, index) => (
              <div
                key={index}
                className="max-w-40 h-7 px-2 rounded-lg cursor-pointer text-[#4F5052] bg-[#F8F9FA] hover:bg-[#E1E2E3] inline-flex items-center gap-1 relative group"
              >
                <FileOutlined style={{ fontSize: 14 }} />
                <p className="text-sm truncate">{file.name}</p>
                <div
                  className="absolute -top-1 -right-1 size-4 border rounded-full bg-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeUploadFile(index);
                  }}
                >
                  <CloseOutlined style={{ fontSize: 12, color: "#B8B8B8" }} />
                </div>
              </div>
            ))}
          </div>
        )}
        <div
          className="relative rounded-lg border border-[#E3E8FF] bg-white px-3 py-3 shadow-lg"
        >
          {/* 隐藏的文件输入框 */}
          <input
            ref={fileInputRef}
            type="file"
            multiple={allowMultiple}
            className="hidden"
            accept={acceptTypes}
            onChange={handleFileChange}
          />

          {/* Links display */}
          {links.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap overflow-x-auto overflow-y-hidden mb-1.5">
              {links.map((link) => (
                <div
                  key={link.id}
                  className="h-6 max-w-[200px] overflow-hidden px-1.5 rounded bg-[#F3F3F5] flex items-center text-sm text-[#6B6C70] group cursor-pointer relative"
                >
                  <div className="flex-none size-4 rounded mr-1">
                    <img src={link.icon} className="size-4" alt="" />
                  </div>
                  <OverflowTooltip>
                    <span className="truncate">{link.name}</span>
                  </OverflowTooltip>
                  <div
                    className="group-hover:flex hidden absolute top-1/2 right-0 -translate-y-1/2 size-4 border rounded-full bg-white items-center justify-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveLink(link);
                    }}
                  >
                    <CloseOutlined style={{ fontSize: 10, color: "#B8B8B8" }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Header slot */}
          {header}

          {/* Editor */}
          <div ref={mentionWrapperRef} className="flex gap-1">
            {/* inputBefore slot */}
            {inputBefore}

            <div className="flex-1 relative">
              <div
                ref={editorRef}
                role="textbox"
                aria-disabled={disabled || loading}
                contentEditable={!disabled && !loading}
                className="overflow-y-auto text-sm leading-relaxed text-[#1F1E25] outline-none transition-all h-20"
                style={textareaStyle}
                spellCheck={false}
                onInput={handleEditorInput}
                onKeyDown={onKeydown}
                onPaste={onPaste}
                onClick={onClick}
                onCompositionStart={onCompositionstart}
                onCompositionEnd={onCompositionend}
                onBlur={onBlur}
                onFocus={onFocus}
              />

              {isShowPlaceholder && (
                <span
                  className="pointer-events-none absolute inset-0 px-0 py-0 leading-relaxed text-[#999999] text-sm"
                  style={
                    typeof placeholderStyle === "object" ? placeholderStyle : {}
                  }
                >
                  {showPlaceholder}
                </span>
              )}

              {/* 下拉选择框 - 普通模式 */}
              {canShowSelect && !enhancedMention && (
                <div
                  className="pointer-events-auto absolute z-20 max-h-[334px] w-[300px] px-2 py-1.5 overflow-hidden rounded-xl shadow-[0_3px_8px_rgba(0,0,0,0.15)] bg-white"
                  style={popupStyle}
                >
                  <div className="h-9 flex items-center justify-between px-2 text-xs text-[#999999]">
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
                          <p className="flex-1 text-sm text-[#1D1E1F] truncate">
                            {doc.name}
                          </p>
                        </div>
                      </div>
                    ))}
                    {filteredKnowledge.length === 0 && (
                      <div className="px-4 py-6 text-center text-xs text-[#9FA4C5]">
                        没有匹配项，试试更换关键词
                      </div>
                    )}
                  </div>
                  {checkVersion(VERSION_MODULE.KNOWLEDGE_BASE) && (
                    <div
                      className="h-8 rounded flex items-center gap-2 px-2.5 text-sm mt-1 cursor-pointer hover:bg-[#EBF1FF]"
                      onClick={handleOpenLibrary}
                    >
                      <span className="flex-1">@ 从知识库里选择</span>
                      <RightOutlined />
                    </div>
                  )}
                </div>
              )}

              {/* 知识下拉选择框 - enhancedMention 模式 */}
              {canShowSelect && enhancedMention && (
                <div
                  className="pointer-events-auto absolute z-20 max-h-[450px] w-[308px] px-3 py-1.5 overflow-hidden rounded-xl shadow-[0_3px_8px_rgba(0,0,0,0.15)] bg-white"
                  style={popupStyle}
                >
                  {/* 知识库相关内容 - 搜索框 */}
                  {hasKnowledgeBase && (
                    <div className="py-3">
                      <Input
                        value={searchKeyword}
                        onChange={(e) => setSearchKeyword(e.target.value)}
                        placeholder="搜索文件"
                        prefix={
                          searchLoading ? <LoadingOutlined /> : <SearchOutlined />
                        }
                        allowClear
                      />
                    </div>
                  )}

                  {/* 列表区域 */}
                  <div className="max-h-[380px] overflow-y-auto">
                    {/* 知识库相关内容 - 最近访问、文件列表、从知识库选择 */}
                    {hasKnowledgeBase && (
                      <>
                        <div className="h-9 flex items-center text-xs text-[#999999] px-2">
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
                                <div className="size-5 rounded flex items-center justify-center bg-[#F5F5F5]">
                                  <img
                                    src={doc.icon}
                                    className="size-4"
                                    alt=""
                                  />
                                </div>
                                <p className="flex-1 text-sm text-[#1D1E1F] truncate">
                                  {doc.name}
                                </p>
                              </div>
                            </div>
                          ))}
                          {searchLoading && (
                            <div className="px-4 py-6 text-center text-xs text-[#9FA4C5]">
                              <LoadingOutlined /> 搜索中...
                            </div>
                          )}
                          {!searchLoading && filteredKnowledge.length === 0 && (
                            <div className="px-4 py-6 text-center text-xs text-[#9FA4C5]">
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
                          <span className="flex-1">@ 从知识库里选择</span>
                          <RightOutlined />
                        </div>
                      </>
                    )}
                    {checkVersion(VERSION_MODULE.WORKBENCH) && (
                      <div
                        className="h-8 rounded flex items-center gap-2 px-2.5 text-sm mt-1 cursor-pointer hover:bg-[#EBF1FF]"
                        onClick={handleOpenUploadedDialog}
                      >
                        <span className="flex-1">@ 从我上传的选择</span>
                        <RightOutlined />
                      </div>
                    )}
                    {checkVersion(VERSION_MODULE.WORKBENCH) && (
                      <div
                        className="h-8 rounded flex items-center gap-2 px-2.5 text-sm mt-1 cursor-pointer hover:bg-[#EBF1FF]"
                        onClick={handleOpenAIGeneratedDialog}
                      >
                        <span className="flex-1">@ 从AI生成的选择</span>
                        <RightOutlined />
                      </div>
                    )}
                    {checkVersion(VERSION_MODULE.RECORDING) && (
                      <div
                        className="h-8 rounded flex items-center gap-2 px-2.5 text-sm mt-1 cursor-pointer hover:bg-[#EBF1FF]"
                        onClick={handleOpenRecordingsDialog}
                      >
                        <span className="flex-1">@ 从我的录音选择</span>
                        <RightOutlined />
                      </div>
                    )}
                  </div>
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
                      value={skillSearchKeyword}
                      onDebouncedChange={setSkillSearchKeyword}
                      placeholder="搜索技能"
                    />
                  </div>

                  {/* 技能列表 */}
                  <div className="max-h-[220px] overflow-y-auto">
                    {filteredMySkills.map((skill: any) => (
                      <div
                        key={skill.id}
                        className="w-full h-9 flex items-center px-2.5 rounded-lg cursor-pointer transition hover:bg-[#EBF1FF]"
                        onClick={() => handleSelectSkillFromDropdown(skill)}
                      >
                        <div className="flex items-center gap-3 overflow-hidden flex-1">
                          <div className="size-5 rounded flex items-center justify-center bg-[#F5F5F5]">
                            <SvgIcon name="skill" size={14} color="#2563EB" />
                          </div>
                          <p className="flex-1 text-sm text-[#1D1E1F] truncate">
                            {skill.display_name}
                          </p>
                        </div>
                      </div>
                    ))}
                    {skillsStore.mySkillLoading && (
                      <div className="px-4 py-6 text-center text-xs text-[#9FA4C5]">
                        <LoadingOutlined /> 加载中...
                      </div>
                    )}
                    {!skillsStore.mySkillLoading && filteredMySkills.length === 0 && (
                      <div className="px-4 py-6 text-center text-xs text-[#9FA4C5]">
                        {skillSearchKeyword.trim() ? '没有找到相关技能' : '暂无可用技能'}
                      </div>
                    )}
                  </div>

                  {/* 去技能库添加 */}
                  <div
                    className="h-9 flex items-center gap-2 px-2.5 text-sm mt-2 cursor-pointer hover:bg-[#EBF1FF] rounded-lg"
                    onClick={handleGoToSkillLibrary}
                  >
                    <SvgIcon name="skill" size={16} />
                    <span className="flex-1">去技能库添加</span>
                    <RightOutlined />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between">
              {/* Extras slot */}
              {extras || (
                <div className="flex items-center gap-3">
                  {actionPosition === "extras" && (
                    <>
                      {showAt && (
                        <Tooltip
                          title={
                            disabledAt
                              ? "需切换至【知识库】模式下才能使用"
                              : atToolTip
                          }
                          placement="top"
                        >
                          <Button
                            color="default"
                            variant="link"
                            disabled={disabledAt}
                            className="text-lg px-0"
                            onClick={triggerMention}
                          >
                            {atCode}
                          </Button>
                        </Tooltip>
                      )}
                      {showSkill && (
                        <Tooltip title="选择技能" placement="top">
                          <Button
                            ref={skillButtonRef as any}
                            color="default"
                            variant="link"
                            className="text-lg px-0 ml-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSkillSelect();
                            }}
                          >
                            <SvgIcon name="skill" size={16} />
                          </Button>
                        </Tooltip>
                      )}
                      {enableUpload && (
                        <Tooltip title="上传附件" placement="top">
                          <Button
                            color="default"
                            variant="link"
                            className="text-lg px-0"
                            onClick={handleUploadAttachment}
                          >
                            <PaperClipOutlined />
                          </Button>
                        </Tooltip>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Actions slot */}
              {actions || (
                <div
                  className={`flex items-center gap-3 ${customActionsClass}`}
                >
                  {actionPosition === "actions" && (
                    <>
                      {showAt && (
                        <Tooltip
                          title={
                            disabledAt
                              ? "需切换至【知识库】模式下才能使用"
                              : atToolTip
                          }
                          placement="top"
                        >
                          <Button
                            color="default"
                            variant="link"
                            disabled={disabledAt}
                            className="text-lg px-0"
                            onClick={triggerMention}
                          >
                            {atCode}
                          </Button>
                        </Tooltip>
                      )}
                      {showSkill && (
                        <Tooltip title="选择技能" placement="top">
                          <Button
                            ref={skillButtonRef as any}
                            color="default"
                            variant="link"
                            className="text-lg px-0 ml-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSkillSelect();
                            }}
                          >
                            <SvgIcon name="skill" size={16} />
                          </Button>
                        </Tooltip>
                      )}
                      {enableUpload && (
                        <Tooltip title="上传附件" placement="top">
                          <Button
                            color="default"
                            variant="link"
                            className="text-lg px-0"
                            onClick={handleUploadAttachment}
                          >
                            <PaperClipOutlined />
                          </Button>
                        </Tooltip>
                      )}
                    </>
                  )}

                  {loading ? (
                    <div
                      className="size-8 rounded-full flex items-center justify-center text-white bg-[#2563EB] cursor-pointer"
                      onClick={handleStop}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="16"
                        height="16"
                      >
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                      </svg>
                    </div>
                  ) : (
                    <div
                      className={showAt ? "flex" : "w-full flex justify-end"}
                    >
                      <div
                        className={`size-8 ml-2 rounded-full flex items-center justify-center text-white ${!canSend ? "bg-[#D3D4D9] cursor-not-allowed" : "bg-[#2563EB] cursor-pointer"}`}
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
        <SpaceDialog ref={spaceDialogRef} onConfirm={handleSelectFiles} allowSelectLibrary={allowSelectLibrary} allowSelectSpace={allowSelectSpace} />
        <MyFilesDialog
          ref={uploadedDialogRef}
          source="uploads"
          onConfirm={handleSelectFromUploaded}
        />
        <MyFilesDialog
          ref={aiGeneratedDialogRef}
          source="ai-generated"
          onConfirm={handleSelectFromAIGenerated}
        />
        <MyFilesDialog
          ref={recordingsDialogRef}
          source="recordings"
          onConfirm={handleSelectFromRecordings}
        />

        {/* Styles */}
        <style>{`
          .mention-line-block {
            height: 22px;
            line-height: 20px;
            box-sizing: border-box;
            display: inline-block;
            position: relative;
            bottom: 2px;
            vertical-align: middle;
            font-weight: 400;
            padding: 1px 4px;
            border-radius: 4px;
            background: #98a2b1;
            background: var(--color-brand-20, #98a2b1);
          }
          .mention-input,
          .skill-input {
            background: var(--color-brand-20, #F4F4F4);
            min-width: 160px;
            max-width: 100%;
            word-break: keep-all;
            white-space: nowrap;
            overflow-x: auto;
            border-radius: 12px;
          }
          .mention-input.empty {
            color: #2563EB;
          }
          .skill-input.empty {
            color: #2563EB;
          }
          .mention-link {
            user-select: none;
            -webkit-user-select: none;
            display: inline-flex;
            align-items: center;
            background-color: #E1E8FF;
            border-radius: 4px;
            padding: 0 4px;
            margin: 0 2px;
            color: #1B3F94;
            text-decoration: none;
            font-size: 14px;
            height: 24px;
            vertical-align: middle;
          }
          .mention-link .svg-sprite-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 16px;
          }
          .mention-link .text {
            margin: 0 4px;
            max-width: 120px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .mention-link .close-icon {
            cursor: pointer;
            color: #8F95AE;
          }
          .mention-link .close-icon:hover {
            color: #ef4444;
          }
          .skill-tag {
            user-select: none;
            -webkit-user-select: none;
            display: inline-flex;
            align-items: center;
            border-radius: 4px;
            padding: 0 6px;
            color: #2563EB;
            font-size: 14px;
            height: 24px;
            font-weight: 600;
            vertical-align: middle;
            background: transparent;
          }
          .skill-tag .text {
            margin-right: 4px;
          }
          .skill-tag .close-icon {
            cursor: pointer;
            color: #2563EB;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .mention-dropdown-item {
            cursor: pointer;
          }
        `}</style>
      </div>
    );
  },
);

Sender.displayName = "Sender";

export default Sender;
