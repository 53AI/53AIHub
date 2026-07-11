import { forwardRef, useImperativeHandle, useState, useMemo } from "react";
import { Modal, Form, Input, Button, Image } from "antd";
import { message } from "antd";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import CertificateUpload from "@/components/Upload/certificate";
import { paymentApi } from "@/api/modules/payment";
import { prepareSavePaymentSettingData } from "@/api/modules/payment/transform";
import { PAYMENT_TYPE } from "@/constants/payment";
import { generateInputRules } from "@/utils/form-rule";
import { methods } from "@/global/methods";

interface FormData {
  mchId: string;
  appId: string;
  apiV3Key: string;
  serialNo: string;
  certPath: string;
  certName: string;
  privateKeyPath: string;
  privateKeyName: string;
  notifyUrl: string;
  platformCertPath: string;
}

interface OriginData {
  pay_setting_id?: number;
  pay_config?: Record<string, any>;
  extra_config?: Record<string, any>;
  [key: string]: any;
}

export interface WechatSettingDialogRef {
  open: (opts: { data?: OriginData }) => void;
  close: () => void;
  reset: () => void;
}

interface WechatSettingDialogProps {
  onSuccess: () => void;
}

const GUIDE_TITLE_MAP = new Map([
  ["mch", "wechat_payment.mch_guide.title"],
  ["app", "wechat_payment.app_guide.title"],
  ["api", "wechat_payment.api_guide.title"],
  ["cert", "wechat_payment.cert_guide.title"],
  ["serial", "wechat_payment.serial_guide.title"],
]);

const getGuideList = (mode: string) => {
  const guideListMap = new Map([
    [
      "mch",
      [
        {
          title: t("wechat_payment.mch_guide.step_1", {
            url: '<a style="color: #586D9A;" href="https://pay.weixin.qq.com/" target="_blank">https://pay.weixin.qq.com/</a>',
          }),
          imageList: [],
        },
        {
          title: t("wechat_payment.mch_guide.step_2"),
          imageList: ["/images/wechat-payment/mch-guide-1.png"],
        },
        {
          title: t("wechat_payment.mch_guide.step_3"),
          imageList: [
            "/images/wechat-payment/mch-guide-2.png",
            "/images/wechat-payment/mch-guide-3.png",
          ],
        },
      ],
    ],
    [
      "app",
      [
        {
          title: t("wechat_payment.app_guide.step_1"),
          imageList: ["/images/wechat-payment/app-guide-1.png"],
        },
        {
          title: t("wechat_payment.app_guide.step_2"),
          imageList: ["/images/wechat-payment/app-guide-2.png"],
        },
        {
          title: t("wechat_payment.app_guide.step_3", {
            url: '<a style="color: #586D9A;" href="https://mp.weixin.qq.com" target="_blank">https://mp.weixin.qq.com</a>',
          }),
          imageList: ["/images/wechat-payment/app-guide-3.png"],
        },
      ],
    ],
    [
      "api",
      [
        {
          title: t("wechat_payment.api_guide.step_1"),
          imageList: ["/images/wechat-payment/api-guide-1.png"],
        },
        {
          title: t("wechat_payment.api_guide.step_2"),
          imageList: [],
        },
      ],
    ],
    [
      "cert",
      [
        {
          title: t("wechat_payment.cert_guide.step_1"),
          imageList: [
            "/images/wechat-payment/cert-guide-1.png",
            "/images/wechat-payment/cert-guide-2.png",
          ],
        },
        {
          title: t("wechat_payment.cert_guide.step_2"),
          imageList: [],
        },
      ],
    ],
    [
      "serial",
      [
        {
          title: t("wechat_payment.serial_guide.step_1"),
          imageList: ["/images/wechat-payment/serial-guide-1.png"],
        },
      ],
    ],
  ]);
  return guideListMap.get(mode);
};

export const WechatSettingDialog = forwardRef<
  WechatSettingDialogRef,
  WechatSettingDialogProps
>(({ onSuccess }, ref) => {
  const [form] = Form.useForm<FormData>();
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [originData, setOriginData] = useState<OriginData>({});
  const [guideVisible, setGuideVisible] = useState(false);
  const [guideMode, setGuideMode] = useState("mch");

  const certPath = Form.useWatch("certPath", form);
  const privateKeyPath = Form.useWatch("privateKeyPath", form);

  const defaultFormData: FormData = {
    mchId: "",
    appId: "",
    apiV3Key: "",
    serialNo: "",
    certPath: "",
    certName: "",
    privateKeyPath: "",
    privateKeyName: "",
    notifyUrl: "",
    platformCertPath: "",
  };

  const open = ({ data = {} } = {}) => {
    const config = data.pay_config || {};
    const extraConfig = data.extra_config || {};
    const formData: FormData = {
      mchId: config.mchId || "",
      appId: config.appId || "",
      apiV3Key: config.apiV3Key || "",
      serialNo: config.serialNo || "",
      certPath: config.certPath || "",
      certName: config.certName || extraConfig.certName || "",
      privateKeyPath: config.privateKeyPath || "",
      privateKeyName: config.privateKeyName || extraConfig.privateKeyName || "",
      notifyUrl: config.notifyUrl || "",
      platformCertPath: config.platformCertPath || "",
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
      const extraConfig = {
        ...(originData.extra_config || {}),
        certName: values.certName,
        privateKeyName: values.privateKeyName,
      };
      delete (payConfig as any).certName;
      delete (payConfig as any).privateKeyName;

      const { preparedData, pay_setting_id } = prepareSavePaymentSettingData({
        pay_setting_id: originData.pay_setting_id,
        pay_config: payConfig,
        extra_config: extraConfig,
        pay_type: PAYMENT_TYPE.WECHAT,
      });

      await paymentApi.savePaymentSetting({ pay_setting_id, ...preparedData });
      message.success(t("action_save_success"));
      onSuccess();
      close();
    } catch (error) {
      console.error("Save wechat setting error:", error);
    } finally {
      setSubmitting(false);
    }
  };

  const guideTitle = useMemo(() => GUIDE_TITLE_MAP.get(guideMode), [guideMode]);
  const guideList = useMemo(() => getGuideList(guideMode), [guideMode]);

  const onGuideOpen = (mode: string) => {
    setGuideMode(mode);
    setGuideVisible(true);
  };

  useImperativeHandle(ref, () => ({
    open,
    close,
    reset,
  }));

  const renderLabelWithGuide = (label: string, mode: string) => (
    <div className="flex items-center">
      <span>{label}</span>
      <span
        className="flex items-center gap-0.5 text-disabled ml-2 text-sm hover:opacity-80 cursor-pointer"
        onClick={() => onGuideOpen(mode)}
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
        title={t("payment.type.wechat")}
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
        <Form form={form} layout="vertical" initialValues={defaultFormData}>
          <Form.Item
            label={renderLabelWithGuide(t("payment.wechat_mch_id"), "mch")}
            name="mchId"
            rules={generateInputRules({
              message: "payment.wechat_mch_id_placeholder",
            })}
          >
            <Input allowClear placeholder={t("form_input_placeholder")} />
          </Form.Item>
          <Form.Item
            label={renderLabelWithGuide(t("payment.wechat_app_id"), "app")}
            name="appId"
            rules={generateInputRules({
              message: "payment.wechat_app_id_placeholder",
            })}
          >
            <Input allowClear placeholder={t("form_input_placeholder")} />
          </Form.Item>
          <Form.Item
            label={renderLabelWithGuide(t("payment.wechat_api_secret"), "api")}
            name="apiV3Key"
            rules={generateInputRules({
              message: "payment.wechat_api_secret_placeholder",
            })}
          >
            <Input allowClear placeholder={t("form_input_placeholder")} />
          </Form.Item>
          <Form.Item
            label={renderLabelWithGuide(t("payment.wechat_cert"), "cert")}
            name="certPath"
            rules={generateInputRules({
              message: "payment.wechat_cert_placeholder",
            })}
          >
            <CertificateUpload
              value={certPath}
              fileName={form.getFieldValue("certName")}
              onChange={(info) => {
                if (info.fileList.length > 0) {
                  const file = info.fileList[0];
                  form.setFieldsValue({
                    certPath: file.key,
                    certName: file.name,
                  });
                  form.validateFields(["certPath"]);
                }
              }}
            />
          </Form.Item>
          <Form.Item
            label={renderLabelWithGuide(
              t("payment.wechat_private_key"),
              "cert",
            )}
            name="privateKeyPath"
            rules={generateInputRules({
              message: "payment.wechat_private_key_placeholder",
            })}
          >
            <CertificateUpload
              value={privateKeyPath}
              fileName={form.getFieldValue("privateKeyName")}
              onChange={(info) => {
                if (info.fileList.length > 0) {
                  const file = info.fileList[0];
                  form.setFieldsValue({
                    privateKeyPath: file.key,
                    privateKeyName: file.name,
                  });
                  form.validateFields(["privateKeyPath"]);
                }
              }}
            />
          </Form.Item>
          <Form.Item
            label={renderLabelWithGuide(
              t("payment.wechat_serial_no"),
              "serial",
            )}
            name="serialNo"
            rules={generateInputRules({
              message: "payment.wechat_serial_no_placeholder",
            })}
          >
            <Input allowClear placeholder={t("form_input_placeholder")} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={guideVisible}
        title={t(guideTitle || "")}
        onCancel={() => setGuideVisible(false)}
        destroyOnHidden
        width={860}
        centered
        footer={null}
      >
        <ul className="flex flex-col gap-4 pb-4 box-border">
          {guideList?.map((item, index) => (
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

WechatSettingDialog.displayName = "WechatSettingDialog";

export default WechatSettingDialog;
