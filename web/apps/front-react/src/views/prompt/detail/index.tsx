import {
  useState,
  useEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import {
  Button,
  Tooltip,
  Empty,
  Spin,
  Modal,
  message,
  Popover,
  Divider
} from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { usePromptStore } from "@/stores/modules/prompt";
import { useUserStore } from "@/stores/modules/user";
import { useIsSoftStyle } from "@/stores/modules/enterprise";
import promptApi from "@/api/modules/prompt";
import { copyToClip } from "@km/shared-utils";
import { getPublicPath } from "@/utils/config";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import { MdRenderer } from "@km/hub-ui-x-react";
import Header, { BreadcrumbItem } from "@/components/Layout/Header";
import Footer from "@/components/Layout/Footer";
import DetailBreadcrumb, { MODULE_CONFIGS } from "@/components/DetailBreadcrumb";
import PromptInput from "@/components/PromptInput";
import AuthTagGroup from "@/components/AuthTagGroup";
import "./index.css";
import { api_host } from '@/utils/config';

interface PromptDetail {
  prompt_id: string;
  name: string;
  logo: string;
  description: string;
  content: string;
  group_ids: number[];
  group_names?: string[];
  custom_config: {
    use_cases?: Array<{
      type: "case" | "scene";
      input_text: string;
      output_text: string;
      scene?: string;
      desc?: string;
      image?: string;
    }>;
  };
  ai_links_data?: Array<{
    name: string;
    url: string;
    logo: string;
  }>;
}

interface PromptDetailViewProps {
  showBack?: boolean;
}

export interface PromptDetailViewRef {
  detailData: PromptDetail | null;
  isUseCase: boolean;
  showUseCase: () => void;
  hideUseCase: () => void;
}

const virtualPrompt = `我是一个虚拟助手，我可以回答用户的问题，也可以生成用户需要的内容。

## 我的能力范围
- 📝 文本创作：撰写文章、报告、邮件、创意文案等
- 🔍 信息分析：数据解读、趋势分析、问题诊断
- 💡 创意思维：头脑风暴、方案设计、创新建议
- 🎯 专业咨询：技术指导、业务建议、学习辅导
- 🌐 多语言支持：中英文翻译、多语言内容创作
- 🤖 代码助手：编程指导、代码审查、技术解答

## 交互方式
请直接告诉我您的需求，我会：
1. 仔细理解您的问题
2. 提供详细且实用的解答
3. 根据需要提供示例或步骤
4. 确保回答的准确性和相关性

## 注意事项
- 我会尽力提供准确信息，但建议您验证重要决策
- 对于专业领域问题，建议咨询相关专家
- 我的知识有时效性，最新信息请以官方渠道为准

## 交互方式
请直接告诉我您的需求，我会：
1. 仔细理解您的问题
2. 提供详细且实用的解答
3. 根据需要提供示例或步骤
4. 确保回答的准确性和相关性

## 注意事项
- 我会尽力提供准确信息，但建议您验证重要决策
- 对于专业领域问题，建议咨询相关专家
- 我的知识有时效性，最新信息请以官方渠道为准

现在，请告诉我您需要什么帮助？
`;

const PromptDetailView = forwardRef<PromptDetailViewRef, PromptDetailViewProps>(
  (props, ref) => {
    const { showBack = false } = props;
    const { prompt_id } = useParams();
    const [searchParams] = useSearchParams();
    const promptStore = usePromptStore();
    const userStore = useUserStore();
    const isSoftStyle = useIsSoftStyle();
    const [loading, setLoading] = useState(true);
    const [detailData, setDetailData] = useState<PromptDetail | null>(null);
    const [isUseCase, setIsUseCase] = useState(false);

    // 从 URL 读取来源分组ID
    const urlGroupId = searchParams.get("group_id");

    useImperativeHandle(ref, () => ({
      detailData,
      isUseCase,
      showUseCase: () => setIsUseCase(true),
      hideUseCase: () => setIsUseCase(false),
    }));

    useEffect(() => {
      promptStore.loadCategorys();
      promptStore.loadPromptList();
      fetchPromptDetail();
    }, [prompt_id]);

    const fetchPromptDetail = async () => {
      if (!prompt_id) return;
      setLoading(true);
      try {
        const data = await promptApi.get(prompt_id);
        try {
          data.custom_config = JSON.parse(data.custom_config || "{}");
        } catch {
          data.custom_config = {};
        }
        data.logo =  data.logo || `${ api_host }/api/images/prompt/logo.png`
        setDetailData(data as unknown as PromptDetail);
      } catch (error) {
        console.error("Failed to fetch prompt detail:", error);
      } finally {
        setLoading(false);
      }
    };

    // 新增：构建面包屑数据
    const breadcrumbItems = useMemo<BreadcrumbItem[]>(() => {
      if (!detailData) return [];

      const items: BreadcrumbItem[] = [
        { label: t("module.index"), path: "/index" },
        { label: t("module.prompt"), path: "/prompt" }
      ];

      // 优先使用 URL 中的 group_id（用户从哪个分类进入），否则使用数据本身的第一个分组
      const targetGroupId = urlGroupId ? Number(urlGroupId) : (detailData.group_ids && detailData.group_ids[0]);
      if (targetGroupId) {
        const group = promptStore.categorys.find(
          (c: any) => c.group_id === targetGroupId
        );
        if (group && group.group_id > 0) {
          items.push({
            label: group.group_name,
            path: `/prompt?group_id=${group.group_id}`
          });
        }
      }

      return items;
    }, [detailData?.group_ids, promptStore.categorys, urlGroupId]);

    const hasAccess = useMemo(() => {
      if (!detailData) return false;
      const userGroupIds = userStore.info?.group_ids || [];
      return (detailData.group_ids || []).some((id) =>
        userGroupIds.includes(id),
      );
    }, [detailData, userStore.info]);

    // 计算分组名称
    const groupNames = useMemo(() => {
      if (!detailData?.group_ids) return [];
      // 如果 API 已返回 group_names，直接使用
      if (detailData.group_names && detailData.group_names.length > 0) {
        return detailData.group_names;
      }
      // 否则从 categorys 映射
      return detailData.group_ids
        .map((id) => {
          const group = promptStore.categorys.find(
            (c: any) => c.group_id === id
          );
          return group?.group_name;
        })
        .filter(Boolean);
    }, [detailData?.group_ids, detailData?.group_names, promptStore.categorys]);

    const useCaseList = useMemo(() => {
      const useCases = detailData?.custom_config?.use_cases || [];
      return useCases.filter((item) => item.type === "case");
    }, [detailData]);

    const useSceneList = useMemo(() => {
      const useCases = detailData?.custom_config?.use_cases || [];
      return useCases.filter((item) => item.type === "scene");
    }, [detailData]);

    const relatedPromptList = useMemo(() => {
      return promptStore.promptList
        .filter((item: any) => item.prompt_id !== detailData?.prompt_id)
        .slice(0, 4);
    }, [promptStore.promptList, detailData]);

    const handleCopy = async (text: string) => {
      const success = await copyToClip(text);
      if (success) {
        message.success(t("action.copy_success"));
      }
    };

    const handleShare = async () => {
      const success = await copyToClip(window.location.href);
      if (success) {
        message.success(t("status.copy_link"));
      }
    };

    const handleClickAiLink = (item: { name: string; url: string }) => {
      Modal.confirm({
        title: t("common.allow_to", { name: item.name }),
        okText: t("action.allow", { name: item.name }),
        cancelText: t("action.cancel"),
        centered: true,
        onOk: () => {
          window.open(item.url, "_blank");
        },
      });
    };

    if (loading) {
      return (
        <div className="h-full flex items-center justify-center">
          <Spin size="large" />
        </div>
      );
    }

    if (!detailData) {
      return (
        <div className="h-full flex items-center justify-center">
          <Empty description={t("prompt.not_found")} />
        </div>
      );
    }

    return (
      <div className="h-full flex flex-col bg-white">
        {isSoftStyle && (
          <Header
            border={false}
            breadcrumb={breadcrumbItems}
            right={
              <Tooltip title={t("chat.usage_guide")}>
                <div
                  className="h-[26px] px-2 rounded-full items-center justify-center gap-1.5 text-sm text-primary cursor-pointer hover:bg-[#E1E2E3] hidden md:flex"
                  onClick={() => setIsUseCase(true)}
                >
                  <div className="size-4">
                    <SvgIcon name="layout-split" size={18} />
                  </div>
                </div>
              </Tooltip>
            }
          />
        )}

        <div className="flex-1 py-6 overflow-y-auto">
          <div className="w-11/12 lg:w-4/5 max-w-[1200px] mx-auto">
            {/* Breadcrumb */}
            {!isSoftStyle && (
              <DetailBreadcrumb
                module={MODULE_CONFIGS.prompt}
                name={detailData.name}
                extra={
                  <Button color="default" variant="link" onClick={() => setIsUseCase(true)}>
                    <SvgIcon name="layout-split" size={18} />
                    {t("chat.usage_guide")}
                  </Button>
                }
              />
            )}

            {/* 使用指引视图：fixed 全屏覆盖 */}
            {isUseCase && (
              <div className={`fixed inset-0 z-[9999] bg-white flex flex-col ${ isSoftStyle ? 'left-14' : '' }`}>
                <Header
                  sticky={isSoftStyle}
                  back={showBack}
                  title={t("chat.usage_guide")}
                  breadcrumb={isSoftStyle ? breadcrumbItems : undefined}
                  right={
                    <CloseOutlined
                      className="text-regular cursor-pointer font-semibold"
                      style={{ fontSize: 18 }}
                      onClick={() => setIsUseCase(false)}
                    />
                  }
                />
                <div className="flex-1 overflow-y-auto">
                  <section className="w-full max-w-[1280px] py-6 px-3 md:px-8 lg:px-10 mx-auto box-border">
                    <h2 className="text-base font-medium text-gray-900 mb-4">{t("chat.usage_case")}</h2>
                    <div className="columns-2 gap-5 space-y-5 max-md:columns-1">
                      {useCaseList.map((item, index) => (
                        <div
                          key={index}
                          className="p-5 bg-[#F7F9FC] rounded relative group cursor-pointer break-inside-avoid"
                        >
                          <div className="bg-white rounded p-5 relative">
                            <div className="text-sm text-secondary">{t("chat.input")}</div>
                            <div className="text-sm text-primary break-words mt-4">
                              <MdRenderer content={item.input_text} />
                            </div>
                            <div className="absolute right-8 -bottom-9">
                              <SvgIcon size={50} name="arrow-down" color="white" />
                            </div>
                          </div>
                          <div className="bg-[#E6EEFF] rounded p-5 mt-4">
                            <div className="flex items-center justify-between">
                              <div className="text-sm text-secondary">{t("chat.output")}</div>
                              <Tooltip title={t("action.copy")}>
                                <div onClick={() => handleCopy(item.output_text)}>
                                  <SvgIcon name="copy" color="#4F5052" className="cursor-pointer" />
                                </div>
                              </Tooltip>
                            </div>
                            <div className="text-sm text-primary break-words whitespace-pre-wrap mt-4">
                              <MdRenderer content={item.output_text} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {useCaseList.length === 0 && (
                      <div className="flex-center py-10">
                        <Empty description={t("common.no_data")} />
                      </div>
                    )}

                    <h2 className="text-base font-medium text-gray-900 mb-4 mt-8">{t("chat.usage_scene")}</h2>
                    <div className="grid grid-cols-3 gap-6 max-md:grid-cols-1">
                      {useSceneList.map((item, index) => (
                        <div key={index} className="text-center p-6 bg-[#F4F6F9] rounded-xl border border-[#E6E8EB]">
                          {item.image && (
                            <img
                              className="mx-auto max-w-[200px] mb-4"
                              src={item.image}
                              alt={item.scene}
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          )}
                          <h6 className="text-base text-primary mb-3">{item.scene}</h6>
                          <p className="text-sm text-[#888994]">{item.desc}</p>
                        </div>
                      ))}
                    </div>
                    {useSceneList.length === 0 && (
                      <div className="flex-center py-10">
                        <Empty description={t("common.no_data")} />
                      </div>
                    )}
                  </section>
                </div>
                {isSoftStyle && <Footer />}
              </div>
            )}

            {/* 正常内容视图 */}
            {!isUseCase && (
              <>
                <div className="flex items-center gap-3 mb-5">
                  <img
                    className="flex-none size-14 rounded-lg object-cover"
                    src={detailData.logo}
                    alt={detailData.name}
                  />
                  <div className="flex-1">
                    <h2 className="text-xl font-medium text-primary mb-2 flex items-center justify-between md:justify-start">
                      <span>{detailData.name}</span>
                      <Tooltip title={t("chat.usage_guide")}>
                        <div
                          className="h-[26px] px-2 rounded-full flex items-center justify-center gap-1.5 text-sm text-primary cursor-pointer hover:bg-[#E1E2E3] md:hidden"
                          onClick={() => setIsUseCase(true)}
                        >
                          <div className="size-4">
                            <SvgIcon name="layout-split" size={18} />
                          </div>
                        </div>
                      </Tooltip>
                    </h2>
                    {/* 分组 */}
                    {groupNames.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {groupNames.map((groupName) => (
                          <span
                            key={groupName}
                            className="h-5 inline-flex items-center px-2 text-xs text-theme bg-[#EBF1FF] rounded-sm"
                          >
                            {groupName}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <p className="text-[#939499] mb-7 w-full text-wrap break-words whitespace-pre-wrap">
                  {detailData.description}
                </p>

                {!isSoftStyle && (
                  <div className="mb-7">
                    <AuthTagGroup value={detailData.group_ids} />
                  </div>
                )}

                <section className="mb-7">
                  <h3 className="text-base font-medium text-gray-900 mb-2 flex items-center justify-between">
                    <span>{t("prompt.content")}</span>
                    {isSoftStyle && (
                      <div className="md:hidden flex gap-2">
                        {hasAccess && (
                          <Button
                            className="h-[36px]"
                            type="primary"
                            onClick={() => handleCopy(detailData.content)}
                          >
                            {t("action.copy")}
                          </Button>
                        )}
                        <Button
                          className="!bg-[#F9FAFB] h-[36px]"
                          onClick={handleShare}
                        >
                          {t("action.share")}
                        </Button>
                      </div>
                    )}
                  </h3>
                  <div className="border border-[#E6E8EB] rounded-xl overflow-hidden">
                    {hasAccess ? (
                      <div className="relative group">
                        <div className="absolute top-4 right-4 z-[2] invisible md:group-hover:visible flex gap-2">
                          <Button
                            className="!bg-[#F9FAFB]"
                            onClick={() => handleCopy(detailData.content)}
                          >
                            {t("action.copy")}
                          </Button>
                          <Button
                            className="!bg-[#F9FAFB]"
                            onClick={handleShare}
                          >
                            {t("action.share")}
                          </Button>
                        </div>
                        <PromptInput
                          value={detailData.content}
                          disabled
                          showLine
                          style={{ minHeight: "max-content" }}
                        />
                      </div>
                    ) : (
                      <div className="relative border rounded">
                        <div className="blur-md">
                          <PromptInput
                            value={virtualPrompt}
                            disabled
                            showLine
                            style={{ minHeight: "max-content" }}
                          />
                        </div>
                        <div className="absolute inset-0" />
                        <div className="w-48 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-10 px-5 bg-[#6F7275] rounded-full flex items-center gap-1">
                          <SvgIcon name="lock" color="#fff" />
                          <span className="text-sm text-white">
                            {t("prompt.auth_tip")}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {/* AI Links */}
                {hasAccess && !isSoftStyle && detailData.ai_links_data && detailData.ai_links_data.length > 0 && (
                  <section className="mb-7">
                    <h2 className="text-base font-medium text-gray-900 mb-4">{t("prompt.let_use_prompt")}</h2>
                    <div className="border border-[#E6E8EB] p-5 rounded-xl">
                      <div className="flex items-center justify-center gap-4 flex-wrap">
                        {detailData.ai_links_data.map((item) => (
                          <a
                            key={item.url}
                            className="w-20 h-16 flex flex-col items-center justify-center gap-2 cursor-pointer"
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                              e.preventDefault();
                              handleCopy(detailData.content);
                              handleClickAiLink(item);
                            }}
                          >
                            <div className="size-8 rounded-full border overflow-hidden flex items-center justify-center">
                              <img
                                src={item.logo}
                                className="size-6 rounded-full"
                                alt={item.name}
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = getPublicPath("/images/default_logo.png");
                                }}
                              />
                            </div>
                            <p className="text-primary text-sm whitespace-nowrap">
                              {item.name}
                            </p>
                          </a>
                        ))}
                      </div>
                    </div>
                  </section>
                )}

                {/* Related Prompts - only for non-soft style */}
                {!isSoftStyle && relatedPromptList.length > 0 && (
                  <section className="mb-7">
                    <h2 className="text-base font-medium text-gray-900 mb-4">{t("common.related_prompt")}</h2>
                    <div className="grid grid-cols-2 gap-4">
                      {relatedPromptList.map((item: any) => (
                        <Link
                          key={item.prompt_id}
                          className="p-4 rounded-xl cursor-pointer group hover:shadow-md transition-all duration-300 bg-[#F4F6F9] border border-[#E6E8EB]"
                          to={`/prompt/${item.prompt_id}`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="text-sm text-primary truncate">{item.name}</span>
                            {(item.group_ids || []).some((id: number) =>
                              (userStore.info?.group_ids || []).includes(id)
                            ) && (
                              <Button
                                size="small"
                                className="invisible group-hover:visible !px-2"
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleCopy(item.content);
                                }}
                              >
                                {t("action.copy")}
                              </Button>
                            )}
                          </div>
                          <p className="text-sm text-[#888994] line-clamp-2" title={item.description}>
                            {item.description || "--"}
                          </p>
                        </Link>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
            {isSoftStyle && !isUseCase && <Footer />}
            {/* 软件模式下底部悬浮栏 */}
            {isSoftStyle && !isUseCase && detailData.group_ids && detailData.group_ids.length > 0 && (
              <>
                <div className="h-28"></div>
                <div className="fixed shadow-[0_4px_20px_rgba(0,0,0,0.08)] bottom-7 left-[calc(50%+27px)] -translate-x-1/2 h-[70px] w-11/12 lg:w-4/5 max-w-[1200px] px-5 bg-white rounded-xl flex items-center justify-between">
                  <div className="flex-1 overflow-hidden">
                    <AuthTagGroup value={detailData.group_ids} mode="compact" />
                  </div>
                  {hasAccess && detailData.ai_links_data && detailData.ai_links_data.length > 0 && (
                    <Popover
                      placement="topRight"
                      trigger="hover"
                      content={
                        <>
                        
                          <Divider>
                            <h2 className="text-sm font-medium text-placeholder text-center">{t("prompt.let_use_prompt")}</h2>
                          </Divider>
                          <div className="flex items-center gap-4 py-2 mt-4">
                            {detailData.ai_links_data!.map((item) => (
                              <a
                                key={item.url}
                                className="w-20 h-16 flex flex-col items-center justify-center gap-1 cursor-pointer"
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleCopy(detailData.content);
                                  handleClickAiLink(item);
                                }}
                              >
                                <div className="size-8 rounded-full border overflow-hidden flex items-center justify-center">
                                  <img
                                    src={item.logo}
                                    className="size-6 rounded-full"
                                    alt={item.name}
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).src = getPublicPath("/images/default_logo.png");
                                    }}
                                  />
                                </div>
                                <p className="text-primary text-sm whitespace-nowrap">
                                  {item.name}
                                </p>
                              </a>
                            ))}
                          </div>
                        </>
                      }
                    >
                      <Button type="primary">
                        {t("action.go_use")}
                      </Button>
                    </Popover>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  },
);

export { PromptDetailView };
export default PromptDetailView;

