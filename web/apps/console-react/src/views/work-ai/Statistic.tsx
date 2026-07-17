import React, { useState, useEffect, useRef } from "react";
import { Table, Select, Button, Tag, Spin, Tooltip } from "antd";
import { t } from "@/locales";
import { SvgIcon, Search } from "@km/shared-components-react";
import recordApi from "@/api/modules/record";
import userApi from "@/api/modules/user";
import { DateRangeFilter } from "@/components/Filter/date-range";
import Detail, { DetailRef } from "@/views/search/components/detail";
import {
    SEARCH_TYPE
} from "@/api/modules/feedback/types";
import {
    type RecordDisplayItem,
    THINKING_MODE,
    RESPONSE_STATUS,
    SOURCE_TYPE,
} from "@/api/modules/record/types";
import { getLastTimeAsDay } from "@km/shared-utils";

interface StatisticProps {
  agentId?: string | number;
  showSourceFilter?: boolean;
  showCleanFilter?: boolean;
  showStatusFilter?: boolean;
}

const WorkAIStatistic: React.FC<StatisticProps> = ({ agentId, showSourceFilter, showCleanFilter = true, showStatusFilter = true }) => {
  const [loading, setLoading] = useState(false);
  const detailRef = useRef<DetailRef>(null);

  const [recordList, setRecordList] = useState({
    message_count: {
      label: t("search-record.message_count"),
      color: "#2563EB",
      bg: "#E0EAFF",
      svg: "commit",
      tip: t("search-record.message_count_tip"),
      value: "---",
      unit: t("unit_messages_v2"),
    },
    conversation_total_count: {
      label: t("search-record.conversation_total_count"),
      color: "#07C160",
      bg: "#C2F2D5",
      svg: "feelgood-one",
      tip: t("search-record.conversation_total_count_tip"),
      value: "---",
      unit: t("search-record.total_count_unit"),
    },
    token_consumption: {
      label: t("search-record.token_consumption"),
      color: "#F0A105",
      bg: "#FFE5B0",
      svg: "internal-data",
      tip: t("search-record.token_consumption_tip"),
      value: "---",
      unit: "K",
    },
    avg_response_time: {
      label: t("search-record.avg_response_time"),
      color: "#2563EB",
      bg: "#E0EAFF",
      svg: "flash-payment",
      tip: t("search-record.avg_response_time_tip"),
      value: "---",
      unit: "ms",
    },
  });

  const [detailedForm, setDetailedForm] = useState({
    start_time: null as number | null,
    end_time: null as number | null,
    keyword: "",
    thinking_mode: 0,
    response_status: 0,
    knowledge_type: 0,
    offset: 0,
    limit: 10,
    source: null as string | null,
  });

  const [tableData, setTableData] = useState<RecordDisplayItem[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  const [isCleared, setIsCleared] = useState(false);
  const userListRef = useRef<Record<number, string>>({});
  const [isClearIconAvailable, setIsClearIconAvailable] = useState(false);
  // 获取默认日期范围的辅助函数
  const getDefaultDateRange = (): [number, number] => {
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    return [
      new Date(getLastTimeAsDay(7, "YYYY-MM-DD hh:mm", "start")).getTime(),
      endDate.getTime(),
    ];
  };
  const [statisticsDateValue, setStatisticsDateValue] =
    useState<[number, number]>(getDefaultDateRange);
  const [detailedDateValue, setDetailedDateValue] =
    useState<[number, number]>(getDefaultDateRange);

  const loadInternalUser = async () => {
    const { list = [] } = await userApi.fetch_internal_user({
      status: -1,
      offset: 0,
      limit: 999,
    });
    const userMap: Record<number, string> = {};
    list.forEach((item: any) => {
      userMap[item.user_id] = item.nickname;
    });
    userListRef.current = userMap;
  };

  const loadRecordStats = async (source?: string | null) => {
    if (statisticsDateValue.length === 0) return;
    const recordStats = await recordApi.getMessageStats({
      start_date: Math.floor(statisticsDateValue[0] / 1000),
      end_date: Math.floor(statisticsDateValue[1] / 1000),
      agent_id: agentId || undefined,
      source: source || undefined,
    });
    setRecordList((prev) => ({
      ...prev,
      message_count: {
        ...prev.message_count,
        value: recordStats.total_questions,
      },
      conversation_total_count: {
        ...prev.conversation_total_count,
        value: recordStats.conversations,
      },
      token_consumption: {
        ...prev.token_consumption,
        value: (recordStats.total_tokens / 1000).toFixed(1),
      },
      avg_response_time: {
        ...prev.avg_response_time,
        value: recordStats.avg_duration_ms,
      },
    }));
  };

  const loadRecordList = async (
    form = detailedForm,
    dates = detailedDateValue,
  ) => {
    setTableLoading(true);
    try {
      const list = await recordApi.getMessageList({
        ...form,
        start_date: dates[0],
        end_date: dates[1],
        keyword: form.keyword || null,
        agent_id: agentId || undefined,
        thinking_mode: form.thinking_mode === 0 ? null : form.thinking_mode,
        response_status:
          form.response_status === 0 ? null : form.response_status,
        knowledge_type: form.knowledge_type === 0 ? null : form.knowledge_type,
        offset: form.offset,
        limit: form.limit,
        source: form.source || null,
      });
      const messages = (list.messages || []).map((item: any) => {
        return {
          ...item,
          nickname: userListRef.current[item.user_id],
        };
      });
      setTableData(messages);
      setTableTotal(list.total);
    } finally {
      setTableLoading(false);
    }
  };

  const onRefresh = (newForm = detailedForm, dates = detailedDateValue) => {
    setDetailedForm({ ...newForm, offset: 0 });
    loadRecordList({ ...newForm, offset: 0 }, dates);
  };

  const handleFilterChange = (
    newForm = detailedForm,
    dates = detailedDateValue,
  ) => {
    setIsClearIconAvailable(true);
    onRefresh(newForm, dates);
  };

  const handleSizeChange = (size: number) => {
    const newForm = { ...detailedForm, limit: size, offset: 0 };
    setDetailedForm(newForm);
    loadRecordList(newForm);
  };

  const handleCurrentChange = (page: number) => {
    const newForm = {
      ...detailedForm,
      offset: (page - 1) * detailedForm.limit,
    };
    setDetailedForm(newForm);
    loadRecordList(newForm);
  };

  const handleClear = () => {
    if (!isClearIconAvailable) return;
    const newDates = getDefaultDateRange();
    const newForm = {
      start_time: null,
      end_time: null,
      keyword: "",
      thinking_mode: 0,
      response_status: 0,
      knowledge_type: 0,
      offset: 0,
      limit: 10,
      source: null,
    };
    setDetailedDateValue(newDates);
    setDetailedForm(newForm);
    setIsCleared(true);
    setIsClearIconAvailable(false);
    loadRecordList(newForm, newDates);
  };

  const handleChangeRecordType = (type: string) => {
    if (type !== "total_questions") {
      setIsClearIconAvailable(true);
    }
    const newDates = [...statisticsDateValue] as [number, number];
    const newForm = {
      ...detailedForm,
      keyword: "",
      thinking_mode: 0,
      response_status: 0,
      knowledge_type: 0,
      offset: 0,
      limit: 10,
      source: null,
    };
    if (type === "no_search_results") {
      newForm.response_status = RESPONSE_STATUS.REFUSED;
    }
    if (type === "quick_answers") {
      newForm.thinking_mode = THINKING_MODE.QUICK_ANSWER;
    }
    if (type === "deep_thinking") {
      newForm.thinking_mode = THINKING_MODE.DEEP_THINKING;
    }
    setIsCleared(true);
    setDetailedDateValue(newDates);
    setDetailedForm(newForm);
    loadRecordList(newForm, newDates);
  };

  const handleOpenDetail = (index: number) => {
    detailRef.current?.open({
      index,
      tableData,
      type: SEARCH_TYPE.RECORD,
    });
  };

  const onRowClick = (row: RecordDisplayItem) => {
    const index = tableData.findIndex((item) => item.id === row.id);
    if (index !== -1) {
      handleOpenDetail(index);
    }
  };

  // 初始化：只执行一次，加载数据
  useEffect(() => {
    const init = async () => {
      await loadInternalUser();
      // 用户列表加载完成后，再加载记录（避免重复请求）
      loadRecordStats();
      loadRecordList();
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const columns = [
    ...(showSourceFilter ? [{
      title: t("search-record.source"),
      dataIndex: "request_source",
      key: "request_source",
      width: 80,
      render: (value: string) => value ? t('search-record.source_' + value) : "-",
    }] : []),
    {
      title: t("search-record.question"),
      dataIndex: "original_question",
      key: "original_question",
      ellipsis: true,
      width: 200,
    },
    {
      title: t("search-record.answer"),
      dataIndex: "answer",
      key: "answer",
      ellipsis: true,
      width: 240,
    },
    {
      title: t("search-record.status"),
      dataIndex: "response_status_value",
      key: "response_status_value",
      width: 80,
      render: (text: string, row: any) => (
        <Tag
          color={
            row.response_status === RESPONSE_STATUS.NORMAL ? "default" : "error"
          }
        >
          {text}
        </Tag>
      ),
    },
    {
      title: t("search-record.token_consumption"),
      dataIndex: "total_tokens",
      key: "total_tokens",
      width: 100,
      render: (value: number) =>
        value ? (value / 1000).toFixed(1) + "K" : "-",
    },
    {
      title: t("search-record.overall_time"),
      dataIndex: "elapsed_time",
      key: "elapsed_time",
      width: 100,
      render: (value: number) => (value ? `${value}ms` : "-"),
    },
    {
      title: t("search-record.user"),
      dataIndex: "nickname",
      key: "nickname",
      width: 110,
      ellipsis: true,
    },
    {
      title: t("search-record.time"),
      dataIndex: "updated_time",
      key: "updated_time",
      width: 140,
      ellipsis: true,
    },
    {
      title: t("operation"),
      key: "operation",
      width: 60,
      render: (_: any, record: RecordDisplayItem, index: number) => (
        <Button
          type="link"
          className="invisible group-hover:visible hover:!text-brand"
          icon={<SvgIcon name="view" />}
          onClick={(e) => {
            e.stopPropagation();
            handleOpenDetail(index);
          }}
        />
      ),
    },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex justify-between items-center">
        <div>
          <span className="text-lg">{t("work_ai.data_statistics")}</span>
        </div>
        <div className="flex-none">
          <DateRangeFilter
            value={statisticsDateValue}
            valueFormat={(date: Date) => new Date(date).getTime()}
            onChange={(value) => {
              if (value && value.length === 2) {
                setStatisticsDateValue(value as [number, number]);
                loadRecordStats();
              }
            }}
          />
        </div>
      </div>
      <div className="flex gap-5 mt-5">
        {Object.entries(recordList).map(([type, item]) => (
          <div
            key={item.label}
            className="bg-[#FAFAFA] p-4 flex-1 rounded-md cursor-pointer hover:shadow-md"
            onClick={() => handleChangeRecordType(type)}
          >
            <div className="flex items-center">
              <div
                className="w-10 h-10 rounded-[50%] flex justify-center items-center"
                style={{ background: item.bg, color: item.color }}
              >
                <SvgIcon name={item.svg} />
              </div>
              <span className="ml-2 mr-1 text-primary text-sm">
                {item.label}
              </span>
              <Tooltip title={item.tip} placement="top">
                <span className="cursor-pointer">
                  <SvgIcon name="tip" color="#b6b5b5" width="12px" />
                </span>
              </Tooltip>
            </div>
            <div className="mt-4">
              <span className="text-2xl font-medium mr-1">{item.value} </span>
              <span className="text-sm">{item.unit}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8 text-lg">{t("work_ai.data_details")}</div>
      <div className="mt-5">
        <div className="flex items-center gap-2 mb-4">
          {showSourceFilter && (
            <Select
              value={detailedForm.source}
              className="flex-none w-[190px]"
              allowClear
              onChange={(value) => {
                const newForm = { ...detailedForm, source: value || null };
                setDetailedForm(newForm);
                handleFilterChange(newForm);
                loadRecordStats(value || null);
              }}
              prefix={<span className="text-placeholder">{t("search-record.source") + ":"}</span>}
              placeholder={t("search-record.source")}
              options={[
                { label: t("search-record.all"), value: null },
                { label: t("search-record.source_h5"), value: SOURCE_TYPE.H5 },
                { label: t("search-record.source_api"), value: SOURCE_TYPE.API },
                { label: t("search-record.source_web"), value: SOURCE_TYPE.WEB },
                { label: t("search-record.source_console"), value: SOURCE_TYPE.CONSOLE },
              ]}
            />
          )}
          <div className="flex-none">
            <DateRangeFilter
              value={detailedDateValue}
              valueFormat={(date: Date) => new Date(date).getTime()}
              isCleared={isCleared}
              onChange={(value) => {
                if (value && value.length === 2) {
                  const newDates = value as [number, number];
                  setDetailedDateValue(newDates);
                  handleFilterChange(detailedForm, newDates);
                } else {
                  // 清空时重置为默认日期范围并触发查询
                  setDetailedDateValue(getDefaultDateRange());
                  handleFilterChange(detailedForm, getDefaultDateRange());
                }
              }}
            />
          </div>
          <Search
            mode="expanded"
            value={detailedForm.keyword || ""}
            onDebouncedChange={(val) => {
              const newForm = { ...detailedForm, keyword: val };
              setDetailedForm(newForm);
              handleFilterChange(newForm, detailedDateValue);
            }}
            placeholder={t("action_search")}
            className="w-[240px]"
          />
          {
            showStatusFilter && (<Select
            value={detailedForm.response_status}
            className="flex-none max-w-[140px]"
            allowClear
            onChange={(value) => {
              const newForm = { ...detailedForm, response_status: value || 0 };
              setDetailedForm(newForm);
              handleFilterChange(newForm);
            }}
            prefix={
              <span className="text-[rgb(168_171_178)]">
                {t("search-record.status")}:
              </span>
            }
            options={[
              { label: t("search-record.all"), value: 0 },
              {
                label: t("search-record.normal"),
                value: RESPONSE_STATUS.NORMAL,
              },
              {
                label: t("search-record.refused"),
                value: RESPONSE_STATUS.REFUSED,
              },
            ]}
          />)
          }
          {
            showCleanFilter && (
              <Button
                className="border-none px-3"
                type={isClearIconAvailable ? "primary" : "default"}
                disabled={!isClearIconAvailable}
                onClick={handleClear}
              >
                <SvgIcon name="clear" size="16px" />
              </Button>
            )
          }
        </div>
        <Spin spinning={tableLoading}>
          <div className="flex-1 overflow-y-auto bg-white rounded-lg mt-4">
            <Table
              rowKey="id"
              columns={columns}
              dataSource={tableData}
              total={tableTotal}
              style={{ width: "100%" }}
              rowClassName="group cursor-pointer"
              onRow={(record) => ({
                onClick: () => onRowClick(record),
              })}
              pagination={{
                total: tableTotal,
                pageSize: detailedForm.limit,
                current: Math.floor(detailedForm.offset / detailedForm.limit) + 1,
                showSizeChanger: true,
                showTotal: (total) => t("table_footer_text", { total }),
                onChange: (page, pageSize) => {
                  if (pageSize !== detailedForm.limit) {
                    handleSizeChange(pageSize);
                  } else {
                    handleCurrentChange(page);
                  }
                },
              }}
            />
          </div>
        </Spin>
      </div>
      <Detail ref={detailRef} />
    </div>
  );
};

export default WorkAIStatistic;
