import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Button, message, Modal, Tag } from "antd";
import { CopyOutlined, DeleteOutlined } from "@ant-design/icons";
import { apiKeysApi, type ApiKey } from "@/api/modules/api-key";
import { useLibraryStore } from "@/stores/modules/library";
import { API_HOST } from "@/api/index";
import { Header } from "@/components/Header";
import { ApiGuide } from "@km/shared-business/api-guide";
import { copyToClip } from "@km/shared-utils";

// Wiki 接入指引内容（知识库级作用域；Studio / Dify 图文步骤共用
// @km/shared-business/api-guide，两端不再各自维护）
const wikiGuideContent = `## 第一步：创建 API Key

在当前知识库的开放接口页面创建 API Key，该 Key 可用于访问本知识库作用域内已发布的 Wiki 页面。

## 第二步：携带认证信息

调用 Wiki 接口时，在请求头中携带 \`Authorization: Bearer km-...\`。

## 第三步：调用接口

接口地址：\`${API_HOST}/api/external-wiki\`

### \`GET /api/external-wiki/pages\` — 分页获取已发布页面

| 参数 | 位置 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| \`keyword\` | query | 否 | - | 标题、slug 或摘要关键词 |
| \`page_type\` | query | 否 | - | 页面类型 |
| \`category_id\` | query | 否 | - | 分类 ID，传 \`other\` 表示未分类页面 |
| \`library_ids\` | query | 否 | 全部作用域 | 知识库 ID 列表（逗号分隔），须在 Key 作用域内 |
| \`offset\` | query | 否 | 0 | 分页偏移 |
| \`limit\` | query | 否 | 20 | 每页数量，最大 100 |

### \`GET /api/external-wiki/pages/:page_id\` — 获取页面正文

| 参数 | 位置 | 必填 | 说明 |
| --- | --- | --- | --- |
| \`page_id\` | path | 是 | 页面 ID |

返回当前已发布版本，含正文 \`body\`、来源 \`sources\`、出链 \`links\`、反向链接 \`backlinks\`。

### \`GET /api/external-wiki/search\` — 搜索已发布页面

| 参数 | 位置 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| \`keyword\` | query | 是 | - | 搜索关键词 |
| \`top_k\` | query | 否 | 10 | 最多返回数量，最大 50 |
| \`library_ids\` | query | 否 | 全部作用域 | 知识库 ID 列表（逗号分隔），须在 Key 作用域内 |

**调用示例**

\`\`\`bash
curl -H 'Authorization: Bearer km-...' '${API_HOST}/api/external-wiki/pages?limit=10'
curl -H 'Authorization: Bearer km-...' '${API_HOST}/api/external-wiki/search?keyword=关键词'
\`\`\`

## 说明

- 接口只返回当前 API Key 作用域内 active、已发布、非 private 的页面
- \`library_ids\` 传入的 ID 必须全部在 Key 作用域内，否则返回 403
- 所有 ID 均为 hashid 格式，错误响应格式为 \`error_code\` / \`error_msg\`
- 需要访问空间内多个知识库时，请在空间设置的开放接口中创建空间级 API Key`;

export function LibraryApiSettingsView() {
  const { id } = useParams<{ id: string }>();
  const libraryStore = useLibraryStore();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);

  const apiEndpoint = `${API_HOST}/api/external-knowledge`;
  const wikiApiEndpoint = `${API_HOST}/api/external-wiki`;

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

  const handleCopy = async (text: string) => {
    await copyToClip(text);
    message.success("已复制");
  };

  useEffect(() => {
    loadList();
  }, [libraryStore.library?.id]);

  return (
    <div className="h-screen flex flex-col overflow-hidden px-[78px]">
      <Header className="pt-8 pb-5" title="开放接口" />
      <div className="flex-1 gap-6 overflow-y-auto mb-5">
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
            <div className="flex">
              <div className="flex-none w-[108px] text-sm text-[#4F5052] pt-2">
                API Endpoint
              </div>
              <div className="flex-1 flex flex-col gap-3">
                {[{ label: "外部知识库", value: apiEndpoint }, { label: "外部 Wiki", value: wikiApiEndpoint }].map((endpoint) => (
                  <div key={endpoint.value} className="h-10 px-4 flex items-center border rounded bg-[#F3F4F6]">
                    <Tag className="mr-2" bordered={false}>{endpoint.label}</Tag>
                    <p className="flex-1 text-sm text-[#6E7278] truncate">{endpoint.value}</p>
                    <div className="flex-none border-l pl-4 flex gap-4 text-regular">
                      <CopyOutlined
                        className="cursor-pointer text-gray-400 hover:text-blue-500"
                        onClick={() => handleCopy(endpoint.value)}
                      />
                    </div>
                  </div>
                ))}
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

          <div className="mt-5">
            <ApiGuide
              labels={{
                studio: "接入53AI Studio",
                dify: "接入Dify",
                wiki: "Wiki API文档",
              }}
              wikiTitle="Wiki 开放接口接入指引"
              wikiContent={wikiGuideContent}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default LibraryApiSettingsView;
