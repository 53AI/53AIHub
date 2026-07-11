import { useCallback, useEffect, lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { SvgIcon } from "@km/shared-components-react";
import { useIsSoftStyle } from "@/stores/modules/enterprise";
import Footer from "@/components/Layout/Footer";
import Header from "@/components/Layout/Header";

const AgentGroupList = lazy(
  () => import("@/views/agent/components/GroupList"),
);
const SkillGroupList = lazy(
  () => import("@/views/skills/components/GroupList"),
);
const PromptGroupList = lazy(
  () => import("@/views/prompt/components/GroupList"),
);
const ToolkitGroupList = lazy(
  () => import("@/views/toolkit/components/GroupList"),
);

type TabKey = "agent" | "skill" | "prompt" | "toolkit";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "agent", label: "智能体" },
  { key: "skill", label: "技能库" },
  { key: "prompt", label: "提示词" },
  { key: "toolkit", label: "AI工具" },
];

const TAB_COMPONENT_MAP: Record<
  TabKey,
  React.LazyExoticComponent<React.ComponentType<any>>
> = {
  agent: AgentGroupList,
  skill: SkillGroupList,
  prompt: PromptGroupList,
  toolkit: ToolkitGroupList,
};

const DEFAULT_TAB: TabKey = "agent";
const VALID_TABS = new Set<TabKey>(TABS.map((t) => t.key));

const loadedTabs = new Set<TabKey>([DEFAULT_TAB]);

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center w-full py-10">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
    </div>
  );
}

export function PortalView() {
  const isSoftStyle = useIsSoftStyle();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawType = searchParams.get("type");
  const activeType: TabKey =
    rawType && VALID_TABS.has(rawType as TabKey)
      ? (rawType as TabKey)
      : DEFAULT_TAB;

  loadedTabs.add(activeType);

  const handleTabChange = useCallback(
    (key: TabKey) => {
      loadedTabs.add(key);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("type", key);
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (rawType !== activeType) {
      setSearchParams({ type: activeType }, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {isSoftStyle && <Header title="AI门户" border={false} />}
      <div
        className={`w-11/12 lg:w-4/5 max-w-[1200px] mx-auto ${
          isSoftStyle ? "" : "pt-4"
        }`}
      >
        <div
          className="sticky z-[101] bg-white w-full flex items-center gap-7 mb-4"
          style={{ top: isSoftStyle ? "60px" : "0px" }}
        >
          {TABS.map(({ key, label }) => {
            const isActive = activeType === key;
            return (
              <div
                key={key}
                role="tab"
                aria-selected={isActive}
                className={`h-8 text-xl flex items-center hover:opacity-80 transition-opacity cursor-pointer relative ${
                  isActive ? "text-[#1D1E1F]" : "text-[#999999]"
                }`}
                onClick={() => handleTabChange(key)}
              >
                {label}
                {isActive && (
                  <SvgIcon
                    name="explore"
                    size={20}
                    className="absolute -right-4 -top-2"
                    color="var(--el-color-primary, #2563eb)"
                  />
                )}
              </div>
            );
          })}
        </div>

        <Suspense fallback={<LoadingFallback />}>
          {TABS.map(({ key }) => {
            if (!loadedTabs.has(key)) return null;
            const Comp = TAB_COMPONENT_MAP[key];
            return (
              <div
                key={key}
                style={{ display: activeType === key ? "block" : "none" }}
              >
                <Comp />
              </div>
            );
          })}
        </Suspense>
      </div>
      <Footer />
    </>
  );
}

export default PortalView;
