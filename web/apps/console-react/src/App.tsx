import { useEffect } from "react";
import { ConfigProvider, App as AntApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import zhTW from "antd/locale/zh_TW";
import enUS from "antd/locale/en_US";
import jaJP from "antd/locale/ja_JP";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import "dayjs/locale/zh-tw";
import "dayjs/locale/en";
import "dayjs/locale/ja";
import { AppRouter } from "./router";
import {
  useChannelStore,
  useEnterpriseStore,
  useLocaleStore,
  useUserStore,
} from "@/stores";
import { useEnv } from "@/hooks/useEnv";
import { useMultiAccountGuard } from "@/hooks/useMultiAccountGuard";
import { eventBus } from "@km/shared-utils";
import { gotoLogin } from "./router/guards";
import settingApi from "./api/modules/setting";

// antd locale 映射
const antdLocaleMap = {
  "zh-cn": zhCN,
  "zh-tw": zhTW,
  "en": enUS,
  "ja": jaJP,
};

// dayjs locale 映射
const dayjsLocaleMap = {
  "zh-cn": "zh-cn",
  "zh-tw": "zh-tw",
  "en": "en",
  "ja": "ja",
};

export function App() {
  const { isOpLocalEnv, isPrivatePremEnv } = useEnv();
  const enterpriseStore = useEnterpriseStore();
  const userStore = useUserStore();
  const locale = useLocaleStore((s) => s.locale);

  // 多账号登录冲突检测
  useMultiAccountGuard();

  // 清理 URL 中空的 ?（如 /console?#/index），避免企微 opendata 初始化失败
  useEffect(() => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;

    const { href, origin, pathname, hash, search } = window.location;
    // 登录后检查原始 URL 中是否有 ?# 模式
    if (href.includes('?') && !search) {
      window.history.replaceState(null, '', `${origin}${pathname}${hash}`);
    }
  }, []);

  // 动态切换 dayjs locale
  useEffect(() => {
    dayjs.locale(dayjsLocaleMap[locale] || "zh-cn");
  }, [locale]);

  const handleLoginExpired = async () => {
    await userStore.logoff();
    gotoLogin();
  };

  const insertScript = (content: string) => {
    if (!content) return;

    const trimmed = content.trim();
    const node = document.createElement("div");
    node.innerHTML = trimmed;
    const scripts = node.querySelectorAll("script");

    if (scripts.length) {
      scripts.forEach((script) => {
        const newScript = document.createElement("script");
        Array.from(script.attributes).forEach((attr) => {
          newScript.setAttribute(attr.name, attr.value);
        });

        if (!script.src) {
          newScript.type = "text/javascript";
          newScript.appendChild(document.createTextNode(script.innerHTML));
        }
        document.body.appendChild(newScript);
      });
    } else {
      const newScript = document.createElement("script");
      newScript.type = "text/javascript";
      newScript.appendChild(document.createTextNode(content));
      document.body.appendChild(newScript);
    }
  };

  useEffect(() => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    // 并行加载企业信息和用户信息，减少首屏等待时间
    Promise.all([
      enterpriseStore.loadSelfInfo(),
      userStore.loadSelfInfo(),
      useChannelStore.getState().loadModelConfig(),
    ]).catch(console.error);
  }, []);

  useEffect(() => {
    if (isOpLocalEnv || isPrivatePremEnv) {
      settingApi.detail("third_party_statistic").then((res: any) => {
        const items = {
          script:
            res?.data?.find(
              (item: any) => item.key === "third_party_statistic_header",
            )?.value || "",
        };
        insertScript(items.script);
      });
    }
  }, [isOpLocalEnv, isPrivatePremEnv]);

  eventBus.on("user-login-expired", handleLoginExpired);
  return (
    <ConfigProvider
      locale={antdLocaleMap[locale] || zhCN}
      modal={{
        centered: true,
        mask: { closable: false },
      }}
    >
      <AntApp className="h-full overflow-hidden flex">
        <AppRouter />
      </AntApp>
    </ConfigProvider>
  );
}
