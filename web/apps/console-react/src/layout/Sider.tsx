import { RightOutlined } from "@ant-design/icons";
import { Layout, Menu, Tooltip } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { SvgIcon } from "@km/shared-components-react";
import { getRealPath } from "@/utils/config";
import {
    menuTree,
    type MenuItemConfig,
    type VisibilityContext,
    getVisibleChildren,
    isMenuVisible,
} from "../router/menu-config";
import { useChannelStore, useEnterpriseStore, useUserStore } from "@/stores";
import { useEnv } from "@/hooks/useEnv";
import { t } from "@/locales";
import "./sider.css";

export type SiderProps = {
  siderHidden?: boolean;
};

export function SiderMenu(props: SiderProps) {
  const { siderHidden = false } = props;
  const navigate = useNavigate();
  const location = useLocation();

  const { isOpLocalEnv, isWorkEnv } = useEnv();
  const enterpriseStore = useEnterpriseStore();
  const userStore = useUserStore();
  const loadModelConfig = useChannelStore((state) => state.loadModelConfig);

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [openKeys, setOpenKeys] = useState<string[]>(["/agent"]);

  const enterpriseInfo = enterpriseStore.info;

  const visibilityCtx: VisibilityContext = useMemo(
    () => ({
      eid: enterpriseInfo.eid ?? "",
      isOpLocalEnv,
      isWorkEnv,
      isIndependent: Boolean(enterpriseInfo.is_independent),
      isIndustry: Boolean(enterpriseInfo.is_industry),
      isEnterprise: Boolean(enterpriseInfo.is_enterprise),
    }),
    [enterpriseInfo, isOpLocalEnv, isWorkEnv],
  );

  const visibleMenuItems: MenuItemConfig[] = useMemo(
    () => menuTree.filter((item) => isMenuVisible(item, visibilityCtx)),
    [visibilityCtx],
  );

  // 使用完整路径匹配菜单选中状态，对齐 Vue 版本的 el-menu 行为
  // 对于 /user/* 路由，需要精确匹配菜单项 key
  const selectedKey = useMemo(() => {
    const pathname = location.pathname;
    // /user/admin 或 /user 路径统一选中 /user/admin 菜单项
    if (pathname === '/user' || pathname === '/user/admin') {
      return '/user/admin';
    }
    return pathname;
  }, [location.pathname]);

  useEffect(() => {
    const paths = location.pathname.match(/\/[^/]+/g) || [""];
    const openedMenu = paths[0] || "";
    setOpenKeys((prev) => {
      const next = new Set<string>(prev);
      if (openedMenu) next.add(openedMenu);
      next.add("/agent");
      return Array.from(next);
    });
  }, [location.pathname]);

  useEffect(() => {
    void loadModelConfig();
  }, []);

  if (siderHidden) return null;

  const width = isCollapsed ? 50 : 232;

  return (
    <Layout.Sider
      width={width}
      collapsedWidth={50}
      collapsed={isCollapsed}
      theme="light"
      trigger={null}
      className="transition-all duration-200 overflow-hidden"
      style={{ background: "#F7F9FC" }}
    >
      <div className="flex flex-col flex-1 h-full">
        <div
          className={[
            "flex-none flex items-center pt-8 pb-5",
            isCollapsed ? "justify-center" : "justify-between pl-7 pr-4",
          ].join(" ")}
        >
          {!isCollapsed ? (
            <img
              className="h-8 object-contain"
              src={getRealPath("/images/km-logo.png")}
              alt=""
            />
          ) : null}

          <div
            className="h-8 size-4 flex items-center justify-center cursor-pointer"
            onClick={() => setIsCollapsed((v) => !v)}
          >
            <SvgIcon name="left-bar" color="#888994" size={16} />
          </div>
        </div>

        <div
          className="flex-1 border-t overflow-y-auto py-4"
          style={{ scrollbarWidth: "none" as any }}
        >
          <div className={isCollapsed ? "" : "mx-4"}>
            {/* 顶级无 children 的菜单项 */}
            <Menu
              mode="inline"
              className="sider-menu"
              inlineCollapsed={isCollapsed}
              selectedKeys={[selectedKey]}
              openKeys={openKeys}
              onOpenChange={(keys) => setOpenKeys(keys as string[])}
              style={{ background: "transparent", borderInlineEnd: "none" }}
              items={visibleMenuItems
                .filter((i) => !i.children)
                .map((i) => ({
                  key: i.path,
                  icon: i.icon ? (
                    <SvgIcon className="flex-none" name={i.icon} size={16} />
                  ) : undefined,
                  label: t(i.title ?? ""),
                  style: {
                    height: "36px",
                    margin: isCollapsed ? "0 auto" : "0",
                    paddingLeft: isCollapsed ? "12px" : "10px",
                  },
                  onClick: () => navigate(i.path),
                }))}
            />

            {/* 分组 children（按 console 的渲染方式：分组标题 + 子项平铺） */}
            {visibleMenuItems
              .filter((i) => i.children && i.children.length)
              .map((group) => {
                const children = getVisibleChildren(group, visibilityCtx);
                if (!children.length) return null;
                return (
                  <div key={group.name} className="mt-4">
                    {!isCollapsed ? (
                      <div className="h-9 flex items-center text-xs px-[10px] text-hint">
                        {t(group.title ?? "")}
                      </div>
                    ) : null}
                    <Menu
                      className="sider-menu"
                      mode="inline"
                      inlineCollapsed={isCollapsed}
                      selectedKeys={[selectedKey]}
                      style={{
                        background: "transparent",
                        borderInlineEnd: "none",
                      }}
                      items={children.map((child) => ({
                        key: child.path,
                        icon: child.icon ? (
                          <SvgIcon
                            className="flex-none"
                            name={child.icon}
                            size={16}
                          />
                        ) : undefined,
                        label: t(child.title ?? ""),
                        style: {
                          height: "36px",
                          margin: isCollapsed ? "0 auto" : "0",
                          paddingLeft: isCollapsed ? "12px" : "10px",
                        },
                        onClick: () => navigate(child.path),
                      }))}
                    />
                  </div>
                );
              })}
          </div>
        </div>

        <div
          className={[
            "flex-none flex flex-col pt-2 px-4 pb-6 border-t",
            isCollapsed ? "items-center px-0" : "",
          ].join(" ")}
          style={{ background: "#F7F9FC" }}
        >
          <Tooltip
            title={t("function_update")}
            placement="right"
            open={isCollapsed ? undefined : false}
          >
            <div
              className={[
                "h-9 flex items-center gap-2 px-[10px] mb-[10px] rounded-lg cursor-pointer hover:bg-[#EBF3FF]",
                isCollapsed ? "justify-center px-0" : "",
              ].join(" ")}
              onClick={() =>
                window.open(
                  "https://doc.53ai.com/%E5%85%A5%E9%97%A8/%E4%BA%A7%E5%93%81%E8%B7%AF%E7%BA%BF%E5%9B%BE.html",
                  "_blank",
                )
              }
            >
              <div className="size-4 flex items-center justify-center text-icon-default">
                <SvgIcon name="update" size={16} />
              </div>
              {!isCollapsed ? (
                <div className="flex-1 text-dark text-sm whitespace-nowrap">
                  {t("function_update")}
                </div>
              ) : null}
              {!isCollapsed ? (
                <RightOutlined style={{ fontSize: 12, color: "#707172" }} />
              ) : null}
            </div>
          </Tooltip>

          <Tooltip
            title={t("action_exit")}
            placement="right"
            open={isCollapsed ? undefined : false}
          >
            <div
              className={[
                "h-9 flex items-center gap-2 px-[10px] rounded-lg cursor-pointer hover:bg-[#EBF3FF]",
                isCollapsed ? "justify-center px-0" : "",
              ].join(" ")}
              onClick={(e) => {
                e.stopPropagation();
                userStore.logoff({ show_confirm: true, back_to_login: true });
              }}
            >
              <div className="size-4 flex items-center justify-center text-icon-default">
                <SvgIcon name="exit_v2" size={16} />
              </div>
              {!isCollapsed ? (
                <div className="flex-1 text-dark text-sm whitespace-nowrap">
                  {t("action_exit")}
                </div>
              ) : null}
            </div>
          </Tooltip>

          <div
            className={`flex items-center justify-start gap-2 px-5 mt-4 text-primary ${isCollapsed ? "invisible" : ""}`}
            style={{ fontSize: 10 }}
          >
            <span>POWERED BY</span>
            <img
              className="h-3 object-contain"
              src={getRealPath("/images/km-logo.png")}
              alt=""
            />
          </div>
        </div>
      </div>
    </Layout.Sider>
  );
}
