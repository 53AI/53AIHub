import { useState, useEffect, useRef } from "react";
import { Table, Button, Tooltip, Select, Tag } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import { t } from "@/locales";
import FilterDateRange from "@/components/Filter/date-range";
import { UserFilter } from "@/components/Filter/user";
import { getLastTimeAsDay } from "@km/shared-utils";
import feedbackApi from "@/api/modules/feedback/index";
import { SEARCH_TYPE } from "@/api/modules/feedback/types";
import { useEnterpriseStore } from "@/stores/modules/enterprise";
import FeedbackDetail from "@/views/search/components/detail";
import FeedbackConfigDialog from "@/views/search/feedback/FeedbackConfigDialog";
import { SvgIcon, Search } from "@km/shared-components-react";

interface FeedbackProps {
  agentId?: string | number;
}

export default function Feedback({ agentId }: FeedbackProps) {
  const enterpriseStore = useEnterpriseStore();
  // 获取默认日期范围的辅助函数
  const getDefaultDateRange = (): number[] => {
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    return [
      new Date(getLastTimeAsDay(7, "YYYY-MM-DD hh:mm", "start")).getTime(),
      endDate.getTime(),
    ];
  };
  const [statisticsDate, setStatisticsDate] =
    useState<number[]>(getDefaultDateRange);
  const [detailedDate, setDetailedDate] =
    useState<number[]>(getDefaultDateRange);

  const [feedbackList, setFeedbackList] = useState<any[]>([
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
    question: "",
    feedback_type: t("search-record.all"),
    user_id: [] as any[],
    reason: t("search-record.all"),
    offset: 0,
    limit: 10,
  });

  const [feedbackTypeList, setFeedbackTypeList] = useState<string[]>([]);
  const [tableData, setTableData] = useState<any[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  const [isCleared, setIsCleared] = useState(false);

  const feedbackConfigRef = useRef<any>(null);
  const feedbackDetailRef = useRef<any>(null);
  const configListRef = useRef<any>(null);

  const openFeedbackConfig = () => {
    feedbackConfigRef.current?.open();
  };

  const loadFeedbackStatus = async (dates = statisticsDate) => {
    const { stats } = await feedbackApi.getFeedbackStatus({
      start_time: dates[0],
      end_time: dates[1],
      agent_id: agentId || null,
    });
    setFeedbackList((prev) => {
      const newList = [...prev];
      newList[0].value = stats.satisfied_count;
      newList[1].value = stats.unsatisfied_count;
      return newList;
    });
  };

  const loadFeedbackConfig = async () => {
    const configData = await feedbackApi.getConfig({
      eid: enterpriseStore.info.eid,
      type: "knowledge_map",
    });
    const configList = JSON.parse(configData.value);
    configListRef.current = configList;
    const types = [
      ...new Set([...configList.satisfied, ...configList.unsatisfied]),
    ];
    types.unshift(t("search-record.all"));
    if (!types.includes(t("search-feedback.other"))) {
      types.push(t("search-feedback.other"));
    }
    setFeedbackTypeList(types);
  };

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
        user_id: form.user_id.length
          ? form.user_id.map((item) => item.user_id).join(",")
          : undefined,
      });
      const data = list.feedbacks.map((item: any) => {
        return {
          ...item,
          file_name: item.question.replace(
            /(.*)\.([a-zA-Z0-9]+)\.md$/,
            "$1.$2",
          ),
        };
      });
      setTableData(data);
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

  const handleChangeFeedbackType = (type: string) => {
    const newForm = {
      ...detailedForm,
      question: "",
      user_id: [],
      reason: t("search-record.all"),
      feedback_type: type,
    };
    setIsCleared(true);
    setDetailedDate([...statisticsDate]);
    onRefresh(newForm, [...statisticsDate]);
  };

  const handleClear = () => {
    const newDates = getDefaultDateRange();
    const newForm = {
      ...detailedForm,
      question: "",
      feedback_type: t("search-record.all"),
      user_id: [],
      reason: t("search-record.all"),
    };
    setIsCleared(true);
    setDetailedDate(newDates);
    onRefresh(newForm, newDates);
  };

  const handleOpenDetail = (index: number) => {
    feedbackDetailRef.current?.open({
      index,
      tableData,
      type: SEARCH_TYPE.FEEDBACK,
    });
  };

  useEffect(() => {
    const init = async () => {
      await loadFeedbackStatus();
      await loadFeedbackConfig();
      await loadFeedbackList();
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const columns = [
    {
      title: t("search-record.document"),
      dataIndex: "file_name",
      ellipsis: true,
      width: 160,
    },
    {
      title: t("search-record.model"),
      dataIndex: "model_name",
      ellipsis: true,
      width: 170,
    },
    {
      title: t("search-feedback.feedback"),
      dataIndex: "feedback_type",
      width: 80,
      render: (text: string) => (
        <Tag color={text === "satisfied" ? "blue" : "error"}>
          {text === "satisfied"
            ? t("search-feedback.satisfied")
            : t("search-feedback.unsatisfied")}
        </Tag>
      ),
    },
    {
      title: t("search-feedback.question_type"),
      dataIndex: "reason",
      ellipsis: true,
      width: 120,
    },
    {
      title: t("search-feedback.description"),
      dataIndex: "description",
      ellipsis: true,
      width: 140,
    },
    {
      title: t("search-feedback.user"),
      dataIndex: "nickname",
      ellipsis: true,
      width: 120,
    },
    {
      title: t("search-feedback.time"),
      dataIndex: "updated_time",
      ellipsis: true,
      width: 140,
    },
    {
      title: t("operation"),
      width: 60,
      render: (_: any, __: any, index: number) => (
        <Button
          type="text"
          className="invisible group-hover:visible hover:text-brand"
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
        <div className="flex-none flex items-center">
          <Button
            className="mr-2"
            onClick={openFeedbackConfig}
            icon={<SettingOutlined />}
          >
            {t("search-feedback.config")}
          </Button>
          <FilterDateRange
            value={statisticsDate}
            valueFormat={(date: Date) => date.getTime()}
            onChange={(dates) => {
              setStatisticsDate(dates);
              loadFeedbackStatus(dates);
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
                <SvgIcon name={item.svg} width="14" />
              </div>
              <span className="ml-2 mr-1 text-primary text-sm">
                {item.label}
              </span>
              <Tooltip title={item.tip}>
                <span className="cursor-pointer">
                  <SvgIcon name="tip" color="#b6b5b5" width="12" />
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
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex-none">
            <FilterDateRange
              value={detailedDate}
              valueFormat={(date: Date) => date.getTime()}
              isCleared={isCleared}
              onChange={(dates) => {
                if (dates && dates.length === 2) {
                  setDetailedDate(dates);
                  onRefresh(detailedForm, dates);
                } else {
                  // 清空时重置为默认日期范围并触发查询
                  setDetailedDate(getDefaultDateRange());
                  onRefresh(detailedForm, getDefaultDateRange());
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
              onRefresh(newForm, detailedDate);
            }}
          />
          <Select
            value={detailedForm.feedback_type}
            className="flex-none min-w-[180px]"
            allowClear
            onChange={(val) =>
              onRefresh({
                ...detailedForm,
                feedback_type: val || t("search-record.all"),
              })
            }
            options={[
              { label: t("search-record.all"), value: t("search-record.all") },
              { label: t("search-feedback.satisfied"), value: "satisfied" },
              { label: t("search-feedback.unsatisfied"), value: "unsatisfied" },
            ]}
          />
          <UserFilter
            value={detailedForm.user_id}
            className="flex-none min-w-[180px]"
            type="user"
            isCleared={isCleared}
            onChange={(val) => onRefresh({ ...detailedForm, user_id: val })}
          />
          <Select
            value={detailedForm.reason}
            className="flex-none min-w-[180px]"
            allowClear
            onChange={(val) =>
              onRefresh({
                ...detailedForm,
                reason: val || t("search-record.all"),
              })
            }
            options={feedbackTypeList.map((item) => ({
              label: item,
              value: item,
            }))}
          />
          <Button
            type="text"
            onClick={handleClear}
            icon={<SvgIcon name="clear" width="16" />}
          />
        </div>
        <div className="flex-1 overflow-y-auto bg-white rounded-lg mt-4">
          <Table
            loading={tableLoading}
            dataSource={tableData}
            columns={columns}
            rowKey="id"
            rowClassName={() => "group cursor-pointer"}
            onRow={(_, index) => ({
              onClick: () => {
                if (index !== undefined) {
                  handleOpenDetail(index);
                }
              },
            })}
            pagination={{
              total: tableTotal,
              current: Math.floor(detailedForm.offset / detailedForm.limit) + 1,
              pageSize: detailedForm.limit,
              showTotal: (total) => t("table_footer_text", { total }),
              onChange: (page, pageSize) => {
                const newForm = {
                  ...detailedForm,
                  offset: (page - 1) * pageSize,
                  limit: pageSize,
                };
                setDetailedForm(newForm);
                loadFeedbackList(newForm);
              },
            }}
          />
        </div>
      </div>
      <FeedbackConfigDialog ref={feedbackConfigRef} type="knowledge_map" />
      <FeedbackDetail ref={feedbackDetailRef} />
    </div>
  );
}
