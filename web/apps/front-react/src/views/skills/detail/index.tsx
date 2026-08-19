import { useState, useMemo, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  PlusOutlined,
  CopyOutlined,
  CheckOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import { Button, Tag, Collapse, Spin, message } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { copyToClip } from "@km/shared-utils";
import { StarRating } from "@/components/StarRating";
import Header, { BreadcrumbItem } from "@/components/Layout/Header";
import Footer from "@/components/Layout/Footer";
import Breadcrumb, { MODULE_CONFIGS } from "@/components/Breadcrumb";
import { useSkillsStore } from "@/stores/modules/skills";
import { useIsSoftStyle } from "@/stores/modules/enterprise";
import { t } from "@/locales";
import { skillApi } from "@/api/modules/skill";
import type { SkillDetail } from "@/api/modules/skill/types";
import SkillEnvVarsDrawer from "../components/SkillEnvVarsDrawer";
import { api_host } from '@/utils/config';
import AuthTagGroup from "@/components/AuthTagGroup";
import AddSkillModal from "../components/AddSkillModal";
import { checkPermission } from "@/utils/permission";

const getQualityIcon = (key: string) => {
  const iconMap: Record<string, string> = {
    completeness: "check_v3",
    practicality: "tool",
    security: "protect",
    code_quality: "folder_v2",
    documentation: "edit-one",
  };
  return iconMap[key] || "check_v3";
};

export function SkillDetailView() {
  const navigate = useNavigate();
  const { skill_id } = useParams<{ skill_id: string }>();
  const [searchParams] = useSearchParams();
  const skillsStore = useSkillsStore();
  const isSoftStyle = useIsSoftStyle();

  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeFaq, setActiveFaq] = useState("0");
  const [envDrawerOpen, setEnvDrawerOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);

  const type = (searchParams.get("type") as "explore" | "my") || "explore";
  const urlGroupId = searchParams.get("group_id");
  const id = skill_id;

  // 新增：构建面包屑数据
  const breadcrumbItems = useMemo<BreadcrumbItem[]>(() => {
    if (!skill) return [];

    const items: BreadcrumbItem[] = [
      { label: t("module.index"), path: "/index" },
      {
        label: t("module.skill"),
        // 根据来源页面传递正确的参数，确保返回时保持原有 tab 状态
        path: type === "my" ? "/skills?from=my" : "/skills"
      }
    ];

    // 仅在"探索"模式下添加分组面包屑（我的技能不支持分组过滤）
    if (type !== "my") {
      // 优先使用 URL 中的 group_id（用户从哪个分类进入），否则使用数据本身的第一个分组
      const targetGroupId = urlGroupId ? Number(urlGroupId) : (skill.group_ids && skill.group_ids[0]);
      const group = skillsStore.categorys.find(c => c.group_id === targetGroupId);
      if (group && group.group_id > 0) {
        items.push({
          label: group.group_name,
          path: `/skills?group_id=${group.group_id}`
        });
      }
    }

    return items;
  }, [skill, skillsStore.categorys, type, urlGroupId]);

  const usageGuide = useMemo(() => {
    if (!skill?.usage_guide) return null;
    try {
      return JSON.parse(skill.usage_guide);
    } catch {
      return null;
    }
  }, [skill]);

  const qualityItems = useMemo(() => {
    if (!usageGuide?.quality_scores) return null;
    return usageGuide.quality_scores.map((item: any) => ({
      label: item.label,
      value: Math.round(item.value * 10) / 10, // 保留一位小数
      icon: getQualityIcon(item.key),
    }));
  }, [usageGuide]);

  const capabilities = useMemo(() => {
    if (!usageGuide?.capabilities) return [];
    return usageGuide.capabilities.map((item: any) => ({
      title: item.title,
      desc: item.description || "",
    }));
  }, [usageGuide]);

  const usageExamples = useMemo(() => {
    if (!usageGuide?.usage_example) return [];
    return usageGuide.usage_example.map((item: any) => ({
      title: item.title,
      desc: item.description || "",
    }));
  }, [usageGuide]);

  const positiveCases = useMemo(() => {
    if (!usageGuide?.best_practice?.positive) return [];
    return usageGuide.best_practice.positive.map(
      (item: any) => item.title || item,
    );
  }, [usageGuide]);

  const negativeCases = useMemo(() => {
    if (!usageGuide?.best_practice?.negative) return [];
    return usageGuide.best_practice.negative.map(
      (item: any) => item.title || item,
    );
  }, [usageGuide]);

  const faqs = useMemo(() => {
    if (!usageGuide?.faq) return [];
    return usageGuide.faq.map((item: any) => ({
      q: item.title,
      a: item.description || "",
    }));
  }, [usageGuide]);

  // 多分组名
  const groupNames = useMemo(() => {
    if (!skill?.group_ids) return [];
    return skillsStore.categorys
      .filter(c => skill.group_ids.includes(c.group_id))
      .map(c => c.group_name);
  }, [skill?.group_ids, skillsStore.categorys]);

  const fetchSkillDetail = async () => {
    if (!id) {
      message.error(t('skill.id_empty'));
      navigate("/skills");
      return;
    }

    setLoading(true);
    try {
      const data = await skillApi.getDetail(id);
      data.logo = data.logo || `${ api_host }/api/images/prompt/logo.png`
      setSkill(data);
    } catch (error) {
      message.error(t('skill.fetch_detail_failed'));
      console.error("获取技能详情失败:", error);
      navigate("/skills");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSkillDetail();
    skillsStore.loadCategorys(); // 加载分组列表
  }, [id]);

  const handleBack = () => {
    if (isSoftStyle) {
      navigate(-1);
    } else {
      navigate({
        pathname: "/skills",
        search: type === "my" ? "?from=my" : "",
      });
    }
  };

  const handleUse = () => {
    if (!skill) return;
    if (skill.binding_status !== "enabled") {
      message.warning(t('skill.enable_first'));
      return;
    }
    if (!isSoftStyle) {
      message.warning(t('skill.soft_mode_only'));
      return;
    }
    navigate({
      pathname: "/index",
      search: `?skill_id=${skill.id}&type=${type}`,
    });
  };

  const handleAdd = () => {
    if (!skill) return;
    checkPermission({
      groupIds: skill?.group_ids || [],
      onClick: async () => {
        setAddModalOpen(true);
      }
    })
  };

  const handleOpenEnvSettings = () => {
    setEnvDrawerOpen(true);
  };

  const handleDownload = async () => {
    if (!skill?.id) return;

    try {
      const blob = await skillApi.downloadSkillPackage(skill.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${skill.display_name}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      message.success(t('skill.download_success'));
    } catch (error) {
      message.error(t('skill.download_failed'));
      console.error("下载技能包失败:", error);
    }
  };

  const handleCopy = async (text: string) => {
    await copyToClip(text);
    message.success(t('action.copy_success'));
  };
  if (!skill) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spin />
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
            skill.added && (
              <Button
                color="default"
                variant="link"
                onClick={handleOpenEnvSettings}
                title={t('skill.env_settings')}
                aria-label={t('skill.env_settings')}
                className="!px-0"
              >
                <SvgIcon name="env" size={16} color="#1D1E1F" />
              </Button>
            )
          }
        />
      )}
      <div className="flex-1 py-6 overflow-y-auto">
        <div className={`w-11/12 lg:w-4/5 max-w-[1200px] mx-auto`}>
          {!isSoftStyle && (
            <Breadcrumb
              module={MODULE_CONFIGS.skill}
              name={skill.display_name}
              className="mb-5"
            />
          )}

          <div className="flex items-start gap-3 mb-5">
            <img
              className="flex-none size-14 rounded-lg object-cover"
              src={skill.logo}
              alt={skill.display_name}
            />
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-xl font-medium text-primary">
                  {skill.display_name}
                </h1>
                <Tag className="text-xs rounded-3xl truncate max-w-[80px]" title={skill.version}>{skill.version}</Tag>
              </div>
              {/* 多分组 */}
              {groupNames.length > 0 && (
                <div className="flex items-center gap-1 mt-1">
                  {groupNames.map((name, index) => (
                    <span
                      key={index}
                      className="h-5 inline-flex items-center px-2 text-xs text-theme bg-[#EBF1FF] rounded-sm"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p className="text-[#939499] mb-6 w-full">{skill.description}</p>

          {!isSoftStyle && <div className="flex items-center gap-3  mb-6">
            {  skill.added ? (
              <Button type="primary" onClick={handleUse}>
                {t('skill.workbench_use')}
              </Button>
            ) : (
              <Button type="primary" onClick={handleAdd}>
                <PlusOutlined className="mr-1" />
                {t('skill.add_skill')}
              </Button>
            )}
            {
               skill.added && (
                <Button
                  color="default"
                  variant="link"
                  onClick={handleOpenEnvSettings}
                  title={t('skill.env_settings')}
                  aria-label={t('skill.env_settings')}
                  className="!px-0"
                >
                  <SvgIcon name="env" size={16} color="#1D1E1F" />
                </Button>
              )
            }
          </div>}

          <section className="mb-7">
            <h2 className="text-base font-medium text-gray-900 mb-4">安装使用</h2>
            <div className="flex items-center gap-1.5 border border-[#E6E8EB] p-5 rounded-xl">
              <SvgIcon name="download-one" size={16}  />
              <div className="flex-1">下载到本地</div>
              <Button color="primary" variant="filled" onClick={handleDownload}>
                <SvgIcon name="download-one" size={16} />
                {t('action.download')}
              </Button>
            </div>
          </section>

          {qualityItems && qualityItems.length > 0 && (
            <section className="mb-7">
              <h2 className="text-base font-medium text-gray-900 mb-4">{t('skill.quality_score')}</h2>
              <div className="grid grid-cols-5 gap-4 border border-[#E6E8EB] p-5 rounded-xl">
                {qualityItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="bg-[#F4F6F9] rounded-xl p-6 flex flex-col items-center justify-center gap-2"
                  >
                    <div className="size-8 bg-[#e8edf8] rounded-full flex items-center justify-center">
                      <SvgIcon name={item.icon} size={16} color="#2563EB" />
                    </div>
                    <p className="text-sm mb-2">{item.label}</p>
                    <div className="flex items-center justify-center gap-1">
                      <StarRating value={item.value} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {capabilities.length > 0 && (
            <section className="mb-7">
              <h2 className="text-base font-medium text-gray-900 mb-4">{t('skill.capabilities')}</h2>
              <div className="grid grid-cols-3 gap-6">
                {capabilities.map((item, idx) => (
                  <div
                    key={idx}
                    className="bg-[#F4F6F9] rounded-xl p-6 border border-[#E6E8EB]"
                  >
                    <h3 className="mb-3">{item.title}</h3>
                    <p className="text-sm text-[#888994] leading-relaxed">
                      {item.desc}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {usageExamples.length > 0 && (
            <section className="mb-7">
              <h2 className="text-base font-medium text-gray-900 mb-4">{t('skill.usage_example')}</h2>
              <div className="space-y-4">
                {usageExamples.map((item, idx) => (
                  <div
                    key={idx}
                    className="border border-gray-100 rounded-xl overflow-hidden"
                  >
                    <div className="flex items-center justify-between p-4 bg-[#f8faff]">
                      <h3 className="text-sm">{item.title}</h3>
                      <div
                        onClick={() => handleCopy(item.desc)}
                        className="h-6 rounded flex items-center justify-center cursor-pointer bg-[#eaeef8] hover:bg-[#E1E2E3] text-sm text-[#2563EB] !py-[5px] !px-2"
                      >
                        <CopyOutlined
                          style={{ color: "#2563EB" }}
                          className="mr-1"
                        />
                        {t('action.copy')}
                      </div>
                    </div>
                    <div className="border-t border-dashed border-gray-200 mx-6" />
                    <div className="p-4">
                      <p className="text-sm text-gray-500 leading-relaxed">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!!(positiveCases.length || negativeCases.length) && (
            <section className="mb-7">
              <h2 className="text-base font-medium text-gray-900 mb-4">{t('skill.best_practice')}</h2>
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-green-50/50 rounded-xl p-6 border border-[#E6E8EB]">
                  <div className="flex items-center gap-2 mb-4">
                    <CheckOutlined
                      className="text-green-500"
                      style={{ fontSize: 20 }}
                    />
                    <span>{t('skill.positive_case')}</span>
                  </div>
                  <ul className="space-y-3">
                    {positiveCases.map((text, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm text-gray-600"
                      >
                        <div className="size-2 rounded-full bg-green-500 mt-1.5 shrink-0" />
                        {text}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-orange-50/50 rounded-xl p-6 border border-[#E6E8EB]">
                  <div className="flex items-center gap-2 mb-4">
                    <SvgIcon name="warning_v2" size="20px" />
                    <span>{t('skill.negative_case')}</span>
                  </div>
                  <ul className="space-y-3">
                    {negativeCases.map((text, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm text-gray-600"
                      >
                        <div className="size-2 rounded-full bg-orange-500 mt-1.5 shrink-0" />
                        {text}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}

          {faqs.length > 0 && (
            <section className="mb-7">
              <h2 className="text-base font-medium text-gray-900 mb-4">{t('skill.faq')}</h2>
              <div className="border border-[#E6E8EB] rounded-xl overflow-hidden p-5">
                <Collapse
                  className="faq-collapse"
                  activeKey={activeFaq}
                  onChange={(key) => setActiveFaq(key as string)}
                  accordion
                  items={faqs.map((faq, idx) => ({
                    key: String(idx),
                    label: (
                      <div className="flex items-center gap-3 flex-1 bg-[#f8faff] h-5 text-base">
                        <QuestionCircleOutlined
                          style={{ fontSize: 20, color: "#2563EB" }}
                        />
                        <span className="font-medium text-gray-900">{faq.q}</span>
                      </div>
                    ),
                    children: (
                      <div className="p-4 text-sm text-gray-500 leading-relaxed bg-gray-50/50">
                        {faq.a}
                      </div>
                    ),
                  }))}
                />
              </div>
            </section>
          )}
        </div>
          {isSoftStyle && <Footer />}
          {/* 软件模式下底部悬浮栏 */}
          {isSoftStyle && (
            <>
              <div className="h-28"></div>
              <div className="fixed shadow-[0_4px_20px_rgba(0,0,0,0.08)] bottom-7 left-[calc(50%+27px)] -translate-x-1/2 h-[70px] w-11/12 lg:w-4/5 max-w-[1200px] px-5 bg-white rounded-xl flex items-center justify-between">
                <div className="flex-1 overflow-hidden">
                  {/* 可在此处添加权限标签等信息 */}
                  { skill.group_ids && skill.group_ids.length > 0 && <AuthTagGroup value={skill.group_ids}  mode="compact"  /> }
                </div>
                {skill.added ? (
                  <Button type="primary" onClick={handleUse}>{t('skill.workbench_use')}</Button>
                ) : (
                  <Button type="primary" onClick={handleAdd}>
                    <PlusOutlined className="mr-1" />
                    {t('skill.add_skill')}
                  </Button>
                )}
              </div>
            </>
          )}
      </div>
      <SkillEnvVarsDrawer
        open={envDrawerOpen}
        skillId={String(skill.id)}
        skillDisplayName={skill.display_name}
        onClose={() => setEnvDrawerOpen(false)}
      />

      {/* 添加技能弹窗 */}
      <AddSkillModal
        open={addModalOpen}
        skillId={skill.id}
        groupIds={skill.group_ids}
        onClose={() => setAddModalOpen(false)}
        onSuccess={() => {
          setAddModalOpen(false);
        }}
      />
    </div>
  );
}

export default SkillDetailView;
