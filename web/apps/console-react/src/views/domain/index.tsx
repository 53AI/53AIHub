import { Input, Button, Tag, message, Spin, Modal } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import { useEffect, useState, useRef } from "react";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import { useEnterpriseStore } from "@/stores";
import { copyToClip } from "@km/shared-utils";
import { domainApi } from "@/api/modules/domain";
import { DOMAIN_SUFFIX } from "@/constants/domain";
import { VERSION_MODULE } from "@/constants/enterprise";
import { useVersion } from "@/hooks";
import { VersionGuard } from "@/components/VersionGuard";
import ExclusiveSettingDialog, {
    ExclusiveSettingDialogRef,
} from "./ExclusiveSettingDialog";
import IndependentSettingDialog, {
    IndependentSettingDialogRef,
} from "./IndependentSettingDialog";

type DomainConfig = {
  enable_https?: string | number;
  [key: string]: unknown;
};

type DomainInfo = {
  id?: number;
  domain?: string;
  domain_name?: string;
  config?: string | DomainConfig;
  [key: string]: unknown;
};

type IndependentDomainInfo = {
  httpsEnabled: boolean;
  domainName: string;
  rawData: DomainInfo;
};

export function DomainPage() {
  const enterpriseStore = useEnterpriseStore();

  const { guard: guardDomainVersion } = useVersion({
    module: VERSION_MODULE.INDEPENDENT_DOMAIN,
    mode: "dialog",
    content: t("version.not_support"),
  });

  const exclusiveSettingRef = useRef<ExclusiveSettingDialogRef>(null);
  const independentSettingRef = useRef<IndependentSettingDialogRef>(null);

  const [loading, setLoading] = useState(false);
  const [exclusiveDomainInfo, setExclusiveDomainInfo] = useState<DomainInfo>(
    {},
  );
  const [independentDomainInfo, setIndependentDomainInfo] =
    useState<IndependentDomainInfo>({
      httpsEnabled: false,
      domainName: "",
      rawData: {},
    });
  const exclusiveDomainUrl = exclusiveDomainInfo.domain_name
    ? `https://${exclusiveDomainInfo.domain_name}${DOMAIN_SUFFIX}`
    : "";

  const independentDomainUrl = independentDomainInfo.domainName
    ? `http${independentDomainInfo.httpsEnabled ? "s" : ""}://${independentDomainInfo.domainName}`
    : "";

  const processExclusiveDomainData = (domainData: DomainInfo) => {
    const info = { ...domainData };
    if (domainData.domain) {
      const domainName = domainData.domain
        .trim()
        .replace(/^https?:\/\//, "")
        .replace(new RegExp(DOMAIN_SUFFIX), "");
      info.domain_name = domainName;
    }
    setExclusiveDomainInfo(info);
  };

  const processIndependentDomainData = (domainData: DomainInfo) => {
    const rawData = { ...domainData };

    let config: DomainConfig = {};
    if (domainData.config) {
      try {
        config =
          typeof domainData.config === "string"
            ? JSON.parse(domainData.config)
            : domainData.config;
      } catch (error) {
        console.error("解析独立域名配置失败:", error);
        config = {};
      }
    }

    rawData.config = config;

    const domainName = (domainData.domain || "")
      .trim()
      .replace(/^https?:\/\//, "");
    const httpsEnabled = Boolean(Number(config.enable_https));

    setIndependentDomainInfo({
      httpsEnabled,
      domainName,
      rawData,
    });
  };

  const loadDomainData = async () => {
    setLoading(true);

    try {
      const { exclusive_domains = [], independent_domains = [] } =
        await domainApi.list();

      processExclusiveDomainData(exclusive_domains[0] || {});
      processIndependentDomainData(independent_domains[0] || {});
    } catch (error) {
      console.error("加载域名数据失败:", error);
      message.error("加载域名数据失败");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyDomain = async (domainUrl: string) => {
    if (!domainUrl) {
      message.warning("没有可复制的域名");
      return;
    }

    try {
      await copyToClip(domainUrl);
      message.success(t("action_copy_success"));
    } catch (error) {
      console.error("复制失败:", error);
      message.error("复制失败");
    }
  };

  const handleOpenExclusiveSetting = () => {
    const settingData = {
      ...exclusiveDomainInfo,
      domain: exclusiveDomainUrl,
    };
    exclusiveSettingRef.current?.open({ data: settingData });
  };

  const handleOpenIndependentSetting = () => {
    independentSettingRef.current?.open({
      data: independentDomainInfo.rawData,
    });
  };

  const handleDeleteIndependentDomain = async () => {
    Modal.confirm({
      title: t("module.domain_independent_delete_confirm"),
      onOk: async () => {
        const domainId = independentDomainInfo.rawData.id;
        if (!domainId) {
          message.error("域名ID不存在");
          return;
        }

        try {
          await domainApi.deleteIndependent(domainId);

          setIndependentDomainInfo({
            httpsEnabled: false,
            domainName: "",
            rawData: {},
          });

          message.success(t("action_delete_success"));
        } catch (error) {
          console.error("删除独立域名失败:", error);
          message.error("删除失败");
        }
      },
    });
  };

  const handleIndependentSettingClick = () => {
    if (guardDomainVersion()) {
      handleOpenIndependentSetting();
    }
  };

  useEffect(() => {
    loadDomainData();
  }, []);

  return (
    <div className="flex flex-col bg-white px-2 box-border h-full overflow-y-auto">
      <Spin spinning={loading}>
        <div className="flex-1 max-h-[calc(100vh-100px)] overflow-auto">
          {/* 专属域名部分 */}
          <section className="mb-8">
            <h2 className="font-semibold text-base text-primary">
              {t("module.domain_exclusive")}
            </h2>
            <div className="mt-4 border rounded overflow-hidden p-6">
              <label className="text-primary text-sm">
                {t("module.domain_exclusive_label")}
              </label>
              <div className="w-full mt-4 flex items-center gap-3">
                <Input
                  value={exclusiveDomainUrl}
                  className="!max-w-[600px]"
                  placeholder={t("form_input_placeholder")}
                  disabled
                />
                <Button
                  className="flex-none text-brand"
                  onClick={() => handleCopyDomain(exclusiveDomainUrl)}
                >
                  <SvgIcon name="copy" color="#3664EF" width="12" height="12" />
                  {t("action_copy")}
                </Button>
                <div className="flex-1 h-2" />
                <Button
                  type="link"
                  className="flex-none text-link !p-0"
                  onClick={handleOpenExclusiveSetting}
                >
                  <SettingOutlined />
                  {t("action_setting")}
                </Button>
              </div>
            </div>
          </section>

          {/* 独立域名部分 */}
          <section>
            <h2 className="font-semibold text-base text-primary">
              {t("module.domain_independent")}
            </h2>
            <VersionGuard
              module={VERSION_MODULE.INDEPENDENT_DOMAIN}
              mode="tooltip"
              content={t("version.not_support")}
            >
              <div className="mt-4 border rounded overflow-hidden p-6">
              <label className="text-primary text-sm flex items-center gap-2">
                {t("module.domain_independent_label")}
                {independentDomainUrl && (
                  <>
                    <Tag className="!border-none !bg-[#E3F6E0] !text-[#09BB07]">
                      {t("effective")}
                    </Tag>
                    {independentDomainInfo.httpsEnabled && (
                      <Tag className="!border-none !bg-[#E3F6E0] inline-flex items-center gap-1 !text-[#09BB07]">
                        <SvgIcon name="global" width="12" height="12" />
                        {t("https_enabled")}
                      </Tag>
                    )}
                  </>
                )}
              </label>
              <div className="w-full mt-4 flex items-center gap-3">
                {independentDomainUrl ? (
                  <>
                    <Input
                      value={independentDomainUrl}
                      className="!max-w-[600px]"
                      placeholder={t("form_input_placeholder")}
                      disabled
                    />
                    <Button
                      className="flex-none text-brand"
                      onClick={() => handleCopyDomain(independentDomainUrl)}
                    >
                      <SvgIcon
                        name="copy"
                        color="#3664EF"
                        width="12"
                        height="12"
                      />
                      {t("action_copy")}
                    </Button>
                  </>
                ) : (
                  <div className="flex-1 text-sm text-disabled">
                    {t("module.domain_independent_desc")}
                  </div>
                )}
                <div className="flex-1 h-2" />
                <Button
                  type="link"
                  className="flex-none text-link !p-0"
                  onClick={handleIndependentSettingClick}
                >
                  <SettingOutlined />
                  {t("action_setting")}
                </Button>
                {independentDomainUrl && (
                  <Button
                    variant="link"
                    color="danger"
                    className="flex-none !p-0 !ml-0"
                    onClick={handleDeleteIndependentDomain}
                  >
                    <SvgIcon name="delete" />
                    {t("action_delete")}
                  </Button>
                )}
              </div>
            </div>
          </VersionGuard>
          </section>
        </div>
      </Spin>

      {/* 弹窗组件 */}
      <ExclusiveSettingDialog
        ref={exclusiveSettingRef}
        onSuccess={loadDomainData}
      />
      <IndependentSettingDialog
        ref={independentSettingRef}
        onSuccess={loadDomainData}
      />
    </div>
  );
}

export default DomainPage;
