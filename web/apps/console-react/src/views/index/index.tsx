import { Spin, Button } from "antd";
import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useEnterpriseStore, useUserStore } from "@/stores";
import { useLocaleStore } from "@/stores/modules/locale";
import { useEnv } from "@/hooks/useEnv";
import { Header } from "@/components/Header";
import { LanguageDropdown } from "@/components/LanguageDropdown";
import { SvgIcon } from "@km/shared-components-react";
import { ServiceDialog } from "@/components/ServiceDialog";
import { VERSION_MODULE } from "@/constants/enterprise";
import { useVersion } from "@/hooks";
import { t } from "@/locales";
import { getRealPath } from "@/utils/config";

type QuickLink = {
  name: string;
  icon: string;
  path: string;
  query?: Record<string, string>;
};

export function HomePage() {
  const navigate = useNavigate();
  const { getFrontHomeUrl, isOpLocalEnv, isPrivatePremEnv } = useEnv();
  const enterpriseStore = useEnterpriseStore();
  const userStore = useUserStore();
  const { canUse: canUseKnowledgeBase } = useVersion({ module: VERSION_MODULE.KNOWLEDGE_BASE });
  const { canUse: canUseAgent } = useVersion({ module: VERSION_MODULE.AGENT });
  // Subscribe to locale changes to trigger re-render
  const locale = useLocaleStore((state) => state.locale);
  const [loading, setLoading] = useState(false);
  const [indexInfo, setIndexInfo] = useState<Record<string, unknown>>({});
  const [serviceVisible, setServiceVisible] = useState(false);
  const [serviceType, setServiceType] = useState<"upgrade" | "renew">(
    "upgrade",
  );

  const year = new Date().getFullYear();
  const userInfo = userStore.info;
  const enterpriseInfo = enterpriseStore.info;
  const isSaasLogin = userStore.is_saas_login;

  // Domain URL with dev environment handling
  const domainUrl = useMemo(() => {
    return getFrontHomeUrl();
  }, [getFrontHomeUrl]);

  // Check if include KM module
  const includeKm = (window as any).$vars?.includeKm ?? true;

  // Quick links - same structure as Vue version
  const quickLinks = useMemo<QuickLink[]>(() => {
    const links: QuickLink[] = [
      {
        name: t("module.user_management"),
        icon: "avatar",
        path: "/user",
      },
    ];

    if (includeKm && canUseKnowledgeBase) {
      links.push(
        {
          name: t("space.title"),
          icon: "app-one",
          path: "/knowledge",
          query: { tab: "space" },
        },
        {
          name: t("module.document-setting"),
          icon: "file-settings",
          path: "/knowledge",
          query: { tab: "document-setting" },
        },
        {
          name: t("module.cleaning_pipeline"),
          icon: "whole-site-accelerator",
          path: "/knowledge",
          query: { tab: "cleaning-pipeline" },
        },
        {
          name: t("module.model_setting"),
          icon: "equalizer",
          path: "/knowledge",
          query: { tab: "model" },
        },
        {
          name: t("module.document_app"),
          icon: "all-application",
          path: "/knowledge",
          query: { tab: "assistant" },
        },
      );
    }

    links.push({
      name: t("module.platform_center"),
      icon: "find-one",
      path: "/platform",
    });

    if (includeKm && canUseKnowledgeBase) {
      links.push(
        {
          name: t("module.document_view_and_edit"),
          icon: "file-collection",
          path: "/platform",
          query: { tab: "viewer" },
        },
        {
          name: t("module.document_parse"),
          icon: "file-code",
          path: "/platform",
          query: { tab: "parse" },
        },
        {
          name: t("module.online_search"),
          icon: "sphere",
          path: "/platform",
          query: { tab: "online" },
        },
      );
    }

    return links;
  }, [includeKm, canUseKnowledgeBase, locale]);

  // Format number with commas
  const formatNumber = (num = 0) =>
    num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  // Get module max value
  const getModuleMax = (module: string) => {
    const max = enterpriseStore.version?.features?.[module]?.max;
    return max && max !== -1 ? max : "∞";
  };

  // Handle service dialog
  const handleService = (type: "upgrade" | "renew") => {
    setServiceType(type);
    setServiceVisible(true);
  };

  // Navigate with query params
  const handleQuickLinkClick = (item: QuickLink) => {
    if (item.query) {
      const queryString = new URLSearchParams(item.query).toString();
      navigate(`${item.path}?${queryString}`);
    } else {
      navigate(item.path);
    }
  };

  // Load home info on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const info = await enterpriseStore.loadHomeInfo();
        setIndexInfo(info || {});
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div className="h-full flex flex-col px-[60px] py-8">
      <Header title={t("module.homepage")} right={<LanguageDropdown />} />

      <Spin spinning={loading}>
        <div className="flex-1 flex gap-4 mt-4">
          {/* Left: Main content */}
          <div className="flex-1 min-w-0 px-16 py-10 bg-white rounded-lg overflow-y-auto">
            {/* Enterprise info */}
            <div className="flex items-center gap-4">
              {enterpriseInfo.logo && (
                <img
                  className="max-w-[180px] max-h-8 object-contain"
                  src={enterpriseInfo.logo}
                  alt=""
                />
              )}
              <h3 className="text-2xl text-primary font-semibold truncate">
                {enterpriseInfo.name}
              </h3>
              <SvgIcon
                className="cursor-pointer hover:opacity-60"
                name="edit"
                color="#2563EB"
                onClick={() => navigate("/config")}
              />
            </div>
            <div className="text-sm text-disabled mt-3">
              {enterpriseInfo.description || ""}
            </div>

            {/* Stats */}
            <div className="mt-10 flex flex-col gap-5">
              {/* Domain */}
              {(isSaasLogin || isOpLocalEnv || isPrivatePremEnv) && (
                <StatRow
                  label={
                    isOpLocalEnv || isPrivatePremEnv
                      ? t("website_home")
                      : t("website_domain")
                  }
                >
                  <div className="flex items-center gap-2">
                    <a
                      href={`${domainUrl}?access_token=${userInfo.access_token}&eid=${enterpriseInfo.eid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-primary"
                      style={{ fontSize: 16 }}
                    >
                      {domainUrl}
                      <SvgIcon
                        className="cursor-pointer ml-1"
                        name="blank"
                        width="16"
                        color="#2563EB"
                      />
                    </a>
                    {!isOpLocalEnv && !isPrivatePremEnv && (
                      <SvgIcon
                        className="cursor-pointer hover:opacity-60"
                        name="edit"
                        width="16"
                        color="#2563EB"
                        onClick={() => navigate("/config?tab=domain")}
                      />
                    )}
                  </div>
                </StatRow>
              )}

              {/* Agent */}
              {canUseAgent && (
                <StatRow label={t("module.agent")}>
                  {formatNumber(+indexInfo.agent_count || 0)} /{" "}
                  {getModuleMax(VERSION_MODULE.AGENT)}
                </StatRow>
              )}

              {/* Prompt */}
              <StatRow label={t("module.prompt")}>
                {formatNumber(+indexInfo.prompt_count || 0)} /{" "}
                {getModuleMax(VERSION_MODULE.PROMPT)}
              </StatRow>

              {/* AI Toolbox */}
              <StatRow label={t("module.ai_toolbox")}>
                {formatNumber(+indexInfo.ai_link_count || 0)} /{" "}
                {getModuleMax(VERSION_MODULE.AILINK)}
              </StatRow>

              {/* Knowledge Base - only when includeKm */}
              {includeKm && canUseKnowledgeBase && (
                <>
                  <StatRow label={t("space.name")}>
                    {formatNumber(+indexInfo.space_count || 0)} /{" "}
                    {getModuleMax(VERSION_MODULE.SPACE_COUNT)}
                  </StatRow>
                  <StatRow label={t("knowledge.name")}>
                    {formatNumber(+indexInfo.library_count || 0)} /{" "}
                    {getModuleMax(VERSION_MODULE.LIBRARY_COUNT)}
                  </StatRow>
                  <StatRow label={t("knowledge.file")}>
                    {formatNumber(+indexInfo.document_count || 0)} /{" "}
                    {getModuleMax(VERSION_MODULE.DOCUMENT_COUNT)}
                  </StatRow>
                </>
              )}

              {/* Registered User */}
              <StatRow label={t("register_user.title")}>
                {formatNumber(+indexInfo.user_count || 0)} /{" "}
                {getModuleMax(VERSION_MODULE.REGISTERED_USER)}
              </StatRow>

              {/* Create Time */}
              <StatRow label={t("create_time")}>
                {(enterpriseInfo.created_time || "").substr(0, 16)}
              </StatRow>

              {/* Version - only for SaaS login */}
              {isSaasLogin && (
                <StatRow label={t("version.title")}>
                  <div className="flex items-center gap-3">
                    <span>
                      {t(`website_version.${enterpriseInfo.version_name}`)}
                    </span>
                    {enterpriseInfo.version <= 3 && (
                      <Button
                        type="link"
                        className="text-base"
                        onClick={() => handleService("upgrade")}
                      >
                        {t("action_upgrade")}
                      </Button>
                    )}
                  </div>
                </StatRow>
              )}

              {/* Expired Time - only for SaaS login */}
              {isSaasLogin && (
                <StatRow label={t("service_expired_time")}>
                  <div className="flex items-center gap-3">
                    <span>
                      {enterpriseInfo.expired_time ||
                        t("apply.expired_time_forever")}
                    </span>
                    {enterpriseInfo.expired_time && (
                      <Button
                        type="link"
                        className="text-base"
                        onClick={() => handleService("renew")}
                      >
                        {t("action_renew_v2")}
                      </Button>
                    )}
                  </div>
                </StatRow>
              )}
            </div>
          </div>

          {/* Right: Sidebar */}
          <div className="flex-none w-[300px] flex flex-col gap-4 max-lg:hidden">
            {/* QR Code card */}
            <div className="w-full h-[200px] p-5 bg-white rounded-lg">
              <div className="w-full h-full flex flex-col items-center justify-center bg-[#F5F7FA] rounded-lg group cursor-pointer">
                <img
                  className="w-10 mb-4 transition-all duration-300 ease-in-out group-hover:hidden"
                  src={getRealPath("/images/index/wechat.png")}
                  alt=""
                />
                <img
                  className="w-[120px] h-[120px] mb-2 transition-all duration-300 ease-in-out hidden group-hover:block"
                  src={getRealPath("/images/index/qrcode.png")}
                  alt=""
                />
                <h6 className="text-base text-primary font-medium mb-2 group-hover:hidden">
                  {t("join_group")}
                </h6>
                <p className="text-sm text-placeholder group-hover:hidden">
                  {t("join_group_desc")}
                </p>
              </div>
            </div>

            {/* Quick links */}
            <div className="flex-1 bg-white rounded-lg p-5">
              <div className="text-base text-primary font-semibold mb-3">
                快速链接
              </div>
              <div className="flex flex-col gap-1.5">
                {quickLinks.map((item) => (
                  <div
                    key={item.path + JSON.stringify(item.query || {})}
                    className="h-9 flex items-center gap-2 px-3 cursor-pointer text-primary hover:bg-[#F5F7FA] rounded"
                    onClick={() => handleQuickLinkClick(item)}
                  >
                    <div className="size-4 flex items-center justify-center">
                      <SvgIcon name={item.icon} width="16px" />
                    </div>
                    <div className="flex-1 text-sm">{item.name}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Spin>

      <div className="text-sm text-disabled text-center py-11">
        {t("copyright_desc", { year })}
      </div>

      <ServiceDialog
        open={serviceVisible}
        title={
          serviceType === "upgrade"
            ? t("action_upgrade")
            : t("version.scan_consult")
        }
        onClose={() => setServiceVisible(false)}
      />
    </div>
  );
}

// Stat row component
function StatRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex max-md:gap-2 md:gap-8 max-md:flex-col md:items-center">
      <div className="flex-none w-[64px] text-base text-disabled">{label}</div>
      <div className="flex items-center gap-3">
        <div className="text-base text-primary">{children}</div>
      </div>
    </div>
  );
}

export default HomePage;
