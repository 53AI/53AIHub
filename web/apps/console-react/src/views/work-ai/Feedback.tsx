import React, { useState, useEffect, useRef, useCallback } from "react";
import { Table, Select, Button, Tag, Spin, Tooltip } from "antd";
import { SvgIcon, Search } from "@km/shared-components-react";
import feedbackApi from "@/api/modules/feedback";
import { DateRangeFilter } from "@/components/Filter/date-range";
import { UserFilter } from "@/components/Filter/user";
import FeedbackConfigDialog from "@/views/search/feedback/FeedbackConfigDialog";
import Detail, { DetailRef } from "@/views/search/components/detail";
import {
    SEARCH_TYPE,
    type FeedbackDisplayItem,
} from "@/api/modules/feedback/types";
import { getLastTimeAsDay } from "@km/shared-utils";
import { useEnterpriseStore } from "@/stores";

interface FeedbackProps {
  agentId?: string | number;
  type?: 'work_ai' | 'chat' | 'workflow';
}

const WorkAIFeedback: React.FC<FeedbackProps> = ({ agentId, type = 'work_ai' }) => {
  const enterpriseStore = useEnterpriseStore();
  const detailRef = useRef<DetailRef>(null);
  const feedbackConfigRef = useRef<any>(null);

  // 防止重复请求的标记
  const loadingRef = useRef({
    status: false,
    config: false,
    list: false,
  });
  // 追踪上次请求的参数，防止相同参数重复请求
  const lastRequestRef = useRef({
    agentId: null as string | number | null,
    statisticsDate: null as [number, number] | null,
    detailedDate: null as [number, number] | null,
    detailedForm: null as any,
  });

  const t = (window as any).$t || ((key: string) => key);

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

  const [feedbackList, setFeedbackList] = useState([
    {
      type: "satisfied",
      label: t("search-feedback.satisfied"),
      bg: "#E0EAFF",
      svg: "satisfied",
      tip: t("search-feedback.satisfied_count"),
      value: 0,
      unit: t("search-record.total_count_unit"),
    },
    {
      type: "unsatisfied",
      label: t("search-feedback.unsatisfied"),
      bg: "#FFEBEB",
      svg: "unsatisfied",
      tip: t("search-feedback.unsatisfied_count"),
      value: 0,
      unit: t("search-record.total_count_unit"),
    },
  ]);

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
  const [configList, setConfigList] = useState<any>(null);
  const [isCleared, setIsCleared] = useState(false);
  const [isClearIconAvailable, setIsClearIconAvailable] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  const openFeedbackConfig = () => {
    feedbackConfigRef.current?.open();
  };

  const loadFeedbackStatus = useCallback(async () => {
    if (!agentId || loadingRef.current.status) return;

    // 检查是否与上次请求参数相同
    const dateKey = `${statisticsDateValue[0]}-${statisticsDateValue[1]}`;
    const agentKey = String(agentId);
    if (
      lastRequestRef.current.agentId === agentKey &&
      lastRequestRef.current.statisticsDate?.[0] === statisticsDateValue[0] &&
      lastRequestRef.current.statisticsDate?.[1] === statisticsDateValue[1]
    ) {
      return;
    }

    loadingRef.current.status = true;
    try {
      const { stats } = await feedbackApi.getFeedbackStatus({
        start_time: statisticsDateValue[0],
        end_time: statisticsDateValue[1],
        agent_id: agentId,
      });
      setFeedbackList((prev) => [
        { ...prev[0], value: stats.satisfied_count },
        { ...prev[1], value: stats.unsatisfied_count },
      ]);
      lastRequestRef.current.agentId = agentKey;
      lastRequestRef.current.statisticsDate = [...statisticsDateValue] as [
        number,
        number,
      ];
    } finally {
      loadingRef.current.status = false;
    }
  }, [agentId, statisticsDateValue]);

  const loadFeedbackConfig = useCallback(async () => {
    if (loadingRef.current.config) return;

    loadingRef.current.config = true;
    try {
      const configData = await feedbackApi.getConfig({
        type,
        eid: enterpriseStore.info.eid,
      });
      const parsedConfig = JSON.parse(configData.value);
      setConfigList(parsedConfig);
      const types = [
        ...new Set([...parsedConfig.satisfied, ...parsedConfig.unsatisfied]),
      ];
      types.unshift(t("search-record.all"));
      if (!types.includes(t("search-feedback.other"))) {
        types.push(t("search-feedback.other"));
      }
      setFeedbackTypeList(types);
      setConfigLoaded(true);
    } finally {
      loadingRef.current.config = false;
    }
  }, [enterpriseStore.info.eid]);

  const loadFeedbackList = useCallback(
    async (form = detailedForm, dates = detailedDateValue) => {
      if (!agentId || !configLoaded || loadingRef.current.list) return;

      // 检查是否与上次请求参数相同
      const formKey = JSON.stringify(form);
      if (
        lastRequestRef.current.detailedDate?.[0] === dates[0] &&
        lastRequestRef.current.detailedDate?.[1] === dates[1] &&
        lastRequestRef.current.detailedForm === formKey
      ) {
        return;
      }

      loadingRef.current.list = true;
      setTableLoading(true);
      try {
        const list = await feedbackApi.getFeedbackList({
          ...form,
          agent_id: agentId,
          start_time: dates[0],
          end_time: dates[1],
          question: form.question || null,
          feedback_type:
            form.feedback_type === t("search-record.all")
              ? null
              : form.feedback_type,
          reason: form.reason === t("search-record.all") ? null : form.reason,
          user_id: form.user_id.length
            ? form.user_id.map((item: any) => item.user_id).join(",")
            : undefined,
          offset: form.offset,
          limit: form.limit,
        });
        setTableData(list.feedbacks || []);
        setTableTotal(list.total || 0);
        lastRequestRef.current.detailedDate = [...dates] as [number, number];
        lastRequestRef.current.detailedForm = formKey;
      } finally {
        loadingRef.current.list = false;
        setTableLoading(false);
        setIsCleared(false);
      }
    },
    [agentId, configLoaded, detailedForm, detailedDateValue],
  );

  const onRefresh = (newForm = detailedForm, dates = detailedDateValue) => {
    // 清除缓存的请求参数，强制重新请求
    lastRequestRef.current.detailedForm = null;
    setDetailedForm({ ...newForm, offset: 0 });
    loadFeedbackList({ ...newForm, offset: 0 }, dates);
  };

  const handleFilterChange = (
    newForm = detailedForm,
    dates = detailedDateValue,
  ) => {
    setIsClearIconAvailable(true);
    onRefresh(newForm, dates);
  };

  const handleSizeChange = (size: number) => {
    lastRequestRef.current.detailedForm = null;
    const newForm = { ...detailedForm, limit: size, offset: 0 };
    setDetailedForm(newForm);
    loadFeedbackList(newForm);
  };

  const handleCurrentChange = (page: number) => {
    lastRequestRef.current.detailedForm = null;
    const newForm = {
      ...detailedForm,
      offset: (page - 1) * detailedForm.limit,
    };
    setDetailedForm(newForm);
    loadFeedbackList(newForm);
  };

  const handleChangeFeedbackType = (type: string) => {
    const newDates = [...statisticsDateValue] as [number, number];
    const newForm = {
      ...detailedForm,
      question: null,
      user_id: [],
      reason: t("search-record.all"),
      feedback_type: type,
      offset: 0,
    };
    setIsClearIconAvailable(true);
    setIsCleared(true);
    setDetailedDateValue(newDates);
    lastRequestRef.current.detailedForm = null;
    setDetailedForm(newForm);
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
    setDetailedDateValue(newDates);
    lastRequestRef.current.detailedForm = null;
    setDetailedForm(newForm);
    setIsCleared(true);
    setIsClearIconAvailable(false);
    loadFeedbackList(newForm, newDates);
  };

  const handleOpenDetail = (index: number) => {
    detailRef.current?.open({
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

  // 初始化加载：只在 agentId 有效时执行
  useEffect(() => {
    if (!agentId) return;
    loadFeedbackStatus();
    loadFeedbackConfig();
  }, [agentId, loadFeedbackStatus, loadFeedbackConfig]);

  // 日期变化时重新加载统计数据
  useEffect(() => {
    if (!agentId) return;
    loadFeedbackStatus();
  }, [statisticsDateValue, agentId, loadFeedbackStatus]);

  // 筛选条件变化时重新加载列表
  useEffect(() => {
    if (!agentId || !configLoaded) return;
    loadFeedbackList();
  }, [
    detailedForm,
    detailedDateValue,
    agentId,
    configLoaded,
    loadFeedbackList,
  ]);

  const columns = [
    {
      title: t("search-record.question"),
      dataIndex: "original_question",
      key: "original_question",
      ellipsis: true,
      width: 160,
    },
    {
      title: t("search-feedback.feedback"),
      dataIndex: "feedback_type",
      key: "feedback_type",
      ellipsis: true,
      width: 80,
      render: (type: string) => (
        <Tag color={type === "satisfied" ? "blue" : "red"}>
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
      width: 120,
    },
    {
      title: t("search-feedback.description"),
      dataIndex: "description",
      key: "description",
      ellipsis: true,
      width: 140,
    },
    {
      title: t("search-feedback.user"),
      dataIndex: "nickname",
      key: "nickname",
      ellipsis: true,
      width: 120,
    },
    {
      title: t("search-feedback.time"),
      dataIndex: "updated_time",
      key: "updated_time",
      ellipsis: true,
      width: 140,
    },
    {
      title: t("operation"),
      key: "operation",
      width: 60,
      render: (_: any, record: FeedbackDisplayItem, index: number) => (
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
          <span className="text-lg">{t("search-feedback.statistics")}</span>
        </div>
        <div className="flex-none flex items-center gap-2">
          <Button onClick={openFeedbackConfig}>
            <SvgIcon name="feedback-config" width="14px" className="mr-[2px]" />
            {t("search-feedback.config")}
          </Button>
          <DateRangeFilter
            value={statisticsDateValue}
            valueFormat={(date: Date) => new Date(date).getTime()}
            onChange={(value) => {
              if (value && value.length === 2) {
                setStatisticsDateValue(value as [number, number]);
              }
            }}
          />
        </div>
      </div>
      <div className="flex gap-5 mt-5">
        {feedbackList.map((item) => (
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
      <div className="mt-8 text-lg">{t("search-feedback.detail")}</div>
      <div className="mt-5">
        <div className="flex items-center gap-2">
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
            value={detailedForm.question || ""}
            onDebouncedChange={(val) => {
              const newForm = { ...detailedForm, question: val || null };
              setDetailedForm(newForm);
              handleFilterChange(newForm, detailedDateValue);
            }}
            placeholder={t("search-record.search_question")}
            className="w-[240px]"
          />
          <Select
            value={detailedForm.feedback_type}
            className="flex-none max-w-[180px]"
            allowClear
            onChange={(value) => {
              const newForm = {
                ...detailedForm,
                feedback_type: value || t("search-record.all"),
              };
              setDetailedForm(newForm);
              handleFilterChange(newForm);
            }}
            prefix={
              <span className="text-[rgb(168_171_178)]">
                {t("search-feedback.feedback_type")}:
              </span>
            }
            options={[
              { label: t("search-record.all"), value: t("search-record.all") },
              { label: t("search-feedback.satisfied"), value: "satisfied" },
              { label: t("search-feedback.unsatisfied"), value: "unsatisfied" },
            ]}
          />
          <UserFilter
            value={detailedForm.user_id}
            className="flex-none max-w-[180px]"
            isCleared={isCleared}
            onChange={(value) => {
              const newForm = { ...detailedForm, user_id: value };
              setDetailedForm(newForm);
              handleFilterChange(newForm);
            }}
          />
          <Select
            value={detailedForm.reason}
            className="flex-none max-w-[180px]"
            allowClear
            onChange={(value) => {
              const newForm = {
                ...detailedForm,
                reason: value || t("search-record.all"),
              };
              setDetailedForm(newForm);
              handleFilterChange(newForm);
            }}
            prefix={
              <span className="text-[rgb(168_171_178)]">
                {t("search-feedback.question_type")}:
              </span>
            }
            options={feedbackTypeList.map((item) => ({
              label: item,
              value: item,
            }))}
          />
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
                current:
                  Math.floor(detailedForm.offset / detailedForm.limit) + 1,
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
      <FeedbackConfigDialog ref={feedbackConfigRef} type={type} />
      <Detail ref={detailRef} />
    </div>
  );
};

export default WorkAIFeedback;
