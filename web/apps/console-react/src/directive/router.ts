let routing = false

export type RouterAction =
  | { type: 'push'; to: string }
  | { type: 'back' }

export function createRouterHandler(
  navigate: (to: string) => void,
  back: () => void,
  cooldown = 1000,
) {
  return (action: RouterAction) => {
    if (routing) return
    routing = true

    if (action.type === 'push') {
      navigate(action.to)
    } else if (action.type === 'back') {
      back()
    }

    const timer = setTimeout(() => {
      routing = false
      clearTimeout(timer)
    }, cooldown)
  }
}

