import { useState, useRef, useCallback, useEffect } from "react";
import { Table, Input, Button, Spin } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import { DateRangeFilter } from "@/components/Filter/date-range";
import { UserFilter } from "@/components/Filter/user";
import { getLastTimeAsDay } from "@km/shared-utils";
import { debounce } from "lodash-es";
import recordingApi from "@/api/modules/recording";
import type { ColumnsType } from "antd/es/table";
import type { DeptMemberPickerValue } from "@/components/DeptMemberPicker";
import type {
    RecordingItemDisplay,
    RecordingStatsDisplay,
} from "@/api/modules/recording/type";

// 获取默认日期范围的辅助函数
const getDefaultDateRange = (): [number, number] => {
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);
  return [
    new Date(getLastTimeAsDay(7, "YYYY-MM-DD hh:mm", "start")).getTime(),
    endDate.getTime(),
  ];
};

export default function Statistic() {
  // 统计数据状态
  const [statisticsDate, setStatisticsDate] =
    useState<[number, number]>(getDefaultDateRange);
  const [statsData, setStatsData] = useState<RecordingStatsDisplay | null>(
    null
  );
  const [statsLoading, setStatsLoading] = useState(false);

  // 明细数据状态
  const [tableData, setTableData] = useState<RecordingItemDisplay[]>([]);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableTotal, setTableTotal] = useState(0);

  // 明细数据默认日期
  const defaultDetailedDate = getDefaultDateRange();

  const [detailedForm, setDetailedForm] = useState({
    start_time: defaultDetailedDate[0],
    end_time: defaultDetailedDate[1],
    keyword: null as string | null,
    user_id: [] as DeptMemberPickerValue[],
    offset: 0,
    limit: 10,
  });
  const [isClearIconAvailable, setIsClearIconAvailable] = useState(false);
  const [isCleared, setIsCleared] = useState(false);

  // 从 detailedForm 派生出 detailedDate
  const detailedDate: [number, number] = [
    detailedForm.start_time,
    detailedForm.end_time,
  ];

  // 加载统计数据
  const loadStatsData = useCallback(
    async (start_time: number, end_time: number) => {
      setStatsLoading(true);
      try {
        const res = await recordingApi.getStats({
          start_time,
          end_time,
        });
        setStatsData(res);
      } catch (error) {
        console.error("Failed to load stats:", error);
      } finally {
        setStatsLoading(false);
      }
    },
    []
  );

  // 加载明细数据
  const loadTableData = useCallback(
    async (params: typeof detailedForm) => {
      setTableLoading(true);
      try {
        // 目前只支持单选
        const user_ids =
          params.user_id.length > 0
            ? params.user_id
                .map((u) => u.user_id)
                .filter(Boolean)
                .join(",")
            : undefined;

        const res = await recordingApi.getRecordings({
          user_ids,
          keyword: params.keyword || undefined,
          start_time: params.start_time,
          end_time: params.end_time,
          offset: params.offset,
          limit: params.limit,
        });
        setTableData(res.items);
        setTableTotal(res.total);
      } catch (error) {
        console.error("Failed to load recordings:", error);
      } finally {
        setTableLoading(false);
      }
    },
    []
  );

  // 使用 ref 存储 debounce 函数
  const debouncedLoadDataRef = useRef(
    debounce((params: typeof detailedForm) => {
      loadTableData(params);
    }, 300)
  );

  // 初始加载标记
  const isInitialMount = useRef(true);

  // 初始加载统计数据
  useEffect(() => {
    const [start_time, end_time] = statisticsDate;
    loadStatsData(start_time, end_time);
  }, []);

  // 监听 detailedForm 变化加载明细数据（包含初始加载）
  useEffect(() => {
    loadTableData(detailedForm);
    isInitialMount.current = false;
  }, [detailedForm.offset, detailedForm.limit]);

  // 清理防抖函数
  useEffect(() => {
    return () => {
      debouncedLoadDataRef.current.cancel();
    };
  }, []);

  const handleRowClick = (record: RecordingItemDisplay) => {
    console.log("View recording:", record);
  };

  const handleFilterChange = (newForm = detailedForm) => {
    setIsClearIconAvailable(true);
    setIsCleared(false);
    const form = { ...newForm, offset: 0 };
    setDetailedForm(form);
    debouncedLoadDataRef.current(form);
  };

  const handleClear = () => {
    if (!isClearIconAvailable) return;
    const [defaultStart, defaultEnd] = getDefaultDateRange();
    const newForm = {
      start_time: defaultStart,
      end_time: defaultEnd,
      keyword: null,
      user_id: [],
      offset: 0,
      limit: 10,
    };
    setDetailedForm(newForm);
    setIsClearIconAvailable(false);
    setIsCleared(true);
    loadTableData(newForm);
  };

  const handleSizeChange = (size: number) => {
    setDetailedForm((prev) => ({ ...prev, limit: size, offset: 0 }));
  };

  const handleCurrentChange = (page: number) => {
    setDetailedForm((prev) => ({
      ...prev,
      offset: (page - 1) * prev.limit,
    }));
  };

  const columns: ColumnsType<RecordingItemDisplay> = [
    {
      title: t("recording.name"),
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      width: 240,
      render: (name: string) => {
        // 去除 .md 后缀
        const displayName = name.endsWith(".md") ? name.slice(0, -3) : name;
        return (
          <div className="flex items-center gap-2">
            <img
              className="flex-none w-6 h-6"
              src={window.$getPublicPath("/images/file/recrod.png")}
              alt=""
            />
            <span className="truncate">{displayName}</span>
          </div>
        );
      },
    },
    {
      title: t("recording.duration"),
      dataIndex: "duration",
      key: "duration",
      width: 120,
    },
    {
      title: t("recording.size"),
      dataIndex: "file_size",
      key: "file_size",
      width: 120,
      render: (fileSize: { value: string; unit: string }) =>
        fileSize ? `${fileSize.value} ${fileSize.unit}` : "---",
    },
    {
      title: t("recording.creator"),
      dataIndex: "creator_name",
      key: "creator_name",
      width: 120,
    },
    {
      title: t("recording.created_time"),
      dataIndex: "created_time",
      key: "created_time",
      width: 180,
    },
    {
      title: t("operation"),
      key: "operation",
      width: 80,
      render: (_: unknown, record: RecordingItemDisplay) => (
        <div className="flex gap-2">
          <Button
            type="link"
            className="invisible hover:!text-brand"
            icon={<SvgIcon name="view" size={16} />}
            onClick={(e) => {
              e.stopPropagation();
              handleRowClick(record);
            }}
          />
          <Button
            type="link"
            className="invisible hover:!text-brand"
            icon={
              <SvgIcon name="delete" size={16} style={{ color: "#999999" }} />
            }
            onClick={(e) => {
              e.stopPropagation();
            }}
          />
        </div>
      ),
    },
  ];

  const statsCards = [
    {
      key: "total_count",
      label: t("recording.total_count"),
      value: statsData?.total_count ?? "---",
      unit: t("recording.count_unit"),
      bg: "#E0EAFF",
      svg: "commit",
      svgColor: "#2563EB",
    },
    {
      key: "disk_storage",
      label: t("recording.disk_storage"),
      value: statsData?.total_file_size?.value ?? "---",
      unit: statsData?.total_file_size?.unit ?? "GB",
      bg: "#C2F2D5",
      svg: "feelgood-one",
      svgColor: "#07C160",
    },
    {
      key: "total_duration",
      label: t("recording.total_duration"),
      value: statsData?.total_duration?.value ?? "---",
      unit: statsData?.total_duration?.unit ?? "小时",
      bg: "#FFE5B0",
      svg: "login_i_vertification",
      svgColor: "#F0A105",
    },
  ];

  return (
    <div className="h-full overflow-y-auto">
      {/* 数据统计 */}
      <div className="flex justify-between items-center">
        <div>
          <span className="text-lg">{t("work_ai.data_statistics")}</span>
        </div>
        <div className="flex-none">
          <DateRangeFilter
            value={statisticsDate}
            valueFormat={(date: Date) => new Date(date).getTime()}
            onChange={(val) => {
              if (val && val.length === 2) {
                const [start, end] = val as [number, number];
                setStatisticsDate([start, end]);
                loadStatsData(start, end);
              }
            }}
          />
        </div>
      </div>
      <Spin spinning={statsLoading}>
        <div className="flex gap-5 mt-5 mb-8">
          {statsCards.map((item) => (
            <div
              key={item.key}
              className="bg-[#FAFAFA] p-4 flex-1 rounded-md"
            >
              <div className="flex items-center">
                <div
                  className="w-10 h-10 rounded-[50%] flex justify-center items-center"
                  style={{ backgroundColor: item.bg }}
                >
                  <SvgIcon name={item.svg} color={item.svgColor} />
                </div>
                <span className="ml-2 mr-1 text-primary text-sm">
                  {item.label}
                </span>
              </div>
              <div className="mt-4">
                <span className="text-2xl font-medium mr-1">{item.value}</span>
                <span className="text-sm">{item.unit}</span>
              </div>
            </div>
          ))}
        </div>
      </Spin>

      {/* 数据明细 */}
      <div className="text-lg mb-4">{t("recording.data_detail")}</div>
      <div className="mb-4">
        <div className="flex items-center gap-4">
          <DateRangeFilter
            value={detailedDate}
            valueFormat={(date: Date) => new Date(date).getTime()}
            onChange={(val) => {
              if (val && val.length === 2) {
                const [start, end] = val as [number, number];
                const newForm = {
                  ...detailedForm,
                  start_time: start,
                  end_time: end,
                };
                handleFilterChange(newForm);
              } else {
                // 清空时设为默认日期
                const [defaultStart, defaultEnd] = getDefaultDateRange();
                const newForm = {
                  ...detailedForm,
                  start_time: defaultStart,
                  end_time: defaultEnd,
                };
                handleFilterChange(newForm);
              }
            }}
          />
          <Input
            placeholder={t("recording.search_name")}
            value={detailedForm.keyword || ""}
            onChange={(e) => {
              const keyword = e.target.value || null;
              const newForm = { ...detailedForm, keyword };
              setDetailedForm(newForm);
              handleFilterChange(newForm);
            }}
            prefix={<SearchOutlined />}
            className="w-60"
            allowClear
            onClear={() => {
              const newForm = { ...detailedForm, keyword: null };
              handleFilterChange(newForm);
            }}
          />
          <UserFilter
            value={detailedForm.user_id}
            onChange={(val) => {
              const newForm = { ...detailedForm, user_id: val };
              handleFilterChange(newForm);
            }}
            isCleared={isCleared}
          />
          <Button
            className={`border-none px-3 ${
              isClearIconAvailable
                ? "!bg-[#2563EB] !text-white"
                : "!bg-gray-100 !text-gray-400"
            }`}
            disabled={!isClearIconAvailable}
            onClick={handleClear}
          >
            <SvgIcon name="clear" size={16} />
          </Button>
        </div>
      </div>

      <Table
        dataSource={tableData}
        columns={columns}
        loading={tableLoading}
        rowKey="id"
        onRow={(record) => ({
          className: "group cursor-pointer",
          onClick: () => handleRowClick(record),
        })}
        pagination={{
          total: tableTotal,
          pageSize: detailedForm.limit,
          current: Math.floor(detailedForm.offset / detailedForm.limit) + 1,
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
      />
    </div>
  );
}
