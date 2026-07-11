import { Modal, Button, Empty, Tabs } from "antd";
import {
    useRef,
    useState,
    forwardRef,
    useImperativeHandle,
    useCallback,
    useMemo,
} from "react";
import { t } from "@/locales";
import { Search } from "@km/shared-components-react";
import { aiLinkApi } from "@/api/modules/ai-link";

// ============================================================================
// Types
// ============================================================================

/** 商店分组项 */
interface StoreItem {
  group_id: number;
  group_name: string;
  links: AI_LINK.State[];
}

/** 商店 API 响应项 */
interface StoreApiResponse {
  group_name: string;
  links: AI_LINK.State[];
}

/** Ref 方法 */
export interface StoreDialogRef {
  /** 打开对话框 */
  open: () => void;
  /** 关闭对话框 */
  close: () => void;
}

/** Props */
interface StoreDialogProps {
  /** 是否显示手动添加按钮 */
  showAddManual?: boolean;
  /** 添加回调 */
  onAdd?: (data: { data?: AI_LINK.State }) => void;
}

// ============================================================================
// Component
// ============================================================================

const StoreDialog = forwardRef<StoreDialogRef, StoreDialogProps>(
  ({ showAddManual = true, onAdd }, ref) => {
    const [visible, setVisible] = useState(false);
    const [categoryList, setCategoryList] = useState<StoreItem[]>([]);
    const [keyword, setKeyword] = useState("");
    const [activeGroup, setActiveGroup] = useState(0);
    const scrollRef = useRef<HTMLDivElement>(null);

    // 加载商店列表
    const loadList = useCallback(async () => {
      try {
        const res = await aiLinkApi.store();
        const data = (res as { data?: StoreApiResponse[] })?.data || [];
        const list: StoreItem[] = data.map((item, index) => ({
          group_id: index + 1,
          group_name: item.group_name,
          links: item.links || [],
        }));
        list.unshift({
          group_id: 0,
          group_name: t("all"),
          links: [],
        });
        setCategoryList(list);
      } catch (error) {
        // 静默处理错误，不影响用户体验
        // 商店列表加载失败时显示空状态
        setCategoryList([]);
      }
    }, []);

    // 处理添加
    const handleAdd = useCallback(
      (data?: AI_LINK.State) => {
        onAdd?.({ data });
        setVisible(false);
      },
      [onAdd],
    );

    // 处理访问
    const handleVisit = useCallback((link: AI_LINK.State) => {
      window.open(link.url, "_blank");
    }, []);

    // 处理 Tab 变更
    const handleTabChange = useCallback((key: string) => {
      const groupId = Number(key);
      setActiveGroup(groupId);

      if (scrollRef.current) {
        if (groupId > 0) {
          const el = document.getElementById(`toolbox-group-${key}`);
          el?.scrollIntoView({ behavior: "smooth" });
        } else {
          scrollRef.current.scrollTop = 0;
        }
      }
    }, []);

    // 处理关键词变更
    const handleKeywordChange = useCallback(
      (val: string) => {
        setKeyword(val);
      },
      [],
    );

    useImperativeHandle(
      ref,
      () => ({
        open: () => {
          loadList();
          setVisible(true);
        },
        close: () => {
          setVisible(false);
        },
      }),
      [loadList],
    );

    // 过滤后的列表（使用 useMemo 缓存）
    const searchList = useMemo(() => {
      const lowerKeyword = keyword.toLowerCase();
      return categoryList
        .filter((item) => item.group_id > 0)
        .map((item) => ({
          ...item,
          links: item.links.filter(
            (link) =>
              link.name.toLowerCase().includes(lowerKeyword) ||
              (link.description || "").toLowerCase().includes(lowerKeyword),
          ),
        }));
    }, [categoryList, keyword]);

    // 是否显示空状态
    const showEmpty = useMemo(
      () => searchList.every((item) => !item.links.length),
      [searchList],
    );

    // Tab 选项
    const tabs = useMemo(
      () =>
        categoryList.map((item) => ({
          key: String(item.group_id),
          label: item.group_name,
        })),
      [categoryList],
    );

    return (
      <Modal
        open={visible}
        title={t("action_add")}
        onCancel={() => setVisible(false)}
        footer={null}
        width={870}
        destroyOnHidden
        className="[&_.ant-modal-body]:p-0"
      >
        <div className="bg-[#F7F7FA] px-4 py-4">
          {showAddManual && (
            <div
              className="flex items-center justify-center h-15 mb-6 text-brand bg-white text-sm cursor-pointer hover:bg-[#F2F4F8]"
              onClick={() => handleAdd()}
            >
              + {t("commom.add_manual")}
            </div>
          )}
          <div className="text-base text-primary font-medium mb-4">
            {t("commom.add_market")}
          </div>

          {/* Tabs and Search */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex-1 w-0">
              <Tabs
                activeKey={String(activeGroup)}
                onChange={handleTabChange}
                items={tabs}
                className="mb-0"
              />
            </div>
            <div className="flex-none ml-8">
              <Search
                mode="expanded"
                placeholder={t("module.ai_toolbox_search_placeholder")}
                value={keyword}
                onDebouncedChange={handleKeywordChange}
                className="w-[200px]"
              />
            </div>
          </div>

          {/* Links List */}
          <div ref={scrollRef} className="max-h-[360px] overflow-y-auto">
            {searchList.map((item) => (
              <div key={item.group_id}>
                {item.links.length > 0 && (
                  <div
                    id={`toolbox-group-${item.group_id}`}
                    className="text-sm text-hint mt-4"
                  >
                    {item.group_name}
                  </div>
                )}
                {item.links.length > 0 && (
                  <div className="grid grid-cols-3 gap-4 mt-3">
                    {item.links.map((link, index) => (
                      <div
                        key={index}
                        className="bg-white rounded border p-4 flex items-center gap-2 relative group cursor-pointer"
                      >
                        <img alt="" src={link.logo} className="w-10 h-10" />
                        <div className="flex-1 overflow-hidden">
                          <div className="text-sm text-primary">
                            {link.name}
                          </div>
                          <div className="text-xs text-primary text-opacity-60 truncate mt-1">
                            {link.description}
                          </div>
                        </div>

                        <div className="absolute inset-0 items-center justify-center bg-[#222326] bg-opacity-55 rounded hidden group-hover:flex gap-2">
                          <Button onClick={() => handleVisit(link)}>
                            {t("action_visit")}
                          </Button>
                          <Button
                            type="primary"
                            onClick={() => handleAdd(link)}
                          >
                            {t("action_add")}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {showEmpty && <Empty />}
          </div>
        </div>
      </Modal>
    );
  },
);

StoreDialog.displayName = "StoreDialog";

export default StoreDialog;
