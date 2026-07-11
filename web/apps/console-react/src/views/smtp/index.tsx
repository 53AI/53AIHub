import { Switch, Card, message } from "antd";
import { useEffect, useState } from "react";
import { t } from "@/locales";
import { Header } from "@/components/Header";
import { useEnterpriseStore } from "@/stores";
import EmailForm from "./EmailForm";

const SMTP_TYPE = {
  EMAIL: "smtp",
  MOBILE: "mobile",
} as const;

export function SMTPPage() {
  const enterpriseStore = useEnterpriseStore();
  const [openEmail, setOpenEmail] = useState(false);
  const [openMobile, setOpenMobile] = useState(false);
  const [loading, setLoading] = useState(false);

  // Load SMTP config
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await enterpriseStore.loadSMTPInfo();
        if (config) {
          setOpenEmail(config.type === SMTP_TYPE.EMAIL && config.enabled);
          setOpenMobile(config.type === SMTP_TYPE.MOBILE && config.enabled);
        }
      } catch (error) {
        console.error("Load SMTP config error:", error);
      }
    };
    loadConfig();
  }, []);

  // Handle email switch change
  const handleOpenEmail = async (checked: boolean) => {
    if (!checked) {
      // Save config when disabling
      try {
        await enterpriseStore.saveSMTPInfo({
          data: {
            content: "",
            enabled: false,
            type: SMTP_TYPE.EMAIL,
          },
        });
        setOpenEmail(false);
      } catch (error) {
        console.error("Save SMTP config error:", error);
      }
    } else {
      setOpenEmail(true);
    }
  };

  // Handle mobile switch click
  const handleMobileClick = () => {
    message.warning(t("feature_coming_soon"));
  };

  return (
    <div className="px-[60px] py-8 h-full flex flex-col">
      <Header title={t("module.SMTP")} />

      <div className="flex-1 flex flex-col gap-4 bg-white p-6 mt-3 box-border overflow-y-auto">
        {/* Email log config */}
        <Card className="w-full">
          <div className="h-8 flex justify-between items-center">
            <p>{t("module.SMTP_email_log")}</p>
            <div className="flex items-center">
              <Switch checked={openEmail} onChange={handleOpenEmail} />
              <span className="ml-2">
                {openEmail ? t("action_enable") : t("action_close")}
              </span>
            </div>
          </div>

          {/* Email form */}
          {openEmail && <EmailForm />}
        </Card>

        {/* Mobile log config */}
        <Card className="w-full">
          <div className="h-16 flex justify-between items-center">
            <p>{t("module.SMTP_mobile_log")}</p>
            <div className="flex items-center">
              <Switch
                checked={openMobile}
                disabled
                onClick={handleMobileClick}
              />
              <span className="ml-2">
                {openMobile ? t("action_enable") : t("action_close")}
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default SMTPPage;
