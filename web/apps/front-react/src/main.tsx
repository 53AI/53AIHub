import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { App } from "./App";
import { setupRouter } from "./router";
import { setupGlobalMethods } from "./global/methods";
import { getEnvConfig } from "./api/modules/env-config";
import { setupChunkErrorHandler } from "@km/shared-utils";
import "./locales";

// Styles
import "antd/dist/reset.css";
import "./styles/index.css";
import "@km/hub-ui-x-react/index.css";

// 尽早初始化 chunk 错误处理（在任何路由加载之前）
setupChunkErrorHandler();

// 异步加载 SVG 图标
if (typeof window !== "undefined") {
  const loadSvgIcons = async () => {
    try {
      await import("virtual:svg-icons-register");
      (window as any).__svg_icons_loaded__ = true;
      window.dispatchEvent(new Event("svg-icons-loaded"));
    } catch (error) {
      console.warn("SVG图标加载失败:", error);
    }
  };

  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(loadSvgIcons, { timeout: 2000 });
  } else {
    setTimeout(loadSvgIcons, 2000);
  }
}

// Setup global methods
setupGlobalMethods();

/** 从后端拉取 env-config，写入 window 供 config 按需读取 */
async function fetchEnvConfig(): Promise<void> {
  try {
    const res = await getEnvConfig()
    if (res?.code === 0 && res?.data) {
      if (res.data.kk_base_url != null) {
        (window as any).kkfileview_url = res.data.kk_base_url
      }
    }
  } catch {
    // 静默失败，使用 .env 或默认值
  }
}

// Bootstrap the application
async function bootstrap() {
  // 先获取环境配置
  await fetchEnvConfig()

  // Setup router and wait for it to be ready
  await setupRouter();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ConfigProvider
        locale={zhCN}
        modal={{
          centered: true,
          mask: { closable: false },
        }}
      >
        <App />
      </ConfigProvider>
    </React.StrictMode>,
  );
}

bootstrap();
