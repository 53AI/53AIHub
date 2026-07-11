import { useEffect, useRef, useState } from "react";
import { Spin, Button } from "antd";
import { api_host, official_id, getRealPath } from "@/utils/config";
import { useBasicLayout } from "@/hooks/useBasicLayout";

interface WeChatLoginProps {
  width?: string;
  height?: string;
  onOauthSuccess?: (data: {
    openid: string;
    nickname: string;
    unionid: string;
    access_token?: string;
  }) => void;
}

export function WeChatLogin(props: WeChatLoginProps) {
  const { width = "100%", height = "280px", onOauthSuccess } = props;
  const { isInMobile } = useBasicLayout();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loading, setLoading] = useState(false);

  const basePath =
    (import.meta.env.VITE_BASE_PATH as string | undefined) || "/console-react";

  const WECHAT_LOGIN_URL = `https://work.wescrm.com/wechat_oauth_login.html?plain=1&height=280&appid=wxbe904d4182458106&suiteid=53aihub&api=${encodeURIComponent(`${api_host}/api/saas/wechat/redirect`)}&redirect_url=${encodeURIComponent(`${location.origin}${basePath}/oauth_login.html`)}`;

  // 移动端微信登录 URL
  const handleMobileLogin = () => {
    const redirect_url =
      "https://api.ibos.cn" +
      `/v4/xbot/hubredirect?appid=${official_id}&state=wechat_redirect&redirecturl=${encodeURIComponent(`${location.origin}/?login_way=wechat_login`)}`;
    window.location.href = redirect_url;
  };

  useEffect(() => {
    if (isInMobile) return;

    setLoading(true);
    const timer = window.setInterval(() => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      const contentWindow: any =
        (iframe.contentWindow && (iframe.contentWindow as any)[0]) ||
        iframe.contentWindow;
      if (!contentWindow) return;
      try {
        const raw = contentWindow.sessionStorage.getItem("oauth_login_data");
        if (!raw) return;
        const oauthLoginData = JSON.parse(raw || "{}");
        const data = oauthLoginData || {};
        const params = data.params || {};
        const from = data.from || params.from || "";
        if (!from) return;
        const openid = data.openid || params.openid || "";
        const nickname = data.nickname || params.nickname || "";
        const unionid = data.unionid || params.unionid || "";
        const access_token = data.access_token || params.access_token || "";
        if (openid || access_token) {
          window.clearInterval(timer);
          onOauthSuccess?.({ openid, nickname, unionid, access_token });
        }
      } catch {
        // ignore
      }
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, [onOauthSuccess, basePath, isInMobile]);

  const handleLoad = () => {
    setLoading(false);
  };

  // 移动端 UI
  if (isInMobile) {
    return (
      <div
        style={{ height, width }}
        className="flex flex-col justify-center items-center"
      >
        <div className="w-[220px] h-[220px] border relative rounded-lg overflow-hidden">
          <img
            src={getRealPath("/images/login/wecom_login.png")}
            alt=""
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-white bg-opacity-90 flex justify-center items-center">
            <Button type="primary" danger onClick={handleMobileLogin}>
              {window.$t?.("login.immediate_login") || "立即登录"}
            </Button>
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-3 opacity-60">
          {window.$t?.("login.login_by_wechat") || "使用微信登录"}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full relative" style={{ height, width }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-10">
          <Spin />
        </div>
      )}
      <iframe
        ref={iframeRef}
        className="-translate-x-1.5 scale-[1] overflow-hidden"
        style={{ height, width }}
        scrolling="no"
        src={WECHAT_LOGIN_URL}
        frameBorder={0}
        onLoad={handleLoad}
      />
    </div>
  );
}

export default WeChatLogin;
