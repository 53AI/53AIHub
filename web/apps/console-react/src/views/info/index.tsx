import {
    Form,
    Input,
    Button,
    Image,
    Select,
    Switch,
    message,
    Modal,
    Divider,
} from "antd";
import { CheckOutlined } from "@ant-design/icons";
import { useEffect, useState, useMemo } from "react";
import { t } from "@/locales";
import { ImageUpload } from "@/components/Upload/image";
import { ServiceDialog } from "@/components/ServiceDialog";
import { useEnterpriseStore } from "@/stores";
import { enterpriseApi } from "@/api/modules/enterprise";
import { useEnv } from "@/hooks/useEnv";
import { useInternalUserStats } from "@/hooks/useInternalUserStats";
import {
    WEBSITE_TYPE,
    WEBSITE_VERSION,
    WEBSITE_TYPE_LABEL_MAP,
    WEBSITE_TYPE_DESC_MAP,
    VERSION_MODULE,
} from "@/constants/enterprise";
import { checkVersion, checkVersionPermission } from "@/utils/version";
import { VersionGuard } from "@/components/VersionGuard";

interface PolicyField {
  enabled: boolean;
  url: string;
}

interface InfoForm {
  logo: string;
  ico: string;
  name: string;
  keywords: string[];
  desc: string;
  language: string;
  website_type: string;
  copyright: boolean;
  terms_of_service: PolicyField;
  privacy_policy: PolicyField;
  ai_privacy_policy: PolicyField;
}

const LANGUAGE_OPTIONS = [
  { value: "zh-cn", label: "中文-CN" },
  { value: "zh-tw", label: "中文-TW" },
  { value: "en", label: "英文-EN" },
  { value: "jp", label: "日文-JP" },
];

const WEBSITE_TYPE_OPTIONS = [
  WEBSITE_TYPE.INDEPENDENT,
  WEBSITE_TYPE.ENTERPRISE,
  WEBSITE_TYPE.INDUSTRY,
];

export function InfoPage() {
  const enterpriseStore = useEnterpriseStore();
  const [form] = Form.useForm<InfoForm>();
  const [loading, setLoading] = useState(false);
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [serviceDialogTitle, setServiceDialogTitle] = useState("");
  const { isPrivatePremEnv, isOpLocalEnv } = useEnv();
  const { internalUserCount, maxLimit } = useInternalUserStats();

  // Watch form fields for reactive updates
  const logo = Form.useWatch("logo", form);
  const ico = Form.useWatch("ico", form);
  const copyright = Form.useWatch("copyright", form);
  const websiteType = Form.useWatch("website_type", form);
  const termsEnabled = Form.useWatch(["terms_of_service", "enabled"], form);
  const privacyEnabled = Form.useWatch(["privacy_policy", "enabled"], form);
  const aiPrivacyEnabled = Form.useWatch(
    ["ai_privacy_policy", "enabled"],
    form,
  );

  const enterpriseInfo = useMemo(
    () => enterpriseStore.info,
    [enterpriseStore.info],
  );

  // Get permission module for website type
  const getPermissionModule = (value: string) => {
    if (value === WEBSITE_TYPE.INDEPENDENT)
      return VERSION_MODULE.REGISTERED_USER;
    if (value === WEBSITE_TYPE.ENTERPRISE) return VERSION_MODULE.INTERNAL_USER;
    if (value === WEBSITE_TYPE.INDUSTRY) {
      return VERSION_MODULE.INTERNAL_USER;
    }
    return "";
  };

  // Load policy info on mount (private prem env only)
  useEffect(() => {
    if (isPrivatePremEnv) {
      loadPolicyInfo();
    }
  }, [isPrivatePremEnv]);

  // Initialize form with enterprise info
  useEffect(() => {
    if (enterpriseInfo) {
      const keywordsRaw = enterpriseInfo.keywords;
      let keywords: string[] = [];
      if (typeof keywordsRaw === "string") {
        try {
          keywords = JSON.parse(keywordsRaw);
        } catch {
          keywords = [];
        }
      } else if (Array.isArray(keywordsRaw)) {
        keywords = keywordsRaw;
      }

      form.setFieldsValue({
        logo: enterpriseInfo.logo || "",
        ico: enterpriseInfo.ico || "",
        name: (enterpriseInfo as any).display_name || enterpriseInfo.name || "",
        keywords,
        desc: (enterpriseInfo as any).description || "",
        language: (enterpriseInfo as any).language || "zh-cn",
        website_type: (enterpriseInfo as any).type || WEBSITE_TYPE.INDEPENDENT,
        copyright:
          String((enterpriseInfo as any).copyright).toLowerCase() === "true",
        terms_of_service: { enabled: false, url: "" },
        privacy_policy: { enabled: false, url: "" },
        ai_privacy_policy: { enabled: false, url: "" },
      });
    }
  }, [enterpriseInfo, form]);

  const loadPolicyInfo = async () => {
    try {
      const { terms_of_service, privacy_policy, ai_privacy_policy } =
        await enterpriseApi.policy_info();
      form.setFieldsValue({
        terms_of_service: terms_of_service || { enabled: false, url: "" },
        privacy_policy: privacy_policy || { enabled: false, url: "" },
        ai_privacy_policy: ai_privacy_policy || { enabled: false, url: "" },
      });
    } catch (error) {
      console.error("Failed to load policy info:", error);
    }
  };

  // Handle website type change with version check
  const handleWebsiteTypeChange = (value: string) => {
    const module = getPermissionModule(value);
    // Local env or private prem env: allow directly without version check
    const passed = isOpLocalEnv || isPrivatePremEnv || checkVersionPermission({
      module: module as any,
      content: t("version.not_support"),
    });
    if (passed) {
      form.setFieldValue("website_type", value);
    }
  };

  const openUpgradeDialog = () => {
    setServiceDialogTitle(t("action_upgrade"));
    setServiceDialogOpen(true);
  }

  // Handle hide logo switch
  const handleHideLogoSwitch = (checked: boolean) => {
    // Local env or private prem env: allow directly without version check
    if (enterpriseInfo.version < WEBSITE_VERSION.ENTERPRISE && !(isOpLocalEnv || isPrivatePremEnv)) {
      // Revert the change since Form.Item auto-updated it
      form.setFieldValue("copyright", !checked);
      Modal.confirm({
        title: t("version.upgrade_tip"),
        content: t("version.upgrade_hide_logo"),
        okText: t("action_upgrade"),
        cancelText: t("action_cancel"),
        onOk: () => {
          openUpgradeDialog()
        },
      });
    }
    // If version check passes, Form.Item already updated the value
  };

  // URL validator for policy links
  const linkValidator = (_: any, value: string, enabled: boolean) => {
    if (!enabled) return Promise.resolve();
    if (!value) {
      return Promise.reject(new Error(t("login.link_empty_tip")));
    }
    if (
      !/^(https?:\/\/)?((([\w.-]+)(\.[\w.-]+)+)|((\d{1,3}\.){3}\d{1,3}))(:\d+)?([\/#\?].*)?$/.test(
        value,
      )
    ) {
      return Promise.reject(new Error(t("form_link_validator")));
    }
    return Promise.resolve();
  };

  // Handle save
  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      await enterpriseStore.update({
        data: {
          eid: enterpriseInfo.eid,
          logo: values.logo,
          ico: values.ico,
          display_name: values.name,
          language: values.language,
          description: values.desc,
          keywords: JSON.stringify(values.keywords),
          copyright: values.copyright.toString(),
          type: values.website_type,
          template_type: "",
          layout_type: "portal",
        },
      });

      // Save policy info for private prem env
      if (isPrivatePremEnv) {
        await enterpriseApi.save_policy_info({
          terms_of_service: values.terms_of_service,
          privacy_policy: values.privacy_policy,
          ai_privacy_policy: values.ai_privacy_policy,
        });
      }

      message.success(t("action_save_success"));
      enterpriseStore.loadSelfInfo();
    } catch (error) {
      console.error("Save error:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white px-2 box-border flex flex-col">
      <div className="flex-1 overflow-y-auto">
        <Form
          form={form}
          layout="horizontal"
          labelCol={{ flex: "140px" }}
          labelAlign="left"
          colon={false}
        >
          <h1 className="text-primary font-semibold mb-4">{t("basic_info")}</h1>

          {/* Logo */}
          <Form.Item label={t("module.website_info_logo")} name="logo">
            <div className="w-full flex items-center gap-4">
              {logo && (
                <Image
                  className="!max-w-[220px] !h-16 rounded overflow-hidden"
                  src={logo}
                  style={{ objectFit: "contain" }}
                />
              )}
              <ImageUpload
                value={logo || ""}
                onChange={(url) => form.setFieldValue("logo", url)}
                text={logo ? t("action_modify") : t("action_upload")}
                showText
                cropperDisabled
              />
            </div>
            <div className="mt-2 w-full text-sm text-disabled">
              {t("module.website_info_logo_tip")}
            </div>
          </Form.Item>

          {/* ICO */}
          <Form.Item
            className="mt-8"
            label={t("module.website_info_ico")}
            name="ico"
          >
            <div className="w-full flex items-center gap-4">
              {ico && (
                <Image
                  className="!w-8 !h-8 rounded overflow-hidden"
                  src={ico}
                  style={{ objectFit: "contain" }}
                />
              )}
              <ImageUpload
                value={ico || ""}
                onChange={(url) => form.setFieldValue("ico", url)}
                text={ico ? t("action_modify") : t("action_upload")}
                showText
                cropperDisabled
                allowTypeList={["ico", "jpg", "png", "jpeg"]}
              />
            </div>
            <div className="mt-2 w-full text-sm text-disabled">
              {t("module.website_info_ico_tip")}
            </div>
          </Form.Item>

          {/* Name */}
          <Form.Item
            label={t("module.website_info_name")}
            name="name"
            rules={[
              {
                required: true,
                message: t("module.website_info_name_placeholder"),
              },
            ]}
          >
            <Input
              className="max-w-[660px]"
              placeholder={t("module.website_info_name_placeholder")}
              maxLength={120}
              showCount
              allowClear
            />
          </Form.Item>

          {/* Keywords */}
          <Form.Item label={t("module.website_info_keyword")} name="keywords">
            <Select
              mode="tags"
              className="max-w-[660px]"
              placeholder={t("module.website_info_keyword_placeholder_v2")}
              maxTagCount={10}
              options={[]}
              open={false}
              suffixIcon={""}
              allowClear
            />
          </Form.Item>

          {/* Description */}
          <Form.Item label={t("module.website_info_desc")} name="desc">
            <Input.TextArea
              className="max-w-[660px]"
              placeholder={t("module.website_info_desc_placeholder")}
              maxLength={200}
              showCount
              autoSize={{ minRows: 5, maxRows: 6 }}
              style={{ resize: "none" }}
            />
          </Form.Item>

          {/* Language */}
          <Form.Item label={t("module.website_info_language")} name="language">
            <Select className="max-w-[660px]">
              {LANGUAGE_OPTIONS.map((opt) => (
                <Select.Option key={opt.value} value={opt.value}>
                  {t(`language_option_label.${opt.value}`)}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          {/* Website Type */}
          <Form.Item label={t("module.website_info_type")} name="website_type">
            <ul className="flex items-center flex-wrap gap-4">
              {WEBSITE_TYPE_OPTIONS.map((value) => {
                const isSelected = websiteType === value;
                const module = getPermissionModule(value);
                return (
                  <VersionGuard
                    key={value}
                    module={module as any}
                    mode="tooltip"
                    content={t("version.not_support")}
                  >
                    <li
                      className={`relative w-[300px] px-5 py-4 bg-[#F5F5F5] flex flex-col gap-2 border rounded box-border overflow-hidden text-sm cursor-pointer hover:border-[#3664EF] hover:text-brand ${
                        isSelected
                          ? "border-[#3664EF] text-brand"
                          : "text-primary border-transparent"
                      }`}
                      onClick={() => handleWebsiteTypeChange(value)}
                    >
                      {isSelected && (
                        <div className="absolute -top-6 -right-6 rotate-45 w-12 h-12 flex items-center justify-center bg-[#3664EF] text-white z-[9]">
                          <CheckOutlined
                            className="-rotate-45 translate-y-3.5 translate-x-0"
                            style={{ fontSize: 16 }}
                          />
                        </div>
                      )}
                      <div className="text-base">
                        {t(WEBSITE_TYPE_LABEL_MAP.get(value) || "")}
                      </div>
                      <div className="text-sm text-hint">
                        {t(WEBSITE_TYPE_DESC_MAP.get(value) || "")}
                      </div>
                    </li>
                  </VersionGuard>
                );
              })}
            </ul>
          </Form.Item>

          {/* Hide Logo Switch */}
          <Form.Item
            label={t("form_hide_logo")}
            name="copyright"
            valuePropName="checked"
            className="mt-7"
          >
            <Switch onChange={handleHideLogoSwitch} />
          </Form.Item>

          {/* Policy Fields - Private Prem Env Only */}
          {isPrivatePremEnv && (
            <>
              {/* Terms of Service */}
              <Form.Item label={t("login.service_agreement")}>
                <div className="w-full mb-2">
                  <Form.Item
                    name={["terms_of_service", "enabled"]}
                    valuePropName="checked"
                    noStyle
                  >
                    <Switch />
                  </Form.Item>
                </div>
                {termsEnabled && (
                  <Form.Item
                    name={["terms_of_service", "url"]}
                    noStyle
                    rules={[
                      {
                        validator: (_, value) =>
                          linkValidator(_, value, termsEnabled),
                      },
                    ]}
                  >
                    <Input
                      className="max-w-[660px]"
                      placeholder={t("form_input_placeholder")}
                      allowClear
                    />
                  </Form.Item>
                )}
              </Form.Item>

              {/* Privacy Policy */}
              <Form.Item label={t("login.privacy_policy")}>
                <div className="w-full mb-2">
                  <Form.Item
                    name={["privacy_policy", "enabled"]}
                    valuePropName="checked"
                    noStyle
                  >
                    <Switch />
                  </Form.Item>
                </div>
                {privacyEnabled && (
                  <Form.Item
                    name={["privacy_policy", "url"]}
                    noStyle
                    rules={[
                      {
                        validator: (_, value) =>
                          linkValidator(_, value, privacyEnabled),
                      },
                    ]}
                  >
                    <Input
                      className="max-w-[660px]"
                      placeholder={t("form_input_placeholder")}
                      allowClear
                    />
                  </Form.Item>
                )}
              </Form.Item>

              {/* AI Privacy Policy */}
              <Form.Item label={t("login.ai_privacy_policy")}>
                <div className="w-full mb-2">
                  <Form.Item
                    name={["ai_privacy_policy", "enabled"]}
                    valuePropName="checked"
                    noStyle
                  >
                    <Switch />
                  </Form.Item>
                </div>
                {aiPrivacyEnabled && (
                  <Form.Item
                    name={["ai_privacy_policy", "url"]}
                    noStyle
                    rules={[
                      {
                        validator: (_, value) =>
                          linkValidator(_, value, aiPrivacyEnabled),
                      },
                    ]}
                  >
                    <Input
                      className="max-w-[660px]"
                      placeholder={t("form_input_placeholder")}
                      allowClear
                    />
                  </Form.Item>
                )}
              </Form.Item>
            </>
          )}
          {/* Version Info */}
          <Divider style={{ margin: "12px 0" }} />
          <Form.Item label={t("version.title")}>
            <div className="text-base text-primary">
              {t(`website_version.${enterpriseInfo.version_name}`)}{" "}
              {
                websiteType !== WEBSITE_TYPE.INDEPENDENT && checkVersion(VERSION_MODULE.INTERNAL_USER) && (
                  <>
                    <span>{internalUserCount}</span> / {maxLimit} {t("internal_user.account.title")}
                  </>
                )
              }
              |{" "} {enterpriseInfo.expired_time || t("apply.expired_time_forever")} { enterpriseInfo.expired_time && t('internal_user.account.expired')}
              {enterpriseInfo.version <= WEBSITE_VERSION.ENTERPRISE &&  !isPrivatePremEnv && !isOpLocalEnv && (
                <Button
                  type="link"
                  className="text-base"
                  onClick={() => openUpgradeDialog()}
                >
                  {t("action_upgrade_renewal")}
                </Button>
                )}
            </div>
          </Form.Item>
        </Form>
      </div>
      <Divider style={{ margin: "12px 0" }} />
      <div>
        <Button type="primary" loading={loading} onClick={handleSave}>
          {t("action_save")}
        </Button>
      </div>

      {/* Service Dialog */}
      <ServiceDialog
        open={serviceDialogOpen}
        title={serviceDialogTitle}
        onClose={() => setServiceDialogOpen(false)}
      />
    </div>
  );
}

export default InfoPage;
