import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { Button, Modal, Radio, message } from "antd";
import { Dropdown } from "@km/shared-components-react";
import { CaretDownOutlined } from "@ant-design/icons";
import { useLibraryStore } from "@/stores/modules/library";
import { SvgIcon } from "@km/shared-components-react";
import ragJobApi from "@/api/modules/rag-job";
import ragPipelineApi from "@/api/modules/rag-pipeline";
import strategiesApi from "@/api/modules/strategies";
import type { RagJobWithSteps } from "@/api/modules/rag-job/types";
import type { Strategy } from "@/api/modules/strategies/types";
import type { PipelineStep as ApiPipelineStep } from "@/api/modules/rag-pipeline/types";
import { PERMISSION_TYPE } from "@/components/KMPermission/constant";
import { RUN_STATUS } from "@/constants/chunk";
import { getParserConfig } from "@/constants/parser";
import { t } from "@/locales";
import {
  ParseConfig,
  ChunkConfig,
  CleanConfig,
  SummaryConfig,
  VectorConfig,
  GraphConfig,
  PipelineProvider,
  PipelineAdapterProvider,
} from "@km/shared-business/knowledge-pipeline";
import { createPipelineAdapter } from "../data-pipeline/adapters";
import "./pipeline.css";

type PipelineStatus =
  | "idle"
  | "running"
  | "completed"
  | "error"
  | "waiting"
  | "paused";

type StepDetails = {
  config?: Array<{ label: string; value: string; alias?: string }>;
};

type RunMode = "auto" | "manual" | "skip";

type PipelineStep = {
  type: string;
  icon: string;
  name: string;
  description: string;
  status: string;
  runMode?: RunMode;
  duration?: number;
  failureReason?: string;
  details?: StepDetails;
  jobId?: number;
  stepOrder?: number;
};

interface CleaningInfo {
  status?: string;
  strategy_id?: number;
  runtime_profile_json?: string;
  [key: string]: unknown;
}

interface PipelineProps {
  fileId: string;
  title?: string;
  cleaningInfo?: CleaningInfo;
  permission: number;
  refreshKey?: number;
  onClose: () => void;
}

// Step type configuration
const STEP_TYPE_MAP: Record<
  string,
  { name: string; description: string; icon: string }
> = {
  document_parsing: {
    name: "文档解析",
    description: "转文档为可处理的结构化文本",
    icon: "view-list",
  },
  content_cleaning: {
    name: "内容清洗",
    description: "规整文本、去冗余、修格式",
    icon: "paragraph-cut",
  },
  document_chunking: {
    name: "语料拆分",
    description: "拆分文档内容为语料片段",
    icon: "split-cells",
  },
  summary_generation: {
    name: "生成摘要",
    description: "生成文档摘要、常见问法与知识地图",
    icon: "notes",
  },
  vector_indexing: {
    name: "向量索引",
    description: "拆分文本并建索引，便于检索",
    icon: "clue",
  },
  graph_generation: {
    name: "图谱生成",
    description: "提取信息，用图谱呈现内容关联",
    icon: "six-points",
  },
};

// Helper function
const deepClone = <T,>(obj: T): T => JSON.parse(JSON.stringify(obj));

// Config component map - import from shared-business
const CONFIG_COMPONENT_MAP: Record<string, React.ComponentType<any>> = {
  document_parsing: ParseConfig,
  content_cleaning: CleanConfig,
  summary_generation: SummaryConfig,
  document_chunking: ChunkConfig,
  vector_indexing: VectorConfig,
  graph_generation: GraphConfig,
};

const getConfigComponent = (type: string) => CONFIG_COMPONENT_MAP[type] || null;

export function ChunksPipeline({
  fileId,
  title = "语料流水线",
  cleaningInfo,
  permission,
  refreshKey = 0,
  onClose,
}: PipelineProps) {
  const libraryStore = useLibraryStore();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [locale] = useState(() => {
    // 从 localStorage 获取当前语言
    const stored = localStorage.getItem('default_lang');
    if (stored === 'jp') return 'ja';
    return stored || 'zh-cn';
  });

  // 创建适配器实例（只创建一次）
  const adapter = useMemo(() => createPipelineAdapter(), []);

  // State
  const [jobData, setJobData] = useState<RagJobWithSteps[]>([]);
  const [loading, setLoading] = useState(false);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loadingStrategies, setLoadingStrategies] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(
    null,
  );
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [savedConfigs, setSavedConfigs] = useState<
    Record<string, Record<string, any>>
  >({});

  // Dialog state
  const [executeDialogVisible, setExecuteDialogVisible] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null);
  const [executeContinue, setExecuteContinue] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [settingDialogVisible, setSettingDialogVisible] = useState(false);
  const [currentSettingStepIndex, setCurrentSettingStepIndex] = useState<
    number | null
  >(null);
  const [currentSettingConfig, setCurrentSettingConfig] = useState<
    Record<string, any>
  >({});
  const [strategyJobDataMap, setStrategyJobDataMap] = useState<
    Record<number, RagJobWithSteps[]>
  >({});

  const hasPermission = useMemo(
    () => permission >= PERMISSION_TYPE.edit_all,
    [permission],
  );

  // Extract step details
  const extractStepDetails = useCallback(
    (job: RagJobWithSteps): StepDetails | undefined => {
      const config: Array<{ label: string; value: string; alias?: string }> =
        [];

      const profileStep = getProfileStep(job);
      const stepConfig = profileStep?.config || {};

      // Extract results from job steps
      let stepResults: Record<string, any> = {};
      if (job.steps && job.steps.length > 0) {
        try {
          const step = job.steps[0];
          if (step.results) {
            stepResults = JSON.parse(step.results);
          }
        } catch (e) {
          // Ignore parse errors
        }
      }

      // Extract config based on step type
      switch (job.type) {
        case "document_parsing":
          if (stepConfig.engine) {
            const parserConfig = getParserConfig(stepConfig.engine);
            config.push({
              label: "解析方法",
              value: parserConfig?.name || stepConfig.engine,
              alias: parserConfig?.name || "",
            });
          }
          break;
        case "content_cleaning":
          if (stepConfig.remove_invalid_tags !== undefined) {
            config.push({
              label: "移除无效标签",
              value: stepConfig.remove_invalid_tags ? "开启" : "关闭",
            });
          }
          if (stepConfig.typo_correction !== undefined) {
            config.push({
              label: "错别字纠正",
              value: stepConfig.typo_correction ? "开启" : "关闭",
            });
          }
          if (stepConfig.special_char_filter?.enabled !== undefined) {
            config.push({
              label: "特殊字符过滤",
              value: stepConfig.special_char_filter.enabled ? "开启" : "关闭",
            });
          }
          if (stepConfig.pronoun_replacement !== undefined) {
            config.push({
              label: "代词替换",
              value: stepConfig.pronoun_replacement ? "开启" : "关闭",
            });
          }
          if (stepConfig.grammar_correction !== undefined) {
            config.push({
              label: "语法纠正",
              value: stepConfig.grammar_correction ? "开启" : "关闭",
            });
          }
          break;
        case "summary_generation":
          config.push({
            label: "文档摘要",
            value: stepConfig.summary_faq?.enabled ? "开启" : "关闭",
          });
          config.push({
            label: "文档标签",
            value: stepConfig.entity_extraction?.enabled ? "开启" : "关闭",
          });
          config.push({
            label: "知识地图",
            value: stepConfig.knowledge_map?.enabled ? "开启" : "关闭",
          });
          break;
        case "document_chunking":
          if (stepResults.chunk_type) {
            config.push({
              label: "拆分规则",
              value:
                stepResults.chunk_type === "default"
                  ? "通用文档"
                  : stepResults.chunk_type === "data_table"
                    ? "数据表格"
                    : "百问百答",
            });
          }
          break;
        case "vector_indexing":
          if (stepConfig.embedding_model) {
            config.push({
              label: "向量嵌入",
              value: stepConfig.embedding_model,
            });
          }
          if (stepConfig.model) {
            config.push({ label: "向量嵌入", value: stepConfig.model });
          }
          break;
        case "knowledge_graph":
        case "graph_generation":
          if (stepResults.entity_count !== undefined) {
            config.push({
              label: "实体数",
              value: String(stepResults.entity_count),
            });
          }
          if (stepResults.relation_count !== undefined) {
            config.push({
              label: "关系数",
              value: String(stepResults.relation_count),
            });
          }
          if (stepConfig.entity_extraction?.enabled !== undefined) {
            config.push({
              label: "实体提取",
              value: stepConfig.entity_extraction.enabled ? "开启" : "关闭",
            });
          }
          break;
      }

      return config.length > 0 ? { config } : undefined;
    },
    [],
  );

  // Get profile step from job
  const getProfileStep = (job: RagJobWithSteps) => {
    if (!job.runtime_profile_json) return null;
    try {
      const runtimeProfile = JSON.parse(job.runtime_profile_json);
      return (
        runtimeProfile.steps?.find((s: any) => s.step_key === job.type) || null
      );
    } catch (e) {
      console.warn("解析 runtime_profile_json 失败:", e);
      return null;
    }
  };

  // Extract run mode from job
  const extractRunModeFromJob = (job: RagJobWithSteps): RunMode | undefined => {
    const profileStep = getProfileStep(job);
    return profileStep?.run_mode as RunMode | undefined;
  };

  // Extract config from job
  const extractConfigFromJob = (job: RagJobWithSteps): Record<string, any> => {
    const profileStep = getProfileStep(job);
    return profileStep?.config || {};
  };

  // Get job config
  const getJobConfig = useCallback(
    (type: string): Record<string, any> => {
      if (savedConfigs[type]) return savedConfigs[type];
      const job = jobData.find((j) => j.type === type);
      return job ? extractConfigFromJob(job) : {};
    },
    [jobData, savedConfigs],
  );

  // Compute steps
  const steps = useMemo<PipelineStep[]>(() => {
    if (!jobData?.length) return [];

    return jobData.filter((job) => job.type !== "content_cleaning").map((job) => {
      const stepInfo = STEP_TYPE_MAP[job.type] || {
        name: job.type,
        description: "",
        icon: "",
      };
      const runMode = extractRunModeFromJob(job);

      let duration: number | undefined;
      if (job.steps && job.steps.length > 0) {
        const step = job.steps[0];
        if (step.end_time && step.start_time) {
          duration = Math.round((step.end_time - step.start_time) / 1000);
        }
      } else if (job.completion_time) {
        duration = Math.round(job.completion_time);
      }

      return {
        icon: stepInfo.icon,
        name: stepInfo.name,
        description: stepInfo.description,
        type: job.type,
        status: job.status,
        runMode,
        duration,
        failureReason: job.failure_reason,
        details: extractStepDetails(job),
        jobId: job.job_id,
      };
    });
  }, [jobData, extractStepDetails]);

  // Compute progress
  const progress = useMemo(() => {
    if (!steps.length) return 0;
    const completedCount = steps.filter((s) => s.status === "success").length;
    return Math.round((completedCount / steps.length) * 100);
  }, [steps]);

  // Compute status
  const status = useMemo<PipelineStatus>(() => {
    if (!steps.length) return "idle";
    const hasJobId = steps.some((s) => s.jobId && s.jobId !== 0);
    if (!hasJobId) return "idle";
    const hasRunning = steps.some((s) =>
      [RUN_STATUS.PROCESSING, RUN_STATUS.PENDING].includes(s.status),
    );
    const hasWaiting = steps.some((s) => s.status === RUN_STATUS.PAUSED);
    const hasError = steps.some((s) => s.status === RUN_STATUS.FAILED);
    const allCompleted = steps.every(
      (s) => s.status === RUN_STATUS.SUCCESS || s.status === RUN_STATUS.FAILED,
    );
    if (hasRunning) return "running";
    if (hasWaiting) return "paused";
    if (hasError) return "error";
    return allCompleted ? "completed" : "idle";
  }, [steps]);

  // Compute next step info
  const nextStepInfo = useMemo(() => {
    if (status !== "paused") return null;
    const index = steps.findIndex((s) => s.status === RUN_STATUS.PAUSED);
    if (index !== -1) {
      return { type: steps[index].type, name: steps[index].name };
    }
    return null;
  }, [status, steps]);

  // Compute button text
  const buttonText = useMemo(() => {
    if (status === "paused") return "等待处理";
    if (status === "idle") return "开始运行";
    return status === "completed" || status === "error"
      ? "重新运行"
      : "运行中...";
  }, [status]);

  // Current step for dialogs
  const currentStep = useMemo(
    () => (currentStepIndex !== null ? steps[currentStepIndex] || null : null),
    [currentStepIndex, steps],
  );

  const currentSettingStep = useMemo(() => {
    if (currentSettingStepIndex === null) return null;
    const step = steps[currentSettingStepIndex];
    if (!step?.type) return null;
    return step;
  }, [currentSettingStepIndex, steps]);

  // Fetch job data
  const fetchJobData = useCallback(
    async (filterPipelineId?: number) => {
      if (!fileId) return;
      try {
        setLoading(true);
        const response = await ragJobApi.getByRelatedId(fileId);
        let jobs = response.jobs || [];
        // Filter by pipeline_id if provided
        if (filterPipelineId) {
          jobs = jobs.filter(
            (j: RagJobWithSteps) => j.pipeline_id === filterPipelineId,
          );
        }

        // Merge data: preserve pending steps that don't exist in API response
        setJobData((prevJobData) => {
          if (!prevJobData.length) return jobs;

          // Check if pipeline_id matches to avoid mixing data from different strategies
          const prevPipelineId = prevJobData[0]?.pipeline_id;
          const newPipelineId =
            jobs.length > 0 ? jobs[0]?.pipeline_id : prevPipelineId;

          if (prevPipelineId !== newPipelineId) {
            return jobs;
          }

          const mergedData = [...jobs];

          prevJobData.forEach((prevJob) => {
            const exists = mergedData.some((job) => job.type === prevJob.type);
            if (!exists) {
              mergedData.push(prevJob);
            }
          });

          mergedData.sort(
            (a, b) => (a.current_step_order || 0) - (b.current_step_order || 0),
          );

          return mergedData;
        });

        timerRef.current = setTimeout(() => {
          libraryStore.loadFile(fileId, true);
        }, 1500);
      } catch (error) {
        console.error("获取任务数据失败:", error);
        setJobData([]);
      } finally {
        setLoading(false);
      }
    },
    [fileId, libraryStore],
  );

  // Fetch strategies
  const fetchStrategies = useCallback(async () => {
    try {
      setLoadingStrategies(true);
      const data = await strategiesApi.list();
      const enabledStrategies = data.filter((s) => s.enabled);
      setStrategies(enabledStrategies);

      if (cleaningInfo?.strategy_id) {
        const strategy = enabledStrategies.find(
          (s) => s.id === cleaningInfo.strategy_id,
        );
        if (strategy) {
          setSelectedStrategy(strategy);
        }
      }

      if (enabledStrategies.length > 0 && !cleaningInfo?.strategy_id) {
        handleSelectStrategy(enabledStrategies[0].id, enabledStrategies);
      }
    } catch (error) {
      console.error("获取策略列表失败:", error);
    } finally {
      setLoadingStrategies(false);
    }
  }, [cleaningInfo?.strategy_id]);

  // Handle select strategy - accept optional strategyList to bypass stale state
  const handleSelectStrategy = async (
    strategyId: number,
    strategyList?: Strategy[],
  ) => {
    const listToSearch = strategyList || strategies;
    const strategy = listToSearch.find((s) => s.id === strategyId);
    if (!strategy || selectedStrategy?.id === strategyId) return;

    setSelectedStrategy(strategy);
    // 切换策略时清除已保存的自定义配置，避免旧策略的配置影响新策略的展示
    setSavedConfigs({});

    if (strategyId === cleaningInfo?.strategy_id) {
      fetchJobData(strategy.pipeline_id);
      return;
    }

    // Check cache first
    if (strategyJobDataMap[strategyId]) {
      setJobData(strategyJobDataMap[strategyId]);
      return;
    }

    try {
      setLoading(true);
      const pipeline = await ragPipelineApi.get(strategy.pipeline_id);

      let profileJson: { steps: ApiPipelineStep[] };
      if (typeof pipeline.profile_json === "string") {
        try {
          profileJson = JSON.parse(pipeline.profile_json);
        } catch (e) {
          console.error("解析 profile_json 失败:", e);
          message.error("流水线配置解析失败");
          return;
        }
      } else {
        profileJson = pipeline.profile_json;
      }

      if (!profileJson?.steps || !Array.isArray(profileJson.steps)) {
        console.error("流水线数据结构无效:", pipeline);
        message.error("流水线数据格式错误");
        return;
      }

      const newJobData: RagJobWithSteps[] = profileJson.steps
        .filter((step: ApiPipelineStep) => step && step.run_mode !== "skip")
        .map(
          (step: ApiPipelineStep, index: number) =>
            ({
              job_id: 0,
              eid: "",
              type: step.step_key,
              status: "pending",
              created_time: Date.now(),
              updated_time: Date.now(),
              current_step_order: index + 1,
              failure_reason: "",
              metadata: "",
              start_parameters: JSON.stringify({ config: step.config || {} }),
              run_id: "",
              related_id: fileId,
              pipeline_id: strategy.pipeline_id,
              progress: 0,
              completion_time: 0,
              steps: [],
              runtime_profile_json: JSON.stringify({
                steps: [
                  {
                    step_key: step.step_key,
                    config: step.config || {},
                    run_mode: step.run_mode || "auto",
                  },
                ],
              }),
            }) as RagJobWithSteps,
        );

      setJobData(newJobData);
      setStrategyJobDataMap((prev) => ({ ...prev, [strategyId]: newJobData }));
    } catch (error) {
      console.error("获取流水线详情失败:", error);
      message.error("获取流水线详情失败");
    } finally {
      setLoading(false);
    }
  };

  // Toggle step expansion
  const handleToggleStep = (index: number) => {
    setExpandedSteps((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  // Check if step is expanded
  const isStepExpanded = (index: number) => expandedSteps.has(index);

  // Handle rerun
  const handleRerun = async () => {
    if (!jobData?.length) {
      message.warning("没有可执行的任务");
      return;
    }
    try {
      setLoading(true);
      const batchJobs = jobData.map((job) => ({
        job_id: job.job_id,
        step_key: job.type,
        run_mode: extractRunModeFromJob(job),
        config: getJobConfig(job.type),
      }));
      await ragJobApi.batchRetry({
        run: {
          related_id: fileId,
          strategy_id: selectedStrategy?.id?.toString() || "",
          pipeline_id: selectedStrategy?.pipeline_id?.toString() || "",
          start_parameters: {},
        },
        jobs: batchJobs,
      });
      message.success(t("status.submitted"));
      await fetchJobData();
    } catch (error) {
      console.error("批量重试失败:", error);
    } finally {
      setLoading(false);
    }
  };

  // Step execute handler
  const handleStepExecute = (index: number) => {
    const step = steps[index];
    if (!step?.jobId) {
      message.warning("请点击下方开始运行");
      return;
    }
    setCurrentStepIndex(index);
    setExecuteContinue(false);

    if (index === steps.length - 1) {
      handleConfirmExecute(index);
    } else {
      setExecuteDialogVisible(true);
    }
  };

  // Step setting handler
  const handleStepSetting = (index: number) => {
    const step = steps[index];
    if (!step?.type) {
      message.warning(t("chunk.no_task_info"));
      return;
    }
    setCurrentSettingStepIndex(index);
    setSettingDialogVisible(true);
  };

  // Dialog handlers
  const handleSettingDialogClose = () => {
    setSettingDialogVisible(false);
    setCurrentSettingStepIndex(null);
  };

  // Handle config change from config components
  const handleConfigChange = useCallback((newConfig: Record<string, any>) => {
    setCurrentSettingConfig(deepClone(newConfig));
  }, []);

  const handleConfirmSetting = () => {
    if (!currentSettingStep?.type) return;
    const stepType = currentSettingStep.type;
    const newConfig = deepClone(currentSettingConfig);
    setSavedConfigs((prev) => ({ ...prev, [stepType]: newConfig }));

    // Update jobData to reflect new config
    const jobIndex = jobData.findIndex((j) => j.type === stepType);
    if (jobIndex !== -1) {
      const job = jobData[jobIndex];
      try {
        const runtimeProfile = job.runtime_profile_json
          ? JSON.parse(job.runtime_profile_json)
          : { steps: [] };
        const stepIndex = runtimeProfile.steps?.findIndex(
          (s: any) => s.step_key === stepType,
        );
        if (stepIndex !== -1 && runtimeProfile.steps[stepIndex]) {
          runtimeProfile.steps[stepIndex].config = newConfig;
        }
        setJobData((prev) => {
          const newData = [...prev];
          newData[jobIndex] = {
            ...job,
            runtime_profile_json: JSON.stringify(runtimeProfile),
          };
          return newData;
        });
      } catch (e) {
        console.warn("更新 runtime_profile_json 失败:", e);
      }
    }

    message.success(t("status.save_success"));
    setSettingDialogVisible(false);
  };

  const handleExecuteDialogClose = () => {
    setExecuteDialogVisible(false);
    setCurrentStepIndex(null);
    setExecuteContinue(false);
  };

  const handleConfirmExecute = async (stepIndex?: number) => {
    const targetIndex = stepIndex ?? currentStepIndex;
    if (targetIndex === null) return;
    const step = steps[targetIndex];
    if (!step?.jobId) {
      message.warning(t("chunk.no_task_info"));
      return;
    }
    try {
      setExecuting(true);
      await ragJobApi.retry(step.jobId, {
        continue: executeContinue,
        config: getJobConfig(step.type),
      });
      message.success(t("status.submitted"));
      setExecuteDialogVisible(false);
      await fetchJobData();
      libraryStore.loadFilesAll();
    } catch (error) {
      console.error("执行任务失败:", error);
    } finally {
      setExecuting(false);
    }
  };

  // Initialize current setting config when step index changes (not on every render)
  useEffect(() => {
    if (currentSettingStepIndex === null) {
      setCurrentSettingConfig({});
      return;
    }
    const step = steps[currentSettingStepIndex];
    if (!step?.type) {
      setCurrentSettingConfig({});
      return;
    }
    const config = getJobConfig(step.type);
    setCurrentSettingConfig(deepClone(config));
    // 只在初始化时设置 savedConfigs，不要每次都覆盖
  }, [currentSettingStepIndex, steps, getJobConfig]);

  // Auto expand failed steps - use ref to prevent infinite loop
  const prevFailedStepsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const newExpanded = new Set<number>();
    const failedSet = new Set<number>();
    steps.forEach((step, index) => {
      if (step.status === "failed") {
        newExpanded.add(index);
        failedSet.add(index);
      }
    });
    // Only update if failed steps changed
    if (
      failedSet.size !== prevFailedStepsRef.current.size ||
      [...failedSet].some((i) => !prevFailedStepsRef.current.has(i))
    ) {
      prevFailedStepsRef.current = failedSet;
      setExpandedSteps(newExpanded);
    }
  }, [steps]);

  // Initialize
  useEffect(() => {
    fetchJobData().finally(() => {
      fetchStrategies();
    });

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [fileId]);

  // Watch for refreshKey changes
  useEffect(() => {
    if (refreshKey > 0) {
      fetchJobData();
    }
  }, [refreshKey]);

  // Polling when status is running
  useEffect(() => {
    if (status !== "running") return;

    const pollInterval = setInterval(() => {
      fetchJobData();
    }, 1500);

    return () => {
      clearInterval(pollInterval);
    };
  }, [status, fetchJobData]);

  // Render step status icon
  const renderStatusIcon = (stepStatus: string, failureReason?: string) => {
    switch (stepStatus) {
      case "pending":
        return (
          <div className="w-4 h-4 rounded-full border border-[#D1D5DB] bg-white" />
        );
      case "paused":
        return (
          <div
            className="w-4 h-4 rounded-full border border-[#FF8D1A] bg-white"
            title="等待处理"
          />
        );
      case "processing":
        return (
          <div className="w-4 h-4 rounded-full border border-[#3B82F6] border-t-transparent bg-white text-[#2563EB] flex items-center justify-center">
            <SvgIcon name="refresh" size={12} className="animate-spin" />
          </div>
        );
      case "success":
        return (
          <div className="w-4 h-4 rounded-full border border-[#07C160] bg-[#EDFFF6] flex items-center justify-center text-[#07C160]">
            <SvgIcon name="check" size={12} />
          </div>
        );
      case "failed":
        return (
          <div
            className="w-4 h-4 rounded-full bg-[#EF4444] flex items-center justify-center text-white"
            title={failureReason}
          >
            <span className="text-xs font-bold leading-none">×</span>
          </div>
        );
      case "cancelled":
        return (
          <div className="w-4 h-4 rounded-full border border-[#E8E9EB] bg-[#F9FAFB] flex items-center justify-center">
            <span className="w-1 h-1 rounded-full bg-[#DDDEE0]" />
          </div>
        );
      default:
        return (
          <div className="w-4 h-4 rounded-full border border-[#D1D5DB] bg-white" />
        );
    }
  };

  // Render run mode badge
  const renderRunMode = (runMode?: RunMode) => {
    if (!runMode) return null;
    switch (runMode) {
      case "auto":
        return (
          <div className="flex items-center gap-1 px-1.5 h-5 bg-[#ECFDF5] rounded-md text-xs text-[#10B981]">
            <SvgIcon name="lightning" size={12} />
            <span>自动</span>
          </div>
        );
      case "manual":
        return (
          <div className="flex items-center gap-1 px-1.5 h-5 bg-[#FFF7ED] rounded-md text-xs text-[#F97316]">
            <SvgIcon name="five-five" size={12} />
            <span>手动</span>
          </div>
        );
      case "skip":
        return (
          <div className="flex items-center gap-1 px-1.5 h-5 bg-[#F3F4F6] rounded-md text-xs text-[#6B7280]">
            <SvgIcon name="power" size={14} />
            <span>跳过</span>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="chunks-pipeline flex-none w-[420px] border-l flex flex-col bg-white">
      {/* Header */}
      <div className="h-14 flex items-center justify-between px-5 border-b border-[#E5E7EB]">
        <h3 className="text-sm font-normal text-[#1D1E1F]">{title}</h3>
        <SvgIcon
          name="close"
          className="cursor-pointer text-[#CCCCCC] hover:text-[#666666]"
          onClick={onClose}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Strategy Selector */}
        <div className="p-4 rounded-lg shadow">
          <Dropdown
            trigger={["click"]}
            placement="bottomLeft"
            disabled={status === "running" || strategies.length < 2}
            style={{ "--ant-control-padding-horizontal": 0 }}
            menu={{
              items: strategies.map((s) => ({
                key: s.id,
                label: (
                  <div
                    className={`w-40 px-2 h-8 rounded flex items-center justify-between gap-2 ${s.id === selectedStrategy?.id ? "bg-[#F0F6FF]" : ""}`}
                  >
                    <span className="flex-1 text-sm text-[#1D1E1F] truncate">
                      {s.name}
                    </span>
                    {s.id === selectedStrategy?.id && (
                      <SvgIcon name="check_v2" className="text-[#10B981]" />
                    )}
                  </div>
                ),
                onClick: () => handleSelectStrategy(s.id),
              })),
            }}
          >
            <div className="inline-flex items-center gap-1 cursor-pointer">
              <div className="flex items-center gap-2">
                {loadingStrategies ? (
                  <div className="size-12 rounded-lg flex items-center justify-center bg-[#EFF6FF]">
                    <SvgIcon
                      name="loading"
                      className="animate-spin text-[#3B82F6]"
                    />
                  </div>
                ) : (
                  <span className="text-base text-[#000000] font-semibold">
                    {selectedStrategy?.name || "请选择策略"}
                  </span>
                )}
              </div>
              {strategies.length > 1 && status !== "running" && (
                <CaretDownOutlined style={{ fontSize: 10, color: "#9CA3AF" }} />
              )}
            </div>
          </Dropdown>

          {/* Progress Bar */}
          <div className="px-0.5 mt-3">
            <div className="h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  status === "error"
                    ? "bg-[#FA5151]"
                    : status === "idle"
                      ? "bg-[#9CA3AF]"
                      : "bg-[#3B82F6]"
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2.5">
              <span className="text-xs text-[#9CA3AF]">进度</span>
              <span
                className={`text-xs font-medium ${
                  status === "error"
                    ? "text-[#FA5151]"
                    : status === "idle"
                      ? "text-[#9CA3AF]"
                      : "text-[#3B82F6]"
                }`}
              >
                {status === "error"
                  ? "失败/中断"
                  : status === "idle"
                    ? ""
                    : status === "paused"
                      ? "等待处理"
                      : status === "running"
                        ? `${progress}%`
                        : "100% 完成"}
              </span>
            </div>
          </div>
        </div>

        {/* Steps List */}
        {steps.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-[#9CA3AF]">
            暂无任务数据
          </div>
        ) : (
          <div className="space-y-3">
            {steps.map((step, index) => (
              <div key={index} className="flex gap-3">
                {/* Status Icon and Connection Line */}
                <div className="relative flex flex-col items-center pt-1">
                  <div className="flex-none w-4 h-4 rounded-full flex items-center justify-center z-10 relative">
                    {renderStatusIcon(step.status, step.failureReason)}
                  </div>
                  {index < steps.length - 1 && (
                    <div
                      className="w-0.5 flex-1 bg-[#E5E7EB] absolute top-1 left-1.5 -bottom-4"
                      style={{ minHeight: "40px" }}
                    />
                  )}
                </div>

                {/* Step Content Card */}
                <div
                  className="flex-1 rounded-xl border bg-white transition-all cursor-pointer group overflow-hidden"
                  onClick={() => handleToggleStep(index)}
                >
                  <div className="px-4 py-3.5 flex items-center gap-3">
                    <div className="size-10 rounded-lg bg-[#F2F6FE] text-[#2563EB] flex items-center justify-center">
                      <SvgIcon name={step.icon} size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <h4 className="text-sm font-medium text-[#111827]">
                          {step.name}
                        </h4>
                        {renderRunMode(step.runMode)}
                        {step.duration > 0 && step.status === "success" && (
                          <div className="flex items-center gap-1 px-1.5 h-5 bg-[#ECFDF5] rounded-md text-xs text-[#38AD88]">
                            <SvgIcon name="clock" size={14} />
                            <span>{step.duration}s</span>
                          </div>
                        )}
                        <div className="flex-1" />
                        {step.details && (
                          <SvgIcon
                            name="down-one-filled"
                            size={14}
                            className={`flex-none mt-0.5 transition-all ${
                              isStepExpanded(index)
                                ? "rotate-180 text-[#6B7280]"
                                : "text-[#D1D5DB]"
                            }`}
                          />
                        )}
                      </div>
                      <div className="h-6 flex items-center gap-1">
                        <p className="flex-1 text-xs text-[#9CA3AF] leading-relaxed truncate">
                          {step.description}
                        </p>
                        {(step.status === "failed"
                          ? true
                          : nextStepInfo
                            ? nextStepInfo.type === step.type
                            : true) &&
                          hasPermission &&
                          status !== "running" && (
                            <div className="items-center gap-1 group-hover:flex hidden transition-all duration-300">
                              {step.type !== "vector_indexing" && (
                                <Button
                                  size="small"
                                  color="default"
                                  variant="filled"
                                  className="px-1"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleStepSetting(index);
                                  }}
                                >
                                  <SvgIcon name="settings" size={14} />
                                  <span className="text-xs">设置</span>
                                </Button>
                              )}
                              {!!step.jobId && (
                                <Button
                                  size="small"
                                  color="primary"
                                  variant="filled"
                                  className="px-1"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleStepExecute(index);
                                  }}
                                >
                                  <SvgIcon name="play-one-fill" size={14} />
                                  <span className="text-xs">执行</span>
                                </Button>
                              )}
                            </div>
                          )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {isStepExpanded(index) && step.details && (
                    <div className="mx-4 mb-4 p-3 bg-[#F8FAFC]">
                      {step.details.config && (
                        <div className="space-y-2.5">
                          {step.details.config.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <span className="flex-none w-24 text-[13px] text-[#999999]">
                                {item.label}
                              </span>
                              <span className="flex-1 text-[13px] text-[#1D1E1F] font-medium">
                                {item.alias || item.value}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center">
            <SvgIcon
              name="loading"
              className="animate-spin text-[#3B82F6]"
              size={20}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      {status !== "paused" && hasPermission && (
        <div className="px-5 py-4 border-t border-[#E5E7EB]">
          <Button
            type="primary"
            loading={loading || status === "running"}
            disabled={loading || status === "running"}
            className={`w-full h-10 text-sm ${
              status === "running"
                ? "!bg-[#93B9FF] !border-[#93B9FF]"
                : "!bg-[#2563EB] !border-[#2563EB] hover:!bg-[#1D4ED8]"
            }`}
            onClick={handleRerun}
          >
            {loading || status === "running" ? (
              <span>运行中...</span>
            ) : (
              <div className="flex items-center justify-center gap-1.5">
                <SvgIcon name="play-one-fill" size={14} />
                <span>{buttonText}</span>
              </div>
            )}
          </Button>
        </div>
      )}

      {/* Execute Dialog */}
      <Modal
        open={executeDialogVisible}
        title={currentStep?.name || "执行任务"}
        onCancel={handleExecuteDialogClose}
        onOk={() => handleConfirmExecute()}
        confirmLoading={executing}
        okText="确认执行"
        cancelText="取消"
      >
        <div className="py-4">
          <div className="flex items-center gap-4 mb-6">
            <span className="text-sm text-[#4F5052] whitespace-nowrap">
              处理规则:
            </span>
            <Radio.Group
              value={executeContinue}
              onChange={(e) => setExecuteContinue(e.target.value)}
            >
              <Radio value={false}>仅执行当前节点</Radio>
              <Radio value={true}>执行当前与后续节点</Radio>
            </Radio.Group>
          </div>
        </div>
      </Modal>

      {/* Setting Dialog */}
      <PipelineProvider lang={locale as 'zh-cn' | 'zh-tw' | 'en' | 'ja'}>
        <PipelineAdapterProvider adapter={adapter}>
          <Modal
            open={settingDialogVisible}
            title={currentSettingStep?.name || "设置"}
            onCancel={handleSettingDialogClose}
            onOk={handleConfirmSetting}
            okText="保存"
            cancelText="取消"
            width={800}
            centered
            destroyOnClose
          >
            <div className="py-4 h-[700px] overflow-y-auto overflow-x-hidden">
              {currentSettingStep?.type &&
                getConfigComponent(currentSettingStep.type) &&
                React.createElement(getConfigComponent(currentSettingStep.type)!, {
                  config: currentSettingConfig,
                  onChange: handleConfigChange,
                })}
            </div>
          </Modal>
        </PipelineAdapterProvider>
      </PipelineProvider>
    </div>
  );
}

export default ChunksPipeline;
