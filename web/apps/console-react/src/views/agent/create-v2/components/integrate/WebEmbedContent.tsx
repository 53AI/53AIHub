import { useState, useMemo, useEffect, useRef } from "react";
import { CopyOutlined } from "@ant-design/icons";
import { message, Button, Switch } from "antd";
import { useEnv } from "@/hooks/useEnv";
import { copyToClip, md5 } from "@km/shared-utils";
import { getPublicPath } from "@/utils/config";
import { generateSignParams } from "@/api/signature";
import { SvgIcon } from "@km/shared-components-react";
import { useUserStore } from "@/stores";
import enterpriseApi from "@/api/modules/enterprise";
import { t } from "@/locales";

interface WebEmbedContentProps {
  agentId?: string | number;
  agentName?: string;
  agentLogo?: string;
  title: string;
  sso?: boolean;
  fixedToken?: string;
}

export const WebEmbedContent = ({ agentId, agentName, agentLogo, title, sso, fixedToken }: WebEmbedContentProps) => {
  const { getFrontBaseUrl } = useEnv();
  const userStore = useUserStore();
  const [encryptEnabled, setEncryptEnabled] = useState(false);
  const [secret, setSecret] = useState<string>(() => generateSignParams().sign);
  const [timestamp, setTimestamp] = useState<number>(Math.floor(Date.now() / 1000));
  const [ssoConfigured, setSsoConfigured] = useState<boolean | null>(null);
  const [ssoEnabled, setSsoEnabled] = useState(false);

  const frontBaseUrl = getFrontBaseUrl();

  useEffect(() => {
    if (sso) {
      enterpriseApi.enterprise_config("auth_sso").then((res: any) => {
        const { data } = res || {};
        const raw = data?.content;
        const content = raw ? JSON.parse(raw) : undefined;
        setSsoConfigured(Boolean(content?.secret));
        setSsoEnabled(Boolean(data?.enabled));
        // Load encryption settings from saved config
        setEncryptEnabled(Boolean(content?.encrypt_enabled));
        if (content?.secret) {
          setSecret(content.secret);
        }
      });
    }
  }, [sso]);

  const username = useMemo(() => {
    const info = userStore.info as any;
    return info.mobile || info.email || "";
  }, [userStore.info]);


  const handleRecreateSecret = async () => {
    const newSecret = generateSignParams().sign;
    setSecret(newSecret);
    setTimestamp(Math.floor(Date.now() / 1000));
    await saveConfig(newSecret, encryptEnabled);
  };

  // Debounced save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const saveConfig = async (secretValue: string, encryptValue: boolean) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(async () => {
      try {
        const content = {
          encrypt_enabled: encryptValue,
          secret: secretValue,
        };
        await enterpriseApi.save_enterprise_config("auth_sso", {
          content: JSON.stringify(content),
          enabled: true,
        });
        setSsoEnabled(true);
        message.success(t("sso.save_success"));
      } catch {
      }
    }, 500);
  };

  const handleToggleEncrypt = async (checked: boolean) => {
    setEncryptEnabled(checked);
    await saveConfig(secret, checked);
  };

  const handleToggleSso = async () => {
    window.open('#/sso')
  }

  // Build URL with token and optional SSO params
  const agentPluginUrl = useMemo(() => {
    if (!agentId || !fixedToken) return "";

    let url = `${frontBaseUrl}/agentplugin?token=${fixedToken}`;

    if (sso && ssoEnabled && username) {
      url += `&username=${encodeURIComponent(username)}`;
      if (encryptEnabled && secret) {
        const sign = md5(`timestamp=${timestamp}&username=${username}${secret}`);
        url += `&timestamp=${timestamp}&sign=${sign}`;
      }
    }

    return url;
  }, [agentId, frontBaseUrl, fixedToken, sso, ssoEnabled, encryptEnabled, username, secret, timestamp]);

  const iframeCode = useMemo(() => {
    if (!fixedToken) {
      const baseUrl = sso
        ? `${frontBaseUrl}/agentplugin?token=${ fixedToken }&username=${ username }`
        : `${frontBaseUrl}/agentplugin?token=${ fixedToken }`;
      return `<iframe
  src="${baseUrl}"
  style="min-height: 700px"
  width="100%"
  height="100%">
</iframe>`;
    }
    return `<iframe
  src="${agentPluginUrl}"
  style="min-height: 700px"
  width="100%"
  height="100%">
</iframe>`;
  }, [agentPluginUrl, frontBaseUrl, fixedToken, username, sso]);

  const scriptCode = useMemo(() => {
    const config: any = {
      token: fixedToken || "YOUR_TOKEN",
      name: agentName || "AI Assistant",
      logo: agentLogo || "https://kmapi.53ai.com/api/images/agent/prompt.png",
    };

    if (sso && ssoEnabled && username) {
      config.username = username;
      if (encryptEnabled && secret) {
        const sign = md5(`timestamp=${timestamp}&username=${username}${secret}`);
        config.timestamp = timestamp;
        config.sign = sign;
      }
    }

    return `<script>
window.__AGENT_PLUGIN_SDK_CONFIG__ = ${JSON.stringify(config, null, 2)}
</script>
<script src="${frontBaseUrl}/agent-plugin-sdk.iife.js"></script>`;
  }, [agentId, agentName, agentLogo, frontBaseUrl, fixedToken, sso, username, ssoEnabled, encryptEnabled, secret, timestamp]);

  const handleCopy = async (text: string) => {
    const success = await copyToClip(text);
    if (success) {
      message.success(t("action_copy_success"));
    } else {
      message.error(t("action_save_failed"));
    }
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-medium text-primary">{title}</h2>
          {sso && (
            <div className="flex items-center gap-4">
              {(ssoConfigured === false || !ssoEnabled) && (
                <Button type="link" className="px-0" onClick={handleToggleSso}> {t('integrate.go_setting')}
                </Button>
              )}
              {encryptEnabled && ssoEnabled && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-secondary">Secret</span>
                  <span className="text-sm text-primary " title={secret}>
                    {secret}
                  </span>
                  <Button
                    type="text"
                    size="small"
                    className="p-0"
                    onClick={() => handleCopy(secret)}
                  >
                    <SvgIcon name="copy" className="w-4 h-4" />
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    className="p-0"
                    onClick={handleRecreateSecret}
                  >
                    {t("action_restart_generation")}
                  </Button>
                </div>
              )}
              {ssoEnabled && (<div className="flex items-center gap-1">
                <span className="text-sm text-secondary">{t("sso.enable_encryption").replace("：", "")}</span>
                <Switch
                  checked={encryptEnabled}
                  onChange={handleToggleEncrypt}
                />
              </div>)}
            </div>
          )}
      </div>

      <div className="mb-10">
        <div className="text-sm text-primary mb-4">
          {t('integrate.embed_step1')}
        </div>
        <div className="flex gap-6">
          <img
            src={getPublicPath("/images/agent/access-iframe.png")}
            alt="网页链接"
            className="w-64 h-80 rounded-lg shadow-md"
          />

          {/* Code block */}
          <div className="max-w-2xl">
            <div className="flex items-center justify-between bg-[#EDEFF2] px-4 py-2 rounded-t-lg">
              <span className="text-xs text-primary">
                {t('integrate.copy_embed_html')}
              </span>
              <button
                className="text-gray-400 hover:text-blue-500 transition-colors"
                onClick={() => handleCopy(iframeCode)}
              >
                <CopyOutlined />
              </button>
            </div>
            <div className="bg-[#F8F9FA] p-4 rounded-b-lg overflow-x-auto text-sm font-mono leading-relaxed flex-1">
              <pre className="whitespace-pre-wrap break-all text-gray-700">
                {iframeCode}
              </pre>
            </div>
            {sso && ssoEnabled && (
              <div className="mt-3 bg-[#F8F9FA] p-4 rounded-lg overflow-x-auto text-sm font-mono leading-relaxed flex-1">
                <div>{t('integrate.param_desc')}</div>
                <p>- {t('integrate.username_desc')}</p>
                { encryptEnabled && (
                  <>
                    <p>- {t('integrate.timestamp_desc')}</p>
                    <p>- {t('integrate.sign_desc')}</p>
                  </>
                  )
                }

              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <div className="text-sm text-primary mb-4">
          {t('integrate.embed_step2')}
        </div>
        <div className="flex gap-6">
          <img
            src={getPublicPath("/images/agent/access-bubble.png")}
            alt="网页链接"
            className="w-64 h-80 rounded-lg shadow-md"
          />

          {/* Code block */}
          <div className="max-w-2xl">
            <div className="flex items-center justify-between bg-[#EDEFF2] px-4 py-2 rounded-t-lg">
              <span className="text-xs text-primary">
                {t('integrate.copy_embed_body')}
              </span>
              <button
                className="text-gray-400 hover:text-blue-500 transition-colors"
                onClick={() => handleCopy(scriptCode)}
              >
                <CopyOutlined />
              </button>
            </div>
            <div className="bg-[#F8F9FA] p-4 rounded-b-lg overflow-x-auto text-sm font-mono leading-relaxed flex-1">
              <pre className="whitespace-pre-wrap break-all text-gray-700">
                {scriptCode}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
