import { useState, useEffect, useRef } from "react";
import { Table, Button, Tooltip } from "antd";
import { t } from "@/locales";
import { SvgIcon, Search } from "@km/shared-components-react";
import FilterDateRange from "@/components/Filter/date-range";
import { getLastTimeAsDay } from "@km/shared-utils";
import recordApi from "@/api/modules/record/index";
import { userApi } from "@/api/modules/user";
import RecordDetail from "@/views/search/components/detail";
import { SEARCH_TYPE } from "@/api/modules/feedback/types";

interface StatisticProps {
  agentId?: string | number;
}

export default function Statistic({ agentId }: StatisticProps) {
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
  const [recordList, setRecordList] = useState<any>({
    generate_count: {
      label: t("search-record.generate_count"),
      bg: "#C2F2D5",
      svg: "search-count",
      tip: t("search-record.generate_count_tip"),
      value: "---",
      unit: t("search-record.total_count_unit"),
    },
    query_count: {
      label: t("search-record.query_count"),
      bg: "#FFEBEB",
      svg: "no-content",
      tip: t("search-record.query_count_tip"),
      value: "---",
      unit: t("search-record.total_count_unit"),
    },
  });

  const [detailedForm, setDetailedForm] = useState({
    start_time: null as number | null,
    end_time: null as number | null,
    file_keyword: "",
    thinking_mode: 0,
    response_status: 0,
    knowledge_type: 0,
    offset: 0,
    limit: 10,
  });

  const [tableData, setTableData] = useState<any[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  const [isCleared, setIsCleared] = useState(false);
  const userListRef = useRef<Record<number, string>>({});
  const recordDetailRef = useRef<any>(null);

  const loadRecordStats = async (dates = statisticsDate) => {
    if (!dates || dates.length === 0) return;
    const recordStats = await recordApi.getKnowledgeMapStats({
      start_date: Math.floor(dates[0] / 1000),
      end_date: Math.floor(dates[1] / 1000),
    });
    setRecordList((prev: any) => ({
      ...prev,
      generate_count: {
        ...prev.generate_count,
        value: recordStats.generate_count,
      },
      query_count: { ...prev.query_count, value: recordStats.query_count },
    }));
  };

  const loadRecordList = async (form = detailedForm, dates = detailedDate) => {
    setTableLoading(true);
    try {
      const list = await recordApi.getMessageList({
        ...form,
        start_date: dates[0],
        end_date: dates[1],
        agent_id: agentId || undefined,
        thinking_mode: form.thinking_mode === 0 ? null : form.thinking_mode,
        response_status:
          form.response_status === 0 ? null : form.response_status,
        knowledge_type: form.knowledge_type === 0 ? null : form.knowledge_type,
      });
      const data = list.messages.map((item: any) => {
        return {
          ...item,
          file_name:
            item.file_name?.replace(/(.*)\.([a-zA-Z0-9]+)\.md$/, "$1.$2") || "",
          nickname: userListRef.current[item.user_id],
        };
      });
      setTableData(data);
      setTableTotal(list.total);
    } finally {
      setTableLoading(false);
    }
  };

  const onRefresh = (newForm = detailedForm, dates = detailedDate) => {
    setDetailedForm({ ...newForm, offset: 0 });
    loadRecordList({ ...newForm, offset: 0 }, dates);
  };

  const loadInternalUser = async () => {
    const { list = [] } = await userApi.fetch_internal_user({
      status: -1,
      offset: 0,
      limit: 999,
    });
    const map: Record<number, string> = {};
    list.forEach((item: any) => {
      map[item.user_id] = item.nickname;
    });
    userListRef.current = map;
  };

  useEffect(() => {
    const init = async () => {
      await loadInternalUser();
      loadRecordStats();
      loadRecordList();
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const handleOpenDetail = (index: number) => {
    recordDetailRef.current?.open({
      index,
      tableData,
      type: SEARCH_TYPE.RECORD,
    });
  };

  const columns = [
    {
      title: t("search-record.document"),
      dataIndex: "file_name",
      ellipsis: true,
      width: 150,
    },
    {
      title: t("search-record.generate_model"),
      dataIndex: "model_name",
      ellipsis: true,
      width: 80,
    },
    {
      title: t("search-record.user"),
      dataIndex: "nickname",
      ellipsis: true,
      width: 110,
    },
    {
      title: t("search-record.time"),
      dataIndex: "updated_time",
      ellipsis: true,
      width: 140,
    },
    {
      title: t("search-record.operation"),
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
          <span className="text-lg">{t("search-record.data_summary")}</span>
        </div>
        <div className="flex-none">
          <FilterDateRange
            value={statisticsDate}
            valueFormat={(date: Date) => date.getTime()}
            onChange={(dates) => {
              setStatisticsDate(dates);
              loadRecordStats(dates);
            }}
          />
        </div>
      </div>
      <div className="flex gap-5 mt-5">
        {Object.entries(recordList).map(([key, item]: [string, any]) => (
          <div key={item.label} className="bg-[#FAFAFA] p-4 flex-1 rounded-md">
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
      <div className="mt-8 text-lg">{t("search-record.detail_list")}</div>
      <div className="mt-5">
        <div className="flex items-center gap-2">
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
            value={detailedForm.file_keyword}
            placeholder={t("search-record.search_document")}
            className="w-[240px]"
            onDebouncedChange={(val) => {
              const newForm = { ...detailedForm, file_keyword: val };
              setDetailedForm(newForm);
              onRefresh(newForm, detailedDate);
            }}
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
                loadRecordList(newForm);
              },
            }}
          />
        </div>
      </div>
      <RecordDetail ref={recordDetailRef} />
    </div>
  );
}
