import { Popover, Button, Image } from "antd";
import { PlusOutlined, CloseOutlined } from "@ant-design/icons";
import { useState, useEffect, useRef, ReactNode } from "react";
import CropperDialog, { CropperDialogRef } from "@/components/CropperDialog";
import { t } from "@/locales";
import { img_host } from "@/utils/config";

export interface IconPopoverProps {
  value?: string;
  onChange?: (url: string) => void;
  onConfirm?: (result: { url: string }) => void;
  onIconParams?: (data: {
    icon: string;
    bgLight: string;
    bgDark: string;
  }) => void;
  cropperDisabled?: boolean;
  allowTypeList?: string[];
  disabled?: boolean;
  defaultColor?: string;
  showBg?: boolean;
  showUpload?: boolean;
  className?: string;
  /** Custom trigger element, similar to Vue's #reference slot */
  children?: ReactNode;
}

const BG_LIST = [
  { dark: "#2563EB", light: "#2563EB1A" },
  { dark: "#38C19E", light: "#38C19E1A" },
  { dark: "#8063E3", light: "#8063E31A" },
  { dark: "#F0806E", light: "#F0806E1A" },
  { dark: "#DCA900", light: "#DCA9001A" },
  { dark: "#75819C", light: "#75819C1A" },
  { dark: "#999999", light: "#9999991A" },
];

// Icon list - 34个预设图标 (模块级别常量，匹配 Vue 版本)
const iconList: string[] = [];
for (let i = 1; i <= 34; i++) {
  iconList.push(`${img_host}/icon/icon${i}.png`);
}

export function IconPopover({
  value = "",
  onChange,
  onConfirm,
  onIconParams,
  cropperDisabled = false,
  allowTypeList,
  disabled = false,
  defaultColor,
  showBg = true,
  showUpload = true,
  className,
  children,
}: IconPopoverProps) {
  const [popoverVisible, setPopoverVisible] = useState(false);
  // showModelValue: 是否显示外部传入的 value（用户上传的图片）
  // 初始值为 !!value，如果有值则显示 value，否则显示默认图标
  const [showModelValue, setShowModelValue] = useState(!!value);
  const [defaultBg, setDefaultBg] = useState<{
    dark: string;
    light: string;
  } | null>(BG_LIST.find((item) => item.dark === defaultColor) || BG_LIST[0]);
  // 匹配 Vue 版本: const defaultIcon = ref(iconList[0])
  const [defaultIcon, setDefaultIcon] = useState(iconList[0]);
  const cropperRef = useRef<CropperDialogRef>(null);

  // 显示图标并触发 iconParams 回调
  // 完全匹配 Vue 版本的 handleShowIcon 逻辑
  const handleShowIcon = () => {
    const bgValue = defaultBg;
    if ((showBg ? bgValue : true) && defaultIcon) {
      setShowModelValue(false);
    }
    if (!showModelValue) {
      onIconParams?.({
        icon: defaultIcon,
        bgLight: bgValue?.light || "",
        bgDark: bgValue?.dark || "",
      });
    }
  };

  // Handle background change
  const handleChangeBg = (item: { dark: string; light: string }) => {
    setDefaultBg(item);
    // Vue 版本是先设置 value，再调用 handleShowIcon
    // 由于 React setState 是异步的，需要用 useEffect 或直接调用
    // 这里手动调用 handleShowIcon，但需要注意 state 还没更新
    // 实际上 Vue 版本也是这样工作的，handleShowIcon 使用的是当前的 defaultBg
    // 所以这里我们需要用新的值
    const bgValue = item;
    if ((showBg ? bgValue : true) && defaultIcon) {
      setShowModelValue(false);
    }
    if (!showModelValue) {
      onIconParams?.({
        icon: defaultIcon,
        bgLight: bgValue?.light || "",
        bgDark: bgValue?.dark || "",
      });
    }
  };

  // Handle icon select
  const handleSelectIcon = (icon: string) => {
    setDefaultIcon(icon);
    // 同上，需要用新的 icon 值
    const bgValue = defaultBg;
    if ((showBg ? bgValue : true) && icon) {
      setShowModelValue(false);
    }
    if (!showModelValue) {
      onIconParams?.({
        icon,
        bgLight: bgValue?.light || "",
        bgDark: bgValue?.dark || "",
      });
    }
  };

  // Handle select file - opens CropperDialog
  const handleSelectFile = () => {
    if (disabled) return;
    cropperRef.current?.uploadFile();
  };

  // Handle cropper confirm
  const handleConfirm = (data: { url: string }) => {
    onIconParams?.({ icon: "", bgLight: "", bgDark: "" });
    onChange?.(data.url);
    onConfirm?.(data);
  };

  // Open popover - 匹配 Vue 的 onOpenPopover
  const handleOpenPopover = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    setPopoverVisible(true);
  };

  // Close popover - 匹配 Vue 的 onClosePopover
  const handleClosePopover = () => {
    setPopoverVisible(false);
  };

  // Initialize - 完全匹配 Vue 的 onMounted 逻辑
  useEffect(() => {
    if (value) {
      setDefaultBg(null);
      setDefaultIcon("");
    } else {
      handleShowIcon();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Popover content
  const content = (
    <>
      <div className="relative">
        {showBg && (
          <>
            <div>背景</div>
            <div className="flex gap-4 mt-2 mb-4">
              {BG_LIST.map((item) => (
                <div
                  key={item.dark}
                  className={`rounded-lg p-[10px] cursor-pointer ${
                    defaultBg?.dark === item.dark
                      ? "border border-[#2563EB] bg-[#FAFCFF]"
                      : ""
                  }`}
                  onClick={() => handleChangeBg(item)}
                >
                  <div
                    className="w-5 h-5 rounded-full"
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
            <div className="rounded-lg p-3">
              <Button
                shape="circle"
                className="!w-[18px] !h-[18px] !min-w-[18px] !p-0"
                style={{
                  backgroundColor: "#e6eefe",
                }}
                icon={<PlusOutlined style={{ color: "#2563EB", fontSize: 12 }} />}
                onClick={handleSelectFile}
              />
            </div>
          )}
          {iconList.map((item) => (
            <Button
              key={item}
              className={`size-10 !ml-0 rounded-lg !p-3 hover:bg-[#F6F7F9] ${
                item === defaultIcon
                  ? "border border-[#2563EB] bg-[#FAFCFF]"
                  : "!border-none"
              }`}
              onClick={() => handleSelectIcon(item)}
            >
              <Image
                src={item}
                width={18}
                height={18}
                preview={false}
                style={{ objectFit: "contain" }}
              />
            </Button>
          ))}
        </div>
        <Button
          className="absolute right-0 top-0"
          type="link"
          icon={<CloseOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            handleClosePopover();
          }}
        />
      </div>
      <div id="previewContainer"></div>
    </>
  );

  // Default trigger element (when no children provided) - 匹配 Vue 的默认 slot
  const defaultTrigger = (
    <div
      className={`size-[50px] rounded-full overflow-hidden relative cursor-pointer flex justify-center items-center ${className || ""} ${disabled ? "cursor-not-allowed" : ""}`}
      style={{
        backgroundColor: showBg
          ? defaultBg?.light || "transparent"
          : "transparent",
      }}
    >
      {showModelValue ? (
        <img
          className="w-full h-full object-cover"
          src={value}
          alt="logo"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.src = "/images/default_agent.png";
          }}
        />
      ) : (
        <img
          className="size-7 object-cover -translate-y-[60px]"
          src={defaultIcon}
          alt="logo"
          style={{
            filter: defaultBg?.dark
              ? `drop-shadow(${defaultBg.dark} 0 60px)`
              : undefined,
          }}
        />
      )}
    </div>
  );

  return (
    <>
      <Popover
        open={popoverVisible}
        onOpenChange={(visible) => {
          // 匹配 Vue 的 trigger="manual" 行为
          if (!visible) {
            setPopoverVisible(false);
          }
        }}
        content={content}
        trigger="click"
        placement="bottom"
        arrow={false}
        overlayStyle={{ width: 420 }}
        // 匹配 Vue 的 :disabled="disabled"
        disabled={disabled}
        // 添加偏移量防止遮挡原图标预览
        align={{ offset: [0, 10] }}
      >
        <div
          className={`inline-flex items-center gap-2 relative group ${disabled ? "cursor-not-allowed" : ""}`}
          onClick={handleOpenPopover}
        >
          {children || defaultTrigger}
          {!disabled && (
            <div className="hidden group-hover:flex absolute top-0 right-0 bottom-0 left-0 bg-black bg-opacity-40 items-center justify-center gap-6 text-xs text-white cursor-pointer">
              {t("action_replace")}
            </div>
          )}
        </div>
      </Popover>

      {showUpload && (
        <CropperDialog
          ref={cropperRef}
          action="python"
          cropperDisabled={cropperDisabled}
          allowTypeList={allowTypeList}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
}

export default IconPopover;
