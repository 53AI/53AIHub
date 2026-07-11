/**
 * System Log 系统日志页面（重构版）
 * 使用 Zustand 状态管理 + useListState URL持久化
 */
import { useEffect, useCallback, useMemo, useRef } from "react";
import { Select, Table } from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";

import { t } from "@/locales";
import { PageLayoutContent } from "@/components/PageLayout";
import { DateRangeFilter } from "@/components/Filter";
import { useListState } from "@/hooks";

import {
  useSystemLogStore,
  calculateCurrentPage,
  calculateOffset,
} from "./store";
import { COLUMN_WIDTH, EMPTY_TEXT_COLOR, PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from "./constants";
import type { SystemLogDisplayItem } from "./types";

/**
 * URL持久化状态接口
 */
interface UrlPersistedState {
  offset: number;
  limit: number;
  action: number | undefined;
  module: number | undefined;
  start_time: number | null;
  end_time: number | null;
}

/**
 * 渲染可空文本
 */
function renderNullableText(
  value: string | number | undefined | null,
): React.ReactNode {
  if (value === undefined || value === null || value === "") {
    return <span style={{ color: EMPTY_TEXT_COLOR }}>-</span>;
  }
  return String(value);
}

/**
 * 系统日志页面
 */
export function SystemLogRefactoredPage() {
  // 默认状态（稳定引用）
  const defaultUrlState = useMemo<UrlPersistedState>(() => ({
    offset: 0,
    limit: DEFAULT_PAGE_SIZE,
    action: undefined,
    module: undefined,
    start_time: null,
    end_time: null,
  }), []);

  // 使用 useListState 管理 URL持久化状态
  const { state: urlState, stateRef: urlStateRef, updateState } = useListState<UrlPersistedState>(
    defaultUrlState,
    { enableUrlSync: true, urlPrefix: 'log_' }
  );

  // 标记是否已初始化
  const initializedRef = useRef(false);

  // 从 Store 获取数据状态和方法
  const {
    list,
    total,
    actions,
    modules,
    loading,
    loadList,
    loadActions,
    loadModules,
  } = useSystemLogStore();

  // 计算当前页码
  const currentPage = calculateCurrentPage(urlState.offset, urlState.limit);

  // 加载数据 - 使用 urlStateRef 获取最新状态
  const loadData = useCallback(async () => {
    const current = urlStateRef.current;
    await loadList({
      offset: current.offset,
      limit: current.limit,
      action: current.action,
      module: current.module,
      start_time: current.start_time,
      end_time: current.end_time,
    });
  }, [loadList, urlStateRef]);

  // 表格列定义
  const columns: ColumnsType<SystemLogDisplayItem> = [
    {
      title: t("system_log.log_time"),
      dataIndex: "action_time",
      key: "action_time",
      width: COLUMN_WIDTH.ACTION_TIME,
      render: renderNullableText,
    },
    {
      title: t("system_log.log_action"),
      dataIndex: "action",
      key: "action",
      width: COLUMN_WIDTH.ACTION,
      render: (value: number) => {
        const found = actions.find((item) => item.value === value);
        return found ? found.text : renderNullableText(value);
      },
    },
    {
      title: t("system_log.log_module"),
      dataIndex: "module",
      key: "module",
      width: COLUMN_WIDTH.MODULE,
      render: (value: number) => {
        const found = modules.find((item) => item.value === value);
        return found ? found.text : renderNullableText(value);
      },
    },
    {
      title: t("system_log.log_operator"),
      dataIndex: "nickname",
      key: "nickname",
      width: COLUMN_WIDTH.OPERATOR,
      render: renderNullableText,
    },
    {
      title: t("system_log.log_label"),
      dataIndex: "content",
      key: "content",
      ellipsis: true,
      render: renderNullableText,
    },
    {
      title: t("system_log.log_ip"),
      dataIndex: "ip",
      key: "ip",
      width: COLUMN_WIDTH.IP,
      render: renderNullableText,
    },
  ];

  // 处理分页变化
  const handlePageChange = useCallback(
    (pagination: TablePaginationConfig) => {
      const page = pagination.current || 1;
      const pageSize = pagination.pageSize || urlState.limit;
      const offset = calculateOffset(page, pageSize);
      updateState({ offset, limit: pageSize });
    },
    [urlState.limit, updateState],
  );

  // 处理日期范围变化
  const handleDateChange = useCallback(
    (dates: (string | number)[]) => {
      if (dates && dates.length === 2) {
        updateState({
          start_time: dates[0] ? Number(dates[0]) : null,
          end_time: dates[1] ? Number(dates[1]) : null,
          offset: 0, // 重置页码
        });
      } else {
        updateState({
          start_time: null,
          end_time: null,
          offset: 0,
        });
      }
    },
    [updateState],
  );

  // 处理操作类型变化
  const handleActionChange = useCallback(
    (value: number | undefined) => {
      updateState({ action: value, offset: 0 });
    },
    [updateState],
  );

  // 处理模块变化
  const handleModuleChange = useCallback(
    (value: number | undefined) => {
      updateState({ module: value, offset: 0 });
    },
    [updateState],
  );

  // 初始化加载
  useEffect(() => {
    Promise.all([loadActions(), loadModules()]).then(() => {
      initializedRef.current = true;
      loadData();
    });
  }, [loadActions, loadModules, loadData]);

  // 监听 URL 状态变化，重新加载数据
  const stateKey = JSON.stringify(urlState);
  useEffect(() => {
    if (!initializedRef.current) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey]);

  // 日期值：过滤掉 null
  const dateValue = urlState.start_time && urlState.end_time
    ? [urlState.start_time, urlState.end_time]
    : [];

  // 筛选栏
  const filterBar = (
    <div className="flex gap-2">
      <DateRangeFilter
        value={dateValue}
        valueFormat={(date: Date) => date.getTime()}
        onChange={handleDateChange}
      />
      <Select
        allowClear
        className="w-44"
        placeholder={t("system_log.log_action")}
        value={urlState.action}
        onChange={handleActionChange}
        options={actions.map((item) => ({
          label: item.text,
          value: item.value,
        }))}
      />
      <Select
        allowClear
        className="w-44"
        placeholder={t("system_log.log_module")}
        value={urlState.module}
        onChange={handleModuleChange}
        options={modules.map((item) => ({
          label: item.text,
          value: item.value,
        }))}
      />
    </div>
  );

  return (
    <PageLayoutContent header={t("module.system_log")} filterBar={filterBar}>
      <Table<SystemLogDisplayItem>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        pagination={{
          current: currentPage,
          pageSize: urlState.limit,
          total,
          showSizeChanger: true,
          pageSizeOptions: PAGE_SIZE_OPTIONS,
          showTotal: (total) => t("table_footer_text", { total }),
        }}
        onChange={handlePageChange}
      />
    </PageLayoutContent>
  );
}

export default SystemLogRefactoredPage;
