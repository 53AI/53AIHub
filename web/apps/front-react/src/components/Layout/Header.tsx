import React, { useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Tooltip } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { useEnterpriseStore } from "@/stores/modules/enterprise";
import { checkPermission } from "@/utils/permission";
import { t } from "@/locales";
import { ExpandSidebarButton } from "./ExpandSidebarButton";
// import { Upgrade } from '@/components/Upgrade'

// 新增：面包屑项类型
export interface BreadcrumbItem {
  label: string;
  path?: string; // 可选，没有 path 则不可点击
}

interface LayoutHeaderProps {
  className?: string;
  mainClass?: string;
  sticky?: boolean;
  hideUser?: boolean;
  back?: boolean;
  onBack?: () => void;
  title?: string;
  border?: boolean;
  beforePrefix?: React.ReactNode;
  titlePrefix?: React.ReactNode;
  titleSuffix?: React.ReactNode;
  titleSlot?: React.ReactNode;
  after?: React.ReactNode;
  right?: React.ReactNode;
  expandSidebar?: boolean;
  // 新增
  breadcrumb?: BreadcrumbItem[];
}

export function Header({
  className = "",
  mainClass = "",
  sticky = false,
  hideUser = false,
  back = false,
  onBack,
  title = "",
  border = true,
  beforePrefix,
  titlePrefix,
  titleSuffix,
  titleSlot,
  after,
  right,
  expandSidebar = true,
  breadcrumb,
}: LayoutHeaderProps) {
  const navigate = useNavigate();
  const enterpriseStore = useEnterpriseStore();
  const upgradeRef = useRef<{
    open: () => void;
    close: () => void;
    validateUpgrade: () => Promise<boolean>;
  }>(null);

  useEffect(() => {
    // 初始化获取企业信息
    enterpriseStore.loadInfo();

    // 监听登录事件
    if (window.$chat53ai) {
      window.$chat53ai.$on(
        "agenthub:service",
        (
          _event: unknown,
          { type, data }: { type?: string; data?: unknown } = {},
        ) => {
          console.log(type, data);
          if (type === "login") {
            handleLogin();
          }
        },
      );
    }
  }, []);

  const handleLogin = async () => {
    await checkPermission();
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate(-1);
    }
  };

  // 新增：渲染面包屑
  const renderBreadcrumb = () => {
    if (!breadcrumb || breadcrumb.length === 0) return null;

    return (
      <div className="flex items-center gap-1 overflow-hidden">
        {breadcrumb.map((item, index) => {
          return (
            <React.Fragment key={index}>
              {index > 0 && (
                <RightOutlined
                  style={{ fontSize: 12 }}
                  className="text-regular flex-shrink-0"
                />
              )}
              {item.path ? (
                <Link
                  to={item.path}
                  className="text-sm text-[#6B7280] font-normal hover-text-theme truncate"
                >
                  {item.label}
                </Link>
              ) : (
                <span className="text-sm text-primary truncate">{item.label}</span>
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  return (
    <header
      className={`flex-none h-16 sticky top-0 z-10 bg-white ${border ? "border-b" : ""} ${className}`}
    >
      <div
        className={`mx-auto px-5 flex items-center justify-between h-full ${mainClass}`}
      >
        <div className="flex-1 flex items-center gap-2 overflow-hidden">
          { expandSidebar && <ExpandSidebarButton />}
          {beforePrefix}
          {back && (
            <Tooltip title={t("action.back")}>
              <div
                className="flex-none size-7 rounded-md flex items-center justify-center cursor-pointer max-md:hidden hover:bg-[#ECEDEE]"
                onClick={handleBack}
              >
                <LeftOutlined
                  className="text-regular cursor-pointer"
                  style={{ fontSize: 14 }}
                />
              </div>
            </Tooltip>
          )}
          {titlePrefix}
          {/* 新增：优先渲染 breadcrumb，否则渲染 titleSlot 或 title */}
          {breadcrumb ? (
            renderBreadcrumb()
          ) : titleSlot ? (
            titleSlot
          ) : (
            <div className="text-base text-primary line-clamp-1 max-md:flex-1 max-md:text-center">
              {title}
            </div>
          )}
          {titleSuffix}
        </div>

        <div className="flex items-center gap-2">{after || right}</div>
      </div>
      {/* todo: 引入后会报错 */}
      {/* <Upgrade ref={upgradeRef} /> */}
    </header>
  );
}

export default Header;
