const DEFAULT_IMG = '/images/default_agent.png'

const failedUrls = new Set<string>()

function getFallback(url?: string): string {
  if (url) return url
  if (typeof window !== 'undefined' && (window as any).$getRealPath) {
    return (window as any).$getRealPath({ url: DEFAULT_IMG })
  }
  return DEFAULT_IMG
}

function applyFallback(img: HTMLImageElement, url?: string) {
  const fallback = getFallback(url)
  img.dataset.fallback = fallback

  if (!img.src || img.src === window.location.href || failedUrls.has(img.src)) {
    img.src = fallback
  }

  if (img.complete && img.naturalWidth === 0) {
    failedUrls.add(img.src)
    img.src = fallback
  }

  const onError = (e: Event) => {
    const target = e.target as HTMLImageElement
    const currentSrc = target.src
    const currentFallback = target.dataset.fallback || getFallback(url)
    if (currentSrc.endsWith(currentFallback)) return
    failedUrls.add(currentSrc)
    target.src = currentFallback
  }

  img.removeEventListener('error', onError)
  img.addEventListener('error', onError)
}

function findAndApply(el: HTMLElement, url?: string): boolean {
  const img = el.tagName === 'IMG' ? (el as HTMLImageElement) : (el.querySelector('img') as HTMLImageElement | null)
  if (img) {
    applyFallback(img, url)
    return true
  }
  return false
}

export function attachDefaultImg(el: HTMLElement, options?: { url?: string }) {
  const url = options?.url
  if (findAndApply(el, url)) return

  const observer = new MutationObserver(() => {
    if (findAndApply(el, url)) {
      observer.disconnect()
    }
  })
  observer.observe(el, { childList: true, subtree: true })
  ;(el as any).__defaultImgObserver = observer
}

export function detachDefaultImg(el: HTMLElement) {
  const obs: MutationObserver | undefined = (el as any).__defaultImgObserver
  if (obs) {
    obs.disconnect()
    delete (el as any).__defaultImgObserver
  }
}

