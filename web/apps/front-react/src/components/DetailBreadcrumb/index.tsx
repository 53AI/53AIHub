import { Link } from "react-router-dom";
import { Breadcrumb } from "antd";
import { RightOutlined } from "@ant-design/icons";
import { useNavigationStore } from "@/stores/modules/navigation";
import { t } from "@/locales";

interface DetailBreadcrumbItem {
  /** 模块路径，如 /agent, /prompt, /skills */
  path: string;
  /** 国际化 key，如 module.agent, module.prompt, module.skill */
  i18nKey: string;
  /** 导航 store 中的 key，如 agentNavigation, promptNavigation */
  navKey?: "agentNavigation" | "promptNavigation" | "homeNavigation" | "knowledgeNavigation";
}

interface DetailBreadcrumbProps {
  /** 模块配置 */
  module: DetailBreadcrumbItem;
  /** 当前详情名称 */
  name: string;
  /** 额外的右侧内容 */
  extra?: React.ReactNode;
  /** 是否显示首页 */
  showHome?: boolean;
  className?: string
}

export function DetailBreadcrumb({
  module,
  name,
  extra,
  showHome = true,
  className = ""
}: DetailBreadcrumbProps) {
  const navigationStore = useNavigationStore();

  // 获取模块导航配置
  const moduleNav = module.navKey ? navigationStore[module.navKey] : null;

  const items = [];

  // 首页
  if (showHome) {
    const homeNav = navigationStore.homeNavigation;
    items.push({
      title: homeNav?.menu_path ? (
        <Link to={homeNav.menu_path}>
          <span className="text-regular font-normal hover-text-theme">
            {t("module.index")}
          </span>
        </Link>
      ) : (
        <span className="text-regular font-normal">{t("module.index")}</span>
      ),
    });
  }

  // 模块
  items.push({
    title: moduleNav?.menu_path ? (
      <Link to={moduleNav.menu_path}>
        <span className="text-regular font-normal hover-text-theme">
          {t(module.i18nKey)}
        </span>
      </Link>
    ) : (
      <Link to={module.path}>
        <span className="text-regular font-normal hover-text-theme">
          {t(module.i18nKey)}
        </span>
      </Link>
    ),
  });

  // 当前详情名称
  items.push({
    title: (
      <span
        className="text-primary inline-block truncate max-w-[10em]"
        title={name}
      >
        {name}
      </span>
    ),
  });

  return (
    <div className={`relative w-full flex items-center gap-4 box-border ${ className }`}>
      <Breadcrumb
        className="flex-1 w-0"
        separator={<RightOutlined style={{ fontSize: 12 }} className="inline-flex items-center relative" />}
        items={items}
      />
      {extra}
    </div>
  );
}

// 预设模块配置
export const MODULE_CONFIGS = {
  agent: {
    path: "/agent",
    i18nKey: "module.agent",
    navKey: "agentNavigation" as const,
  },
  prompt: {
    path: "/prompt",
    i18nKey: "module.prompt",
    navKey: "promptNavigation" as const,
  },
  skill: {
    path: "/skills",
    i18nKey: "module.skill",
  },
};

export default DetailBreadcrumb;
