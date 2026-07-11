import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Button, Drawer, message, Modal } from "antd";
import {
  ArrowRightOutlined,
  CopyOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { apiKeysApi, type ApiKey } from "@/api/modules/api-key";
import { useLibraryStore } from "@/stores/modules/library";
import { API_HOST } from "@/api/index";
import { Header } from "@/components/Header";
import { getPublicPath } from "@/utils/config";
import { copyToClip } from "@km/shared-utils";
import "./api.css";

const injectConfig = {
  dify: {
    title: "Dify",
    content: [
      {
        type: "text",
        content:
          '第一步：登录Dify官网（<a href="https://cloud.dify.ai/" style="color: #576D9C;" target="_blank">https://cloud.dify.ai/</a>），在「知识库」下，点击连接外部知识库',
      },
      { type: "image", content: "/images/library/dify_help_1.png" },
      {
        type: "text",
        content:
          "第二步：在「外部知识库API」下，点击创建新的外部知识库API，复制本知识库的相关参数填入后连接",
      },
      { type: "image", content: "/images/library/dify_help_2.png" },
      { type: "image", content: "/images/library/dify_help_3.png" },
      {
        type: "text",
        content: "第三步：复制填入填外部知识库ID，点击连接即创建外部知识库成功",
      },
      { type: "image", content: "/images/library/dify_help_4.png" },
      { type: "image", content: "/images/library/dify_help_5.png" },
    ],
  },
  studio: {
    title: "53AI Studio",
    content: [
      {
        type: "text",
        content:
          '第一步：登录53AI Studio（<a href="https://chat.53ai.com/#/login" style="color: #576D9C;" target="_blank">https://chat.53ai.com/#/login</a>），在「私有数据」下，点击创建/从53AI KM里导入',
      },
      { type: "image", content: "/images/library/studio_help_1.png" },
      {
        type: "text",
        content:
          "第二步：复制本知识库的相关参数填入，点击下一步，配置基本信息确定即可",
      },
      { type: "image", content: "/images/library/studio_help_2.png" },
      { type: "image", content: "/images/library/studio_help_3.png" },
    ],
  },
};

export function LibraryApiSettingsView() {
  const { id } = useParams<{ id: string }>();
  const libraryStore = useLibraryStore();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [injectType, setInjectType] = useState<"studio" | "dify">("dify");

  const apiEndpoint = `${API_HOST}/api/external-knowledge`;

  const loadList = async () => {
    if (!libraryStore.library?.id) return;
    const list = await apiKeysApi.list(libraryStore.library.id);
    setApiKeys(list);
  };

  const handleCreate = async () => {
    if (!libraryStore.library?.id) return;
    await apiKeysApi.create(libraryStore.library.id, {
      name: libraryStore.library?.name || "",
      description: "",
    });
    message.success("创建成功");
    loadList();
  };

  const handleDelete = async (keyId: ApiKey["id"]) => {
    Modal.confirm({
      title: "提示",
      content: "确定删除该API Key吗？",
      okText: "确认",
      cancelText: "取消",
      onOk: async () => {
        if (!libraryStore.library?.id) return;
        await apiKeysApi.delete(libraryStore.library.id, keyId);
        message.success("删除成功");
        loadList();
      },
    });
  };

  const handleHelp = (type: "studio" | "dify") => {
    setInjectType(type);
    setDrawerVisible(true);
  };

  const handleCopy = async (text: string) => {
    await copyToClip(text);
    message.success("已复制");
  };

  useEffect(() => {
    loadList();
  }, [libraryStore.library?.id]);

  return (
    <div className="h-screen flex flex-col overflow-hidden px-[60px] bg-[#F8F9FA]">
      <Header className="pt-8 pb-5" title="开放接口" />
      <div className="bg-[#ffffff] flex-1 gap-6 px-10 py-8 overflow-y-auto mb-5">
        <div className="max-w-[700px]">
          <div className="flex flex-col gap-6">
            <div className="flex items-center">
              <div className="flex-none w-[108px] text-sm text-[#4F5052]">
                知识库名称
              </div>
              <div className="flex-1">
                <div className="h-10 flex items-center">
                  <span className="text-sm text-[#1D1E1F]">
                    {libraryStore.library?.name}
                  </span>
                  <div className="flex-none ml-4 flex gap-4 text-regular">
                    <CopyOutlined
                      className="cursor-pointer text-gray-400 hover:text-blue-500"
                      onClick={() =>
                        handleCopy(libraryStore.library?.name || "")
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center">
              <div className="flex-none w-[108px] text-sm text-[#4F5052]">
                知识库ID
              </div>
              <div className="flex-1">
                <div className="h-10 flex items-center">
                  <span className="text-sm text-[#1D1E1F]">
                    {libraryStore.library?.uuid}
                  </span>
                  <div className="flex-none ml-4 flex gap-4 text-regular">
                    <CopyOutlined
                      className="cursor-pointer text-gray-400 hover:text-blue-500"
                      onClick={() =>
                        handleCopy(libraryStore.library?.uuid || "")
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center">
              <div className="flex-none w-[108px] text-sm text-[#4F5052]">
                API Endpoint
              </div>
              <div className="flex-1">
                <div className="h-10 px-4 flex items-center border rounded bg-[#F3F4F6]">
                  <p className="flex-1 text-sm text-[#6E7278] truncate">
                    {apiEndpoint}
                  </p>
                  <div className="flex-none border-l pl-4 flex gap-4 text-regular">
                    <CopyOutlined
                      className="cursor-pointer text-gray-400 hover:text-blue-500"
                      onClick={() => handleCopy(apiEndpoint)}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex">
              <div className="flex-none w-[108px] h-10 leading-10 text-sm text-[#4F5052]">
                API Key
              </div>
              <div className="flex-1">
                {apiKeys.map((item) => (
                  <div
                    key={item.id}
                    className="h-10 px-4 flex items-center border rounded bg-[#F3F4F6] mb-4"
                  >
                    <p className="flex-1 text-sm text-[#6E7278]">
                      {item.key.slice(0, 4)}...{item.key.slice(-4)}
                    </p>
                    <div className="flex-none border-l pl-4 flex gap-4 text-regular">
                      <CopyOutlined
                        className="cursor-pointer text-gray-400 hover:text-blue-500"
                        onClick={() => handleCopy(item.key)}
                      />
                      <DeleteOutlined
                        className="cursor-pointer text-gray-400 hover:text-red-500"
                        onClick={() => handleDelete(item.id)}
                      />
                    </div>
                  </div>
                ))}
                <div className="flex justify-end mt-4">
                  <Button type="link" onClick={handleCreate}>
                    +添加
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <h4 className="text-xl text-[#1D1E1F] mt-10">接入指引</h4>

          <div className="mt-5 flex gap-4">
            <Button onClick={() => handleHelp("studio")}>
              <img
                className="size-6"
                src={getPublicPath("/images/external/studio.png")}
                alt="studio"
              />
              <span className="px-2">接入53AI Studio</span>
              <ArrowRightOutlined />
            </Button>
            <Button onClick={() => handleHelp("dify")}>
              <img
                className="size-6"
                src={getPublicPath("/images/external/dify.png")}
                alt="dify"
              />
              <span className="px-2">接入Dify</span>
              <ArrowRightOutlined />
            </Button>
          </div>
        </div>
      </div>

      <Drawer
        open={drawerVisible}
        title={injectConfig[injectType].title}
        styles={{ wrapper: { width: 864 } }}
        onClose={() => setDrawerVisible(false)}
      >
        {injectConfig[injectType].content.map((item, index) => (
          <div key={index}>
            {item.type === "text" && (
              <p
                className="text-sm text-[#1D1E1F] my-2"
                dangerouslySetInnerHTML={{ __html: item.content }}
              />
            )}
            {item.type === "image" && (
              <div className="flex justify-center my-2">
                <img
                  src={getPublicPath(item.content)}
                  className="w-full"
                  alt=""
                />
              </div>
            )}
          </div>
        ))}
      </Drawer>
    </div>
  );
}

export default LibraryApiSettingsView;
