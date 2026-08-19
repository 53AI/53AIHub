import { Link } from "react-router-dom";
import { Breadcrumb as AntdBreadcrumb } from "antd";
import { RightOutlined } from "@ant-design/icons";
import { useNavigationStore } from "@/stores/modules/navigation";
import { t } from "@/locales";

export interface BreadcrumbItem {
  path: string;
  i18nKey?: string;
  label?: React.ReactNode;
  navKey?: "agentNavigation" | "promptNavigation" | "homeNavigation" | "knowledgeNavigation";
  /** 强制让该项渲染为链接（默认仅中间项是链接，末项视为当前页不可点） */
  linkable?: boolean;
}

export interface BreadcrumbProps {
  module?: BreadcrumbItem;
  name?: string;
  items?: BreadcrumbItem[];
  extra?: React.ReactNode;
  showHome?: boolean;
  className?: string;
}

function getItemLabel(item: BreadcrumbItem) {
  return item.label ?? (item.i18nKey ? t(item.i18nKey) : "");
}

function renderItem(item: BreadcrumbItem, isLast: boolean) {
  const label = getItemLabel(item);
  const isLink = !isLast || item.linkable;
  const content = (
    <span
      className={`${isLink ? "text-regular font-normal hover-text-theme" : "text-primary"} inline-block truncate max-w-[16em]`}
      title={typeof label === "string" ? label : undefined}
    >
      {label}
    </span>
  );

  return isLink ? <Link to={item.path}>{content}</Link> : content;
}

export function Breadcrumb({
  module,
  name,
  items: customItems,
  extra,
  showHome = true,
  className = "",
}: BreadcrumbProps) {
  const navigationStore = useNavigationStore();
  const items: BreadcrumbItem[] = [];

  if (showHome) {
    const homeNav = navigationStore.homeNavigation;
    items.push({ path: homeNav?.menu_path || "/", label: t("module.index") });
  }

  if (customItems) {
    items.push(...customItems);
  } else if (module) {
    const moduleNav = module.navKey ? navigationStore[module.navKey] : null;
    items.push({ ...module, path: moduleNav?.menu_path || module.path });
    if (name !== undefined) items.push({ path: "", label: name });
  }

  return (
    <div className={`relative w-full flex items-center gap-4 box-border ${className}`}>
      <AntdBreadcrumb
        className="flex-1 w-0"
        separator={<RightOutlined style={{ fontSize: 12 }} className=" text-regular flex-shrink-0" />}
        items={items.map((item, index) => ({
          title: renderItem(item, index === items.length - 1),
        }))}
      />
      {extra}
    </div>
  );
}

export const MODULE_CONFIGS = {
  agent: { path: "/agent", i18nKey: "module.agent", navKey: "agentNavigation" as const },
  prompt: { path: "/prompt", i18nKey: "module.prompt", navKey: "promptNavigation" as const },
  skill: { path: "/skills", i18nKey: "module.skill" },
  knowledge: { path: "/knowledge", i18nKey: "module.knowledge", navKey: "knowledgeNavigation" as const },
  library: { path: "/library", i18nKey: "module.library" },
};

export default Breadcrumb;
