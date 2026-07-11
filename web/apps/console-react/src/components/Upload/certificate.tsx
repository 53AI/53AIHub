import { Upload, Button, message } from "antd";
import { DeleteOutlined, FileOutlined } from "@ant-design/icons";
import { useState, useEffect, useCallback } from "react";
import uploadApi from "@/api/modules/upload";

interface CertificateUploadProps {
  value?: string;
  fileName?: string;
  onChange?: (info: { fileList: any[] }) => void;
}

interface FileItem {
  id: string;
  name: string;
  key?: string;
}

export function CertificateUpload({
  value,
  fileName,
  onChange,
}: CertificateUploadProps) {
  const t = (window as any).$t || ((key: string) => key);

  const [fileList, setFileList] = useState<FileItem[]>([]);
  const [uploading, setUploading] = useState(false);

  // Sync from props
  useEffect(() => {
    if (value) {
      setFileList([
        { id: value, name: fileName || "certificate.pem", key: value },
      ]);
    }
  }, [value, fileName]);

  // Upload file
  const uploadFile = useCallback(async (file: File): Promise<any> => {
    setUploading(true);
    try {
      const res = await uploadApi.upload(file);
      return res.data;
    } catch (error) {
      console.error("Upload error:", error);
      return {};
    } finally {
      setUploading(false);
    }
  }, []);

  // Handle file change
  const handleFileChange = useCallback(
    async (info: any) => {
      const file = info.file;

      if (!file.name.endsWith(".pem")) {
        message.warning(t("upload_pem_file_tip"));
        return;
      }

      const data = await uploadFile(file.originFileObj);
      const newFile = {
        id: data.key || file.uid,
        name: file.name,
        key: data.key,
      };

      setFileList([newFile]);
      onChange?.({ fileList: [newFile] });
    },
    [uploadFile, onChange, t],
  );

  // Handle file delete
  const handleFileDelete = useCallback(
    (index: number) => {
      const newList = fileList.filter((_, i) => i !== index);
      setFileList(newList);
      onChange?.({ fileList: newList });
    },
    [fileList, onChange],
  );

  if (fileList.length === 0) {
    return (
      <Upload
        accept=".pem"
        showUploadList={false}
        onChange={handleFileChange}
        beforeUpload={() => false}
        disabled={uploading}
      >
        <Button color="primary" variant="filled" loading={uploading}>
          {t("action_select_file")}
        </Button>
      </Upload>
    );
  }

  return (
    <ul className="list-none m-0 p-0">
      {fileList.map((item, index) => (
        <li
          key={item.id}
          className="flex items-center gap-2 text-disabled text-sm"
        >
          <FileOutlined style={{ fontSize: 16 }} />
          <span>{item.name || "--"}</span>
          <DeleteOutlined
            style={{ fontSize: 16, cursor: "pointer", color: "#333" }}
            onClick={() => handleFileDelete(index)}
          />
        </li>
      ))}
    </ul>
  );
}

export default CertificateUpload;
