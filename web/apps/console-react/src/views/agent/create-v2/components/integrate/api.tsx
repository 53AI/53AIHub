import { useState, useEffect } from "react";
import { DeleteOutlined, CaretRightFilled } from "@ant-design/icons";
import { message, Button, Table, Collapse, Modal } from "antd";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { json } from "@codemirror/lang-json";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags as syntaxTags } from "@lezer/highlight";
import { api_host } from "@/utils/config";
import { copyToClip } from "@km/shared-utils";
import { t } from "@/locales";
import {
  type AgentAPIKeyItem,
  type AgentOpenAPIDocsTemplate,
  agentApiKeyApi,
} from "@/api/modules/agents";
import { useAgentFormStore } from "@km/shared-business/agent-create";
import { SvgIcon } from "@km/shared-components-react";
import "../../api.css";

const codeMirrorSyntaxHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: syntaxTags.string, color: '#52c41a' },
  { tag: syntaxTags.propertyName, color: '#52c41a' },
  { tag: syntaxTags.number, color: '#fa8c16' },
]));

interface ApiContentProps {
  agentId?: string | number;
  agentType?: string;
}

// 仅小助理（workbench）展示技能列表接口板块
const SHOW_SKILLS_PANEL_TYPES = ['workbench'];

// 技能列表接口的"响应示例"，保持与其它接口一致的展示风格
const skillsResponseExample = {
  agent_id: "ZTRMUP",
  skills: [
    {
      binding_id: 39,
      skill_library_id: 134,
      skill_name: "12306",
      display_name: "12306",
      description: "通过 12306 技能查询火车票",
      bind_type: "builtin",
      status: "enabled",
      version: "v1.0.0",
      source_type: "github",
      publish_status: "published",
      admin_status: "enabled",
    },
  ],
};

export const ApiContent = ({ agentId, agentType }: ApiContentProps) => {
  const [apiKeys, setApiKeys] = useState<AgentAPIKeyItem[]>([]);
  const [docsTemplate, setDocsTemplate] = useState<AgentOpenAPIDocsTemplate | null>(null);
  const formData = useAgentFormStore((state) => state.form_data);
  const currentAgentId = agentId || formData.agent_id;
  const resolvedAgentType = agentType || formData.agent_type || '';
  const showSkillsPanel = SHOW_SKILLS_PANEL_TYPES.includes(resolvedAgentType);

  const apiHost = `${api_host}/openapi/v1`;

  // 加载 API Keys（分页加载，最多展示 10 个 active 的）
  const loadKeys = async () => {
    if (!currentAgentId) return;
    try {
      const LIMIT = 30;
      const MAX_DISPLAY = 10;
      let allActiveKeys: AgentAPIKeyItem[] = [];
      let offset = 0;
      let totalLoaded = 0;

      // 循环加载直到 active keys >= 10 或没有更多数据
      while (allActiveKeys.length < MAX_DISPLAY) {
        const result = await agentApiKeyApi.list({
          agent_id: String(currentAgentId),
          offset,
          limit: LIMIT,
        });

        const activeKeys = result.list.filter(item => item.status === 'active');
        allActiveKeys = [...allActiveKeys, ...activeKeys];
        totalLoaded += result.list.length;

        // 如果 count 总数小于等于已加载记录数，则不再请求下一轮
        if (result.count <= totalLoaded) {
          break;
        }

        offset += LIMIT;
      }

      // 最多展示 10 个
      setApiKeys(allActiveKeys.slice(0, MAX_DISPLAY));
    } catch {
      // Error handled in API module
    }
  };

  // 加载 OpenAPI 文档模板
  const loadDocsTemplate = async () => {
    try {
      const template = await agentApiKeyApi.getDocsTemplate();

      // 替换模板中的占位符
      let templateStr = JSON.stringify(template);
      const parsedTemplate = JSON.parse(templateStr);

      // 只替换 endpoints 中的 path 字段：{{CONVERSATION_ID}} → :conversation_id
      if (parsedTemplate.endpoints) {
        parsedTemplate.endpoints = parsedTemplate.endpoints.map((endpoint: any) => {
          if (endpoint.path) {
            endpoint.path = endpoint.path.replace(/\{\{([A-Z_]+)\}\}/g, (match: string, p1: string) => {
              return ':' + p1.toLowerCase();
            });
          }
          return endpoint;
        });
      }

      setDocsTemplate(parsedTemplate);
    } catch {
      // Error handled in API module
    }
  };

  useEffect(() => {
    loadKeys();
    loadDocsTemplate();
  }, [currentAgentId]);

  // 复制到剪贴板
  const handleCopy = async (text: string) => {
    const success = await copyToClip(text);
    if (success) {
      message.success(t("action_copy_success"));
    } else {
      message.error(t("action_save_failed"));
    }
  };

  // 添加 API Key
  const handleAddKey = async () => {
    if (!currentAgentId) return;

    // 检查是否超过 10 个
    if (apiKeys.length >= 10) {
      message.warning(t("integrate.secret_key_limit"));
      return;
    }

    try {
      await agentApiKeyApi.create({
        agent_id: String(currentAgentId),
        expired_days: 0,
      });
      message.success(t("action.added"));
      loadKeys();
    } catch {
      message.error(t("action_save_failed"));
    }
  };

  // 删除 API Key
  const handleDelKey = async (item: AgentAPIKeyItem) => {
    if (!currentAgentId) return;
    Modal.confirm({
      title: t("tip"),
      content: t("integrate.delete_api_key_confirm"),
      onOk: async () => {
        try {
          await agentApiKeyApi.revoke(item.id);
          message.success(t("action_delete_success"));
          loadKeys();
        } catch {
        }
      },
    });
  };

  // 表格列定义
  const paramColumns = [
    { title: t("integrate.var_key"), dataIndex: "key", width: 160 },
    { title: t("integrate.required"), dataIndex: "required", width: 120 },
    { title: t("integrate.desc"), dataIndex: "desc" },
  ];

  const authColumns = [
    { title: t("integrate.param"), dataIndex: "key", width: 160 },
    { title: t("integrate.value"), dataIndex: "desc" },
  ];

  // 渲染接口文档内容
  const renderInterfaceContent = (endpoint: any) => {
    // 构建基础信息表格数据
    const baseInfoData = [
      { key: t("integrate.method"), value: endpoint.method.toUpperCase() },
      { key: t("integrate.endpoint"), value: `${apiHost}${endpoint.path}` },
      ...(endpoint.description ? [{ key: t("integrate.request_desc"), value: endpoint.description }] : []),
    ];

    // 构建参数表格数据
    const buildParamsTableData = (params: any[]) => {
      return params.map((p) => ({
        key: p.name,
        required: p.required ? t("common.yes") : t("common.no"),
        desc: p.description,
      }));
    };

    // 渲染 JSON 代码块
    const renderCodeBlock = (codeStr: string) => {
      // 替换占位符
      const baseUrl = window.location.origin;
      const apiKey = apiKeys.length > 0 ? apiKeys[0].secret_key : '';
      let processedStr = codeStr;
      processedStr = processedStr.replace(/\{\{BASE_URL\}\}/g, baseUrl);
      processedStr = processedStr.replace(/\{\{API_KEY\}\}/g, apiKey);
      processedStr = processedStr.replace(/\{\{USER\}\}/g, "user");
      processedStr = processedStr.replace(/\{\{CONVERSATION_ID\}\}/g, "4tpmOl");
      processedStr = processedStr.replace(/\{\{MESSAGE_ID\}\}/g, "KRaX5Q");
      processedStr = processedStr.replace(/\{\{FILE_ID\}\}/g, "uk6K2Y");
      processedStr = processedStr.replace(/\{\{RUN_ID\}\}/g, "run_8c41d6dc9d3c5c03ae7b59ba70566bc3");
      processedStr = processedStr.replace(/\{\{AGENT_ID\}\}/g, `${currentAgentId}`);
      processedStr = processedStr.replace(/\{\{BOT_ID\}\}/g, `${currentAgentId}`);

      return (
        <div className="w-full">
          <div className="text-placeholder flex items-center justify-end bg-[#EDEFF2] px-4 py-2 rounded-t-lg cursor-pointer" onClick={() => handleCopy(processedStr)}>
            <SvgIcon name="copy" className="inline-block w-4 h-4" />
          </div>
          <div className="bg-[#f6f7f8] rounded-b-lg overflow-hidden">
            <CodeMirror
              value={processedStr}
              theme="light"
              editable={false}
              extensions={[
                json(),
                EditorView.lineWrapping,
                EditorView.theme({
                  '&': { backgroundColor: '#f6f7f8' },
                  '.cm-scroller': { backgroundColor: '#f6f7f8' },
                  '.cm-content': { fontFamily: 'Consolas, Monaco, "Courier New", monospace', padding: '12px 16px' },
                  '.cm-gutters': { display: 'none' },
                  '.cm-cursor': { display: 'none' },
                  '.cm-focused .cm-cursor': { display: 'none' },
                }),
                codeMirrorSyntaxHighlight,
              ]}
              basicSetup={{
                lineNumbers: false,
                foldGutter: false,
                dropCursor: false,
                allowMultipleSelections: false,
                indentOnInput: false,
                bracketMatching: false,
                closeBrackets: false,
                autocompletion: false,
                rectangularSelection: false,
                crosshairCursor: false,
                highlightActiveLine: false,
                highlightActiveLineGutter: false,
                highlightSelectionMatches: false,
              }}
            />
          </div>
        </div>
      );
    };

    return (
      <div>
        {/* 基础信息 */}
        <div className="text-sm text-primary mb-2">{t("integrate.base_info")}</div>
        <div className="mb-6">
          <Table
            className="api-table-vertical"
            dataSource={baseInfoData}
            columns={[
              { title: t("integrate.param"), dataIndex: "key", width: 160 },
              { title: "", dataIndex: "value" },
            ]}
            pagination={false}
            size="small"
            rowKey="key"
            showHeader={false}
            bordered
          />
        </div>

        {/* Header */}
        <div className="text-sm text-primary mb-2">Header</div>
        <div className="text-sm text-secondary mb-6">{t("integrate.header_desc")}</div>

        {/* 参数说明 */}
        {endpoint.parameters && endpoint.parameters.filter((p: any) => ['query', 'body', 'formData'].includes(p.in)).length > 0 && (
          <div className="mb-6">
            <div className="text-sm text-primary mb-2">{t("integrate.param_desc")}</div>
            <Table
              className="api-table-horizontal"
              dataSource={buildParamsTableData(endpoint.parameters.filter((p: any) => ['query', 'body', 'formData'].includes(p.in)))}
              columns={paramColumns}
              pagination={false}
              size="small"
              rowKey="key"
              bordered
            />
          </div>
        )}

        {/* 请求示例 */}
        {endpoint.request_example && (
          <div className="mb-6">
            <div className="text-sm text-primary mb-2">{t("integrate.request_example")}</div>
            {renderCodeBlock(JSON.stringify(endpoint.request_example, null, 2))}
          </div>
        )}

        {/* 返回示例 */}
        {endpoint.response_example && (
          <div>
            <div className="text-sm text-primary mb-2">{t("integrate.response_example")}</div>
            {renderCodeBlock(JSON.stringify(endpoint.response_example, null, 2))}
          </div>
        )}
      </div>
    );
  };

  // 小助理专属：技能列表接口（与其它接口同一展示风格）
  const skillsEndpoint = showSkillsPanel
    ? {
        title: t('integrate.skills_list'),
        method: 'get',
        path: '/agent/skills',
        description: t('integrate.skills_list_desc'),
        parameters: [],
        response_example: skillsResponseExample,
      }
    : null;

  // 拼接最终展示的接口列表（小助理额外追加技能列表）
  const visibleEndpoints = [
    ...(docsTemplate?.endpoints?.filter(item => item.path !== '/health') ?? []),
    ...(skillsEndpoint ? [skillsEndpoint] : []),
  ];

  // Collapse 展开图标（实心箭头）
  const expandIcon = ({ isActive }: { isActive?: boolean }) => (
    <CaretRightFilled
      className="text-xs text-gray-400 transition-transform"
      rotate={isActive ? 90 : 0}
    />
  );

  return (
    <div className="w-full">
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
        <div className="text-base font-medium mb-5 text-primary">{t("integrate.api_access")}</div>

        {/* API Endpoint */}
        <div className="mt-6">
          <div className="text-sm text-secondary mb-2">API Endpoint</div>
          <div className="h-9 w-full border rounded-xl flex items-center bg-[#F6F6F9]">
            <div className="flex-1 px-3 text-sm text-primary">{apiHost}</div>
            <div className="text-placeholder border-l pl-4 pr-2 flex-center cursor-pointer" onClick={() => handleCopy(apiHost)}>
              <SvgIcon name="copy" className="inline-block w-4 h-4" />
            </div>
          </div>
        </div>

        {/* SECRET_KEY */}
        <div className="mt-5">
          <div className="flex justify-between items-center">
            <div className="text-sm text-secondary mb-2">SECRET_KEY</div>
              <Button type="link" className="!p-0" onClick={handleAddKey}>
                + {t("action.add")}
              </Button>
          </div>
          <div className="w-full">
            {apiKeys.length > 0 && (
              <>
                {apiKeys.map((item) => (
                  <div
                    key={item.id}
                    className="h-9 border rounded-xl flex items-center mb-[10px] bg-[#F6F6F9]"
                  >
                    <div className="flex-1 px-5 text-sm text-primary">
                      {item.secret_key.slice(0, 5)}......{item.secret_key.slice(-10)}
                    </div>
                    <div className="border-l pl-4 pr-2 flex-center gap-4">
                      <div className="text-placeholder cursor-pointer" onClick={() => handleCopy(item.secret_key)}>
                        <SvgIcon name="copy" className="inline-block size-4" />
                      </div>
                      <DeleteOutlined
                        className="cursor-pointer text-placeholder size-4"
                        onClick={() => handleDelKey(item)}
                      />
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {/* 鉴权 */}
      <Collapse
        className="bg-white rounded-xl border border-gray-200 mb-4"
        bordered={false}
        expandIcon={expandIcon}
        items={[
          {
            key: "auth",
            label: <span className="text-base text-primary">{t("integrate.auth")}</span>,
            children: (
              <div>
                <div className="text-sm text-secondary mb-4">
                  <div>{docsTemplate?.auth?.description}</div>
                </div>
                <Table
                  className="api-table-horizontal"
                  dataSource={[
                    {
                      key: "Authorization",
                      desc: "Bearer {SECRET_KEY}",
                    },
                  ]}
                  columns={authColumns}
                  pagination={false}
                  size="small"
                  rowKey="key"
                  bordered
                />
              </div>
            ),
          },
        ]}
      />

      {/* 接口文档列表（含小助理专属的技能列表接口） */}
      {visibleEndpoints.map((endpoint, index) => (
        <Collapse
          key={`${endpoint.path}-${index}`}
          className="bg-white rounded-xl border border-gray-200 mb-4"
          bordered={false}
          expandIconPosition="start"
          expandIcon={expandIcon}
          items={[
            {
              key: `interface-${index}`,
              label: <span className="text-base text-primary">{endpoint.title}</span>,
              children: renderInterfaceContent(endpoint),
            },
          ]}
        />
      ))}
    </div>
  );
};

export default ApiContent;
