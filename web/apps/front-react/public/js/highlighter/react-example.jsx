import React, { useEffect, useRef } from 'react'

const HighlighterDemo = () => {
  const contentRef = useRef(null)
  const restrictedRef = useRef(null)
  const highlighterRef = useRef(null)

  useEffect(() => {
    if (!contentRef.current || !window.TextHighlighter) return

    // 初始化高亮插件
    highlighterRef.current = new window.TextHighlighter({
      container: contentRef.current,
      restrictSelector: '.restricted-area',
      enableAutoHighlight: true,
      enableManualHighlight: true,
      menuItems: [
        {
          label: '复制',
          handler: (info) => {
            navigator.clipboard.writeText(info.text)
            alert('已复制: ' + info.text)
          }
        },
        {
          label: '翻译',
          background: '#2196F3',
          color: '#fff',
          handler: (info) => {
            alert('翻译: ' + info.text)
          }
        },
        {
          label: '搜索',
          background: '#4CAF50',
          color: '#fff',
          handler: (info) => {
            window.open('https://www.google.com/search?q=' + encodeURIComponent(info.text))
          }
        }
      ],
      onHighlight: (info) => {
        console.log('高亮事件:', info)
      },
      onMenuClick: (data) => {
        console.log('菜单点击:', data)
      }
    })

    // 清理函数
    return () => {
      if (highlighterRef.current) {
        highlighterRef.current.destroy()
        highlighterRef.current = null
      }
    }
  }, [])

  const updateMenu = () => {
    if (!highlighterRef.current) return
    highlighterRef.current.updateMenuItems([
      {
        label: '新菜单1',
        handler: (info) => alert('新菜单1: ' + info.text)
      },
      {
        label: '新菜单2',
        handler: (info) => alert('新菜单2: ' + info.text)
      }
    ])
  }

  const refresh = () => {
    if (!highlighterRef.current) return
    highlighterRef.current.refresh()
  }

  const destroy = () => {
    if (highlighterRef.current) {
      highlighterRef.current.destroy()
      highlighterRef.current = null
    }
  }

  return (
    <div className="highlighter-demo" style={{ maxWidth: '800px', margin: '0 auto', padding: '20px' }}>
      <h1>React 中使用划词高亮插件</h1>

      <div ref={contentRef} className="content-area" style={{
        border: '1px solid #ddd',
        padding: '20px',
        margin: '20px 0',
        borderRadius: '4px',
        background: '#fafafa'
      }}>
        <h2>示例内容</h2>
        <p>这是一个在 React 中使用划词高亮插件的示例。</p>
        <p>你可以将鼠标悬停在段落上，或者手动选择文本来触发高亮功能。</p>

        <div ref={restrictedRef} className="restricted-area" style={{
          background: '#fff',
          padding: '15px',
          border: '2px dashed #4CAF50',
          borderRadius: '4px',
          margin: '20px 0'
        }}>
          <h3>限制区域</h3>
          <p>只有在这个区域内才能进行划词高亮。</p>
        </div>

        <div>
          <h2>Markdown 内容示例</h2>
          <p>这是一段 Markdown 渲染后的内容。</p>
          <p>插件可以自动识别这些段落元素。</p>
          <ul>
            <li>列表项 1</li>
            <li>列表项 2</li>
            <li>列表项 3</li>
          </ul>
        </div>
      </div>

      <div className="controls" style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
        <button onClick={updateMenu} style={{
          padding: '8px 16px',
          border: '1px solid #ddd',
          background: '#fff',
          borderRadius: '4px',
          cursor: 'pointer'
        }}>
          更新菜单
        </button>
        <button onClick={refresh} style={{
          padding: '8px 16px',
          border: '1px solid #ddd',
          background: '#fff',
          borderRadius: '4px',
          cursor: 'pointer'
        }}>
          刷新段落识别
        </button>
        <button onClick={destroy} style={{
          padding: '8px 16px',
          border: '1px solid #ddd',
          background: '#fff',
          borderRadius: '4px',
          cursor: 'pointer'
        }}>
          销毁插件
        </button>
      </div>
    </div>
  )
}

export default HighlighterDemo

