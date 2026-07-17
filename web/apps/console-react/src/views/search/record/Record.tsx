import { Table, Button, Tag, Tooltip, Select, Spin } from "antd";
import { useEffect, useState, useRef } from "react";
import { t } from "@/locales";
import recordApi from "@/api/modules/record";
import userApi from "@/api/modules/user";
import { SvgIcon, Search } from "@km/shared-components-react";
import Detail, { DetailRef } from "../components/detail";
import { SEARCH_TYPE } from "@/api/modules/feedback/types";
import {
    type RecordDisplayItem,
    THINKING_MODE,
    RESPONSE_STATUS,
    KNOWLEDGE_TYPE,
} from "@/api/modules/record/types";
import { DateRangeFilter } from "@/components/Filter/date-range";
import { getLastTimeAsDay } from "@km/shared-utils";

interface RecordProps {
  agentId?: string | number;
}

export function Record({ agentId }: RecordProps) {
  // 获取默认日期范围的辅助函数
  const getDefaultDateRange = (): [number, number] => {
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    return [
      new Date(getLastTimeAsDay(7, "YYYY-MM-DD hh:mm", "start")).getTime(),
      endDate.getTime(),
    ];
  };
  const [statisticsDate, setStatisticsDate] =
    useState<[number, number]>(getDefaultDateRange);
  const [detailedDate, setDetailedDate] =
    useState<[number, number]>(getDefaultDateRange);

  const [recordListValues, setRecordListValues] = useState({
    total_questions: "---",
    no_search_results: "---",
    quick_answers: "---",
    deep_thinking: "---",
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
  });

  const [tableData, setTableData] = useState<RecordDisplayItem[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  const detailRef = useRef<DetailRef>(null);
  const [isCleared, setIsCleared] = useState(false);
  const userListRef = useRef<Record<number, string>>({});
  const [isClearIconAvailable, setIsClearIconAvailable] = useState(false);

  // 获取统计数据、数据统计时间
  const loadRecordStats = async () => {
    if (!statisticsDate || statisticsDate.length === 0) return;
    const recordStats = await recordApi.getMessageStats({
      start_date: Math.floor(statisticsDate[0] / 1000),
      end_date: Math.floor(statisticsDate[1] / 1000),
      agent_id: agentId || undefined,
    });
    setRecordListValues({
      total_questions: recordStats.total_questions,
      no_search_results: recordStats.no_search_results,
      quick_answers: recordStats.quick_answers,
      deep_thinking: recordStats.deep_thinking,
    });
  };

  // 获取记录列表
  const loadRecordList = async (form = detailedForm, dates = detailedDate) => {
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
      });
      setTableData(
        list.messages.map((item) => {
          return {
            ...item,
            nickname: userListRef.current[item.user_id],
          };
        }),
      );
      setTableTotal(list.total);
    } finally {
      setTableLoading(false);
    }
  };

  const onRefresh = (newForm = detailedForm, dates = detailedDate) => {
    setDetailedForm({ ...newForm, offset: 0 });
    loadRecordList({ ...newForm, offset: 0 }, dates);
  };

  const handleFilterChange = (newForm = detailedForm, dates = detailedDate) => {
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
    };
    setDetailedDate(newDates);
    setDetailedForm(newForm);
    setIsCleared(true);
    setIsClearIconAvailable(false);
    loadRecordList(newForm, newDates);
  };

  const handleChangeRecordType = (type: string) => {
    if (type !== "total_questions") {
      setIsClearIconAvailable(true);
    }
    const newDates = [...statisticsDate] as [number, number];
    const newForm = {
      ...detailedForm,
      keyword: "",
      thinking_mode: 0,
      response_status: 0,
      knowledge_type: 0,
      offset: 0,
      limit: 10,
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
    setDetailedForm(newForm);
    setIsCleared(true);
    setDetailedDate(newDates);
    loadRecordList(newForm, newDates);
  };

  // 详情
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

  useEffect(() => {
    loadInternalUser().then(() => {
      loadRecordStats();
      loadRecordList();
    });
  }, []);

  const columns = [
    {
      title: t("search-record.question"),
      dataIndex: "original_question",
      key: "original_question",
      ellipsis: true,
    },
    {
      title: t("search-record.thinking_way"),
      dataIndex: "thinking_mode_value",
      key: "thinking_mode_value",
      ellipsis: true,
    },
    {
      title: t("search-record.model"),
      dataIndex: "model_name",
      key: "model_name",
      ellipsis: true,
    },
    {
      title: t("search-record.answer_status"),
      dataIndex: "response_status_value",
      key: "response_status_value",
      ellipsis: true,
      render: (text: string, row: RecordDisplayItem) => (
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
      title: t("search-record.knowledge_scope"),
      dataIndex: "knowledge_type_value",
      key: "knowledge_type_value",
      ellipsis: true,
    },
    {
      title: t("search-record.quoted_count"),
      dataIndex: "citation_count",
      key: "citation_count",
      ellipsis: true,
    },
    {
      title: t("search-record.user"),
      dataIndex: "nickname",
      key: "nickname",
      ellipsis: true,
    },
    {
      title: t("search-record.time"),
      dataIndex: "updated_time",
      key: "updated_time",
      ellipsis: true,
    },
    {
      title: t("operation"),
      key: "operation",
      width: 60,
      render: (_: any, __: RecordDisplayItem, index: number) => (
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

  const recordListArray = [
    {
      type: "total_questions",
      label: t("search-record.total_count"),
      bg: "#C2F2D5",
      svg: "search-count",
      tip: t("search-record.search_count_tip"),
      value: recordListValues.total_questions,
      unit: t("search-record.total_count_unit"),
    },
    {
      type: "no_search_results",
      label: t("search-record.no_content"),
      bg: "#FFEBEB",
      svg: "no-content",
      tip: t("search-record.no_content_tip"),
      value: recordListValues.no_search_results,
      unit: t("search-record.total_count_unit"),
    },
    {
      type: "quick_answers",
      label: t("search-record.quick_answer"),
      bg: "#E0EAFF",
      svg: "quick-answer",
      tip: t("search-record.quick_answer_tip"),
      value: recordListValues.quick_answers,
      unit: t("search-record.total_count_unit"),
    },
    {
      type: "deep_thinking",
      label: t("search-record.deep_think"),
      bg: "#FFE5B0",
      svg: "deep-think",
      tip: t("search-record.deep_think_tip"),
      value: recordListValues.deep_thinking,
      unit: t("search-record.total_count_unit"),
    },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex justify-between items-center">
        <div>
          <span className="text-lg">{t("search-record.statistics")}</span>
        </div>
        <div className="flex-none">
          <DateRangeFilter
            value={statisticsDate}
            valueFormat={(date: Date) => new Date(date).getTime()}
            onChange={(val) => {
              setStatisticsDate(val as [number, number]);
              loadRecordStats();
            }}
          />
        </div>
      </div>
      <div className="flex gap-5 mt-5">
        {recordListArray.map((item) => (
          <div
            key={item.type}
            className="bg-[#FAFAFA] p-4 flex-1 rounded-md cursor-pointer hover:shadow-md"
            onClick={() => handleChangeRecordType(item.type)}
          >
            <div className="flex items-center">
              <div
                className="w-10 h-10 rounded-[50%] flex justify-center items-center"
                style={{ backgroundColor: item.bg }}
              >
                <SvgIcon name={item.svg} />
              </div>
              <span className="ml-2 mr-1 text-primary text-sm">
                {item.label}
              </span>
              <Tooltip title={item.tip}>
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
      <div className="mt-8 text-lg">{t("search-record.detail")}</div>
      <div className="mt-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex-none">
            <DateRangeFilter
              value={detailedDate}
              isCleared={isCleared}
              valueFormat={(date: Date) => new Date(date).getTime()}
              onChange={(val) => {
                if (val && val.length === 2) {
                  const newDates = val as [number, number];
                  setDetailedDate(newDates);
                  handleFilterChange(detailedForm, newDates);
                } else {
                  // 清空时重置为默认日期范围并触发查询
                  setDetailedDate(getDefaultDateRange());
                  handleFilterChange(detailedForm, getDefaultDateRange());
                }
              }}
            />
          </div>
          <Search
            mode="expanded"
            value={detailedForm.keyword}
            placeholder={t("search-record.search_question")}
            className="w-[240px]"
            onDebouncedChange={(val) => {
              const newForm = { ...detailedForm, keyword: val };
              setDetailedForm(newForm);
              handleFilterChange(newForm, detailedDate);
            }}
          />
          <Select
            value={detailedForm.thinking_mode}
            className="flex-none min-w-[180px]"
            allowClear
            onChange={(val) => {
              const newForm = { ...detailedForm, thinking_mode: val || 0 };
              setDetailedForm(newForm);
              handleFilterChange(newForm);
            }}
            placeholder={`${t("search-record.thinking_way")}:`}
          >
            <Select.Option value={0}>{t("search-record.all")}</Select.Option>
            <Select.Option value={THINKING_MODE.QUICK_ANSWER}>
              {t("search-record.quick_answer")}
            </Select.Option>
            <Select.Option value={THINKING_MODE.DEEP_THINKING}>
              {t("search-record.deep_think")}
            </Select.Option>
          </Select>
          <Select
            value={detailedForm.response_status}
            className="flex-none min-w-[180px]"
            allowClear
            onChange={(val) => {
              const newForm = { ...detailedForm, response_status: val || 0 };
              setDetailedForm(newForm);
              handleFilterChange(newForm);
            }}
            placeholder={`${t("search-record.answer_status")}:`}
          >
            <Select.Option value={0}>{t("search-record.all")}</Select.Option>
            <Select.Option value={RESPONSE_STATUS.NORMAL}>
              {t("search-record.normal")}
            </Select.Option>
            <Select.Option value={RESPONSE_STATUS.REFUSED}>
              {t("search-record.refused")}
            </Select.Option>
          </Select>
          <Select
            value={detailedForm.knowledge_type}
            className="flex-none min-w-[180px]"
            allowClear
            onChange={(val) => {
              const newForm = { ...detailedForm, knowledge_type: val || 0 };
              setDetailedForm(newForm);
              handleFilterChange(newForm);
            }}
            placeholder={`${t("search-record.knowledge_scope")}:`}
          >
            <Select.Option value={0}>{t("search-record.all")}</Select.Option>
            <Select.Option value={KNOWLEDGE_TYPE.KNOWLEDGE_BASE}>
              {t("search-record.all_knowledge_base")}
            </Select.Option>
            <Select.Option value={KNOWLEDGE_TYPE.WEB}>
              {t("search-record.online_search")}
            </Select.Option>
            <Select.Option value={KNOWLEDGE_TYPE.SPECIFIED_KNOWLEDGE_BASE}>
              {t("search-record.specified_knowledge_base")}
            </Select.Option>
          </Select>
          <Button
            className="border-none px-3"
            type={isClearIconAvailable ? "primary" : "default"}
            disabled={!isClearIconAvailable}
            onClick={handleClear}
          >
            <SvgIcon name="clear" width="16px" />
          </Button>
        </div>
        <Spin spinning={tableLoading}>
          <div className="flex-1 overflow-y-auto bg-white rounded-lg mt-4">
            <Table
              dataSource={tableData}
              style={{ width: "100%" }}
              onRow={(record) => ({
                className: "group cursor-pointer",
                onClick: () => onRowClick(record),
              })}
              pagination={{
                total: tableTotal,
                pageSize: detailedForm.limit,
                current:
                  Math.floor(detailedForm.offset / detailedForm.limit) + 1,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (total) => t("table_footer_text", { total }),
                onChange: (page, pageSize) => {
                  handleCurrentChange(page);
                  if (pageSize !== detailedForm.limit) {
                    handleSizeChange(pageSize);
                  }
                },
              }}
              columns={columns}
              rowKey="id"
            />
          </div>
        </Spin>
      </div>
      <Detail ref={detailRef} />
    </div>
  );
}

export default Record;
