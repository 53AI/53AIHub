import { Upload as AntUpload, message } from "antd";
import type { UploadProps, UploadFile } from "antd";
import { useRef, useState, forwardRef, useImperativeHandle } from "react";
import uploadApi from "@/api/modules/upload";
import { ImageUpload, ImageUploadProps } from "./image";
import { api_host } from "@/utils/config";

export { ImageUpload };
export type { ImageUploadProps };

export interface UploadComponentProps {
  accept?: string;
  name?: string;
  size?: number; // MB
  hide?: boolean;
  full?: boolean;
  drag?: boolean;
  multiple?: boolean;
  limit?: number;
  disabled?: boolean;
  autoUpload?: boolean;
  extraData?: Record<string, any>;
  children?: React.ReactNode;
  onSuccess?: (data: {
    id: string;
    url: string;
    name: string;
    size: number;
  }) => void;
  onError?: (error: { error_msg: string }) => void;
  onBefore?: (file: File) => void;
  onProgress?: (file: any, percent: number) => void;
}

export interface UploadRef {
  abort: (file?: UploadFile) => void;
  submit: () => void;
  clearFiles: () => void;
  trigger: () => void;
}

export const Upload = forwardRef<UploadRef, UploadComponentProps>(
  (
    {
      accept = "",
      name = "file",
      size = 15,
      hide = false,
      full = false,
      drag = false,
      multiple = false,
      limit = 1,
      disabled = false,
      autoUpload = true,
      extraData = {},
      children,
      onSuccess,
      onError,
      onBefore,
      onProgress,
    },
    ref,
  ) => {
    const t = (window as any).$t || ((key: string, params?: any) => key);
    const uploadRef = useRef<any>(null);
    const [fileList, setFileList] = useState<UploadFile[]>([]);
    const [uploadingCount, setUploadingCount] = useState(0);
    const firstTypeRef = useRef<string>("");

    const validateFile = (file: File): boolean => {
      // Check file type
      if (accept) {
        if (!firstTypeRef.current) firstTypeRef.current = file.type;
        const ext = file.name.split(".").pop()?.toLowerCase();
        const acceptList = accept
          .split(",")
          .map((s) => s.trim().replace(/^\./, ""));
        if (!acceptList.includes(ext || "")) {
          message.warning(
            t("file.type_limit", {
              accept: acceptList.map((s) => s.toUpperCase()).join("、"),
            })
          );
          return false;
        }
      }

      // Check file size
      if (file.size === 0) {
        message.warning(t("file.size_empty"));
        return false;
      }

      if (file.size / 1024 / 1024 > size) {
        message.warning(t("file.size_limit", { size, name: file.name }));
        return false;
      }

      setUploadingCount((prev) => prev + 1);
      return true;
    };

    const customRequest: UploadProps["customRequest"] = async (options) => {
      const {
        file,
        onSuccess: uploadSuccess,
        onError: uploadError,
        onProgress,
      } = options as any;

      try {
        onBefore?.(file as File);

        const res = await uploadApi.upload(file as File, {
          onUploadProgress: (progressEvent) => {
            const percent = Math.round(
              (progressEvent.loaded! / progressEvent.total!) * 100,
            );
            onProgress?.({ percent }, file);
            onProgress?.(file, percent);
          },
        });

        const url = `${api_host}/api/preview/${res.data?.preview_key || ""}`;

        uploadSuccess?.(res.data);
        onSuccess?.({
          id: res.data?.id || "",
          url,
          name: res.data?.file_name || (file as File).name,
          size: res.data?.size || (file as File).size,
        });

        // Decrement uploading count
        setUploadingCount((prev) => {
          if (prev - 1 === 0) firstTypeRef.current = "";
          return prev - 1;
        });
      } catch (error) {
        uploadError?.(error);
        onError?.({ error_msg: t("upload_failed") });

        // Decrement uploading count on error
        setUploadingCount((prev) => {
          if (prev - 1 === 0) firstTypeRef.current = "";
          return prev - 1;
        });
      }
    };

    const handleChange: UploadProps["onChange"] = (info) => {
      setFileList(info.fileList);
    };

    useImperativeHandle(ref, () => ({
      abort: (file) => {
        uploadRef.current?.abort(file);
      },
      submit: () => {
        uploadRef.current?.upload();
      },
      clearFiles: () => {
        setFileList([]);
      },
      trigger: () => {
        const input = document.querySelector(
          '.ant-upload input[type="file"]',
        ) as HTMLInputElement;
        input?.click();
      },
      handleStart: (file: File) => {
        // In antd, we add file to fileList and trigger upload
        const uid = `${Date.now()}-${Math.random()}`;
        const uploadFile: UploadFile = {
          uid,
          name: file.name,
          file,
          status: "uploading",
        };
        setFileList((prev) => [...prev, uploadFile]);
      },
      handleRemove: (file: UploadFile) => {
        setFileList((prev) => prev.filter((f) => f.uid !== file.uid));
      },
    }));

    return (
      <div
        className={`${hide ? "absolute right-0 top-0" : ""} ${full ? "w-full h-full" : ""}`}
      >
        <AntUpload
          ref={uploadRef}
          accept={accept}
          name={name}
          disabled={disabled}
          multiple={multiple}
          maxCount={limit}
          showUploadList={false}
          customRequest={customRequest}
          onChange={handleChange}
          beforeUpload={validateFile}
          directory={false}
          listType="text"
          className={full ? "w-full h-full [&_.ant-upload]:w-full [&_.ant-upload]:h-full [&_.ant-upload-select]:w-full [&_.ant-upload-select]:h-full" : ""}
        >
          {children ||
            (drag ? (
              <div className="w-full h-full flex items-center justify-center border-2 border-dashed border-gray-300 rounded cursor-pointer hover:border-blue-400">
                点击或拖拽文件到此区域上传
              </div>
            ) : (
              <button type="button" className="ant-btn">
                上传文件
              </button>
            ))}
        </AntUpload>
      </div>
    );
  },
);

Upload.displayName = "Upload";

export default Upload;
