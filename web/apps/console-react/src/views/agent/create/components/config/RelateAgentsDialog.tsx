import {
  useState,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
  useEffect,
} from "react";
import {
  Modal,
  Button,
  Empty,
  Spin,
  Pagination as AntPagination,
} from "antd";
import { GroupTabs } from "@/components/GroupTabs";
import { Search } from "@km/shared-components-react";
import agentApi from "@/api/modules/agent";
import { GROUP_TYPE } from "@/constants/group";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import RelateAgentsSetting from "./RelateAgentsSetting";
import { getPublicPath } from "@/utils/config";

export interface RelateAgentsDialogRef {
  open: (relateAgents: any[]) => void;
  close: () => void;
}

interface Props {
  onSelect?: (item: any) => void;
}

export const RelateAgentsDialog = forwardRef<RelateAgentsDialogRef, Props>(
  ({ onSelect }, ref) => {
    const [visible, setVisible] = useState(false);
    const [existAgents, setExistAgents] = useState<any[]>([]);

    const [filterForm, setFilterForm] = useState({
      group_id: 0,
      keyword: "",
      page: 1,
      pageSize: 20,
    });

    const [tableData, setTableData] = useState({
      loading: true,
      total: 0,
      list: [] as any[],
    });

    const relateAgentsSettingRef = useRef<any>(null);

    // 使用 ref 保存最新的 filterForm 值，确保 loadList 能获取到最新值
    const filterFormRef = useRef(filterForm);
    useEffect(() => {
      filterFormRef.current = filterForm;
    }, [filterForm]);

    const loadList = useCallback(async () => {
      try {
        setTableData((prev) => ({ ...prev, loading: true }));
        const currentFilter = filterFormRef.current;
        const { count = 0, agents = [] } = await agentApi.list({
          params: {
            group_id: currentFilter.group_id,
            keyword: currentFilter.keyword,
            offset: (currentFilter.page - 1) * currentFilter.pageSize,
            limit: currentFilter.pageSize,
          },
        });
        setTableData({
          loading: false,
          total: count,
          list: agents,
        });
      } finally {
        setTableData((prev) => ({ ...prev, loading: false }));
      }
    }, []);

    const refresh = useCallback(() => {
      setFilterForm((prev) => {
        filterFormRef.current = { ...prev, page: 1 };
        return { ...prev, page: 1 };
      });
      loadList();
    }, [loadList]);

    const handleCurrentChange = useCallback(
      (page: number) => {
        setFilterForm((prev) => {
          filterFormRef.current = { ...prev, page };
          return { ...prev, page };
        });
        loadList();
      },
      [loadList],
    );

    const handleSizeChange = useCallback(
      (size: number) => {
        setFilterForm((prev) => {
          filterFormRef.current = { ...prev, pageSize: size };
          return { ...prev, pageSize: size };
        });
        loadList();
      },
      [loadList],
    );

    useImperativeHandle(ref, () => ({
      open: (relateAgents) => {
        setExistAgents(relateAgents || []);
        setVisible(true);
        loadList();
      },
      close: () => {
        setVisible(false);
      },
    }));

    const isExist = (agent_id: number) => {
      return (existAgents || []).some((item) => item.agent_id === agent_id);
    };

    const handleAdd = (item: any) => {
      onSelect?.(item);
      setVisible(false);
    };

    const showEmpty = tableData.list.length === 0 && !tableData.loading;

    return (
      <>
        <Modal
          open={visible}
          title={t("action_add")}
          width={870}
          footer={null}
          onCancel={() => setVisible(false)}
        >
          <div className="h-[560px] flex flex-col">
            <div className="flex-none flex items-center justify-between">
              <div className="flex-1 w-0">
                <GroupTabs
                  value={filterForm.group_id}
                  onChange={(val) => {
                    const numVal =
                      typeof val === "string"
                        ? val === "-1"
                          ? 0
                          : parseInt(val, 10)
                        : val;
                    filterFormRef.current = {
                      ...filterFormRef.current,
                      group_id: numVal as number,
                    };
                    setFilterForm((prev) => ({
                      ...prev,
                      group_id: numVal as number,
                    }));
                    refresh();
                  }}
                  groupType={GROUP_TYPE.AGENT}
                />
              </div>
              <div className="flex-none flex-center gap-3 ml-8">
                <Search
                  value={filterForm.keyword}
                  placeholder={t("module.ai_toolbox_search_placeholder")}
                  onDebouncedChange={(val) => {
                    filterFormRef.current = {
                      ...filterFormRef.current,
                      keyword: val,
                    };
                    setFilterForm((prev) => ({ ...prev, keyword: val }));
                    refresh();
                  }}
                />
              </div>
            </div>

            <div className="flex-1 mt-4 flex flex-col gap-4 overflow-y-auto relative">
              {tableData.loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10">
                  <Spin />
                </div>
              )}
              {tableData.list.map((item) => {
                  const agentMode = item.custom_config?.agent_mode;
                  return (
                    <div
                      key={item.agent_id}
                      className="bg-white rounded border p-4 flex items-center gap-2 relative group"
                    >
                      <img
                        alt="AI 搜索"
                        src={
                          item.logo ||
                          getPublicPath("/images/agent/default-logo.png")
                        }
                        className="size-10 rounded-md"
                        onError={(e) => {
                          e.currentTarget.src =
                            getPublicPath("/images/agent/default-logo.png");
                        }}
                      />
                      <div className="flex-1 overflow-hidden">
                        <div className="text-sm text-primary flex items-center gap-3">
                          <span>{item.name}</span>
                          <span className="px-2 py-1 bg-gray-100 text-xs text-hint rounded flex items-center gap-1">
                            <SvgIcon
                              name={
                                agentMode === "chat"
                                  ? "chat_v2"
                                  : agentMode === "assistant"
                                    ? "agent"
                                    : "app-one"
                              }
                              width={16}
                              height={16}
                            />
                            {agentMode === "chat"
                              ? t("agent_type_chat_v2")
                              : agentMode === "assistant"
                                ? t("agent_type.assistant")
                                : t("agent_type_completion_v2")}
                          </span>
                        </div>
                        <div className="text-xs text-primary text-opacity-60 truncate mt-1">
                          {item.description}
                        </div>
                      </div>
                      {isExist(item.agent_id) ? (
                        <Button
                          type="primary"
                          ghost
                          className="border-none"
                          disabled
                        >
                          {t("action.added")}
                        </Button>
                      ) : (
                        <Button
                          type="primary"
                          className="invisible group-hover:visible"
                          onClick={() => handleAdd(item)}
                        >
                          {t("action_add")}
                        </Button>
                      )}
                    </div>
                  );
                })}

              {showEmpty && <Empty />}
            </div>

            <AntPagination
              total={tableData.total}
              pageSize={filterForm.pageSize}
              current={filterForm.page}
              onChange={(page, pageSize) => {
                if (pageSize !== filterForm.pageSize) {
                  handleSizeChange(pageSize);
                } else {
                  handleCurrentChange(page);
                }
              }}
            />
          </div>
        </Modal>
        <RelateAgentsSetting ref={relateAgentsSettingRef} />
      </>
    );
  },
);

export default RelateAgentsDialog;
