import { useState, useEffect, useMemo, type Key } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Table, Tooltip, Modal, Pagination, Button, message } from "antd";
import { Dropdown } from "@km/shared-components-react";
import { MoreOutlined, DeleteOutlined } from "@ant-design/icons";
import type { MenuProps, TableColumnsType } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { useLibraryStore } from "@/stores/modules/library";
import { filesApi } from "@/api/modules/files";
import type { FileItem } from "@/api/modules/files/types";
import { RUN_STATUS } from "@/constants/chunk";
import { usePoll } from "@/hooks/usePoll";
import { EntityDisplay } from "@/components/EntityDisplay/index";
import { STEP_KEY_TO_NAME } from "@/views/library/main/components/status/file";
import { ragJobApi } from "@/api/modules/rag-job";
import type { RagJobWithSteps } from "@/api/modules/rag-job/types";
import strategiesApi, { type Strategy } from "@/api/modules/strategies";
import ragPipelineApi from "@/api/modules/rag-pipeline";

interface FileStats {
  completed_count: number;
  queued_count: number;
  failed_interrupted_count: number;
  processing_count: number;
}

export function ChunkHomeView() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const libraryStore = useLibraryStore();
  // Subscribe to files state for reactive updates
  const files = useLibraryStore((state) => state.files);

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<FileStats>({
    completed_count: 0,
    queued_count: 0,
    failed_interrupted_count: 0,
    processing_count: 0,
  });
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
    { key: RUN_STATUS.WAITING, label: "等待处理" },
    { key: RUN_STATUS.PROCESSING, label: "处理中" },
    { key: RUN_STATUS.FAILED, label: "失败/中断" },
  ];

  // Load stats
  const loadStats = async () => {
    if (!libraryId) return;

    try {
      const res = await filesApi.allStats({ library_id: libraryId });
      setStats(res as FileStats);
    } catch (error) {
      console.error("获取统计数据失败:", error);
    }
  };

  // Filter files by tab, sorted by updated_at descending
  const filteredFiles = useMemo(() => {
    let filteredFiles = files.filter((item) => item.isfile);
    if (activeTab !== "all") {
      filteredFiles = filteredFiles.filter((file) => file.cleaning_info?.status === activeTab);
    }
    // 按 updated_at 倒序排列
    filteredFiles = filteredFiles.sort((a, b) => {
      if (!a.updated_at && !b.updated_at) return 0;
      if (!a.updated_at) return 1;
      if (!b.updated_at) return -1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    return filteredFiles.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  }, [files, activeTab, currentPage, pageSize]);

  // Total files count
  const totalFiles = useMemo(() => {
    let filteredFiles = files.filter((item) => item.isfile);
    if (activeTab !== "all") {
      filteredFiles = filteredFiles.filter((file) => file.cleaning_info?.status === activeTab);
    }
    return filteredFiles.length;
  }, [files, activeTab]);

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
        loadStats();
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
        loadStats();
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
    loadStats();
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
            等待处理{stepSuffix}
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

  // Table columns
  const columns: TableColumnsType<FileItem> = [
    {
      title: "文档名称",
      dataIndex: "name",
      key: "name",
      minWidth: 200,
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
      width: 130,
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
      width: 200,
      render: (cleaning_info: FileItem["cleaning_info"]) =>
        getStatusTag(cleaning_info),
    },
    {
      title: "耗时",
      dataIndex: "last_body_time",
      key: "duration",
      width: 100,
      render: (_: any, record: FileItem) => (
        <span className="text-sm text-[#999999]">{getDuration(record)}</span>
      ),
    },
    {
      title: "大小",
      dataIndex: "file_size",
      key: "size",
      width: 120,
      render: (size: string) => (
        <span className="text-sm text-[#999999]">{size || "--"}</span>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      align: "right",
      render: (_: any, record: FileItem) => {
        const menuItems: MenuProps["items"] = [
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

        return (
          <div className="flex items-center justify-end gap-2 invisible group-hover:visible transition-colors">
            {record.cleaning_info?.status === RUN_STATUS.SUCCESS && (
              <Tooltip title="重新清洗" placement="top">
                <span
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    Modal.confirm({
                      title: "提示",
                      content: "确定重新清洗该文件吗？",
                      okText: "确定",
                      cancelText: "取消",
                      onOk: () => handleReClean(record),
                    });
                  }}
                >
                  <SvgIcon name="retry-get" size={16} color="#B1B9C9" />
                </span>
              </Tooltip>
            )}
            <Dropdown
              menu={{
                items: menuItems,
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
          </div>
        );
      },
    },
  ];

  // Poll for updates
  usePoll(() => {
    loadStats();
  }, 5000);

  // Extract file status changes to trigger stats refresh
  const fileStatuses = useMemo(() => {
    return files
      .filter((f) => f.isfile)
      .map((f) => f.cleaning_info?.status)
      .sort()
      .join(",");
  }, [files]);

  // Initial load and auto-refresh when file status changes
  useEffect(() => {
    if (!libraryId) return;

    setLoading(true);
    loadStats().finally(() => setLoading(false));
  }, [libraryId, fileStatuses]);

  return (
    <div className="pb-6">
      {/* Stats Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-base font-medium text-[#1D1E1F]">数据统计</h2>
      </div>

      {/* Statistics Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl px-5 py-6 flex items-center gap-3">
          <div className="flex-none size-12 rounded-xl bg-[#ecfdf5] text-[#10b981] flex items-center justify-center text-xl">
            <SvgIcon name="success" size={24} />
          </div>
          <div className="flex-1">
            <p className="text-[#999999] text-sm mb-1 font-medium">已完成</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-[#1D1E1F]">
                {stats.completed_count}
              </span>
              <span className="text-sm text-[#1D1E1F]">个</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl px-5 py-6 flex items-center gap-3">
          <div className="flex-none size-12 rounded-xl bg-[#eff6ff] text-[#3b82f6] flex items-center justify-center text-xl">
            <SvgIcon name="list-numbers" size={24} />
          </div>
          <div className="flex-1">
            <p className="text-[#94a3b8] text-sm mb-1 font-medium">排队中</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-[#1e293b]">
                {stats.queued_count}
              </span>
              <span className="text-sm text-[#1D1E1F]">个</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl px-5 py-6 flex items-center gap-3">
          <div className="flex-none size-12 rounded-xl bg-[#fff7ed] text-[#f97316] flex items-center justify-center text-xl">
            <SvgIcon name="time" size={24} />
          </div>
          <div className="flex-1">
            <p className="text-[#94a3b8] text-sm mb-1 font-medium">清洗中</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-[#1e293b]">
                {stats.processing_count}
              </span>
              <span className="text-sm text-[#1D1E1F]">个</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl px-5 py-6 flex items-center gap-3">
          <div className="flex-none size-12 rounded-xl bg-[#fff1f2] text-[#f43f5e] flex items-center justify-center text-xl">
            <SvgIcon name="file-failed" size={24} />
          </div>
          <div className="flex-1">
            <p className="text-[#94a3b8] text-sm mb-1 font-medium">失败/中断</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-[#1e293b]">
                {stats.failed_interrupted_count}
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
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex bg-[#F9F9FA] p-1 rounded-lg w-fit">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                className={`px-4 h-8 text-base transition-all rounded flex items-center ${
                  activeTab === tab.key
                    ? "bg-white text-[#2563EB] shadow-sm"
                    : "text-[#999999] hover:text-[#1e293b]"
                }`}
                onClick={() => {
                  setActiveTab(tab.key);
                  setCurrentPage(1);
                  setSelectedRowKeys([]);
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {selectedRowKeys.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                color="primary"
                variant="outlined"
                onClick={() => {
                  if (selectedRowKeys.length === 0) return;
                  Modal.confirm({
                    title: "提示",
                    content: `确定对已选中的 ${selectedRowKeys.length} 个文件重新清洗吗？`,
                    okText: "确定",
                    cancelText: "取消",
                    onOk: () => handleBatchReClean(selectedRowKeys),
                  });
                }}
              >
                重新清洗
              </Button>
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

        {/* Data Table */}
        <Table
          dataSource={filteredFiles}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
          childrenColumnName="__no_children__"
          onRow={(record) => ({
            onClick: () => handleView(record),
            className:
              "group hover:bg-[#f8fafc] transition-colors cursor-pointer",
          })}
          className="custom-table"
        />

        {/* Footer Pagination */}
        <div className="py-4 border-t border-[#f1f5f9]">
          <Pagination
            total={totalFiles}
            current={currentPage}
            pageSize={pageSize}
            showSizeChanger
            showQuickJumper
            showTotal={(total) => `共 ${total} 条`}
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
