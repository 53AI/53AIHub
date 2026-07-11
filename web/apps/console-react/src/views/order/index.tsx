import {
  Table,
  Select,
  Button,
  Tag,
  Tooltip,
  Modal,
  message,
} from "antd";
import { CheckCircleOutlined } from "@ant-design/icons";
import { SvgIcon, Search } from "@km/shared-components-react";
import { useEffect, useState, useRef } from "react";
import { t } from "@/locales";
import { DateRangeFilter } from "@/components/Filter";
import { orderApi } from "@/api/modules/order";
import { ORDER_STATUS, ORDER_STATUS_LABEL_MAP } from "@/constants/order";
import {
  PAYMENT_TYPE,
  PAYMENT_TYPE_LABEL_MAP,
  type PaymentType,
} from "@/constants/payment";
import AddDialog, { AddDialogRef } from "./AddDialog";

const ORDER_STATUS_OPTIONS = [
  ORDER_STATUS.ALL,
  ORDER_STATUS.NOT_CONFIRM,
  ORDER_STATUS.PENDING,
  ORDER_STATUS.PAID,
  ORDER_STATUS.EXPIRED,
  ORDER_STATUS.CANCELLED,
].map((value) => ({
  value,
  label:
    ORDER_STATUS_LABEL_MAP.get(value) ||
    ORDER_STATUS_LABEL_MAP.get(ORDER_STATUS.ALL),
}));

function getPaymentLabel(payType: PaymentType) {
  const label = PAYMENT_TYPE_LABEL_MAP.get(payType);
  return label || "";
}

const ORDER_PAYMENT_TYPE_OPTIONS = [
  PAYMENT_TYPE.ALL,
  PAYMENT_TYPE.WECHAT,
  PAYMENT_TYPE.ALIPAY,
  PAYMENT_TYPE.MANUAL,
].map((value) => ({
  value,
  label: getPaymentLabel(value),
}));

interface OrderItem {
  id: string;
  order_id: string;
  subscription_name: string;
  duration: number;
  time_unit: string;
  amount: number;
  currency: string;
  status: number;
  pay_type: number;
  created_time: string;
  nickname: string;
  user_id: number;
  service_id: string;
}

interface FilterForm {
  status: number;
  pay_type: number;
  keyword: string;
  offset: number;
  limit: number;
  date: number[];
}

export function OrderPage() {
  const addRef = useRef<AddDialogRef>(null);
  const [loading, setLoading] = useState(false);
  const [tableData, setTableData] = useState<OrderItem[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [statusValue, setStatusValue] = useState(ORDER_STATUS.ALL);
  const [payTypeValue, setPayTypeValue] = useState(PAYMENT_TYPE.ALL);
  const [dateValue, setDateValue] = useState<number[]>([]);
  const filterFormRef = useRef<FilterForm>({
    status: ORDER_STATUS.ALL,
    pay_type: PAYMENT_TYPE.ALL,
    keyword: "",
    offset: 0,
    limit: 10,
    date: [],
  });

  const loadList = async () => {
    setLoading(true);
    try {
      const { total = 0, list = [] } = await orderApi.list({
        params: {
          ...filterFormRef.current,
          start_time: filterFormRef.current.date[0],
          end_time: filterFormRef.current.date[1],
        },
      });
      setTableTotal(total);
      setTableData(list);
    } finally {
      setLoading(false);
    }
  };

  const refresh = () => {
    filterFormRef.current.offset = 0;
    loadList();
  };

  const handleSizeChange = (size: number) => {
    filterFormRef.current.limit = size;
    refresh();
  };

  const handleCurrentChange = (page: number) => {
    filterFormRef.current.offset = (page - 1) * filterFormRef.current.limit;
    loadList();
  };

  const handleAdd = ({ data = {} }: { data?: OrderItem } = {}) => {
    addRef.current?.open({ data });
  };

  const handleDelete = async ({ data = {} }: { data?: OrderItem } = {}) => {
    Modal.confirm({
      title: t("tip"),
      content: t("module.operation_order_delete_confirm"),
      okText: t("action_confirm"),
      cancelText: t("action_cancel"),
      onOk: async () => {
        await orderApi.delete_order({ id: data?.id });
        message.success(t("action_delete_success"));
        loadList();
      },
    });
  };

  const handleConfirm = async ({ data = {} }: { data?: OrderItem } = {}) => {
    Modal.confirm({
      title: t("tip"),
      content: t("order.confirm_tip"),
      okText: t("action_confirm"),
      cancelText: t("action_cancel"),
      onOk: async () => {
        await orderApi.confirm_order({ id: data?.id });
        message.success(t("action_confirm_success"));
        loadList();
      },
    });
  };

  const onRowClick = (row: OrderItem) => {
    if (
      PAYMENT_TYPE.MANUAL === row.pay_type &&
      row.status === ORDER_STATUS.NOT_CONFIRM
    ) {
      handleConfirm({ data: row });
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns = [
    {
      title: t("order_id"),
      dataIndex: "order_id",
      key: "order_id",
      ellipsis: true,
      width: 160,
    },
    {
      title: t("order_subscription"),
      dataIndex: "subscription_name",
      key: "subscription_name",
      ellipsis: true,
      width: 140,
      render: (name: string, row: OrderItem) => (
        <span className={name ? "" : "text-disabled"}>
          {name}*{row.duration}
          {t(row.time_unit)}
        </span>
      ),
    },
    {
      title: t("order_amount"),
      dataIndex: "amount",
      key: "amount",
      ellipsis: true,
      width: 120,
      render: (amount: number, row: OrderItem) => (
        <span className={amount ? "" : "text-disabled"}>
          {row.currency || "CNY"}&nbsp;{((+amount || 0) / 100).toFixed(2)}
        </span>
      ),
    },
    {
      title: t("order_status"),
      key: "status",
      ellipsis: true,
      width: 120,
      render: (_: unknown, row: OrderItem) => (
        <div className="flex items-center gap-1">
          <Tag
            className="border-none"
            color={
              row.status === ORDER_STATUS.CANCELLED
                ? "default"
                : row.status === ORDER_STATUS.NOT_CONFIRM
                  ? "error"
                  : row.status === ORDER_STATUS.PENDING
                    ? "processing"
                    : row.status === ORDER_STATUS.EXPIRED
                      ? "warning"
                      : "success"
            }
          >
            {t(ORDER_STATUS_LABEL_MAP.get(row.status) || "")}
          </Tag>
        </div>
      ),
    },
    {
      title: t("order_create_time"),
      key: "created_time",
      width: 160,
      ellipsis: true,
      render: (_: unknown, row: OrderItem) => (
        <span className={row.created_time ? "" : "text-disabled"}>
          {row.created_time?.slice(0, 16) || "--"}
        </span>
      ),
    },
    {
      title: t("user"),
      dataIndex: "nickname",
      key: "nickname",
      width: 140,
      ellipsis: true,
      render: (nickname: string) => (
        <span className={nickname ? "" : "text-disabled"}>
          {nickname || "--"}
        </span>
      ),
    },
    {
      title: t("order_payment_type"),
      dataIndex: "pay_type",
      key: "pay_type",
      width: 120,
      ellipsis: true,
      render: (pay_type: PaymentType) => getPaymentLabel(pay_type),
    },
    {
      title: t("operation"),
      key: "operation",
      width: 170,
      fixed: "right" as const,
      align: "right" as const,
      render: (_: unknown, row: OrderItem) => {
        if (
          PAYMENT_TYPE.MANUAL === row.pay_type &&
          row.status === ORDER_STATUS.NOT_CONFIRM
        ) {
          return (
            <div className="invisible group-hover:visible flex justify-end gap-1">
              <Tooltip title={t("action_confirm_payment")} placement="top">
                <Button
                  type="link"
                  className="hover:!text-brand"
                  icon={<CheckCircleOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleConfirm({ data: row });
                  }}
                />
              </Tooltip>
              <Tooltip title={t("action_edit")} placement="top">
                <Button
                  type="link"
                  className="hover:!text-brand"
                  icon={<SvgIcon name="edit" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAdd({ data: row });
                  }}
                />
              </Tooltip>
              <Tooltip title={t("action_delete")} placement="top">
                <Button
                  type="link"
                  className="hover:!text-tag-red"
                  icon={<SvgIcon name="delete" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete({ data: row });
                  }}
                />
              </Tooltip>
            </div>
          );
        }
        return <span className="text-disabled"> -- </span>;
      },
    },
  ];

  return (
    <>
      <div className="flex-1 flex flex-col bg-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Select
              value={statusValue}
              className="flex-none w-[160px]"
              onChange={(val) => {
                setStatusValue(val);
                filterFormRef.current.status = val;
                refresh();
              }}
              prefix={t("order_status") + "："}
              dropdownMatchSelectWidth={false}
            >
              {ORDER_STATUS_OPTIONS.map((opt) => (
                <Select.Option key={opt.value} value={opt.value}>
                  {t(opt.label || "")}
                </Select.Option>
              ))}
            </Select>

            <Select
              value={payTypeValue}
              className="flex-none w-[160px]"
              onChange={(val) => {
                setPayTypeValue(val);
                filterFormRef.current.pay_type = val;
                refresh();
              }}
              dropdownMatchSelectWidth={false}
              prefix={t("order_payment_type") + "："}
            >
              {ORDER_PAYMENT_TYPE_OPTIONS.map((opt) => (
                <Select.Option key={opt.value} value={opt.value}>
                  {opt.label}
                </Select.Option>
              ))}
            </Select>

            <div className="flex-none">
              <DateRangeFilter
                value={
                  dateValue.length === 2 ? [dateValue[0], dateValue[1]] : []
                }
                valueFormat={(date: Date) => date.getTime()}
                onChange={(val) => {
                  setDateValue(val || []);
                  filterFormRef.current.date = val || [];
                  refresh();
                }}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Search
              mode="expanded"
              value={keyword}
              className="max-w-[268px]"
              placeholder={t("module.operation_order_search_placeholder")}
              onDebouncedChange={(val) => {
                setKeyword(val);
                filterFormRef.current.keyword = val;
                filterFormRef.current.offset = 0;
                refresh();
              }}
            />
            <Button
              className="min-w-[96px]"
              type="primary"
              onClick={() => handleAdd()}
            >
              {t("action_add")}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-white rounded-lg mt-4">
          <Table
            dataSource={tableData}
            style={{ width: "100%" }}
            loading={loading}
            columns={columns}
            rowKey="id"
            onRow={(record) => ({
              className: "group cursor-pointer",
              onClick: () => onRowClick(record),
            })}
            pagination={{
              total: tableTotal,
              pageSize: filterFormRef.current.limit,
              current:
                Math.floor(
                  filterFormRef.current.offset / filterFormRef.current.limit,
                ) + 1,
              showSizeChanger: true,
              showTotal: (total) => t("table_footer_text", { total }),
              onChange: (page, pageSize) => {
                if (pageSize !== filterFormRef.current.limit) {
                  handleSizeChange(pageSize);
                } else {
                  handleCurrentChange(page);
                }
              },
            }}
            components={{
              header: {
                row: (props: any) => (
                  <tr {...props} className="rounded overflow-hidden" />
                ),
                cell: (props: any) => (
                  <th
                    {...props}
                    className={`${props.className || ""} !bg-[#F6F7F8] !border-none`}
                  />
                ),
              },
            }}
          />
        </div>
      </div>
      <AddDialog ref={addRef} onSuccess={loadList} />
    </>
  );
}

export default OrderPage;
