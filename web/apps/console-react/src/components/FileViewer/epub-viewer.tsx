import { Spin, Button, message } from 'antd'
import {
  LeftOutlined,
  RightOutlined,
  MinusOutlined,
  PlusOutlined,
  UnorderedListOutlined,
  CloseOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import loadLib from '@/utils/loadLib'

interface EpubViewerProps {
  url: string
}

export function EpubViewer({ url }: EpubViewerProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fontSize, setFontSize] = useState(100)
  const [showToc, setShowToc] = useState(false)
  const [canGoPrev, setCanGoPrev] = useState(false)
  const [canGoNext, setCanGoNext] = useState(false)
  const [currentTitle, setCurrentTitle] = useState('加载中...')
  const [tocItems, setTocItems] = useState<any[]>([])
  const [activeTocItem, setActiveTocItem] = useState('')

  const bookRef = useRef<any>(null)
  const renditionRef = useRef<any>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const spineItemsRef = useRef<string[]>([])
  const useTocRef = useRef(true)

  const isMobile = useMemo(() => typeof window !== 'undefined' && window.innerWidth <= 768, [])

  const getViewportSize = useCallback(() => {
    return {
      width: window.innerWidth - (window.innerWidth > 768 ? 256 : 0),
      height: window.innerHeight - 120, // minus toolbar height
    }
  }, [])

  const applyFontSize = useCallback(() => {
    if (!renditionRef.current) return

    try {
      const iframes = document.querySelectorAll('#epub-viewport iframe')
      iframes.forEach((iframe) => {
        try {
          const doc =
            (iframe as HTMLIFrameElement).contentDocument || (iframe as HTMLIFrameElement).contentWindow?.document
          if (doc) {
            let fontStyle = doc.getElementById('epub-font-size')
            if (!fontStyle) {
              fontStyle = doc.createElement('style')
              fontStyle.id = 'epub-font-size'
              doc.head.appendChild(fontStyle)
            }
            fontStyle.textContent = `
              body { font-size: ${fontSize}% !important; }
              p, div, span { font-size: inherit !important; }
            `
          }
        } catch (e) {
          console.warn('无法调整字体大小:', e)
        }
      })
    } catch (err) {
      console.warn('应用字体大小失败:', err)
    }
  }, [fontSize])

  const getTitleFromLocation = useCallback((location: any): string => {
    if (!location || !location.href) return '无标题'

    if (useTocRef.current && tocItems.length > 0) {
      const hrefNoHash = location.href.split('#')[0]
      const tocItem = tocItems.find((item) => {
        const itemHref = item.href ? item.href.split('#')[0] : ''
        return itemHref === hrefNoHash
      })
      if (tocItem) {
        return tocItem.label
      }
    }

    // Use filename as title
    const filename = location.href.split('/').pop()?.split('#')[0]
    return filename || '无标题'
  }, [tocItems])

  const updateNavButtons = useCallback(async () => {
    const rendition = renditionRef.current
    if (!rendition) return

    try {
      // Wait for location info
      if (rendition.locations && typeof rendition.locations.then === 'function') {
        await rendition.locations
          .then(() => {
            setTimeout(() => {
              try {
                const location = rendition.location
                if (location) {
                  setCanGoPrev(!location.atStart)
                  setCanGoNext(!location.atEnd)
                } else {
                  setCanGoPrev(true)
                  setCanGoNext(true)
                }
              } catch (e) {
                console.warn('更新导航按钮状态失败:', e)
                setCanGoPrev(true)
                setCanGoNext(true)
              }
            }, 100)
          })
          .catch(() => {
            setCanGoPrev(true)
            setCanGoNext(true)
          })
      } else {
        try {
          const location = rendition.location
          if (location) {
            setCanGoPrev(!location.atStart)
            setCanGoNext(!location.atEnd)
          } else {
            setCanGoPrev(true)
            setCanGoNext(true)
          }
        } catch (e) {
          setCanGoPrev(true)
          setCanGoNext(true)
        }
      }
    } catch (err) {
      console.warn('更新导航按钮失败:', err)
      setCanGoPrev(true)
      setCanGoNext(true)
    }
  }, [])

  const bindRenditionEvents = useCallback(() => {
    const rendition = renditionRef.current
    if (!rendition) return

    rendition.on('relocated', (location: any) => {
      setCurrentTitle(getTitleFromLocation(location.start))
      updateNavButtons()
      if (location.start?.href) {
        setActiveTocItem(location.start.href.split('#')[0])
      }
    })

    rendition.on('rendered', () => {
      updateNavButtons()
    })
  }, [getTitleFromLocation, updateNavButtons])

  const renderBook = useCallback(async () => {
    const book = bookRef.current
    if (!book || !viewportRef.current) return

    if (renditionRef.current) {
      renditionRef.current.destroy()
      renditionRef.current = null
    }

    const size = getViewportSize()

    try {
      const rendition = book.renderTo('epub-viewport', {
        width: size.width,
        height: size.height,
        flow: 'paginated',
        manager: 'default',
        styles: {
          'font-size': `${fontSize}%`,
        },
        allowScriptedContent: true,
        sandbox: ['allow-same-origin', 'allow-scripts'],
      })
      renditionRef.current = rendition

      let displayPromise
      if (useTocRef.current && tocItems.length > 0) {
        displayPromise = rendition.display(tocItems[0].href)
      } else if (spineItemsRef.current.length > 0) {
        displayPromise = rendition.display(spineItemsRef.current[0])
      } else {
        displayPromise = rendition.display()
      }

      await displayPromise

      // Set title and current position
      if (useTocRef.current && tocItems.length > 0) {
        setCurrentTitle(tocItems[0].label || '第一章')
        setActiveTocItem(tocItems[0].href?.split('#')[0] || '')
      } else if (spineItemsRef.current.length > 0) {
        setCurrentTitle(book.metadata?.title || 'EPUB内容已加载')
        setActiveTocItem(spineItemsRef.current[0])
      } else {
        setCurrentTitle(book.metadata?.title || 'EPUB内容已加载')
        try {
          const location = rendition.currentLocation()
          if (location?.start?.href) {
            setActiveTocItem(location.start.href.split('#')[0])
          }
        } catch (e) {
          console.warn('获取初始位置失败:', e)
        }
      }

      bindRenditionEvents()
      await updateNavButtons()
    } catch (err) {
      console.error('渲染失败:', err)
      throw err
    }
  }, [fontSize, tocItems, getViewportSize, bindRenditionEvents, updateNavButtons])

  const loadEpub = useCallback(async () => {
    if (!url) {
      setError('EPUB文件URL不能为空')
      return
    }

    try {
      setLoading(true)
      setError('')

      // Load ePub.js library
      await loadLib('epub')

      if (typeof (window as any).ePub === 'undefined') {
        throw new Error('ePub.js 库加载失败')
      }

      const book = (window as any).ePub(url, {
        restore: true,
        requestMethod: 'GET',
        requestCredentials: 'omit',
      })
      bookRef.current = book

      await book.ready

      // Load spine items
      spineItemsRef.current = []
      if (book.spine && book.spine.each) {
        book.spine.each((item: any) => {
          if (item && item.href) {
            spineItemsRef.current.push(item.href.split('#')[0])
          }
        })
      }

      // Load TOC
      if (book.navigation?.toc?.length > 0) {
        setTocItems(book.navigation.toc)
        useTocRef.current = true
      } else {
        useTocRef.current = false
      }

      await renderBook()
    } catch (err) {
      console.error('EPUB加载失败:', err)
      setError(err instanceof Error ? err.message : 'EPUB加载失败')
    } finally {
      setLoading(false)
    }
  }, [url, renderBook])

  const handlePrev = useCallback(async () => {
    if (!renditionRef.current || !canGoPrev) return

    try {
      if (useTocRef.current && tocItems.length > 0) {
        await renditionRef.current.prev()
      } else if (spineItemsRef.current.length > 0) {
        const currentLocation = renditionRef.current.currentLocation()
        if (currentLocation && currentLocation.start) {
          const currentHref = currentLocation.start.href?.split('#')[0] || ''
          const currentIndex = spineItemsRef.current.findIndex((href) => href === currentHref)
          if (currentIndex > 0) {
            await renditionRef.current.display(spineItemsRef.current[currentIndex - 1])
          } else {
            await renditionRef.current.prev()
          }
        } else {
          await renditionRef.current.prev()
        }
      } else {
        await renditionRef.current.prev()
      }
      setTimeout(updateNavButtons, 200)
    } catch (err) {
      console.error('上一页失败:', err)
      message.error('无法翻到上一页')
    }
  }, [canGoPrev, tocItems, updateNavButtons])

  const handleNext = useCallback(async () => {
    if (!renditionRef.current || !canGoNext) return

    try {
      if (useTocRef.current && tocItems.length > 0) {
        await renditionRef.current.next()
      } else if (spineItemsRef.current.length > 0) {
        const currentLocation = renditionRef.current.currentLocation()
        if (currentLocation && currentLocation.start) {
          const currentHref = currentLocation.start.href?.split('#')[0] || ''
          const currentIndex = spineItemsRef.current.findIndex((href) => href === currentHref)
          if (currentIndex >= 0 && currentIndex < spineItemsRef.current.length - 1) {
            await renditionRef.current.display(spineItemsRef.current[currentIndex + 1])
          } else {
            await renditionRef.current.next()
          }
        } else {
          await renditionRef.current.next()
        }
      } else {
        await renditionRef.current.next()
      }
      setTimeout(updateNavButtons, 200)
    } catch (err) {
      console.error('下一页失败:', err)
      message.error('无法翻到下一页')
    }
  }, [canGoNext, tocItems, updateNavButtons])

  const increaseFontSize = useCallback(() => {
    setFontSize((prev) => Math.min(prev + 10, 200))
    setTimeout(applyFontSize, 100)
  }, [applyFontSize])

  const decreaseFontSize = useCallback(() => {
    setFontSize((prev) => Math.max(prev - 10, 50))
    setTimeout(applyFontSize, 100)
  }, [applyFontSize])

  const navigateToToc = useCallback((item: any) => {
    if (renditionRef.current && item.href) {
      renditionRef.current
        .display(item.href)
        .then(() => {
          setCurrentTitle(item.label)
          setActiveTocItem(item.href.split('#')[0])
          if (isMobile) {
            setShowToc(false)
          }
        })
        .catch((err: any) => {
          console.error('导航失败:', err)
          message.error('导航失败')
        })
    }
  }, [isMobile])

  useEffect(() => {
    loadEpub()
  }, [loadEpub])

  useEffect(() => {
    let resizeTimeout: NodeJS.Timeout | null = null
    const handleResize = () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }
      resizeTimeout = setTimeout(() => {
        if (renditionRef.current) {
          const size = getViewportSize()
          renditionRef.current.resize(size.width, size.height)
        }
      }, 250)
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }
    }
  }, [getViewportSize])

  useEffect(() => {
    return () => {
      if (renditionRef.current) {
        renditionRef.current.destroy()
      }
    }
  }, [])

  if (error) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-white">
        <WarningOutlined className="text-6xl text-red-500 mb-4" />
        <h3 className="text-lg font-medium mb-2">加载失败</h3>
        <p className="text-gray-600 mb-4">{error}</p>
        <Button type="primary" onClick={loadEpub}>
          重试
        </Button>
      </div>
    )
  }

  return (
    <div className="h-full w-full flex flex-col bg-white font-sans">
      <div className="flex-1 flex relative">
        {/* TOC Panel */}
        {showToc && (
          <div
            className={`w-64 bg-white border-r shadow-lg overflow-y-auto ${isMobile ? 'fixed inset-y-0 left-0 z-50' : ''}`}
            style={{ maxHeight: 'calc(100vh - 120px)' }}
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium">目录</h3>
                <Button icon={<CloseOutlined />} onClick={() => setShowToc(false)} />
              </div>
              <ul className="space-y-1">
                {tocItems.map((item, index) => (
                  <li
                    key={index}
                    className={`cursor-pointer p-2 rounded hover:bg-gray-100 ${
                      activeTocItem === item.href?.split('#')[0] ? 'bg-blue-100 text-blue-600' : ''
                    }`}
                    onClick={() => navigateToToc(item)}
                  >
                    {item.label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Content */}
        <div id="epub-viewport" ref={viewportRef} className="flex-1 overflow-hidden bg-white" />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-t">
        <div className="flex items-center space-x-2">
          <Button disabled={!canGoPrev} onClick={handlePrev} icon={<LeftOutlined />} />
          <Button disabled={!canGoNext} onClick={handleNext} icon={<RightOutlined />} />
        </div>

        <div className="flex items-center space-x-2">
          <Button icon={<MinusOutlined />} onClick={decreaseFontSize} />
          <span className="text-sm text-gray-600">{fontSize}%</span>
          <Button icon={<PlusOutlined />} onClick={increaseFontSize} />
          <Button icon={<UnorderedListOutlined />} onClick={() => setShowToc(!showToc)} />
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center">
          <Spin />
          <span className="ml-2">加载中...</span>
        </div>
      )}
    </div>
  )
}

export default EpubViewer
