import { forwardRef, useImperativeHandle, useState } from "react";
import { Modal, Form, Input, Button } from "antd";
import { message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { t } from "@/locales";
import { paymentApi } from "@/api/modules/payment";
import { prepareSavePaymentSettingData } from "@/api/modules/payment/transform";
import { PAYMENT_TYPE } from "@/constants/payment";
import ImageUpload from "@/components/Upload/image";

interface FormData {
  pay_qrcode: string;
  pay_desc: string;
}

interface OriginData {
  pay_setting_id?: number;
  pay_config?: Record<string, any>;
  extra_config?: Record<string, any>;
  [key: string]: any;
}

export interface ManualSettingDialogRef {
  open: (opts: { data?: OriginData }) => void;
  close: () => void;
  reset: () => void;
}

interface ManualSettingDialogProps {
  onSuccess: () => void;
}

const textValidator = (_: any, value: string) => {
  const v = (value || "").trim();
  if (!v) {
    return Promise.reject(new Error(t("payment.manual.qrcode_placeholder")));
  }
  return Promise.resolve();
};

export const ManualSettingDialog = forwardRef<
  ManualSettingDialogRef,
  ManualSettingDialogProps
>(({ onSuccess }, ref) => {
  const [form] = Form.useForm<FormData>();
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [originData, setOriginData] = useState<OriginData>({});

  const payQrcode = Form.useWatch("pay_qrcode", form);

  const defaultFormData: FormData = {
    pay_qrcode: "",
    pay_desc: "",
  };

  const open = ({ data = {} } = {}) => {
    const extraConfig = data.extra_config || {};
    const formData: FormData = {
      pay_qrcode: extraConfig.pay_qrcode || "",
      pay_desc: extraConfig.pay_desc || "",
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

      const { preparedData, pay_setting_id } = prepareSavePaymentSettingData({
        pay_setting_id: originData.pay_setting_id,
        pay_config: {},
        extra_config: {
          pay_qrcode: values.pay_qrcode,
          pay_desc: values.pay_desc,
        },
        pay_type: PAYMENT_TYPE.MANUAL,
      });

      await paymentApi.savePaymentSetting({ pay_setting_id, ...preparedData });
      message.success(t("action_save_success"));
      onSuccess();
      close();
    } catch (error) {
      console.error("Save manual setting error:", error);
    } finally {
      setSubmitting(false);
    }
  };

  useImperativeHandle(ref, () => ({
    open,
    close,
    reset,
  }));

  return (
    <Modal
      open={visible}
      title={t("payment.type.manual")}
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
        <ol className="w-full flex flex-col gap-3 bg-[#F6F9FC] p-5 mb-6 box-border text-sm text-secondary">
          <li>{t("payment.manual_tip")}</li>
        </ol>
        <Form.Item
          label={t("payment.manual.qrcode")}
          name="pay_qrcode"
          rules={[{ validator: textValidator, trigger: "blur" }]}
        >
          <div className="!w-[148px] !h-[148px] border bg-[#F7F8FA] rounded-md overflow-hidden relative">
            <ImageUpload
              value={payQrcode}
              onChange={(url) => form.setFieldsValue({ pay_qrcode: url })}
              className="!w-[148px] !h-[148px]"
            >
              <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                {payQrcode ? (
                  <img
                    src={payQrcode}
                    className="absolute top-0 left-0 w-full h-full object-cover"
                    alt="qrcode"
                  />
                ) : (
                  <>
                    <PlusOutlined style={{ fontSize: 20, color: "#9A9A9A" }} />
                    <span className="text-disabled text-sm">
                      {t("action_upload")}
                    </span>
                  </>
                )}
              </div>
            </ImageUpload>
          </div>
        </Form.Item>
        <Form.Item label={t("payment.manual.desc")} name="pay_desc">
          <Input.TextArea
            rows={4}
            maxLength={30}
            showCount
            allowClear
            placeholder={t("payment.manual.desc_placeholder")}
            style={{ resize: "none" }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
});

ManualSettingDialog.displayName = "ManualSettingDialog";

export default ManualSettingDialog;
