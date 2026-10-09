import { useState, useMemo, type Key } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Table, Tooltip, Modal, Pagination, Button, Checkbox, message } from "antd";
import { Dropdown, Tabs } from "@km/shared-components-react";
import { MoreOutlined, DeleteOutlined } from "@ant-design/icons";
import type { MenuProps, TableColumnsType } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { useLibraryStore } from "@/stores/modules/library";
import type { FileItem } from "@/api/modules/files/types";
import { PERMISSION_TYPE } from "@/components/KMPermission/constant";
import { checkHasKMPermission } from "@/utils/km-permission";
import { RUN_STATUS } from "@/constants/chunk";
import { useResponsive } from "@/hooks/useResponsive";
import { EntityDisplay } from "@/components/EntityDisplay/index";
import { STEP_KEY_TO_NAME } from "@/views/library/main/components/status/file";
import { ragJobApi } from "@/api/modules/rag-job";
import type { RagJobWithSteps } from "@/api/modules/rag-job/types";
import strategiesApi, { type Strategy } from "@/api/modules/strategies";
import ragPipelineApi from "@/api/modules/rag-pipeline";

interface FileStats {
  completed_count: number;
  queued_count: number;
  waiting_count: number;
  failed_interrupted_count: number;
  processing_count: number;
}

export function ChunkHomeView() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const libraryStore = useLibraryStore();
  // Subscribe to files state for reactive updates
  const files = useLibraryStore((state) => state.files);
  const { isMobile } = useResponsive();

  const [activeTab, setActiveTab] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

  const libraryId = params.id || "";

  // Tabs configuration
  const tabs = [
    { key: "all", label: "全部" },
    { key: RUN_STATUS.SUCCESS, label: "已完成" },
    { key: RUN_STATUS.PENDING, label: "排队中" },
    { key: RUN_STATUS.PROCESSING, label: "处理中" },
    { key: RUN_STATUS.FAILED, label: "失败/中断" },
    { key: RUN_STATUS.WAITING, label: "待人工处理" },
  ];

  // 语料视图仅展示/统计当前用户可编辑语料（>= PERMISSION_EDIT_ALL）的文件
  const manageableFiles = useMemo(
    () =>
      files.filter(
        (item) =>
          item.isfile &&
          checkHasKMPermission(item.permission, PERMISSION_TYPE.edit_all),
      ),
    [files],
  );

  // 数据统计：与知识列表同源（/api/files/all），口径与 manageableFiles 保持一致
  const stats: FileStats = useMemo(() => {
    const result: FileStats = {
      completed_count: 0,
      queued_count: 0,
      waiting_count: 0,
      failed_interrupted_count: 0,
      processing_count: 0,
    };
    for (const file of manageableFiles) {
      switch (file.cleaning_info?.status) {
        case RUN_STATUS.SUCCESS:
          result.completed_count++;
          break;
        case RUN_STATUS.PENDING:
          result.queued_count++;
          break;
        case RUN_STATUS.PROCESSING:
          result.processing_count++;
          break;
        case RUN_STATUS.FAILED:
          result.failed_interrupted_count++;
          break;
        case RUN_STATUS.WAITING:
          result.waiting_count++;
          break;
      }
    }
    return result;
  }, [manageableFiles]);

  // Filter files by tab, sorted by updated_at descending
  const filteredFiles = useMemo(() => {
    const scoped =
      activeTab === "all"
        ? manageableFiles
        : manageableFiles.filter((file) => file.cleaning_info?.status === activeTab);
    // 按 updated_at 倒序排列
    return [...scoped]
      .sort((a, b) => {
        if (!a.updated_at && !b.updated_at) return 0;
        if (!a.updated_at) return 1;
        if (!b.updated_at) return -1;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      })
      .slice((currentPage - 1) * pageSize, currentPage * pageSize);
  }, [manageableFiles, activeTab, currentPage, pageSize]);

  // Total files count
  const totalFiles = useMemo(() => {
    // 与 filteredFiles 保持同一过滤口径，否则分页总数与列表条数不一致
    if (activeTab === "all") return manageableFiles.length;
    return manageableFiles.filter(
      (file) => file.cleaning_info?.status === activeTab,
    ).length;
  }, [manageableFiles, activeTab]);

  // 选中文件的清洗状态分布，决定批量操作按钮的展示与文案
  const selectedStatuses = useMemo(() => {
    const selected = files.filter(
      (f) => selectedRowKeys.includes(f.id) && f.isfile,
    );
    return {
      successCount: selected.filter(
        (f) => f.cleaning_info?.status === RUN_STATUS.SUCCESS,
      ).length,
      failedCount: selected.filter(
        (f) => f.cleaning_info?.status === RUN_STATUS.FAILED,
      ).length,
    };
  }, [files, selectedRowKeys]);

  // Get duration
  const getDuration = (file: FileItem) => {
    if (file.cleaning_info?.end_time) {
      return (
        (file.cleaning_info.end_time - (file.cleaning_info.start_time || 0)) /
          1000 +
        "s"
      );
    }
    return "--";
  };

  // Handle view - 参考 Vue 版本的 fileRouteNavigate 逻辑
  const handleView = (file: FileItem, viewType?: string) => {
    // 判断是文件还是文件夹
    if (file.isfolder) {
      // 文件夹跳转到 folder 路由
      navigate(`/library/${libraryId}/folder/${file.id}`);
      return;
    }

    // 文件根据 viewType 决定路由
    // viewType 映射：
    // - undefined/默认: 根据 libraryStore.fileViewType 决定
    // - 'metadata': 默认视图（元数据在文件详情页显示）
    // - 'view': 默认视图
    // - 'slice': chunks 视图
    if (viewType === "slice") {
      navigate(`/library/${libraryId}/file/${file.id}/chunks?view=slice`);
    } else if (viewType === "view") {
      navigate(`/library/${libraryId}/file/${file.id}/chunks?view=view`);
    } else {
      // 默认根据 store 的 fileViewType 决定
      navigate(`/library/${libraryId}/file/${file.id}/chunks`);
    }
  };

  // Handle delete
  const handleDelete = async (file: FileItem) => {
    Modal.confirm({
      title: "提示",
      content: "确定删除此文件吗？",
      okText: "确定",
      cancelText: "取消",
      onOk: async () => {
        await libraryStore.deleteFile(file);
      },
    });
  };

  // Handle batch delete
  const handleBatchDelete = (keys: Key[]) => {
    if (keys.length === 0) return;
    const targets = files.filter((f) => keys.includes(f.id) && f.isfile);
    Modal.confirm({
      title: "提示",
      content: `确定删除已选中的 ${targets.length} 个文件吗？`,
      okText: "确定",
      cancelText: "取消",
      onOk: async () => {
        await Promise.all(targets.map((file) => libraryStore.deleteFile(file)));
        setSelectedRowKeys([]);
      },
    });
  };

  // 解析 job 的 runtime_profile_json，取出对应 step 的 run_mode 与 config
  const parseJobRunModeAndConfig = (job: RagJobWithSteps) => {
    let runMode: string | undefined;
    let config: Record<string, any> = {};
    if (job.runtime_profile_json) {
      try {
        const profile = JSON.parse(job.runtime_profile_json);
        const step = profile.steps?.find?.((s: any) => s.step_key === job.type);
        if (step) {
          runMode = step.run_mode;
          config = step.config || {};
        }
      } catch (e) {
        // 忽略解析错误，保持默认值
      }
    }
    return { runMode, config };
  };

  // 通过流水线详情组装 batchJobs：pipeline.profile_json.steps → 按 step 拆成 job
  // 用于「文件没有历史任务」时的兜底（典型场景：通用策略首次运行）
  const buildJobsFromPipeline = async (
    pipelineId: string,
  ): Promise<Array<{ job_id: number; step_key: string; run_mode?: string; config: Record<string, any> }> | null> => {
    try {
      const pipeline = await ragPipelineApi.get(pipelineId);
      let profile: any = pipeline.profile_json;
      if (typeof profile === "string") {
        try {
          profile = JSON.parse(profile);
        } catch (e) {
          console.error("解析流水线 profile_json 失败:", e);
          return null;
        }
      }
      const steps = Array.isArray(profile?.steps) ? profile.steps : [];
      return steps
        .filter((s: any) => s?.run_mode !== "skip")
        .map((s: any) => ({
          job_id: 0,
          step_key: s.step_key,
          run_mode: s.run_mode,
          config: s.config || {},
        }));
    } catch (error) {
      console.error("获取流水线详情失败:", error);
      return null;
    }
  };

  // 单文件重新清洗（内部方法：仅调接口 + 提示，不刷新列表）
  type ResolvedStrategy = { strategyId: string; pipelineId: string };
  type StrategyContext = {
    strategies: Strategy[];
    defaultStrategy: Strategy | undefined;
  };

  // 拉取一次策略列表，识别通用策略（is_default: true）
  const fetchStrategyContext = async (): Promise<StrategyContext | null> => {
    try {
      const strategies = await strategiesApi.list();
      // 过滤掉已禁用的策略，避免匹配到不可用的策略或把禁用策略误当作通用策略
      const enabledStrategies = strategies.filter((s) => s.enabled);
      return {
        strategies: enabledStrategies,
        defaultStrategy: enabledStrategies.find((s) => s.is_default),
      };
    } catch (error) {
      console.error("获取策略列表失败:", error);
      return null;
    }
  };

  // 解析单个文件应使用的策略：文件自带 strategyId 仍存在于列表 → 用文件自身的；
  // 否则降级到通用策略；都没有则返回 null。
  const resolveStrategyForFile = (
    file: FileItem,
    ctx: StrategyContext,
  ): ResolvedStrategy | null => {
    const fromFile = file.cleaning_info?.strategy_id;
    const pipelineId = file.cleaning_info?.pipeline_id;
    // FileItem.cleaning_info.* 是 string，Strategy.id 在不同模块类型中分别是 number / string，
    // 统一转字符串再比较，避免漏匹配导致全部走通用兜底。
    if (
      fromFile &&
      pipelineId &&
      ctx.strategies.some((s) => String(s.id) === fromFile)
    ) {
      return { strategyId: fromFile, pipelineId };
    }
    if (ctx.defaultStrategy) {
      return {
        strategyId: String(ctx.defaultStrategy.id),
        pipelineId: String(ctx.defaultStrategy.pipeline_id),
      };
    }
    return null;
  };

  const runReClean = async (file: FileItem, ctx: StrategyContext) => {
    const resolved = resolveStrategyForFile(file, ctx);
    if (!resolved) {
      message.warning("缺少策略或流水线信息，且未找到通用策略，无法重新清洗");
      return;
    }
    const { strategyId, pipelineId } = resolved;
    try {
      const res = await ragJobApi.getByRelatedId(file.id);
      let batchJobs = (res.jobs || [])
        .filter((j: RagJobWithSteps) => String(j.pipeline_id) === pipelineId)
        .map((job: RagJobWithSteps) => {
          const { runMode, config } = parseJobRunModeAndConfig(job);
          return {
            job_id: job.job_id,
            step_key: job.type,
            run_mode: runMode,
            config,
          };
        });
      // 没有历史任务（如通用策略首次运行）时，回退到从流水线 profile_json 拼 jobs
      if (batchJobs.length === 0) {
        const fallback = await buildJobsFromPipeline(pipelineId);
        if (!fallback || fallback.length === 0) {
          message.warning("未找到可执行的任务");
          return;
        }
        batchJobs = fallback;
      }
      await ragJobApi.batchRetry({
        run: {
          related_id: file.id,
          strategy_id: strategyId,
          pipeline_id: pipelineId,
          start_parameters: {},
        },
        jobs: batchJobs,
      });
      message.success("已提交");
    } catch (error) {
      console.error("重新清洗失败:", error);
      message.error("重新清洗失败");
    }
  };

  // 单文件入口：调一次刷新
  const handleReClean = async (file: FileItem) => {
    const ctx = await fetchStrategyContext();
    if (!ctx) {
      message.error("获取策略列表失败，无法重新清洗");
      return;
    }
    await runReClean(file, ctx);
    libraryStore.loadFilesAll();
  };

  // 批量重新清洗：拉取一次策略上下文，循环调用单文件接口，结束时统一刷新一次
  const handleBatchReClean = async (keys: Key[]) => {
    if (keys.length === 0) return;
    const targets = files.filter(
      (f) =>
        keys.includes(f.id) &&
        f.isfile &&
        f.cleaning_info?.status === RUN_STATUS.SUCCESS,
    );
    if (targets.length === 0) {
      message.warning("已选文件中没有已完成状态的文件");
      return;
    }
    const ctx = await fetchStrategyContext();
    if (!ctx) {
      message.error("获取策略列表失败，无法重新清洗");
      return;
    }
    await Promise.all(targets.map((file) => runReClean(file, ctx)));
    setSelectedRowKeys([]);
    libraryStore.loadFilesAll();
  };

  // 单文件「继续清洗」：定位失败节点，复用流水线详情页「执行」的 retry 语义，
  // 从该节点起「执行当前与后续节点」，不重跑失败前的已成功步骤
  const runContinueClean = async (file: FileItem) => {
    try {
      const res = await ragJobApi.getByRelatedId(file.id);
      // 接口声明返回 RagJobItem，实际是带 current_step_order 的完整任务，按运行时结构断言
      const jobs = (res.jobs || []) as unknown as RagJobWithSteps[];
      const failedStepKey = file.cleaning_info?.step_key;
      const failedJobs = jobs.filter((j) => j.status === RUN_STATUS.FAILED);
      // 优先取与已知失败步骤名一致的任务，取不到再退化为「按步骤顺序的第一个失败节点」
      const target =
        failedJobs.find((j) => j.type === failedStepKey) ??
        [...failedJobs].sort(
          (a, b) => (a.current_step_order || 0) - (b.current_step_order || 0),
        )[0];
      if (!target) {
        message.warning("未找到可继续执行的任务节点");
        return;
      }
      const { config } = parseJobRunModeAndConfig(target);
      await ragJobApi.retry(target.job_id, {
        continue: true,
        config:
          target.type === "document_parsing"
            ? { ...config, force_reparse: true }
            : config,
      });
      message.success("已提交");
    } catch (error) {
      console.error("继续清洗失败:", error);
      message.error("继续清洗失败");
    }
  };

  // 单文件入口：调一次刷新
  const handleContinueClean = async (file: FileItem) => {
    await runContinueClean(file);
    libraryStore.loadFilesAll();
  };

  // 批量继续清洗：逐个从失败节点续跑，结束时统一刷新一次
  const handleBatchContinueClean = async (keys: Key[]) => {
    if (keys.length === 0) return;
    const targets = files.filter(
      (f) =>
        keys.includes(f.id) &&
        f.isfile &&
        f.cleaning_info?.status === RUN_STATUS.FAILED,
    );
    if (targets.length === 0) {
      message.warning("已选文件中没有失败状态的文件");
      return;
    }
    await Promise.all(targets.map((file) => runContinueClean(file)));
    setSelectedRowKeys([]);
    libraryStore.loadFilesAll();
  };

  // Handle command
  const handleCommand = (cmd: string, doc: FileItem) => {
    switch (cmd) {
      case "metadata":
        handleView(doc, "metadata");
        break;
      case "view":
        handleView(doc, "view");
        break;
      case "slice":
        handleView(doc, "slice");
        break;
      case "delete":
        handleDelete(doc);
        break;
    }
  };

  // Get status tag
  const getStatusTag = (cleaning_info?: FileItem["cleaning_info"]) => {
    const status = cleaning_info?.status;
    const stepName = cleaning_info?.step_key ? STEP_KEY_TO_NAME[cleaning_info.step_key] : "";
    const stepSuffix = stepName ? ` · ${stepName}` : "";
    switch (status) {
      case "success":
        return (
          <span className="px-2 py-1.5 whitespace-nowrap rounded text-[#07C160] text-sm bg-[#EBFFF4]">
            已完成
          </span>
        );
      case "processing":
        return (
          <span className="px-2 py-1.5 whitespace-nowrap rounded text-blue-500 text-sm bg-[#EFF6FF]">
            处理中{stepSuffix}
          </span>
        );
      case "queued":
      case "pending":
        return (
          <span className="px-2 py-1.5 whitespace-nowrap rounded text-[#f59e0b] text-sm bg-[#FFFBEB]">
            排队中{stepSuffix}
          </span>
        );
      case "waiting":
        return (
          <span className="px-2 py-1.5 whitespace-nowrap rounded text-[#f59e0b] text-sm bg-[#FFFBEB]">
            待人工处理{stepSuffix}
          </span>
        );
      case "failed":
        return (
          <span className="px-2 py-1.5 whitespace-nowrap rounded text-[#f43f5e] text-sm bg-[#FFF1F2]">
            失败/中断{stepSuffix}
          </span>
        );
      default:
        return <span className="text-[#999999] text-sm">--</span>;
    }
  };

  // 行操作菜单(桌面表格与移动端卡片共用)
  const getMenuItems = (): MenuProps["items"] => [
    {
      key: "metadata",
      label: (
        <span className="flex items-center">
          <SvgIcon name="file-code" size={16} className="mr-1" />
          元数据
        </span>
      ),
    },
    {
      key: "view",
      label: (
        <span className="flex items-center">
          <SvgIcon name="notes" size={16} className="mr-1" />
          文档解析
        </span>
      ),
    },
    {
      key: "slice",
      label: (
        <span className="flex items-center">
          <SvgIcon name="paragraph-round" size={16} className="mr-1" />
          语料切片
        </span>
      ),
    },
    {
      key: "delete",
      label: (
        <span >
          <DeleteOutlined className="mr-1" />
          删除
        </span>
      ),
      danger: true,
    },
  ];

  // 行操作:重新/继续清洗 + 更多菜单(桌面表格与移动端卡片共用)
  // 桌面表格由外层 group-hover 控制显隐;移动端卡片无 hover,始终可见
  const renderRowActions = (record: FileItem) => {
    const status = record.cleaning_info?.status;
    const isSuccess = status === RUN_STATUS.SUCCESS;
    const isFailed = status === RUN_STATUS.FAILED;

    return (
      <>
        {(isSuccess || isFailed) && (
          <Tooltip title={isSuccess ? "重新清洗" : "继续清洗"} placement="top">
            <span
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                Modal.confirm({
                  title: "提示",
                  content: isSuccess
                    ? "确定重新清洗该文件吗？"
                    : "确定从失败节点继续清洗该文件吗？",
                  okText: "确定",
                  cancelText: "取消",
                  onOk: () =>
                    isSuccess
                      ? handleReClean(record)
                      : handleContinueClean(record),
                });
              }}
            >
              <SvgIcon
                name={isSuccess ? "retry-get" : "play-one-fill"}
                size={16}
                color="#B1B9C9"
              />
            </span>
          </Tooltip>
        )}
        <Dropdown
          menu={{
            items: getMenuItems(),
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation();
              handleCommand(key, record);
            },
          }}
          trigger={["click"]}
        >
          <span
            className="size-5 flex cursor-pointer text-gray-400"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreOutlined />
          </span>
        </Dropdown>
      </>
    );
  };

  // Table columns
  const columns: TableColumnsType<FileItem> = [
    {
      title: "文档名称",
      dataIndex: "name",
      key: "name",
      minWidth: 250,
      ellipsis: true,
      render: (name: string, record: FileItem) => (
        <div className="flex items-center gap-3">
          <img
            className="size-6 rounded flex items-center justify-center text-white shadow-sm"
            src={record.icon}
            alt=""
          />
          <div>
            <p className="text-sm text-[#1D1E1F] group-hover:text-blue-600 transition-colors">
              {name}
            </p>
            <span className="text-xs text-[#999999] mt-1 block">
              <EntityDisplay type="user" mode="name" id={record.user_id} /> ·{" "}
              {record.updated_at}
            </span>
          </div>
        </div>
      ),
    },
    {
      title: "清洗策略",
      dataIndex: "cleaning_info",
      key: "strategy",
      render: (cleaning_info: FileItem["cleaning_info"]) =>
        cleaning_info?.strategy_name ? (
          <div className="bg-[#F3F4F6] py-2 h-6 rounded text-[#4F5052] text-sm inline-flex items-center justify-center gap-1 max-w-[130px] px-2">
            <SvgIcon name="strategy" size={14} />
            <p className="flex-1 truncate">{cleaning_info.strategy_name}</p>
          </div>
        ) : (
          <span className="text-sm text-[#999999]">--</span>
        ),
    },
    {
      title: "状态",
      dataIndex: "cleaning_info",
      key: "status",
      render: (cleaning_info: FileItem["cleaning_info"]) =>
        getStatusTag(cleaning_info),
    },
    {
      title: "耗时",
      dataIndex: "last_body_time",
      key: "duration",
      render: (_: any, record: FileItem) => (
        <span className="text-sm text-[#999999]">{getDuration(record)}</span>
      ),
    },
    {
      title: "大小",
      dataIndex: "file_size",
      key: "size",
      render: (size: string) => (
        <span className="text-sm text-[#999999]">{size || "--"}</span>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      align: "right",
      render: (_: any, record: FileItem) => (
        <div className="flex items-center justify-end gap-2 invisible group-hover:visible transition-colors">
          {renderRowActions(record)}
        </div>
      ),
    },
  ];

  return (
    <div className="pb-6">
      {/* Stats Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-base font-medium text-[#1D1E1F]">数据统计</h2>
      </div>

      {/* Statistics Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-6 mb-8 max-md:gap-3 max-md:mb-5">
        <div className="bg-white rounded-xl px-5 py-6 max-md:px-3 max-md:py-4 flex items-center gap-3 max-md:gap-2">
          <div className="flex-none size-12 max-md:size-10 rounded-xl bg-[#ecfdf5] text-[#10b981] flex items-center justify-center text-xl">
            <SvgIcon name="success" size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[#999999] text-sm mb-1 font-medium">已完成</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl max-md:text-xl font-bold text-[#1D1E1F]">
                {stats.completed_count}
              </span>
              <span className="text-sm text-[#1D1E1F]">个</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl px-5 py-6 max-md:px-3 max-md:py-4 flex items-center gap-3 max-md:gap-2">
          <div className="flex-none size-12 max-md:size-10 rounded-xl bg-[#eff6ff] text-[#3b82f6] flex items-center justify-center text-xl">
            <SvgIcon name="list-numbers" size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[#94a3b8] text-sm mb-1 font-medium">排队中</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl max-md:text-xl font-bold text-[#1e293b]">
                {stats.queued_count}
              </span>
              <span className="text-sm text-[#1D1E1F]">个</span>
            </div>
          </div>
        </div>


        <div className="bg-white rounded-xl px-5 py-6 max-md:px-3 max-md:py-4 flex items-center gap-3 max-md:gap-2">
          <div className="flex-none size-12 max-md:size-10 rounded-xl bg-[#fff7ed] text-[#f97316] flex items-center justify-center text-xl">
            <SvgIcon name="time" size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[#94a3b8] text-sm mb-1 font-medium">处理中</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl max-md:text-xl font-bold text-[#1e293b]">
                {stats.processing_count}
              </span>
              <span className="text-sm text-[#1D1E1F]">个</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl px-5 py-6 max-md:px-3 max-md:py-4 flex items-center gap-3 max-md:gap-2">
          <div className="flex-none size-12 max-md:size-10 rounded-xl bg-[#fff1f2] text-[#f43f5e] flex items-center justify-center text-xl">
            <SvgIcon name="file-failed" size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[#94a3b8] text-sm mb-1 font-medium">失败/中断</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl max-md:text-xl font-bold text-[#1e293b]">
                {stats.failed_interrupted_count}
              </span>
              <span className="text-sm text-[#1D1E1F]">个</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl px-5 py-6 max-md:px-3 max-md:py-4 flex items-center gap-3 max-md:gap-2">
          <div className="flex-none size-12 max-md:size-10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" fill="none" className="max-md:w-10 max-md:h-10">
              <path fill="#F6F2FF" d="M0 36L0 12C0 5.37258 5.37258 0 12 0L36 0C42.6274 0 48 5.37258 48 12L48 36C48 42.6274 42.6274 48 36 48L12 48C5.37258 48 0 42.6274 0 36Z" />
              <circle cx="24" cy="17.5" r="3.5" stroke="rgba(121, 72, 234, 1)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
              <path stroke="rgba(121, 72, 234, 1)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" d="M14 32.5C14 28.0817 18.0294 24.5 23 24.5" />
              <circle cx="29" cy="29" r="4.5" stroke="rgba(121, 72, 234, 1)" strokeWidth="1.5" />
              <path stroke="rgba(121, 72, 234, 1)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" d="M28.5 27.5L28.5 29.5L30.5 29.5" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[#94a3b8] text-sm mb-1 font-medium">待人工处理</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl max-md:text-xl font-bold text-[#1e293b]">
                {stats.waiting_count}
              </span>
              <span className="text-sm text-[#1D1E1F]">个</span>
            </div>
          </div>
        </div>
      </div>

      {/* Knowledge List Section Title */}
      <h3 className="text-base font-medium text-[#1D1E1F] mb-6">知识列表</h3>

      {/* Main Container - Knowledge List */}
      <div className="bg-white px-5 pt-6 rounded-2xl border border-[#e2e8f0] overflow-hidden shadow-sm">
        {/* Tabs Inside the Card Header */}
        <div className="mb-6 flex items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
          <Tabs
            variant="segmented"
            className="max-md:w-full"
            items={tabs}
            activeKey={activeTab}
            onChange={(key) => {
              setActiveTab(key);
              setCurrentPage(1);
              setSelectedRowKeys([]);
            }}
          />
          {selectedRowKeys.length > 0 && (
            <div className="flex items-center gap-2 max-md:flex-wrap max-md:justify-end">
              {selectedStatuses.successCount > 0 && (
                <Button
                  color="primary"
                  variant="outlined"
                  onClick={() => {
                    Modal.confirm({
                      title: "提示",
                      content: `确定对已选中的 ${selectedStatuses.successCount} 个已完成文件重新清洗吗？`,
                      okText: "确定",
                      cancelText: "取消",
                      onOk: () => handleBatchReClean(selectedRowKeys),
                    });
                  }}
                >
                  重新清洗({selectedStatuses.successCount})
                </Button>
              )}
              {selectedStatuses.failedCount > 0 && (
                <Button
                  color="primary"
                  variant="outlined"
                  onClick={() => {
                    Modal.confirm({
                      title: "提示",
                      content: `确定对已选中的 ${selectedStatuses.failedCount} 个失败文件从失败节点继续清洗吗？`,
                      okText: "确定",
                      cancelText: "取消",
                      onOk: () => handleBatchContinueClean(selectedRowKeys),
                    });
                  }}
                >
                  继续清洗({selectedStatuses.failedCount})
                </Button>
              )}
              <Button
                color="danger"
                variant="outlined"
                type="default"
                onClick={() => handleBatchDelete(selectedRowKeys)}
              >
                删除
              </Button>
            </div>
          )}
        </div>

        {/* 数据列表:移动端用卡片列表(6 列表格窄屏溢出,且行操作依赖 hover 在触屏不可见) */}
        {isMobile ? (
          <div className="flex flex-col divide-y divide-[#f1f5f9]">
            {filteredFiles.map((record) => (
              <div
                key={record.id}
                className="py-3 flex items-start gap-3 cursor-pointer active:bg-[#f8fafc] transition-colors"
                onClick={() => handleView(record)}
              >
                <Checkbox
                  checked={selectedRowKeys.includes(record.id)}
                  className="flex-none mt-1"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    setSelectedRowKeys((prev) =>
                      e.target.checked
                        ? [...prev, record.id]
                        : prev.filter((k) => k !== record.id),
                    )
                  }
                />
                <img
                  className="size-6 rounded flex-none mt-1"
                  src={record.icon}
                  alt=""
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#1D1E1F] truncate">{record.name}</p>
                  <span className="text-xs text-[#999999] mt-1 block truncate">
                    <EntityDisplay type="user" mode="name" id={record.user_id} /> ·{" "}
                    {record.updated_at}
                  </span>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    {getStatusTag(record.cleaning_info)}
                    {record.cleaning_info?.strategy_name && (
                      <span className="bg-[#F3F4F6] rounded text-[#4F5052] text-xs inline-flex items-center gap-1 max-w-[130px] px-2 py-1">
                        <SvgIcon name="strategy" size={12} />
                        <span className="truncate">
                          {record.cleaning_info.strategy_name}
                        </span>
                      </span>
                    )}
                    {record.cleaning_info?.end_time && (
                      <span className="text-xs text-[#999999]">
                        {getDuration(record)}
                        {record.file_size ? ` · ${record.file_size}` : ""}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex-none flex items-center gap-3 mt-1">
                  {renderRowActions(record)}
                </div>
              </div>
            ))}
            {filteredFiles.length === 0 && (
              <div className="py-12 text-center text-sm text-[#999999]">
                暂无数据
              </div>
            )}
          </div>
        ) : (
          <Table
            dataSource={filteredFiles}
            columns={columns}
            rowKey="id"
            pagination={false}
            rowSelection={{
              selectedRowKeys,
              onChange: setSelectedRowKeys,
            }}
            childrenColumnName="__no_children__"
            scroll={{ x: 800 }}
            onRow={(record) => ({
              onClick: () => handleView(record),
              className:
                "group hover:bg-[#f8fafc] transition-colors cursor-pointer",
            })}
            className="custom-table"
          />
        )}

        {/* Footer Pagination */}
        <div className="flex justify-end py-4 max-md:justify-center">
          <Pagination
            total={totalFiles}
            current={currentPage}
            pageSize={pageSize}
            simple={isMobile}
            showSizeChanger={!isMobile}
            showQuickJumper={!isMobile}
            showTotal={isMobile ? undefined : (total) => `共 ${total} 条`}
            onChange={(page, size) => {
              setCurrentPage(page);
              if (size !== pageSize) {
                setPageSize(size);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default ChunkHomeView;
