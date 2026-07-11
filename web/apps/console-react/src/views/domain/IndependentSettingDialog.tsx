import {
    Modal,
    Form,
    Input,
    Button,
    message,
    Switch,
    Radio,
    Divider,
    Tooltip,
} from "antd";
import {
    forwardRef,
    useImperativeHandle,
    useRef,
    useState,
    useMemo,
} from "react";
import { t } from "@/locales";
import { domainApi } from "@/api/modules/domain";
import {
    INDEPENDENT_RESOLVE_TYPE,
    INDEPENDENT_SSL_CERT_TYPE,
} from "@/constants/domain";
import { useEnterpriseStore } from "@/stores";
import { SvgIcon } from "@km/shared-components-react";
import { generateInputRules } from "@/utils/form-rule";

type DomainConfig = {
  resolve_type?: number;
  enable_https?: boolean | number;
  force_https?: boolean | number;
  ssl_cert_type?: number;
  ssl_certificate?: string;
  ssl_private_key?: string;
  subdir?: string;
  use_subdir?: boolean | number;
  [key: string]: unknown;
};

type DomainData = {
  id?: number;
  domain?: string;
  config?: DomainConfig;
  [key: string]: unknown;
};

type FormData = {
  domain: string;
  resolve_type: number;
  enable_https: boolean;
  force_https: boolean;
  ssl_cert_type: number;
  ssl_certificate: string;
  ssl_private_key: string;
  subdir: string;
  use_subdir: boolean;
};

export interface IndependentSettingDialogRef {
  open: (params: { data?: DomainData }) => void;
  close: () => void;
  reset: () => void;
}

interface IndependentSettingDialogProps {
  onSuccess?: () => void;
}

export const IndependentSettingDialog = forwardRef<
  IndependentSettingDialogRef,
  IndependentSettingDialogProps
>(({ onSuccess }, ref) => {
    const [form] = Form.useForm();
    const enterpriseStore = useEnterpriseStore();
    const [visible, setVisible] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const originDataRef = useRef<DomainData>({});
    const pendingDataRef = useRef<DomainData | null>(null);

    const resolveType = Form.useWatch("resolve_type", form);
    const useSubdir = Form.useWatch("use_subdir", form);
    const enableHttps = Form.useWatch("enable_https", form);

    const isCnameResolveType = resolveType === INDEPENDENT_RESOLVE_TYPE.CNAME;
    const isCustomResolveType = resolveType === INDEPENDENT_RESOLVE_TYPE.CUSTOM;
    const shouldShowSubdirInput = isCustomResolveType && useSubdir;

    const resolveTypeOptions = useMemo(
      () => [
        {
          value: INDEPENDENT_RESOLVE_TYPE.CNAME,
          label: t("module.domain_independent_cname"),
        },
        {
          value: INDEPENDENT_RESOLVE_TYPE.CUSTOM,
          label: t("module.domain_independent_self"),
        },
      ],
      [],
    );

    const resetForm = () => {
      form.resetFields();
      form.setFieldsValue({
        domain: "",
        resolve_type: INDEPENDENT_RESOLVE_TYPE.CNAME,
        enable_https: false,
        force_https: false,
        ssl_cert_type: INDEPENDENT_SSL_CERT_TYPE["53AI"],
        ssl_certificate: "",
        ssl_private_key: "",
        subdir: "chat",
        use_subdir: false,
      });
    };

    const populateForm = (data: DomainData) => {
      const config = data.config || {};

      form.setFieldsValue({
        domain: (data.domain || "").trim().replace(/^https?:\/\//, ""),
        resolve_type:
          Number(config.resolve_type) || INDEPENDENT_RESOLVE_TYPE.CNAME,
        enable_https: Boolean(Number(config.enable_https)),
        force_https: Boolean(Number(config.force_https)),
        ssl_cert_type:
          Number(config.ssl_cert_type) || INDEPENDENT_SSL_CERT_TYPE["53AI"],
        ssl_certificate: config.ssl_certificate || "",
        ssl_private_key: config.ssl_private_key || "",
        subdir: config.subdir || "chat",
        use_subdir: Boolean(Number(config.use_subdir)),
      });
    };

    const buildConfigData = (): DomainConfig => ({
      resolve_type: form.getFieldValue("resolve_type"),
      enable_https: form.getFieldValue("enable_https"),
      force_https: form.getFieldValue("force_https"),
      ssl_cert_type: form.getFieldValue("ssl_cert_type"),
      ssl_certificate: form.getFieldValue("ssl_certificate"),
      ssl_private_key: form.getFieldValue("ssl_private_key"),
      subdir: form.getFieldValue("subdir"),
      use_subdir: form.getFieldValue("use_subdir"),
    });

    const open = ({ data = {} }: { data?: DomainData } = {}) => {
      originDataRef.current = data;
      pendingDataRef.current = data;
      setVisible(true);
    };

    const handleModalOpenChange = (open: boolean) => {
      if (open && pendingDataRef.current) {
        // Modal 打开后填充表单数据
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

        const requestData = {
          domain: values.domain,
          config: buildConfigData(),
        };

        if (originDataRef.current.id) {
          await domainApi.updateIndependent(
            originDataRef.current.id,
            requestData,
          );
        } else {
          await domainApi.createIndependent(requestData);
        }

        message.success(t("action_save_success"));
        onSuccess?.();
        handleClose();
      } catch (error) {
        console.error("保存独立域名失败:", error);
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
        title={t("module.domain_independent")}
        width={700}
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
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            domain: "",
            resolve_type: INDEPENDENT_RESOLVE_TYPE.CNAME,
            enable_https: false,
            force_https: false,
            ssl_cert_type: INDEPENDENT_SSL_CERT_TYPE["53AI"],
            ssl_certificate: "",
            ssl_private_key: "",
            subdir: "chat",
            use_subdir: false,
          }}
        >
          <div className="flex items-center w-full mb-6">
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
                    if (trimmedValue) {
                      return Promise.resolve();
                    }
                    return Promise.reject(
                      new Error(t("form_input_placeholder")),
                    );
                  },
                },
              ]}
            >
              <Input
                className={`flex-1 ${shouldShowSubdirInput ? "!rounded-none" : "!rounded-l-none"}`}
                maxLength={20}
                showCount
                placeholder={t("module.domain_independent")}
              />
            </Form.Item>

            {shouldShowSubdirInput && (
              <div className="flex items-center">
                <span className="h-[32px] px-3 bg-[#f5f5f5] border-y flex items-center text-secondary">
                  /
                </span>
                <Form.Item
                  name="subdir"
                  noStyle
                  rules={generateInputRules({
                    message: "form_input_placeholder",
                  })}
                >
                  <Input
                    className="!rounded-l-none w-[250px]"
                    maxLength={10}
                    showCount
                    placeholder={t("form_input_placeholder")}
                  />
                </Form.Item>
              </div>
            )}
          </div>

          {isCustomResolveType && (
            <Form.Item>
              <div className="flex items-center text-sm text-secondary">
                <span>{t("module.use_subdirectories")}</span>
                <Tooltip title={t("module.use_subdirectories_tip")}>
                  <SvgIcon
                    className="text-hint ml-1"
                    name="help"
                    width="14"
                    height="14"
                  />
                </Tooltip>
                <Form.Item name="use_subdir" valuePropName="checked" noStyle>
                  <Switch className="ml-2" size="small" />
                </Form.Item>
              </div>
            </Form.Item>
          )}

          <Form.Item name="resolve_type">
            <Radio.Group className="w-full flex">
              {resolveTypeOptions.map((item) => (
                <Radio
                  key={item.value}
                  value={item.value}
                  className={`flex-1 border py-2 px-4 rounded overflow-hidden ${
                    resolveType === item.value ? "border-[#3664EF]" : ""
                  }`}
                >
                  {item.label}
                </Radio>
              ))}
            </Radio.Group>
          </Form.Item>

          {isCnameResolveType && (
            <>
              <ul className="w-full flex flex-col gap-3 bg-[#F6F9FC] p-5 mb-6 box-border text-sm text-secondary">
                <li>{t("module.domain_independent_cname_desc")}</li>
                <li>{t("module.domain_independent_cname_desc_1")}</li>
                <li>{t("module.domain_independent_cname_desc_2")}</li>
                <li>{t("module.domain_independent_cname_desc_3")}</li>
              </ul>

              <Form.Item>
                <div className="flex items-center gap-2 text-sm text-secondary">
                  <span>{t("module.domain_independent_https")}</span>
                  <Form.Item
                    name="enable_https"
                    valuePropName="checked"
                    noStyle
                  >
                    <Switch size="small" />
                  </Form.Item>
                  {enableHttps && (
                    <>
                      <span className="ml-12">
                        {t("module.domain_independent_https_always")}
                      </span>
                      <Form.Item
                        name="force_https"
                        valuePropName="checked"
                        noStyle
                      >
                        <Switch size="small" />
                      </Form.Item>
                    </>
                  )}
                </div>
              </Form.Item>
            </>
          )}

          {!isCnameResolveType && (
            <ul className="w-full flex flex-col gap-3 bg-[#F6F9FC] p-5 mb-6 box-border text-sm text-secondary">
              <li>{t("module.domain_independent_self_desc_1")}</li>
              <li>{t("module.domain_independent_self_desc_2")}</li>
              <Divider className="!my-2" />
              <li>
                {t("module.domain_independent_self_desc_3", {
                  site_id: enterpriseStore.info.eid,
                })}
              </li>
            </ul>
          )}
        </Form>
      </Modal>
    );
  },
);

export default IndependentSettingDialog;
