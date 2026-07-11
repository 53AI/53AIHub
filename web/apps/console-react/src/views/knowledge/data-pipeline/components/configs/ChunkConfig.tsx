import { useEffect, useState, useMemo } from "react";
import { Radio, Checkbox, Select, InputNumber, Switch } from "antd";
import { Dropdown } from "@km/shared-components-react";
import { CheckOutlined, DownOutlined } from "@ant-design/icons";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import { getPublicPath } from "@/utils/config";

const CONFIG = {
  maxLength: { min: 50, max: 50000 },
  headerList: [
    { type: "h1", label: t("data_pipeline.chunk_header_h1") },
    { type: "h2", label: t("data_pipeline.chunk_header_h2") },
    { type: "h3", label: t("data_pipeline.chunk_header_h3") },
    { type: "h4", label: t("data_pipeline.chunk_header_h4") },
    { type: "h5", label: t("data_pipeline.chunk_header_h5") },
  ],
  commonList: [
    { label: t("data_pipeline.chunk_common_newline1"), value: "\\n" },
    { label: t("data_pipeline.chunk_common_newline2"), value: "\\n\\n" },
    { label: t("data_pipeline.chunk_common_period"), value: "。" },
    { label: t("data_pipeline.chunk_common_exclamation"), value: "！" },
    { label: t("data_pipeline.chunk_common_question"), value: "？" },
    { label: t("data_pipeline.chunk_common_semicolon"), value: "；" },
    { label: t("data_pipeline.chunk_common_divider"), value: "---" },
  ],
};

const CHUNK_TYPE = {
  CUSTOM: "custom",
  NONE: "none",
  DEFAULT: "default",
};

const SPLIT_TYPE = {
  HEADING: "heading",
  CUSTOM: "custom",
};

const CHUNK_MODE = {
  LENGTH: "length",
  IDENTIFIER: "identifier",
};

const CHUNK_TYPES = [
  {
    key: "default",
    name: t("data_pipeline.chunk_type_default"),
    desc: t("data_pipeline.chunk_type_default_desc"),
    icon: getPublicPath("/images/split/default.png"),
  },
  {
    key: "data_table",
    name: t("data_pipeline.chunk_type_data_table"),
    desc: t("data_pipeline.chunk_type_data_table_desc"),
    icon: getPublicPath("/images/split/data_table.png"),
    disabled: true,
  },
  {
    key: "qa",
    name: t("data_pipeline.chunk_type_qa"),
    desc: t("data_pipeline.chunk_type_qa_desc"),
    icon: getPublicPath("/images/split/qa.png"),
  },
];

// 特殊字符映射表
const ESCAPE_MAP: Record<string, string> = {
  "\n": "\\n",
  "\n\n": "\\n\\n",
  "\r\n": "\\r\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
  "\v": "\\v",
};
const REVERSE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(ESCAPE_MAP).map(([k, v]) => [v, k]),
);
const formatDisplayValue = (value: string) => ESCAPE_MAP[value] ?? value;
const parseInputValue = (input: string) => REVERSE_MAP[input] ?? input;

interface InternalState {
  knowledge_chunking_type: string;
  knowledge_chunking_rule: string[];
  knowledge_chunking_head: string;
  knowledge_chunking_input: string[];
  index_chunking_type: string;
  index_chunking_rule: string[];
  index_chunking_head: string;
  index_chunking_input: string[];
}

export function ChunkConfig({ config, onUpdateConfig }: ChunkConfigProps) {
  // Helper function to update config
  const updateConfig = (patch: Partial<ChunkConfigProps["config"]>) => {
    onUpdateConfig?.({
      ...config,
      ...patch,
    });
  };

  // 内部使用的辅助状态
  const [internalState, setInternalState] = useState<InternalState>({
    knowledge_chunking_type: CHUNK_TYPE.DEFAULT,
    knowledge_chunking_rule: [SPLIT_TYPE.HEADING],
    knowledge_chunking_head: CONFIG.headerList[0].type,
    knowledge_chunking_input: [],
    index_chunking_type: CHUNK_TYPE.DEFAULT,
    index_chunking_rule: [SPLIT_TYPE.HEADING],
    index_chunking_head: CONFIG.headerList[0].type,
    index_chunking_input: [],
  });

  // 初始化配置结构
  useEffect(() => {
    const defaultParentChunk = {
      mode: "custom",
      strategy: CHUNK_MODE.IDENTIFIER,
      identifier_level: "h2",
      max_length: 2048,
      append_filename: true,
      append_title: true,
      append_subtitle: true,
    };
    const defaultChildChunk = {
      mode: "custom",
      strategy: CHUNK_MODE.LENGTH,
      identifier_level: "h3",
      max_length: 512,
    };
    const defaultIndexEnhancement = {
      metadata_injection: {
        append_filename: true,
        append_title: true,
        append_subtitle: true,
      },
      generative_enhancement: {
        generate_summary: true,
        generate_faq: true,
      },
    };

    const needsUpdate =
      !config.parent_chunk ||
      !config.child_chunk ||
      !config.index_enhancement ||
      !config.chunk_type ||
      config.enable_smart_match === undefined ||
      config.match_preference_prompt === undefined;

    if (needsUpdate) {
      updateConfig({
        parent_chunk: config.parent_chunk || defaultParentChunk,
        child_chunk: config.child_chunk || defaultChildChunk,
        index_enhancement: config.index_enhancement || defaultIndexEnhancement,
        chunk_type: config.chunk_type || "default",
        enable_smart_match: config.enable_smart_match ?? false,
        match_preference_prompt: config.match_preference_prompt ?? "",
      });
    }

    // 解析 identifier_level 到 internalState
    const parseRule = (prefix: "knowledge" | "index") => {
      const targetConfig =
        prefix === "knowledge"
          ? config.parent_chunk || defaultParentChunk
          : config.child_chunk || defaultChildChunk;
      const rule = targetConfig?.identifier_level;

      if (!rule) return;

      // Always set to CUSTOM if there's a rule
      setInternalState((prev) => ({
        ...prev,
        [`${prefix}_chunking_type`]: CHUNK_TYPE.CUSTOM,
      }));

      const parts = rule.split(",");
      const headers = CONFIG.headerList.map((h) => h.type);
      const newRules: string[] = [];
      let newHead = CONFIG.headerList[0].type;
      let newInput: string[] = [];

      if (headers.includes(parts[0])) {
        newHead = parts[0];
        newRules.push(SPLIT_TYPE.HEADING);
        newInput = parts.slice(1).map(formatDisplayValue);
      } else {
        newInput = parts.map(formatDisplayValue);
      }

      if (newInput.length > 0) {
        newRules.push(SPLIT_TYPE.CUSTOM);
      }

      setInternalState((prev) => ({
        ...prev,
        [`${prefix}_chunking_rule`]: newRules,
        [`${prefix}_chunking_head`]: newHead,
        [`${prefix}_chunking_input`]: newInput,
      }));
    };

    parseRule("knowledge");
    parseRule("index");
  }, []);

  // 同步 internalState 到 props.config
  const syncToConfig = (prefix: "knowledge" | "index") => {
    const type =
      prefix === "knowledge"
        ? internalState.knowledge_chunking_type
        : internalState.index_chunking_type;
    const targetConfig =
      prefix === "knowledge" ? config.parent_chunk : config.child_chunk;
    if (!targetConfig) return;

    let newIdentifierLevel = targetConfig.identifier_level;

    if (type === CHUNK_TYPE.NONE) {
      newIdentifierLevel = "";
    } else if (type === CHUNK_TYPE.DEFAULT) {
      // keep default
    } else {
      const rules =
        prefix === "knowledge"
          ? internalState.knowledge_chunking_rule
          : internalState.index_chunking_rule;
      const parts = [];
      if (rules.includes(SPLIT_TYPE.HEADING)) {
        parts.push(
          prefix === "knowledge"
            ? internalState.knowledge_chunking_head
            : internalState.index_chunking_head,
        );
      }
      if (rules.includes(SPLIT_TYPE.CUSTOM)) {
        parts.push(
          ...(prefix === "knowledge"
            ? internalState.knowledge_chunking_input
            : internalState.index_chunking_input
          ).map(parseInputValue),
        );
      }
      newIdentifierLevel = parts.join(",");
    }

    if (newIdentifierLevel !== targetConfig.identifier_level) {
      if (prefix === "knowledge") {
        updateConfig({
          parent_chunk: {
            ...config.parent_chunk!,
            identifier_level: newIdentifierLevel,
          },
        });
      } else {
        updateConfig({
          child_chunk: {
            ...config.child_chunk!,
            identifier_level: newIdentifierLevel,
          },
        });
      }
    }
  };

  // Watch internalState changes
  useEffect(() => {
    syncToConfig("knowledge");
    syncToConfig("index");
  }, [internalState]);

  const knowledgeCommonList = useMemo(() => {
    const list = internalState.knowledge_chunking_input.filter(
      (item) => !CONFIG.commonList.some((common) => common.value === item),
    );
    return CONFIG.commonList.concat(
      list.map((item) => ({ label: item, value: item })),
    );
  }, [internalState.knowledge_chunking_input]);

  const indexCommonList = useMemo(() => {
    const list = internalState.index_chunking_input.filter(
      (item) => !CONFIG.commonList.some((common) => common.value === item),
    );
    return CONFIG.commonList.concat(
      list.map((item) => ({ label: item, value: item })),
    );
  }, [internalState.index_chunking_input]);

  const getHeadingLabel = (type: "knowledge" | "index") => {
    const headKey =
      type === "knowledge"
        ? internalState.knowledge_chunking_head
        : internalState.index_chunking_head;
    return (
      CONFIG.headerList.find((item) => item.type === headKey)?.label ||
      CONFIG.headerList[0].label
    );
  };

  const handleChangeHeading = (type: "knowledge" | "index", value: string) => {
    setInternalState((prev) => ({
      ...prev,
      [`${type}_chunking_head`]: value,
    }));
  };

  const handleChangeChunkMode = (
    type: "knowledge" | "index",
    value: string,
  ) => {
    const chunkingType =
      type === "knowledge"
        ? internalState.knowledge_chunking_type
        : internalState.index_chunking_type;
    if (chunkingType === CHUNK_TYPE.DEFAULT) return;
    if (type === "knowledge" && config.parent_chunk) {
      updateConfig({
        parent_chunk: {
          ...config.parent_chunk,
          strategy: value,
        },
      });
    } else if (type === "index" && config.child_chunk) {
      updateConfig({
        child_chunk: {
          ...config.child_chunk,
          strategy: value,
        },
      });
    }
  };

  const handleBlurMaxLength = (type: "knowledge" | "index") => {
    const conf =
      type === "knowledge" ? config.parent_chunk : config.child_chunk;
    if (!conf) return;
    if (type === "knowledge") {
      const newParentMax = Math.max(
        Math.min(conf.max_length || CONFIG.maxLength.min, CONFIG.maxLength.max),
        CONFIG.maxLength.min,
      );
      // 同步更新检索块最大长度
      const newChildMax = config.child_chunk
        ? Math.max(
            Math.min(
              config.child_chunk.max_length || CONFIG.maxLength.min,
              newParentMax,
            ),
            CONFIG.maxLength.min,
          )
        : undefined;

      updateConfig({
        parent_chunk: {
          ...config.parent_chunk!,
          max_length: newParentMax,
        },
        ...(config.child_chunk && newChildMax !== undefined
          ? {
              child_chunk: {
                ...config.child_chunk,
                max_length: newChildMax,
              },
            }
          : {}),
      });
    } else {
      const knowledgeMax =
        config.parent_chunk?.max_length || CONFIG.maxLength.max;
      const newChildMax = Math.max(
        Math.min(conf.max_length || CONFIG.maxLength.min, knowledgeMax),
        CONFIG.maxLength.min,
      );
      updateConfig({
        child_chunk: {
          ...config.child_chunk!,
          max_length: newChildMax,
        },
      });
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* 智能匹配开关 */}
      <div className="flex items-center gap-2 mb-5">
        <span className="text-base text-primary">{t("data_pipeline.smart_match")}</span>
        <Switch
          checked={Boolean(config.enable_smart_match)}
          onChange={(checked) => {
            updateConfig({
              enable_smart_match: checked,
              chunk_type: "default",
              match_preference_prompt: ""
            });
          }}
        />
        <span className="text-sm text-disabled">
          {config.enable_smart_match
            ? t("data_pipeline.smart_match_on_desc")
            : t("data_pipeline.smart_match_off_desc")}
        </span>
      </div>
      {/* chunk_type 卡片 */}
      <div className="grid grid-cols-3 gap-4 transition-opacity">
        {CHUNK_TYPES.map((type) => {
          const isSelected = config.chunk_type === type.key && !config.enable_smart_match;
          return (
            <div
              key={type.key}
              className={`flex flex-col bg-white border rounded-xl p-4 transition-all cursor-pointer relative ${
                isSelected
                  ? "border-[#2563EB] shadow-[0_0_0_2px_rgba(37,99,235,0.08)]"
                  : "border-[#E8EEFA]"
              } ${config.enable_smart_match ? "cursor-not-allowed" : "hover:border-[#C6D4F7]"}`}
              onClick={() => {
                if (config.enable_smart_match) return;
                updateConfig({ chunk_type: type.key });
              }}
            >
              {isSelected && (
                <div className="absolute top-0 right-0">
                  <div className="w-0 h-0 border-t-[30px] border-t-[#2563EB] border-l-[30px] border-l-transparent rounded-tr-xl"></div>
                  <CheckOutlined
                    className="absolute top-1 right-1 text-white"
                    style={{ fontSize: 10 }}
                  />
                </div>
              )}
              <div className="w-10 h-10 mb-4 rounded overflow-hidden bg-gray-50 flex items-center justify-center">
                <img
                  src={type.icon}
                  className="size-8 object-contain"
                  alt={type.name}
                />
              </div>
              <div className="text-base font-semibold text-primary mb-1">
                {type.name}
              </div>
              <div className="text-sm text-disabled leading-normal">
                {type.desc}
              </div>
            </div>
          );
        })}
      </div>

      {config.chunk_type === "default" && !config.enable_smart_match && (
        <div className="space-y-4">
          {/* 知识点配置 */}
          <div className="border rounded">
            <div className="h-12 flex items-center gap-2 px-5 border-b">
              <SvgIcon name="notebook-one" width={16} height={16} />
              <h4 className="text-sm text-primary">
                {t("data_pipeline.chunk_knowledge_point")}
              </h4>
            </div>
            <div className="py-5 px-10 flex flex-col gap-4">
              <div className="flex items-center">
                <Radio.Group
                  value={internalState.knowledge_chunking_type}
                  onChange={(e) => {
                    const newType = e.target.value;
                    if (newType === CHUNK_TYPE.DEFAULT) {
                      // 重置为默认值
                      setInternalState((prev) => ({
                        ...prev,
                        knowledge_chunking_type: CHUNK_TYPE.DEFAULT,
                        knowledge_chunking_rule: [SPLIT_TYPE.HEADING],
                        knowledge_chunking_head: "h2",
                        knowledge_chunking_input: [],
                      }));
                      updateConfig({
                        parent_chunk: {
                          ...config.parent_chunk!,
                          strategy: CHUNK_MODE.IDENTIFIER,
                          identifier_level: "h2",
                          max_length: 2048,
                          append_filename: true,
                          append_title: true,
                          append_subtitle: true,
                        },
                      });
                    } else if (newType === CHUNK_TYPE.NONE) {
                      setInternalState((prev) => ({
                        ...prev,
                        knowledge_chunking_type: CHUNK_TYPE.NONE,
                      }));
                    } else {
                      setInternalState((prev) => ({
                        ...prev,
                        knowledge_chunking_type: CHUNK_TYPE.CUSTOM,
                      }));
                    }
                  }}
                >
                  <Radio value={CHUNK_TYPE.DEFAULT}>
                    {t("data_pipeline.chunk_default")}
                  </Radio>
                  <Radio value={CHUNK_TYPE.CUSTOM}>
                    {t("data_pipeline.chunk_custom")}
                  </Radio>
                  <Radio value={CHUNK_TYPE.NONE}>
                    {t("data_pipeline.chunk_none")}
                  </Radio>
                </Radio.Group>
              </div>

              {[CHUNK_TYPE.CUSTOM, CHUNK_TYPE.DEFAULT].includes(
                internalState.knowledge_chunking_type,
              ) && (
                <div className="flex items-center gap-2">
                  <div
                    className="w-[212px] h-9 px-3 border rounded flex items-center gap-1.5 cursor-pointer"
                    style={{
                      borderColor:
                        config.parent_chunk?.strategy === CHUNK_MODE.LENGTH
                          ? "#2563EB"
                          : undefined,
                    }}
                    onClick={() =>
                      handleChangeChunkMode("knowledge", CHUNK_MODE.LENGTH)
                    }
                  >
                    <div className="size-5 rounded bg-[#E0EAFF] flex items-center justify-center text-brand">
                      <SvgIcon name="list-numbers" width={14} height={14} />
                    </div>
                    <span className="flex-1 text-sm text-primary">
                      {t("data_pipeline.chunk_length_first")}
                    </span>
                    <Radio
                      checked={
                        config.parent_chunk?.strategy === CHUNK_MODE.LENGTH
                      }
                      disabled={
                        internalState.knowledge_chunking_type ===
                        CHUNK_TYPE.DEFAULT
                      }
                    />
                  </div>
                  <div
                    className="w-[212px] h-9 px-3 border rounded flex items-center gap-1.5 cursor-pointer"
                    style={{
                      borderColor:
                        config.parent_chunk?.strategy === CHUNK_MODE.IDENTIFIER
                          ? "#2563EB"
                          : undefined,
                    }}
                    onClick={() =>
                      handleChangeChunkMode("knowledge", CHUNK_MODE.IDENTIFIER)
                    }
                  >
                    <div className="size-5 rounded bg-[#FFF1D6] flex items-center justify-center text-[#F0A105]">
                      #
                    </div>
                    <span className="flex-1 text-sm text-primary">
                      标识符优先
                    </span>
                    <Radio
                      checked={
                        config.parent_chunk?.strategy === CHUNK_MODE.IDENTIFIER
                      }
                      disabled={
                        internalState.knowledge_chunking_type ===
                        CHUNK_TYPE.DEFAULT
                      }
                    />
                  </div>
                </div>
              )}

              {[CHUNK_TYPE.CUSTOM, CHUNK_TYPE.DEFAULT].includes(
                internalState.knowledge_chunking_type,
              ) && (
                <div className="p-4 bg-[#F8F9FA] rounded-md space-y-3">
                  <div className="flex items-center">
                    <div className="flex-none w-20 text-sm text-secondary">
                      {t("data_pipeline.chunk_identifier")}
                    </div>
                    <Checkbox.Group
                      value={internalState.knowledge_chunking_rule}
                      onChange={(values) =>
                        setInternalState((prev) => ({
                          ...prev,
                          knowledge_chunking_rule: values as string[],
                        }))
                      }
                      disabled={
                        internalState.knowledge_chunking_type ===
                        CHUNK_TYPE.DEFAULT
                      }
                    >
                      <Checkbox value={SPLIT_TYPE.HEADING} className="!mr-0" />
                      <Dropdown
                        menu={{
                          items: CONFIG.headerList.map((item) => ({
                            key: item.type,
                            label: item.label,
                          })),
                          onClick: (e) =>
                            handleChangeHeading("knowledge", e.key),
                        }}
                        trigger={["click"]}
                      >
                        <div className="flex items-center mr-5 ml-2 text-sm text-secondary cursor-pointer">
                          {getHeadingLabel("knowledge")}
                          <DownOutlined className="ml-1" />
                        </div>
                      </Dropdown>
                      <Checkbox value={SPLIT_TYPE.CUSTOM} />
                      <div className="flex items-center gap-2 ml-2">
                        <span className="text-sm text-secondary whitespace-nowrap">
                          指定标识符
                        </span>
                        <Select
                          value={internalState.knowledge_chunking_input}
                          onChange={(values) =>
                            setInternalState((prev) => ({
                              ...prev,
                              knowledge_chunking_input: values as string[],
                            }))
                          }
                          className="w-48"
                          mode="multiple"
                          options={knowledgeCommonList.map((item) => ({
                            label: item.label,
                            value: item.value,
                          }))}
                          disabled={
                            internalState.knowledge_chunking_type ===
                            CHUNK_TYPE.DEFAULT
                          }
                        />
                      </div>
                    </Checkbox.Group>
                  </div>

                  <div className="flex items-center">
                    <div className="flex-none w-20 text-sm text-secondary">
                      {t("data_pipeline.chunk_length")}
                    </div>
                    <InputNumber
                      value={config.parent_chunk?.max_length}
                      onChange={(value) => {
                        if (config.parent_chunk) {
                          updateConfig({
                            parent_chunk: {
                              ...config.parent_chunk,
                              max_length: value || CONFIG.maxLength.min,
                            },
                          });
                        }
                      }}
                      min={CONFIG.maxLength.min}
                      max={CONFIG.maxLength.max}
                      controls={false}
                      className="!w-32"
                      disabled={
                        internalState.knowledge_chunking_type ===
                        CHUNK_TYPE.DEFAULT
                      }
                      onBlur={() => handleBlurMaxLength("knowledge")}
                    />
                  </div>

                  <div className="flex items-center">
                    <div className="flex-none w-20 text-sm text-secondary">
                      召回语料
                    </div>
                    <div className="flex gap-4">
                      <Checkbox
                        checked={config.parent_chunk?.append_filename}
                        onChange={(e) => {
                          if (config.parent_chunk) {
                            updateConfig({
                              parent_chunk: {
                                ...config.parent_chunk,
                                append_filename: e.target.checked,
                              },
                            });
                          }
                        }}
                        disabled={
                          internalState.knowledge_chunking_type ===
                          CHUNK_TYPE.DEFAULT
                        }
                      >
                        叠加文件名
                      </Checkbox>
                      <Checkbox
                        checked={config.parent_chunk?.append_title}
                        onChange={(e) => {
                          if (config.parent_chunk) {
                            updateConfig({
                              parent_chunk: {
                                ...config.parent_chunk,
                                append_title: e.target.checked,
                                append_subtitle: e.target.checked,
                              },
                            });
                          }
                        }}
                        disabled={
                          internalState.knowledge_chunking_type ===
                          CHUNK_TYPE.DEFAULT
                        }
                      >
                        叠加标题及子标题
                      </Checkbox>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 检索块配置 */}
          <div className="border rounded">
            <div className="h-12 flex items-center gap-2 px-5 border-b">
              <SvgIcon name="layers" width={16} height={16} />
              <h4 className="text-sm text-primary">
                {t("data_pipeline.chunk_retrieval_block")}
              </h4>
            </div>
            <div className="py-5 px-10 flex flex-col gap-4">
              <div className="flex items-center">
                <Radio.Group
                  value={internalState.index_chunking_type}
                  onChange={(e) => {
                    const newType = e.target.value;
                    if (newType === CHUNK_TYPE.DEFAULT) {
                      // 重置为默认值
                      setInternalState((prev) => ({
                        ...prev,
                        index_chunking_type: CHUNK_TYPE.DEFAULT,
                        index_chunking_rule: [SPLIT_TYPE.HEADING],
                        index_chunking_head: "h3",
                        index_chunking_input: [],
                      }));
                      updateConfig({
                        child_chunk: {
                          ...config.child_chunk!,
                          strategy: CHUNK_MODE.LENGTH,
                          identifier_level: "h3",
                          max_length: 512,
                        },
                      });
                    } else if (newType === CHUNK_TYPE.NONE) {
                      setInternalState((prev) => ({
                        ...prev,
                        index_chunking_type: CHUNK_TYPE.NONE,
                      }));
                    } else {
                      setInternalState((prev) => ({
                        ...prev,
                        index_chunking_type: CHUNK_TYPE.CUSTOM,
                      }));
                    }
                  }}
                >
                  <Radio value={CHUNK_TYPE.DEFAULT}>
                    {t("data_pipeline.chunk_default")}
                  </Radio>
                  <Radio value={CHUNK_TYPE.CUSTOM}>
                    {t("data_pipeline.chunk_custom")}
                  </Radio>
                  <Radio value={CHUNK_TYPE.NONE}>
                    {t("data_pipeline.chunk_none")}
                  </Radio>
                </Radio.Group>
              </div>

              {[CHUNK_TYPE.CUSTOM, CHUNK_TYPE.DEFAULT].includes(
                internalState.index_chunking_type,
              ) && (
                <div className="flex items-center gap-2">
                  <div
                    className="w-[212px] h-9 px-3 border rounded flex items-center gap-1.5 cursor-pointer"
                    style={{
                      borderColor:
                        config.child_chunk?.strategy === CHUNK_MODE.LENGTH
                          ? "#2563EB"
                          : undefined,
                    }}
                    onClick={() =>
                      handleChangeChunkMode("index", CHUNK_MODE.LENGTH)
                    }
                  >
                    <div className="size-5 rounded bg-[#E0EAFF] flex items-center justify-center text-brand">
                      <SvgIcon name="list-numbers" width={14} height={14} />
                    </div>
                    <span className="flex-1 text-sm text-primary">
                      {t("data_pipeline.chunk_length_first")}
                    </span>
                    <Radio
                      checked={
                        config.child_chunk?.strategy === CHUNK_MODE.LENGTH
                      }
                      disabled={
                        internalState.index_chunking_type === CHUNK_TYPE.DEFAULT
                      }
                    />
                  </div>
                  <div
                    className="w-[212px] h-9 px-3 border rounded flex items-center gap-1.5 cursor-pointer"
                    style={{
                      borderColor:
                        config.child_chunk?.strategy === CHUNK_MODE.IDENTIFIER
                          ? "#2563EB"
                          : undefined,
                    }}
                    onClick={() =>
                      handleChangeChunkMode("index", CHUNK_MODE.IDENTIFIER)
                    }
                  >
                    <div className="size-5 rounded bg-[#FFF1D6] flex items-center justify-center text-[#F0A105]">
                      #
                    </div>
                    <span className="flex-1 text-sm text-primary">
                      {t("data_pipeline.chunk_identifier_first")}
                    </span>
                    <Radio
                      checked={
                        config.child_chunk?.strategy === CHUNK_MODE.IDENTIFIER
                      }
                      disabled={
                        internalState.index_chunking_type === CHUNK_TYPE.DEFAULT
                      }
                    />
                  </div>
                </div>
              )}

              {[CHUNK_TYPE.CUSTOM, CHUNK_TYPE.DEFAULT].includes(
                internalState.index_chunking_type,
              ) && (
                <>
                  <div className="p-4 bg-[#F8F9FA] rounded-md space-y-3">
                    <div className="flex items-center">
                      <div className="flex-none w-20 text-sm text-secondary">
                        {t("data_pipeline.chunk_identifier")}
                      </div>
                      <Checkbox.Group
                        value={internalState.index_chunking_rule}
                        onChange={(values) =>
                          setInternalState((prev) => ({
                            ...prev,
                            index_chunking_rule: values as string[],
                          }))
                        }
                        disabled={
                          internalState.index_chunking_type ===
                          CHUNK_TYPE.DEFAULT
                        }
                      >
                        <Checkbox
                          value={SPLIT_TYPE.HEADING}
                          className="!mr-0"
                        />
                        <Dropdown
                          menu={{
                            items: CONFIG.headerList.map((item) => ({
                              key: item.type,
                              label: item.label,
                            })),
                            onClick: (e) => handleChangeHeading("index", e.key),
                          }}
                          trigger={["click"]}
                        >
                          <div className="flex items-center mr-5 ml-2 text-sm text-secondary cursor-pointer">
                            {getHeadingLabel("index")}
                            <DownOutlined className="ml-1" />
                          </div>
                        </Dropdown>
                        <Checkbox value={SPLIT_TYPE.CUSTOM} />
                        <div className="flex items-center gap-2 ml-2">
                          <span className="text-sm text-secondary whitespace-nowrap">
                            指定标识符
                          </span>
                          <Select
                            value={internalState.index_chunking_input}
                            onChange={(values) =>
                              setInternalState((prev) => ({
                                ...prev,
                                index_chunking_input: values as string[],
                              }))
                            }
                            className="w-48"
                            mode="multiple"
                            options={indexCommonList.map((item) => ({
                              label: item.label,
                              value: item.value,
                            }))}
                            disabled={
                              internalState.index_chunking_type ===
                              CHUNK_TYPE.DEFAULT
                            }
                          />
                        </div>
                      </Checkbox.Group>
                    </div>

                    <div className="flex items-center">
                      <div className="flex-none w-20 text-sm text-secondary">
                        {t("data_pipeline.chunk_length")}
                      </div>
                      <InputNumber
                        value={config.child_chunk?.max_length}
                        onChange={(value) => {
                          if (config.child_chunk) {
                            updateConfig({
                              child_chunk: {
                                ...config.child_chunk,
                                max_length: value || CONFIG.maxLength.min,
                              },
                            });
                          }
                        }}
                        min={0}
                        max={1000000}
                        controls={false}
                        className="!w-32"
                        disabled={
                          internalState.index_chunking_type ===
                          CHUNK_TYPE.DEFAULT
                        }
                        onBlur={() => handleBlurMaxLength("index")}
                      />
                    </div>
                  </div>

                  <div className="p-4 bg-[#F8F9FA] rounded-md space-y-3">
                    <div className="text-sm text-primary font-semibold">
                      {t("data_pipeline.chunk_index_enhance")}
                    </div>
                    <div className="flex items-center">
                      <div className="flex-none w-20 text-sm text-secondary">
                        {t("data_pipeline.chunk_default_index")}
                      </div>
                      <div className="flex gap-4">
                        <Checkbox
                          checked={
                            config.index_enhancement?.metadata_injection
                              ?.append_filename
                          }
                          onChange={(e) => {
                            if (config.index_enhancement?.metadata_injection) {
                              updateConfig({
                                index_enhancement: {
                                  ...config.index_enhancement,
                                  metadata_injection: {
                                    ...config.index_enhancement
                                      .metadata_injection,
                                    append_filename: e.target.checked,
                                  },
                                },
                              });
                            }
                          }}
                          disabled={
                            internalState.index_chunking_type ===
                            CHUNK_TYPE.DEFAULT
                          }
                        >
                          {t("data_pipeline.chunk_append_filename")}
                        </Checkbox>
                        <Checkbox
                          checked={
                            config.index_enhancement?.metadata_injection
                              ?.append_title
                          }
                          onChange={(e) => {
                            if (config.index_enhancement?.metadata_injection) {
                              updateConfig({
                                index_enhancement: {
                                  ...config.index_enhancement,
                                  metadata_injection: {
                                    ...config.index_enhancement
                                      .metadata_injection,
                                    append_title: e.target.checked,
                                    append_subtitle: e.target.checked,
                                  },
                                },
                              });
                            }
                          }}
                          disabled={
                            internalState.index_chunking_type ===
                            CHUNK_TYPE.DEFAULT
                          }
                        >
                          {t("data_pipeline.chunk_append_title_subtitle")}
                        </Checkbox>
                      </div>
                    </div>
                    <div className="flex items-center">
                      <div className="flex-none w-20 text-sm text-secondary">
                        {t("data_pipeline.chunk_auto_generate")}
                      </div>
                      <div className="flex gap-4">
                        <Checkbox
                          checked={
                            config.index_enhancement?.generative_enhancement
                              ?.generate_summary
                          }
                          onChange={(e) => {
                            if (
                              config.index_enhancement?.generative_enhancement
                            ) {
                              updateConfig({
                                index_enhancement: {
                                  ...config.index_enhancement,
                                  generative_enhancement: {
                                    ...config.index_enhancement
                                      .generative_enhancement,
                                    generate_summary: e.target.checked,
                                  },
                                },
                              });
                            }
                          }}
                          disabled={
                            internalState.index_chunking_type ===
                            CHUNK_TYPE.DEFAULT
                          }
                        >
                          {t("data_pipeline.chunk_summary")}
                        </Checkbox>
                        <Checkbox
                          checked={
                            config.index_enhancement?.generative_enhancement
                              ?.generate_faq
                          }
                          onChange={(e) => {
                            if (
                              config.index_enhancement?.generative_enhancement
                            ) {
                              updateConfig({
                                index_enhancement: {
                                  ...config.index_enhancement,
                                  generative_enhancement: {
                                    ...config.index_enhancement
                                      .generative_enhancement,
                                    generate_faq: e.target.checked,
                                  },
                                },
                              });
                            }
                          }}
                          disabled={
                            internalState.index_chunking_type ===
                            CHUNK_TYPE.DEFAULT
                          }
                        >
                          {t("data_pipeline.chunk_faq")}
                        </Checkbox>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ChunkConfig;
