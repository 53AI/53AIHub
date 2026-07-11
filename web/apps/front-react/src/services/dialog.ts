import { createRoot } from 'react-dom/client'
import React from 'react'
import Dialog from '@/components/UI/Dialog'

export interface DialogOptions {
  title?: string
  label?: string
  content?: string
}

export function createDialog(options: DialogOptions): Promise<any> {
  return new Promise((resolve, reject) => {
    // 创建容器元素
    const container = document.createElement('div')
    document.body.appendChild(container)

    // 创建 React root
    const root = createRoot(container)

    const handleConfirm = (data: any) => {
      resolve(data)
      // 销毁组件
      root.unmount()
      container.remove()
    }

    const handleCancel = () => {
      reject(new Error('Dialog cancelled'))
      // 销毁组件
      root.unmount()
      container.remove()
    }

    // 渲染 Dialog 组件
    root.render(
      React.createElement(Dialog, {
        ref: (ref: any) => {
          if (ref) {
            ref.open({
              title: options.title || '',
              label: options.label || '',
              content: options.content || '',
            })
          }
        },
        onConfirm: handleConfirm,
        onCancel: handleCancel,
      })
    )
  })
}

// 初始化全局对话框服务
export function initDialogService() {
  if (typeof window !== 'undefined') {
    // 确保 window.agenthub 存在
    window.agenthub = window.agenthub || {}

    // 添加 dialog 方法
    window.agenthub.dialog = (options: DialogOptions) => {
      return createDialog(options)
    }
  }
}