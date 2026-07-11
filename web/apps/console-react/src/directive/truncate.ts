type TruncateOptions = {
  node: string
  showTotal?: boolean
  showTooltip?: boolean
  showRemainder?: boolean
  offset?: number
}

function setElementStyle(el: Element | null, styleConfig: Record<string, string>) {
  if (!el) return
  el.setAttribute(
    'style',
    Object.entries(styleConfig)
      .map(([key, val]) => `${key}:${val};`)
      .join(''),
  )
}

export function applyTruncate(el: HTMLElement, options: TruncateOptions) {
  const {
    node,
    showTotal = false,
    showTooltip = false,
    showRemainder = false,
    offset = 12,
  } = options

  el.style.display = 'flex'
  ;(el.style as any).itemsAlign = 'center'
  el.style.overflow = 'hidden'
  el.style.textOverflow = 'ellipsis'
  el.style.whiteSpace = 'nowrap'

  const childNodeList = (node && el.querySelectorAll(node)) || el.childNodes || []
  const nodeList: Element[] = []
  for (let i = 0; i < childNodeList.length; i++) {
    const nodeEl = childNodeList[i] as Element
    if (
      Array.from(nodeEl.classList || [])
        .map((val) => `.${val}`)
        .some((className) => className === node)
    ) {
      nodeList.push(nodeEl)
    }
  }
  const nodeTotal = nodeList.length

  let suffixEl: Element | null = el.querySelector(`${node}--suffix`)
  if (suffixEl && el.contains(suffixEl)) {
    el.removeChild(suffixEl)
    suffixEl = null
  }

  if (!nodeTotal) return
  const containerWidth = el.clientWidth
  let nodeTotalWidth = 0
  let remainderCount = 0
  let isOverFlag = false
  const nodeStyleConfig: Record<string, string> = {
    display: 'inline-block',
    flex: 'none',
    width: 'max-content',
    overflow: 'hidden',
    'text-overflow': 'ellipsis',
    'white-space': 'nowrap',
  }

  nodeList.forEach((nodeEl) => {
    const nodeWidth = Number(nodeEl.clientWidth) || 0
    nodeTotalWidth += nodeWidth
    if (nodeTotalWidth > containerWidth - offset || !nodeWidth) {
      if (!isOverFlag) suffixEl = nodeEl.cloneNode() as Element
      nodeStyleConfig.visibility = 'hidden'
      nodeStyleConfig.position = 'absolute'
      isOverFlag = true
      remainderCount++
    }
    el.title = (el.title || '') + (nodeEl as HTMLElement).innerText
    setElementStyle(nodeEl, nodeStyleConfig)
  })

  if (!isOverFlag || !showTooltip) el.removeAttribute('title')

  if (!suffixEl && (showTotal || showRemainder) && nodeList[0]) {
    suffixEl = nodeList[0].cloneNode() as Element
  }
  if (suffixEl) {
    for (let i = 0; i < suffixEl.classList.length; i++) {
      const cls = suffixEl.classList.item(i)
      if (
        cls &&
        [node.replace(/\./gim, ''), `${node.replace(/\./gim, '')}--suffix`].includes(cls)
      ) {
        suffixEl.classList.remove(cls)
      }
    }
    suffixEl.classList.add(`${node.replace(/\./gim, '')}--suffix`)
    const suffixText = `${
      showRemainder && remainderCount ? `+${remainderCount}` : ''
    }${isOverFlag ? '...' : ''}${showTotal ? `(${nodeTotal})` : ''}`
    ;(suffixEl as HTMLElement).innerHTML = suffixText
    setElementStyle(suffixEl, {
      flex: 'none',
      width: 'max-content',
    })
    if (suffixText) el.appendChild(suffixEl)
  }
}

export function attachTruncate(el: HTMLElement, options: TruncateOptions) {
  applyTruncate(el, options)
  const observer = new ResizeObserver((entries) => {
    entries.forEach((entry) => {
      applyTruncate(entry.target as HTMLElement, options)
    })
  })
  observer.observe(el)
  ;(el as any).__truncateObserver = observer
}

export function detachTruncate(el: HTMLElement) {
  const obs: ResizeObserver | undefined = (el as any).__truncateObserver
  if (obs) {
    obs.disconnect()
    delete (el as any).__truncateObserver
  }
}

