import { useState, useEffect, useRef } from "react";
import { Steps, Form, Input, Select, Button, Spin } from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import enterpriseApi, { type InitRequest } from "@/api/modules/enterprise";
import { t } from "@/locales";
import { getEmailRules, getPasswordRules } from "@/utils/form-rules";
import { getPublicPath } from "@/utils/config";

const COUNTDOWN_DURATION = 3;
const COUNTDOWN_INTERVAL = 1000;

const PLATFORM_CONFIG = {
  17: {
    name: "阿里百炼",
    icon: getPublicPath("/images/platform/alibaba_bailian.png"),
    fields: ["baseURL", "apiKey"] as const,
    defaults: { baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    labels: { baseURL: "BaseURL", apiKey: "API Key" },
  },
  900: {
    name: "火山方舟",
    icon: getPublicPath("/images/platform/volcengine.png"),
    fields: ["baseURL", "apiKey"] as const,
    defaults: { baseURL: "https://ark.cn-beijing.volces.com/api/v3" },
    labels: { baseURL: "API Base", apiKey: "API Key" },
  },
  44: {
    name: "硅基流动",
    icon: getPublicPath("/images/platform/siliconflow.png"),
    fields: ["apiKey"] as const,
    defaults: {},
    labels: { apiKey: "API Key" },
  },
  skip: {
    name: '暂不配置（先完成初始化安装，后续在"后台-能力中心配置"）',
    icon: getPublicPath("/images/platform/other.png"),
    fields: [] as const,
    defaults: {},
    labels: {},
  },
} as const;

type PlatformKey = keyof typeof PLATFORM_CONFIG;

function StepAccount() {
  return (
    <>
      <Form.Item
        label={t("guide.website_info_name")}
        name="name"
        rules={[
          { required: true, message: t("guide.website_info_name_placeholder") },
        ]}
      >
        <Input
          size="large"
          placeholder={t("guide.website_info_name_placeholder")}
          maxLength={120}
          showCount
          allowClear
        />
      </Form.Item>
      <Form.Item
        label={t("form.account")}
        name="account"
        rules={[getEmailRules()]}
        required
      >
        <Input size="large" placeholder={t("form.email_format")} allowClear />
      </Form.Item>
      <Form.Item
        label={t("form.password")}
        name="password"
        rules={[getPasswordRules()]}
        required
      >
        <Input.Password
          size="large"
          placeholder={t("form.password_placeholder")}
        />
      </Form.Item>
      <Form.Item
        label={t("guide.confirm_password")}
        name="confirm_password"
        dependencies={["password"]}
        required
        rules={[
          getPasswordRules(),
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue("password") === value) {
                return Promise.resolve();
              }
              return Promise.reject(new Error(t("form.password_not_match")));
            },
          }),
        ]}
      >
        <Input.Password
          size="large"
          placeholder={t("guide.confirm_password_placeholder")}
        />
      </Form.Item>
    </>
  );
}

interface StepPlatformProps {
  platform: PlatformKey;
  onPlatformChange: (value: PlatformKey) => void;
}

function StepPlatform({ platform, onPlatformChange }: StepPlatformProps) {
  const config = PLATFORM_CONFIG[platform];

  return (
    <>
      <Form.Item label={t("guide.platform")} required>
        <Select
          size="large"
          value={platform}
          onChange={(value: PlatformKey) => onPlatformChange(value)}
          placeholder={t("guide.platform_placeholder")}
        >
          {Object.entries(PLATFORM_CONFIG).map(([key, cfg]) => (
            <Select.Option key={key} value={key}>
              <div className="flex items-center gap-2">
                {cfg.icon && (
                  <img
                    src={cfg.icon}
                    alt={cfg.name}
                    className="w-5 h-5 rounded"
                  />
                )}
                <span>{cfg.name}</span>
              </div>
            </Select.Option>
          ))}
        </Select>
      </Form.Item>
      {platform !== "skip" &&
        config.fields.map((field) =>
          field === "baseURL" ? (
            <Form.Item
              key={field}
              label={config.labels.baseURL}
              name="baseURL"
              rules={[
                { required: true, message: t("guide.base_url_placeholder") },
              ]}
            >
              <Input
                size="large"
                placeholder={t("guide.base_url_placeholder")}
                allowClear
              />
            </Form.Item>
          ) : (
            <Form.Item
              key={field}
              label={config.labels.apiKey}
              name="apiKey"
              rules={[
                { required: true, message: t("guide.api_key_placeholder") },
              ]}
            >
              <Input.Password
                size="large"
                placeholder={t("guide.api_key_placeholder")}
              />
            </Form.Item>
          ),
        )}
      {platform == "skip" && (
        <img
          className="w-full max-w-[580px] block mx-auto"
          src={getPublicPath("/images/guide/platform_empty.png")}
        />
      )}
    </>
  );
}

interface StepSuccessProps {
  initializing: boolean;
  countdown: number;
  onJump: () => void;
}

function StepSuccess({ initializing, countdown, onJump }: StepSuccessProps) {
  if (initializing) {
    return (
      <div className="flex flex-col items-center justify-center py-10">
        <LoadingOutlined style={{ fontSize: "18px" }} />
        <p className="mt-4 text-sm text-[#202945]">{t("guide.initializing")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-10">
      <LoadingOutlined style={{ fontSize: "18px" }} />

      <p
        className="text-sm text-[#202945] mt-4"
        dangerouslySetInnerHTML={{
          __html: t("guide.jump_tip", {
            count: `<span style='color: #3664EF; font-weight: 500'>${countdown}</span>`,
          }),
        }}
      />
      <Button color="primary" variant="link" className="mt-3" onClick={onJump}>
        {t("guide.enter_system")} &gt;
      </Button>
    </div>
  );
}

interface Step1Values {
  name: string;
  account: string;
  password: string;
}

export function GuideView() {
  const [form] = Form.useForm();
  const [currentStep, setCurrentStep] = useState(1);
  const [countdown, setCountdown] = useState(COUNTDOWN_DURATION);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [platform, setPlatform] = useState<PlatformKey>("17");
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const step1ValuesRef = useRef<Step1Values | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const startJumpCountdown = () => {
    setCountdown(COUNTDOWN_DURATION);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          window.location.href = "/";
          return 0;
        }
        return prev - 1;
      });
    }, COUNTDOWN_INTERVAL);
  };

  const doInit = async () => {
    const values = await form.validateFields();
    const step1Values = step1ValuesRef.current;
    if (!step1Values) {
      throw new Error("步骤1数据丢失");
    }
    const requestData: InitRequest = {
      enterprise: { enterprise_name: step1Values.name },
      user: {
        account_name: step1Values.account,
        password: step1Values.password,
      },
    };

    if (platform !== "skip") {
      requestData.channel = {
        type: Number(platform),
        key: values.apiKey,
      };
      if (values.baseURL) {
        requestData.channel.base_url = values.baseURL;
      }
    }

    const res = await enterpriseApi.init(requestData);
    // 保存 token 实现自动登录
    localStorage.setItem("access_token", res.access_token);
    localStorage.setItem(
      "user_info",
      JSON.stringify({ access_token: res.access_token, user_id: res.user_id }),
    );
    setInitializing(false);
    startJumpCountdown();
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      if (currentStep === 1) {
        const values = await form.validateFields([
          "name",
          "account",
          "password",
          "confirm_password",
        ]);
        step1ValuesRef.current = {
          name: values.name,
          account: values.account,
          password: values.password,
        };
        setCurrentStep(2);
        return;
      }

      await form.validateFields();
      setInitializing(true);
      setCurrentStep(3);
      await doInit();
    } catch {
      setInitializing(false);
    } finally {
      setLoading(false);
    }
  };

  const handlePrev = () => setCurrentStep((s) => s - 1);

  const handlePlatformChange = (value: PlatformKey) => {
    setPlatform(value);
    const config = PLATFORM_CONFIG[value];
    form.setFieldsValue({
      baseURL: config.defaults.baseURL || "",
      apiKey: "",
    });
  };

  const stepItems = [
    { title: t("guide.website_info") },
    { title: t("guide.platform_access") },
    { title: t("guide.website_success") },
  ];

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-[#F5F7FF] to-[#FFFFFF]">
      <div className="px-4 py-6 sm:px-12 sm:py-10">
        <img
          className="h-10 sm:h-[65px]"
          src={getPublicPath("/images/logo2.png")}
        />
      </div>
      <div className="w-full sm:w-[90%] lg:w-[65%] mx-auto pt-6 sm:pt-10 px-4 sm:px-8">
        <div className="flex flex-col gap-3 items-center">
          <h3 className="text-2xl sm:text-[32px] font-bold text-center">
            {t("guide.title")}
          </h3>
          <p className="text-sm text-[#2029459e] text-center">
            {t("guide.description")}
          </p>
        </div>

        <Steps
          className="mt-8 sm:mt-12"
          current={currentStep - 1}
          size="small"
          titlePlacement="vertical"
          items={stepItems}
          classNames={{
            itemIcon: "",
          }}
          style={{
            "--ant-cmp-steps-icon-size": "28px",
          }}
          styles={{
            itemIcon: {
              "--ant-cmp-steps-item-icon-text-color": "white",
              "--ant-cmp-steps-item-icon-bg-color": "#D2D1D3",
              "--ant-cmp-steps-icon-border-width": "4px",
              "--ant-cmp-steps-item-icon-border-color": "#F2F3F2",
              "--ant-cmp-steps-item-icon-active-border-color": "#ECF4FC",
            },
          }}
        />

        <Form
          form={form}
          layout="vertical"
          className="flex flex-col mt-6 sm:mt-10"
        >
          {currentStep === 1 && <StepAccount />}
          {currentStep === 2 && (
            <StepPlatform
              platform={platform}
              onPlatformChange={handlePlatformChange}
            />
          )}
          {currentStep === 3 && (
            <StepSuccess
              initializing={initializing}
              countdown={countdown}
              onJump={() => (window.location.href = "/")}
            />
          )}
        </Form>

        {currentStep < 3 && (
          <div className="flex items-center gap-3 sm:gap-5 mt-6 sm:mt-8 pb-8">
            {currentStep === 2 && (
              <Button
                type="default"
                className="flex-1 h-11"
                shape="round"
                onClick={handlePrev}
              >
                {t("guide.prev")}
              </Button>
            )}
            <Button
              type="primary"
              className="flex-1 h-11"
              shape="round"
              loading={loading}
              onClick={handleSubmit}
            >
              {currentStep === 1 ? t("guide.next") : t("guide.init")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default GuideView;
