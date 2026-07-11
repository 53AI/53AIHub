import { useState, useEffect } from "react";
import { Modal, Collapse, Button, message } from "antd";
import {
  UserOutlined,
  DatabaseOutlined,
  SettingOutlined,
  BellOutlined,
  CreditCardOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { api_host, getPublicPath } from "@/utils/config";
import { copyToClip } from "@km/shared-utils";
import { personalApiKeysApi, type ApiKey } from "@/api/modules/api-key";
import { SvgIcon } from "@km/shared-components-react";

interface GeneralSettingsModalProps {
  open: boolean;
  onCancel: () => void;
}

const MENUS = [{ key: "mcp", icon: "link-two", label: "MCP与接入" }];

const MCP_CARDS = [
  {
    key: "53ai",
    name: "53AI MCP",
    icon: "/images/logo.png",
    description: "连接你的知识库，让知识成为生产力",
    available: true,
  },
  {
    key: "wecom",
    name: "企业微信",
    icon: "/images/im/wecom.png",
    description: "关联企微机器人，与53AI Agent 高效协作",
    available: false,
  },
  {
    key: "wechat",
    name: "微信",
    icon: "/images/im/wechat.png",
    description: "关联微信 ClawBot，化身你的53AI联系人",
    available: false,
  },
  {
    key: "feishu",
    name: "飞书",
    icon: "/images/im/feishu.png",
    description: "关联飞书机器人，在飞书聊天中直接对话",
    available: false,
  },
];

export function GeneralSettingsModal({
  open,
  onCancel,
}: GeneralSettingsModalProps) {
  const [activeMenu, setActiveMenu] = useState("mcp");
  const [activeCard, setActiveCard] = useState("53ai");
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState<ApiKey | null>(null);
  const [loading, setLoading] = useState(false);

  const installationCommandTemplate = `请帮我安装/更新「53AI Brain」技能，具体步骤如下：

1. 检查是否已安装名为 53AI-Brain-MCP 的技能，如果已安装请先卸载，以确保更新到最新版本。
2. 从以下地址下载技能包（zip 格式）：
    https://download.53ai.com/latest/53AI-Brain-MCP.zip
3. 下载完成后解压并安装该技能包。
4. 安装完成后，阅读并遵照 setup.md 说明，使用以下配置接入 53AI Brain的 MCP 服务：
{
  "mcpServers": {
    "53AI-Brain-MCP": {
      "enabled": true,
      "url": "${api_host}/mcp",
      "transportType": "streamable-http",
      "headers": {
        "Authorization": "Bearer {我的MCP密钥}"
      }
    }
  }
}`;

  const installationCommand = installationCommandTemplate.replace(
    "{我的MCP密钥}",
    apiKey?.key || "",
  );
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    personalApiKeysApi
      .list()
      .then((keys) => {
        if (keys && keys.length > 0) {
          setApiKey(keys[0]);
        } else {
          return personalApiKeysApi.create().then((res) => {
            setApiKey(res.data);
          });
        }
      })
      .catch(() => {
        message.error("获取 MCP 密钥失败");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open]);

  const handleCopyCommand = async () => {
    const success = await copyToClip(installationCommand);
    if (success) {
      message.success("安装指令已复制");
    }
  };

  const handleCopyTemplate = async () => {
    const success = await copyToClip(installationCommandTemplate);
    if (success) {
      message.success("安装指令已复制");
    }
  };

  const handleCopyKey = async () => {
    if (apiKey?.key) {
      const success = await copyToClip(apiKey.key);
      if (success) {
        message.success("MCP密钥已复制");
      }
    }
  };

  const handleResetKey = () => {
    Modal.confirm({
      title: "重置 MCP 密钥",
      content: "重置后当前密钥将立即失效，确定要重置吗？",
      okText: "确定重置",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        if (!apiKey) return;
        try {
          await personalApiKeysApi.delete(apiKey.id);
          const res = await personalApiKeysApi.create();
          setApiKey(res.data);
          message.success("MCP密钥已重置");
        } catch {
          message.error("重置 MCP 密钥失败");
        }
      },
    });
  };

  const renderContent = () => {
    if (activeMenu !== "mcp") {
      return (
        <div className="flex items-center justify-center h-full text-gray-400">
          正在开发中...
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full">
        <h2 className="text-xl font-medium text-[#1D1E1F] mb-6">MCP与接入</h2>

        {/* Cards */}
        <div className="grid grid-cols-4 gap-4 mb-2.5">
          {MCP_CARDS.map((card) => (
            <div
              key={card.key}
              className={`p-5 rounded-xl border cursor-pointer transition-all ${
                activeCard === card.key
                  ? "border-blue-500 "
                  : "border-transparent hover:border-blue-300"
              } ${!card.available ? "bg-[#FAFAFA]" : ""}`}
              onClick={() => {
                if (!card.available) {
                  message.info("敬请期待");
                  return;
                }
                setActiveCard(card.key);
              }}
            >
              <div className="flex items-center gap-2 mb-5">
                <img
                  className="w-9 h-9"
                  src={getPublicPath(card.icon)}
                  alt={card.name}
                />
                <span className="text-base text-[#1D1E1F]">{card.name}</span>
              </div>
              <p className="text-xs text-[#6B7280] leading-relaxed">
                {card.description}
              </p>
            </div>
          ))}
        </div>

        {/* Setup Container */}
        {MCP_CARDS.find((c) => c.key === activeCard)?.available && (
          <div className="flex-1 border border-gray-200 rounded-xl px-10 py-7 overflow-y-auto relative">
            <h3 className="text-xl font-medium text-[#1D1E1F] mb-6">
              安装包含53AI MCP的Skill
            </h3>

            <div>
              <div className="text-base text-[#1D1E1F] mb-7">
                1. 支持主流工具
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {[
                  {
                    name: "OpenClaw",
                    logo: getPublicPath("/images/vibe/openclaw.png"),
                  },
                  {
                    name: "QClaw",
                    logo: getPublicPath("/images/vibe/qclaw.png"),
                  },
                  {
                    name: "WorkBuddy",
                    logo: getPublicPath("/images/vibe/workbuddy.png"),
                  },
                  {
                    name: "CodeBuddy",
                    logo: getPublicPath("/images/vibe/codebuddy.png"),
                  },
                  {
                    name: "Cursor",
                    logo: getPublicPath("/images/vibe/cursor.png"),
                  },
                  {
                    name: "VS Code",
                    logo: getPublicPath("/images/vibe/vscode.png"),
                  },
                ].map((tool) => (
                  <div
                    key={tool.name}
                    className="h-12 flex items-center gap-3 px-4 bg-[#F8F9FA] rounded-xl"
                  >
                    <div
                      className={`w-8 h-8 rounded-sm flex items-center justify-center`}
                    >
                      <img
                        src={tool.logo}
                        alt={tool.name}
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <span className="text-base text-[#1D1E1F]">
                      {tool.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-b my-10"></div>

            <div className="mb-4 flex items-center justify-between">
              <div className="text-base text-[#1D1E1F]">
                2. 复制以下 Skill 安装指令，发送给 AI 工具即可完成接入
              </div>
              <Button type="primary" shape="round" onClick={handleCopyCommand}>
                一键复制安装指令
              </Button>
            </div>

            <div className="bg-[#F7F8FA] rounded-xl mb-4 overflow-hidden">
              <Collapse
                defaultActiveKey={["1"]}
                ghost
                expandIconPosition="end"
                items={[
                  {
                    key: "1",
                    styles: {
                      header: {
                        backgroundColor: "#EDEFF2",
                      },
                      body: {
                        backgroundColor: "#F5F7FA",
                      },
                    },

                    label: (
                      <span className="text-base !font-medium text-[#1D1E1F]">
                        查看安装指令
                      </span>
                    ),
                    extra: (
                      <SvgIcon
                        name="copy"
                        className="text-gray-400 hover:text-gray-600 mr-2 cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyTemplate();
                        }}
                      />
                    ),
                    children: (
                      <div className="text-sm text-gray-600 whitespace-pre-wrap bg-transparent pb-4">
                        {installationCommandTemplate}
                      </div>
                    ),
                  },
                ]}
              />
            </div>

            <div className="bg-[#F7F8FA] rounded-xl mb-4 overflow-hidden">
              <Collapse
                ghost
                expandIconPosition="end"
                items={[
                  {
                    key: "1",
                    styles: {
                      header: {
                        backgroundColor: "#EDEFF2",
                      },
                      body: {
                        backgroundColor: "#F5F7FA",
                      },
                    },
                    label: (
                      <span className="text-base !font-medium text-[#1D1E1F]">
                        查看我的MCP密钥
                      </span>
                    ),
                    children: (
                      <div className="flex items-center gap-3 pb-4 pt-2">
                        <div className="flex-1 flex items-center gap-2">
                          <span className="text-sm text-[#1D1E1F]">
                            我的MCP密钥:
                          </span>
                          <span className="text-sm font-mono text-gray-600">
                            {loading
                              ? "加载中..."
                              : showKey
                                ? apiKey?.key || "暂无密钥"
                                : apiKey?.key
                                  ? "••••••••••••••••••••••••"
                                  : "暂无密钥"}
                          </span>
                          <Button
                            type="text"
                            icon={
                              showKey ? (
                                <EyeInvisibleOutlined />
                              ) : (
                                <EyeOutlined />
                              )
                            }
                            onClick={() => setShowKey(!showKey)}
                            className="text-gray-400 hover:text-gray-600"
                          />
                          <Button
                            type="text"
                            icon={<SvgIcon name="copy" />}
                            onClick={handleCopyKey}
                            className="text-gray-400 hover:text-gray-600"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="text"
                            icon={<SyncOutlined />}
                            onClick={handleResetKey}
                            className="text-gray-500 hover:text-gray-700 ml-2 border border-gray-200 rounded-md px-3 bg-white"
                          >
                            重置
                          </Button>
                        </div>
                      </div>
                    ),
                  },
                ]}
              />
            </div>

            <div className="text-xs text-[#888994] mt-6">
              * 请妥善保管MCP密钥，不要分享给他人或提交到公开代码仓库
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      width={1440}
      className="general-settings-modal"
      styles={{
        body: { padding: 0, height: "700px" },
        container: {
          borderRadius: "12px",
          overflow: "hidden",
        },
      }}
      style={{
        "--ant-modal-content-padding": 0,
      }}
      centered
    >
      <div className="flex h-full w-full">
        {/* Sidebar */}
        <div className="w-[224px] bg-[#F8FAFC] flex-shrink-0">
          <div className="text-base font-medium text-[#1D1E1F] my-4 px-5">
            通用设置
          </div>
          <div className="flex flex-col gap-1 px-4">
            {MENUS.map((menu) => (
              <div
                key={menu.key}
                onClick={() => setActiveMenu(menu.key)}
                className={`h-8 flex items-center gap-2 px-3 rounded-lg cursor-pointer transition-colors text-[#373A3D] ${
                  activeMenu === menu.key ? "bg-[#EFEFF0] " : ""
                }`}
              >
                <div className="size-4 flex-center">
                  <SvgIcon name={menu.icon} size={16} />
                </div>
                <span className="text-sm">{menu.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 bg-white py-[26px] px-[30px] overflow-y-auto">
          {renderContent()}
        </div>
      </div>
    </Modal>
  );
}
