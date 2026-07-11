import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Table, Tooltip, Modal, Pagination } from "antd";
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

  const libraryId = params.id || "";

  // Tabs configuration
  const tabs = [
    { key: "all", label: "全部" },
    { key: RUN_STATUS.SUCCESS, label: "已完成" },
    { key: RUN_STATUS.PENDING, label: "排队中" },
    { key: RUN_STATUS.PROCESSING, label: "清洗中" },
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

  // Filter files by tab
  const filteredFiles = useMemo(() => {
    let filteredFiles = files.filter((item) => item.isfile);
    if (activeTab !== "all") {
      filteredFiles = filteredFiles.filter((file) => file.cleaning_info?.status === activeTab);
    }
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

  // Handle command
  const handleCommand = (cmd: string, doc: FileItem) => {
    switch (cmd) {
      case "slice":
        handleView(doc, "slice");
        break;
      case "delete":
        handleDelete(doc);
        break;
    }
  };

  // Get status tag
  const getStatusTag = (status?: string) => {
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
            处理中
          </span>
        );
      case "queued":
      case "pending":
        return (
          <span className="px-2 py-1.5 whitespace-nowrap rounded text-[#f59e0b] text-sm bg-[#FFFBEB]">
            排队中
          </span>
        );
      case "waiting":
        return (
          <span className="px-2 py-1.5 whitespace-nowrap rounded text-[#f59e0b] text-sm bg-[#FFFBEB]">
            等待处理
          </span>
        );
      case "failed":
        return (
          <span className="px-2 py-1.5 whitespace-nowrap rounded text-[#f43f5e] text-sm bg-[#FFF1F2]">
            失败/中断
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
          <div className="bg-[#F3F4F6] py-2 h-6 rounded text-[#4F5052] text-sm flex items-center justify-center gap-1 w-fit px-2">
            <SvgIcon name="strategy" size={14} />
            {cleaning_info.strategy_name}
          </div>
        ) : (
          <span className="text-sm text-[#999999]">--</span>
        ),
    },
    {
      title: "状态",
      dataIndex: "cleaning_info",
      key: "status",
      width: 140,
      render: (cleaning_info: FileItem["cleaning_info"]) =>
        getStatusTag(cleaning_info?.status),
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
              <span className="text-red-500">
                <DeleteOutlined className="mr-1" />
                删除
              </span>
            ),
            danger: true,
          },
        ];

        return (
          <div className="flex items-center justify-end gap-2 invisible group-hover:visible transition-colors">
            <Tooltip title="元数据" placement="top">
              <span
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  handleView(record, "metadata");
                }}
              >
                <SvgIcon name="file-code" size={16} color="#B1B9C9" />
              </span>
            </Tooltip>
            <Tooltip title="文档解析" placement="top">
              <span
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  handleView(record, "view");
                }}
              >
                <SvgIcon name="notes" size={16} color="#B1B9C9" />
              </span>
            </Tooltip>
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
                className="cursor-pointer text-gray-400"
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
        <div className="mb-6">
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
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Data Table */}
        <Table
          dataSource={filteredFiles}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
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
