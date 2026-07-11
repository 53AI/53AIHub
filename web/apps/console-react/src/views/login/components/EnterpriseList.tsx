import { useEffect, useState } from "react";
import { Button, Spin, Tag, message } from "antd";
import { useNavigate } from "react-router-dom";
import { SvgIcon } from "@km/shared-components-react";
import { useEnterpriseStore, useUserStore } from "@/stores";
import systemLogApi from "@/api/modules/system-log";
import { sleep } from "@/utils";
import { useEnv } from "@/hooks/useEnv";
import { SYSTEM_LOG_ACTION } from "@/constants/system-log";
import { ServiceDialog } from "@/components/ServiceDialog";

interface EnterpriseListProps {
  onApply: (username?: string) => void;
  onBack: () => void;
}

interface EnterpriseItem {
  apply_id?: number;
  eid?: string;
  name?: string;
  domain?: string;
  ico?: string;
  logo?: string;
  is_admin?: boolean;
  is_process?: boolean;
  is_expired?: boolean;
  is_reject?: boolean;
  reject_reason?: string;
  is_loading?: boolean;
}

export function EnterpriseList(props: EnterpriseListProps) {
  const { onApply, onBack } = props;
  const userStore = useUserStore();
  const enterpriseStore = useEnterpriseStore();
  const { isDevEnv } = useEnv();
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<EnterpriseItem[]>([]);
  const [serviceVisible, setServiceVisible] = useState(false);
  const navigate = useNavigate();
  const t = (window as any).$t || ((key: string) => key);

  const loadEnterpriseList = async () => {
    setLoading(true);
    try {
      const { list = [] }: any = await enterpriseStore.loadListData({
        data: { status: -1, offset: 0, limit: 500 },
      });
      setList(list);
      const search = window.location.search;
      const params = new URLSearchParams(search);
      const redirect = params.get("redirect") || "";
      const newParams = new URLSearchParams(`?${redirect.split("?")[1] || ""}`);
      const eid = newParams.get("eid");
      if (eid) {
        const target = list.find((item) => String(item.eid) === eid);
        if (target) {
          await handleSelect(target);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (item: EnterpriseItem) => {
    if (item.is_process) {
      message.warning(t("apply.process"));
      return;
    }
    if (item.is_reject) {
      message.warning(item.reject_reason || t("apply.reject"));
      return;
    }
    if (item.is_expired) {
      setServiceVisible(true);
      return;
    }
    if (item.is_loading) return;

    const nextList = list.map((it) =>
      it.apply_id === item.apply_id ? { ...it, is_loading: true } : it,
    );
    setList(nextList);

    try {
      let eid = item.eid;
      if (!eid) {
        let requestCount = 0;

        const refreshData = async (): Promise<string | undefined> => {
          const { list = [] }: any = await enterpriseStore.loadListData({
            data: {
              status: -1,
              offset: 0,
              limit: 500,
            },
          });
          requestCount += 1;
          const applyData = list.find((it) => it.apply_id === item.apply_id);

          if (!applyData?.eid && requestCount < 5) {
            await sleep(1000);
            return refreshData();
          }

          return applyData?.eid;
        };

        eid = await refreshData();
        if (!eid) {
          message.warning("Invalid eid");
          return;
        }
      }
      await enterpriseStore.loadDetailData({ data: { eid } });
      await systemLogApi.create({
        action: SYSTEM_LOG_ACTION.LOGIN,
        content: "登录",
      } as any);

      let domain = item.domain;
      if (isDevEnv) {
        domain = domain?.replace(".km.53ai.com", ".kmtest.53ai.com");
      }
      // 必须用 getState() 获取最新值，因为 loadDetailData 内部更新了 store
      // 而 userStore hook 变量是渲染时的快照，不会自动更新
      const latestAccessToken = useUserStore.getState().info.access_token;
      const targetUrl = `${domain}?access_token=${latestAccessToken}&eid=${eid}`;
      if (window.parent) {
        window.parent.postMessage({
          action: "saas-login-redirect",
          url: targetUrl,
        });
      } else {
        navigate("/index", { replace: true });
      }
    } finally {
      setList((prev) =>
        prev.map((it) =>
          it.apply_id === item.apply_id ? { ...it, is_loading: false } : it,
        ),
      );
    }
  };

  useEffect(() => {
    loadEnterpriseList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <button
        type="button"
        className="absolute top-6 left-8 text-sm text-gray-600 hover:text-gray-800"
        onClick={onBack}
      >
        <SvgIcon name="back" className="mr-1" />
        {t("return")}
      </button>
      <button
        type="button"
        className="absolute top-6 right-8 text-sm text-gray-600 hover:text-gray-800"
        onClick={() => onApply((userStore.info as any).username as string)}
      >
        <SvgIcon name="create" className="mr-1" />
        {t("create_new_enterprise")}
      </button>
      <div className="relative w-full max-w-[440px]">
        <h4 className="text-3xl text-primary font-bold text-center mb-8 mt-10">
          {t("login.select_enterprise")}
        </h4>

        <div className="w-[400px] max-h-[440px] pr-1 box-border overflow-auto flex flex-col gap-4">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Spin />
            </div>
          ) : (
            list.map((item, index) => (
              <div
                key={item.apply_id ?? item.eid ?? index}
                className="flex items-center border rounded-sm p-4 cursor-pointer hover:border-[#3664EF] relative"
                onClick={() => handleSelect(item)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="flex-none mr-4 w-[60px] h-[60px] object-cover rounded"
                  src={item.ico || item.logo}
                  alt=""
                />
                <div className="w-[230px] mr-1">
                  <div className="max-w-64 text-base text-dark truncate flex items-center">
                    <span className="max-w-[220px] overflow-hidden whitespace-nowrap text-ellipsis">
                      {item.name || "- -"}
                    </span>
                    {item.is_admin && (
                      <Tag color="gold" className="ml-2">
                        {t("role.admin")}
                      </Tag>
                    )}
                  </div>
                  <div className="text-sm text-disabled mt-2 max-w-[220px] overflow-hidden whitespace-nowrap text-ellipsis">
                    {item.domain || "- -"}
                  </div>
                </div>
                {item.is_process && (
                  <Tag
                    color="gold"
                    className="absolute top-1/2 -translate-y-1/2 right-6"
                  >
                    {t("apply.process")}
                  </Tag>
                )}
                {item.is_expired && !item.is_process && !item.is_reject && (
                  <Tag
                    color="default"
                    className="absolute top-1/2 -translate-y-1/2 right-6"
                  >
                    {t("apply.expired")}
                  </Tag>
                )}
                {item.is_reject && !item.is_process && !item.is_expired && (
                  <Tag
                    color="error"
                    className="absolute top-1/2 -translate-y-1/2 right-6"
                  >
                    {t("apply.reject")}
                  </Tag>
                )}
                {!item.is_process &&
                  !item.is_expired &&
                  !item.is_reject &&
                  item.is_loading && (
                    <Spin
                      size="small"
                      className="absolute top-1/2 -translate-y-1/2 right-6"
                    />
                  )}
                {!item.is_process &&
                  !item.is_expired &&
                  !item.is_reject &&
                  !item.is_loading && (
                    <SvgIcon
                      name="arrow-right"
                      width="18px"
                      color="#999"
                      className="absolute top-1/2 -translate-y-1/2 right-6"
                    />
                  )}
              </div>
            ))
          )}
        </div>

        <Button
          type="link"
          className="relative mt-4 left-1/2 -translate-x-1/2"
          onClick={loadEnterpriseList}
        >
          {t("apply.refresh_list")}
        </Button>

        <div
          className="flex items-center text-sm text-link cursor-pointer w-max mx-auto mt-2"
          onClick={() => setServiceVisible(true)}
        >
          <SvgIcon name="service" width="14px" height="14px" className="mr-2" />
          {t("apply.contact_customer_service")}
        </div>

        <ServiceDialog
          open={serviceVisible}
          title={t("apply.contact_customer_service_v2")}
          onClose={() => setServiceVisible(false)}
        />
      </div>
    </>
  );
}
