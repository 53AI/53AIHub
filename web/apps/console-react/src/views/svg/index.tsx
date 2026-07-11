import { useEffect, useState } from 'react'
import { SvgIcon } from '@km/shared-components-react'

export function SvgPage() {
  const [lists, setLists] = useState<string[]>([])

  useEffect(() => {
    const loadSvgList = () => {
      const svgs = document.querySelectorAll('#__svg__icons__dom__ symbol')
      const names: string[] = []
      Array.from(svgs).forEach((item) => {
        const id = item.getAttribute('id')
        if (id) {
          const name = id.replace('icon-', '')
          names.push(name)
        }
      })
      setLists(names)
    }

    // 如果已加载，直接获取
    if ((window as any).__svg_icons_loaded__) {
      loadSvgList()
      return
    }

    // 监听加载完成事件
    const handleLoaded = () => {
      loadSvgList()
    }
    window.addEventListener('svg-icons-loaded', handleLoaded)

    return () => {
      window.removeEventListener('svg-icons-loaded', handleLoaded)
    }
  }, [])

  return (
    <div className="w-full h-full overflow-auto">
    <div className="flex flex-wrap gap-4 p-6">
      {lists.map((name) => (
        <div key={name} className="flex flex-col items-center gap-2 p-4 border rounded hover:bg-gray-50">
          <SvgIcon name={name} width="30px" height="30px" color="#182B50" />
          <span className="text-xs text-gray-500">{name}</span>
        </div>
      ))}
    </div>
    </div>
  )
}

export default SvgPage