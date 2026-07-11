import { useState, useEffect } from "react";
import { Form, Input, Button, Radio, message, Modal } from "antd";
import { EyeOutlined, EyeInvisibleOutlined } from "@ant-design/icons";
import { useLibraryStore } from "@/stores/modules/library";
import { useNavigate, useParams } from "react-router-dom";
import librariesApi from "@/api/modules/libraries";
import { SetIcon } from "@/views/knowledge/components/SetIcon";
import { Header } from "@/components/Header";
import { createIconFileFromStatic } from "@km/shared-utils";
import UploadService from "@/services/upload";
import "./setting.css";

const VISIBILITY_TYPE = {
  inherit: 0,
  public: 1,
  private: 2,
};

export function LibraryInfo() {
  const [form] = Form.useForm();
  const libraryStore = useLibraryStore();
  const navigate = useNavigate();

  const [icon, setIcon] = useState("");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [visibility, setVisibility] = useState<number>(VISIBILITY_TYPE.inherit);

  useEffect(() => {
    if (libraryStore.library) {
      form.setFieldsValue({
        name: libraryStore.library.name || "",
        description: libraryStore.library.description || "",
      });
      setIcon(libraryStore.library.icon || "");
      setVisibility(libraryStore.library.visibility ?? VISIBILITY_TYPE.inherit);
    }
  }, [libraryStore.library, form]);

  const handleIconParams = async (data: {
    icon: string;
    bgLight: string;
    bgDark: string;
  }) => {
    try {
      if (data.icon && data.bgLight && data.bgDark) {
        const file = (await createIconFileFromStatic(
          data.icon,
          data.bgLight,
          data.bgDark
        )) as File;
        setIconFile(file);
      } else {
        setIconFile(null);
      }
    } catch (error) {
      console.error("Failed to create icon file:", error);
    }
  };

  const uploadIcon = async (dataFile: File): Promise<string> => {
    try {
      const result = await UploadService.uploadImage(dataFile, {
        onError: (error: any) => {
          message.error(`上传失败：${error.message}`);
        },
      });
      return result.url;
    } catch (error) {
      return "";
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (!libraryStore.library?.id) return;

      setLoading(true);

      let iconUrl = icon;
      if (iconFile) {
        iconUrl = await uploadIcon(iconFile);
      }

      await librariesApi.update(libraryStore.library.id, {
        ...values,
        icon: iconUrl,
        visibility,
        space_id: libraryStore.library?.space_id || "",
      });

      message.success("保存成功");
      libraryStore.loadLibrary();
    } catch (error) {
      console.error("Save failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = () => {
    Modal.confirm({
      title: "删除提示",
      content: "确定要删除这个知识库吗？删除后无法恢复。",
      okText: "确认",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        if (!libraryStore.library?.id) return;
        await librariesApi.delete(libraryStore.library.id);
        message.success("删除成功");
        navigate(`/knowledge/${libraryStore.library?.space_id || ""}`);
      },
    });
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden px-[60px] bg-[#F8F9FA]">
      <Header className="pt-8 pb-5" title="基础信息" />
      <div className="bg-white flex-1 gap-6 px-10 py-8 overflow-y-auto mb-5">
        <div className="max-w-[800px]">
          <Form form={form} layout="vertical">
            <div className="flex gap-4 items-center mb-[18px]">
              <SetIcon
                value={icon}
                onChange={setIcon}
                onIconParams={handleIconParams}
                className="w-[60px] h-[60px]"
              />
              <Form.Item
                name="name"
                label="名称"
                rules={[{ required: true, message: "请输入名称" }]}
                className="flex-1 mb-0"
              >
                <Input
                  placeholder="请输入内容"
                  maxLength={20}
                  showCount
                  allowClear
                />
              </Form.Item>
            </div>

            <Form.Item name="description" label="简介">
              <Input.TextArea
                placeholder="请输入知识库的简介，如：产品设计与研发"
                rows={5}
                maxLength={150}
                showCount
              />
            </Form.Item>

            <Form.Item label="可见性">
              <div className="grid grid-cols-3 gap-3">
                <div
                  className={`rounded-md border p-3 relative cursor-pointer ${
                    visibility === VISIBILITY_TYPE.inherit
                      ? "bg-[#2563EB14] border-[#2563EB]"
                      : ""
                  }`}
                  onClick={() => setVisibility(VISIBILITY_TYPE.inherit)}
                >
                  <div className="mb-2 flex items-center gap-1">
                    <EyeOutlined
                      className="text-gray-400"
                      style={{ fontSize: 16 }}
                    />
                    <span className="text-sm text-[#1D1E1F]">
                      继承团队空间设置
                    </span>
                  </div>
                  <div className="text-xs text-[#939499]">
                    当前团队空间设置为：
                    <Button type="link" size="small">
                      {libraryStore.space?.visibility === 1 ? "可见" : "不可见"}
                    </Button>
                  </div>
                  <div className="text-xs text-[#939499] mt-1">
                    非成员也可以看到，可直接申请加入知识库
                  </div>
                  <div className="absolute top-1 right-1">
                    <Radio checked={visibility === VISIBILITY_TYPE.inherit} />
                  </div>
                </div>

                <div
                  className={`rounded-md border p-3 relative cursor-pointer ${
                    visibility === VISIBILITY_TYPE.public
                      ? "bg-[#2563EB14] border-[#2563EB]"
                      : ""
                  }`}
                  onClick={() => setVisibility(VISIBILITY_TYPE.public)}
                >
                  <div className="mb-2 flex items-center gap-1">
                    <EyeOutlined
                      className="text-gray-400"
                      style={{ fontSize: 16 }}
                    />
                    <span className="text-sm text-[#1D1E1F]">可见</span>
                  </div>
                  <div className="text-xs text-[#939499]">
                    非成员也可以看到，可直接申请加入知识库
                  </div>
                  <div className="absolute top-1 right-1">
                    <Radio checked={visibility === VISIBILITY_TYPE.public} />
                  </div>
                </div>

                <div
                  className={`rounded-md border p-3 relative cursor-pointer ${
                    visibility === VISIBILITY_TYPE.private
                      ? "bg-[#2563EB14] border-[#2563EB]"
                      : ""
                  }`}
                  onClick={() => setVisibility(VISIBILITY_TYPE.private)}
                >
                  <div className="mb-2 flex items-center gap-1">
                    <EyeInvisibleOutlined
                      className="text-gray-400"
                      style={{ fontSize: 16 }}
                    />
                    <span className="text-sm text-[#1D1E1F]">不可见</span>
                  </div>
                  <div className="text-xs text-[#939499]">
                    仅成员才可以看到，非成员通过邀请链接才可申请加入
                  </div>
                  <div className="absolute top-1 right-1">
                    <Radio checked={visibility === VISIBILITY_TYPE.private} />
                  </div>
                </div>
              </div>
            </Form.Item>
          </Form>

          <Button
            type="primary"
            className="mt-6"
            onClick={handleSave}
            loading={loading}
          >
            保存
          </Button>

          <div className="my-10 border-t" />

          <div className="h-[82px] p-5 bg-[#FAFAFA] flex items-center justify-between">
            <div className="flex-1">
              <p className="text-base text-[#1D1E1F]">删除知识库</p>
              <p className="text-sm text-[#999999] mt-1">
                将这个知识库彻底删除，知识库下的所有数据将会删除
              </p>
            </div>
            <Button danger onClick={handleDelete}>
              删除
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LibraryInfo;