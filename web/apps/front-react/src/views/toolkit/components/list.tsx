import { useState, useMemo, useRef, Fragment } from "react";
import { Button, Empty, Image } from "antd";
import { Dropdown } from "@km/shared-components-react";
import { useLinksStore } from "@/stores/modules/links";
import { useUserStore } from "@/stores/modules/user";
import { useShortcutsStore } from "@/stores/modules/shortcuts";
import { useBasicLayout } from "@/hooks/useBasicLayout";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import { getPublicPath } from "@/utils/config";
import { checkPermission } from '@/utils/permission';
import AccountDialog, { AccountDialogRef } from "./AccountDialog";
import "./List.css";

const DEFAULT_LOGO = getPublicPath("/images/default_logo.png");

interface LinkState {
  id: number;
  name: string;
  description: string;
  logo: string;
  url: string;
  group_id: number;
  has_share_account: boolean;
  user_group_ids?: number[];
}

interface ToolkitListProps {
  list: LinkState[];
  keyword?: string;
  onlyAll?: boolean;
  groupId?: number;
  className?: string;
  loading?: boolean;
}

// 骨架屏组件
export function ToolkitCardSkeleton() {
  return (
    <div className="min-h-20 bg-white rounded px-5 py-4 flex items-center gap-2 border border-[#ECECEC] animate-pulse">
      <div className="w-10 h-10 bg-gray-200 rounded-full shrink-0"></div>
      <div className="flex-1 overflow-hidden">
        <div className="h-5 bg-gray-200 rounded w-1/3 mb-2"></div>
        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
      </div>
    </div>
  );
}

export function ToolkitList({
  list = [],
  keyword = "",
  onlyAll = false,
  groupId = 0,
  className = "",
  loading = false,
}: ToolkitListProps) {
  const linksStore = useLinksStore();
  const userStore = useUserStore();
  const shortcutsStore = useShortcutsStore();
  const { isSmScreen } = useBasicLayout();
  const dialogRef = useRef<AccountDialogRef>(null);

  const [showMobileModal, setShowMobileModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<LinkState | null>(null);

  const highlightText = (text: string, searchKeyword: string) => {
    if (!text || !searchKeyword) return text;
    const escapedKeyword = searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escapedKeyword, "gi");
    return text.replace(
      regex,
      (match) => `<span class='text-theme'>${match}</span>`,
    );
  };

  const showList = useMemo(() => {
    const categories = linksStore.categorys || [];
    const links = list || [];

    if (onlyAll) {
      return [
        {
          group_id: null,
          group_name: null,
          children: links,
        },
      ];
    }

    return categories
      .map((category) => {
        const children = links.filter((link) => {
          return (
            link.group_id === category.group_id
          );
        });

        const filteredChildren = keyword
          ? children.filter((link) => {
              const lowerKeyword = keyword.toLowerCase();
              return (
                link.name?.toLowerCase().includes(lowerKeyword) ||
                link.description?.toLowerCase().includes(lowerKeyword)
              );
            })
          : children;

        return onlyAll
          ? { group_id: null, group_name: null, children: filteredChildren }
          : { ...category, children: filteredChildren };
      })
      .filter((category) => category.children.length > 0);
  }, [linksStore.categorys, list, keyword, onlyAll, userStore.info.group_ids]);

  const handleCardClick = (item: LinkState) => {
    checkPermission({
      groupIds: item.user_group_ids,
      onClick: async () => {
        if (isSmScreen && item.has_share_account) {
          setSelectedItem(item);
          setShowMobileModal(true);
        } else {
          window.open(item.url, "_blank");
        }
      }
    })
  };

  const handleTo = (item: LinkState) => {
    checkPermission({
      groupIds: item.user_group_ids,
      onClick: async () => {
        closeMobileModal();
        window.open(item.url, "_blank");
      }
    })
  };

  const handleVisit = (item: LinkState) => {
    checkPermission({
      groupIds: item.user_group_ids,
      onClick: () => {
        closeMobileModal();
        dialogRef.current?.open(item);
      }
    })
  };

  const closeMobileModal = () => {
    setShowMobileModal(false);
    setSelectedItem(null);
  };

  const handleMoreCommand = (item: LinkState, command: string) => {
    if (command === "add-shortcut") {
      checkPermission({
        groupIds: item.user_group_ids,
        onClick: () => {
          shortcutsStore.addShortcut("ai_link", String(item.id));
        }
      })
    } else if (command === "remove-shortcut") {
      shortcutsStore.removeShortcut("ai_link", String(item.id));
    } else if (command === "account-access") {
      handleVisit(item);
    }
  };

  if (loading) {
    return (
      <div className={className}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <ToolkitCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (!showList.length) {
    return (
      <div className={`py-10 ${className}`}>
        <div
          className={`col-span-full flex flex-col items-center justify-center`}
        >
          <Empty
            styles={{ image: { height: 140 } }}
            description={t("common.no_data")}
            image={getPublicPath("/images/chat/completion_empty.png")}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {showList.map((item, index) => (
        <Fragment key={item.group_id ?? `all-${index}`}>
          {item.group_id !== null && (
            <h2
              id={`group_${item.group_id}`}
              className="col-span-full text-placeholder"
            >
              {item.group_name}
            </h2>
          )}
          {item.children.map((row: LinkState) => (
            <div
              key={row.id}
              className="min-h-20 bg-white rounded px-5 py-4 flex items-center gap-2 cursor-pointer border border-[#ECECEC] hover:shadow relative group"
              onClick={() => handleCardClick(row)}
            >
              <Image
                width={40}
                height={40}
                style={{ objectFit: "contain", borderRadius: 9999 }}
                src={row.logo}
                alt={row.name}
                preview={false}
                fallback={DEFAULT_LOGO}
              />
              <div className="flex-1 overflow-hidden">
                <div
                  className="text-base font-medium text-primary mb-1 mt-1 line-clamp-1"
                  title={row.name}
                  dangerouslySetInnerHTML={{
                    __html: highlightText(row.name, keyword),
                  }}
                />
                <div
                  className="text-sm text-placeholder line-clamp-1"
                  title={row.description}
                  dangerouslySetInnerHTML={{
                    __html: highlightText(row.description, keyword),
                  }}
                />
              </div>

              {/* PC Hover Overlay */}
              <div className="absolute inset-0 items-center justify-center bg-[#222326] bg-opacity-55 rounded hidden md:group-hover:flex gap-2">
                <Button
                  type="primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTo(row);
                  }}
                >
                  {t("toolbox.direct_access")}
                </Button>
                <Dropdown
                  menu={{
                    items: [
                      shortcutsStore.getShortcut("ai_link", String(row.id))
                        ? {
                            key: "remove-shortcut",
                            label: (
                              <div className="flex items-center">
                                <SvgIcon name="delete-mode" className="mr-2" />
                                {t("shortcut.remove")}
                              </div>
                            ),
                          }
                        : {
                            key: "add-shortcut",
                            label: (
                              <div className="flex items-center">
                                <SvgIcon name="add-mode" className="mr-2" />
                                {t("shortcut.add")}
                              </div>
                            ),
                          },
                      row.has_share_account && {
                        key: "account-access",
                        label: (
                          <div className="flex items-center">
                            <SvgIcon name="preview-open" className="mr-2" />
                            {t("toolbox.account_access")}
                          </div>
                        ),
                      },
                    ].filter(Boolean) as any,
                    onClick: ({ key, domEvent }) => {
                      domEvent.stopPropagation();
                      handleMoreCommand(row, key);
                    },
                  }}
                  trigger={["click"]}
                >
                  <Button
                    className="!w-8 !h-8 !p-0 hover:bg-white"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <SvgIcon name="more-h" />
                  </Button>
                </Dropdown>
              </div>
            </div>
          ))}
        </Fragment>
      ))}

      {/* Mobile Modal */}
      {showMobileModal && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          onClick={closeMobileModal}
        >
          {/* Background overlay */}
          <div className="absolute inset-0 bg-black bg-opacity-50" />

          {/* Bottom popup */}
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl transform transition-transform duration-300 ease-out">
            <div className="flex flex-col">
              <button
                className="h-8 font-medium text-base hover:bg-gray-200 transition-colors"
                onClick={() => selectedItem && handleTo(selectedItem)}
              >
                {t("toolbox.direct_access")}
              </button>
              <button
                className="h-8 font-medium text-base hover:bg-gray-200 transition-colors"
                onClick={() => selectedItem && handleVisit(selectedItem)}
              >
                {t("toolbox.account_access")}
              </button>
              <button
                className="h-8 border-t font-medium text-base hover:bg-gray-50 transition-colors"
                onClick={closeMobileModal}
              >
                {t("action.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      <AccountDialog ref={dialogRef} />
    </div>
  );
}

export default ToolkitList;
