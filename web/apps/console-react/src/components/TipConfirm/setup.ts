import { createRoot } from 'react-dom/client'
import TipConfirmComponent, { type TipConfirmRef, type TipConfirmProps } from './index'

interface TipConfirmOptions {
  title: string
  content: string
  confirmButtonText?: string
  cancelButtonText?: string
  showConfirmButton?: boolean
  showCancelButton?: boolean
  onConfirm?: () => void
  onCancel?: () => void
}

interface TipConfirmInstance {
  open: () => void
  close: () => void
  destroy: () => void
}

/**
 * Create a TipConfirm dialog imperatively
 * @example
 * const dialog = showTipConfirm({
 *   title: '确认删除',
 *   content: '删除后无法恢复，确定要删除吗？',
 *   onConfirm: () => console.log('confirmed'),
 * })
 * dialog.open()
 * // Later: dialog.destroy()
 */
export default function showTipConfirm(options: TipConfirmOptions): TipConfirmInstance {
  const {
    title,
    content,
    confirmButtonText = window.$t?.('action.confirm') || '确认',
    cancelButtonText = window.$t?.('action.cancel') || '取消',
    showConfirmButton = true,
    showCancelButton = true,
    onConfirm,
    onCancel,
  } = options

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  let instance: TipConfirmRef | null = null

  const props: TipConfirmProps = {
    title,
    content,
    confirmButtonText,
    cancelButtonText,
    showConfirmButton,
    showCancelButton,
    onConfirm: () => {
      onConfirm?.()
      destroy()
    },
    onCancel: () => {
      onCancel?.()
      destroy()
    },
  }

  const Component = (
    <TipConfirmComponent
      {...props}
      ref={(ref) => {
        instance = ref
        if (ref) {
          // Auto open after mount
          setTimeout(() => ref.open(), 0)
        }
      }}
    />
  )

  root.render(Component)

  const destroy = () => {
    instance?.close()
    setTimeout(() => {
      root.unmount()
      container.remove()
    }, 300)
  }

  return {
    open: () => instance?.open(),
    close: () => instance?.close(),
    destroy,
  }
}
