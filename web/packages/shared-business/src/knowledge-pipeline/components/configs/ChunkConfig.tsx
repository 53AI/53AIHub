import { useEffect, useState, useMemo, useCallback } from "react";
import { Radio, Checkbox, Select, Slider, Switch, Tooltip } from "antd";
import { Dropdown } from "@km/shared-components-react";
import {
  CheckOutlined,
  DownOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import { usePipelineTranslation } from "../../context";
import { usePipelineAdapter } from "../../adapters";
import { SvgIcon } from "@km/shared-components-react";

// Constants
export const CHUNK_TYPE = {
  CUSTOM: "custom",
  WHOLE: "whole",
  DEFAULT: "default",
  PAGE: "page",
} as const;

export const SPLIT_TYPE = {
  HEADING: "heading",
  CUSTOM: "custom",
};

export const CHUNK_MODE = {
  LENGTH: "length",
  IDENTIFIER: "identifier",
};

export interface ChunkTypeOption {
  key: string;
  name: string;
  desc: string;
  icon: string;
  disabled?: boolean;
}

export interface ChunkConfigData {
  chunk_type?: string;
  enable_smart_match?: boolean;
  match_preference_prompt?: string;
  parent_chunk?: {
    /** Inner radio selection for the knowledge chunk. Persisted so it survives
     *  re-mount and is not overridden by the config → internalState sync. */
    chunking_type?: string;
    mode: string;
    strategy: string;
    identifier_level?: string;
    max_length: number;
    overlap_size?: number;
    append_filename?: boolean;
    append_title?: boolean;
    append_subtitle?: boolean;
  };
  child_chunk?: {
    /** Inner radio selection for the retrieval chunk. */
    chunking_type?: string;
    mode: string;
    strategy: string;
    identifier_level?: string;
    max_length: number;
    overlap_size?: number;
  };
  index_enhancement?: {
    metadata_injection?: {
      append_filename?: boolean;
      append_title?: boolean;
      append_subtitle?: boolean;
    };
    generative_enhancement?: {
      generate_summary?: boolean;
      generate_faq?: boolean;
    };
  };
  [key: string]: any;
}

export interface ChunkConfigProps {
  config: ChunkConfigData;
  onChange: (config: ChunkConfigData) => void;
  /** Chunk type options */
  chunkTypes?: ChunkTypeOption[];
  /** Public path helper for loading icons */
  getPublicPath?: (path: string) => string;
  /** i18n namespace prefix. Defaults to 'data_pipeline' */
  i18nPrefix?: string;
}

// "切片类型 = DEFAULT" 时重置的 chunk 配置。knowledge 与 index 复用这里的常量，
// 既用于 useEffect 的初始化，也用于 radio onChange 的重置。
const DEFAULT_KNOWLEDGE_CHUNK = {
  mode: "custom",
  strategy: CHUNK_MODE.IDENTIFIER,
  identifier_level: "h2",
  max_length: 2048,
  overlap_size: 80,
  append_filename: true,
  append_title: true,
  append_subtitle: true,
} as const;

const DEFAULT_INDEX_CHUNK = {
  mode: "custom",
  strategy: CHUNK_MODE.LENGTH,
  identifier_level: "h3",
  max_length: 512,
  overlap_size: 20,
} as const;

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

/**
 * 生成 antd Slider 的 marks 对象，包含 min / mid / max 三个刻度。
 */
const createSliderMarks = (min: number, max: number): Record<number, string> => {
  const mid = Math.round((min + max) / 2);
  return {
    [min]: String(min),
    [mid]: String(mid),
    [max]: String(max),
  };
};

/**
 * overlap 与 chunk_length 解耦后，下面的钳制函数已不再使用；
 * 保留此处仅为说明历史耦合行为，避免后续误把 overlap 重新绑到 max_length 上。
 */

interface LabeledSliderProps {
  label: React.ReactNode;
  tooltip?: React.ReactNode;
  /**
   * 透传给 antd Slider 的 `tooltip` 属性（v4.23+）。
   * 一般在 overlap > chunk_length 等异常情况下使用原生 popup
   * 展示告警，位置在 slider 上方。
   */
  sliderTooltip?: import("antd").SliderProps["tooltip"];
  value: number | undefined;
  min: number;
  max: number;
  marks?: Record<number, string>;
  disabled?: boolean;
  fallback?: number;
  onChange?: (value: number) => void;
  onChangeComplete?: () => void;
}

/**
 * 带"标签 + 问号 tooltip + slider + 当前数值"四件套的展示组件，
 * 用于 chunk_length 与 chunk_overlap 两类行。
 */
function LabeledSlider({
  label,
  tooltip,
  sliderTooltip,
  value,
  min,
  max,
  marks,
  disabled,
  fallback,
  onChange,
  onChangeComplete,
}: LabeledSliderProps) {
  const display = value ?? fallback ?? 0;
  return (
    <div className="flex items-center">
      <div className="flex-none w-[100px] text-sm text-secondary whitespace-nowrap flex items-center gap-1">
        <span>{label}</span>
        {tooltip && (
          <Tooltip title={tooltip} placement="topLeft">
            <QuestionCircleOutlined className="text-disabled cursor-help" />
          </Tooltip>
        )}
      </div>
      <Slider
        className="flex-1 mx-2"
        value={display}
        onChange={(v) => onChange?.(v)}
        onChangeComplete={onChangeComplete}
        min={min}
        max={max}
        marks={marks}
        disabled={disabled}
        tooltip={sliderTooltip}
      />
      <span className="flex-none w-16 text-right text-sm text-primary">
        {display}
      </span>
    </div>
  );
}

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

export function ChunkConfig({
  config,
  onChange,
  chunkTypes: providedChunkTypes,
  getPublicPath: getPublicPathProp,
  i18nPrefix = "data_pipeline",
}: ChunkConfigProps) {
  const { t } = usePipelineTranslation();
  const tKey = (key: string) => `${i18nPrefix}.${key}`;
  const adapter = usePipelineAdapter();

  // 优先使用 props 中的 getPublicPath，否则使用 adapter 中的
  const getPublicPath = getPublicPathProp ?? adapter?.getPublicPath;
  // CONFIG with i18n
  const CONFIG = useMemo(
    () => ({
      maxLength: { min: 50, max: 5000 },
      // 检索块独立范围：0-2048（与知识点解耦）
      childMaxLength: { min: 0, max: 2048 },
      // 知识点（parent_chunk）切片重叠范围：0-500
      parentOverlap: { min: 0, max: 500, default: 80 },
      // 检索块（child_chunk）切片重叠范围：0-200，default 与知识点解耦
      childOverlap: { min: 0, max: 200, default: 20 },
      headerList: [
        { type: "h1", label: t(tKey("chunk_header_h1")) },
        { type: "h2", label: t(tKey("chunk_header_h2")) },
        { type: "h3", label: t(tKey("chunk_header_h3")) },
        { type: "h4", label: t(tKey("chunk_header_h4")) },
        { type: "h5", label: t(tKey("chunk_header_h5")) },
      ],
      commonList: [
        { label: t(tKey("chunk_common_newline1")), value: "\\n" },
        { label: t(tKey("chunk_common_newline2")), value: "\\n\\n" },
        { label: t(tKey("chunk_common_period")), value: "。" },
        { label: t(tKey("chunk_common_exclamation")), value: "！" },
        { label: t(tKey("chunk_common_question")), value: "？" },
        { label: t(tKey("chunk_common_semicolon")), value: "；" },
        { label: t(tKey("chunk_common_divider")), value: "---" },
      ],
    }),
    [t, i18nPrefix],
  );

  // Generate default chunk types with translations
  const defaultChunkTypes = useMemo(() => {
    const basePath = (path: string) =>
      getPublicPath ? getPublicPath(path) : path;
    return [
      {
        key: "default",
        name: t(tKey("chunk_type_default")),
        desc: t(tKey("chunk_type_default_desc")),
        icon: basePath("/images/split/default.png"),
      },
      {
        key: "data_table",
        name: t(tKey("chunk_type_data_table")),
        desc: t(tKey("chunk_type_data_table_desc")),
        icon: basePath("/images/split/data_table.png"),
        disabled: true,
      },
      {
        key: "qa",
        name: t(tKey("chunk_type_qa")),
        desc: t(tKey("chunk_type_qa_desc")),
        icon: basePath("/images/split/qa.png"),
      },
    ];
  }, [t, i18nPrefix, getPublicPath]);

  const chunkTypes = providedChunkTypes || defaultChunkTypes;

  const updateConfig = (patch: Partial<ChunkConfigData>) => {
    onChange({ ...config, ...patch });
  };

  // 内部使用的辅助状态
  const [internalState, setInternalState] = useState<InternalState>({
    knowledge_chunking_type: CHUNK_TYPE.DEFAULT,
    knowledge_chunking_rule: [SPLIT_TYPE.HEADING],
    knowledge_chunking_head: "h1",
    knowledge_chunking_input: [],
    index_chunking_type: CHUNK_TYPE.DEFAULT,
    index_chunking_rule: [SPLIT_TYPE.HEADING],
    index_chunking_head: "h1",
    index_chunking_input: [],
  });

  // 初始化配置结构 - 同时解析和同步，避免时序问题
  useEffect(() => {
    const defaultParentChunk = DEFAULT_KNOWLEDGE_CHUNK;
    const defaultChildChunk = DEFAULT_INDEX_CHUNK;
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

    // 直接计算并同步到 internalState 和 config，避免时序问题
    const parseAndSync = (prefix: "knowledge" | "index") => {
      const targetConfig =
        prefix === "knowledge"
          ? config.parent_chunk || defaultParentChunk
          : config.child_chunk || defaultChildChunk;
      const rule = targetConfig?.identifier_level;
      const mode = targetConfig?.mode;
      // 优先使用显式的 chunking_type（DEFAULT/CUSTOM/WHOLE/PAGE），
      // 避免 DEFAULT 与 CUSTOM 在 identifier_level='h2'/'h3' 时被反向解析为 CUSTOM。
      const explicitType = targetConfig?.chunking_type;

      let newChunkingType: string;
      // 由 CUSTOM 分支按 identifier_level 内容决定是否包含 HEADING；
      // DEFAULT 分支显式置为 [HEADING]；WHOLE / PAGE 不依赖 newRules。
      // 不能预置为 [HEADING]，否则会强制把用户取消的 HEADING 又勾回来。
      let newRules: string[] = [];
      // newHead 留空表示"沿用 internalState.head"——只有当 rule 第一段确实是 header
      // 或 DEFAULT 分支显式给出默认值时才覆盖，避免用户取消所有 checkbox 后 head 被重置。
      let newHead: string | undefined;
      let newInput: string[] = [];

      // 显式 chunking_type 优先
      if (
        explicitType === CHUNK_TYPE.PAGE ||
        explicitType === CHUNK_TYPE.WHOLE ||
        explicitType === CHUNK_TYPE.DEFAULT ||
        explicitType === CHUNK_TYPE.CUSTOM
      ) {
        newChunkingType = explicitType;
        if (newChunkingType === CHUNK_TYPE.CUSTOM) {
          // 过滤空段，避免 rule=''（用户取消所有 checkbox）后 parts=[''] 让 CUSTOM 误判为已勾
          const parts = rule
            ? rule.split(",").filter((p) => p !== "")
            : [];
          const headers = CONFIG.headerList.map((h) => h.type);

          if (parts.length > 0 && headers.includes(parts[0])) {
            newHead = parts[0];
            newRules.push(SPLIT_TYPE.HEADING);
            newInput = parts.slice(1).map(formatDisplayValue);
          } else {
            newInput = parts.map(formatDisplayValue);
          }

          if (newInput.length > 0) {
            newRules.push(SPLIT_TYPE.CUSTOM);
          }
        } else if (newChunkingType === CHUNK_TYPE.DEFAULT) {
          // DEFAULT 始终保留 HEADING 规则与默认 head
          newHead = prefix === "knowledge" ? "h2" : "h3";
          newRules = [SPLIT_TYPE.HEADING];
          newInput = [];
        }
        // WHOLE / PAGE：identifier_level 已为 ""，维持默认值即可
      } else if (mode === "page") {
        // 按页（优先判断，因为 page 模式下 identifier_level 为空字符串）
        newChunkingType = CHUNK_TYPE.PAGE;
      } else if (mode === "whole") {
        // 仅在 mode 显式为 whole 时才推断为 WHOLE。
        // 修复：之前 `rule === "" || mode === "whole"` 会把"用户刚取消所有 checkbox"
        // 的临时态误切到 WHOLE，导致 max_length/identifier_level 被覆盖，
        // 并触发 document_parsing 跳转。
        newChunkingType = CHUNK_TYPE.WHOLE;
      } else if (!rule) {
        // rule 为 undefined/null/空字符串，且 mode 不是 whole/page。
        // 关键：mode === 'custom' 时表示用户在 CUSTOM 中临时清空了所有规则，
        // 必须保留 CUSTOM，不预置任何规则——用户可能正在重新选 HEADING。
        if (mode === "custom") {
          newChunkingType = CHUNK_TYPE.CUSTOM;
        } else {
          // legacy 默认：mode 也未设置时回退 DEFAULT
          newChunkingType = CHUNK_TYPE.DEFAULT;
          newHead = prefix === "knowledge" ? "h2" : "h3";
          newRules = [SPLIT_TYPE.HEADING];
          newInput = [];
        }
      } else {
        // 有值时设置为 CUSTOM
        newChunkingType = CHUNK_TYPE.CUSTOM;
        const parts = rule.split(",").filter((p) => p !== "");
        const headers = CONFIG.headerList.map((h) => h.type);

        if (parts.length > 0 && headers.includes(parts[0])) {
          newHead = parts[0];
          newRules.push(SPLIT_TYPE.HEADING);
          newInput = parts.slice(1).map(formatDisplayValue);
        } else {
          newInput = parts.map(formatDisplayValue);
        }

        if (newInput.length > 0) {
          newRules.push(SPLIT_TYPE.CUSTOM);
        }
      }

      // 计算应该同步到 config 的值
      let newIdentifierLevel = targetConfig.identifier_level;
      let newMaxLength = targetConfig.max_length;
      let newMode = targetConfig.mode;

      if (newChunkingType === CHUNK_TYPE.WHOLE) {
        newMode = "whole";
        newIdentifierLevel = "";
        // WHOLE 取该侧 slider 的 max（parent=5000，child=2048），避免存入超出范围的值
        newMaxLength =
          prefix === "knowledge"
            ? CONFIG.maxLength.max
            : CONFIG.childMaxLength.max;
      } else if (newChunkingType === CHUNK_TYPE.PAGE) {
        newMode = "page";
        newIdentifierLevel = "";
      } else if (newChunkingType === CHUNK_TYPE.DEFAULT) {
        newMode = "custom";
      } else {
        newMode = "custom";
        const parts = [];
        if (newRules.includes(SPLIT_TYPE.HEADING)) {
          parts.push(newHead);
        }
        if (newRules.includes(SPLIT_TYPE.CUSTOM)) {
          parts.push(...newInput.map(parseInputValue));
        }
        newIdentifierLevel = parts.join(",");
      }

      // 如果计算出的值和当前 config 不同，才调用 updateConfig
      if (
        newIdentifierLevel !== targetConfig.identifier_level ||
        newMaxLength !== targetConfig.max_length ||
        newMode !== targetConfig.mode
      ) {
        if (prefix === "knowledge" && config.parent_chunk) {
          updateConfig({
            parent_chunk: {
              ...config.parent_chunk,
              identifier_level: newIdentifierLevel,
              max_length: newMaxLength,
              mode: newMode,
            },
          });
        } else if (prefix === "index" && config.child_chunk) {
          updateConfig({
            child_chunk: {
              ...config.child_chunk,
              identifier_level: newIdentifierLevel,
              max_length: newMaxLength,
              mode: newMode,
            },
          });
        }
      }

      return { newChunkingType, newRules, newHead, newInput };
    };

    const knowledgeResult = parseAndSync("knowledge");
    const indexResult = parseAndSync("index");

    // 更新 internalState —— 关键：只在 chunking_type 实际变化时才覆盖 rules。
    // 否则 "用户在 CUSTOM 中先勾选 CUSTOM、再选中/移除 identifier" 这类交互会触发
    // syncIdentifierLevel → config.identifier_level='' → parseAndSync 推 newRules=[HEADING]
    // → 把用户刚勾上的 CUSTOM 复选框又自动取消。
    // chunking_type 不变时，rules / input 是用户驱动的 UI 状态，parseAndSync 不能覆盖；
    // chunking_type 是同步源（用户切换 DEFAULT/WHOLE/PAGE/CUSTOM，或外部加载已保存管线），
    // 此时才用 identifier_level 反推 rules。
    setInternalState((prev) => {
      const knowledgeTypeChanged =
        prev.knowledge_chunking_type !== knowledgeResult.newChunkingType;
      const indexTypeChanged =
        prev.index_chunking_type !== indexResult.newChunkingType;
      return {
        knowledge_chunking_type: knowledgeResult.newChunkingType,
        knowledge_chunking_rule: knowledgeTypeChanged
          ? knowledgeResult.newRules
          : prev.knowledge_chunking_rule,
        knowledge_chunking_head:
          knowledgeResult.newHead ?? prev.knowledge_chunking_head,
        knowledge_chunking_input: knowledgeTypeChanged
          ? knowledgeResult.newInput
          : prev.knowledge_chunking_input,
        index_chunking_type: indexResult.newChunkingType,
        index_chunking_rule: indexTypeChanged
          ? indexResult.newRules
          : prev.index_chunking_rule,
        index_chunking_head:
          indexResult.newHead ?? prev.index_chunking_head,
        index_chunking_input: indexTypeChanged
          ? indexResult.newInput
          : prev.index_chunking_input,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const knowledgeCommonList = useMemo(() => {
    const list = internalState.knowledge_chunking_input.filter(
      (item) => !CONFIG.commonList.some((common) => common.value === item),
    );
    return CONFIG.commonList.concat(
      list.map((item) => ({ label: item, value: item })),
    );
  }, [internalState.knowledge_chunking_input, CONFIG]);

  const indexCommonList = useMemo(() => {
    const list = internalState.index_chunking_input.filter(
      (item) => !CONFIG.commonList.some((common) => common.value === item),
    );
    return CONFIG.commonList.concat(
      list.map((item) => ({ label: item, value: item })),
    );
  }, [internalState.index_chunking_input, CONFIG]);

  // 检索块与知识点独立：marks / max 一律使用 CONFIG.childMaxLength，
  // 不再受 parent_chunk.max_length 钳制。
  const childLengthMarks = useMemo(
    () =>
      createSliderMarks(
        CONFIG.childMaxLength.min,
        CONFIG.childMaxLength.max,
      ),
    [CONFIG.childMaxLength.min, CONFIG.childMaxLength.max],
  );

  // overlap 与 chunk_length 解耦：marks / max 一律使用各自的 overlap 范围，
  // 不再受 max_length 钳制；当 overlap > max_length 时由 warningTooltip 提示。
  const parentOverlapMarks = useMemo(
    () =>
      createSliderMarks(
        CONFIG.parentOverlap.min,
        CONFIG.parentOverlap.max,
      ),
    [CONFIG.parentOverlap.min, CONFIG.parentOverlap.max],
  );
  const childOverlapMarks = useMemo(
    () =>
      createSliderMarks(
        CONFIG.childOverlap.min,
        CONFIG.childOverlap.max,
      ),
    [CONFIG.childOverlap.min, CONFIG.childOverlap.max],
  );

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
    syncIdentifierLevel(type, { head: value });
  };

  /**
   * 把 internalState 里的 rule + head + input 合并回
   * config.{parent_chunk, child_chunk}.identifier_level。
   * 仅在 CUSTOM 时写入；WHOLE / PAGE / DEFAULT 由 applyChunkTypeChange 直接维护 identifier_level。
   * overrides 用于在 setInternalState 尚未生效时传入新值，避免读到旧的内部状态。
   */
  const syncIdentifierLevel = (
    type: "knowledge" | "index",
    overrides?: { head?: string; rules?: string[]; inputs?: string[] },
  ) => {
    const chunkingType =
      type === "knowledge"
        ? internalState.knowledge_chunking_type
        : internalState.index_chunking_type;
    if (chunkingType !== CHUNK_TYPE.CUSTOM) return;

    const configKey = type === "knowledge" ? "parent_chunk" : "child_chunk";
    const current = config[configKey];
    if (!current) return;

    const head =
      overrides?.head ??
      (type === "knowledge"
        ? internalState.knowledge_chunking_head
        : internalState.index_chunking_head);
    const rules =
      overrides?.rules ??
      (type === "knowledge"
        ? internalState.knowledge_chunking_rule
        : internalState.index_chunking_rule);
    const inputs =
      overrides?.inputs ??
      (type === "knowledge"
        ? internalState.knowledge_chunking_input
        : internalState.index_chunking_input);

    const parts: string[] = [];
    if (rules.includes(SPLIT_TYPE.HEADING)) {
      parts.push(head);
    }
    if (rules.includes(SPLIT_TYPE.CUSTOM)) {
      parts.push(...inputs.map(parseInputValue));
    }
    const newIdentifierLevel = parts.join(",");

    if (newIdentifierLevel !== current.identifier_level) {
      updateConfig({
        [configKey]: {
          ...current,
          identifier_level: newIdentifierLevel,
        },
      });
    }
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

    // WHOLE 模式下将 max_length 设为该侧 slider 的最大值（parent=5000, child=2048）
    const chunkingType =
      type === "knowledge"
        ? internalState.knowledge_chunking_type
        : internalState.index_chunking_type;

    if (chunkingType === CHUNK_TYPE.WHOLE) {
      if (type === "knowledge") {
        updateConfig({
          parent_chunk: {
            ...config.parent_chunk!,
            mode: "whole",
            identifier_level: "",
            max_length: CONFIG.maxLength.max,
          },
        });
      } else {
        updateConfig({
          child_chunk: {
            ...config.child_chunk!,
            mode: "whole",
            identifier_level: "",
            max_length: CONFIG.childMaxLength.max,
          },
        });
      }
      return;
    }

    if (type === "knowledge") {
      const newParentMax = Math.max(
        Math.min(conf.max_length || CONFIG.maxLength.min, CONFIG.maxLength.max),
        CONFIG.maxLength.min,
      );

      // 切片长度与切片重叠解耦：不再因 max_length 收缩而钳制 overlap。
      updateConfig({
        parent_chunk: {
          ...config.parent_chunk!,
          max_length: newParentMax,
        },
      });
    } else {
      // 检索块独立：直接钳到自身范围 [childMaxLength.min, childMaxLength.max]，
      // 不再受 parent 约束。overlap 也与 chunk_length 解耦。
      const newChildMax = Math.max(
        Math.min(
          conf.max_length || CONFIG.childMaxLength.min,
          CONFIG.childMaxLength.max,
        ),
        CONFIG.childMaxLength.min,
      );

      updateConfig({
        child_chunk: {
          ...config.child_chunk!,
          max_length: newChildMax,
        },
      });
    }
  };

  /**
   * 处理"切片类型"Radio.Group 切换。
   * DEFAULT / WHOLE / PAGE / 其他(CUSTOM) 四种分支在 knowledge 与 index 两侧共享控制流，
   * 仅默认值不同；因此把分支收敛到这里，两侧 Radio.Group 只负责传入 defaults。
   * 同时把 chunking_type 显式持久化到 config，避免 useEffect 把它反向解析为 CUSTOM。
   */
  const applyChunkTypeChange = useCallback(
    (
      target: "knowledge" | "index",
      newType: string,
      defaults: {
        head: string;
        chunk: Record<string, unknown>;
      },
    ) => {
      const configKey = target === "knowledge" ? "parent_chunk" : "child_chunk";
      const stateKey = `${target}_chunking_type`;
      const current = config[configKey];

      if (newType === CHUNK_TYPE.DEFAULT) {
        setInternalState((prev) => ({
          ...prev,
          [stateKey]: CHUNK_TYPE.DEFAULT,
          [`${target}_chunking_rule`]: [SPLIT_TYPE.HEADING],
          [`${target}_chunking_head`]: defaults.head,
          [`${target}_chunking_input`]: [],
        }));
        if (current) {
          updateConfig({
            [configKey]: {
              ...current,
              ...defaults.chunk,
              chunking_type: CHUNK_TYPE.DEFAULT,
            },
          });
        }
        return;
      }

      if (newType === CHUNK_TYPE.WHOLE) {
        setInternalState((prev) => ({ ...prev, [stateKey]: CHUNK_TYPE.WHOLE }));
        if (current) {
          updateConfig({
            [configKey]: {
              ...current,
              mode: "whole",
              identifier_level: "",
              // WHOLE 取该侧 slider 的 max，避免存入超出范围的值
              max_length:
                configKey === "parent_chunk"
                  ? CONFIG.maxLength.max
                  : CONFIG.childMaxLength.max,
              chunking_type: CHUNK_TYPE.WHOLE,
            },
          });
        }
        return;
      }

      if (newType === CHUNK_TYPE.PAGE) {
        setInternalState((prev) => ({ ...prev, [stateKey]: CHUNK_TYPE.PAGE }));
        if (current) {
          updateConfig({
            [configKey]: {
              ...current,
              mode: "page",
              identifier_level: "",
              chunking_type: CHUNK_TYPE.PAGE,
            },
          });
        }
        return;
      }

      setInternalState((prev) => ({ ...prev, [stateKey]: CHUNK_TYPE.CUSTOM }));
      if (current) {
        // 修复：从 PAGE/WHOLE 切到 CUSTOM 时，既要写 chunking_type='custom'，
        // 也要恢复 mode='custom' 与默认的 identifier_level/max_length，
        // 否则 parseAndSync 会再次写入（mode 由 'page' → 'custom'），
        // 触发冗余的 onChange → Editor.handleConfigUpdate，
        // 在活跃节点上跳到 document_parsing（与 identifier 复选框无法取消同一根源）。
        updateConfig({
          [configKey]: {
            ...current,
            ...defaults.chunk,
            chunking_type: CHUNK_TYPE.CUSTOM,
          },
        });
      }
    },
    [config, updateConfig],
  );

  const handleKnowledgeTypeChange = useCallback(
    (newType: string) =>
      applyChunkTypeChange("knowledge", newType, {
        head: "h2",
        chunk: { ...DEFAULT_KNOWLEDGE_CHUNK },
      }),
    [applyChunkTypeChange],
  );

  const handleIndexTypeChange = useCallback(
    (newType: string) =>
      applyChunkTypeChange("index", newType, {
        head: "h3",
        chunk: { ...DEFAULT_INDEX_CHUNK },
      }),
    [applyChunkTypeChange],
  );

  // 切片长度 / 切片重叠 slider 的 disabled 条件：DEFAULT 与 WHOLE 时锁定。
  const lengthSliderDisabled = (target: "knowledge" | "index") => {
    const type =
      target === "knowledge"
        ? internalState.knowledge_chunking_type
        : internalState.index_chunking_type;
    return type === CHUNK_TYPE.DEFAULT || type === CHUNK_TYPE.WHOLE;
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* 智能匹配开关 */}
      <div className="flex items-center gap-2 mb-5">
        <span className="text-base text-primary">{t(tKey("smart_match"))}</span>
        <Switch
          checked={Boolean(config.enable_smart_match)}
          onChange={(checked) => {
            updateConfig({
              enable_smart_match: checked,
              chunk_type: "default",
              match_preference_prompt: "",
            });
          }}
        />
        <span className="text-sm text-disabled">
          {config.enable_smart_match
            ? t(tKey("smart_match_on_desc"))
            : t(tKey("smart_match_off_desc"))}
        </span>
      </div>

      {/* chunk_type 卡片 */}
      <div className="grid grid-cols-3 gap-4 transition-opacity">
        {chunkTypes.map((type) => {
          const isSelected =
            config.chunk_type === type.key && !config.enable_smart_match;
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
                {t(tKey("chunk_knowledge_point"))}
              </h4>
            </div>
            <div className="py-5 px-10 flex flex-col gap-4">
              <div className="flex items-center">
                <Radio.Group
                  value={internalState.knowledge_chunking_type}
                  onChange={(e) => handleKnowledgeTypeChange(e.target.value)}
                >
                  <Radio value={CHUNK_TYPE.DEFAULT}>
                    {t(tKey("chunk_default"))}
                  </Radio>
                  <Radio value={CHUNK_TYPE.CUSTOM}>
                    {t(tKey("chunk_custom"))}
                  </Radio>
                  <Radio value={CHUNK_TYPE.PAGE}>
                    {t(tKey("chunk_by_page"))}
                  </Radio>
                  <Radio value={CHUNK_TYPE.WHOLE}>
                    {t(tKey("chunk_none"))}
                  </Radio>
                </Radio.Group>
              </div>

              {[CHUNK_TYPE.CUSTOM, CHUNK_TYPE.DEFAULT].includes(
                internalState.knowledge_chunking_type as any,
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
                      {t(tKey("chunk_length_first"))}
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
                      {t(tKey("chunk_identifier_first"))}
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
                internalState.knowledge_chunking_type as any,
              ) && (
                <div className="p-4 bg-[#F8F9FA] rounded-md space-y-3">
                  <div className="flex items-center">
                    <div className="flex-none w-[100px] text-sm text-secondary">
                      {t(tKey("chunk_identifier"))}
                    </div>
                    <Checkbox.Group
                      value={internalState.knowledge_chunking_rule}
                      onChange={(values) => {
                        const nextRules = values as string[];
                        setInternalState((prev) => ({
                          ...prev,
                          knowledge_chunking_rule: nextRules,
                        }));
                        syncIdentifierLevel("knowledge", { rules: nextRules });
                      }}
                      disabled={
                        internalState.knowledge_chunking_type ===
                        CHUNK_TYPE.DEFAULT
                      }
                      className="flex-1 flex items-center"
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
                      <div className="flex-1 flex items-center gap-2 ml-2">
                        <span className="text-sm text-secondary whitespace-nowrap">
                          {t(tKey("chunk_specified_identifier"))}
                        </span>
                        <Select
                          value={internalState.knowledge_chunking_input}
                          onChange={(values) => {
                            const nextInputs = (values as string[]).map((v) =>
                              v.trim(),
                            );
                            setInternalState((prev) => ({
                              ...prev,
                              knowledge_chunking_input: nextInputs,
                            }));
                            syncIdentifierLevel("knowledge", {
                              inputs: nextInputs,
                            });
                          }}
                          className="flex-1"
                          mode="tags"
                          showSearch
                          tokenSeparators={[" ", ","]}
                          maxTagCount="responsive"
                          maxTagPlaceholder={(omittedValues) => (
                            <Tooltip
                              styles={{ root: { pointerEvents: "none" } }}
                              title={omittedValues
                                .map(({ label }) => label)
                                .join(", ")}
                            >
                              <span>+{omittedValues.length}</span>
                            </Tooltip>
                          )}
                          placeholder={t(tKey("chunk_specified_identifier_tip"))}
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

                  <LabeledSlider
                    label={t(tKey("chunk_length"))}
                    tooltip={t(tKey("chunk_length_tip"))}
                    value={config.parent_chunk?.max_length}
                    min={CONFIG.maxLength.min}
                    max={CONFIG.maxLength.max}
                    marks={createSliderMarks(
                      CONFIG.maxLength.min,
                      CONFIG.maxLength.max,
                    )}
                    disabled={lengthSliderDisabled("knowledge")}
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
                    onChangeComplete={() => handleBlurMaxLength("knowledge")}
                  />

                  <LabeledSlider
                    label={t(tKey("chunk_overlap"))}
                    tooltip={t(tKey("chunk_overlap_tip"))}
                    sliderTooltip={
                      (config.parent_chunk?.overlap_size ?? 0) >
                      (config.parent_chunk?.max_length ?? 0)
                        ? {
                            open: true,
                            placement: "top",
                            formatter: () =>
                              t(tKey("chunk_overlap_warning_tip")),
                          }
                        : undefined
                    }
                    value={config.parent_chunk?.overlap_size}
                    fallback={CONFIG.parentOverlap.default}
                    min={CONFIG.parentOverlap.min}
                    max={CONFIG.parentOverlap.max}
                    marks={parentOverlapMarks}
                    disabled={lengthSliderDisabled("knowledge")}
                    onChange={(value) => {
                      if (config.parent_chunk) {
                        updateConfig({
                          parent_chunk: {
                            ...config.parent_chunk,
                            overlap_size: value,
                          },
                        });
                      }
                    }}
                  />

                  <div className="flex items-center">
                    <div className="flex-none w-[100px] text-sm text-secondary">
                      {t(tKey("chunk_recall_metadata"))}
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
                        {t(tKey("chunk_append_filename"))}
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
                        {t(tKey("chunk_append_title_subtitle"))}
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
                {t(tKey("chunk_retrieval_block"))}
              </h4>
            </div>
            <div className="py-5 px-10 flex flex-col gap-4">
              <div className="flex items-center">
                <Radio.Group
                  value={internalState.index_chunking_type}
                  onChange={(e) => handleIndexTypeChange(e.target.value)}
                >
                  <Radio value={CHUNK_TYPE.DEFAULT}>
                    {t(tKey("chunk_default"))}
                  </Radio>
                  <Radio value={CHUNK_TYPE.CUSTOM}>
                    {t(tKey("chunk_custom"))}
                  </Radio>
                  <Radio value={CHUNK_TYPE.PAGE}>
                    {t(tKey("chunk_by_page"))}
                  </Radio>
                  <Radio value={CHUNK_TYPE.WHOLE}>
                    {t(tKey("chunk_none"))}
                  </Radio>
                </Radio.Group>
              </div>

              {[CHUNK_TYPE.CUSTOM, CHUNK_TYPE.DEFAULT].includes(
                internalState.index_chunking_type as any,
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
                      {t(tKey("chunk_length_first"))}
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
                      {t(tKey("chunk_identifier_first"))}
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
                internalState.index_chunking_type as any,
              ) && (
                <>
                  <div className="p-4 bg-[#F8F9FA] rounded-md space-y-3">
                    <div className="flex items-center">
                      <div className="flex-none w-[100px] text-sm text-secondary">
                        {t(tKey("chunk_identifier"))}
                      </div>
                      <Checkbox.Group
                        value={internalState.index_chunking_rule}
                        onChange={(values) => {
                          const nextRules = values as string[];
                          setInternalState((prev) => ({
                            ...prev,
                            index_chunking_rule: nextRules,
                          }));
                          syncIdentifierLevel("index", { rules: nextRules });
                        }}
                        disabled={
                          internalState.index_chunking_type ===
                          CHUNK_TYPE.DEFAULT
                        }
                        className="flex-1 flex items-center"
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
                        <div className="flex-1 flex items-center gap-2 ml-2">
                          <span className="text-sm text-secondary whitespace-nowrap">
                            {t(tKey("chunk_specified_identifier"))}
                          </span>
                          <Select
                            value={internalState.index_chunking_input}
                            onChange={(values) => {
                              const nextInputs = (values as string[]).map((v) =>
                                v.trim(),
                              );
                              setInternalState((prev) => ({
                                ...prev,
                                index_chunking_input: nextInputs,
                              }));
                              syncIdentifierLevel("index", {
                                inputs: nextInputs,
                              });
                            }}
                            className="flex-1"
                            mode="tags"
                            showSearch
                            tokenSeparators={[" ", ","]}
                            maxTagCount="responsive"
                            maxTagPlaceholder={(omittedValues) => (
                              <Tooltip
                                styles={{ root: { pointerEvents: "none" } }}
                                title={omittedValues
                                  .map(({ label }) => label)
                                  .join(", ")}
                              >
                                <span>+{omittedValues.length}</span>
                              </Tooltip>
                            )}
                            placeholder={t(tKey("chunk_specified_identifier_tip"))}
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

                    <LabeledSlider
                      label={t(tKey("chunk_length"))}
                      tooltip={t(tKey("retrieval_chunk_length_tip"))}
                      value={config.child_chunk?.max_length}
                      min={CONFIG.childMaxLength.min}
                      max={CONFIG.childMaxLength.max}
                      marks={childLengthMarks}
                      disabled={lengthSliderDisabled("index")}
                      onChange={(value) => {
                        if (config.child_chunk) {
                          updateConfig({
                            child_chunk: {
                              ...config.child_chunk,
                              max_length: value || CONFIG.childMaxLength.min,
                            },
                          });
                        }
                      }}
                      onChangeComplete={() => handleBlurMaxLength("index")}
                    />

                    <LabeledSlider
                      label={t(tKey("chunk_overlap"))}
                      tooltip={t(tKey("chunk_overlap_tip"))}
                      sliderTooltip={
                        (config.child_chunk?.overlap_size ?? 0) >
                        (config.child_chunk?.max_length ?? 0)
                          ? {
                              open: true,
                              placement: "top",
                              formatter: () =>
                                t(tKey("chunk_overlap_warning_tip")),
                            }
                          : undefined
                      }
                      value={config.child_chunk?.overlap_size}
                      fallback={CONFIG.childOverlap.default}
                      min={CONFIG.childOverlap.min}
                      max={CONFIG.childOverlap.max}
                      marks={childOverlapMarks}
                      disabled={lengthSliderDisabled("index")}
                      onChange={(value) => {
                        if (config.child_chunk) {
                          updateConfig({
                            child_chunk: {
                              ...config.child_chunk,
                              overlap_size: value,
                            },
                          });
                        }
                      }}
                    />
                  </div>

                  <div className="p-4 bg-[#F8F9FA] rounded-md space-y-3">
                    <div className="text-sm text-primary font-semibold">
                      {t(tKey("chunk_index_enhance"))}
                    </div>
                    <div className="flex items-center">
                      <div className="flex-none w-[100px] text-sm text-secondary">
                        {t(tKey("chunk_default_index"))}
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
                          {t(tKey("chunk_append_filename"))}
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
                          {t(tKey("chunk_append_title_subtitle"))}
                        </Checkbox>
                      </div>
                    </div>
                    <div className="flex items-center">
                      <div className="flex-none w-[100px] text-sm text-secondary">
                        {t(tKey("chunk_auto_generate"))}
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
                          {t(tKey("chunk_summary"))}
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
                          {t(tKey("chunk_faq"))}
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
