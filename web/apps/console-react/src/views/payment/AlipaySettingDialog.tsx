import {
    forwardRef,
    useImperativeHandle,
    useState,
    useMemo,
    useRef,
    useEffect,
} from "react";
import { Modal, Form, Input, Button, Image, Tooltip } from "antd";
import { message } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import { copyToClip } from "@km/shared-utils";
import { paymentApi } from "@/api/modules/payment";
import { prepareSavePaymentSettingData } from "@/api/modules/payment/transform";
import { PAYMENT_TYPE } from "@/constants/payment";
import { generateInputRules } from "@/utils/form-rule";
import { methods } from "@/global/methods";
import { useUserStore } from "@/stores";
import { api_host } from "@/utils/config";

interface FormData {
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
}

interface OriginData {
  pay_setting_id?: number;
  pay_config?: Record<string, any>;
  extra_config?: Record<string, any>;
  [key: string]: any;
}

export interface AlipaySettingDialogRef {
  open: (opts: { data?: OriginData }) => void;
  close: () => void;
  reset: () => void;
}

interface AlipaySettingDialogProps {
  onSuccess: () => void;
}

const GUIDE_TITLE = "wechat_payment.app_guide.title";

const getGuideList = () => {
  return [
    {
      title: t("alipay_payment.app_guide.step_1"),
      imageList: ["/images/alipay-payment/app-guide-1.png"],
    },
  ];
};

export const AlipaySettingDialog = forwardRef<
  AlipaySettingDialogRef,
  AlipaySettingDialogProps
>(({ onSuccess }, ref) => {
  const [form] = Form.useForm<FormData>();
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [originData, setOriginData] = useState<OriginData>({});
  const [guideVisible, setGuideVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const guideRef = useRef<HTMLDivElement>(null);
  const copyIconRef = useRef<HTMLSpanElement>(null);

  const userStore = useUserStore();

  const defaultFormData: FormData = {
    appId: "",
    privateKey: "",
    alipayPublicKey: "",
  };

  const callbackUrl = useMemo(() => {
    return `${api_host}/api/payment/alipay/notify/${userStore.info.user_id}`;
  }, [userStore.info.user_id]);

  const open = ({ data = {} } = {}) => {
    const config = data.pay_config || {};
    const formData: FormData = {
      appId: config.appId || "",
      privateKey: config.privateKey || "",
      alipayPublicKey: config.alipayPublicKey || "",
    };
    form.setFieldsValue(formData);
    setOriginData(data);
    setVisible(true);
  };

  const reset = () => {
    form.setFieldsValue(defaultFormData);
  };

  const close = () => {
    setVisible(false);
    reset();
  };

  const handleConfirm = async () => {
    try {
      await form.validateFields();
      setSubmitting(true);
      const values = form.getFieldsValue();
      const payConfig = { ...values };

      const { preparedData, pay_setting_id } = prepareSavePaymentSettingData({
        pay_setting_id: originData.pay_setting_id,
        pay_config: payConfig,
        extra_config: {},
        pay_type: PAYMENT_TYPE.ALIPAY,
      });

      await paymentApi.savePaymentSetting({ pay_setting_id, ...preparedData });
      message.success(t("action_save_success"));
      onSuccess();
      close();
    } catch (error) {
      console.error("Save alipay setting error:", error);
    } finally {
      setSubmitting(false);
    }
  };

  const guideList = useMemo(() => getGuideList(), []);

  const onGuideOpen = () => {
    setGuideVisible(true);
  };

  const handleCopy = async () => {
    await copyToClip(callbackUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 将复制图标插入到 .copy-hook span 中
  useEffect(() => {
    if (visible) {
      setTimeout(() => {
        if (guideRef.current && copyIconRef.current) {
          const copyHookEl = guideRef.current.querySelector(".copy-hook");
          if (copyHookEl && !copyHookEl.contains(copyIconRef.current)) {
            copyHookEl.appendChild(copyIconRef.current);
          }
        }
      }, 200);
    }
  }, [visible]);

  useImperativeHandle(ref, () => ({
    open,
    close,
    reset,
  }));

  const renderLabelWithGuide = (label: string) => (
    <div className="flex items-center">
      <span>{label}</span>
      <span
        className="flex items-center gap-0.5 text-disabled ml-2 text-sm hover:opacity-80 cursor-pointer"
        onClick={onGuideOpen}
      >
        <SvgIcon className="inline" name="help" width="14" color="#999" />
        {t("how_get")}
      </span>
    </div>
  );

  return (
    <>
      <Modal
        open={visible}
        title={t("payment.type.alipay")}
        onCancel={close}
        destroyOnHidden
        width={700}
        mask={{ closable: false }}
        footer={
          <>
            <Button onClick={close}>{t("action_cancel")}</Button>
            <Button type="primary" loading={submitting} onClick={handleConfirm}>
              {t("action_confirm")}
            </Button>
          </>
        }
      >
        <div
          ref={guideRef}
          className="gap-3 bg-[#F6F9FC] p-5 mb-4 box-border text-sm text-secondary"
        >
          <div
            className="whitespace-pre-wrap leading-6"
            dangerouslySetInnerHTML={{
              __html: t("payment.alipay_guide_html", {
                callback_url: callbackUrl,
              }),
            }}
          />
          <Tooltip title={copied ? t("copied") : t("action_copy")}>
            <span
              ref={copyIconRef}
              className="cursor-pointer ml-1 text-secondary hover:text-brand"
              onClick={handleCopy}
            >
              <CopyOutlined style={{ fontSize: 14 }} />
            </span>
          </Tooltip>
        </div>

        <Form form={form} layout="vertical" initialValues={defaultFormData}>
          <Form.Item
            label={renderLabelWithGuide(t("payment.alipay_app_id"))}
            name="appId"
            rules={generateInputRules({
              message: "payment.alipay_app_id_placeholder",
            })}
          >
            <Input allowClear placeholder={t("form_input_placeholder")} />
          </Form.Item>
          <Form.Item
            label={t("payment.alipay_mch_id")}
            name="privateKey"
            rules={generateInputRules({
              message: "payment.alipay_mch_id_placeholder",
            })}
          >
            <Input allowClear placeholder={t("form_input_placeholder")} />
          </Form.Item>
          <Form.Item
            label={t("payment.alipay_api_secret")}
            name="alipayPublicKey"
            rules={generateInputRules({
              message: "payment.alipay_api_secret_placeholder",
            })}
          >
            <Input allowClear placeholder={t("form_input_placeholder")} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={guideVisible}
        title={t(GUIDE_TITLE)}
        onCancel={() => setGuideVisible(false)}
        destroyOnHidden
        width={860}
        centered
        footer={null}
      >
        <ul className="flex flex-col gap-4 pb-4 box-border">
          {guideList.map((item, index) => (
            <li
              key={index}
              className="flex flex-col gap-2 text-primary text-sm"
            >
              <div
                className="text-wrap break-words whitespace-pre-wrap"
                dangerouslySetInnerHTML={{ __html: item.title }}
              />
              {item.imageList.map((image, imageIndex) => (
                <div key={imageIndex} className="w-full">
                  <Image
                    src={methods.$getRealPath({ url: image })}
                    className="w-full"
                    style={{ width: "100%" }}
                  />
                </div>
              ))}
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
});

AlipaySettingDialog.displayName = "AlipaySettingDialog";

export default AlipaySettingDialog;
