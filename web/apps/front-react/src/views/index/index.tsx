import { useEffect, useState, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Input, Button, Image } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useNavigationStore } from "@/stores/modules/navigation";
import { useAgentStore } from "@/stores/modules/agent";
import { usePromptStore } from "@/stores/modules/prompt";
import { useLinksStore } from "@/stores/modules/links";
import { useShortcutsStore, navigateAgentShortcut } from "@/stores/modules/shortcuts";
import { useUserStore } from "@/stores/modules/user";
import { useIsSoftStyle } from "@/stores/modules/enterprise";
import { getPublicPath } from "@/utils/config";
import AgentList from "@/views/agent/components/AgentList";
import ToolkitList from "@/views/toolkit/components/List";
import { PromptList } from "@/views/prompt/components/List";
import { Footer } from "@/components/Layout";
import { ExpandSidebarButton } from "@/components/Layout/ExpandSidebarButton";
import "./index.css";
import { t } from "@/locales";

const MAX_SHOW_COUNT = 6;

export function IndexView() {
  const [searchValue, setSearchValue] = useState("");
  const navigate = useNavigate();

  const navigationStore = useNavigationStore();
  const agentStore = useAgentStore();
  const promptStore = usePromptStore();
  const linksStore = useLinksStore();
  const shortcutsStore = useShortcutsStore();
  const userStore = useUserStore();
  const isSoftStyle = useIsSoftStyle();

  const [loadMap, setLoadMap] = useState({
    agentLoading: true,
    promptLoading: true,
    toolkitLoading: true,
  });

  // 权限检查
  const hasPermission = useCallback(
    (userGroupIds: number[], itemGroupIds: number[]) => {
      if (!itemGroupIds || itemGroupIds.length === 0) return false;
      return userGroupIds.some((groupId) => itemGroupIds.includes(groupId));
    },
    [],
  );

  // 过滤后的列表
  const showAgentList = useMemo(() => {
    const filterList = agentStore.agentList.filter(
      (item: any) => item.user_group_ids?.length > 0,
    );
    if (searchValue) {
      return filterList.filter((item: any) => item.name.includes(searchValue));
    }
    return filterList.slice(0, MAX_SHOW_COUNT);
  }, [agentStore.agentList, searchValue]);

  const showPromptList = useMemo(() => {
    const filterList = promptStore.promptList;
    if (searchValue) {
      return filterList.filter((item: any) => item.name.includes(searchValue));
    }
    return filterList.slice(0, MAX_SHOW_COUNT);
  }, [promptStore.promptList, searchValue]);

  const showToolkitList = useMemo(() => {
    const filterList = linksStore.links.filter(
      (item: any) =>
        item.user_group_ids?.length > 0 &&
        hasPermission(
          userStore.info.group_ids || [],
          item.user_group_ids || [],
        ),
    );
    if (searchValue) {
      return filterList.filter((item: any) => item.name.includes(searchValue));
    }
    return filterList.slice(0, MAX_SHOW_COUNT);
  }, [linksStore.links, userStore.info.group_ids, searchValue, hasPermission]);

  const showShortcutsList = useMemo(() => {
    if (searchValue) {
      return shortcutsStore.shortcuts.filter((item: any) =>
        item.name?.includes(searchValue),
      );
    }
    return shortcutsStore.shortcuts;
  }, [shortcutsStore.shortcuts, searchValue]);

  // 热门搜索关键词
  const hotSearchKeywords = [
    t("index.hot_search_web_crawl"),
    t("index.hot_search_file_op"),
    t("index.hot_search_email"),
    t("index.hot_search_image"),
    t("index.hot_search_browser"),
  ];

  const handleHotSearch = (keyword: string) => {
    setSearchValue(keyword);
  };

  const handleShortcutsClick = async (item: any) => {
    // 非 agent 类型使用原有路由逻辑
    if (item.type !== "agent") {
      const route = shortcutsStore.getShortcutRoute(item);
      window.open(route, "_blank");
      return;
    }

    // agent 类型使用统一的跳转逻辑
    await navigateAgentShortcut({
      agentId: item.related_id,
      isSoftStyle,
      navigate,
    });
  };

  // 加载数据
  useEffect(() => {
    const loadData = async () => {
      setLoadMap({
        agentLoading: true,
        promptLoading: true,
        toolkitLoading: true,
      });

      await Promise.all([
        agentStore
          .loadAgentList()
          .then(() => setLoadMap((prev) => ({ ...prev, agentLoading: false }))),
        promptStore
          .loadPromptList()
          .then(() =>
            setLoadMap((prev) => ({ ...prev, promptLoading: false })),
          ),
        linksStore
          .loadLinks()
          .then(() =>
            setLoadMap((prev) => ({ ...prev, toolkitLoading: false })),
          ),
      ]);
    };

    loadData();
  }, []);

  return (
    <div className="index-view relative w-full overflow-x-hidden">
      {/* 背景图 */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[1920px] h-[700px] max-w-none z-1"
        style={{
          backgroundImage: `url(${getPublicPath("/images/index/card_bg_v2.png")})`,
          backgroundSize: "1920px 700px",
          backgroundPosition: "center -68px",
          backgroundRepeat: "no-repeat",
        }}
      />

      <div className="relative z-2 w-full mt-[110px]">
        {/* 展开侧边栏按钮 */}
        <ExpandSidebarButton />

        {/* 标题 */}
        <h1
          className="mx-auto text-center text-[60px] font-bold"
          dangerouslySetInnerHTML={{
            __html: t("index.banner_title", {
              name: `<span class='text-[#007AFF]'>AI</span>`,
            }),
          }}
        />
        <p className="mx-auto text-center text-xl text-[#5E6881] mt-6">
          {t("index.banner_desc")}
        </p>

        {/* 搜索框 */}
        <div className="search-input relative left-1/2 -translate-x-1/2 max-w-[980px] w-[52%] h-[54px] mt-[76px]">
          <Input
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={t("index.search_placeholder")}
            className="h-[54px] !border-transparent !shadow-none"
            prefix={<SearchOutlined className="text-[#939499]" />}
            suffix={
              <Button
                type="primary"
                size="large"
                className="h-[36px] w-[94px] rounded-[32px]"
              >
                {t("action.search")}
              </Button>
            }
          />
        </div>

        {/* 热门搜索 */}
        <div className="mx-auto text-center text-base text-[#757880] mt-[42px] flex items-center justify-center gap-3">
          <span>{t("index.hot_search")}:</span>
          {hotSearchKeywords.map((keyword) => (
            <div
              key={keyword}
              className="hover-text-theme cursor-pointer"
              onClick={() => handleHotSearch(keyword)}
            >
              {keyword}
            </div>
          ))}
        </div>

        {/* 快捷方式 */}
        {(searchValue ? showShortcutsList.length > 0 : true) && (
          <div className="w-11/12 lg:w-4/5 max-w-[1200px] mx-auto py-6 md:py-8 lg:py-10 box-border">
            {searchValue ? (
              <p className="text-sm md:text-base mt-3 line-clamp-2 text-regular">
                {t("shortcut.title")}
              </p>
            ) : (
              <>
                <h2
                  className="text-xl md:text-2xl font-bold"
                  style={{ color: "var(--el-text-color-primary, #1d1e1f)" }}
                >
                  {t("shortcut.title")}
                </h2>
                <p className="text-sm md:text-base mt-3 line-clamp-2 text-regular text-[#939499]">
                  {t("shortcut.desc")}
                </p>
              </>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-4 lg:grid-cols-5 gap-4 mt-5 md:mt-8">
              {shortcutsStore.loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex items-start p-4 bg-[#FFF8FF] rounded-lg animate-pulse"
                    >
                      <div className="w-[70px] h-[70px] bg-gray-200 rounded-full mr-4"></div>
                      <div className="flex-1">
                        <div className="h-5 bg-gray-200 rounded w-3/4 mb-2"></div>
                        <div className="h-4 bg-gray-200 rounded w-full mb-1"></div>
                        <div className="h-4 bg-gray-200 rounded w-2/3 mb-4"></div>
                        <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                      </div>
                    </div>
                  ))
                : showShortcutsList.map((shortcut: any) => (
                    <div
                      key={shortcut.id}
                      className="min-h-20 bg-white rounded-lg px-5 py-4 flex items-center gap-2 cursor-pointer border border-[#ECECEC] hover:shadow relative group"
                      onClick={() => handleShortcutsClick(shortcut)}
                    >
                      <Image
                        className=" rounded-full"
                        width={32}
                        height={32}
                        style={{ objectFit: "contain" }}
                        src={shortcut.logo}
                        alt={shortcut.name}
                        preview={false}
                        loading="lazy"
                        fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ccc'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z'/%3E%3C/svg%3E"
                      />
                      <div
                        className="text-base font-medium text-primary mb-1 mt-1 line-clamp-1"
                        title={shortcut.name}
                        dangerouslySetInnerHTML={{
                          __html: (shortcut.name || "").replace(
                            searchValue,
                            `<span class='text-theme'>${searchValue}</span>`,
                          ),
                        }}
                      />
                    </div>
                  ))}
            </div>
          </div>
        )}

        {/* 智能体 */}
        {(searchValue ? showAgentList.length > 0 : true) && (
          <div className="w-11/12 lg:w-4/5 max-w-[1200px] mx-auto py-6 md:py-8 lg:py-10 box-border">
            {searchValue ? (
              <p className="text-sm md:text-base mt-3 line-clamp-2 text-regular">
                {t("module.agent")}
              </p>
            ) : (
              <>
                <h2
                  className="text-xl md:text-2xl font-bold"
                  style={{ color: "var(--el-text-color-primary, #1d1e1f)" }}
                >
                  {t("index.agent_recommend")}
                </h2>
                <p className="text-sm md:text-base mt-3 line-clamp-2 text-regular text-[#939499]">
                  {t("index.agent_recommend_desc")}
                </p>
              </>
            )}

            <AgentList
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-5 md:mt-8"
              loading={loadMap.agentLoading}
              list={showAgentList}
              keyword={searchValue}
            />

            {!searchValue && showAgentList.length > 0 && (
              <Link
                to="/agent"
                className="block w-[240px] h-[40px] leading-[40px] border border-primary box-border text-center text-theme mt-[54px] rounded-[24px] mx-auto hover:bg-blue-50 transition-all duration-300"
              >
                {t("action.view_more")}
              </Link>
            )}
          </div>
        )}

        {/* 提示词和工具箱背景 */}
        <div
          className="w-full py-6 md:py-8 lg:py-10 mx-auto box-border"
          style={{
            backgroundImage: !searchValue
              ? `url(${getPublicPath("/images/index/card_bg_v3.png")})`
              : "",
            backgroundPosition: "center center",
            backgroundRepeat: "no-repeat",
            backgroundSize: "cover",
          }}
        >
          {/* 提示词 */}
          {(searchValue ? showPromptList.length > 0 : true) && (
            <div className="w-11/12 lg:w-4/5 max-w-[1200px] mx-auto">
              {searchValue ? (
                <p className="text-sm md:text-base mt-3 line-clamp-2 text-regular">
                  {t("module.prompt")}
                </p>
              ) : (
                <>
                  <h2
                    className="text-xl md:text-2xl font-bold"
                    style={{ color: "var(--el-text-color-primary, #1d1e1f)" }}
                  >
                    {t("index.prompt_recommend")}
                  </h2>
                  <p className="text-sm md:text-base mt-3 line-clamp-2 text-regular text-[#939499]">
                    {t("index.prompt_recommend_desc")}
                  </p>
                </>
              )}

              <PromptList
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-7"
                keyword={searchValue}
                list={showPromptList}
                loading={loadMap.promptLoading}
              />

              {!searchValue && showPromptList.length > 0 && (
                <Link
                  to="/prompt"
                  className="block w-[240px] h-[40px] leading-[40px] border border-primary box-border text-center text-theme mt-[54px] rounded-[24px] mx-auto hover:bg-blue-50 transition-all duration-300"
                >
                  {t("action.view_more")}
                </Link>
              )}
            </div>
          )}
        </div>

        {/* 工具箱 */}
        {(searchValue ? showToolkitList.length > 0 : true) && (
          <div className="w-11/12 lg:w-4/5 max-w-[1200px] mx-auto py-6 md:py-8 lg:py-10 box-border">
            {searchValue ? (
              <p className="text-sm md:text-base mt-3 line-clamp-2 text-regular">
                {t("module.toolbox")}
              </p>
            ) : (
              <>
                <h2
                  className="text-xl md:text-2xl font-bold"
                  style={{ color: "var(--el-text-color-primary, #1d1e1f)" }}
                >
                  {t("index.toolbox_recommend")}
                </h2>
                <p className="text-sm md:text-base mt-3 line-clamp-2 text-regular text-[#939499]">
                  {t("index.toolbox_recommend_desc")}
                </p>
              </>
            )}

            <ToolkitList
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-7"
              list={showToolkitList}
              onlyAll
              loading={loadMap.toolkitLoading}
            />

            {!searchValue && showToolkitList.length > 0 && (
              <Link
                to="/toolkit"
                className="block w-[240px] h-[40px] leading-[40px] border border-primary box-border text-center text-theme mt-[54px] rounded-[24px] mx-auto hover:bg-blue-50 transition-all duration-300"
              >
                {t("action.view_more")}
              </Link>
            )}
          </div>
        )}

        <div className="w-full h-[100px]" />
      </div>

      <Footer fixed={false} />
    </div>
  );
}

export default IndexView;
