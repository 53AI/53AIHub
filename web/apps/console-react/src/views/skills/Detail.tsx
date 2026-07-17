import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Modal, message, Spin } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import { t } from "@/locales";
import { skillApi } from "@/api/modules/skill";
import { groupApi } from "@/api/modules/group";
import { GROUP_TYPE } from "@/constants/group";
import {
  PublishStatus_TYPE,
  AdminStatus_TYPE,
} from "@/api/modules/skill/types";
import { getSimpleDateFormatString } from "@km/shared-utils";
import { PageHeader } from "@/components/PageLayout";
import { useSkillEditStore } from "@/stores/modules/skillEdit";
import { api_host } from "@/utils/config";
import SkillFileTree from "./components/file-edit/SkillFileTree";
import SkillFileEditor from "./components/file-edit/SkillFileEditor";
import { EnvDialog, EnvDialogRef } from "./components/Env";
import BasicInfo from "./components/config/BasicInfo";
import { SkillBasicInfo } from "./components/config/SkillBasicInfo";
import type { SkillData, BasicInfoRef } from "./components/config/BasicInfo";
import type { QualityScore } from "./utils/usageValidation";

const DEFAULT_LOGO = `${api_host}/api/images/skill/logo.png`;

export default function SkillDetail() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const basicInfoRef = useRef<BasicInfoRef>(null);
  const envDialogRef = useRef<EnvDialogRef>(null);

  const skillId = searchParams.get("skill_id");
  const isNew = searchParams.get("isNew") === "true";

  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [lastSaved, setLastSaved] = useState("");
  const [headerInfo, setHeaderInfo] = useState({ name: "New Skill", description: "", logo: "" });
  const [editVisible, setEditVisible] = useState(false);
  const [editBasicInfo, setEditBasicInfo] = useState({
    name: "",
    display_name: "",
    description: "",
    logo: "",
    groups: [] as number[],
  });
  const [loadedSkillData, setLoadedSkillData] = useState<SkillData | null>(null);
  const [loadedUsageData, setLoadedUsageData] = useState<{
    usageSwitches: any;
    usageItems: any;
  } | null>(null);

  // 使用 skillEditStore
  const {
    init: initSkillEdit,
    hasAnyChanges,
    isCurrentFileDirty,
    batchSaveAll,
  } = useSkillEditStore();

  // 初始化
  useEffect(() => {
    if (skillId) {
      loadSkillData();
      initSkillEdit(skillId);
    } else {
      setLoading(false);
    }

    // 组件卸载时清理编辑状态
    return () => {
      useSkillEditStore.getState().reset();
    };
  }, [skillId]);

  // beforeunload 拦截
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasAnyChanges || isCurrentFileDirty || isUnSaved()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasAnyChanges, isCurrentFileDirty]);

  // 数据加载完成后设置给子组件
  useEffect(() => {
    if (loadedSkillData && basicInfoRef.current) {
      basicInfoRef.current.setSkill(loadedSkillData);
    }
  }, [loadedSkillData]);

  useEffect(() => {
    if (loadedUsageData && basicInfoRef.current) {
      basicInfoRef.current.getUsageGuideRef()?.setUsageData(
        loadedUsageData.usageSwitches,
        loadedUsageData.usageItems
      );
    }
  }, [loadedUsageData]);

  const isUnSaved = useCallback(() => {
    return (basicInfoRef.current?.isUnSaved() || basicInfoRef.current?.getUsageGuideRef()?.isUnSaved()) ?? false;
  }, []);

  const loadSkillData = async () => {
    if (!skillId) return;
    setLoading(true);
    try {
      const [detail, skillsGroups, userGroups, internalUserGroups] =
        await Promise.all([
          skillApi.detail({ skill_id: skillId }),
          groupApi
            .list({ params: { group_type: GROUP_TYPE.SKILLS } })
            .catch(() => []),
          groupApi
            .list({ params: { group_type: GROUP_TYPE.USER } })
            .catch(() => []),
          groupApi
            .list({ params: { group_type: GROUP_TYPE.INTERNAL_USER } })
            .catch(() => []),
        ]);

      const skillsGroupIds = new Set(skillsGroups.map((g: any) => g.group_id));
      const userGroupIds = new Set(userGroups.map((g: any) => g.group_id));
      const internalUserGroupIds = new Set(
        internalUserGroups.map((g: any) => g.group_id),
      );

      const permissionGroupIds = detail.permission_group_ids || [];
      let groups: number[] = [];
      let subscriptionGroupIds: number[] = [];
      let userGroupIdsList: number[] = [];

      permissionGroupIds.forEach((id: number) => {
        if (skillsGroupIds.has(id)) {
          groups.push(id);
        } else if (userGroupIds.has(id)) {
          subscriptionGroupIds.push(id);
        } else if (internalUserGroupIds.has(id)) {
          userGroupIdsList.push(id);
        }
      });

      // 如果是新创建的技能且权限为空，默认添加权限
      if (isNew && permissionGroupIds.length === 0) {
        // 默认选择第一个技能分组
        if (skillsGroups.length > 0) {
          groups = [skillsGroups[0].group_id];
        }
        // 默认选择全部用户分组
        subscriptionGroupIds = userGroups.map((g: any) => g.group_id);
        // 默认选择全部内部用户分组
        userGroupIdsList = internalUserGroups.map((g: any) => g.group_id);
      }

      const skillData = detail.skill;
      const newSkill: SkillData = {
        id: skillData.id,
        name: skillData.skill_name,
        display_name: skillData.display_name || "",
        description: skillData.description || "",
        logo: skillData.logo || DEFAULT_LOGO,
        groups,
        subscription_group_ids: subscriptionGroupIds,
        user_group_ids: userGroupIdsList,
        admin_status: skillData.admin_status,
        publish_status: skillData.publish_status,
        type: skillData.source_type === "github" ? "repo" : "upload",
        github_url: skillData.source_type === "github" ? detail.github_url : "",
        version: skillData.version || "v1.0.0",
        sort: skillData.sort || 0,
      };

      setLoadedSkillData(newSkill);
      setHeaderInfo({
        name: newSkill.name,
        description: newSkill.description,
        logo: newSkill.logo || DEFAULT_LOGO,
      });

      const newQualityScores: QualityScore[] = [
        {
          key: "completeness",
          label: t("skills.quality.completeness"),
          value: Number(skillData.score_integrity ?? 0),
        },
        {
          key: "practicality",
          label: t("skills.quality.practicality"),
          value: Number(skillData.score_practicality ?? 0),
        },
        {
          key: "security",
          label: t("skills.quality.security"),
          value: Number(skillData.score_safety ?? 0),
        },
        {
          key: "code_quality",
          label: t("skills.quality.code_quality"),
          value: Number(skillData.score_code_quality ?? 0),
        },
        {
          key: "documentation",
          label: t("skills.quality.documentation"),
          value: Number(skillData.score_doc_quality ?? 0),
        },
      ];

      let newUsageSwitches = {
        quality_scores: true,
        capabilities: false,
        usage_example: false,
        best_practice: false,
        faq: false,
      };
      let newUsageItems = {
        quality_scores: newQualityScores,
        capabilities: [] as any[],
        usage_example: [] as any[],
        bestPracticesPositive: [] as any[],
        bestPracticesNegative: [] as any[],
        faq: [] as any[],
      };

      if (skillData.usage_guide) {
        try {
          const usageGuide = JSON.parse(skillData.usage_guide);
          if (usageGuide.quality_scores) {
            newUsageSwitches.quality_scores = true;
            newUsageItems.quality_scores = usageGuide.quality_scores.map(
              (item: any) => ({
                key: item.key,
                label: item.label,
                value: Number(item.value),
              }),
            );
          }
          if (usageGuide.capabilities) {
            newUsageSwitches.capabilities = true;
            newUsageItems.capabilities = usageGuide.capabilities.map(
              (item: any) => ({
                id: Math.random().toString(36).substr(2, 9),
                ...item,
              }),
            );
          }
          if (usageGuide.usage_example) {
            newUsageSwitches.usage_example = true;
            newUsageItems.usage_example = usageGuide.usage_example.map(
              (item: any) => ({
                id: Math.random().toString(36).substr(2, 9),
                ...item,
              }),
            );
          }
          if (usageGuide.best_practice) {
            newUsageSwitches.best_practice = true;
            newUsageItems.bestPracticesPositive =
              usageGuide.best_practice.positive?.map((item: any) => ({
                id: Math.random().toString(36).substr(2, 9),
                ...item,
              })) || [];
            newUsageItems.bestPracticesNegative =
              usageGuide.best_practice.negative?.map((item: any) => ({
                id: Math.random().toString(36).substr(2, 9),
                ...item,
              })) || [];
          }
          if (usageGuide.faq) {
            newUsageSwitches.faq = true;
            newUsageItems.faq = usageGuide.faq.map((item: any) => ({
              id: Math.random().toString(36).substr(2, 9),
              ...item,
            }));
          }
        } catch {}
      }

      setLoadedUsageData({ usageSwitches: newUsageSwitches, usageItems: newUsageItems });

      if (skillData.updated_time) {
        setLastSaved(
          getSimpleDateFormatString({
            date: skillData.updated_time,
            format: "YYYY-MM-DD hh:mm",
          }),
        );
      }
    } catch (error) {
      console.error("Failed to load skill:", error);
      message.error(t("skills.load_failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    const doNavigate = () => {
      // 判断是否有上一页
      const state = window.history.state || {}
      const hasHistory = state.idx !== undefined ? state.idx > 0 : false
      navigate(hasHistory ? -1 : '/skills')
    }

    if (hasAnyChanges || isCurrentFileDirty || isUnSaved()) {
      Modal.confirm({
        title: t("tip"),
        content: t("skills.unsaved_confirm_message"),
        okText: t("action_confirm"),
        cancelText: t("action.cancel"),
        onOk: doNavigate,
      });
    } else {
      doNavigate()
    }
  };

  // 打开编辑弹框
  const handleEditOpen = useCallback(() => {
    const skill = basicInfoRef.current?.getSkill();
    if (skill) {
      setEditBasicInfo({
        name: skill.name || "",
        display_name: skill.display_name || "",
        description: skill.description || "",
        logo: skill.logo || "",
        groups: skill.groups || [],
      });
      setEditVisible(true);
    }
  }, []);

  // 保存编辑
  const handleEditSave = useCallback(() => {
    const skill = basicInfoRef.current?.getSkill();
    if (skill) {
      // 更新 BasicInfo 组件的数据
      basicInfoRef.current?.setSkill({
        ...skill,
        display_name: editBasicInfo.display_name,
        description: editBasicInfo.description,
        logo: editBasicInfo.logo,
        groups: editBasicInfo.groups,
      });
      // 更新 header 信息
      setHeaderInfo({
        name: editBasicInfo.display_name || skill.name,
        description: editBasicInfo.description,
        logo: editBasicInfo.logo,
      });
    }
    setEditVisible(false);
  }, [editBasicInfo]);

  const handlePublish = async () => {
    // 验证基础信息
    const basicValid = await basicInfoRef.current?.validate();
    if (!basicValid) return;

    // 检查字段长度是否达到上限
    const skill = basicInfoRef.current?.getSkill();
    const lengthWarnings: string[] = [];
    if (skill?.display_name?.length > 50) {
      lengthWarnings.push(t("skills.display_name_length_limit"));
    }
    if (skill?.description?.length > 500) {
      lengthWarnings.push(t("skills.description_length_limit"));
    }
    if (lengthWarnings.length > 0) {
      message.warning(lengthWarnings.join("，"));
      return;
    }

    // 验证使用说明
    const usageValidation = basicInfoRef.current?.getUsageGuideRef()?.validate();
    if (!usageValidation?.valid) {
      message.warning(usageValidation?.message || t("skills.usage_guide_required"));
      return;
    }

    // 如果当前文件有未保存的更改，弹出确认框
    if (isCurrentFileDirty) {
      useSkillEditStore.getState().showConfirmModal({
        visible: true,
        message: t("skills.unsaved_changes_confirm"),
        confirmText: t("action_save"),
        onConfirm: async () => {
          useSkillEditStore.getState().hideConfirmModal();
          await doPublish();
        },
        onCancel: () => {
          useSkillEditStore.getState().hideConfirmModal();
        },
      });
      return;
    }

    await doPublish();
  };

  const doPublish = async () => {
    setPublishing(true);
    try {
      // 先保存当前编辑中的文件到暂存区
      const { isCurrentFileDirty, saveCurrentToPending, batchSaveAll } =
        useSkillEditStore.getState();
      if (isCurrentFileDirty) {
        saveCurrentToPending();
      }

      const skill = basicInfoRef.current?.getSkill();
      if (!skill) {
        message.error(t("skills.get_skill_failed"));
        return;
      }

      // 批量保存：更新技能信息 + 文件修改
      const success = await batchSaveAll(
        {
          display_name: skill.display_name,
          description: skill.description,
          usage_guide: basicInfoRef.current?.getUsageGuideRef()?.buildUsageGuide() || "{}",
          version: skill.version,
          sort: Number(skill.sort) || 0,
          admin_status:
            skill.publish_status === PublishStatus_TYPE.draft
              ? AdminStatus_TYPE.enabled
              : skill.admin_status,
          group_ids: skill.groups,
          subscription_group_ids: skill.subscription_group_ids,
          user_group_ids: skill.user_group_ids,
        },
        isUnSaved() || skill.publish_status === PublishStatus_TYPE.draft,
      );

      if (!success) {
        message.error(t("skills.publish_failed"));
        return;
      }

      setLastSaved(
        getSimpleDateFormatString({
          date: Date.now(),
          format: "YYYY-MM-DD hh:mm",
        }),
      );

      // 重置保存状态
      const currentSkill = basicInfoRef.current?.getSkill();
      if (currentSkill) {
        setLoadedSkillData({ ...currentSkill });
      }
      const currentUsageData = basicInfoRef.current?.getUsageGuideRef()?.getUsageData();
      if (currentUsageData) {
        setLoadedUsageData({ ...currentUsageData });
      }

      message.success(t("skills.publish_success"));
    } catch (error) {
      console.error("发布失败:", error);
      message.error(t("skills.publish_failed"));
    } finally {
      setPublishing(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[#FCFCFF] overflow-hidden">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-[#FCFCFF]">
      <div className="flex-none px-4 py-3 border-b border-[#E9EEF7] bg-[#F7F9FC]">
        <PageHeader
          config={{
            title: (
              <div className="flex items-center gap-2">
                <span>{headerInfo.name || t("skills.new_skill")}</span>
                <EditOutlined
                  className="cursor-pointer text-placeholder hover:text-tertiary"
                  style={{ fontSize: 14 }}
                  onClick={handleEditOpen}
                />
              </div>
            ),
            titlePrefix: headerInfo.logo ? (
              <img
                src={headerInfo.logo}
                className="w-8 rounded"
                alt=""
              />
            ) : (
              <div className="size-8 rounded bg-[#F5F5F7]" />
            ),
            description: (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs text-gray-400 truncate max-w-[200px]">
                  {headerInfo.description || t("skills.description_placeholder")}
                </span>
              </div>
            ),
            back: true,
            onBack: handleBack,
            right: (
              <div className="flex items-center gap-4">
                <span className="text-xs text-gray-400">
                  {t("agent.last_saved")}：{lastSaved}
                </span>
                {/* 环境变量 */}
                <div
                  className="bg-[#EBECF5FF] size-8 flex-center rounded-md cursor-pointer"
                  onClick={() => envDialogRef.current?.open(skillId || "")}
                >
                  <SvgIcon color="#1D1E1F" name="env" size={18}></SvgIcon>
                </div>
                <Button
                  type="primary"
                  loading={publishing}
                  className="bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
                  onClick={handlePublish}
                >
                  {t("action_publish")}
                </Button>
              </div>
            ),
          }}
        />
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧面板：表单 */}
        <div className="w-1/3 flex flex-col border-r border-[#E9EEF7]">
          <div className="h-14 flex items-center px-6 bg-[#F7F7FA]">{t("skills.skill_config")}</div>
          <div className="px-5 py-2 overflow-y-auto flex-1">
            <BasicInfo ref={basicInfoRef} skillId={skillId} />
          </div>
        </div>

        {/* 右侧面板：文件树 + 编辑器 */}
        <div className="w-2/3 h-full flex flex-col">
          <div className="py-4 pl-6">{t("skills.source_files")}</div>
          <div className="flex-1 flex flex-col overflow-hidden border-t border-[#E6E8EB]">
            <div className="flex-1 flex overflow-hidden">
              {/* 文件树 */}
              <div className="min-w-[240px] border-r border-[#E9EEF7] flex flex-col bg-[#FAFBFC]">
                <div className="px-4 py-3 text-sm font-medium text-primary border-b border-[#E9EEF7]">
                  {t("skills.directory")}
                </div>
                <div className="flex-1 overflow-y-auto">
                  <SkillFileTree />
                </div>
              </div>

              {/* 文件编辑器 */}
              <div className="flex-1 overflow-y-auto">
                <SkillFileEditor />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 编辑基本信息弹框 */}
      <Modal
        open={editVisible}
        title={t("dialog.basic_info")}
        onCancel={() => setEditVisible(false)}
        onOk={handleEditSave}
        width="50%"
      >
        <SkillBasicInfo
          value={editBasicInfo}
          onChange={setEditBasicInfo}
          t={t}
        />
      </Modal>

      {/* 环境变量弹窗 */}
      <EnvDialog ref={envDialogRef} />
    </div>
  );
}
