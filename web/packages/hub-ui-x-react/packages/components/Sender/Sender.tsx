import React, { useRef, useState, useCallback, useMemo, useImperativeHandle, forwardRef, useEffect } from 'react';
import { t } from '../../locale/index';
import Icon from '../Icon/index';
import FileIcon from '../FileIcon/index';
import Tooltip from '../Tooltip/index';
import { formatFileSize } from '../../utils';
import { showMessage } from '../../utils/message';
import type {
  SenderProps,
  SenderRef,
  SenderSendData,
  UploadFile, MentionLinkItem,
  SkillItem,
  FileListSlotProps,
  LinkListSlotProps
} from './types';
import { useEditor, getCursor, hasClassName, findParent, isSpaceChar } from './hooks/useEditor';
import { useMention } from './hooks/useMention';
import { useSkill } from './hooks/useSkill';
import MentionDropdown from './components/MentionDropdown';
import SkillDropdown from './components/SkillDropdown';
import './index.css';

const FILE_STATUS = {
  PENDING: 'pending',
  UPLOADING: 'uploading',
  SUCCESS: 'done',  // 映射到 UploadFile.status 的 'done'
  ERROR: 'error'
} as const;

interface InternalFileItem {
  id: string;
  vid: string;
  name: string;
  size: number;
  mime_type: string;
  loading: boolean;
  url: string;
  raw: File | null;
  error: string;
  status: typeof FILE_STATUS[keyof typeof FILE_STATUS];
}

// 默认值
const DEFAULTS = {
  placeholder: '',
  sendOnEnter: true,
  inputState: { disabled: false, disabledReason: undefined, stopDisabled: false },
  fileUpload: { enabled: false, acceptTypes: '*/*', allowMultiple: false, maxFileSize: 10 * 1024 * 1024, enableDrag: false, enablePaste: false, allowSendWithFiles: false, request: undefined, fileList: undefined, onFileChange: undefined },
  mention: { enabled: false, disabled: false, triggerCode: '@', maxCount: 20, placeholder: '指定文档', tooltip: '指定任意文件问答', createLinkInEditor: false, enhanced: false, list: [], suggestions: [], recentList: [], searchKeyword: '', searchLoading: false, onSearch: undefined, onSelect: undefined, onRemove: undefined, onOpenLibrary: undefined, onSelectFiles: undefined, hasKnowledgeBase: true, allowSelectLibrary: true, allowSelectSpace: true },
  skill: { enabled: false, triggerCode: '/', tooltip: '选择技能', list: [], suggestions: [], searchKeyword: '', searchLoading: false, onSearch: undefined, onSelect: undefined, onRemove: undefined, onOpenLibrary: undefined },
  ui: { isMobile: false, showCaret: true, canBlur: true, needFixPositionWhenFocus: true, actionPosition: 'actions' as const },
};

const createFileItem = (file: File, vid: string): InternalFileItem => ({
  id: '',
  vid,
  name: file.name,
  size: file.size,
  mime_type: file.type,
  loading: true,
  url: '',
  raw: file,
  error: '',
  status: FILE_STATUS.UPLOADING
});

const Sender = forwardRef<SenderRef, SenderProps>((props, ref) => {
  const {
    value,
    onChange,
    onSend,
    onStop,
    loading = false,
    placeholder = DEFAULTS.placeholder,
    maxLength,
    sendOnEnter = DEFAULTS.sendOnEnter,
    inputState,
    fileUpload,
    mention,
    skill,
    ui,
    onInput,
    onFocus,
    onBlur,
    slots,
    className,
    style,
    classNames,
  } = props;

  // 解析分组属性
  const { disabled = false, disabledReason, stopDisabled = false } = inputState || DEFAULTS.inputState;
  const {
    enabled: enableUpload = false,
    acceptTypes = '*/*',
    allowMultiple = false,
    maxFileSize = 10 * 1024 * 1024,
    enableDrag = false,
    enablePaste = false,
    allowSendWithFiles = false,
    request: httpRequest,
    fileList: externalFileList,
    onFileChange,
  } = fileUpload || DEFAULTS.fileUpload;
  const mentionConfig = mention || DEFAULTS.mention;
  const skillConfig = skill || DEFAULTS.skill;
  const {
    isMobile = false,
    showCaret = true,
    canBlur = true,
    needFixPositionWhenFocus = true,
    actionPosition = 'actions',
  } = ui || DEFAULTS.ui;

  // Refs
  const editorRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 互斥 cleanup:hook 之间不能直接互相调用,通过 ref 在 useEffect 中绑定
  const cleanupSkillRef = useRef<() => void>(() => {});
  const cleanupMentionRef = useRef<() => void>(() => {});
  // Backspace 标记:对齐原版 Sender.tsx line 1250 isBackspaceRef,用于区分普通输入 vs 删除。
  // 普通输入时,光标后若紧跟 skill-tag,自动删除该 skill-tag(对齐原版 1424-1446);
  // Backspace 时不删,否则用户 Backspace 删字符会把 skill-tag 一起带走。
  const isBackspaceRef = useRef(false);

  // State
  const [isFocused, setIsFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [internalFileList, setInternalFileList] = useState<InternalFileItem[]>([]);
  const [internalMentionList, setInternalMentionList] = useState<MentionLinkItem[]>([]);
  const [internalSkillList, setInternalSkillList] = useState<SkillItem[]>([]);
  const [linkListCollapsed, setLinkListCollapsed] = useState(false);
  const [contentVersion, setContentVersion] = useState(0);

  // Hooks
  const editor = useEditor({
    editorRef,
    onInput: (data) => {
      // 调用 onChange 回调
      onChange?.(data.textContent);

      const sendData: SenderSendData = {
        textContent: data.textContent,
        pureTextContent: data.pureTextContent,
        atList: currentMentionList,
        skillList: currentSkillList.map(s => s.label || s.display_name || ''),
        selectedSkills: currentSkillList.map(s => ({
          display_name: s.label || s.display_name || '',
          skill_name: s.skill_name,
        })),
        files: currentFileList as unknown as UploadFile[],
      };
      onInput?.(sendData);
    },
    disabled,
    showCaret,
    maxLength,
  });

  const mentionHook = useMention({
    editorRef,
    enabled: mentionConfig.enabled,
    triggerCode: mentionConfig.triggerCode,
    maxCount: mentionConfig.maxCount,
    placeholder: mentionConfig.placeholder,
    createLinkInEditor: mentionConfig.createLinkInEditor,
    list: mentionConfig.list,
    suggestions: mentionConfig.suggestions,
    recentList: mentionConfig.recentList,
    searchKeyword: mentionConfig.searchKeyword,
    searchLoading: mentionConfig.searchLoading,
    onSearch: mentionConfig.onSearch,
    onSelect: mentionConfig.onSelect,
    onRemove: mentionConfig.onRemove,
    onOpenLibrary: mentionConfig.onOpenLibrary,
    // 把 onSelectFiles 透传给 useMention,让 hook 内部能清理 mention-input
    onSelectFiles: mentionConfig.onSelectFiles,
    onInput: () => {
      editor.handleInput();
      setContentVersion(v => v + 1);
    },
    // 互斥:激活 mention 前清理 skill(对齐原版 Sender.tsx 1458-1463)
    onBeforeActivate: () => cleanupSkillRef.current?.(),
    // 走 useEditor.insertNode,触发 togglePlaceholder + 前后补空格,
    // 修复点击 @ 按钮后 placeholder 仍显示、chip 换行的问题。
    // cursor 必须透传:用户把光标放在中间时,@ 触发不应把 chip append 到末尾。
    onInsertInput: (input, cursor) => editor.insertNode(input, cursor),
    // Esc 取消 @ 输入态后,把焦点放回编辑器(下拉搜索框卸载前会抢走 focus)
    focusEditor: editor.focusAtEnd,
  });

  const skillHook = useSkill({
    editorRef,
    enabled: skillConfig.enabled,
    triggerCode: skillConfig.triggerCode,
    list: skillConfig.list,
    suggestions: skillConfig.suggestions,
    searchKeyword: skillConfig.searchKeyword,
    searchLoading: skillConfig.searchLoading,
    onSearch: skillConfig.onSearch,
    onSelect: skillConfig.onSelect,
    onRemove: skillConfig.onRemove,
    onOpenLibrary: skillConfig.onOpenLibrary,
    onInput: () => {
      editor.handleInput();
      setContentVersion(v => v + 1);
    },
    // 互斥:激活 skill 前清理 mention(对齐原版 Sender.tsx 1474-1479)
    onBeforeActivate: () => cleanupMentionRef.current?.(),
    // 走 useEditor.insertNode,触发 togglePlaceholder + 前后补空格,
    // 修复点击技能按钮后 placeholder 仍显示、chip 换行的问题。
    // cursor 必须透传:用户在中间输入 / 触发时,chip 不应被 append 到末尾。
    onInsertInput: (input, cursor) => editor.insertNode(input, cursor),
    // Esc 取消 / 输入态后,把焦点放回编辑器(下拉搜索框卸载前会抢走 focus)
    focusEditor: editor.focusAtEnd,
  });

  // 绑定互斥 cleanup(useEffect 在第一次渲染后跑,用户操作时 cleanup 已就绪)
  useEffect(() => {
    cleanupSkillRef.current = () => {
      skillHook.closeSelect();
      const skillInputEl = editorRef.current?.querySelector('.skill-input');
      if (skillInputEl) skillInputEl.remove();
    };
    cleanupMentionRef.current = () => {
      mentionHook.closeSelect();
      const mentionInputEl = editorRef.current?.querySelector('.mention-input');
      if (mentionInputEl) mentionInputEl.remove();
    };
  }, [skillHook, mentionHook]);

  // 当 mentionConfig.list 增长时(外部 Dialog 如 SpaceDialog / MyFilesDialog 确认后),
  // 清理编辑器中残留的 mention-input(对齐原版 Sender 的 handleSelectFiles 行为)。
  // 只在 list 增长时清理,避免用户在删除 chip 时误清理正在编辑的 @ 输入。
  // 修复:apps/front-react ChatContainer 中 @ 知识库 Dialog 确认后 mention-input 残留。
  const prevMentionListLengthRef = useRef(mentionConfig.list?.length ?? 0);
  useEffect(() => {
    if (!mentionConfig.enabled) return;
    const currentLength = mentionConfig.list?.length ?? 0;
    const prevLength = prevMentionListLengthRef.current;
    prevMentionListLengthRef.current = currentLength;
    if (currentLength <= prevLength) return;
    const input = editorRef.current?.querySelector('.mention-input');
    if (!input) return;
    mentionHook.handleSelectFiles();
  }, [mentionConfig.enabled, mentionConfig.list, mentionHook]);

  // 当 skillConfig.list 变化时(外部传入如 WorkAiSenderExtras 点击技能 chip),
  // 同步插入/移除 skill-tag 到编辑器(对齐 mentionConfig.list 的受控模式)。
  // 修复:apps/front-react ChatContainer 中点击技能 chip 后 skill-tag 未插入。
  const prevSkillListRef = useRef<SkillItem[]>([]);
  useEffect(() => {
    if (!skillConfig.enabled || !skillConfig.list) return;
    const prevList = prevSkillListRef.current;
    const currentList = skillConfig.list;
    prevSkillListRef.current = currentList;

    // 判断是新增还是删除
    const addedSkills = currentList.filter(
      (s) => !prevList.some((p) => (p.label || p.display_name) === (s.label || s.display_name))
    );
    const removedSkills = prevList.filter(
      (p) => !currentList.some((s) => (s.label || s.display_name) === (p.label || p.display_name))
    );

    // 移除已删除的技能标签
    removedSkills.forEach((skill) => {
      const tag = editorRef.current?.querySelector(
        `.skill-tag[data-skill="${skill.label || skill.display_name}"]`
      );
      if (tag) tag.remove();
    });

    // 插入新增的技能标签
    addedSkills.forEach((skill) => {
      skillHook.insertSkillTag(skill);
    });
  }, [skillConfig.enabled, skillConfig.list, skillHook, editorRef]);

  // 文件列表（受控/非受控）
  const currentFileList = externalFileList || internalFileList;
  const hasUploadingFiles = useMemo(() =>
    currentFileList.some(file => file.status === 'uploading'),
    [currentFileList]
  );
  const validFiles = useMemo(() =>
    currentFileList.filter(item => item.status !== 'error' && item.status !== 'uploading'),
    [currentFileList]
  );

  // 链接列表（受控/非受控）
  const currentMentionList = mentionConfig.list?.length ? mentionConfig.list : internalMentionList;
  const currentSkillList = skillConfig.list?.length ? skillConfig.list : internalSkillList;

  // 发送判断
  const hasText = useMemo(() => {
    if (!editorRef.current) return false;
    const text = editorRef.current.textContent?.trim() || '';
    const skillText = editorRef.current.querySelector('.skill-tag')?.textContent?.trim() || '';
    return text.replace(skillText, '').trim().length > 0;
  }, [editor.isShowPlaceholder, contentVersion]);

  const canSend = useMemo(() =>
    hasText || (allowSendWithFiles && validFiles.length > 0),
    [hasText, allowSendWithFiles, validFiles.length]
  );
  const buttonDisabled = useMemo(() =>
    disabled || loading || !canSend || hasUploadingFiles,
    [disabled, loading, canSend, hasUploadingFiles]
  );
  const stopButtonDisabled = disabled || stopDisabled;

  // 生成唯一 ID
  const generateUniqueId = useCallback(() => {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }, []);

  // 清空文件列表
  const clearFileList = useCallback(() => {
    if (!externalFileList) {
      setInternalFileList([]);
    }
    onFileChange?.([]);
  }, [externalFileList, onFileChange]);

  // 上传文件
  const uploadFile = useCallback((file: File) => {
    const newFile = createFileItem(file, generateUniqueId());

    if (!externalFileList) {
      setInternalFileList(prev => [...prev, newFile]);
    }

    if (!httpRequest) {
      return Promise.resolve();
    }

    return httpRequest(file)
      .then((data) => {
        const updatedFile: InternalFileItem = {
          ...newFile,
          id: data?.id || '',
          url: data?.url || '',
          loading: false,
          status: FILE_STATUS.SUCCESS,
          raw: null
        };
        if (!externalFileList) {
          setInternalFileList(prev => prev.map(item =>
            item.vid === newFile.vid ? updatedFile : item
          ));
        }
        if (onFileChange) {
          const newFileList = [...(externalFileList || []), updatedFile as unknown as UploadFile];
          onFileChange(newFileList as UploadFile[]);
        }
      })
      .catch((error) => {
        const errorFile: InternalFileItem = {
          ...newFile,
          loading: false,
          error: error?.message || t('hubx.bubble.upload_failed'),
          status: FILE_STATUS.ERROR,
          raw: null
        };

        if (!externalFileList) {
          setInternalFileList(prev => prev.map(item =>
            item.vid === newFile.vid ? errorFile : item
          ));
        }

        // 即使错误也通知外部
        if (onFileChange) {
          const newFileList = [...(externalFileList || []), errorFile as unknown as UploadFile];
          onFileChange(newFileList as UploadFile[]);
        }
      });
  }, [httpRequest, generateUniqueId, externalFileList, onFileChange]);

  // 批量上传
  const uploadFiles = useCallback(async (files: File[]) => {
    if (!httpRequest) return;
    const promises = Array.from(files).map(file => uploadFile(file));
    await Promise.all(promises);
  }, [httpRequest, uploadFile]);

  // 处理文件
  const processFiles = useCallback((files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    const validFilesList: File[] = [];
    Array.from(files).forEach(file => {
      if (file.size > maxFileSize) {
        showMessage.error(t('hubx.bubble.file_size_limit', { size: Math.round(maxFileSize / (1024 * 1024)) }));
      } else {
        validFilesList.push(file);
      }
    });
    if (validFilesList.length === 0) return;
    uploadFiles(validFilesList);
  }, [maxFileSize, uploadFiles]);

  // 事件处理
  const handleFocus = useCallback(() => {
    setIsFocused(true);
    onFocus?.();
  }, [onFocus]);

  const handleBlur = useCallback(() => {
    if (canBlur) {
      setIsFocused(false);
      onBlur?.();
    }

    // 对齐原版 Sender.tsx line 1590-1596 + 1201-1214:
    // 1. blur 时清理空 mention-input / skill-input
    mentionHook.checkAndConvertInput();
    skillHook.checkAndConvertInput();
    // 2. 空编辑器时清空 innerHTML(对齐原版 checkAndRemoveOnlySpace,
    //    mobile 留 <br /> 给光标占位,desktop 清空字符串)
    if (editor.isEmptyEditor() && editorRef.current) {
      editorRef.current.innerHTML = '';
    }
    // 3. 触发 onChange 同步 placeholder 状态
    editor.handleInput();
  }, [canBlur, onBlur, mentionHook, skillHook, editor]);

  const handleStop = useCallback(() => {
    if (stopButtonDisabled) return;
    onStop?.();
  }, [onStop, stopButtonDisabled]);

  const handleSend = useCallback(() => {
    if (buttonDisabled) return;

    const cleanFiles: UploadFile[] = validFiles.map(file => ({
      id: file.id || '',
      vid: file.vid,
      name: file.name,
      size: file.size,
      mime_type: file.mime_type,
      url: file.url || '',
      status: file.status as UploadFile['status']
    }));

    // 复用 editor.getContentData() 拿到剥离 mention/skill 后的纯文本，
    // 对齐 apps/front-react/src/components/Chat/Sender.tsx 老 Sender 行为。
    const contentData = editor.getContentData();

    const sendData: SenderSendData = {
      textContent: contentData?.textContent || '',
      pureTextContent: contentData?.pureTextContent || '',
      atList: currentMentionList,
      skillList: currentSkillList.map(s => s.label || s.display_name || ''),
      selectedSkills: currentSkillList.map(s => ({
        display_name: s.label || s.display_name || '',
        skill_name: s.skill_name,
      })),
      files: cleanFiles,
    };

    onSend?.(sendData);
    editor.clear();
    clearFileList();
    setInternalMentionList([]);
    setInternalSkillList([]);
  }, [buttonDisabled, validFiles, currentMentionList, currentSkillList, onSend, editor, clearFileList]);

  const handleDelete = useCallback((item: InternalFileItem) => {
    if (!externalFileList) {
      setInternalFileList(prev => prev.filter(file => file.vid !== item.vid));
    }
    if (onFileChange) {
      onFileChange(currentFileList.filter(f => f.vid !== item.vid) as UploadFile[]);
    }
  }, [externalFileList, onFileChange, currentFileList]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    // 记录 Backspace 标记(对齐原版 Sender.tsx line 1250 isBackspaceRef)
    isBackspaceRef.current = event.key === 'Backspace';

    // 优先处理下拉导航
    if (mentionHook.handleKeyDown(event)) return;
    if (skillHook.handleKeyDown(event)) return;

    // Backspace 命中"光标在空格 + 前一个兄弟是 mention-line-block"时,自动删除该 chip
    // 对齐原版 Sender.tsx line 1316-1327
    if (event.key === 'Backspace') {
      const cursor = getCursor();
      if (cursor && cursor.element) {
        const el = cursor.element;
        const text = el.textContent || '';
        const prev = el.previousSibling as HTMLElement | null;
        if (
          isSpaceChar(text) &&
          prev &&
          hasClassName(prev, 'mention-line-block')
        ) {
          // 删掉 chip,并关闭对应的下拉框
          prev.remove();
          if (hasClassName(prev, 'mention-input')) {
            mentionHook.closeSelect();
          } else if (hasClassName(prev, 'skill-input')) {
            skillHook.closeSelect();
          } else if (hasClassName(prev, 'mention-link')) {
            mentionHook.closeSelect();
            // 同步清理外部 link 列表中对应项
            const linkId = (prev as HTMLElement).getAttribute('data-json');
            if (linkId) {
              try {
                const data = JSON.parse(linkId);
                setInternalMentionList(prevList => prevList.filter(l => l.id !== data.id));
                mentionConfig.onRemove?.(data);
              } catch {
                /* ignore */
              }
            }
          }
          event.preventDefault();
        }
      }
    }

    // 发送
    if (event.key === 'Enter' && !event.shiftKey && sendOnEnter) {
      if (editor.isCompositionActive(event)) return;
      if (mentionHook.canShowSelect || skillHook.canShowSelect) return;
      event.preventDefault();
      handleSend();
    }
  }, [mentionHook, skillHook, sendOnEnter, editor, handleSend, mentionConfig]);

  const handleUploadClick = useCallback(() => {
    if (disabled) return;
    fileInputRef.current?.click();
  }, [disabled]);

  const onFileSelected = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    processFiles(files);
    event.target.value = '';
  }, [processFiles]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (!enableDrag || disabled) return;
    if (dragLeaveTimerRef.current) {
      clearTimeout(dragLeaveTimerRef.current);
      dragLeaveTimerRef.current = null;
    }
    setIsDragging(true);
    event.dataTransfer.dropEffect = 'copy';
  }, [enableDrag, disabled]);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    if (!enableDrag || disabled) return;
    if (dragLeaveTimerRef.current) {
      clearTimeout(dragLeaveTimerRef.current);
    }
    dragLeaveTimerRef.current = setTimeout(() => setIsDragging(false), 50);
  }, [enableDrag, disabled]);

  const handleDrop = useCallback((event: React.DragEvent) => {
    if (!enableDrag || disabled) return;
    if (dragLeaveTimerRef.current) {
      clearTimeout(dragLeaveTimerRef.current);
      dragLeaveTimerRef.current = null;
    }
    setIsDragging(false);
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      processFiles(files);
    }
  }, [enableDrag, disabled, processFiles]);

  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    if (!enablePaste || disabled) return;
    const items = event.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      processFiles(files);
    }
  }, [enablePaste, disabled, processFiles]);

  // 清理残留样式标签（必须先于 handleEditorInput 声明，否则依赖数组会触发 TDZ）
  const cleanResidualStyles = useCallback(() => {
    const editorEl = editorRef.current;
    if (!editorEl) return;

    // 清理蓝色字体标签
    const fontTags = editorEl.querySelectorAll('font[color="#2563eb"]');
    fontTags.forEach((font) => {
      const text = document.createTextNode(font.textContent || '');
      font.replaceWith(text);
    });

    // 清理无效的灰色背景 span
    const spans = editorEl.querySelectorAll('span[style*="background-color"]');
    spans.forEach((span) => {
      if (!span.classList.contains('mention-line-block') &&
          !span.classList.contains('mention-input') &&
          !span.classList.contains('skill-input') &&
          !span.classList.contains('mention-link') &&
          !span.classList.contains('skill-tag')) {
        const text = document.createTextNode(span.textContent || '');
        span.replaceWith(text);
      }
    });

    // 合并相邻文本节点
    editorEl.normalize();
  }, []);

  const handleEditorInput = useCallback(() => {
    // 1. 清理残留样式标签
    cleanResidualStyles();

    // 2. 检查并转换空 mention-input/skill-input
    mentionHook.checkAndConvertInput();
    skillHook.checkAndConvertInput();

    // 3. 检查 @ 和 / 触发（带互斥逻辑）
    const cursor = getCursor();
    if (cursor && cursor.element) {
      const text = cursor.element.textContent || '';
      const char = text.slice(cursor.cursorPos - 1, cursor.cursorPos);

      // 输入 @ → 删除 skill-input，激活 mention-input
      if (char === mentionConfig.triggerCode && mentionConfig.enabled) {
        skillHook.quitSkillInput(true);
      }

      // 输入 / → 删除 mention-input，激活 skill-input
      if (char === skillConfig.triggerCode && skillConfig.enabled) {
        mentionHook.quitMentionInput(true);
      }

      // 普通输入(非 Backspace)时,如果光标后紧跟 skill-tag,自动删除并触发 onRemoveSkill。
      // 对齐原版 Sender.tsx line 1423-1446:用户在已选 skill 后又输入文字,意味着要重新选,
      // 旧 skill-tag 自动清除。
      if (!isBackspaceRef.current && cursor.range) {
        let nextNode: Node | null = cursor.element.nextSibling;
        while (nextNode) {
          if ((nextNode as HTMLElement).classList?.contains('skill-tag')) {
            const tag = nextNode as HTMLElement;
            tag.remove();
            mentionConfig.onRemoveSkill?.();
            // skillConfig 暴露的 onRemove 是 ref 删除回调(对应 hub-ui-x-react 的 onRemove prop)
            skillConfig.onRemove?.();
            break;
          }
          nextNode = nextNode.nextSibling;
        }
        // 父节点的下一个兄弟也可能是 skill-tag(嵌套情况)
        const parentNext = (cursor.element as HTMLElement).parentElement?.nextSibling;
        if (parentNext && (parentNext as HTMLElement).classList?.contains('skill-tag')) {
          const tag = parentNext as HTMLElement;
          tag.remove();
          mentionConfig.onRemoveSkill?.();
          skillConfig.onRemove?.();
        }
      }
    }

    // 4. 触发 hooks 的输入检查
    mentionHook.handleInputCheck();
    skillHook.handleInputCheck();
    editor.handleInput();

    // 5. 触发 hasText 重新计算
    setContentVersion(v => v + 1);
  }, [mentionHook, skillHook, editor, cleanResidualStyles, mentionConfig, skillConfig]);

  // Ref 方法
  useImperativeHandle(ref, () => ({
    insertText: editor.insertText,
    send: handleSend,
    focus: editor.focus,
    clear: () => {
      editor.clear();
      clearFileList();
      setInternalMentionList([]);
      setInternalSkillList([]);
    },
    /**
     * 清空链接列表 + 清理编辑器中残留的 mention-input。
     * 对齐原版 Sender.tsx line 1686-1691 的 clearLinks。
     */
    clearLinks: () => {
      setInternalMentionList([]);
      // 同步清理编辑器中的 mention-input 并触发 onChange(对齐原版 togglePlaceholder + emitInputImmediately)
      mentionHook.quitMentionInput(true);
      editor.handleInput();
    },
    /**
     * 设置链接列表,触发 placeholder 同步 + onChange。
     * 对齐原版 Sender.tsx line 1693-1700 的 setLinks。
     */
    setLinks: (links: MentionLinkItem[]) => {
      setInternalMentionList(links);
      editor.handleInput();
    },
    setPrompt: editor.insertText,
    clearEditor: editor.clear,
    clearFiles: clearFileList,
    insertSkill: (skillItem: SkillItem) => {
      skillHook.insertSkillTag(skillItem);
      setInternalSkillList([skillItem]);
    },
    clearSkills: () => {
      skillHook.clearSkillTags();
      setInternalSkillList([]);
      editor.handleInput();
    },
    triggerMention: mentionHook.activateMentionInput,
    triggerSkill: skillHook.activateSkillInput,
    /**
     * 外部 Dialog 选中文件后调用:清理编辑器中的 mention-input 并关闭下拉框。
     * 对齐原版 Sender:SpaceDialog.onConfirm 后的副作用。
     */
    quitMentionInput: () => mentionHook.quitMentionInput(true),
  }), [editor, handleSend, clearFileList, mentionHook, skillHook]);

  // 清理
  useEffect(() => {
    return () => {
      if (dragLeaveTimerRef.current) {
        clearTimeout(dragLeaveTimerRef.current);
      }
    };
  }, []);

  // 点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        mentionHook.handleClickOutside();
        skillHook.handleClickOutside();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mentionHook, skillHook]);

  // MutationObserver 监听 mention-input/skill-input 内容变化
  useEffect(() => {
    const editorEl = editorRef.current;
    if (!editorEl) return;

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        if (m.type === 'characterData') {
          // 监听 mention-input 的内容变化
          const mentionTarget = findParent(m.target, (n: Node) => hasClassName(n, 'mention-input')) as HTMLElement | null;
          if (mentionTarget) {
            const text = mentionTarget.textContent || '';
            if (text.trim() === mentionConfig.triggerCode) {
              mentionTarget.classList.add('empty');
            } else {
              mentionTarget.classList.remove('empty');
            }
          }

          // 监听 skill-input 的内容变化
          const skillTarget = findParent(m.target, (n: Node) => hasClassName(n, 'skill-input')) as HTMLElement | null;
          if (skillTarget) {
            const text = skillTarget.textContent || '';
            if (text.trim() === skillConfig.triggerCode) {
              skillTarget.classList.add('empty');
            } else {
              skillTarget.classList.remove('empty');
            }
          }
        }
      });
    });

    observer.observe(editorEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, [mentionConfig.triggerCode, skillConfig.triggerCode]);

  // 点击编辑器处理
  const handleEditorClick = useCallback((evt: React.MouseEvent<HTMLDivElement>) => {
    const target = evt.target as HTMLElement;

    // 点击 mention-input → 重新打开下拉框
    const mentionInput = findParent(target, (n: Node) => hasClassName(n, 'mention-input')) as HTMLElement | null;
    if (mentionInput && mentionConfig.enabled) {
      mentionHook.handleClickOnInput(mentionInput);
      return;
    }

    // 点击 skill-input → 重新打开下拉框
    const skillInput = findParent(target, (n: Node) => hasClassName(n, 'skill-input')) as HTMLElement | null;
    if (skillInput && skillConfig.enabled) {
      skillHook.handleClickOnInput(skillInput);
      return;
    }

    // 点击编辑器其他位置 → 退出输入模式
    mentionHook.quitMentionInput();
    skillHook.quitSkillInput();

    // 保存光标位置
    editor.saveCursor();
  }, [mentionHook, skillHook, mentionConfig.enabled, skillConfig.enabled, editor]);

  // 计算下拉弹窗位置
  const getDropdownStyle = useCallback((rect: DOMRect | null): React.CSSProperties => {
    if (!rect || !wrapperRef.current) {
      return { top: '100%', left: '0' };
    }
    const wrapperRect = wrapperRef.current.getBoundingClientRect();
    const left = rect.left - wrapperRect.left;
    const POPUP_HEIGHT_ESTIMATE = mentionConfig.enhanced ? 430 : 340;
    const spaceBelow = window.innerHeight - rect.bottom;
    const showAbove = spaceBelow < POPUP_HEIGHT_ESTIMATE;
    if (showAbove) {
      const bottom = wrapperRect.bottom - rect.top + 4;
      return { bottom: `${bottom}px`, left: `${left}px`, position: 'absolute', zIndex: 10 };
    }
    const top = rect.bottom - wrapperRect.top;
    return { top: `${top + 4}px`, left: `${left}px`, position: 'absolute', zIndex: 10 };
  }, [mentionConfig.enhanced]);

  // 渲染文件列表
  const renderFileList = () => {
    if (currentFileList.length === 0) return null;

    const fileListProps: FileListSlotProps = {
      files: currentFileList as unknown as UploadFile[],
      onRemove: (index: number) => handleDelete(currentFileList[index] as InternalFileItem),
    };

    if (slots?.fileList) {
      return slots.fileList(fileListProps);
    }

    return (
      <div className="x-sender__file-list">
        {currentFileList.map(item => (
          <div key={item.vid} className="x-sender__file-item">
            {item.status === 'uploading' ? (
              <div className="x-sender__file-loading">
                <Icon name="loading" />
              </div>
            ) : (
              <div className="x-sender__file-icon">
                <FileIcon name={item.name} mimeType={item.mime_type} />
              </div>
            )}
            <div className="x-sender__file-info">
              <div className="x-sender__file-name">{item.name}</div>
              <div className="x-sender__file-size">{formatFileSize(item.size)}</div>
            </div>
            {item.error && (
              <div className="x-sender__file-error">
                <Tooltip content={item.error} placement="top" trigger="hover">
                  <Icon name="warning" />
                </Tooltip>
              </div>
            )}
            <div className="x-sender__file-delete" onClick={() => handleDelete(item as InternalFileItem)}>
              <Icon name="delete" />
            </div>
          </div>
        ))}
      </div>
    );
  };

  // 渲染链接列表
  const renderLinkList = () => {
    if (currentMentionList.length === 0 || mentionConfig.createLinkInEditor) return null;

    const linkListProps: LinkListSlotProps = {
      links: currentMentionList,
      collapsed: linkListCollapsed,
      onRemove: (item: MentionLinkItem) => {
        mentionConfig.onRemove?.(item);
        setInternalMentionList(prev => prev.filter(i => i.id !== item.id));
      },
      onToggleCollapse: () => setLinkListCollapsed(prev => !prev),
    };

    if (slots?.linkList) {
      return slots.linkList(linkListProps);
    }

    return (
      <div className={`x-sender__link-list ${linkListCollapsed ? 'x-sender__link-list--collapsed' : ''}`}>
        {currentMentionList.map(link => (
          // 复合 key:跨 dialog source(knowledge/uploads/recordings 等)允许同一文件 ID 并存,
          // 只用 link.id 会让 React 报 duplicate key。fallback 到 id 保证 source 缺失时也唯一。
          <div key={`${link.source ?? ''}::${link.id}`} className="x-sender__link-item">
            {link.icon && <img src={link.icon} className="x-sender__link-icon" alt="" />}
            <span className="x-sender__link-name">{link.name}</span>
            <div className="x-sender__link-delete" onClick={() => {
              mentionConfig.onRemove?.(link);
              setInternalMentionList(prev => prev.filter(i => i.id !== link.id));
            }}>
              <Icon name="close" size={10} />
            </div>
          </div>
        ))}
      </div>
    );
  };

  // 渲染操作栏
  const renderActionBar = () => {
    if (slots?.actionBar) {
      return slots.actionBar;
    }

    const uploadButton = enableUpload && (
      <Tooltip content={t('hubx.bubble.upload_attachment')} placement="top" trigger="hover">
        <div
          className={`x-sender__action-button x-sender__action-button--upload ${disabled ? 'x-sender__action-button--disabled' : ''}`}
          onClick={handleUploadClick}
        >
          <Icon name="attachment" />
          <input
            type="file"
            ref={fileInputRef}
            className="x-sender__file-input"
            accept={acceptTypes}
            multiple={allowMultiple}
            disabled={disabled}
            onChange={onFileSelected}
          />
        </div>
      </Tooltip>
    );

    const mentionButton = mentionConfig.enabled && (
      <Tooltip content={mentionConfig.tooltip || t('hubx.bubble.mention')} placement="top" trigger="hover">
        <div
          className={`x-sender__action-button ${disabled || mentionConfig.disabled ? 'x-sender__action-button--disabled' : ''}`}
          onClick={() => {
            if (mentionConfig.disabled || disabled) return;
            // 对齐原版 Sender.tsx line 1787-1803 的 triggerMention:
            // 1. await 30ms 让 button 焦点跳走后 selection 稳定
            // 2. 调外部 afterCalloutMentionInput 回调(让父组件在 chip 插入前做处理)
            // 3. 用 getAliveLastCursor 作为 cursor 传给 activateMentionInput
            //    这样 chip 插入到用户上次停留的位置(而非编辑器末尾)
            setTimeout(() => {
              mentionConfig.afterCalloutMentionInput?.();
              const cursor = editor.getAliveLastCursor();
              mentionHook.activateMentionInput(cursor);
              // togglePlaceholder 已在 activateMentionInput 内部通过 onInsertInput 触发
            }, 30);
          }}
        >
          <Icon name="at" />
        </div>
      </Tooltip>
    );

    const skillButton = skillConfig.enabled && (
      <Tooltip content={skillConfig.tooltip || t('hubx.bubble.skill')} placement="top" trigger="hover">
        <div
          className={`x-sender__action-button ${disabled ? 'x-sender__action-button--disabled' : ''}`}
          onClick={() => {
            if (disabled) return;
            // 对齐原版 Sender.tsx line 1890-1908 的 toggleSkillSelect:
            // - 如果弹窗已显示,关闭
            // - 否则激活 skill-input(走 editor.insertNode 统一路径)
            //   并把光标基于 lastCursor 恢复
            if (skillHook.canShowSelect) {
              skillHook.closeSelect();
              return;
            }
            // 关闭 mention 弹窗(互斥)
            mentionHook.closeSelect();
            setTimeout(() => {
              // 静默把光标移到逻辑开头,让按钮无视用户光标位置也能触发技能。
              // 之后 getEditorCursor() 拿到的是刚放好的新光标,作为 chip 插入位置。
              skillHook.moveCursorToLogicalStart();
              skillHook.activateSkillInput(editor.getEditorCursor());
            }, 30);
          }}
        >
          <Icon name="skill" />
        </div>
      </Tooltip>
    );

    const sendButton = loading ? (
      <div
        className={`x-sender__action-button x-sender__action-button--stop ${stopButtonDisabled ? 'x-sender__action-button--disabled' : ''}`}
        onClick={handleStop}
      >
        {!stopButtonDisabled && <div className="x-sender__loading-border"></div>}
        <Icon name="stop" />
      </div>
    ) : (
      <div
        className={`x-sender__action-button x-sender__action-button--send ${buttonDisabled ? 'x-sender__action-button--disabled' : ''}`}
        onClick={handleSend}
      >
        <Icon name="top" />
      </div>
    );

    // 根据 actionPosition 决定按钮位置
    // extras 模式:技能 + 附件 放左侧 toolbar,@ 放右侧 toolbar(挨着发送按钮),
    // 对齐「小助理」的产品视觉规范——左侧留给技能/附件,右侧留给 @ 与发送。
    if (actionPosition === 'extras') {
      return (
        <div className="x-sender__action-bar">
          <div className="x-sender__action-buttons">
            {slots?.extrasLeft || (
              <>
                {skillButton}
                {uploadButton}
              </>
            )}
          </div>
          <div className="x-sender__action-buttons">
            {slots?.extrasRight || mentionButton}
            {sendButton}
          </div>
        </div>
      );
    }

    return (
      <div className="x-sender__action-bar">
        {slots?.extrasLeft || <div></div>}
        <div className="x-sender__action-buttons">
          {uploadButton}
          {mentionButton}
          {skillButton}
          {sendButton}
        </div>
      </div>
    );
  };

  return (
    <div
      className={`x-sender ${isFocused ? 'x-sender--focused' : ''} ${classNames?.root || ''} ${className || ''}`}
      style={style}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {slots?.header}

      {renderFileList()}
      {renderLinkList()}
      {slots?.linkListBelow}

      {isDragging && enableDrag && !disabled && (
        <div className="x-sender__drag-overlay">
          <div className="x-sender__drag-text">{t('hubx.bubble.drag_upload')}</div>
        </div>
      )}

      <div className="x-sender__main" ref={wrapperRef}>
        {slots?.inputBefore}

        <div className="x-sender__editor-wrapper">
          <div
            ref={editorRef}
            role="textbox"
            aria-disabled={disabled || loading}
            contentEditable={!disabled && !loading}
            className="x-sender__editor"
            style={showCaret ? undefined : { caretColor: 'transparent' }}
            spellCheck={false}
            onInput={handleEditorInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onClick={handleEditorClick}
            onCompositionStart={editor.handleCompositionStart}
            onCompositionEnd={editor.handleCompositionEnd}
            onFocus={handleFocus}
            onBlur={handleBlur}
            dangerouslySetInnerHTML={{ __html: '' }}
          />

          {editor.isShowPlaceholder && (
            <span className="x-sender__placeholder">
              {disabled && disabledReason ? disabledReason : placeholder}
            </span>
          )}

          {/* @ 下拉弹窗 */}
          {mentionHook.canShowSelect && (
            slots?.mentionDropdown ? (
              slots.mentionDropdown({
                suggestions: mentionHook.filteredSuggestions,
                recentList: mentionConfig.recentList || [],
                searchKeyword: mentionHook.searchKeyword,
                searchLoading: mentionConfig.searchLoading || false,
                selectedIndex: mentionHook.selectedIndex,
                onSelect: mentionHook.selectItem,
                onSearchChange: mentionHook.handleSearch,
                onOpenLibrary: mentionConfig.onOpenLibrary,
                onClose: mentionHook.closeSelect,
                onCancel: () => mentionHook.cancelMentionInput(true),
                style: getDropdownStyle(mentionHook.atRect),
                enhanced: mentionConfig.enhanced,
                hasKnowledgeBase: mentionConfig.hasKnowledgeBase,
              })
            ) : (
              <MentionDropdown
                suggestions={mentionHook.filteredSuggestions}
                recentList={mentionConfig.recentList || []}
                searchKeyword={mentionHook.searchKeyword}
                searchLoading={mentionConfig.searchLoading || false}
                selectedIndex={mentionHook.selectedIndex}
                onSelect={mentionHook.selectItem}
                onSearchChange={mentionHook.handleSearch}
                onOpenLibrary={mentionConfig.onOpenLibrary}
                onClose={mentionHook.closeSelect}
                onCancel={() => mentionHook.cancelMentionInput(true)}
                style={getDropdownStyle(mentionHook.atRect)}
                enhanced={mentionConfig.enhanced}
                hasKnowledgeBase={mentionConfig.hasKnowledgeBase}
              />
            )
          )}

          {/* 技能下拉弹窗 */}
          {skillHook.canShowSelect && (
            slots?.skillDropdown ? (
              slots.skillDropdown({
                suggestions: skillHook.filteredSuggestions,
                searchKeyword: skillHook.searchKeyword,
                searchLoading: skillConfig.searchLoading || false,
                selectedIndex: skillHook.selectedIndex,
                onSelect: skillHook.selectSkill,
                onSearchChange: skillHook.handleSearch,
                onOpenLibrary: skillConfig.onOpenLibrary,
                onClose: skillHook.closeSelect,
                onCancel: () => skillHook.cancelSkillInput(true),
                style: getDropdownStyle(skillHook.atRect),
              })
            ) : (
              <SkillDropdown
                suggestions={skillHook.filteredSuggestions}
                searchKeyword={skillHook.searchKeyword}
                searchLoading={skillConfig.searchLoading || false}
                selectedIndex={skillHook.selectedIndex}
                onSelect={skillHook.selectSkill}
                onSearchChange={skillHook.handleSearch}
                onOpenLibrary={skillConfig.onOpenLibrary}
                onClose={skillHook.closeSelect}
                onCancel={() => skillHook.cancelSkillInput(true)}
                style={getDropdownStyle(skillHook.atRect)}
              />
            )
          )}
        </div>

        {slots?.inputAfter}

        {renderActionBar()}
      </div>

      {disabled && disabledReason && (
        <div className="x-sender__disabled-reason">{disabledReason}</div>
      )}

      {slots?.footer}
    </div>
  );
});

Sender.displayName = 'Sender';

export default Sender;
