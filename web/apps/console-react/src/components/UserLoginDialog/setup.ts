import { createRoot } from 'react-dom/client'
import UserLoginDialogComponent, { type UserLoginDialogRef } from './index'

interface UserLoginDialogInstance {
  open: () => void
  close: () => void
  reset: () => void
  destroy: () => void
}

/**
 * Create a UserLoginDialog imperatively
 * @example
 * const loginDialog = showUserLoginDialog()
 * loginDialog.open()
 * // After login: loginDialog.destroy()
 */
export default function showUserLoginDialog(): UserLoginDialogInstance {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  let instance: UserLoginDialogRef | null = null

  const Component = (
    <UserLoginDialogComponent
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
    reset: () => instance?.reset(),
    destroy,
  }
}
