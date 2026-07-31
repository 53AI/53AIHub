import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { Popover, Button } from 'antd'
import { CloseOutlined, PlusOutlined } from '@ant-design/icons'
import { CropperDialog, type CropperDialogRef } from '@/components/CropperDialog'
import { img_host } from '@/utils/config'
import { t } from '@/locales'

interface BgColor {
  dark: string
  light: string
}

interface IconParams {
  icon: string
  bgLight: string
  bgDark: string
}

interface SetIconProps {
  value?: string
  disabled?: boolean
  showBg?: boolean
  showUpload?: boolean
  defaultColor?: string
  cropperDisabled?: boolean
  allowTypeList?: string[]
  className?: string
  onChange?: (value: string) => void
  onConfirm?: (result: { url: string }) => void
  onIconParams?: (data: IconParams) => void
}

export interface SetIconRef {
  open: () => void
  close: () => void
}

const BG_LIST: BgColor[] = [
  { dark: '#2563EB', light: '#2563EB1A' },
  { dark: '#38C19E', light: '#38C19E1A' },
  { dark: '#8063E3', light: '#8063E31A' },
  { dark: '#F0806E', light: '#F0806E1A' },
  { dark: '#DCA900', light: '#DCA9001A' },
  { dark: '#75819C', light: '#75819C1A' },
  { dark: '#999999', light: '#9999991A' },
]

// Generate icon list (icon1.png to icon34.png)
const ICON_LIST: string[] = []
for (let i = 1; i <= 34; i++) {
  ICON_LIST.push(`${img_host}/icon/icon${i}.png`)
}

export const SetIcon = forwardRef<SetIconRef, SetIconProps>(
  (
    {
      value = '',
      disabled = false,
      showBg = true,
      showUpload = true,
      defaultColor,
      cropperDisabled = false,
      allowTypeList = ['jpg', 'png', 'jpeg'],
      className = '',
      onChange,
      onConfirm,
      onIconParams,
    },
    ref
  ) => {
    const [popoverVisible, setPopoverVisible] = useState(false)
    const [showModelValue, setShowModelValue] = useState(!!value)
    const [defaultBg, setDefaultBg] = useState<BgColor | null>(
      BG_LIST.find((item) => item.dark === defaultColor) || BG_LIST[0]
    )
    const [defaultIcon, setDefaultIcon] = useState<string>(ICON_LIST[0])

    const cropperRef = useRef<CropperDialogRef>(null)

    useImperativeHandle(ref, () => ({
      open: () => setPopoverVisible(true),
      close: () => setPopoverVisible(false),
    }))

    const handleShowIcon = () => {
      const bgValue = defaultBg
      if ((showBg ? bgValue : true) && defaultIcon) {
        setShowModelValue(false)
      }
      // 直接使用条件判断，不依赖 showModelValue state（因为 setState 是异步的）
      if (bgValue && defaultIcon) {
        onIconParams?.({
          icon: defaultIcon,
          bgLight: bgValue.light,
          bgDark: bgValue.dark,
        })
      }
    }

    const handleChangeBg = (item: BgColor) => {
      setDefaultBg(item)
      setTimeout(handleShowIcon, 0)
    }

    const handleSelectIcon = (item: string) => {
      setDefaultIcon(item)
      setTimeout(handleShowIcon, 0)
    }

    const onSelectFile = () => {
      if (disabled) return
      cropperRef.current?.uploadFile()
    }

    const handleCropperConfirm = (data: { url: string }) => {
      onIconParams?.({
        icon: '',
        bgLight: '',
        bgDark: '',
      })
      onChange?.(data.url)
      onConfirm?.(data)
      setPopoverVisible(false)
    }

    const onOpenPopover = () => {
      if (disabled) return
      setPopoverVisible(true)
    }

    const onClosePopover = () => {
      setPopoverVisible(false)
    }

    // Watch for value changes
    useEffect(() => {
      if (value) {
        setDefaultBg(null)
        setDefaultIcon('')
        setShowModelValue(true)
      }
    }, [value])

    // Initialize on mount
    useEffect(() => {
      if (!value) {
        handleShowIcon()
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const referenceContent = (
      <div
        className={`size-[50px] rounded-full overflow-hidden relative cursor-pointer flex justify-center items-center group ${className}`}
        onClick={onOpenPopover}
        style={{ backgroundColor: showBg && defaultBg?.light ? defaultBg.light : 'transparent' }}
      >
        {showModelValue && value ? (
          <img
            className="w-full h-full object-cover"
            src={value}
            alt="logo"
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/images/default-logo.png'
            }}
          />
        ) : (
          defaultIcon && (
            <img
              className="size-7 object-cover -translate-y-[60px]"
              style={{ filter: defaultBg ? `drop-shadow(${defaultBg.dark} 0 60px)` : undefined }}
              src={defaultIcon}
              alt="logo"
            />
          )
        )}
        {!disabled && (
          <div className="hidden group-hover:flex absolute top-0 right-0 bottom-0 left-0 bg-black bg-opacity-40 items-center justify-center gap-6 text-xs text-white cursor-pointer rounded-full">
            {t('action.replace')}
          </div>
        )}
      </div>
    )

    const popoverContent = (
      <div className="relative">
        {showBg && (
          <>
            <div>背景</div>
            <div className="flex gap-4 mt-2 mb-4">
              {BG_LIST.map((item) => (
                <div
                  key={item.dark}
                  className={`rounded-lg p-[10px] cursor-pointer border ${
                    defaultBg?.dark === item.dark
                      ? 'border-[#2563EB] bg-[#FAFCFF]'
                      : 'border-transparent'
                  }`}
                  onClick={() => handleChangeBg(item)}
                >
                  <div
                    className="size-5 rounded-full"
                    style={{ backgroundColor: item.dark }}
                  />
                </div>
              ))}
            </div>
          </>
        )}
        <div>图标</div>
        <div className="flex flex-wrap gap-[10px] mt-2 mb-4">
          {showUpload && (
            <div className="rounded-lg">
              <Button
                shape="circle"
                style={{ backgroundColor: '#e6eefe', width: 40, height: 40, padding: 8 }}
                onClick={onSelectFile}
              >
                <PlusOutlined style={{ color: '#2563EB' }} />
              </Button>
            </div>
          )}
          {ICON_LIST.map((item) => (
            <Button
              key={item}
              className={`size-10 !ml-0 rounded-lg !p-3 hover:bg-[#F6F7F9] ${
                item === defaultIcon
                  ? 'border border-[#2563EB] bg-[#FAFCFF]'
                  : '!border-none'
              }`}
              onClick={() => handleSelectIcon(item)}
            >
              <img className="size-[18px]" src={item} alt="icon" />
            </Button>
          ))}
        </div>
        <Button
          type="text"
          className="absolute right-0 top-0"
          icon={<CloseOutlined />}
          onClick={(e) => {
            e.stopPropagation()
            onClosePopover()
          }}
        />
      </div>
    )

    return (
      <>
        <Popover
          open={popoverVisible}
          onOpenChange={setPopoverVisible}
          placement="bottomLeft"
          trigger="click"
          styles={{ root: { width: 420 } }}
          content={popoverContent}
        >
          <span style={{ pointerEvents: disabled ? 'none' : 'auto' }}>
            {referenceContent}
          </span>
        </Popover>

        <CropperDialog
          ref={cropperRef}
          cropperDisabled={cropperDisabled}
          allowTypeList={allowTypeList}
          onConfirm={handleCropperConfirm}
        />
      </>
    )
  }
)

SetIcon.displayName = 'SetIcon'

export default SetIcon
