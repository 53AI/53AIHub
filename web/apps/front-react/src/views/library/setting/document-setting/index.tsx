import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Button, Table, Select, Radio, Spin, message } from "antd";
import { chunkSettingApi } from "@/api/modules/chunk-setting";
import { settingApi } from "@/api/modules/setting";
import platformSettingsApi from "@/api/modules/platform-settings";
import { useLibraryStore } from "@/stores/modules/library";
import { Header } from "@/components/Header";
import { getPublicPath } from "@/utils/config";
import {
  getSimpleParserConfigs,
  type SimpleParserConfig,
} from "@/constants/parser";
import type { ColumnsType } from "antd/es/table";

interface TableDataRow {
  key: string;
  ext: string;
  name: string;
  extensions: string;
  preview: string;
  editor: string;
  func: string;
  config_id: string;
  allow_wps: boolean;
  allow_baidu_editor: boolean;
  allow_split: string[];
}

const SETTING_KEY = "document_js_sdk_setting";
const SETTING_KEY_PARSE = "document_setting";

const defaultTableData: TableDataRow[] = [
  {
    key: "doc",
    ext: "doc",
    name: "Word",
    extensions: "doc, docx",
    preview: "default",
    editor: "default",
    func: "default",
    config_id: "",
    allow_wps: true,
    allow_baidu_editor: false,
    allow_split: ["default"],
  },
  {
    key: "xls",
    ext: "xls",
    name: "Excel",
    extensions: "xls, xlsx, csv",
    preview: "default",
    editor: "default",
    func: "default",
    config_id: "",
    allow_wps: true,
    allow_baidu_editor: false,
    allow_split: ["default", "data_table", "qa"],
  },
  {
    key: "ppt",
    ext: "ppt",
    name: "PowerPoint",
    extensions: "ppt, pptx",
    preview: "default",
    editor: "default",
    func: "default",
    config_id: "",
    allow_wps: true,
    allow_baidu_editor: false,
    allow_split: ["default"],
  },
  {
    key: "pdf",
    ext: "pdf",
    name: "PDF",
    extensions: "pdf",
    preview: "default",
    editor: "default",
    func: "default",
    config_id: "",
    allow_wps: true,
    allow_baidu_editor: false,
    allow_split: ["default"],
  },
  {
    key: "md",
    ext: "md",
    name: "Markdown",
    extensions: "md, txt",
    preview: "default",
    editor: "builtin_editor",
    func: "default",
    config_id: "",
    allow_wps: false,
    allow_baidu_editor: false,
    allow_split: ["default"],
  },
  {
    key: "html",
    ext: "html",
    name: "HTML",
    extensions: "html, htm",
    preview: "default",
    editor: "default",
    func: "default",
    config_id: "",
    allow_wps: false,
    allow_baidu_editor: true,
    allow_split: ["default"],
  },
];

export function LibraryDocumentSettingsView() {
  const { id } = useParams<{ id: string }>();
  const libraryStore = useLibraryStore();
  const [loading, setLoading] = useState(false);
  const [isCustom, setIsCustom] = useState(false);
  const [isParent, setIsParent] = useState(false);
  const [tableData, setTableData] = useState<TableDataRow[]>(defaultTableData);
  const [chunkSettingList, setChunkSettingList] = useState<any[]>([]);
  const [wpsSetting, setWpsSetting] = useState<any>(null);
  const [settingId, setSettingId] = useState<number | null>(null);
  const [parseSettingId, setParseSettingId] = useState<number | null>(null);
  const [settingsMap, setSettingsMap] = useState<
    Record<string, SimpleParserConfig | null>
  >({});

  const parserConfigs = getSimpleParserConfigs();

  const loadChunkSetting = async () => {
    const list = await chunkSettingApi.list();
    setChunkSettingList(
      list.map((item: any) => ({
        id: item.id.toString(),
        ...item,
      })),
    );
  };

  const loadAllParserSettings = async () => {
    const res = await platformSettingsApi.find();
    const wps = res.find((item: any) => item.platform_key === "wps");
    if (wps) {
      setWpsSetting(wps);
    }
    // 构建解析器配置映射
    const map: Record<string, SimpleParserConfig | null> = {};
    res.forEach((item: any) => {
      const config = parserConfigs.find(
        (p) => p.platform_key === item.platform_key,
      );
      if (config) {
        map[config.key] = config;
      }
    });
    setSettingsMap(map);
  };

  const loadViewerSetting = async () => {
    if (!libraryStore.library_id) return;
    const res = await settingApi.get(SETTING_KEY, {
      library_id: libraryStore.library_id,
    });
    if (res) {
      setSettingId(res.setting_id);
      setIsCustom(!!res.library_id);
      setIsParent(!res.library_id);
      const valueData = JSON.parse(res.value);
      setTableData((prev) =>
        prev.map((item) => {
          const previewData = valueData.preview?.[item.ext];
          const editorData = valueData.editor?.[item.ext];
          return {
            ...item,
            preview: wpsSetting && previewData ? previewData : "default",
            editor: wpsSetting && editorData ? editorData : "default",
          };
        }),
      );
    }
  };

  const loadParserSetting = async () => {
    if (!libraryStore.library_id) return;
    const res = await settingApi.get(SETTING_KEY_PARSE, {
      library_id: libraryStore.library_id,
    });
    if (res) {
      setParseSettingId(res.setting_id);
      setIsCustom(!!res.library_id);
      setIsParent(!res.library_id);
      const valueData = JSON.parse(res.value);
      setTableData((prev) =>
        prev.map((item) => {
          const data = valueData.find((d: any) => d.ext === item.ext);
          if (data) {
            return {
              ...item,
              func: data.func || "default",
              config_id:
                chunkSettingList.find((s) => s.id === data.config_id)?.id ||
                chunkSettingList[0]?.id ||
                "",
            };
          }
          return {
            ...item,
            func: "default",
            config_id: chunkSettingList[0]?.id || "",
          };
        }),
      );
    } else {
      // Set default config_id
      setTableData((prev) =>
        prev.map((item) => ({
          ...item,
          config_id: chunkSettingList[0]?.id || "",
        })),
      );
    }
  };

  const loadSetting = async () => {
    setLoading(true);
    try {
      await loadViewerSetting();
      await loadParserSetting();
    } finally {
      setLoading(false);
    }
  };

  const handleViewerSave = async () => {
    if (!libraryStore.library_id) return;
    const data = {
      key: SETTING_KEY,
      library_id: libraryStore.library_id,
      value: JSON.stringify({
        preview: tableData.reduce((acc: any, item) => {
          acc[item.ext] = item.preview;
          return acc;
        }, {}),
        editor: tableData.reduce((acc: any, item) => {
          acc[item.ext] = item.editor;
          return acc;
        }, {}),
      }),
    };
    if (isCustom) {
      if (isParent) {
        await settingApi.create(data);
      } else {
        if (settingId) {
          await settingApi.update(settingId, data);
        }
      }
    } else {
      if (settingId && !isParent) {
        await settingApi.delete(settingId);
      }
    }
  };

  const handleParseSave = async () => {
    if (!libraryStore.library_id) return;
    const data = {
      key: SETTING_KEY_PARSE,
      library_id: libraryStore.library_id,
      value: JSON.stringify(
        tableData.map((item) => ({
          ext: item.ext,
          func: item.func,
          config_id: item.config_id,
        })),
      ),
    };
    if (isCustom) {
      if (isParent) {
        await settingApi.create(data);
      } else {
        if (parseSettingId) {
          await settingApi.update(parseSettingId, data);
        }
      }
    } else {
      if (parseSettingId && !isParent) {
        await settingApi.delete(parseSettingId);
      }
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await handleViewerSave();
      await handleParseSave();
      await loadSetting();
      message.success("保存成功");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        await loadAllParserSettings();
        await loadChunkSetting();
        await loadSetting();
      } finally {
        setLoading(false);
      }
    };
    if (libraryStore.library_id) {
      init();
    }
  }, [libraryStore.library_id]);

  const columns: ColumnsType<TableDataRow> = [
    {
      title: "文档类型",
      dataIndex: "name",
      key: "name",
      width: 200,
      render: (name, record) => (
        <div className="flex items-center gap-2">
          <img
            src={getPublicPath(`/images/parse/${record.ext}.png`)}
            className="size-5"
            alt=""
          />
          <span className="text-sm text-[#4F5052]">{name}</span>
        </div>
      ),
    },
    {
      title: "支持格式",
      dataIndex: "extensions",
      key: "extensions",
      render: (extensions) => (
        <span className="text-sm text-gray-600">{extensions}</span>
      ),
    },
    {
      title: "查看",
      dataIndex: "preview",
      key: "preview",
      width: 160,
      render: (preview, record) => (
        <Select
          value={preview}
          disabled={!isCustom}
          style={{ width: "100%" }}
          onChange={(value) => {
            setTableData((prev) =>
              prev.map((item) =>
                item.key === record.key ? { ...item, preview: value } : item,
              ),
            );
          }}
          options={[
            { label: "53AI Viewer", value: "default" },
            ...(wpsSetting ? [{ label: "WPS WebOffice", value: "wps" }] : []),
          ]}
        />
      ),
    },
    {
      title: "编辑",
      dataIndex: "editor",
      key: "editor",
      width: 160,
      render: (editor, record) => (
        <Select
          value={editor}
          disabled={!isCustom}
          style={{ width: "100%" }}
          onChange={(value) => {
            setTableData((prev) =>
              prev.map((item) =>
                item.key === record.key ? { ...item, editor: value } : item,
              ),
            );
          }}
          options={[
            { label: "不开启", value: "default" },
            ...(record.ext === "md"
              ? [{ label: "53AI Editor", value: "builtin_editor" }]
              : []),
            ...(wpsSetting && record.allow_wps
              ? [{ label: "WPS WebOffice", value: "wps" }]
              : []),
            ...(record.allow_baidu_editor
              ? [{ label: "百度编辑器", value: "baidu_editor" }]
              : []),
          ]}
        />
      ),
    },
    {
      title: "解析",
      dataIndex: "func",
      key: "func",
      width: 160,
      render: (func, record) => (
        <Select
          value={func}
          disabled={!isCustom}
          style={{ width: "100%" }}
          onChange={(value) => {
            setTableData((prev) =>
              prev.map((item) =>
                item.key === record.key ? { ...item, func: value } : item,
              ),
            );
          }}
          options={[
            { label: "标准解析", value: "default" },
            ...parserConfigs
              .filter(
                (p) =>
                  settingsMap[p.key] &&
                  (!p.supportedExts || p.supportedExts.includes(record.ext)),
              )
              .map((p) => ({ label: p.name, value: p.key })),
          ]}
        />
      ),
    },
    {
      title: "拆分",
      dataIndex: "config_id",
      key: "config_id",
      width: 160,
      render: (config_id, record) => (
        <Select
          value={config_id}
          disabled={!isCustom}
          style={{ width: "100%" }}
          onChange={(value) => {
            setTableData((prev) =>
              prev.map((item) =>
                item.key === record.key ? { ...item, config_id: value } : item,
              ),
            );
          }}
          options={chunkSettingList
            .filter((item) =>
              record.allow_split.includes(
                item.chunking_config?.type || "default",
              ),
            )
            .map((item) => ({
              label: item.chunking_config?.name || item.id,
              value: item.id,
            }))}
        />
      ),
    },
  ];

  return (
    <div className="flex-1 h-screen flex flex-col overflow-hidden px-[60px] bg-[#F8F9FA]">
      <Header className="pt-8 pb-5" title="文档清洗" />
      <Spin spinning={loading}>
        <div className="bg-[#ffffff] flex-1 gap-6 px-10 py-8 overflow-y-auto mb-5">
          <div className="flex items-center mb-4">
            <span className="text-sm text-[#4F5052] mr-4">文档清洗设置</span>
            <Radio.Group
              value={isCustom}
              onChange={(e) => setIsCustom(e.target.value)}
            >
              <Radio value={false}>继承后台统一设置</Radio>
              <Radio value={true}>自定义</Radio>
            </Radio.Group>
          </div>

          <div className="px-5 py-4 border rounded-md">
            <Table
              columns={columns}
              dataSource={tableData}
              rowKey="key"
              pagination={false}
              components={{
                header: {
                  cell: (props: any) => (
                    <th {...props} className="!bg-[#F5F6F7] !text-[#999999]" />
                  ),
                },
              }}
            />
          </div>

          <Button type="primary" className="mt-6" onClick={handleSave}>
            保存
          </Button>
        </div>
      </Spin>
    </div>
  );
}

export default LibraryDocumentSettingsView;
