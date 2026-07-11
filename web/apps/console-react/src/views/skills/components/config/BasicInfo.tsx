import { useState, useEffect, forwardRef, useImperativeHandle, useRef } from "react";
import { Input, Form, message, InputNumber } from "antd";
import { t } from "@/locales";
import GroupSelect from "@/components/GroupSelect";
import { GROUP_TYPE } from "@/constants/group";
import { useEnterpriseStore } from "@/stores";
import { PublishStatus_TYPE } from "@/api/modules/skill/types";
import UsageGuide from "./UsageGuide";
import type { UsageGuideRef } from "./UsageGuide";

interface SkillData {
  id: string;
  name: string;
  display_name: string;
  description: string;
  groups: number[];
  admin_status: string;
  publish_status: string;
  type: "repo" | "upload";
  subscription_group_ids: number[];
  user_group_ids: number[];
  github_url: string;
  version: string;
  sort: number;
}

interface BasicInfoRef {
  getSkill: () => SkillData;
  setSkill: (skill: SkillData) => void;
  validate: () => Promise<boolean>;
  isUnSaved: () => boolean;
  // UsageGuide 相关方法
  getUsageGuideRef: () => UsageGuideRef | null;
}

interface BasicInfoProps {
  initialSkill?: SkillData;
  skillId?: string;
}

const MAX_DESCRIPTION_LENGTH = 500;

const BasicInfo = forwardRef<BasicInfoRef, BasicInfoProps>(
  ({ initialSkill, skillId }, ref) => {
    const enterpriseStore = useEnterpriseStore();
    const [basicForm] = Form.useForm();
    const usageGuideRef = useRef<UsageGuideRef>(null);
    const [skill, setSkillState] = useState<SkillData>(
      initialSkill || {
        id: "",
        name: "New Skill",
        display_name: "新技能",
        description: "",
        groups: [],
        admin_status: "",
        publish_status: "",
        type: "repo",
        subscription_group_ids: [],
        user_group_ids: [],
        github_url: "",
        version: "v1.0.0",
        sort: 0,
      },
    );
    const [originalSkill, setOriginalSkill] = useState<string>("");

    // 同步表单值
    useEffect(() => {
      if (skill.name || skill.display_name) {
        basicForm.setFieldsValue({
          name: skill.name,
          display_name: skill.display_name,
          sort: skill.sort,
        });
      }
    }, [skill, basicForm]);

    useImperativeHandle(ref, () => ({
      getSkill: () => skill,
      setSkill: (newSkill: SkillData) => {
        // 如果描述超过500字符，只展示前500字符
        const truncatedSkill = {
          ...newSkill,
          description: newSkill.description.length > MAX_DESCRIPTION_LENGTH
            ? newSkill.description.slice(0, MAX_DESCRIPTION_LENGTH)
            : newSkill.description,
        };
        setSkillState(truncatedSkill);
        setOriginalSkill(JSON.stringify(truncatedSkill));
      },
      validate: async () => {
        try {
          await basicForm.validateFields();
          if (!skill.groups.length) {
            message.warning(t("skills.warning.group_required"));
            return false;
          }
          return true;
        } catch {
          return false;
        }
      },
      isUnSaved: () => {
        if (!originalSkill) return false;
        return JSON.stringify(skill) !== originalSkill;
      },
      getUsageGuideRef: () => usageGuideRef.current,
    }));

    const handleSkillChange = (changes: Partial<SkillData>) => {
      setSkillState((prev) => ({ ...prev, ...changes }));
    };

    return (
      <>
        <Form
          form={basicForm}
          layout="vertical"
          onValuesChange={(changedValues) => {
            if (changedValues.display_name !== undefined) {
              handleSkillChange({ display_name: changedValues.display_name });
            }
            if (changedValues.sort !== undefined) {
              handleSkillChange({ sort: changedValues.sort });
            }
          }}
        >

          <UsageGuide ref={usageGuideRef} skillId={skillId || ""} />
          <div className="mt-4 border-t"></div>
          <div className="flex items-center gap-4 mt-2">
            {skill.type === "repo" && (
              <Form.Item label={t("skills.label.repo_url")} className="flex-1 mb-0">
                <Input value={skill.github_url} disabled />
              </Form.Item>
            )}
            <Form.Item label={t("version.title")} className="flex-1 mb-0">
              <Input
                value={skill.version}
                onChange={(e) => handleSkillChange({ version: e.target.value })}
                maxLength={15}
                showCount
              />
            </Form.Item>
          </div>

          {/* 排序 */}
          <div className="mt-4 border-t"></div>
          <div className="h-11 flex items-center gap-2">
            <div className="text-sm text-primary">{t('prompt.frontend_sort')}</div>
            <span className="text-xs text-disabled">
              {t('module.agent_sort_desc')}
            </span>
          </div>
          <Form.Item name="sort" className="mb-0">
            <InputNumber
              className="w-full"
              controls={false}
              precision={0}
              min={0}
              max={99999999}
              placeholder={t('form.input_placeholder')}
            />
          </Form.Item>
          {/* 权限配置 - 只有当 skill 数据加载完成后才渲染，确保 defaultAll 和 value 正确 */}
          {skill.publish_status && (
            <div className="mt-4">
              {/* 使用范围 */}
              <div className="my-4 border-t"></div>
              <div className="font-bold mb-3">{t('usage_range')}</div>
              <div className="space-y-3">
                {(enterpriseStore.info.is_independent ||
                  enterpriseStore.info.is_industry) && (
                  <Form.Item label={t("register_user.title")}>
                    <GroupSelect
                      value={skill.subscription_group_ids}
                      onChange={(val: number[]) =>
                        handleSkillChange({ subscription_group_ids: val })
                      }
                      type="checkbox"
                      groupType={GROUP_TYPE.USER}
                      defaultAll={skill.publish_status === PublishStatus_TYPE.draft}
                      multiple
                    />
                  </Form.Item>
                )}
                {(enterpriseStore.info.is_enterprise ||
                  enterpriseStore.info.is_industry) && (
                  <Form.Item label={t("internal_user.title")}>
                    <GroupSelect
                      value={skill.user_group_ids}
                      onChange={(val: number[]) =>
                        handleSkillChange({ user_group_ids: val })
                      }
                      type="picker"
                      groupType={GROUP_TYPE.INTERNAL_USER}
                      defaultAll={skill.publish_status === PublishStatus_TYPE.draft}
                      multiple
                    />
                  </Form.Item>
                )}
              </div>
            </div>
          )}
        </Form>
      </>
    );
  },
);

BasicInfo.displayName = "BasicInfo";

export default BasicInfo;
export type { SkillData, BasicInfoRef };