import React, { useRef, useState, useCallback, useMemo, useImperativeHandle, forwardRef, useEffect } from 'react';
import { t } from '../../locale/index';
import Icon from '../Icon/index';
import FileIcon from '../FileIcon/index';
import Tooltip from '../Tooltip/index';
import { formatFileSize } from '../../utils';
import { showMessage } from '../../utils/message';
import './index.css';

const FILE_STATUS = {
  PENDING: 'pending',
  UPLOADING: 'uploading',
  SUCCESS: 'success',
  ERROR: 'error'
} as const;

interface FileItem {
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

interface SenderProps {
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  sendOnEnter?: boolean;
  loading?: boolean;
  stopDisabled?: boolean;
  enableUpload?: boolean;
  acceptTypes?: string;
  allowMultiple?: boolean;
  maxFileSize?: number;
  httpRequest?: (file: File) => Promise<any>;
  autoUpload?: boolean;
  enablePasteUpload?: boolean;
  enableDragUpload?: boolean;
  allowSendWithFiles?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  onSend?: (prompt: string, files: any[]) => void;
  onFocus?: (event: React.FocusEvent) => void;
  onBlur?: (event: React.FocusEvent) => void;
  onStop?: () => void;
  onUpload?: (files: File[]) => void;
  onUploadError?: (error: any) => void;
  onUploadProgress?: (progress: any) => void;
  onUploadSuccess?: (data: any) => void;
  onUploadComplete?: (results: any[]) => void;
  extras?: React.ReactNode;
  actions?: React.ReactNode;
}

export interface SenderRef {
  uploadFiles: (files: File[]) => Promise<void>;
  handleUpload: () => void;
  setPrompt: (value: string) => void;
  setFileList: (value: FileItem[]) => void;
  clearState: () => void;
}

const createFileItem = (file: File, vid: string): FileItem => ({
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

const Sender = forwardRef<SenderRef, SenderProps>(({
  placeholder = '',
  disabled = false,
  maxLength = 0,
  sendOnEnter = true,
  loading = false,
  stopDisabled = false,
  enableUpload = false,
  acceptTypes = '*/*',
  allowMultiple = false,
  maxFileSize = 10 * 1024 * 1024,
  httpRequest,
  autoUpload = true,
  enablePasteUpload = false,
  enableDragUpload = false,
  allowSendWithFiles = false,
  value,
  onChange,
  onSend,
  onFocus,
  onBlur,
  onStop,
  onUpload,
  onUploadError,
  onUploadComplete,
  extras,
  actions
}, ref) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const compositionEndTimeRef = useRef(0);
  const [isFocused, setIsFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [internalPrompt, setInternalPrompt] = useState('');
  const [fileList, setFileList] = useState<FileItem[]>([]);
  const dragLeaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 受控/非受控模式支持
  const prompt = value !== undefined ? value : internalPrompt;
  const setPrompt = (newValue: string) => {
    if (value === undefined) {
      setInternalPrompt(newValue);
    }
    onChange?.(newValue);
  };

  const hasUploadingFiles = useMemo(() =>
    fileList.some(file => file.loading),
    [fileList]
  );

  const validFiles = useMemo(() =>
    fileList.filter(item => !item.error && !item.loading),
    [fileList]
  );

  const hasText = useMemo(() =>
    prompt.trim().length > 0,
    [prompt]
  );

  const canSend = useMemo(() =>
    hasText || (allowSendWithFiles && validFiles.length > 0),
    [hasText, allowSendWithFiles, validFiles.length]
  );

  const buttonDisabled = useMemo(() =>
    disabled || loading || !canSend || hasUploadingFiles,
    [disabled, loading, canSend, hasUploadingFiles]
  );
  const stopButtonDisabled = disabled || stopDisabled;

  const generateUniqueId = useCallback(() => {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }, []);

  const clearFileList = useCallback(() => {
    setFileList(prev => {
      prev.forEach(file => {
        if (file.raw) {
          file.raw = null;
        }
      });
      return [];
    });
  }, []);

  const uploadFile = useCallback((file: File) => {
    const newFile = createFileItem(file, generateUniqueId());

    setFileList(prev => [...prev, newFile]);

    if (!httpRequest) {
      return Promise.resolve();
    }

    return httpRequest(file)
      .then((data) => {
        setFileList(prev => prev.map(item => {
          if (item.vid === newFile.vid) {
            return {
              ...item,
              id: data?.id || '',
              url: data?.url || '',
              loading: false,
              status: FILE_STATUS.SUCCESS,
              raw: null
            };
          }
          return item;
        }));
      })
      .catch((error) => {
        setFileList(prev => prev.map(item => {
          if (item.vid === newFile.vid) {
            return {
              ...item,
              loading: false,
              error: error?.message || t('hubx.bubble.upload_failed'),
              status: FILE_STATUS.ERROR,
              raw: null
            };
          }
          return item;
        }));
      });
  }, [httpRequest, generateUniqueId]);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (!httpRequest) {
      return;
    }

    try {
      const promises = Array.from(files).map((file) => uploadFile(file));
      const results = await Promise.all(promises);
      onUploadComplete?.(results);
    } catch (error: any) {
      onUploadError?.({
        type: 'request',
        message: error.message || t('hubx.bubble.upload_failed'),
        error,
      });
    }
  }, [httpRequest, uploadFile, onUploadComplete, onUploadError]);

  const processFiles = useCallback((files: FileList | File[]) => {
    if (!files || files.length === 0) return;

    const validFilesList: File[] = [];
    const maxSize = maxFileSize;

    Array.from(files).forEach(file => {
      if (file.size > maxSize) {
        showMessage.error(t('hubx.bubble.file_size_limit', { size: Math.round(maxSize / (1024 * 1024)) }));
      } else {
        validFilesList.push(file);
      }
    });

    if (validFilesList.length === 0) return;

    onUpload?.(validFilesList);

    if (autoUpload) {
      uploadFiles(validFilesList);
    }
  }, [maxFileSize, onUpload, autoUpload, uploadFiles]);

  const handleInput = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(event.target.value);
  }, []);

  const handleFocus = useCallback((event: React.FocusEvent<HTMLTextAreaElement>) => {
    setIsFocused(true);
    onFocus?.(event);
  }, [onFocus]);

  const handleBlur = useCallback((event: React.FocusEvent<HTMLTextAreaElement>) => {
    setIsFocused(false);
    onBlur?.(event);
  }, [onBlur]);

  const handleStop = useCallback(() => {
    if (stopButtonDisabled) return;
    onStop?.();
  }, [onStop, stopButtonDisabled]);

  const handleSend = useCallback(() => {
    if (buttonDisabled) return;

    const cleanFiles = validFiles.map(file => ({
      id: file.id,
      vid: file.vid,
      name: file.name,
      size: file.size,
      mime_type: file.mime_type,
      url: file.url,
      status: file.status
    }));

    onSend?.(prompt, cleanFiles);
    setPrompt('');
    clearFileList();
  }, [buttonDisabled, validFiles, prompt, onSend, clearFileList, setPrompt]);

  const handleDelete = useCallback((item: FileItem) => {
    setFileList(prev => prev.filter(file => file.vid !== item.vid));
  }, []);

  const handleSubmit = useCallback(() => {
    handleSend();
  }, [handleSend]);

  const isCompositionActive = useCallback((event?: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const nativeEvent = event?.nativeEvent as KeyboardEvent | undefined;
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    const compositionRecentlyEnded = isSafari && Date.now() - compositionEndTimeRef.current < 20;

    return Boolean(
      event?.isComposing ||
      nativeEvent?.isComposing ||
      nativeEvent?.keyCode === 229 ||
      isComposingRef.current ||
      compositionRecentlyEnded
    );
  }, []);

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
    compositionEndTimeRef.current = Date.now();
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!sendOnEnter || event.key !== 'Enter' || event.shiftKey) return;
    if (isCompositionActive(event)) return;

    event.preventDefault();
    handleSend();
  }, [sendOnEnter, handleSend, isCompositionActive]);

  const handleUploadClick = useCallback(() => {
    if (disabled) return;
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [disabled]);

  const onFileSelected = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    processFiles(files);
    event.target.value = '';
  }, [processFiles]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (!enableDragUpload || disabled) return;

    if (dragLeaveTimerRef.current) {
      clearTimeout(dragLeaveTimerRef.current);
      dragLeaveTimerRef.current = null;
    }

    setIsDragging(true);
    event.dataTransfer.dropEffect = 'copy';
  }, [enableDragUpload, disabled]);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    if (!enableDragUpload || disabled) return;

    if (dragLeaveTimerRef.current) {
      clearTimeout(dragLeaveTimerRef.current);
    }

    dragLeaveTimerRef.current = setTimeout(() => {
      setIsDragging(false);
    }, 50);
  }, [enableDragUpload, disabled]);

  const handleDrop = useCallback((event: React.DragEvent) => {
    if (!enableDragUpload || disabled) return;

    if (dragLeaveTimerRef.current) {
      clearTimeout(dragLeaveTimerRef.current);
      dragLeaveTimerRef.current = null;
    }

    setIsDragging(false);

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      processFiles(files);
    }
  }, [enableDragUpload, disabled, processFiles]);

  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    if (!enablePasteUpload || disabled) return;

    const items = event.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    let hasTextContent = false;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      } else if (item.kind === 'string' && item.type === 'text/plain') {
        hasTextContent = true;
      }
    }

    if (files.length > 0) {
      if (hasTextContent) {
        console.log('检测到文本和文件内容，优先处理文件上传');
      }
      event.preventDefault();
      processFiles(files);
    }
  }, [enablePasteUpload, disabled, processFiles]);

  useImperativeHandle(ref, () => ({
    uploadFiles,
    handleUpload: handleUploadClick,
    setPrompt: (value: string) => setPrompt(value),
    setFileList: (value: FileItem[]) => setFileList(value || []),
    clearState: () => {
      setPrompt('');
      clearFileList();
    }
  }), [uploadFiles, handleUploadClick, clearFileList, setPrompt]);

  useEffect(() => {
    return () => {
      if (dragLeaveTimerRef.current) {
        clearTimeout(dragLeaveTimerRef.current);
      }
      clearFileList();
    };
  }, [clearFileList]);

  const maxLengthValue = maxLength > 0 ? maxLength : undefined;

  return (
    <div
      className={`x-sender ${isFocused ? 'x-sender--focused' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {fileList.length > 0 && (
        <div className="x-sender__file-list">
          {fileList.map(item => (
            <div key={item.vid} className="x-sender__file-item">
              {item.loading ? (
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
              <div className="x-sender__file-delete" onClick={() => handleDelete(item)}>
                <Icon name="delete" />
              </div>
            </div>
          ))}
        </div>
      )}

      {isDragging && enableDragUpload && !disabled && (
        <div className="x-sender__drag-overlay">
          <div className="x-sender__drag-text">{t('hubx.bubble.drag_upload')}</div>
        </div>
      )}

      <div className="x-sender__main">
        <textarea
          ref={textareaRef}
          className="x-sender__textarea"
          value={prompt}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={maxLengthValue}
          onChange={handleInput}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <div className="x-sender__action-bar">
          {extras || <div></div>}
          {actions || (
            <div className="x-sender__action-buttons">
              {enableUpload && (
                <>
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
                  <div style={{ width: '1px', height: '16px', backgroundColor: '#E6E8EB', marginRight: '8px' }}></div>
                </>
              )}
              {loading ? (
                // <Tooltip content={t('hubx.bubble.stop')} placement="top" trigger="hover">
                  <div
                    className={`x-sender__action-button x-sender__action-button--stop ${stopButtonDisabled ? 'x-sender__action-button--disabled' : ''}`}
                    onClick={handleStop}
                  >
                    {!stopButtonDisabled && <div className="x-sender__loading-border"></div>}
                    <Icon name="stop" />
                  </div>
                // </Tooltip>
              ) : (
                // <Tooltip content={t('hubx.bubble.send')} placement="top" trigger="hover">
                  <div
                    className={`x-sender__action-button x-sender__action-button--send ${buttonDisabled ? 'x-sender__action-button--disabled' : ''}`}
                    onClick={handleSubmit}
                  >
                    <Icon name="top" />
                  </div>
                // </Tooltip>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

Sender.displayName = 'xSender';

export default Sender;
