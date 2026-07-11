import { useState, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Modal, Radio, Button } from 'antd'
import platformSettingsApi from '@/api/modules/platform-settings'
import { transformPlatformSetting } from '@/api/modules/platform-settings/transform'
import type { PlatformSetting } from '@/api/modules/platform-settings/types'
import { getSimpleParserConfigs } from '@/constants/parser'

const parserConfigs = getSimpleParserConfigs()

interface ParserProps {
  ext: string
  onConfirm?: (value: string) => void
}

export interface ParserRef {
  open: (type: string) => void
}

export const Parser = forwardRef<ParserRef, ParserProps>(({ ext, onConfirm }, ref) => {
  const [visible, setVisible] = useState(false)
  const [settingsMap, setSettingsMap] = useState<Record<string, PlatformSetting | null>>({})
  const [parserValue, setParserValue] = useState('default')

  const availableParserConfigs = useMemo(() => {
    if (ext) {
      return parserConfigs.filter(config =>
        config.supportedExts ? config.supportedExts.includes(ext) : true
      )
    }
    return parserConfigs
  }, [ext])

  const loadAllParserSettings = useCallback(async () => {
    const res = await platformSettingsApi.find()
    const map: Record<string, PlatformSetting | null> = {}
    res.forEach(item => {
      const config = parserConfigs.find(c => c.platform_key === item.platform_key)
      if (config) {
        map[config.key] = transformPlatformSetting(item)
      }
    })
    setSettingsMap(map)
    return map
  }, [])

  const handleSelect = (key: string) => {
    setParserValue(key)
  }

  const handleCancel = () => {
    setVisible(false)
  }

  const handleConfirm = () => {
    setVisible(false)
    onConfirm?.(parserValue)
  }

  useImperativeHandle(ref, () => ({
    open: (type: string) => {
      if (!type) {
        setParserValue('default')
      }
      setVisible(true)
      loadAllParserSettings().then((map) => {
        if (map[type]) {
          setParserValue(type)
        }
      })
    }
  }))

  return (
    <Modal
      open={visible}
      title="重新解析"
      width={400}
      onCancel={handleCancel}
      footer={
        <>
          <Button onClick={handleCancel}>取消</Button>
          <Button type="primary" onClick={handleConfirm}>确定</Button>
        </>
      }
    >
      <p className="text-sm text-[#4F5052]">选择解析方法，重新解析后语料切片将重新索引</p>
      <div className="space-y-2.5 mt-2">
        <div
          className={`border rounded-md p-3 cursor-pointer ${parserValue === 'default' ? 'border-[#2563EB] bg-[#F5F9FF]' : ''}`}
          onClick={() => handleSelect('default')}
        >
          <div className="flex items-center gap-2">
            <img className="size-4" src={parserConfigs.find(c => c.key === 'default')?.icon} alt="" />
            <p className="flex-1 text-sm text-[#1D1E1F]">标准解析</p>
            <Radio checked={parserValue === 'default'} />
          </div>
          <p className="text-xs text-[#9A9A9A] mt-1">识别文件内文字信息，满足基础文本解析需求</p>
        </div>
        {availableParserConfigs.map(config => {
          if (config.key === 'default') return null
          if (!settingsMap[config.key]) return null

          return (
            <div
              key={config.key}
              className={`border rounded-md p-3 cursor-pointer ${parserValue === config.key ? 'border-[#2563EB] bg-[#F5F9FF]' : ''}`}
              onClick={() => handleSelect(config.key)}
            >
              <div className="flex items-center gap-2">
                <img className="size-4" src={config.icon} alt="" />
                <p className="flex-1 text-sm text-[#1D1E1F]">{config.name}</p>
                <Radio checked={parserValue === config.key} />
              </div>
              <p className="text-xs text-[#9A9A9A] mt-1">{config.desc}</p>
            </div>
          )
        })}
      </div>
    </Modal>
  )
})

Parser.displayName = 'Parser'

export default Parser
