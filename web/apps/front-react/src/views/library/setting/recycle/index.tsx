import { useState, useEffect, useRef } from "react";
import { Button, Table, Tooltip, Modal, message, Spin } from "antd";
import {
  ReloadOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { Search } from "@km/shared-components-react";
import { filesApi } from "@/api/modules/files";
import { formatRecycleList, type RecycleListItem } from "@/api/modules/files/transform";
import { useLibraryStore } from "@/stores/modules/library";
import { EntityDisplay } from "@/components/EntityDisplay";
import { Header } from "@/components/Header";
import type { ColumnsType, TableProps } from "antd/es/table";

interface RecycleListItem {
  id: string;
  name: string;
  icon: string;
  deleted_by: number;
  deleted_time: string;
  remaining_days: number;
}

export function LibraryRecycleSettingsView() {
  const libraryStore = useLibraryStore();
  const [fileList, setFileList] = useState<RecycleListItem[]>([]);
  const [selectedRows, setSelectedRows] = useState<RecycleListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0,
  });
  const tableRef = useRef<any>(null);

  const loadList = async (searchKeyword?: string) => {
    if (!libraryStore.library?.id) return;
    setLoading(true);
    try {
      const res = await filesApi.recycleList({
        library_id: libraryStore.library.id,
        q: searchKeyword ?? keyword,
        offset: (pagination.current - 1) * pagination.pageSize,
        limit: pagination.pageSize,
        sort: "desc",
      });
      setFileList(formatRecycleList(res.items));
      setPagination((prev) => ({ ...prev, total: res.count }));
    } finally {
      setLoading(false);
    }
  };

  const handleRecover = async (row: RecycleListItem) => {
    const res = await filesApi.parentExists(row.id);
    if (res.exists) {
      Modal.confirm({
        title: "恢复文档",
        content: "确定将文档恢复到原有位置",
        okText: "恢复",
        onOk: async () => {
          await filesApi.restore(row.id, {
            restore_to_root_if_parent_missing: false,
          });
          message.success("已恢复");
          loadList();
        },
      });
    } else {
      Modal.confirm({
        title: "恢复文档",
        content: "页面原父级节点已不存在，将直接恢复到根目录",
        okText: "恢复",
        onOk: async () => {
          await filesApi.restore(row.id, {
            restore_to_root_if_parent_missing: true,
          });
          message.success("已恢复");
          loadList();
        },
      });
    }
  };

  const handleDelete = async (row: RecycleListItem) => {
    Modal.confirm({
      title: "提示",
      content: "确定彻底删除该文件吗？删除后将无法恢复",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        await filesApi.hardDelete(row.id);
        message.success("已删除");
        loadList();
      },
    });
  };

  const handleBatchRecover = async () => {
    Modal.confirm({
      title: "恢复文档",
      content: `确定将 ${selectedRows.length}个文档恢复到原有位置，若父级节点不存在，将直接恢复到根目录`,
      okText: "恢复",
      onOk: async () => {
        setLoading(true);
        try {
          for (const item of selectedRows) {
            const res = await filesApi.parentExists(item.id);
            await filesApi.restore(item.id, {
              restore_to_root_if_parent_missing: !res.exists,
            });
          }
          message.success("已恢复");
          loadList();
          setSelectedRows([]);
        } catch {
          message.error("恢复失败");
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const handleBatchDelete = async () => {
    Modal.confirm({
      title: "彻底删除",
      content: `是否彻底删除这${selectedRows.length}个文档，删除后将无法恢复`,
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        setLoading(true);
        try {
          for (const item of selectedRows) {
            await filesApi.hardDelete(item.id);
          }
          message.success("已删除");
          loadList();
          setSelectedRows([]);
        } catch {
          message.error("删除失败");
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const handleSearch = (kw?: string) => {
    setPagination((prev) => ({ ...prev, current: 1 }));
    loadList(kw);
  };

  const handleTableChange: TableProps["onChange"] = (pag) => {
    setPagination((prev) => ({
      ...prev,
      current: pag.current || 1,
      pageSize: pag.pageSize || 10,
    }));
  };

  useEffect(() => {
    loadList();
  }, [libraryStore.library?.id, pagination.current, pagination.pageSize]);

  const columns: ColumnsType<RecycleListItem> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      render: (name, record) => (
        <div className="flex items-center gap-2">
          <img src={record.icon} alt="" className="size-6" />
          <span className="text-sm text-[#1D1E1F]">{name}</span>
        </div>
      ),
    },
    {
      title: "操作人",
      dataIndex: "deleted_by",
      key: "deleted_by",
      render: (deleted_by) => (
        <EntityDisplay id={deleted_by} type="user" mode="name" />
      ),
    },
    {
      title: "删除时间",
      dataIndex: "deleted_time",
      key: "deleted_time",
      width: 180,
    },
    {
      title: "剩余时间",
      dataIndex: "remaining_days",
      key: "remaining_days",
      width: 100,
      render: (days) => `${days}天`,
    },
    {
      title: "操作",
      key: "action",
      width: 180,
      align: "right",
      render: (_, record) => (
        <div className="invisible group-hover:visible flex justify-end gap-2">
          <Tooltip title="恢复">
            <Button
              type="text"
              icon={
                <ReloadOutlined className="text-gray-400 hover:text-blue-500" />
              }
              onClick={(e) => {
                e.stopPropagation();
                handleRecover(record);
              }}
            />
          </Tooltip>
          <Tooltip title="彻底删除">
            <Button
              type="text"
              icon={
                <DeleteOutlined className="text-gray-400 hover:text-red-500" />
              }
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(record);
              }}
            />
          </Tooltip>
        </div>
      ),
    },
  ];

  const rowSelection = {
    selectedRowKeys: selectedRows.map((r) => r.id),
    onChange: (_: React.Key[], selectedRows: RecycleListItem[]) => {
      setSelectedRows(selectedRows);
    },
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden px-[60px] bg-[#F8F9FA]">
      <Header className="pt-8 pb-5" title="回收站" />
      <div className="bg-[#ffffff] flex-1 gap-6 px-10 py-8 overflow-y-auto mb-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Search
              mode="expanded"
              placeholder="搜索名称"
              value={keyword}
              onDebouncedChange={(val) => {
                setKeyword(val);
                handleSearch(val);
              }}
              className="w-[200px]"
            />
          </div>
          {selectedRows.length === 0 ? (
            <p className="text-sm text-[#939499]">
              文档删除后，将在回收站内保存30天，逾期后将永久删除文档
            </p>
          ) : (
            <div>
              <span className="text-sm text-[#888] mr-2">
                (已选中:{selectedRows.length})
              </span>
              <Button
                className="w-20 text-[#2563EB] border-[#2563EB] hover:opacity-60"
                onClick={handleBatchRecover}
              >
                恢复
              </Button>
              <Button
                className="w-20 text-[#FA5151] border-[#FA5151] hover:text-[#FA5151] hover:opacity-60 hover:border-[#FA5151] ml-2"
                onClick={handleBatchDelete}
              >
                彻底删除
              </Button>
            </div>
          )}
        </div>

        <Spin spinning={loading}>
          <Table
            ref={tableRef}
            className="w-full cursor-pointer mt-4"
            rowSelection={rowSelection}
            columns={columns}
            dataSource={fileList}
            rowKey="id"
            rowClassName={() => "group cursor-pointer"}
            pagination={{
              current: pagination.current,
              pageSize: pagination.pageSize,
              total: pagination.total,
              showSizeChanger: true,
              showQuickJumper: true,
            }}
            onChange={handleTableChange}
            components={{
              header: {
                cell: (props: any) => (
                  <th {...props} className="!bg-[#F5F6F7] !text-[#999999]" />
                ),
              },
            }}
            onRow={(record) => ({
              onClick: () => handleRecover(record),
            })}
          />
        </Spin>
      </div>
    </div>
  );
}

export default LibraryRecycleSettingsView;
