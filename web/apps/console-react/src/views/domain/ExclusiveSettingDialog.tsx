import { Modal, Form, Input, Button, message } from "antd";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { t } from "@/locales";
import { domainApi } from "@/api/modules/domain";
import { DOMAIN_SUFFIX } from "@/constants/domain";

type DomainData = {
  id?: number;
  domain?: string;
  domain_name?: string;
  [key: string]: unknown;
};

export interface ExclusiveSettingDialogRef {
  open: (params: { data?: DomainData }) => void;
  close: () => void;
  reset: () => void;
}

interface ExclusiveSettingDialogProps {
  onSuccess?: () => void;
}

export const ExclusiveSettingDialog = forwardRef<
  ExclusiveSettingDialogRef,
  ExclusiveSettingDialogProps
>(({ onSuccess }, ref) => {
    const [form] = Form.useForm();
    const [visible, setVisible] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const originDataRef = useRef<DomainData>({});
    const pendingDataRef = useRef<DomainData | null>(null);

    const resetForm = () => {
      form.resetFields();
    };

    const populateForm = (data: DomainData) => {
      form.setFieldsValue({ domain: data.domain_name || "" });
    };

    const open = ({ data = {} }: { data?: DomainData } = {}) => {
      originDataRef.current = data;
      pendingDataRef.current = data;
      setVisible(true);
    };

    const handleModalOpenChange = (open: boolean) => {
      if (open && pendingDataRef.current) {
        populateForm(pendingDataRef.current);
        pendingDataRef.current = null;
      }
    };

    const handleClose = () => {
      setVisible(false);
      resetForm();
    };

    const handleConfirm = async () => {
      try {
        const values = await form.validateFields();
        setSubmitting(true);

        const domainUrl = `${values.domain}${DOMAIN_SUFFIX}`;
        const requestData = { domain: domainUrl };

        if (originDataRef.current.id) {
          await domainApi.updateExclusive(
            originDataRef.current.id,
            requestData,
          );
        } else {
          await domainApi.createExclusive(requestData);
        }

        message.success(t("action_save_success"));
        onSuccess?.();
        handleClose();
      } catch (error) {
        console.error("保存独占域名失败:", error);
        message.error(t("action_save_failed"));
      } finally {
        setSubmitting(false);
      }
    };

    useImperativeHandle(ref, () => ({
      open,
      close: handleClose,
      reset: resetForm,
    }));

    return (
      <Modal
        open={visible}
        title={t("module.domain_exclusive")}
        width={600}
        mask={{ closable: false }}
        onCancel={handleClose}
        destroyOnHidden
        afterOpenChange={handleModalOpenChange}
        footer={
          <>
            <Button onClick={handleClose}>{t("action_cancel")}</Button>
            <Button type="primary" loading={submitting} onClick={handleConfirm}>
              {t("action_save")}
            </Button>
          </>
        }
      >
        <Form form={form} layout="vertical">
          <div className="flex items-center w-full">
            <span className="h-[32px] px-3 bg-[#f5f5f5] border border-r-0 rounded-l flex items-center text-secondary">
              https://
            </span>
            <Form.Item
              name="domain"
              noStyle
              rules={[
                {
                  validator: (_, value) => {
                    const trimmedValue = (value || "").trim();
                    if (!trimmedValue) {
                      return Promise.reject(
                        new Error(t("form_input_placeholder")),
                      );
                    }
                    if (!/^[a-z0-9-]{5,20}$/.test(trimmedValue)) {
                      return Promise.reject(
                        new Error(t("module.domain_exclusive_validator_1")),
                      );
                    }
                    if (
                      trimmedValue.startsWith("-") ||
                      trimmedValue.endsWith("-")
                    ) {
                      return Promise.reject(
                        new Error(t("module.domain_exclusive_validator_2")),
                      );
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <Input
                className="flex-1 !rounded-none"
                maxLength={20}
                showCount
                placeholder={t("module.domain_exclusive")}
              />
            </Form.Item>
            <span className="h-[32px] px-3 bg-[#f5f5f5] border border-l-0 rounded-r flex items-center text-secondary">
              {DOMAIN_SUFFIX}
            </span>
          </div>
        </Form>
      </Modal>
    );
  },
);

export default ExclusiveSettingDialog;
