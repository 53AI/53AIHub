import { Modal, Button, message } from "antd";
import { MinusOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import Cropper from "react-easy-crop";
import {
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useMemo,
  useEffect,
} from "react";
import type { Area } from "react-easy-crop";
import { getCroppedImageBlob } from "./helpers";

export interface CropperDialogRef {
  uploadFile: () => void;
  open: (url: string) => void;
}

export interface CropperDialogProps {
  type?: string;
  allowTypeList?: string[];
  limitSize?: number;
  fixedNumber?: number[];
  fixedNumberAider?: number[];
  previewWidth?: number;
  title?: string;
  showWidth?: number;
  showHeight?: number;
  cropperDisabled?: boolean;
  /** 上传文件的函数，由调用方提供 */
  onUpload: (file: File) => Promise<{ url: string; preview_key?: string }>;
  /** 裁剪完成后的回调 */
  onConfirm?: (result: { url: string; preview_key?: string }) => void;
  /** 国际化文案，调用方必须提供 */
  locale: {
    imageValidator: string;
    sizeLimit: string;
    uploadFailed: string;
    cancel: string;
    reset: string;
    confirm: string;
    reupload: string;
    preview: string;
  };
}

const ACCEPT_MAP: Record<string, string> = {
  jpg: "image/jpg",
  png: "image/png",
  jpeg: "image/jpeg",
  ico: "image/x-icon",
};

export const CropperDialog = forwardRef<CropperDialogRef, CropperDialogProps>(
  (
    {
      type = "systemLogo",
      allowTypeList = ["jpg", "png", "jpeg"],
      limitSize = 10,
      fixedNumber = [1, 1],
      fixedNumberAider = [1, 1],
      previewWidth = 160,
      title,
      showWidth = 300,
      showHeight = 300,
      cropperDisabled = false,
      onUpload,
      onConfirm,
      locale,
    },
    ref,
  ) => {
    const {
      imageValidator,
      sizeLimit,
      uploadFailed,
      cancel,
      reset,
      confirm,
      reupload,
      preview,
    } = locale;

    const [open, setOpen] = useState(false);
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [uploading, setUploading] = useState(false);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(
      null,
    );
    const [previewImage, setPreviewImage] = useState<string | null>(null);

    const inputRef = useRef<HTMLInputElement>(null);
    const reuploadInputRef = useRef<HTMLInputElement>(null);

    // Calculate aspect ratio from fixedNumber
    const aspectRatio = useMemo(() => {
      if (fixedNumber && fixedNumber.length >= 2 && fixedNumber[1] !== 0) {
        return fixedNumber[0] / fixedNumber[1];
      }
      return 1;
    }, [fixedNumber]);

    // Preview container style
    const previewStyle = useMemo(
      () => ({
        width: `${previewWidth}px`,
        height: `${previewWidth / (fixedNumber[0] || 1)}px`,
        border: "1px solid #e8e8e8",
        borderRadius: "2px",
        overflow: "hidden",
      }),
      [previewWidth, fixedNumber],
    );

    // Accept types string
    const acceptTypes = useMemo(() => {
      return allowTypeList
        .map((t) => ACCEPT_MAP[t])
        .filter(Boolean)
        .join(",");
    }, [allowTypeList]);

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      uploadFile: () => {
        inputRef.current?.click();
      },
      open: (url: string) => {
        setImageSrc(url);
        setOpen(true);
      },
    }));

    // Generate preview image
    const generatePreview = useCallback(
      async (imageSrc: string, croppedAreaPixels: Area | null, rotation: number) => {
        if (!imageSrc || !croppedAreaPixels) {
          setPreviewImage(null);
          return;
        }

        try {
          const croppedBlob = await getCroppedImageBlob(imageSrc, croppedAreaPixels, rotation);
          const previewUrl = URL.createObjectURL(croppedBlob);
          setPreviewImage(previewUrl);
        } catch (error) {
          console.error("Preview generation error:", error);
        }
      },
      [],
    );

    // Update preview when crop or rotation changes
    useEffect(() => {
      if (open && imageSrc && croppedAreaPixels) {
        generatePreview(imageSrc, croppedAreaPixels, rotation);
      }
    }, [open, imageSrc, croppedAreaPixels, rotation, generatePreview]);

    // Cleanup preview URL
    useEffect(() => {
      return () => {
        if (previewImage && previewImage.startsWith("blob:")) {
          URL.revokeObjectURL(previewImage);
        }
      };
    }, [previewImage]);

    const onCropComplete = useCallback((_: Area, croppedAreaPixels: Area) => {
      setCroppedAreaPixels(croppedAreaPixels);
    }, []);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset input
      if (inputRef.current) {
        inputRef.current.value = "";
      }
      if (reuploadInputRef.current) {
        reuploadInputRef.current.value = "";
      }

      // Check file type
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!allowTypeList.includes(ext || "")) {
        message.error(
          imageValidator
            .replace("{types}", allowTypeList.join("、").toUpperCase())
        );
        return;
      }

      // Check file size
      if (file.size > limitSize * 1024 * 1024) {
        message.error(sizeLimit.replace("{size}", String(limitSize)));
        return;
      }

      // If cropper disabled, upload directly
      if (cropperDisabled) {
        setUploading(true);
        try {
          const result = await onUpload(file);
          onConfirm?.(result);
        } catch (error) {
          message.error(uploadFailed);
        } finally {
          setUploading(false);
        }
        return;
      }

      // Read file as data URL for cropping
      const reader = new FileReader();
      reader.onload = () => {
        setImageSrc(reader.result as string);
        setOpen(true);
        // Reset crop state
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setRotation(0);
        setCroppedAreaPixels(null);
        setPreviewImage(null);
      };
      reader.readAsDataURL(file);
    };

    const handleConfirm = async () => {
      if (!imageSrc || !croppedAreaPixels) return;

      setUploading(true);
      try {
        const croppedBlob = await getCroppedImageBlob(imageSrc, croppedAreaPixels, rotation, 'image/png');
        const file = new File([croppedBlob], "cropped-image.png", {
          type: "image/png",
        });

        const result = await onUpload(file);
        onConfirm?.(result);
        handleClose();
      } catch (error) {
        message.error(uploadFailed);
      } finally {
        setUploading(false);
      }
    };

    const handleReset = () => {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setRotation(0);
    };

    const handleClose = () => {
      if (previewImage && previewImage.startsWith("blob:")) {
        URL.revokeObjectURL(previewImage);
      }
      setImageSrc(null);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setRotation(0);
      setOpen(false);
      setCroppedAreaPixels(null);
      setPreviewImage(null);
    };

    const handleReupload = () => {
      reuploadInputRef.current?.click();
    };

    return (
      <>
        {/* Hidden input for initial upload */}
        <input
          ref={inputRef}
          type="file"
          accept={acceptTypes}
          onChange={handleFileChange}
          style={{ display: "none" }}
        />

        {/* Hidden input for reupload */}
        <input
          ref={reuploadInputRef}
          type="file"
          accept={acceptTypes}
          onChange={handleFileChange}
          style={{ display: "none" }}
        />

        <Modal
          open={open}
          title={title}
          onCancel={handleClose}
          width={550}
          maskClosable={false}
          keyboard={false}
          footer={
            <div className="flex justify-end gap-2">
              <Button onClick={handleClose}>{cancel}</Button>
              <Button onClick={handleReset}>{reset}</Button>
              <Button
                type="primary"
                loading={uploading}
                onClick={handleConfirm}
              >
                {confirm}
              </Button>
            </div>
          }
        >
          <div className="flex h-[330px] overflow-hidden">
            {/* Left: Cropper */}
            <div className="flex flex-col">
              <div
                className="relative bg-gray-100"
                style={{ width: `${showWidth}px`, height: `${showHeight}px` }}
              >
                {imageSrc && (
                  <Cropper
                    image={imageSrc}
                    crop={crop}
                    zoom={zoom}
                    rotation={rotation}
                    aspect={aspectRatio}
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                    onRotationChange={setRotation}
                    onCropComplete={onCropComplete}
                  />
                )}
              </div>
              <div className="flex items-center justify-between mt-2.5">
                <div
                  className="text-[var(--primary-color,#3664EF)] cursor-pointer text-sm"
                  onClick={handleReupload}
                >
                  {reupload}
                </div>
                <div className="flex items-center">
                  <PlusOutlined
                    className="ml-4 cursor-pointer"
                    onClick={() => setZoom(Math.min(3, zoom + 0.1))}
                  />
                  <MinusOutlined
                    className="ml-4 cursor-pointer"
                    onClick={() => setZoom(Math.max(1, zoom - 0.1))}
                  />
                  <ReloadOutlined
                    className="ml-4 cursor-pointer"
                    onClick={() => setRotation((r) => r + 90)}
                  />
                </div>
              </div>
            </div>

            {/* Right: Preview */}
            <div className="flex-1 ml-4">
              <div className="mb-3 text-sm">{preview}</div>
              <div style={previewStyle} className="previewImg">
                {previewImage ? (
                  <img
                    src={previewImage}
                    alt="preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-50" />
                )}
              </div>
            </div>
          </div>
        </Modal>
      </>
    );
  },
);

CropperDialog.displayName = "CropperDialog";

export default CropperDialog;
