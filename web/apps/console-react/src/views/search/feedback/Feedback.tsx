import { Table, Button, Tag, Tooltip, Select, Spin } from "antd";
import { useEffect, useState, useRef } from "react";
import { t } from "@/locales";
import { feedbackApi } from "@/api/modules/feedback";
import {
    type FeedbackDisplayItem,
    SEARCH_TYPE,
} from "@/api/modules/feedback/types";
import { SvgIcon, Search } from "@km/shared-components-react";
import Detail, { DetailRef } from "../components/detail";
import FeedbackConfigDialog, {
    FeedbackConfigDialogRef,
} from "./FeedbackConfigDialog";
import { DateRangeFilter } from "@/components/Filter/date-range";
import { UserFilter } from "@/components/Filter/user";
import { getLastTimeAsDay } from "@km/shared-utils";
import { useEnterpriseStore } from "@/stores";

interface FeedbackProps {
  agentId?: string | number;
}

export function Feedback({ agentId }: FeedbackProps) {
  const enterpriseStore = useEnterpriseStore();
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

  const [feedbackListValues, setFeedbackListValues] = useState({
    satisfied: { count: 0 },
    unsatisfied: { count: 0 },
  });

  const [detailedForm, setDetailedForm] = useState({
    start_time: null as number | null,
    end_time: null as number | null,
    question: null as string | null,
    feedback_type: t("search-record.all"),
    user_id: [] as any[],
    reason: t("search-record.all"),
    offset: 0,
    limit: 10,
  });

  const [feedbackTypeList, setFeedbackTypeList] = useState<string[]>([]);
  const [tableData, setTableData] = useState<FeedbackDisplayItem[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  const feedbackConfigRef = useRef<FeedbackConfigDialogRef>(null);
  const feedbackDetailRef = useRef<DetailRef>(null);
  const [configList, setConfigList] = useState<any>(null);
  const [isCleared, setIsCleared] = useState(false);
  const [isClearIconAvailable, setIsClearIconAvailable] = useState(false);

  const openFeedbackConfig = () => {
    feedbackConfigRef.current?.open();
  };

  // 获取反馈满意/不满意次数、数据统计时间
  const loadFeedbackStatus = async () => {
    const { stats } = await feedbackApi.getFeedbackStatus({
      start_time: statisticsDate[0],
      end_time: statisticsDate[1],
      agent_id: agentId || null,
    });
    setFeedbackListValues({
      satisfied: { count: stats.satisfied_count },
      unsatisfied: { count: stats.unsatisfied_count },
    });
  };

  // 获取反馈类型
  const loadFeedbackConfig = async () => {
    const configData = await feedbackApi.getConfig({
      eid: enterpriseStore.info.eid,
    });
    setConfigList(JSON.parse(configData.value));
    const types = [
      ...new Set([
        ...JSON.parse(configData.value).satisfied,
        ...JSON.parse(configData.value).unsatisfied,
      ]),
    ] as string[];
    types.unshift(t("search-record.all"));
    if (!types.includes(t("search-feedback.other"))) {
      types.push(t("search-feedback.other"));
    }
    setFeedbackTypeList(types);
  };

  // 获取反馈列表
  const loadFeedbackList = async (
    form = detailedForm,
    dates = detailedDate,
  ) => {
    setTableLoading(true);
    try {
      const list = await feedbackApi.getFeedbackList({
        ...form,
        agent_id: agentId || null,
        start_time: dates[0],
        end_time: dates[1],
        question: form.question || null,
        feedback_type:
          form.feedback_type === t("search-record.all")
            ? null
            : form.feedback_type,
        reason: form.reason === t("search-record.all") ? null : form.reason,
        user_id:
          form.user_id.length > 0
            ? form.user_id.map((item) => item.user_id).join(",")
            : undefined,
      });
      setTableData(list.feedbacks);
      setTableTotal(list.total);
    } finally {
      setTableLoading(false);
      setIsCleared(false);
    }
  };

  const onRefresh = (newForm = detailedForm, dates = detailedDate) => {
    setDetailedForm({ ...newForm, offset: 0 });
    loadFeedbackList({ ...newForm, offset: 0 }, dates);
  };

  const handleFilterChange = (newForm = detailedForm, dates = detailedDate) => {
    setIsClearIconAvailable(true);
    onRefresh(newForm, dates);
  };

  const handleSizeChange = (size: number) => {
    const newForm = { ...detailedForm, limit: size, offset: 0 };
    setDetailedForm(newForm);
    loadFeedbackList(newForm);
  };

  const handleCurrentChange = (page: number) => {
    const newForm = {
      ...detailedForm,
      offset: (page - 1) * detailedForm.limit,
    };
    setDetailedForm(newForm);
    loadFeedbackList(newForm);
  };

  const handleChangeFeedbackType = (type: string) => {
    const newDates = [...statisticsDate] as [number, number];
    const newForm = {
      ...detailedForm,
      question: null,
      user_id: [],
      reason: t("search-record.all"),
      feedback_type: type,
      offset: 0,
    };
    setIsClearIconAvailable(true);
    setDetailedForm(newForm);
    setIsCleared(true);
    setDetailedDate(newDates);
    loadFeedbackList(newForm, newDates);
  };

  const handleClear = () => {
    if (!isClearIconAvailable) return;
    const newDates = getDefaultDateRange();
    const newForm = {
      start_time: null,
      end_time: null,
      question: null,
      feedback_type: t("search-record.all"),
      user_id: [],
      reason: t("search-record.all"),
      offset: 0,
      limit: 10,
    };
    setDetailedDate(newDates);
    setDetailedForm(newForm);
    setIsCleared(true);
    setIsClearIconAvailable(false);
    loadFeedbackList(newForm, newDates);
  };

  // 详情
  const handleOpenDetail = (index: number) => {
    feedbackDetailRef.current?.open({
      index,
      tableData,
      type: SEARCH_TYPE.FEEDBACK,
    });
  };

  const onRowClick = (row: FeedbackDisplayItem) => {
    const index = tableData.findIndex((item) => item.id === row.id);
    if (index !== -1) {
      handleOpenDetail(index);
    }
  };

  useEffect(() => {
    loadFeedbackStatus();
    loadFeedbackConfig();
    loadFeedbackList();
  }, [agentId]);

  const columns = [
    {
      title: t("search-record.question"),
      dataIndex: "original_question",
      key: "original_question",
      ellipsis: true,
    },
    {
      title: t("search-feedback.feedback"),
      dataIndex: "feedback_type",
      key: "feedback_type",
      ellipsis: true,
      render: (type: string) => (
        <Tag color={type === "satisfied" ? "processing" : "error"}>
          {type === "satisfied"
            ? t("search-feedback.satisfied")
            : t("search-feedback.unsatisfied")}
        </Tag>
      ),
    },
    {
      title: t("search-feedback.question_type"),
      dataIndex: "reason",
      key: "reason",
      ellipsis: true,
    },
    {
      title: t("search-feedback.description"),
      dataIndex: "description",
      key: "description",
      ellipsis: true,
    },
    {
      title: t("search-record.model"),
      dataIndex: "model_name",
      key: "model_name",
      ellipsis: true,
    },
    {
      title: t("search-feedback.user"),
      dataIndex: "nickname",
      key: "nickname",
      ellipsis: true,
    },
    {
      title: t("search-feedback.time"),
      dataIndex: "updated_time",
      key: "updated_time",
      ellipsis: true,
    },
    {
      title: t("operation"),
      key: "operation",
      width: 60,
      render: (_: any, __: FeedbackDisplayItem, index: number) => (
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

  const feedbackListArray = [
    {
      type: "satisfied",
      label: t("search-feedback.satisfied"),
      bg: "#E0EAFF",
      svg: "satisfied",
      tip: t("search-feedback.satisfied_count"),
      value: feedbackListValues.satisfied.count,
      unit: t("search-record.total_count_unit"),
    },
    {
      type: "unsatisfied",
      label: t("search-feedback.unsatisfied"),
      bg: "#FFEBEB",
      svg: "unsatisfied",
      tip: t("search-feedback.unsatisfied_count"),
      value: feedbackListValues.unsatisfied.count,
      unit: t("search-record.total_count_unit"),
    },
  ];

  return (
    <div>
      <div className="flex justify-between items-center">
        <div>
          <span className="text-lg">{t("search-feedback.statistics")}</span>
        </div>
        <div className="flex-none flex items-center gap-2">
          <Button onClick={openFeedbackConfig}>
            <SvgIcon name="feedback-config" width="14px" className="mr-[2px]" />
            {t("search-feedback.config")}
          </Button>
          <DateRangeFilter
            value={statisticsDate}
            valueFormat={(date: Date) => new Date(date).getTime()}
            onChange={(val) => {
              setStatisticsDate(val as [number, number]);
              loadFeedbackStatus();
            }}
          />
        </div>
      </div>
      <div className="flex gap-5 mt-5">
        {feedbackListArray.map((item) => (
          <div
            key={item.label}
            className="bg-[#FAFAFA] p-4 flex-1 rounded-md cursor-pointer hover:shadow-md"
            onClick={() => handleChangeFeedbackType(item.type)}
          >
            <div className="flex items-center">
              <div
                className="w-10 h-10 rounded-[50%] flex justify-center items-center"
                style={{ backgroundColor: item.bg }}
              >
                <SvgIcon name={item.svg} width="14px" />
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
      <div className="mt-8 text-lg">{t("search-feedback.detail")}</div>
      <div className="mt-5">
        <div className="flex items-center gap-2">
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
            value={detailedForm.question || ""}
            placeholder={t("search-record.search_question")}
            className="w-[240px]"
            onDebouncedChange={(val) => {
              const newForm = { ...detailedForm, question: val || null };
              setDetailedForm(newForm);
              handleFilterChange(newForm, detailedDate);
            }}
          />
          <Select
            value={detailedForm.feedback_type}
            className="flex-none min-w-[180px]"
            allowClear
            onChange={(val) => {
              const newForm = {
                ...detailedForm,
                feedback_type: val || t("search-record.all"),
              };
              setDetailedForm(newForm);
              handleFilterChange(newForm);
            }}
            placeholder={`${t("search-feedback.feedback_type")}:`}
          >
            <Select.Option value={t("search-record.all")}>
              {t("search-record.all")}
            </Select.Option>
            <Select.Option value="satisfied">
              {t("search-feedback.satisfied")}
            </Select.Option>
            <Select.Option value="unsatisfied">
              {t("search-feedback.unsatisfied")}
            </Select.Option>
          </Select>
          <UserFilter
            value={detailedForm.user_id}
            onChange={(val) => {
              const newForm = { ...detailedForm, user_id: val };
              setDetailedForm(newForm);
              handleFilterChange(newForm);
            }}
            isCleared={isCleared}
          />
          <Select
            value={detailedForm.reason}
            className="flex-none min-w-[180px]"
            allowClear
            onChange={(val) => {
              const newForm = {
                ...detailedForm,
                reason: val || t("search-record.all"),
              };
              setDetailedForm(newForm);
              handleFilterChange(newForm);
            }}
            placeholder={`${t("search-feedback.question_type")}:`}
          >
            {feedbackTypeList.map((item) => (
              <Select.Option key={item} value={item}>
                {item}
              </Select.Option>
            ))}
          </Select>
          <Button
            className={`border-none px-3 ${isClearIconAvailable ? "!bg-[#2563EB] !text-white" : "!bg-gray-100 !text-gray-400"}`}
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
              total={tableTotal}
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
      <FeedbackConfigDialog ref={feedbackConfigRef} />
      <Detail ref={feedbackDetailRef} />
    </div>
  );
}

export default Feedback;
