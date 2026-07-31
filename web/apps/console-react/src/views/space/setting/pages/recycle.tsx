import {
    Button,
    Empty as AntEmpty,
    Input,
    Modal,
    Spin,
    Table,
    Tooltip,
    message,
} from "antd";
import { ReloadOutlined, DeleteOutlined } from "@ant-design/icons";
import { useState, useCallback, useEffect } from "react";
import type { ColumnsType } from "antd/es/table";
import { useOutletContext } from "react-router-dom";
import { Header } from "@/components/Header";
import { spacesApi } from "@/api/modules/spaces";
import type { SpaceRecycleItem } from "@/api/modules/spaces/types";
import type { SpaceSettingContext } from "../index";
import { t } from "@/locales";

export function RecyclePage() {
    const { space } = useOutletContext<SpaceSettingContext>();
    const [items, setItems] = useState<SpaceRecycleItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [acting, setActing] = useState(false);
    const [keyword, setKeyword] = useState("");
    const [pagination, setPagination] = useState({ page: 1, pageSize: 10 });
    const [selectedIds, setSelectedIds] = useState<React.Key[]>([]);

    const loadList = useCallback(
        async (
            kw: string = keyword,
            page: number = pagination.page,
            pageSize: number = pagination.pageSize,
        ) => {
            setLoading(true);
            try {
                const res = await spacesApi.recycleList({
                    space_id: space.id,
                    keyword: kw || undefined,
                    offset: (page - 1) * pageSize,
                    limit: pageSize,
                });
                setItems(res.items || []);
                setTotal(res.count || 0);
            } catch (error) {
                console.error("Load recycle list error:", error);
                setItems([]);
                setTotal(0);
            } finally {
                setLoading(false);
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [space.id],
    );

    useEffect(() => {
        loadList();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [space.id]);

    const handleSearch = useCallback((value: string) => {
        setKeyword(value);
        setPagination((prev) => ({ ...prev, page: 1 }));
        loadList(value, 1, pagination.pageSize);
    }, [loadList, pagination.pageSize]);

    const handleRecover = useCallback(
        async (ids: React.Key[]) => {
            if (!ids.length) {
                message.warning(t("space.recycle.select_first"));
                return;
            }
            try {
                setActing(true);
                await spacesApi.recycleRecover(ids.map(String));
                message.success(t("space.recycle.recover_success"));
                setSelectedIds([]);
                loadList();
            } catch (error) {
                console.error("Recover error:", error);
            } finally {
                setActing(false);
            }
        },
        [loadList],
    );

    const handleDelete = useCallback(
        (ids: React.Key[]) => {
            if (!ids.length) {
                message.warning(t("space.recycle.select_first"));
                return;
            }
            const isBatch = ids.length > 1;
            Modal.confirm({
                title: isBatch
                    ? t("space.recycle.batch_delete_title")
                    : t("space.recycle.delete_title"),
                content: isBatch
                    ? t("space.recycle.batch_delete_content", {
                          count: ids.length,
                      })
                    : t("space.recycle.delete_single_content"),
                okText: t("space.recycle.delete"),
                okButtonProps: { danger: true },
                cancelText: t("action_cancel"),
                centered: true,
                onOk: async () => {
                    try {
                        setActing(true);
                        await spacesApi.recycleDelete(ids.map(String));
                        message.success(t("space.recycle.delete_success"));
                        setSelectedIds([]);
                        loadList();
                    } catch (error) {
                        console.error("Delete error:", error);
                        return Promise.reject();
                    } finally {
                        setActing(false);
                    }
                },
            });
        },
        [loadList],
    );

    const handleBatchRecover = useCallback(() => {
        if (!selectedIds.length) {
            message.warning(t("space.recycle.select_first"));
            return;
        }
        Modal.confirm({
            title: t("space.recycle.batch_recover_title"),
            content: t("space.recycle.batch_recover_content", {
                count: selectedIds.length,
            }),
            okText: t("space.recycle.recover"),
            okButtonProps: { danger: false },
            cancelText: t("action_cancel"),
            centered: true,
            onOk: async () => {
                try {
                    setActing(true);
                    await spacesApi.recycleRecover(selectedIds.map(String));
                    message.success(t("space.recycle.recover_success"));
                    setSelectedIds([]);
                    loadList();
                } catch (error) {
                    console.error("Batch recover error:", error);
                    return Promise.reject();
                } finally {
                    setActing(false);
                }
            },
        });
    }, [selectedIds, loadList]);

    const columns: ColumnsType<SpaceRecycleItem> = [
        {
            title: t("common.name"),
            dataIndex: "name",
            key: "name",
            minWidth: 200,
            render: (name: string, record) => (
                <div className="flex items-center gap-2">
                    {record.icon ? (
                        <img src={record.icon} alt="" className="size-6" />
                    ) : null}
                    <span className="text-sm text-[#1D1E1F]">
                        {name || "--"}
                    </span>
                </div>
            ),
        },
        {
            title: t("space.recycle.deleted_time"),
            dataIndex: "deleted_time",
            key: "deleted_time",
            width: 180,
            render: (time?: number) =>
                time ? new Date(time).toLocaleString() : "--",
        },
        {
            title: t("space.recycle.size"),
            dataIndex: "size",
            key: "size",
            width: 120,
            render: (size?: number) =>
                size ? `${(size / 1024).toFixed(1)} KB` : "--",
        },
        {
            title: t("operation"),
            key: "operation",
            width: 180,
            align: "right",
            render: (_, record) => (
                <div className="invisible group-hover:visible flex justify-end gap-2">
                    <Tooltip title={t("space.recycle.recover")}>
                        <Button
                            type="text"
                            disabled={acting}
                            icon={
                                <ReloadOutlined className="text-gray-400 hover:text-blue-500" />
                            }
                            onClick={(e) => {
                                e.stopPropagation();
                                handleRecover([record.id]);
                            }}
                        />
                    </Tooltip>
                    <Tooltip title={t("space.recycle.delete")}>
                        <Button
                            type="text"
                            disabled={acting}
                            icon={
                                <DeleteOutlined className="text-gray-400 hover:text-red-500" />
                            }
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDelete([record.id]);
                            }}
                        />
                    </Tooltip>
                </div>
            ),
        },
    ];

    return (
        <div className="h-screen flex flex-col overflow-hidden px-[60px] bg-[#F8F9FA]">
            <Header
                className="pt-8 pb-5"
                title={t("space.setting.menu.recycle")}
            />
            <div className="bg-white flex-1 gap-6 px-10 py-8 overflow-y-auto mb-5">
                <Spin spinning={loading}>
                    {/* Toolbar */}
                    <div className="flex items-center justify-between gap-4">
                        <Input.Search
                            allowClear
                            placeholder={t("space.recycle.search_placeholder")}
                            className="w-[200px]"
                            onSearch={handleSearch}
                        />
                        {selectedIds.length === 0 ? (
                            <p className="text-sm text-[#939499]">
                                {t("space.recycle.retention_tip")}
                            </p>
                        ) : (
                            <div>
                                <span className="text-sm text-[#888] mr-2">
                                    ({t("space.recycle.selected_prefix")}
                                    {selectedIds.length}
                                    {t("space.recycle.selected_suffix")})
                                </span>
                                <Button
                                    className="w-20 text-[#2563EB] border-[#2563EB] hover:opacity-60"
                                    disabled={acting}
                                    onClick={handleBatchRecover}
                                >
                                    {t("space.recycle.recover")}
                                </Button>
                                <Button
                                    className="w-20 text-[#FA5151] border-[#FA5151] hover:text-[#FA5151] hover:opacity-60 hover:border-[#FA5151] ml-2"
                                    disabled={acting}
                                    onClick={() => handleDelete(selectedIds)}
                                >
                                    {t("space.recycle.delete")}
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Table */}
                    <Table
                        className="w-full cursor-pointer mt-4"
                        rowKey="id"
                        columns={columns}
                        dataSource={items}
                        rowClassName={() => "group cursor-pointer"}
                        rowSelection={{
                            selectedRowKeys: selectedIds,
                            onChange: setSelectedIds,
                        }}
                        pagination={{
                            current: pagination.page,
                            pageSize: pagination.pageSize,
                            total,
                            showSizeChanger: true,
                            showQuickJumper: true,
                            showTotal: (total) =>
                                t("table_footer_text", { total }),
                            onChange: (page, pageSize) => {
                                setPagination({ page, pageSize });
                                loadList(keyword, page, pageSize);
                            },
                        }}
                        onRow={(record) => ({
                            onClick: () => handleRecover([record.id]),
                        })}
                        locale={{
                            emptyText: (
                                <AntEmpty
                                    image={AntEmpty.PRESENTED_IMAGE_SIMPLE}
                                    description={t("space.recycle.empty")}
                                />
                            ),
                        }}
                    />
                </Spin>
            </div>
        </div>
    );
}

export default RecyclePage;
