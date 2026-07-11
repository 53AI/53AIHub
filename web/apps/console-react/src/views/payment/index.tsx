import React, { useEffect, useRef, useMemo } from "react";
import { message } from "antd";
import { t } from "@/locales";
import PaymentCard from "./PaymentCard";
import WechatSettingDialog, {
    WechatSettingDialogRef,
} from "./WechatSettingDialog";
import AlipaySettingDialog, {
    AlipaySettingDialogRef,
} from "./AlipaySettingDialog";
import ManualSettingDialog, {
    ManualSettingDialogRef,
} from "./ManualSettingDialog";

import { paymentApi } from "@/api/modules/payment";
import {
    transformPaymentSettingList,
    transformToPaymentSettingMap,
} from "@/api/modules/payment/transform";
import { PAYMENT_COMMAND, PAYMENT_STATUS } from "@/constants/payment";
import type {
    PaymentSettingMap,
    PaymentSetting,
} from "@/api/modules/payment/types";
import TipConfirm from "@/components/TipConfirm";
import { isInternalNetwork } from "@km/shared-utils";

export function PaymentPage() {
  const wechatSettingRef = useRef<WechatSettingDialogRef>(null);
  const manualSettingRef = useRef<ManualSettingDialogRef>(null);
  const alipaySettingRef = useRef<AlipaySettingDialogRef>(null);
  const tipConfirmRef = useRef<{ open: () => void }>(null);

  const [paymentSettings, setPaymentSettings] =
    React.useState<PaymentSettingMap>({
      wechat: {} as PaymentSetting,
      alipay: {} as PaymentSetting,
      manual: {} as PaymentSetting,
      paypal: {} as PaymentSetting,
    });

  const refresh = async () => {
    try {
      const rawData = await paymentApi.getPaymentSettings();
      const settingsList = transformPaymentSettingList(rawData);
      setPaymentSettings(transformToPaymentSettingMap(settingsList));
    } catch (error) {
      console.error("获取支付设置失败:", error);
      message.error("获取支付设置失败");
    }
  };

  const getPaymentSettingInfo = (type: keyof PaymentSettingMap) => {
    return paymentSettings[type] || ({} as PaymentSetting);
  };

  const getDialogRef = (type: keyof PaymentSettingMap) => {
    const dialogMap: Record<
      string,
      React.RefObject<
        | WechatSettingDialogRef
        | AlipaySettingDialogRef
        | ManualSettingDialogRef
        | null
      >
    > = {
      wechat: wechatSettingRef,
      alipay: alipaySettingRef,
      manual: manualSettingRef,
    };
    return dialogMap[type];
  };

  const updatePaymentStatus = async (
    pay_setting_id: number,
    pay_status: boolean,
  ) => {
    try {
      await paymentApi.updatePaymentStatus(pay_setting_id, { pay_status });
      const statusText = pay_status ? "enabled" : "disabled";
      message.success(t(statusText));
      await refresh();
    } catch (error) {
      console.error("更新支付状态失败:", error);
      message.error("更新支付状态失败");
    }
  };

  const handleCommand = async (command: string, type: string = "") => {
    if (type === "paypal") {
      message.warning(t("feature_coming_soon"));
      return;
    }

    if (isInternalNetwork() && type !== "manual") {
      tipConfirmRef.current?.open();
      return;
    }

    const settingInfo = getPaymentSettingInfo(type as keyof PaymentSettingMap);

    switch (command) {
      case PAYMENT_COMMAND.SETTING:
        const dialogRef = getDialogRef(type as keyof PaymentSettingMap);
        if (dialogRef?.current) {
          dialogRef.current.open({ data: settingInfo });
        }
        break;

      case PAYMENT_COMMAND.ENABLE:
        await updatePaymentStatus(
          settingInfo.pay_setting_id,
          PAYMENT_STATUS.ENABLED,
        );
        break;

      case PAYMENT_COMMAND.DISABLE:
        await updatePaymentStatus(
          settingInfo.pay_setting_id,
          PAYMENT_STATUS.DISABLED,
        );
        break;
    }
  };

  const wechatSettingInfo = useMemo(
    () => getPaymentSettingInfo("wechat"),
    [paymentSettings.wechat],
  );
  const alipaySettingInfo = useMemo(
    () => getPaymentSettingInfo("alipay"),
    [paymentSettings.alipay],
  );
  const manualSettingInfo = useMemo(
    () => getPaymentSettingInfo("manual"),
    [paymentSettings.manual],
  );

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="h-full bg-white py-6 px-2">
      <div className="flex-1 flex flex-col bg-white">
        <h1 className="font-semibold text-base text-primary">CNY</h1>
        <div className="mt-5 grid grid-cols-2 gap-5">
          <PaymentCard
            settingInfo={wechatSettingInfo}
            type="wechat"
            onCommand={handleCommand}
          />
          <PaymentCard
            settingInfo={alipaySettingInfo}
            type="alipay"
            onCommand={handleCommand}
          />
          <PaymentCard
            settingInfo={manualSettingInfo}
            type="manual"
            onCommand={handleCommand}
          />
        </div>
        <h1 className="mt-10 font-semibold text-base text-primary opacity-60">
          USD
        </h1>
        <div className="mt-5 grid grid-cols-2 gap-5 opacity-60">
          <PaymentCard
            settingInfo={getPaymentSettingInfo("paypal")}
            type="paypal"
            onCommand={handleCommand}
          />
          <div className="flex-1 rounded-lg p-5 pb-8 group" />
        </div>
      </div>

      <WechatSettingDialog ref={wechatSettingRef} onSuccess={refresh} />
      <ManualSettingDialog ref={manualSettingRef} onSuccess={refresh} />
      <AlipaySettingDialog ref={alipaySettingRef} onSuccess={refresh} />

      <TipConfirm
        ref={tipConfirmRef}
        title={t("local_config_limited_tip")}
        content={t("local_config_limited_desc", { url: window.location.href })}
        confirmButtonText={t("know_it")}
        showCancelButton={false}
      />
    </div>
  );
}

export default PaymentPage;
