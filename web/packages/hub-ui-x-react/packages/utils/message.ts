/**
 * 显示消息提示
 * @param options 配置项或消息文本
 */
export interface MessageOptions {
  message?: string;
  type?: 'success' | 'warning' | 'info' | 'error' | 'primary' ;
  duration?: number;
  showClose?: boolean;
  offset?: number;
  customClass?: string;
  onClose?: () => void;
}

export function showMessage(options: MessageOptions | string): void {
  const opt: MessageOptions = typeof options === 'string' ? { message: options } : options;

  // 创建提示元素
  const toast = document.createElement('div');
  toast.className = `x-message ${opt.type ? `x-message--${opt.type}` : ''} ${opt.customClass || ''}`;

  // 设置内容
  const content = document.createElement('p');
  content.className = 'x-message__content';
  content.textContent = opt.message || '';
  toast.appendChild(content);

  // 添加关闭按钮
  if (opt.showClose) {
    const closeBtn = document.createElement('div');
    closeBtn.className = 'x-message__closeBtn';
    closeBtn.innerHTML = '×';
    closeBtn.onclick = () => close();
    toast.appendChild(closeBtn);
  }

  // 基础样式
  toast.style.position = 'fixed';
  toast.style.top = `${(opt.offset || 20)}px`;
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.padding = '8px 15px';
  toast.style.borderRadius = '4px';
  toast.style.overflow = 'hidden';
  toast.style.transition = 'opacity 0.3s, transform .4s, top 0.4s';
  toast.style.zIndex = '9999';

  // 类型样式
  switch (opt.type) {
    case 'success':
      toast.style.backgroundColor = 'rgb(239.8, 248.9, 235.3)';
      toast.style.color = '#67C23A';
      toast.style.border = '1px solid rgb(224.6, 242.8, 215.6)';
      break;
    case 'warning':
      toast.style.backgroundColor = 'rgb(252.5, 245.7, 235.5)';
      toast.style.color = '#E6A23C';
      toast.style.border = '1px solid rgb(250, 236.4, 216)';
      break;
    case 'error':
      toast.style.backgroundColor = '#FEF0F0';
      toast.style.color = '#F56C6C';
      toast.style.border = '1px solid #FBCDBB';
      break;
    case 'primary':
      toast.style.backgroundColor = 'rgb(235.9, 245.3, 255)';
      toast.style.color = '#409EFF';
      toast.style.border = '1px solid rgb(216.8, 235.6, 255)';
      break;
    default:
      toast.style.backgroundColor = '#909399';
      toast.style.color = '#fff';
      toast.style.border = '1px solid #DCDFE6';
  }

  // 添加到文档
  document.body.appendChild(toast);

  // 触发重绘以应用过渡效果
  toast.offsetHeight;
  toast.style.transform = 'translate(-50%, 0)';

  // 关闭函数
  const close = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, -100%)';
    setTimeout(() => {
      if (document.body.contains(toast)) {
        document.body.removeChild(toast);
        opt.onClose?.();
      }
    }, 400);
  };

  // 自动关闭
  if (opt.duration !== 0) {
    setTimeout(close, opt.duration || 3000);
  }
}

// 快捷方法
showMessage.primary = (message: string) => showMessage({ message, type: 'primary' });
showMessage.success = (message: string) => showMessage({ message, type: 'success' });
showMessage.warning = (message: string) => showMessage({ message, type: 'warning' });
showMessage.error = (message: string) => showMessage({ message, type: 'error' });
showMessage.info = (message: string) => showMessage({ message, type: 'info' });
