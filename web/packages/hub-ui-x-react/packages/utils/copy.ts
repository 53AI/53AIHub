import { showMessage } from './message';
import { t } from '../locale';

/**
 * 优化的复制到剪贴板功能
 * 支持现代浏览器API和降级处理
 */

// 复制成功后的回调函数类型
type CopyCallback = (success: boolean, text: string) => void;

/**
 * 复制文本到剪贴板
 * @param text 要复制的文本
 * @param callback 可选的回调函数
 * @returns Promise 复制操作的结果
 */
export function copyToClip(text: string, callback?: CopyCallback): Promise<string> {
  return new Promise((resolve, reject) => {
    // 尝试使用现代Clipboard API
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text)
        .then(() => {
          showMessage.success(t('hubx.bubble.copied'));
          if (callback) callback(true, text);
          resolve(text);
        })
        .catch((error) => {
          console.error('使用Clipboard API复制失败:', error);
          // 降级到传统方法
          fallbackCopyToClipboard(text, callback, resolve, reject);
        });
    } else {
      // 降级到传统方法
      fallbackCopyToClipboard(text, callback, resolve, reject);
    }
  });
}

/**
 * 降级的复制方法，使用document.execCommand
 */
function fallbackCopyToClipboard(
  text: string,
  callback?: CopyCallback,
  resolve?: (value: string | PromiseLike<string>) => void,
  reject?: (reason?: any) => void
): void {
  try {
    const input: HTMLTextAreaElement = document.createElement('textarea');
    input.setAttribute('readonly', 'readonly');
    input.value = text;
    input.style.position = 'absolute';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.select();
    const success = document.execCommand('copy');
    document.body.removeChild(input);

    if (success) {
      showMessage.success(t('hubx.bubble.copied'));
      if (callback) callback(true, text);
      if (resolve) resolve(text);
    } else {
      if (callback) callback(false, text);
      if (reject) reject(new Error('复制失败'));
    }
  } catch (error) {
    console.error('复制到剪贴板失败:', error);
    if (callback) callback(false, text);
    if (reject) reject(error);
  }
}
