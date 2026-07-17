import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { setupGlobalConfig } from "./global";
import { setupChunkErrorHandler } from "@km/shared-utils";

import "./locales";

import "antd/dist/reset.css";
import "./styles/index.css";

// 尽早初始化 chunk 错误处理（在任何路由加载之前）
setupChunkErrorHandler();

// 异步加载 SVG 图标，加载完成后标记 window 状态
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

// Bootstrap the application
async function bootstrap() {
  setupGlobalConfig();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap();
