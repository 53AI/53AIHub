import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Empty, Button, message } from "antd";
import { useUserStore } from "@/stores/modules/user";
import { usePromptStore } from "@/stores/modules/prompt";
import { t } from "@/locales";
import promptApi from "@/api/modules/prompt";
import { copyToClip } from "@km/shared-utils";
import { getPublicPath } from "@/utils/config";
import { SvgIcon } from "@km/shared-components-react";

interface PromptItem {
  prompt_id: string;
  name: string;
  logo: string;
  content: string;
  description: string;
  group_ids?: string[];
  group_names?: string[];
  is_liked?: boolean;
  likes?: number;
  views?: number;
}

interface PromptListProps {
  list: PromptItem[];
  keyword?: string;
  className?: string;
  loading?: boolean;
  groupId?: number;
}

// 骨架屏组件
export function PromptCardSkeleton() {
  return (
    <div className="group flex flex-col p-5 rounded-lg overflow-hidden bg-cover cursor-pointer border border-[#ECECEC] bg-white animate-pulse">
      <div>
        <div className="h-5 bg-gray-200 rounded w-1/2 mb-2"></div>
        <div className="h-5 bg-gray-200 rounded w-20"></div>
      </div>
      <div className="flex-1 mt-2">
        <div className="h-3 bg-gray-200 rounded w-full mb-1"></div>
        <div className="h-3 bg-gray-200 rounded w-3/4"></div>
      </div>
      <div className="h-8 mt-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-4 bg-gray-200 rounded w-12"></div>
          <div className="h-4 bg-gray-200 rounded w-10"></div>
        </div>
        <div className="h-8 bg-gray-200 rounded w-14"></div>
      </div>
    </div>
  );
}

export function PromptList({
  list,
  keyword = "",
  className = "",
  loading = false,
  groupId,
}: PromptListProps) {
  const navigate = useNavigate();
  const userGroupIds = useUserStore((state) => state.info.group_ids || []);
  const updatePromptLike = usePromptStore((state) => state.updatePromptLike);

  const highlightedName = useCallback(
    (name: string) => {
      if (!keyword) return name;
      const regex = new RegExp(`(${keyword})`, "gi");
      return name.replace(regex, `<span class='text-theme'>$1</span>`);
    },
    [keyword],
  );

  const handleCopy = async (e: React.MouseEvent, item: PromptItem) => {
    e.preventDefault();
    e.stopPropagation();
    const success = await copyToClip(item.content);
    if (success) {
      message.success(t("common.copied"));
    }
  };

  const handleApprove = async (e: React.MouseEvent, item: PromptItem) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const newIsLiked = !item.is_liked;
      await promptApi.approve(item.prompt_id);
      updatePromptLike(item.prompt_id, newIsLiked);
      message.success(
        t(newIsLiked ? "status.approve_success" : "status.approve_cancel"),
      );
    } catch {
      // Error handling
    }
  };

  const canCopy = (item: PromptItem) => {
    return (item.group_ids || []).some((id) =>
      userGroupIds.includes(id as any),
    );
  };

  if (loading) {
    return (
      <div className={className}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <PromptCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (list.length === 0) {
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
      {list.map((item) => (
        <div
          key={item.prompt_id}
          className="group flex flex-col p-5 rounded-xl overflow-hidden bg-cover cursor-pointer bg-white border border-[#E6E6E6] hover:shadow-md transition-all duration-300"
          onClick={() => {
            const params = new URLSearchParams()
            if (groupId && groupId > 0) {
              params.set('group_id', String(groupId))
            }
            const searchStr = params.toString()
            navigate(`/prompt/${item.prompt_id}${searchStr ? '?' + searchStr : ''}`)
          }}
        >
          <div className="flex items-center">
            <img
              className="flex-none size-12 mr-3 rounded-lg object-cover"
              src={item.logo}
              alt={item.name}
            />
            <div>
              <h3
                className="text-base font-medium line-clamp-1 text-primary"
                title={item.name}
                dangerouslySetInnerHTML={{
                  __html: highlightedName(item.name),
                }}
              />
              {item.group_names && item.group_names.length > 0 && (
                <div className="mt-0.5">
                  {item.group_names.map((groupName) => (
                    <span
                      key={groupName}
                      className="h-5 inline-flex items-center px-2 text-xs text-theme bg-[#EBF1FF] rounded-sm mr-2"
                    >
                      {groupName}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p
            className="flex-1 text-xs line-clamp-2 text-placeholder mt-2"
            title={item.description}
          >
            {item.description}
          </p>
          <div className="h-8 mt-3 flex items-center justify-between">
            <div className="flex items-center justify-end gap-3 ">
              <div className="flex items-center gap-1">
                <SvgIcon className="size-[16px]" name="view" />
                <span className="text-sm text-[#9CA3AF]">{item.views || 0}人浏览</span>
              </div>
            </div>
            {canCopy(item) && (
              <Button
                onClick={(e) => handleCopy(e, item)}
              >
                {t("action.copy")}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default PromptList;
